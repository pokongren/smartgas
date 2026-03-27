import math
from dataclasses import dataclass
import json
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from sqlmodel import Session, select

from app.models import Pipeline, Station


@dataclass
class SegmentPath:
    start_id: str
    end_id: str
    valve_ids: List[str]
    path_ids: List[str]


def _distance_meters(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    dx = (b[0] - a[0]) * 100000
    dy = (b[1] - a[1]) * 111000
    return math.sqrt(dx * dx + dy * dy)


def _layer_key_from_station_id(station_id: str) -> str:
    parts = station_id.split("-")
    if len(parts) >= 3 and parts[1].startswith("B"):
        return f"{parts[0]}-{parts[1]}"
    return parts[0] if parts else station_id


def _parse_properties(raw_value: Optional[str]) -> Dict[str, Any]:
    if not raw_value:
        return {}
    try:
        parsed = json.loads(raw_value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _dump_properties(data: Dict[str, Any]) -> Optional[str]:
    if not data:
        return None
    return json.dumps(data, ensure_ascii=False)


class PositionCommitService:
    def __init__(self, session: Session):
        self.session = session
        self.stations: Dict[str, Station] = {
            station.id: station
            for station in session.exec(select(Station)).all()
        }
        self.pipelines: List[Pipeline] = session.exec(select(Pipeline)).all()
        self.adjacency: Dict[str, Set[str]] = {station_id: set() for station_id in self.stations}
        for pipeline in self.pipelines:
            if pipeline.start_station_id not in self.stations or pipeline.end_station_id not in self.stations:
                continue
            self.adjacency[pipeline.start_station_id].add(pipeline.end_station_id)
            self.adjacency[pipeline.end_station_id].add(pipeline.start_station_id)

    def commit(
        self,
        updates: Iterable[Dict[str, Any]],
        cascade_valves: bool = True,
        cascade_scope: str = "segment",
        preview_only: bool = False,
    ) -> Dict[str, Any]:
        normalized_updates: Dict[str, Tuple[float, float]] = {}
        errors: List[Dict[str, Any]] = []
        for item in updates:
            station_id = str(item.get("id", "")).strip()
            if not station_id:
                errors.append({"id": None, "error": "缺少站点ID"})
                continue
            try:
                longitude = float(item["longitude"])
                latitude = float(item["latitude"])
            except Exception:
                errors.append({"id": station_id, "error": "坐标格式错误"})
                continue
            normalized_updates[station_id] = (longitude, latitude)

        original_coords: Dict[str, Tuple[float, float]] = {
            station_id: (station.longitude, station.latitude)
            for station_id, station in self.stations.items()
        }

        updated_station_ids: List[str] = []
        updated_valve_ids: List[str] = []
        affected_layers: Set[str] = set()
        impacted_segments: List[Dict[str, Any]] = []

        for station_id, (longitude, latitude) in normalized_updates.items():
            station = self.stations.get(station_id)
            if not station:
                errors.append({"id": station_id, "error": "站点不存在"})
                continue
            station.longitude = longitude
            station.latitude = latitude
            updated_station_ids.append(station_id)
            affected_layers.add(_layer_key_from_station_id(station_id))

            properties = _parse_properties(station.properties)
            position_meta = properties.get("positionMeta", {})
            position_meta.update({
                "mode": "manual",
                "locked": station.type == "valve",
                "lastSource": "map-topology",
            })
            properties["positionMeta"] = position_meta
            station.properties = _dump_properties(properties)

        if cascade_valves and cascade_scope != "none":
            processed_segments: Set[Tuple[str, ...]] = set()
            for station_id in updated_station_ids:
                station = self.stations.get(station_id)
                if not station or station.type == "valve":
                    continue
                for segment in self._find_segments_for_station(station_id):
                    segment_key = min(tuple(segment.path_ids), tuple(reversed(segment.path_ids)))
                    if segment_key in processed_segments:
                        continue
                    processed_segments.add(segment_key)
                    changed_valves = self._apply_segment_reprojection(
                        segment=segment,
                        original_coords=original_coords,
                        manual_updates=normalized_updates,
                    )
                    if not changed_valves:
                        continue
                    impacted_segments.append({
                        "start_id": segment.start_id,
                        "end_id": segment.end_id,
                        "valve_ids": changed_valves,
                    })
                    updated_valve_ids.extend(changed_valves)
                    for valve_id in changed_valves:
                        affected_layers.add(_layer_key_from_station_id(valve_id))

        if preview_only:
            self.session.rollback()
        else:
            self.session.commit()

        return {
            "updated_station_ids": updated_station_ids,
            "updated_valve_ids": sorted(set(updated_valve_ids)),
            "affected_layers": sorted(affected_layers),
            "impacted_segments": impacted_segments,
            "errors": errors,
            "preview_only": preview_only,
        }

    def _find_segments_for_station(self, station_id: str) -> List[SegmentPath]:
        segments: List[SegmentPath] = []
        for neighbor_id in self.adjacency.get(station_id, set()):
            segment = self._walk_segment(start_id=station_id, neighbor_id=neighbor_id)
            if segment and segment.valve_ids:
                segments.append(segment)
        return segments

    def _walk_segment(self, start_id: str, neighbor_id: str) -> Optional[SegmentPath]:
        prev_id = start_id
        current_id = neighbor_id
        valve_ids: List[str] = []
        path_ids: List[str] = [start_id]
        visited: Set[str] = {start_id}

        while True:
            if current_id in visited:
                return None
            current_station = self.stations.get(current_id)
            if not current_station:
                return None

            visited.add(current_id)
            path_ids.append(current_id)

            if current_station.type != "valve":
                return SegmentPath(
                    start_id=start_id,
                    end_id=current_id,
                    valve_ids=valve_ids,
                    path_ids=path_ids,
                )

            valve_ids.append(current_id)
            next_candidates = [candidate for candidate in self.adjacency.get(current_id, set()) if candidate != prev_id]
            if not next_candidates:
                return None

            if len(next_candidates) == 1:
                next_id = next_candidates[0]
            else:
                non_valves = [candidate for candidate in next_candidates if self.stations.get(candidate) and self.stations[candidate].type != "valve"]
                if len(non_valves) == 1:
                    next_id = non_valves[0]
                else:
                    return None

            prev_id, current_id = current_id, next_id

    def _apply_segment_reprojection(
        self,
        segment: SegmentPath,
        original_coords: Dict[str, Tuple[float, float]],
        manual_updates: Dict[str, Tuple[float, float]],
    ) -> List[str]:
        if not segment.valve_ids:
            return []

        start_station = self.stations.get(segment.start_id)
        end_station = self.stations.get(segment.end_id)
        if not start_station or not end_station:
            return []

        path_coords_before = [original_coords.get(node_id) for node_id in segment.path_ids]
        if any(item is None for item in path_coords_before):
            return []
        path_coords_before = [item for item in path_coords_before if item is not None]

        step_lengths: List[float] = []
        total_length = 0.0
        for index in range(len(path_coords_before) - 1):
            step_length = _distance_meters(path_coords_before[index], path_coords_before[index + 1])
            step_lengths.append(step_length)
            total_length += step_length

        ratios: Dict[str, float] = {}
        cumulative = 0.0
        for index, node_id in enumerate(segment.path_ids[1:-1], start=1):
            cumulative += step_lengths[index - 1]
            if node_id not in segment.valve_ids:
                continue
            if total_length > 0:
                ratios[node_id] = cumulative / total_length

        if not ratios:
            divisor = len(segment.valve_ids) + 1
            ratios = {
                valve_id: (index + 1) / divisor
                for index, valve_id in enumerate(segment.valve_ids)
            }

        start_new = manual_updates.get(segment.start_id, (start_station.longitude, start_station.latitude))
        end_new = manual_updates.get(segment.end_id, (end_station.longitude, end_station.latitude))

        updated_valve_ids: List[str] = []
        for index, valve_id in enumerate(segment.valve_ids):
            if valve_id in manual_updates:
                continue
            valve_station = self.stations.get(valve_id)
            if not valve_station:
                continue

            properties = _parse_properties(valve_station.properties)
            position_meta = properties.get("positionMeta", {})
            if position_meta.get("locked"):
                continue

            ratio = ratios.get(valve_id, (index + 1) / (len(segment.valve_ids) + 1))
            valve_station.longitude = start_new[0] + (end_new[0] - start_new[0]) * ratio
            valve_station.latitude = start_new[1] + (end_new[1] - start_new[1]) * ratio

            position_meta.update({
                "mode": "auto",
                "locked": False,
                "segmentStartId": segment.start_id,
                "segmentEndId": segment.end_id,
                "ratio": ratio,
                "lastSource": "segment-reproject",
            })
            properties["positionMeta"] = position_meta
            valve_station.properties = _dump_properties(properties)
            updated_valve_ids.append(valve_id)

        return updated_valve_ids
