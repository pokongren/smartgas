"""WE1 database alignment helpers for AI, topology, pressure, and simulation facts.

This module is intentionally read-only. It does not mutate the source databases.
It gives AI tools one shared place to answer: which object is this, where did the
pressure come from, and whether a flow value is measured or simulated.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime
from typing import Any, Iterable, Optional

from sqlmodel import Session, select

from app.database import scada_history_engine
from app.models import Pipeline, Station
from app.scada_models import ScadaHistory
from app.services.we1_result_snapshot_service import get_snapshot, list_snapshots


WE1_SCOPE = "we1"
WE1_PILOT_ID = "mainline_zhongwei_jingbian"

WE1_SAMPLE_STATIONS: dict[str, dict[str, Any]] = {
    "zhongwei": {
        "station_id": "WE1-76",
        "station_name": "中卫压气站",
        "scada_station_id": "WE1-ZHONGWEI",
        "scada_station_name": "中卫压气站",
        "aliases": ["中卫", "中卫压气站", "WE1-76", "WE1-ZHONGWEI"],
        "note": "中卫是 WE1 样板站，也是跨系统枢纽，需要按 scope 控制是否纳入 WE2 和中贵线。",
    },
    "yanchi": {
        "station_id": "WE1-86",
        "station_name": "西一盐池压气站",
        "scada_station_id": None,
        "scada_station_name": None,
        "aliases": ["盐池", "西一盐池", "西一盐池压气站", "WE1-86"],
        "note": "当前 SCADA 历史库未命中盐池，压力优先取站点静态运行压力。",
    },
    "jingbian": {
        "station_id": "WE1-92",
        "station_name": "西一靖边压气站",
        "scada_station_id": None,
        "scada_station_name": None,
        "aliases": ["靖边", "西一靖边", "西一靖边压气站", "WE1-92"],
        "note": "不要把 junction_groups_rebuilt 里的 SJ2/SJ4 靖边枢纽直接当成 WE1 靖边站。",
    },
}


def _normalize_ref(value: Any) -> str:
    return str(value or "").strip().replace(" ", "").upper()


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _round_or_none(value: Any, digits: int = 4) -> Optional[float]:
    number = _safe_float(value)
    if number is None:
        return None
    return round(number, digits)


def _station_to_dict(station: Optional[Station]) -> Optional[dict[str, Any]]:
    if station is None:
        return None
    return {
        "id": station.id,
        "name": station.name,
        "type": station.type,
        "longitude": station.longitude,
        "latitude": station.latitude,
        "design_pressure": _round_or_none(station.design_pressure),
        "operating_pressure_in": _round_or_none(station.operating_pressure_in),
        "operating_pressure_out": _round_or_none(station.operating_pressure_out),
        "capacity": _round_or_none(station.capacity),
    }


def _pipeline_to_dict(edge: Pipeline, station_names: Optional[dict[str, str]] = None) -> dict[str, Any]:
    station_names = station_names or {}
    return {
        "id": edge.id,
        "name": edge.name,
        "start_station_id": edge.start_station_id,
        "start_station_name": station_names.get(edge.start_station_id),
        "end_station_id": edge.end_station_id,
        "end_station_name": station_names.get(edge.end_station_id),
        "length_km": _round_or_none(edge.length_km, 6),
        "legacy_length": _round_or_none(edge.length, 6),
        "diameter_mm": _round_or_none(edge.diameter_mm),
        "design_pressure_mpa": _round_or_none(edge.design_pressure_mpa),
        "category": edge.category,
        "topology_direction": f"{edge.start_station_id}->{edge.end_station_id}",
    }


def _sample_mapping_for_ref(station_ref: str) -> Optional[dict[str, Any]]:
    normalized = _normalize_ref(station_ref)
    for item in WE1_SAMPLE_STATIONS.values():
        candidates = [item["station_id"], item["station_name"], item.get("scada_station_id"), item.get("scada_station_name")]
        candidates.extend(item.get("aliases") or [])
        if any(_normalize_ref(candidate) == normalized for candidate in candidates if candidate):
            return item
        if normalized and any(normalized in _normalize_ref(candidate) for candidate in candidates if candidate):
            return item
    return None


def resolve_we1_station(session: Session, station_ref: str) -> dict[str, Any]:
    """Resolve a user-facing station reference into a topology station."""
    ref = str(station_ref or "").strip()
    mapping = _sample_mapping_for_ref(ref)
    preferred_id = mapping.get("station_id") if mapping else ref

    station = session.get(Station, preferred_id) if preferred_id else None
    if station is None and ref:
        station = session.exec(select(Station).where(Station.name == ref)).first()
    if station is None and ref:
        candidates = session.exec(select(Station)).all()
        norm = _normalize_ref(ref)
        station = next(
            (
                item
                for item in candidates
                if item.id.startswith("WE1-")
                and (norm in _normalize_ref(item.name) or norm in _normalize_ref(item.id))
            ),
            None,
        )

    return {
        "found": station is not None,
        "station": _station_to_dict(station),
        "mapping": mapping,
        "query": ref,
        "basis": "sample_mapping" if mapping else "database_lookup",
    }


def _station_name_index(session: Session, station_ids: Iterable[str]) -> dict[str, str]:
    ids = {sid for sid in station_ids if sid}
    if not ids:
        return {}
    rows = session.exec(select(Station)).all()
    return {item.id: item.name for item in rows if item.id in ids}


def _is_scope_edge(edge: Pipeline, scope: str) -> bool:
    if not scope or scope == "all":
        return True
    normalized = scope.lower()
    if normalized == WE1_SCOPE:
        return edge.id.startswith("WE1-") or (
            str(edge.start_station_id).startswith("WE1-") and str(edge.end_station_id).startswith("WE1-")
        )
    return edge.id.lower().startswith(f"{normalized}-")


def get_connected_edges(session: Session, station_id: str, scope: str = WE1_SCOPE) -> list[dict[str, Any]]:
    edges = session.exec(select(Pipeline)).all()
    connected = [
        edge
        for edge in edges
        if (edge.start_station_id == station_id or edge.end_station_id == station_id) and _is_scope_edge(edge, scope)
    ]
    station_names = _station_name_index(
        session,
        [sid for edge in connected for sid in (edge.start_station_id, edge.end_station_id)],
    )
    result: list[dict[str, Any]] = []
    for edge in sorted(connected, key=lambda item: item.id):
        payload = _pipeline_to_dict(edge, station_names)
        if edge.start_station_id == station_id:
            payload["relation_to_station"] = "downstream"
            payload["neighbor_station_id"] = edge.end_station_id
            payload["neighbor_station_name"] = station_names.get(edge.end_station_id)
        else:
            payload["relation_to_station"] = "upstream"
            payload["neighbor_station_id"] = edge.start_station_id
            payload["neighbor_station_name"] = station_names.get(edge.start_station_id)
        result.append(payload)
    return result


def _scada_candidates(station: Optional[Station], mapping: Optional[dict[str, Any]]) -> dict[str, set[str]]:
    station_names: set[str] = set()
    station_ids: set[str] = set()
    pipeline_ids: set[str] = {WE1_SCOPE}
    if station:
        station_names.add(station.name)
        station_ids.add(station.id)
    if mapping:
        if mapping.get("scada_station_name"):
            station_names.add(str(mapping["scada_station_name"]))
        if mapping.get("station_name"):
            station_names.add(str(mapping["station_name"]))
        if mapping.get("scada_station_id"):
            station_ids.add(str(mapping["scada_station_id"]))
        if mapping.get("station_id"):
            station_ids.add(str(mapping["station_id"]))
        for alias in mapping.get("aliases") or []:
            if any(char.isdigit() for char in str(alias)):
                station_ids.add(str(alias))
            else:
                station_names.add(str(alias))
    return {
        "station_names": {item for item in station_names if item},
        "station_ids": {item for item in station_ids if item},
        "pipeline_ids": pipeline_ids,
    }


def _matches_scada_record(record: ScadaHistory, candidates: dict[str, set[str]]) -> bool:
    return (
        record.station_name in candidates["station_names"]
        or (record.station_id in candidates["station_ids"] if record.station_id else False)
    ) and (not record.pipeline_id or record.pipeline_id in candidates["pipeline_ids"])


def _scada_metric_summary(candidates: dict[str, set[str]], metric_type: str) -> dict[str, Any]:
    with Session(scada_history_engine) as scada_session:
        records = scada_session.exec(
            select(ScadaHistory).where(ScadaHistory.metric_type == metric_type)
        ).all()
    matched = [record for record in records if _matches_scada_record(record, candidates)]
    matched.sort(key=lambda item: item.recorded_at or datetime.min)
    if not matched:
        return {
            "found": False,
            "metric_type": metric_type,
            "count": 0,
            "latest": None,
            "unit": None,
            "time_range": None,
            "source": "scada_history.db",
        }
    latest = matched[-1]
    values = [item.value for item in matched if item.value is not None]
    return {
        "found": True,
        "metric_type": metric_type,
        "count": len(matched),
        "latest": _round_or_none(latest.value),
        "unit": latest.unit,
        "recorded_at": latest.recorded_at.isoformat() if latest.recorded_at else None,
        "time_range": {
            "start": matched[0].recorded_at.isoformat() if matched[0].recorded_at else None,
            "end": latest.recorded_at.isoformat() if latest.recorded_at else None,
        },
        "minimum": _round_or_none(min(values)) if values else None,
        "maximum": _round_or_none(max(values)) if values else None,
        "station_id": latest.station_id,
        "station_name": latest.station_name,
        "source": "scada_history.db",
    }


def _extract_snapshot_node(run_id: Optional[str], station_id: str, pilot_id: Optional[str] = None) -> Optional[dict[str, Any]]:
    if not run_id:
        return None
    try:
        snapshot = get_snapshot(run_id, pilot_id=pilot_id)
    except Exception:
        return None
    result = snapshot.get("result") or snapshot
    for item in result.get("nodes") or []:
        if item.get("id") == station_id:
            return dict(item)
    return None


def get_pressure_profile(
    session: Session,
    station_ref: str,
    run_id: Optional[str] = None,
    baseline_run_id: Optional[str] = None,
    pilot_id: str = WE1_PILOT_ID,
) -> dict[str, Any]:
    resolved = resolve_we1_station(session, station_ref)
    station_data = resolved.get("station")
    station = session.get(Station, station_data["id"]) if station_data else None
    candidates = _scada_candidates(station, resolved.get("mapping"))
    pressure_summary = _scada_metric_summary(candidates, "pressure")
    temperature_summary = _scada_metric_summary(candidates, "temperature")
    simulation_node = _extract_snapshot_node(run_id, station.id, pilot_id=pilot_id) if station else None
    baseline_node = _extract_snapshot_node(baseline_run_id, station.id, pilot_id=pilot_id) if station else None

    current_pressure = pressure_summary["latest"] if pressure_summary.get("found") else None
    source_type = "scada_history" if current_pressure is not None else "station_static"
    if current_pressure is None and station:
        current_pressure = _round_or_none(station.operating_pressure_out or station.operating_pressure_in or station.design_pressure)

    return {
        "station": station_data,
        "mapping": resolved.get("mapping"),
        "current_pressure": current_pressure,
        "seed_pressure": {
            "in": _round_or_none(station.operating_pressure_in if station else None),
            "out": _round_or_none(station.operating_pressure_out if station else None),
            "design": _round_or_none(station.design_pressure if station else None),
            "source": "smartgas.db.stations",
        },
        "simulation_pressure": {
            "run_id": run_id,
            "pressure_mpa": _round_or_none((simulation_node or {}).get("pressure_mpa")),
            "pressure_in_mpa": _round_or_none((simulation_node or {}).get("pressure_in_mpa")),
            "source": "we1_snapshot" if simulation_node else None,
        },
        "baseline_pressure": {
            "run_id": baseline_run_id,
            "pressure_mpa": _round_or_none((baseline_node or {}).get("pressure_mpa")),
            "pressure_in_mpa": _round_or_none((baseline_node or {}).get("pressure_in_mpa")),
            "source": "we1_snapshot" if baseline_node else None,
        },
        "scada": {
            "pressure": pressure_summary,
            "temperature": temperature_summary,
            "candidates": {
                "station_names": sorted(candidates["station_names"]),
                "station_ids": sorted(candidates["station_ids"]),
                "pipeline_ids": sorted(candidates["pipeline_ids"]),
            },
        },
        "source_type": source_type,
        "basis": "SCADA 历史压力优先；没有 SCADA 时回退到 stations 静态运行压力。",
        "data_gaps": [] if pressure_summary.get("found") else ["当前 SCADA 历史库未命中该站压力。"],
    }


def get_we1_alignment_report(session: Session) -> dict[str, Any]:
    station_reports = []
    for key, mapping in WE1_SAMPLE_STATIONS.items():
        station_id = mapping["station_id"]
        pressure = get_pressure_profile(session, station_id)
        station_reports.append(
            {
                "key": key,
                "station": pressure["station"],
                "mapping": mapping,
                "pressure": pressure,
                "connected_edges_we1": get_connected_edges(session, station_id, scope=WE1_SCOPE),
                "connected_edges_all": get_connected_edges(session, station_id, scope="all"),
            }
        )

    pipelines = session.exec(select(Pipeline)).all()
    stations = {item.id for item in session.exec(select(Station)).all()}
    orphan_edges = [
        edge.id
        for edge in pipelines
        if edge.start_station_id not in stations or edge.end_station_id not in stations
    ]
    with Session(scada_history_engine) as scada_session:
        scada_flow_count = len(
            scada_session.exec(select(ScadaHistory).where(ScadaHistory.metric_type == "flow")).all()
        )

    return {
        "pilot_id": WE1_PILOT_ID,
        "scope": WE1_SCOPE,
        "sample_stations": station_reports,
        "database_sources": {
            "topology": "backend/data/smartgas.db",
            "scada_history": "backend/data/scada_history.db",
            "snapshots": "backend/data/we1_snapshots",
        },
        "integrity": {
            "pipeline_count": len(pipelines),
            "orphan_edge_count": len(orphan_edges),
            "orphan_edge_ids": orphan_edges[:20],
        },
        "flow_boundary": {
            "scada_flow_found": scada_flow_count > 0,
            "scada_flow_count": scada_flow_count,
            "rule": "SCADA 真实流量缺失时，只能使用仿真结果流量；没有仿真结果时只能按压力差或拓扑默认方向推断。",
        },
    }


def _resolve_edge(session: Session, edge_ref: str) -> Optional[Pipeline]:
    ref = str(edge_ref or "").strip()
    if not ref:
        return None
    edge = session.get(Pipeline, ref)
    if edge:
        return edge
    norm = _normalize_ref(ref)
    return next(
        (
            item
            for item in session.exec(select(Pipeline)).all()
            if norm in _normalize_ref(item.id) or norm in _normalize_ref(item.name)
        ),
        None,
    )


def _latest_run_id(pilot_id: str = WE1_PILOT_ID) -> Optional[str]:
    try:
        items = list_snapshots(pilot_id=pilot_id, limit=1)
    except Exception:
        return None
    if not items:
        return None
    return items[0].get("run_id")


def _snapshot_edge(run_id: Optional[str], edge_id: str, pilot_id: str = WE1_PILOT_ID) -> Optional[dict[str, Any]]:
    if not run_id:
        return None
    try:
        snapshot = get_snapshot(run_id, pilot_id=pilot_id)
    except Exception:
        return None
    result = snapshot.get("result") or snapshot
    for item in result.get("edges") or []:
        if item.get("id") == edge_id:
            return dict(item)
    return None


def get_flow_direction(
    session: Session,
    edge_ref: str,
    run_id: Optional[str] = None,
    pilot_id: str = WE1_PILOT_ID,
) -> dict[str, Any]:
    edge = _resolve_edge(session, edge_ref)
    if edge is None:
        return {"found": False, "query": edge_ref, "message": "未找到管段。"}

    station_names = _station_name_index(session, [edge.start_station_id, edge.end_station_id])
    edge_payload = _pipeline_to_dict(edge, station_names)
    effective_run_id = run_id or _latest_run_id(pilot_id)
    sim_edge = _snapshot_edge(effective_run_id, edge.id, pilot_id=pilot_id)
    if sim_edge:
        flow_rate = _safe_float(sim_edge.get("flow_rate")) or 0.0
        sim_direction = str(sim_edge.get("direction") or "").lower()
        if sim_direction == "reverse" or flow_rate < 0:
            direction = "reverse"
            direction_label = f"{edge_payload['end_station_name'] or edge.end_station_id} -> {edge_payload['start_station_name'] or edge.start_station_id}"
        elif sim_direction == "zero" or abs(flow_rate) < 1e-9:
            direction = "zero"
            direction_label = "无明显流向"
        else:
            direction = "forward"
            direction_label = f"{edge_payload['start_station_name'] or edge.start_station_id} -> {edge_payload['end_station_name'] or edge.end_station_id}"
        return {
            "found": True,
            "edge": edge_payload,
            "direction": direction,
            "direction_label": direction_label,
            "basis": "simulation_result",
            "basis_label": "依据仿真结果流量方向，不是 SCADA 实测流量。",
            "confidence": 0.9,
            "run_id": effective_run_id,
            "flow_rate": _round_or_none(flow_rate),
            "utilization": _round_or_none(sim_edge.get("utilization")),
            "alert_level": sim_edge.get("alert_level"),
        }

    start_station = session.get(Station, edge.start_station_id)
    end_station = session.get(Station, edge.end_station_id)
    start_pressure = _safe_float(
        (start_station.operating_pressure_out if start_station else None)
        or (start_station.operating_pressure_in if start_station else None)
        or (start_station.design_pressure if start_station else None)
    )
    end_pressure = _safe_float(
        (end_station.operating_pressure_in if end_station else None)
        or (end_station.operating_pressure_out if end_station else None)
        or (end_station.design_pressure if end_station else None)
    )
    pressure_delta = (start_pressure - end_pressure) if start_pressure is not None and end_pressure is not None else None
    if pressure_delta is not None and abs(pressure_delta) >= 0.05:
        if pressure_delta > 0:
            direction = "forward"
            direction_label = f"{edge_payload['start_station_name'] or edge.start_station_id} -> {edge_payload['end_station_name'] or edge.end_station_id}"
        else:
            direction = "reverse"
            direction_label = f"{edge_payload['end_station_name'] or edge.end_station_id} -> {edge_payload['start_station_name'] or edge.start_station_id}"
        return {
            "found": True,
            "edge": edge_payload,
            "direction": direction,
            "direction_label": direction_label,
            "basis": "pressure_delta_inferred",
            "basis_label": "没有可用仿真结果时，按两端站点静态压力差推断。",
            "confidence": 0.62,
            "pressure_delta_mpa": _round_or_none(pressure_delta),
            "start_pressure_mpa": _round_or_none(start_pressure),
            "end_pressure_mpa": _round_or_none(end_pressure),
            "data_gaps": ["当前未使用 SCADA 实测流量。"],
        }

    return {
        "found": True,
        "edge": edge_payload,
        "direction": "forward",
        "direction_label": f"{edge_payload['start_station_name'] or edge.start_station_id} -> {edge_payload['end_station_name'] or edge.end_station_id}",
        "basis": "topology_default",
        "basis_label": "这是拓扑录入方向，不代表实时流向。",
        "confidence": 0.35,
        "pressure_delta_mpa": _round_or_none(pressure_delta),
        "data_gaps": ["没有仿真结果，也没有足够压差证据。"],
    }


def query_topology_relation(
    session: Session,
    station_ref: str,
    target_ref: Optional[str] = None,
    scope: str = WE1_SCOPE,
    depth: int = 1,
) -> dict[str, Any]:
    resolved = resolve_we1_station(session, station_ref)
    station = resolved.get("station")
    if not station:
        return {"found": False, "query": station_ref, "message": "未找到站点。"}

    connected = get_connected_edges(session, station["id"], scope=scope)
    upstream = [item for item in connected if item["relation_to_station"] == "upstream"]
    downstream = [item for item in connected if item["relation_to_station"] == "downstream"]
    path = None
    if target_ref:
        target = resolve_we1_station(session, target_ref).get("station")
        if target:
            path = _find_path(session, station["id"], target["id"], scope=scope, max_depth=max(depth, 20))

    return {
        "found": True,
        "station": station,
        "scope": scope,
        "depth": depth,
        "upstream_edges": upstream,
        "downstream_edges": downstream,
        "connected_edges": connected,
        "path": path,
        "basis": "smartgas.db.pipelines.start_station_id/end_station_id",
        "data_gaps": [] if connected else ["该站在指定 scope 内没有命中的相邻管段。"],
    }


def _find_path(
    session: Session,
    source_id: str,
    target_id: str,
    scope: str = WE1_SCOPE,
    max_depth: int = 20,
) -> Optional[dict[str, Any]]:
    edges = [edge for edge in session.exec(select(Pipeline)).all() if _is_scope_edge(edge, scope)]
    station_names = _station_name_index(
        session,
        [sid for edge in edges for sid in (edge.start_station_id, edge.end_station_id)],
    )
    adjacency: dict[str, list[tuple[str, Pipeline]]] = {}
    for edge in edges:
        adjacency.setdefault(edge.start_station_id, []).append((edge.end_station_id, edge))

    queue: deque[tuple[str, list[str], list[Pipeline], float]] = deque([(source_id, [source_id], [], 0.0)])
    seen = {source_id}
    while queue:
        current, nodes, path_edges, length = queue.popleft()
        if current == target_id:
            return {
                "node_ids": nodes,
                "node_names": [station_names.get(node_id, node_id) for node_id in nodes],
                "edge_ids": [edge.id for edge in path_edges],
                "edge_names": [edge.name for edge in path_edges],
                "total_length_km": _round_or_none(length, 4),
            }
        if len(path_edges) >= max_depth:
            continue
        for next_id, edge in adjacency.get(current, []):
            if next_id in seen:
                continue
            seen.add(next_id)
            queue.append((next_id, nodes + [next_id], path_edges + [edge], length + float(edge.length_km or 0.0)))
    return None


def query_sim_flow_topology(
    session: Session,
    run_id: Optional[str] = None,
    baseline_run_id: Optional[str] = None,
    pilot_id: str = WE1_PILOT_ID,
    top_n: int = 5,
) -> dict[str, Any]:
    effective_run_id = run_id or _latest_run_id(pilot_id)
    if not effective_run_id:
        return {"found": False, "message": "未找到可用快照。"}
    snapshot = get_snapshot(effective_run_id, pilot_id=pilot_id)
    result = snapshot.get("result") or snapshot
    baseline_result = None
    if baseline_run_id:
        try:
            baseline = get_snapshot(baseline_run_id, pilot_id=pilot_id)
            baseline_result = baseline.get("result") or baseline
        except Exception:
            baseline_result = None

    baseline_edges = {item.get("id"): item for item in (baseline_result or {}).get("edges", [])}
    baseline_nodes = {item.get("id"): item for item in (baseline_result or {}).get("nodes", [])}
    station_names = {item.id: item.name for item in session.exec(select(Station)).all()}
    pipeline_index = {item.id: item for item in session.exec(select(Pipeline)).all()}

    edge_rows = []
    for item in result.get("edges") or []:
        edge_id = item.get("id")
        edge = pipeline_index.get(edge_id)
        base = baseline_edges.get(edge_id) or {}
        flow = _safe_float(item.get("flow_rate")) or 0.0
        base_flow = _safe_float(base.get("flow_rate"))
        row = {
            "edge_id": edge_id,
            "edge_name": edge.name if edge else edge_id,
            "start_station_id": edge.start_station_id if edge else None,
            "start_station_name": station_names.get(edge.start_station_id) if edge else None,
            "end_station_id": edge.end_station_id if edge else None,
            "end_station_name": station_names.get(edge.end_station_id) if edge else None,
            "flow_rate": _round_or_none(flow),
            "baseline_flow_rate": _round_or_none(base_flow),
            "flow_delta": _round_or_none(flow - base_flow) if base_flow is not None else None,
            "utilization": _round_or_none(item.get("utilization")),
            "direction": item.get("direction"),
            "alert_level": item.get("alert_level"),
        }
        row["sort_score"] = abs(row["flow_delta"]) if row["flow_delta"] is not None else abs(flow)
        edge_rows.append(row)

    node_rows = []
    for item in result.get("nodes") or []:
        node_id = item.get("id")
        base = baseline_nodes.get(node_id) or {}
        pressure = _safe_float(item.get("pressure_mpa"))
        base_pressure = _safe_float(base.get("pressure_mpa"))
        row = {
            "node_id": node_id,
            "node_name": station_names.get(node_id, node_id),
            "pressure_mpa": _round_or_none(pressure),
            "baseline_pressure_mpa": _round_or_none(base_pressure),
            "pressure_delta_mpa": _round_or_none(pressure - base_pressure) if pressure is not None and base_pressure is not None else None,
            "alert_level": item.get("alert_level"),
        }
        row["sort_score"] = abs(row["pressure_delta_mpa"]) if row["pressure_delta_mpa"] is not None else 0
        node_rows.append(row)

    edge_rows.sort(key=lambda item: item.get("sort_score") or 0, reverse=True)
    node_rows.sort(key=lambda item: item.get("sort_score") or 0, reverse=True)
    high_utilization = sorted(edge_rows, key=lambda item: item.get("utilization") or 0, reverse=True)[:top_n]
    for row in edge_rows + node_rows:
        row.pop("sort_score", None)

    return {
        "found": True,
        "run_id": effective_run_id,
        "baseline_run_id": baseline_run_id,
        "pilot_id": pilot_id,
        "scenario_id": snapshot.get("scenario_id") or result.get("scenario_id"),
        "summary": result.get("summary") or snapshot.get("output_summary") or {},
        "top_flow_changes": edge_rows[:top_n],
        "top_pressure_changes": node_rows[:top_n],
        "high_utilization_edges": high_utilization,
        "basis": "WE1 仿真快照 result.edges/result.nodes",
        "data_gaps": ["流量来自仿真求解结果，不是 SCADA 实测流量。"],
    }


def explain_flow_topology_situation(
    session: Session,
    run_id: Optional[str] = None,
    baseline_run_id: Optional[str] = None,
    pilot_id: str = WE1_PILOT_ID,
) -> dict[str, Any]:
    sim = query_sim_flow_topology(
        session,
        run_id=run_id,
        baseline_run_id=baseline_run_id,
        pilot_id=pilot_id,
        top_n=3,
    )
    if not sim.get("found"):
        return {
            "headline": "还没有可解释的仿真结果。",
            "plain_summary": "先运行一次主仿真或选择一个快照，AI 才能按结果说话。",
            "evidence": [],
            "risks": ["缺少 run_id 或快照。"],
            "next_actions": ["先运行 WE1 主仿真。"],
            "data_gaps": sim.get("data_gaps") or [],
        }

    summary = sim.get("summary") or {}
    top_flow = (sim.get("top_flow_changes") or [{}])[0]
    top_pressure = (sim.get("top_pressure_changes") or [{}])[0]
    avg_util = _safe_float(summary.get("avg_utilization")) or _safe_float(summary.get("average_utilization")) or 0.0
    alerts = int(summary.get("alert_count") or summary.get("alerts") or 0)
    headline = "仿真已收敛，当前结果可用于讲解。"
    if alerts > 0 or avg_util >= 0.9:
        headline = "仿真结果提示管网有局部紧张，需要重点看高负荷管段。"

    flow_name = top_flow.get("edge_name") or top_flow.get("edge_id") or "暂无"
    node_name = top_pressure.get("node_name") or top_pressure.get("node_id") or "暂无"
    return {
        "headline": headline,
        "plain_summary": (
            f"本次 run_id={sim.get('run_id')}，平均利用率约 {avg_util * 100:.1f}%，"
            f"告警数 {alerts}。流量侧优先看 {flow_name}，压力侧优先看 {node_name}。"
        ),
        "evidence": [
            {"type": "summary", "value": summary},
            {"type": "top_flow", "value": top_flow},
            {"type": "top_pressure", "value": top_pressure},
        ],
        "risks": [
            "如果图层没有命中该管段，说明结果有但地图显示映射还要补。",
            "流量是仿真结果，不是 SCADA 实测流量。",
        ],
        "next_actions": [
            "在拓扑图查看高利用率管段。",
            "对比基线快照，确认压力和流量变化是否符合预期。",
        ],
        "data_gaps": sim.get("data_gaps") or [],
    }
