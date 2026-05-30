from __future__ import annotations

import json
import logging
from typing import Any

import networkx as nx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models import JunctionGroup, Pipeline, Station
from app.services.networkx_cutoff_config import resolve_networkx_cutoff_demo_case


router = APIRouter(prefix="/api/topology", tags=["NetworkX 截断推演"])
logger = logging.getLogger(__name__)


def _station_name(stations: dict[str, Station], station_id: str) -> str:
    station = stations.get(station_id)
    return station.name if station else station_id


def _edge_payload(edge_id: str, edge_data: dict[str, Any], stations: dict[str, Station]) -> dict[str, Any]:
    source = str(edge_data.get("source", ""))
    target = str(edge_data.get("target", ""))
    return {
        "id": edge_id,
        "name": str(edge_data.get("name") or edge_id),
        "source": source,
        "target": target,
        "source_name": _station_name(stations, source),
        "target_name": _station_name(stations, target),
        "length_km": round(float(edge_data.get("length_km") or 0), 3),
        "type": str(edge_data.get("type") or "pipeline"),
    }


def _path_edges(graph: nx.Graph, path: list[str], stations: dict[str, Station]) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
    for source, target in zip(path, path[1:]):
        data = dict(graph.get_edge_data(source, target) or {})
        edge_id = str(data.get("id") or f"{source}-{target}")
        data["source"] = source
        data["target"] = target
        edges.append(_edge_payload(edge_id, data, stations))
    return edges


def _path_length(edges: list[dict[str, Any]]) -> float:
    return round(sum(float(edge.get("length_km") or 0) for edge in edges), 3)


def _build_national_network(session: Session) -> tuple[nx.Graph, dict[str, Station], dict[str, Pipeline], dict[str, Any]]:
    stations = {station.id: station for station in session.exec(select(Station)).all()}
    pipelines = {pipeline.id: pipeline for pipeline in session.exec(select(Pipeline)).all()}

    graph = nx.Graph()
    for station in stations.values():
        if not station.longitude or not station.latitude:
            continue
        graph.add_node(
            station.id,
            name=station.name,
            type=station.type,
            longitude=station.longitude,
            latitude=station.latitude,
        )

    for pipeline in pipelines.values():
        if pipeline.start_station_id not in graph or pipeline.end_station_id not in graph:
            continue
        length_km = float(pipeline.length_km or pipeline.length or 0)
        graph.add_edge(
            pipeline.start_station_id,
            pipeline.end_station_id,
            id=pipeline.id,
            name=pipeline.name,
            type=pipeline.category or "pipeline",
            weight=length_km if length_km > 0 else 0.1,
            length_km=length_km,
        )

    junction_edges = 0
    for junction in session.exec(select(JunctionGroup)).all():
        try:
            station_ids = json.loads(junction.station_ids or "[]")
        except json.JSONDecodeError:
            station_ids = []
        station_ids = [str(station_id) for station_id in station_ids if str(station_id) in graph]
        for i, source in enumerate(station_ids):
            for target in station_ids[i + 1:]:
                graph.add_edge(
                    source,
                    target,
                    id=f"JUNCTION-{junction.id}-{i}-{i + 1}",
                    name=f"{junction.name}互联",
                    type="interconnect",
                    weight=0.1,
                    length_km=0.1,
                )
                junction_edges += 1

    stats = {
        "station_count": len(stations),
        "pipeline_count": len(pipelines),
        "graph_nodes": graph.number_of_nodes(),
        "graph_edges": graph.number_of_edges(),
        "junction_edges": junction_edges,
    }
    return graph, stations, pipelines, stats


