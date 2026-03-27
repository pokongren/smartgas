import json
import re
from typing import Any, Dict, List, Set

from sqlmodel import Session, select

from app.models import JunctionGroup


JUNCTION_ID_PATTERN = re.compile(r'^(?:JUNCTION|junction)-(\d+)$')


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


def _expand_station_ids(
    station_ids: List[str],
    raw_group_map: Dict[int, Dict[str, Any]],
    visiting: Set[int] | None = None,
) -> List[str]:
    visiting = visiting or set()
    expanded: List[str] = []

    for station_id in station_ids:
        junction_ref = _extract_junction_ref_id(station_id)
        if junction_ref is None or junction_ref not in raw_group_map:
            expanded.append(station_id)
            continue

        if junction_ref in visiting:
            continue

        visiting.add(junction_ref)
        expanded.extend(
            _expand_station_ids(raw_group_map[junction_ref]["station_ids"], raw_group_map, visiting)
        )
        visiting.remove(junction_ref)

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
        })

    return sorted(normalized, key=lambda item: item["id"])


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
    return _expand_station_ids([str(item) for item in station_ids], raw_group_map)
