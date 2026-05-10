import json
import logging
import re
from typing import Any, Dict, List, Set

from sqlalchemy import text
from sqlmodel import Session, select

from app.models import JunctionGroup


JUNCTION_ID_PATTERN = re.compile(r'^(?:JUNCTION|junction)-(\d+)$')
MANUAL_OVERLAY_FLAG = "manual_overlay=1"
MANUAL_OVERLAY_SOURCE_KEY = "manual_overlay_source"
LEGACY_MANUAL_OVERLAY_TAG = "manual_overlay"
MAX_MANUAL_OVERLAY_SPAN_DEG = 0.5

logger = logging.getLogger(__name__)

# 运行时枢纽白名单：只保留这些站点作为枢纽候选。
# 说明：部分站点在库里存在别名或实际名称略有差异，所以这里保留多个匹配词。
HUB_WHITE_LIST_RULES: List[Dict[str, Any]] = [
    {"label": "霍尔果斯压气站", "patterns": ["霍尔果斯压气站"]},
    {"label": "轮南压气站", "patterns": ["轮南压气站"]},
    {"label": "中卫压气站", "patterns": ["中卫压气站"]},
    {"label": "靖边压气站", "patterns": ["西一靖边压气站", "陕京靖边首站"]},
    {"label": "榆林压气站", "patterns": ["榆林压气站"]},
    {"label": "安平压气站", "patterns": ["安平压气站"]},
    {"label": "永清压气站", "patterns": ["永清压气站"]},
    {"label": "黑河压气站", "patterns": ["黑河压气站"]},
    {"label": "贵阳压气站", "patterns": ["贵阳压气站"]},
    {"label": "瑞丽", "patterns": ["瑞丽分输站"]},
    {"label": "广州压气站", "patterns": ["广州压气站"]},
    {"label": "贵港压气站", "patterns": ["贵港压气站"]},
    {"label": "南昌压气站", "patterns": ["南昌压气站"]},
    {"label": "平顶山压气站", "patterns": ["平顶山分输站"]},
    {"label": "薛店", "patterns": ["薛店分输站"]},
    {"label": "泰安压气站", "patterns": ["泰安压气站"]},
    {"label": "甪直联络站", "patterns": ["甪直分输站", "甪直联络站"]},
    {"label": "嘉兴", "patterns": ["嘉兴分输站"]},
]


def _parse_station_ids(raw_value: str | None) -> List[str]:
    if not raw_value:
        return []
    try:
        parsed = json.loads(raw_value)
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    except Exception:
        pass
    return []


def _extract_junction_ref_id(raw_id: str) -> int | None:
    match = JUNCTION_ID_PATTERN.match(str(raw_id))
    return int(match.group(1)) if match else None


