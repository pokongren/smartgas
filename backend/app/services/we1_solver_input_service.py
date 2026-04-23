from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Iterable, List, Optional, Tuple


def _stable_token(value: str) -> List[Any]:
    parts: List[Any] = []
    buff = ""
    for ch in value:
        if ch.isdigit():
            buff += ch
            continue
        if buff:
            parts.append((0, int(buff)))
            buff = ""
        parts.append((1, ch))
    if buff:
        parts.append((0, int(buff)))
    return parts


def _split_id_suffix(id_str: str) -> Tuple[str, Optional[str]]:
    i = len(id_str) - 1
    while i >= 0 and id_str[i].isdigit():
        i -= 1
    prefix = id_str[: i + 1]
    suffix = id_str[i + 1 :] if i + 1 < len(id_str) else None
    return prefix, suffix


def _expand_range(id_range: Iterable[str]) -> List[str]:
    values = list(id_range)
    if not values:
        return []
    if len(values) == 1:
        return [values[0]]

    start_id, end_id = values[0], values[-1]
    if start_id == end_id:
        return [start_id]

    try:
        prefix, start_num = _split_id_suffix(start_id)
        prefix2, end_num = _split_id_suffix(end_id)
        if prefix == prefix2 and start_num is not None and end_num is not None:
            return [f"{prefix}{i}" for i in range(int(start_num), int(end_num) + 1)]
    except Exception:
        pass

    return values


