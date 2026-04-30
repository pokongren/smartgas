from __future__ import annotations

import json
import logging
import re
import sqlite3
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
RAW_EXCEL_DB_PATH = DATA_DIR / "raw_excel_index.db"
AI_CACHE_DIR = DATA_DIR / "ai_cache"
STATION_CACHE_PATH = AI_CACHE_DIR / "raw_station_catalog.json"
PIPELINE_CACHE_PATH = AI_CACHE_DIR / "raw_pipeline_catalog.json"
SYSTEM_CACHE_PATH = AI_CACHE_DIR / "raw_system_aliases.json"
DISTRIBUTION_CACHE_PATH = AI_CACHE_DIR / "raw_distribution_catalog.json"

STATION_TYPE_MAP = {
    "压气站": "compressor",
    "分输站": "distribution",
    "气源站": "source",
    "阀室": "valve",
    "监控阀室": "valve",
    "监视阀室": "valve",
    "清管站": "other",
    "联络站": "other",
    "储气库": "storage",
}
STATION_TYPE_LABELS = {
    "compressor": "压气站",
    "distribution": "分输站",
    "source": "气源站",
    "valve": "阀室",
    "storage": "储气库",
    "other": "站场",
}
SCOPE_ALIAS_OVERRIDES = {
    "西气东输一线": {"西一线", "西气东输1线"},
    "西气东输二线": {"西二线", "西气东输2线"},
    "西气东输三线": {"西三线", "西气东输3线"},
    "陕京二线": {"陕二线", "陕京2线"},
    "陕京三线": {"陕三线", "陕京3线"},
    "陕京四线": {"陕四线", "陕京4线"},
}
STATION_SUFFIXES = ("分输站", "压气站", "清管站", "阀室", "站场", "站")
MARKER_SUFFIX_RE = re.compile(r"[●▲■◆★☆○◎◇△▽□]+$")
NON_WORD_RE = re.compile(r"[\s\-_/()（）【】\[\]<>《》,，.。:：;；“”\"'‘’·]+")
STATION_NAME_VARIANT_MAP = {
    "鼓浪": {"古浪"},
    "古浪": {"鼓浪"},
    "甪直": {"中俄甪直", "甪直枢纽站", "甪直分输站"},
    "中卫": {"中卫压气站", "中卫分输站"},
}


def _to_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _to_float(value: Any) -> float | None:
    text = _to_text(value)
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _normalize_text(value: str) -> str:
    text = _to_text(value)
    if not text:
        return ""
    return NON_WORD_RE.sub("", text).lower()


def _clean_station_name(value: Any) -> str:
    text = _to_text(value)
    if not text:
        return ""
    return MARKER_SUFFIX_RE.sub("", text).strip()


def _root_station_name(name: str) -> str:
    text = _clean_station_name(name)
    for suffix in STATION_SUFFIXES:
        if text.endswith(suffix) and len(text) > len(suffix):
            return text[: -len(suffix)]
    return text


def _build_station_lookup_variants(value: str) -> list[str]:
    text = _clean_station_name(value)
    if not text:
        return []

    variants: set[str] = {text, _root_station_name(text)}
    for suffix in STATION_SUFFIXES:
        if text.endswith(suffix) and len(text) > len(suffix):
            variants.add(text[: -len(suffix)])
        else:
            variants.add(f"{text}{suffix}")

    # 口语/别名互转：鼓浪<->古浪等
    for item in list(variants):
        if item in STATION_NAME_VARIANT_MAP:
            variants.update(STATION_NAME_VARIANT_MAP[item])

    normalized = {_normalize_text(item) for item in variants if item}
    return [item for item in normalized if item]


def _natural_sort_key(value: str) -> list[object]:
    parts = re.split(r"(\d+)", value or "")
    key: list[object] = []
    for part in parts:
        if part.isdigit():
            key.append(int(part))
        else:
            key.append(part)
    return key


def _unique_sorted(values: set[str] | list[str]) -> list[str]:
    cleaned = {_to_text(item) for item in values if _to_text(item)}
    return sorted(cleaned, key=_natural_sort_key)