def _dedupe_keep_order(values: List[str]) -> List[str]:
    seen: Set[str] = set()
    result: List[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _station_name_matches(name: str, patterns: List[str]) -> bool:
    text = (name or "").strip()
    if not text:
        return False
    for pattern in patterns:
        candidate = (pattern or "").strip()
        if not candidate:
            continue
        if candidate == text or candidate in text:
            return True
    return False


def _normalize_group_name(name: str | None, fallback_station_ids: List[str]) -> str:
    raw_name = (name or "").strip()
    if not raw_name:
        return f"联合枢纽-{len(fallback_station_ids)}"

    parts = [part.strip() for part in raw_name.split("-") if part.strip()]
    deduped_parts: List[str] = []
    for part in parts:
        if part not in deduped_parts:
            deduped_parts.append(part)

    normalized = "-".join(deduped_parts) if deduped_parts else raw_name
    return normalized or f"联合枢纽-{len(fallback_station_ids)}"


def _derive_system_id(station_id: str) -> str:
    parts = str(station_id).split("-")
    if len(parts) >= 2 and parts[1].startswith("B"):
        prefix = f"{parts[0]}-{parts[1]}"
    else:
        prefix = parts[0] if parts else str(station_id)
    return prefix.lower()


def _table_exists(session: Session, table_name: str) -> bool:
    row = session.connection().execute(
        text("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name"),
        {"name": table_name},
    ).first()
    return row is not None


def _load_station_snapshots(session: Session) -> Dict[str, Dict[str, Any]]:
    rows = session.connection().execute(
        text("SELECT id, name, longitude, latitude FROM stations")
    ).mappings().all()
    return {
        str(row["id"]): {
            "id": str(row["id"]),
            "name": str(row["name"] or row["id"]),
            "longitude": float(row["longitude"]),
            "latitude": float(row["latitude"]),
        }
        for row in rows
    }


def _load_rebuilt_group_station_map(session: Session) -> Dict[int, List[str]]:
    if not _table_exists(session, "junction_groups_rebuilt"):
        return {}

    rows = session.connection().execute(
        text("SELECT id, station_ids FROM junction_groups_rebuilt")
    ).mappings().all()
    return {
        int(row["id"]): _parse_station_ids(row["station_ids"])
        for row in rows
        if row["id"] is not None
    }


def _decorate_runtime_fields(group: Dict[str, Any]) -> Dict[str, Any]:
    station_ids = _dedupe_keep_order([str(item) for item in group.get("station_ids", []) if str(item).strip()])
    system_ids = sorted({_derive_system_id(station_id) for station_id in station_ids})

    runtime_group = dict(group)
    runtime_group["station_ids"] = station_ids
    runtime_group["system_ids"] = system_ids
    runtime_group["member_count"] = len(station_ids)
    explicit_kind = str(runtime_group.get("junction_kind") or "").strip()
    if explicit_kind not in {"junction", "major_junction"}:
        runtime_group["junction_kind"] = (
            "major_junction" if len(system_ids) >= 3 else "junction" if len(system_ids) >= 2 else "junction"
        )
    runtime_group["source_table"] = runtime_group.get("source_table", "junction_groups")
    return runtime_group


def _load_whitelist_junction_groups(session: Session) -> List[Dict[str, Any]]:
    rows = session.connection().execute(
        text("SELECT id, name, type FROM stations")
    ).mappings().all()
    if not rows:
        return []

    matched_groups: List[Dict[str, Any]] = []
    used_station_ids: Set[str] = set()
    synthetic_id = 1000

    for rule in HUB_WHITE_LIST_RULES:
        patterns = [str(item) for item in rule.get("patterns", []) if str(item).strip()]
        if not patterns:
            continue

        matched_station_ids = []
        matched_names = []
        for row in rows:
            station_id = str(row["id"])
            station_name = str(row["name"] or station_id)
            if station_id in used_station_ids:
                continue
            if not _station_name_matches(station_name, patterns):
                continue
            matched_station_ids.append(station_id)
            matched_names.append(station_name)

        if not matched_station_ids:
            continue

        used_station_ids.update(matched_station_ids)
        synthetic_id += 1
        matched_groups.append(
            _decorate_runtime_fields(
                {
                    "id": synthetic_id,
                    "name": str(rule.get("label") or matched_names[0]),
                    "description": "hub_whitelist=1",
                    "station_ids": matched_station_ids,
                    "raw_group_ids": [],
                    "junction_kind": "major_junction" if len(matched_station_ids) >= 3 else "junction",
                    "source_table": "junction_groups_whitelist",
                }
            )
        )

    return sorted(matched_groups, key=lambda item: item["id"])


def _parse_description_tokens(description: str | None) -> List[str]:
    return [token.strip() for token in str(description or "").split(";") if token.strip()]


def is_manual_overlay_group(description: str | None) -> bool:
    tokens = _parse_description_tokens(description)
    for token in tokens:
        lower_token = token.lower()
        if lower_token == LEGACY_MANUAL_OVERLAY_TAG:
            return True
        if lower_token.startswith("manual_overlay="):
            value = lower_token.split("=", 1)[1].strip()
            return value in {"1", "true", "yes", "on"}
    return False


def build_manual_overlay_description(description: str | None = None, source: str = "manual_create") -> str:
    base_tokens = []
    for token in _parse_description_tokens(description):
        lower_token = token.lower()
        if lower_token == LEGACY_MANUAL_OVERLAY_TAG:
            continue
        if lower_token.startswith("manual_overlay="):
            continue
        if lower_token.startswith(f"{MANUAL_OVERLAY_SOURCE_KEY}="):
            continue
        base_tokens.append(token)
    base_tokens.append(MANUAL_OVERLAY_FLAG)
    base_tokens.append(f"{MANUAL_OVERLAY_SOURCE_KEY}={source}")
    return ";".join(base_tokens)


def validate_manual_overlay_station_span(
    session: Session,
    station_ids: List[str],
    max_span_deg: float = MAX_MANUAL_OVERLAY_SPAN_DEG,
) -> str | None:
    station_map = _load_station_snapshots(session)
    members = [
        station_map[station_id]
        for station_id in _dedupe_keep_order([str(item) for item in station_ids if str(item).strip()])
        if station_id in station_map
    ]
    if len(members) < 2:
        return None

    lng_values = [member["longitude"] for member in members]
    lat_values = [member["latitude"] for member in members]
    span_lng = max(lng_values) - min(lng_values)
    span_lat = max(lat_values) - min(lat_values)
    if span_lng <= max_span_deg and span_lat <= max_span_deg:
        return None

    member_names = "、".join(member["name"] for member in members[:3])
    if len(members) > 3:
        member_names += "等"
    return (
        f"选中的站点相距过远，不能合并成同一个枢纽：{member_names}"
        f"（经度跨度 {span_lng:.3f}°，纬度跨度 {span_lat:.3f}°）"
    )


def _expand_station_ids(
    station_ids: List[str],
    raw_group_map: Dict[int, Dict[str, Any]],
    rebuilt_group_map: Dict[int, List[str]] | None = None,
    visiting: Set[int] | None = None,
) -> List[str]:
    rebuilt_group_map = rebuilt_group_map or {}
    visiting = visiting or set()
    expanded: List[str] = []

    for station_id in station_ids:
        junction_ref = _extract_junction_ref_id(station_id)
        if junction_ref is None:
            expanded.append(station_id)
            continue

        if junction_ref in raw_group_map:
            if junction_ref in visiting:
                continue

            visiting.add(junction_ref)
            expanded.extend(
                _expand_station_ids(
                    raw_group_map[junction_ref]["station_ids"],
                    raw_group_map,
                    rebuilt_group_map,
                    visiting,
                )
            )
            visiting.remove(junction_ref)
            continue

        if junction_ref in rebuilt_group_map:
            expanded.extend(rebuilt_group_map[junction_ref])
            continue

        expanded.append(station_id)

    return _dedupe_keep_order(expanded)


def load_normalized_junction_groups(session: Session) -> List[Dict[str, Any]]:
    """
    读取并归一化 junction_groups：
    1. 展开 JUNCTION-x / junction-x 引用
    2. 自动合并存在站点交集的重叠枢纽（例如“枢纽套枢纽”）
    3. 使用最新创建的 group（最大 id）作为组件代表
    """
    raw_groups = session.exec(select(JunctionGroup).order_by(JunctionGroup.id)).all()
    if not raw_groups:
        return []

    raw_group_map: Dict[int, Dict[str, Any]] = {
        group.id: {
            "id": group.id,
            "name": group.name,
            "description": group.description,
            "station_ids": _parse_station_ids(group.station_ids),
        }
        for group in raw_groups
        if group.id is not None
    }

    expanded_groups: List[Dict[str, Any]] = []
    for group in raw_groups:
        if group.id is None:
            continue
        expanded_station_ids = _expand_station_ids(raw_group_map[group.id]["station_ids"], raw_group_map, {group.id})
        if not expanded_station_ids:
            continue
        expanded_groups.append({
            "id": group.id,
            "name": group.name,
            "description": group.description,
            "station_ids": expanded_station_ids,
            "raw_group_ids": [group.id],
        })

    if not expanded_groups:
        return []

    adjacency: Dict[int, Set[int]] = {group["id"]: set() for group in expanded_groups}
    station_to_groups: Dict[str, Set[int]] = {}
    for group in expanded_groups:
        for station_id in group["station_ids"]:
            station_to_groups.setdefault(station_id, set()).add(group["id"])

    for related_groups in station_to_groups.values():
        related_list = list(related_groups)
        for group_id in related_list:
            adjacency[group_id].update(other for other in related_list if other != group_id)

    group_by_id = {group["id"]: group for group in expanded_groups}
    visited: Set[int] = set()
    normalized: List[Dict[str, Any]] = []

    for group in expanded_groups:
        group_id = group["id"]
        if group_id in visited:
            continue

        stack = [group_id]
        component_ids: List[int] = []
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            component_ids.append(current)
            stack.extend(adjacency[current] - visited)

        component_groups = [group_by_id[item_id] for item_id in component_ids]
        representative = max(component_groups, key=lambda item: item["id"])
        merged_station_ids: List[str] = []
        raw_group_ids: List[int] = []
        for item in sorted(component_groups, key=lambda comp: comp["id"]):
            merged_station_ids.extend(item["station_ids"])
            raw_group_ids.extend(item["raw_group_ids"])

        normalized.append({
            "id": representative["id"],
            "name": _normalize_group_name(representative["name"], merged_station_ids),
            "description": representative.get("description"),
            "station_ids": _dedupe_keep_order(merged_station_ids),
            "raw_group_ids": sorted(set(raw_group_ids)),
            "source_table": "junction_groups",
        })

    return [
        _decorate_runtime_fields(item)
        for item in sorted(normalized, key=lambda item: item["id"])
    ]


def load_rebuilt_junction_groups(session: Session) -> List[Dict[str, Any]]:
    """
    读取影子表 junction_groups_rebuilt。
    这张表是按新规则重编后的事实层，优先供 topology / pipeline-packages / scada 消费。
    """
    if not _table_exists(session, "junction_groups_rebuilt"):
        return []

    rows = session.connection().execute(
        text(
            """
            SELECT id, name, description, station_ids, junction_kind, system_ids, member_count, tolerance_deg, generated_at
            FROM junction_groups_rebuilt
            ORDER BY id
            """
        )
    ).mappings().all()

    rebuilt_groups: List[Dict[str, Any]] = []
    for row in rows:
        station_ids = _parse_station_ids(row["station_ids"])
        try:
            system_ids = json.loads(row["system_ids"]) if row["system_ids"] else []
        except Exception:
            system_ids = []
        rebuilt_groups.append({
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "station_ids": _dedupe_keep_order(station_ids),
            "raw_group_ids": [],
            "junction_kind": str(row["junction_kind"] or "junction"),
            "system_ids": [str(item) for item in system_ids],
            "member_count": int(row["member_count"] or len(station_ids)),
            "tolerance_deg": row["tolerance_deg"],
            "generated_at": row["generated_at"],
            "source_table": "junction_groups_rebuilt",
        })
    return rebuilt_groups


def load_manual_overlay_junction_groups(session: Session) -> List[Dict[str, Any]]:
    """
    读取手工捏合覆盖层。
    这层只接收带 manual_overlay 标记的记录，避免把整张旧表重新拉回运行时主链路。
    """
    raw_groups = session.exec(select(JunctionGroup).order_by(JunctionGroup.id)).all()
    if not raw_groups:
        return []

    raw_group_map: Dict[int, Dict[str, Any]] = {
        group.id: {
            "id": group.id,
            "station_ids": _parse_station_ids(group.station_ids),
        }
        for group in raw_groups
        if group.id is not None
    }
    rebuilt_group_map = _load_rebuilt_group_station_map(session)

    existing_station_ids = {
        str(row["id"])
        for row in session.connection().execute(text("SELECT id FROM stations")).mappings().all()
    }

    manual_groups_desc: List[Dict[str, Any]] = []
    for group in sorted(raw_groups, key=lambda item: item.id or 0, reverse=True):
        if group.id is None or not is_manual_overlay_group(group.description):
            continue

        expanded_station_ids = _expand_station_ids(
            raw_group_map.get(group.id, {}).get("station_ids", []),
            raw_group_map,
            rebuilt_group_map,
            {group.id},
        )
        valid_station_ids = [
            station_id
            for station_id in expanded_station_ids
            if station_id in existing_station_ids
        ]
        if len(valid_station_ids) < 2:
            continue

        span_error = validate_manual_overlay_station_span(session, valid_station_ids)
        if span_error:
            logger.warning(
                "Skip invalid manual overlay junction group id=%s name=%s: %s; station_ids=%s",
                group.id,
                group.name,
                span_error,
                valid_station_ids,
            )
            continue

        manual_groups_desc.append(
            _decorate_runtime_fields(
                {
                    "id": group.id,
                    "name": _normalize_group_name(group.name, valid_station_ids),
                    "description": group.description,
                    "station_ids": valid_station_ids,
                    "raw_group_ids": [group.id],
                    "source_table": "junction_groups_manual_overlay",
                }
            )
        )

    # manual overlay 互相冲突时采用“最新优先”，避免同一批站点重复出现。
    selected_groups_desc: List[Dict[str, Any]] = []
    occupied_station_ids: Set[str] = set()
    for group in manual_groups_desc:
        station_ids = set(str(item) for item in group.get("station_ids", []))
        if occupied_station_ids.intersection(station_ids):
            continue
        selected_groups_desc.append(group)
        occupied_station_ids.update(station_ids)

    return sorted(selected_groups_desc, key=lambda item: item["id"])


def find_conflicting_manual_overlay_groups(session: Session, station_ids: List[str]) -> List[Dict[str, Any]]:
    requested_ids = set(_dedupe_keep_order([str(item) for item in station_ids if str(item).strip()]))
    if not requested_ids:
        return []
    return [
        group
        for group in load_manual_overlay_junction_groups(session)
        if requested_ids.intersection(group.get("station_ids", []))
    ]


def load_runtime_junction_groups(session: Session) -> List[Dict[str, Any]]:
    """
    运行时枢纽入口：
    - 优先按枢纽白名单从 stations 表重建运行时枢纽
    - 若白名单无法解析，再回退到影子表 / 旧表兼容层
    """
    whitelist_groups = _load_whitelist_junction_groups(session)
    if whitelist_groups:
        return whitelist_groups

    manual_groups = load_manual_overlay_junction_groups(session)
    base_groups = load_rebuilt_junction_groups(session)
    if not base_groups:
        base_groups = load_normalized_junction_groups(session)
    if not manual_groups:
        return base_groups

    overridden_station_ids = {
        station_id
        for group in manual_groups
        for station_id in group.get("station_ids", [])
    }
    filtered_base_groups = [
        group
        for group in base_groups
        if not overridden_station_ids.intersection(group.get("station_ids", []))
    ]
    return sorted(
        [*filtered_base_groups, *manual_groups],
        key=lambda item: (
            0 if item.get("source_table") == "junction_groups_rebuilt" else 1,
            item["id"],
        ),
    )


def expand_station_ids_for_request(session: Session, station_ids: List[str]) -> List[str]:
    """
    将请求里带有 JUNCTION-x / junction-x 的 id 展开为底层真实站点 id。
    """
    raw_groups = session.exec(select(JunctionGroup).order_by(JunctionGroup.id)).all()
    raw_group_map: Dict[int, Dict[str, Any]] = {
        group.id: {
            "id": group.id,
            "station_ids": _parse_station_ids(group.station_ids),
        }
        for group in raw_groups
        if group.id is not None
    }
    rebuilt_group_map = _load_rebuilt_group_station_map(session)
    return _expand_station_ids([str(item) for item in station_ids], raw_group_map, rebuilt_group_map)