def _build_package_node_index(pilot_package: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    index: Dict[str, Dict[str, Any]] = {}
    for layer in pilot_package.get("layers", []):
        layer_id = str(layer.get("id") or "")
        layer_name = str(layer.get("name") or "")
        for node in layer.get("nodes", []):
            node_id = str(node.get("id") or "")
            if not node_id:
                continue
            payload = deepcopy(node)
            payload["layer_id"] = layer_id
            payload["layer_name"] = layer_name
            index[node_id] = payload
    return index


def _build_package_line_index(pilot_package: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    index: Dict[str, Dict[str, Any]] = {}
    for layer in pilot_package.get("layers", []):
        layer_id = str(layer.get("id") or "")
        layer_name = str(layer.get("name") or "")
        for line in layer.get("lines", []):
            line_id = str(line.get("id") or "")
            if not line_id:
                continue
            payload = deepcopy(line)
            payload["layer_id"] = layer_id
            payload["layer_name"] = layer_name
            index[line_id] = payload
    return index


def _expand_edge_templates(seed_edges: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for edge in seed_edges:
        edge_ids = []
        if edge.get("id"):
            edge_ids = [str(edge["id"])]
        else:
            edge_ids = _expand_range(edge.get("id_range", []))
        for edge_id in edge_ids:
            result[edge_id] = {
                key: deepcopy(value)
                for key, value in edge.items()
                if key != "id_range"
            }
            result[edge_id]["id"] = edge_id
    return result


def _expand_valve_templates(seed_valves: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for valve in seed_valves:
        valve_ids = []
        if valve.get("id"):
            valve_ids = [str(valve["id"])]
        else:
            valve_ids = _expand_range(valve.get("id_range", []))
        for valve_id in valve_ids:
            result[valve_id] = {
                key: deepcopy(value)
                for key, value in valve.items()
                if key != "id_range"
            }
            result[valve_id]["id"] = valve_id
    return result


def _default_target_pressure(raw_type: str) -> float:
    if raw_type == "compressor":
        return 9.2
    if raw_type == "distribution":
        return 8.0
    return 8.8


def _default_min_pressure(raw_type: str) -> float:
    if raw_type == "distribution":
        return 7.0
    return 7.8


def _default_max_pressure(raw_type: str) -> float:
    if raw_type == "distribution":
        return 9.2
    return 10.5


def _build_solver_node(
    node_id: str,
    package_node: Optional[Dict[str, Any]],
    seed_node: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    raw_type = str(
        (seed_node or {}).get("type")
        or (package_node or {}).get("rawType")
        or (package_node or {}).get("type")
        or "junction"
    )
    coordinate = deepcopy((package_node or {}).get("coordinate") or {})

    merged: Dict[str, Any] = {
        "id": node_id,
        "name": str((seed_node or {}).get("name") or (package_node or {}).get("name") or node_id),
        "type": raw_type,
        "role": "transit",
        "supply_max": 0.0,
        "demand_nominal": 0.0,
        "target_pressure_mpa": _default_target_pressure(raw_type),
        "min_pressure_mpa": _default_min_pressure(raw_type),
        "max_pressure_mpa": _default_max_pressure(raw_type),
        "capacity": 0.0,
        "compressor_enabled": raw_type == "compressor",
        "coordinate": coordinate,
        "layer_id": (package_node or {}).get("layer_id"),
        "layer_name": (package_node or {}).get("layer_name"),
        "raw_type": raw_type,
        "from_package_only": seed_node is None,
        "from_seed_only": package_node is None,
    }
    if seed_node:
        merged.update(deepcopy(seed_node))
        merged["from_package_only"] = False
    if package_node:
        merged.setdefault("coordinate", coordinate)
        merged["coordinate"] = coordinate
        merged["layer_id"] = package_node.get("layer_id")
        merged["layer_name"] = package_node.get("layer_name")
        merged.setdefault("raw_type", package_node.get("rawType") or package_node.get("type"))
    return merged


def _build_solver_edge(
    edge_id: str,
    package_line: Optional[Dict[str, Any]],
    edge_template: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    merged: Dict[str, Any] = {
        "id": edge_id,
        "name": str((package_line or {}).get("name") or edge_id),
        "source_id": (package_line or {}).get("startNodeId"),
        "target_id": (package_line or {}).get("endNodeId"),
        "pipeline_kind": str(
            (edge_template or {}).get("pipeline_kind")
            or (package_line or {}).get("pipelineKind")
            or "trunk"
        ),
        "length_km": float(((package_line or {}).get("length") or 0.0) / 1000.0),
        "diameter_mm": float(
            (package_line or {}).get("diameter")
            or (edge_template or {}).get("diameter_mm_default")
            or 1016.0
        ),
        "design_pressure_mpa": float((edge_template or {}).get("design_pressure_mpa_default") or 10.0),
        "roughness_mm": float((edge_template or {}).get("roughness_mm_default") or 0.03),
        "direction_mode": str((edge_template or {}).get("direction_mode_default") or "fixed"),
        "status": str((edge_template or {}).get("status_default") or "open"),
        "start_pressure_mpa": float((edge_template or {}).get("start_pressure_mpa") or 0.0),
        "end_pressure_mpa": float((edge_template or {}).get("end_pressure_mpa") or 0.0),
        "max_flow": float((edge_template or {}).get("max_flow") or 150.0),
        "layer_id": (package_line or {}).get("layer_id"),
        "layer_name": (package_line or {}).get("layer_name"),
        "path": deepcopy((package_line or {}).get("path") or []),
        "from_package_only": edge_template is None,
        "from_seed_only": package_line is None,
    }
    if edge_template:
        merged.update(deepcopy(edge_template))
        merged["from_package_only"] = False
    if package_line:
        merged["source_id"] = package_line.get("startNodeId")
        merged["target_id"] = package_line.get("endNodeId")
        merged["length_km"] = float(((package_line or {}).get("length") or 0.0) / 1000.0)
        merged["diameter_mm"] = float(
            (package_line or {}).get("diameter")
            or merged.get("diameter_mm")
            or merged.get("diameter_mm_default")
            or 1016.0
        )
        merged["pipeline_kind"] = str(package_line.get("pipelineKind") or merged.get("pipeline_kind") or "trunk")
        merged["layer_id"] = package_line.get("layer_id")
        merged["layer_name"] = package_line.get("layer_name")
        merged["path"] = deepcopy(package_line.get("path") or [])
        merged["from_seed_only"] = False
    merged["id"] = edge_id
    return merged


def build_we1_solver_input(
    pilot: Dict[str, Any],
    pilot_package: Dict[str, Any],
    seed_data: Dict[str, Any],
) -> Dict[str, Any]:
    seed = deepcopy(seed_data.get("seed") or {})
    package_node_index = _build_package_node_index(pilot_package)
    package_line_index = _build_package_line_index(pilot_package)
    seed_node_index = {
        str(node.get("id") or ""): deepcopy(node)
        for node in seed.get("nodes", [])
        if node.get("id")
    }
    edge_templates = _expand_edge_templates(seed.get("edges", []))
    valve_templates = _expand_valve_templates(seed.get("valves", []))

    node_ids = sorted(
        set(package_node_index.keys()) | set(seed_node_index.keys()),
        key=_stable_token,
    )
    edge_ids = sorted(
        set(package_line_index.keys()) | set(edge_templates.keys()),
        key=_stable_token,
    )
    valve_ids = sorted(valve_templates.keys(), key=_stable_token)

    nodes = [
        _build_solver_node(node_id, package_node_index.get(node_id), seed_node_index.get(node_id))
        for node_id in node_ids
    ]
    edges = [
        _build_solver_edge(edge_id, package_line_index.get(edge_id), edge_templates.get(edge_id))
        for edge_id in edge_ids
    ]
    valves = []
    for valve_id in valve_ids:
        payload = deepcopy(valve_templates[valve_id])
        payload["id"] = valve_id
        valves.append(payload)

    scenarios = deepcopy(seed.get("scenarios", []))

    return {
        "pilot_id": pilot["id"],
        "system_id": pilot["system_id"],
        "solver_input_version": "we1-stage2-v1",
        "seed_file": seed_data.get("seed_file"),
        "seed_path": seed_data.get("seed_path"),
        "parameter_basis": deepcopy(seed.get("parameter_basis") or {}),
        "nodes": nodes,
        "edges": edges,
        "valves": valves,
        "scenarios": scenarios,
        "meta": {
            "source": "pilot_package+seed",
            "pilot_name": pilot.get("name"),
            "package_summary": deepcopy(pilot_package.get("summary") or {}),
            "cross_system_hints": deepcopy(seed.get("cross_system_hints") or []),
            "cross_layer_hints": deepcopy(seed.get("cross_layer_hints") or []),
        },
        "summary": {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "valve_count": len(valves),
            "scenario_count": len(scenarios),
        },
    }