class RawExcelAiIndex:
    def __init__(self) -> None:
        self._loaded = False
        self.station_catalog: list[dict[str, Any]] = []
        self.pipeline_catalog: list[dict[str, Any]] = []
        self.system_aliases: list[dict[str, Any]] = []
        self.distribution_catalog: list[dict[str, Any]] = []  # 分输口/用户/下载点
        self._station_id_map: dict[str, dict[str, Any]] = {}
        self._pipeline_id_map: dict[str, dict[str, Any]] = {}
        self._system_by_name: dict[str, dict[str, Any]] = {}
        self._distribution_id_map: dict[str, dict[str, Any]] = {}

    def ensure_loaded(self, force_rebuild: bool = False) -> None:
        if force_rebuild or not self._loaded or self._cache_is_stale():
            self._load_or_rebuild(force_rebuild=force_rebuild)

    def query_stations(
        self,
        *,
        station_type: str | None = None,
        keyword: str | None = None,
        scope_name: str | None = None,
    ) -> list[dict[str, Any]]:
        self.ensure_loaded()
        results = list(self.station_catalog)
        if station_type:
            results = [item for item in results if item.get("type_code") == station_type]
        if scope_name:
            results = [item for item in results if self._station_matches_scope(item, scope_name)]
        if keyword:
            keyword_key = _normalize_text(keyword)
            results = [item for item in results if keyword_key in item.get("search_text", "")]
        return sorted(results, key=lambda item: (item.get("name", ""), item.get("scope_name", "")))

    def query_pipelines(
        self,
        *,
        kind: str | None = None,
        keyword: str | None = None,
        scope_name: str | None = None,
    ) -> list[dict[str, Any]]:
        self.ensure_loaded()
        results = list(self.pipeline_catalog)
        if kind:
            results = [item for item in results if item.get("kind") == kind]
        if scope_name:
            results = [item for item in results if self._pipeline_matches_scope(item, scope_name)]
        if keyword:
            keyword_key = _normalize_text(keyword)
            results = [item for item in results if keyword_key in item.get("search_text", "")]
        return sorted(results, key=lambda item: (item.get("scope_name", ""), item.get("name", "")))

    def get_station(self, station_ref: str) -> dict[str, Any] | None:
        self.ensure_loaded()
        station_key = _normalize_text(station_ref)
        if not station_key:
            return None

        station = self._station_id_map.get(station_ref)
        if station:
            return station

        exact_matches = [
            item
            for item in self.station_catalog
            if station_key == _normalize_text(item.get("name", ""))
            or station_key in {_normalize_text(alias) for alias in item.get("aliases", [])}
        ]
        if len(exact_matches) == 1:
            return exact_matches[0]
        if len(exact_matches) > 1:
            return self.pick_best_station_candidate(station_ref, exact_matches)

        candidates = self.find_station_candidates(station_ref)
        if len(candidates) == 1:
            return candidates[0]
        return self.pick_best_station_candidate(station_ref, candidates)

    def get_pipeline(self, pipeline_ref: str) -> dict[str, Any] | None:
        self.ensure_loaded()
        pipeline_key = _normalize_text(pipeline_ref)
        if not pipeline_key:
            return None

        pipeline = self._pipeline_id_map.get(pipeline_ref)
        if pipeline:
            return pipeline

        exact_matches = [
            item
            for item in self.pipeline_catalog
            if pipeline_key == _normalize_text(item.get("name", ""))
            or pipeline_key in {_normalize_text(alias) for alias in item.get("aliases", [])}
        ]
        if len(exact_matches) == 1:
            return exact_matches[0]
        if len(exact_matches) > 1:
            return exact_matches[0]

        candidates = self.find_pipeline_candidates(pipeline_ref)
        if len(candidates) == 1:
            return candidates[0]
        return candidates[0] if candidates else None

    def find_station_candidates(self, station_name: str, limit: int = 5) -> list[dict[str, Any]]:
        self.ensure_loaded()
        lookup_key = _normalize_text(station_name)
        if not lookup_key:
            return []

        variants = set(_build_station_lookup_variants(station_name))
        variants.add(lookup_key)

        scored: list[tuple[tuple[int, int, int], dict[str, Any]]] = []
        for item in self.station_catalog:
            search_text = item.get("search_text", "")
            if not any(variant and variant in search_text for variant in variants):
                continue
            scored.append((self._score_station_candidate(station_name, item), item))

        # 第一轮没命中时，给一个弱模糊兜底，避免“完全卡壳”
        if not scored:
            fallback_scored: list[tuple[tuple[int, int, int], dict[str, Any]]] = []
            for item in self.station_catalog:
                station_key = _normalize_text(_root_station_name(item.get("name", "")))
                if not station_key:
                    continue
                overlap = len(set(lookup_key) & set(station_key))
                if overlap < max(2, len(lookup_key) // 2):
                    continue
                fallback_scored.append((self._score_station_candidate(station_name, item), item))
            scored = fallback_scored

        scored.sort(key=lambda pair: pair[0])
        return [item for _, item in scored[:limit]]

    def pick_best_station_candidate(
        self,
        station_name: str,
        candidates: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]

        # 同名多记录（常见于跨干线同名站）时，优先直接返回最匹配的一条
        query_norm = _normalize_text(station_name)
        same_name = [item for item in candidates if _normalize_text(item.get("name", "")) == query_norm]
        if same_name:
            ranked_same = sorted(same_name, key=lambda item: self._score_station_candidate(station_name, item))
            return ranked_same[0]

        query_root = _normalize_text(_root_station_name(station_name))
        same_root = [item for item in candidates if _normalize_text(_root_station_name(item.get("name", ""))) == query_root]
        if same_root:
            ranked_root = sorted(same_root, key=lambda item: self._score_station_candidate(station_name, item))
            return ranked_root[0]

        # 候选里如果某个站名明显重复出现，说明是高概率命中（只是跨干线多条记录）
        name_freq: dict[str, int] = {}
        for item in candidates:
            key = _normalize_text(item.get("name", ""))
            if not key:
                continue
            name_freq[key] = name_freq.get(key, 0) + 1
        if name_freq:
            top_name, top_freq = max(name_freq.items(), key=lambda pair: pair[1])
            if top_freq >= 2:
                frequent = [item for item in candidates if _normalize_text(item.get("name", "")) == top_name]
                frequent_ranked = sorted(frequent, key=lambda item: self._score_station_candidate(station_name, item))
                if frequent_ranked:
                    return frequent_ranked[0]

        ranked = sorted(candidates, key=lambda item: self._score_station_candidate(station_name, item))
        best_score = self._score_station_candidate(station_name, ranked[0])
        second_score = self._score_station_candidate(station_name, ranked[1])
        return ranked[0] if best_score < second_score else None

    def find_pipeline_candidates(self, pipeline_name: str, limit: int = 5) -> list[dict[str, Any]]:
        self.ensure_loaded()
        lookup_key = _normalize_text(pipeline_name)
        if not lookup_key:
            return []

        matches = [item for item in self.pipeline_catalog if lookup_key in item.get("search_text", "")]
        matches.sort(key=lambda item: (0 if _normalize_text(item.get("name", "")) == lookup_key else 1, item.get("name", "")))
        return matches[:limit]

    def match_scope(self, message: str) -> dict[str, Any] | None:
        self.ensure_loaded()
        normalized_message = _normalize_text(message)
        best_match: dict[str, Any] | None = None
        best_score = -1

        for item in self.system_aliases:
            for alias in item.get("aliases", []):
                alias_key = _normalize_text(alias)
                if not alias_key or alias_key not in normalized_message:
                    continue
                if len(alias_key) <= best_score:
                    continue
                best_score = len(alias_key)
                best_match = item

        return best_match

    def get_design_pressure(self, station_name: str) -> float | None:
        station = self.get_station(station_name)
        if not station:
            return None
        return _to_float(station.get("design_pressure_mpa"))

    def _score_station_candidate(self, station_name: str, station: dict[str, Any]) -> tuple[int, int, int]:
        full_lookup_key = _normalize_text(station_name)
        full_station_key = _normalize_text(station.get("name", ""))
        lookup_key = _normalize_text(_root_station_name(station_name))
        station_key = _normalize_text(_root_station_name(station.get("name", "")))

        if full_station_key == full_lookup_key:
            name_score = -1
        elif station_key == lookup_key:
            name_score = 0
        elif station_key.startswith(lookup_key):
            name_score = 1
        elif lookup_key in station_key:
            name_score = 2
        else:
            name_score = 3

        type_priority = {"distribution": 0, "compressor": 0, "source": 0, "other": 1, "valve": 2, "storage": 3}
        return (
            name_score,
            type_priority.get(station.get("type_code", "other"), 4),
            len(station.get("name", "")),
        )

    def query_distributions(
        self,
        *,
        keyword: str | None = None,
        trunk_name: str | None = None,
    ) -> list[dict[str, Any]]:
        """查询分输口（也叫用户 / 下载点 / 下载用户）。"""
        self.ensure_loaded()
        results = list(self.distribution_catalog)
        if trunk_name:
            trunk_key = _normalize_text(trunk_name)
            results = [item for item in results if trunk_key in _normalize_text(item.get("trunk_name", ""))]
        if keyword:
            keyword_key = _normalize_text(keyword)
            results = [item for item in results if keyword_key in item.get("search_text", "")]
        return sorted(results, key=lambda item: (item.get("trunk_name", ""), item.get("name", "")))

    def get_distribution(self, ref: str) -> dict[str, Any] | None:
        """按 ID 或名称查单个分输口。"""
        self.ensure_loaded()
        item = self._distribution_id_map.get(ref)
        if item:
            return item
        key = _normalize_text(ref)
        matches = [d for d in self.distribution_catalog if key in d.get("search_text", "")]
        return matches[0] if matches else None

    def _load_or_rebuild(self, *, force_rebuild: bool) -> None:
        if force_rebuild or self._cache_is_stale():
            self._rebuild_cache_files()

        self.station_catalog = json.loads(STATION_CACHE_PATH.read_text(encoding="utf-8"))
        self.pipeline_catalog = json.loads(PIPELINE_CACHE_PATH.read_text(encoding="utf-8"))
        self.system_aliases = json.loads(SYSTEM_CACHE_PATH.read_text(encoding="utf-8"))
        self.distribution_catalog = json.loads(DISTRIBUTION_CACHE_PATH.read_text(encoding="utf-8")) \
            if DISTRIBUTION_CACHE_PATH.exists() else []

        self._station_id_map = {item["id"]: item for item in self.station_catalog}
        self._pipeline_id_map = {item["id"]: item for item in self.pipeline_catalog}
        self._system_by_name = {item["name"]: item for item in self.system_aliases}
        self._distribution_id_map = {item["id"]: item for item in self.distribution_catalog}
        self._loaded = True

    def _cache_is_stale(self) -> bool:
        if not RAW_EXCEL_DB_PATH.exists():
            return False
        cache_paths = (STATION_CACHE_PATH, PIPELINE_CACHE_PATH, SYSTEM_CACHE_PATH, DISTRIBUTION_CACHE_PATH)
        if not all(p.exists() for p in cache_paths):
            return True
        db_mtime = RAW_EXCEL_DB_PATH.stat().st_mtime
        return any(path.stat().st_mtime < db_mtime for path in cache_paths)

    def _rebuild_cache_files(self) -> None:
        if not RAW_EXCEL_DB_PATH.exists():
            raise FileNotFoundError(f"未找到 raw excel 索引库: {RAW_EXCEL_DB_PATH}")

        AI_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(RAW_EXCEL_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            stations = self._build_station_catalog(conn)
            pipelines = self._build_pipeline_catalog(conn)
            systems = self._build_system_aliases(stations, pipelines)
            distributions = self._build_distribution_catalog(conn)

        STATION_CACHE_PATH.write_text(json.dumps(stations, ensure_ascii=False, indent=2), encoding="utf-8")
        PIPELINE_CACHE_PATH.write_text(json.dumps(pipelines, ensure_ascii=False, indent=2), encoding="utf-8")
        SYSTEM_CACHE_PATH.write_text(json.dumps(systems, ensure_ascii=False, indent=2), encoding="utf-8")
        DISTRIBUTION_CACHE_PATH.write_text(json.dumps(distributions, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("Raw excel AI cache rebuilt: %s", AI_CACHE_DIR)

    def _build_station_catalog(self, conn: sqlite3.Connection) -> list[dict[str, Any]]:
        station_map: dict[str, dict[str, Any]] = {}
        compressor_map = self._build_compressor_map(conn)
        rows = conn.execute('SELECT * FROM "sheet_管道站场阀室关系" ORDER BY "_row_number"').fetchall()
        for row in rows:
            payload = dict(row)
            raw_name = _clean_station_name(payload.get("原始_站场阀室"))
            calc_name = _clean_station_name(payload.get("计算_站场阀室"))
            trunk_name = _to_text(payload.get("关联_干线管道"))
            branch_name = _to_text(payload.get("关联_支线管道"))
            station_name = raw_name or calc_name
            if not station_name:
                continue

            record_key = "||".join([_normalize_text(station_name), _normalize_text(trunk_name or branch_name)])
            record = station_map.setdefault(
                record_key,
                {
                    "name": station_name,
                    "scope_name": trunk_name or branch_name,
                    "type_2024": "",
                    "type_2025": "",
                    "type_code": "other",
                    "type_label": "站场",
                    "location": "",
                    "design_pressure_mpa": None,
                    "systems": set(),
                    "branches": set(),
                    "aliases": set(),
                    "compressor_configs": set(),
                    "compressor_unit_count": 0,
                },
            )
            record["systems"].add(trunk_name)
            record["branches"].add(branch_name)
            record["aliases"].update({raw_name, calc_name, _root_station_name(station_name)})
            record["type_2024"] = record["type_2024"] or _to_text(payload.get("原始_2024年类型"))
            record["type_2025"] = record["type_2025"] or _to_text(payload.get("原始_2025年类型"))
            raw_type = record["type_2025"] or record["type_2024"]
            type_code = STATION_TYPE_MAP.get(raw_type, "other")
            record["type_code"] = type_code
            record["type_label"] = STATION_TYPE_LABELS.get(type_code, raw_type or "站场")
            record["location"] = record["location"] or _to_text(payload.get("原始_地理位置"))

            compressor_key = (_normalize_text(station_name), _normalize_text(trunk_name))
            compressor_info = compressor_map.get(compressor_key)
            if compressor_info:
                record["compressor_configs"].update(compressor_info["configs"])
                record["compressor_unit_count"] = max(record["compressor_unit_count"], compressor_info["unit_count"])

        records = sorted(
            station_map.values(),
            key=lambda item: (
                item.get("scope_name", ""),
                item.get("name", ""),
            ),
        )
        for index, item in enumerate(records, start=1):
            item["id"] = f"RAW-ST-{index:04d}"
            item["systems"] = _unique_sorted(item["systems"])
            item["branches"] = _unique_sorted(item["branches"])
            item["aliases"] = _unique_sorted(item["aliases"])
            item["compressor_configs"] = _unique_sorted(item["compressor_configs"])
            item["search_text"] = _normalize_text(
                " ".join(
                    [
                        item["name"],
                        *item["aliases"],
                        *item["systems"],
                        *item["branches"],
                        item.get("location", ""),
                    ]
                )
            )
        return records

    def _build_pipeline_catalog(self, conn: sqlite3.Connection) -> list[dict[str, Any]]:
        pipeline_map: dict[str, dict[str, Any]] = {}

        trunk_rows = conn.execute('SELECT * FROM "sheet_干线管道" ORDER BY "_row_number"').fetchall()
        for row in trunk_rows:
            payload = dict(row)
            name = _to_text(payload.get("干线管道"))
            if not name:
                continue
            pipeline_map[f"trunk||{_normalize_text(name)}"] = {
                "name": name,
                "kind": "trunk",
                "scope_name": name,
                "trunk_name": name,
                "start_station": "",
                "end_station": "",
                "length_km": _to_float(payload.get("长度")),
                "design_pressure_mpa": None,
                "diameter_mm": None,
                "station_count": _to_float(payload.get("站场")),
                "compressor_station_count": _to_float(payload.get("压气站")),
                "distribution_station_count": _to_float(payload.get("分输站")),
                "aliases": self._build_scope_aliases(name, []),
            }

        branch_rows = conn.execute('SELECT * FROM "sheet_支线管道" ORDER BY "_row_number"').fetchall()
        for row in branch_rows:
            payload = dict(row)
            name = _to_text(payload.get("原始_支线管道"))
            trunk_name = _to_text(payload.get("关联_干线管道"))
            if not name:
                continue
            branch_aliases = self._build_branch_aliases(name)
            pipeline_map[f"branch||{_normalize_text(name)}||{_normalize_text(trunk_name)}"] = {
                "name": name,
                "kind": "branch",
                "scope_name": trunk_name or name,
                "trunk_name": trunk_name,
                "start_station": _clean_station_name(payload.get("原始_起点")),
                "end_station": _clean_station_name(payload.get("原始_终点")),
                "length_km": _to_float(payload.get("计算_长度_km")),
                "design_pressure_mpa": _to_float(payload.get("原始_设计压力_mpa")),
                "diameter_mm": _to_float(payload.get("原始_管径_mm")),
                "station_count": None,
                "compressor_station_count": None,
                "distribution_station_count": None,
                "aliases": _unique_sorted({name, *branch_aliases}),
            }

        records = sorted(
            pipeline_map.values(),
            key=lambda item: (
                item.get("scope_name", ""),
                0 if item.get("kind") == "trunk" else 1,
                item.get("name", ""),
            ),
        )
        for index, item in enumerate(records, start=1):
            item["id"] = f"RAW-PL-{index:04d}"
            item["aliases"] = _unique_sorted(item["aliases"])
            item["search_text"] = _normalize_text(
                " ".join(
                    [
                        item["name"],
                        *item["aliases"],
                        item.get("scope_name", ""),
                        item.get("trunk_name", ""),
                        item.get("start_station", ""),
                        item.get("end_station", ""),
                    ]
                )
            )
        return records

    def _build_system_aliases(
        self,
        stations: list[dict[str, Any]],
        pipelines: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        system_map: dict[str, dict[str, Any]] = {}
        for pipeline in pipelines:
            scope_name = _to_text(pipeline.get("scope_name") or pipeline.get("trunk_name"))
            if not scope_name:
                continue
            aliases = set(self._build_scope_aliases(scope_name, pipeline.get("aliases", [])))
            item = system_map.setdefault(
                scope_name,
                {
                    "name": scope_name,
                    "aliases": set(),
                    "branch_names": set(),
                },
            )
            item["aliases"].update(aliases)
            if pipeline.get("kind") == "branch":
                item["branch_names"].add(_to_text(pipeline.get("name")))

        for station in stations:
            for scope_name in station.get("systems", []):
                if not scope_name:
                    continue
                item = system_map.setdefault(
                    scope_name,
                    {
                        "name": scope_name,
                        "aliases": set(),
                        "branch_names": set(),
                    },
                )
                item["aliases"].update(self._build_scope_aliases(scope_name, station.get("branches", [])))

        records = sorted(system_map.values(), key=lambda item: _natural_sort_key(item["name"]))
        for item in records:
            item["branch_names"] = _unique_sorted(item["branch_names"])
            item["aliases"] = _unique_sorted(item["aliases"] | set(item["branch_names"]))
        return records

    def _build_distribution_catalog(self, conn: sqlite3.Connection) -> list[dict[str, Any]]:
        """从 sheet_分输口 构建分输口（用户/下载点/下载用户）目录。"""
        rows = conn.execute('SELECT * FROM "sheet_分输口" ORDER BY "_row_number"').fetchall()
        dist_map: dict[str, dict[str, Any]] = {}
        for row in rows:
            payload = dict(row)
            raw_name = _to_text(payload.get("原始__分输口"))
            auto_name = _to_text(payload.get("原始__自动分输"))
            station_abbr = _to_text(payload.get("关联_站场简称"))
            trunk_name = _to_text(payload.get("关联__干线管道"))
            dispatch = _to_text(payload.get("关联_调度台"))
            note = _to_text(payload.get("备注"))
            pressure = _to_text(payload.get("用户合同接气压力_mpa"))
            commission_date = _to_text(payload.get("投产时间"))
            open_type = _to_text(payload.get("原始_站场_阀室_干线开口"))
            metering = _to_text(payload.get("站场计量设备情况"))
            pressure_reg = _to_text(payload.get("站场调压设备情况"))

            name = raw_name or auto_name or station_abbr
            if not name:
                continue

            key = _normalize_text(name) + "||" + _normalize_text(trunk_name)
            record = dist_map.setdefault(key, {
                "name": name,
                "trunk_name": trunk_name,
                "station_abbr": station_abbr,
                "dispatch_console": dispatch,
                "open_type": open_type,
                "contract_pressure_mpa": pressure,
                "metering_info": metering,
                "pressure_reg_info": pressure_reg,
                "commission_date": commission_date,
                "note": note,
                "aliases": set(),
            })
            record["aliases"].update(filter(None, [raw_name, auto_name, station_abbr]))

        records = sorted(dist_map.values(), key=lambda item: (item.get("trunk_name", ""), item.get("name", "")))
        for index, item in enumerate(records, start=1):
            item["id"] = f"RAW-DP-{index:04d}"
            item["aliases"] = _unique_sorted(item["aliases"])
            # search_text 支持「用户」「下载点」「下载用户」「分输点」「分输口」等别名命中
            item["search_text"] = _normalize_text(
                " ".join(filter(None, [
                    item["name"],
                    *item["aliases"],
                    item["trunk_name"],
                    item["station_abbr"],
                    item["dispatch_console"],
                ]))
            )
        return records

    def _build_compressor_map(self, conn: sqlite3.Connection) -> dict[tuple[str, str], dict[str, Any]]:
        compressor_map: dict[tuple[str, str], dict[str, Any]] = {}
        rows = conn.execute('SELECT * FROM "sheet_压缩机" ORDER BY "_row_number"').fetchall()
        for row in rows:
            payload = dict(row)
            station_name = _clean_station_name(payload.get("关联_站场"))
            trunk_name = _to_text(payload.get("计算_干线管道"))
            if not station_name:
                continue
            key = (_normalize_text(station_name), _normalize_text(trunk_name))
            item = compressor_map.setdefault(key, {"configs": set(), "unit_count": 0})
            config = _to_text(payload.get("原始_机组配置"))
            unit_no = _to_text(payload.get("原始_压缩机组编号"))
            if config:
                item["configs"].add(config)
            if unit_no:
                item["unit_count"] += 1
        return compressor_map

    def _build_scope_aliases(self, scope_name: str, extra_aliases: list[str] | set[str]) -> list[str]:
        aliases = {scope_name, _root_station_name(scope_name)}
        aliases.update(extra_aliases)
        aliases.update(SCOPE_ALIAS_OVERRIDES.get(scope_name, set()))
        if scope_name.endswith("线"):
            aliases.add(scope_name.replace("一线", "1线").replace("二线", "2线").replace("三线", "3线").replace("四线", "4线"))
        for alias in list(aliases):
            if alias.endswith("干线"):
                aliases.add(alias[:-2])
        return _unique_sorted(aliases)

    def _build_branch_aliases(self, branch_name: str) -> list[str]:
        aliases = {branch_name}
        branch_key = _to_text(branch_name)
        if "干线" in branch_key:
            aliases.add(branch_key.split("干线", 1)[0])
        if "支线" in branch_key:
            aliases.add(branch_key.split("支线", 1)[0])
        return _unique_sorted(aliases)

    def _station_matches_scope(self, station: dict[str, Any], scope_name: str) -> bool:
        scope_key = _normalize_text(scope_name)
        if not scope_key:
            return True
        return any(_normalize_text(item) == scope_key for item in station.get("systems", []))

    def _pipeline_matches_scope(self, pipeline: dict[str, Any], scope_name: str) -> bool:
        scope_key = _normalize_text(scope_name)
        if not scope_key:
            return True
        return scope_key in {
            _normalize_text(pipeline.get("scope_name", "")),
            _normalize_text(pipeline.get("trunk_name", "")),
        }


raw_excel_ai_index = RawExcelAiIndex()