@router.get("/networkx-cutoff-demo")
def run_networkx_cutoff_demo(
    station: str = Query("jingbian", description="演示站点，支持 jingbian、zhongwei、luzhi"),
    stage: str = Query("all", description="站内阀门阶段，如 we1/we2/zg"),
    valve_id: str = Query("", description="站内阀门编号，如 zw102"),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """
    使用 NetworkX 原生图操作做全国网截断推演。

    演示算法：
    1. 从业务库构建全国无向图；
    2. 先计算截断前最短路径；
    3. 复制图并按配置移除节点或边；
    4. 再用 nx.shortest_path 计算截断后的替代路径。
    """
    try:
        demo = resolve_networkx_cutoff_demo_case(station, stage=stage, valve_id=valve_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    graph, stations, pipelines, stats = _build_national_network(session)

    source = demo["source"]
    target = demo["target"]
    cutoff_node_ids = [node_id for node_id in demo["cutoff_node_ids"] if node_id in graph]
    configured_cutoff_edge_ids = [str(edge_id) for edge_id in demo.get("cutoff_edge_ids", []) if str(edge_id)]
    if source not in graph or target not in graph:
        raise HTTPException(status_code=404, detail="演示源点或目标点不在全国拓扑图中")
    if not cutoff_node_ids and not configured_cutoff_edge_ids:
        raise HTTPException(status_code=404, detail="截断节点或管段不在全国拓扑图中")

    try:
        before_path = nx.shortest_path(graph, source, target, weight="weight")
    except nx.NetworkXNoPath:
        before_path = []

    graph_after = graph.copy()
    graph_after.remove_nodes_from(cutoff_node_ids)

    cutoff_edges: list[dict[str, Any]] = []
    seen_cutoff_edges: set[str] = set()
    cutoff_edge_pairs: list[tuple[str, str]] = []
    edge_index: dict[str, list[tuple[str, str, dict[str, Any]]]] = {}
    for source_id, target_id, edge_data in graph.edges(data=True):
        edge_id = str(edge_data.get("id") or "")
        if not edge_id:
            continue
        edge_index.setdefault(edge_id, []).append((source_id, target_id, dict(edge_data)))
    for edge_id in configured_cutoff_edge_ids:
        for source_id, target_id, edge_data in edge_index.get(edge_id, []):
            data = dict(edge_data)
            data["source"] = source_id
            data["target"] = target_id
            if edge_id not in seen_cutoff_edges:
                seen_cutoff_edges.add(edge_id)
                cutoff_edges.append(_edge_payload(edge_id, data, stations))
            cutoff_edge_pairs.append((source_id, target_id))

    for source_id, target_id in cutoff_edge_pairs:
        if graph_after.has_edge(source_id, target_id):
            graph_after.remove_edge(source_id, target_id)

    reroute_available = False
    after_path: list[str] = []
    after_error = ""
    try:
        after_path = nx.shortest_path(graph_after, source, target, weight="weight")
        reroute_available = True
    except nx.NetworkXNoPath:
        after_error = "截断后没有可用替代路径"
    except nx.NodeNotFound as exc:
        after_error = str(exc)

    for node_id in cutoff_node_ids:
        for neighbor in graph.neighbors(node_id):
            data = dict(graph.get_edge_data(node_id, neighbor) or {})
            edge_id = str(data.get("id") or f"{node_id}-{neighbor}")
            if edge_id in seen_cutoff_edges:
                continue
            seen_cutoff_edges.add(edge_id)
            data["source"] = node_id
            data["target"] = neighbor
            cutoff_edges.append(_edge_payload(edge_id, data, stations))

    before_edges = _path_edges(graph, before_path, stations) if before_path else []
    after_edges = _path_edges(graph_after, after_path, stations) if after_path else []
    after_edge_ids = {edge["id"] for edge in after_edges}
    affected_edges = [edge for edge in before_edges if edge["id"] not in after_edge_ids]

    cutoff_nodes = [
        {
            "id": node_id,
            "name": _station_name(stations, node_id),
            "longitude": stations[node_id].longitude,
            "latitude": stations[node_id].latitude,
        }
        for node_id in cutoff_node_ids
        if node_id in stations
    ]
    before_length = _path_length(before_edges)
    after_length = _path_length(after_edges)
    delta_length = round(after_length - before_length, 3) if reroute_available and before_edges else None

    return {
        "demo_id": demo["id"],
        "title": demo["label"],
        "description": demo["description"],
        "method": "NetworkX: nx.Graph -> nx.shortest_path -> graph.copy().remove_nodes_from(...) -> nx.shortest_path",
        "algorithm": "networkx.shortest_path(weight='weight')",
        "source": {"id": source, "name": _station_name(stations, source)},
        "target": {"id": target, "name": _station_name(stations, target)},
        "cutoff_nodes": cutoff_nodes,
        "cutoff_edges": cutoff_edges,
        "before_path": {
            "node_ids": before_path,
            "node_names": [_station_name(stations, node_id) for node_id in before_path],
            "edges": before_edges,
            "length_km": before_length,
        },
        "after_path": {
            "available": reroute_available,
            "node_ids": after_path,
            "node_names": [_station_name(stations, node_id) for node_id in after_path],
            "edges": after_edges,
            "length_km": after_length,
            "error": after_error,
        },
        "affected_edges": affected_edges,
        "summary": {
            "reroute_available": reroute_available,
            "cutoff_nodes": len(cutoff_nodes),
            "cutoff_edges": len(cutoff_edges),
            "before_path_nodes": len(before_path),
            "before_path_edges": len(before_edges),
            "after_path_nodes": len(after_path),
            "after_path_edges": len(after_edges),
            "affected_edges": len(affected_edges),
            "extra_length_km": delta_length,
        },
        "stats": stats,
        "boundary_note": "这是拓扑连通性截断演示，只说明路径是否可达和绕行范围；不等同于水力仿真压力、流量和真实调度指令。",
    }
