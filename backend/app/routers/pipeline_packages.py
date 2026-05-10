"""
管线分组数据 API

提供 PipelinePackage 格式的管线数据，前端所有视图（地图、拓扑、编辑器）共用。
后端从 pipeline_systems + stations + pipelines 三表组装，替代前端硬编码。

设计考虑：
- 未来接入 PI 系统后，SCADA 实时数据可通过 scada API 叠加，本接口只负责拓扑结构
- 按管线系统分组 → 按图层分组 → 返回 nodes + lines
"""
import json
import logging
from typing import List, Dict, Any, Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlmodel import Session, select

from app.database import get_session
from app.models import PipelineSystem, Station, Pipeline, GasSource
from app.services.junction_groups import load_runtime_junction_groups
from app.services.we1_pilot_service import (
    list_we1_pilots,
    get_we1_pilot_or_raise,
    get_we1_pilot_seed_or_raise,
    build_pilot_package,
)
from app.services.we1_solver_input_service import build_we1_solver_input
from collections import defaultdict

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

PIPELINE_SYSTEM_COLOR_OVERRIDES: Dict[str, str] = {
    "we1": "#10b981",
    "we2": "#3b82f6",
}

# 国家级干线枢纽白名单（压气站/首末站/关键分输站）
# 这些站点在地图中统一渲染为黄色菱形枢纽标记
HUB_STATION_NAMES: set[str] = {
    "霍尔果斯压气站", "轮南压气站", "中卫压气站", "靖边压气站",
    "安平压气站", "永清压气站", "黑河压气站", "贵阳压气站",
    "瑞丽", "广州压气站", "贵港压气站", "南昌压气站",
    "平顶山压气站", "薛店", "泰安压气站", "甪直", "红柳压气站",
    "嘉兴",
}


def _build_line_path(start_station: Station, end_station: Station) -> list:
    """构建管段路径坐标（两点直线）"""
    return [
        {"longitude": start_station.longitude, "latitude": start_station.latitude},
        {"longitude": end_station.longitude, "latitude": end_station.latitude},
    ]


def _map_node_type_to_frontend(raw_type: str) -> str:
    """将后端站场类型映射为前端 NodeType 枚举值"""
    mapping = {
        "compressor": "regulator",
        "distribution": "metering",
        "valve": "valve",
        "source": "junction",
        "junction": "junction",
    }
    return mapping.get(raw_type, "junction")


def _normalize_pipeline_kind(raw_category: str) -> str:
    if raw_category == "trunk":
        return "trunk"
    if raw_category == "branch":
        return "branch"
    return "interconnect"


def _resolve_pipeline_kind(raw_category: Optional[str], layer_type: Optional[str]) -> str:
    normalized = _normalize_pipeline_kind(str(raw_category or ""))
    if normalized != "interconnect":
        return normalized

    layer_kind = _normalize_pipeline_kind(str(layer_type or ""))
    if layer_kind != "interconnect":
        return layer_kind

    return "interconnect"


def _parse_properties_json(raw_properties: Optional[str]) -> Dict[str, Any]:
    if not raw_properties:
        return {}
    try:
        parsed = json.loads(raw_properties)
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


@router.get("/pipeline-packages")
def get_pipeline_packages(
    system_id: Optional[str] = Query(None, description="可选，只返回指定管线系统"),
    session: Session = Depends(get_session),
) -> List[Dict[str, Any]]:
    """
    获取所有管线数据包（PipelinePackage 格式）
    
    返回与前端 PipelinePackage 接口完全对齐的数据结构，
    包含分组、图层、节点坐标、管段路径，供地图和拓扑视图直接使用。
    """
    # 查询管线系统
    query = select(PipelineSystem).order_by(PipelineSystem.sort_order)
    if system_id:
        query = query.where(PipelineSystem.id == system_id)
    systems = session.exec(query).all()
    
    if not systems:
        return []
    
    # 预加载所有站场、管段和气源（避免 N+1 查询）
    all_stations = session.exec(select(Station)).all()
    all_pipelines = session.exec(select(Pipeline)).all()
    all_gas_sources = session.exec(select(GasSource)).all()
    
    # 构建站场索引（按 ID 快速查找）
    station_map: Dict[str, Station] = {s.id: s for s in all_stations}
    
    # 构建气源索引（按 station_id 快速查找）
    gas_source_by_station: Dict[str, GasSource] = {
        gs.station_id: gs for gs in all_gas_sources if gs.station_id
    }
    
    # 计算节点度数（仅用于元数据展示，不再作为枢纽判定条件）
    node_degree: Dict[str, int] = defaultdict(int)
    for p in all_pipelines:
        node_degree[p.start_station_id] += 1
        node_degree[p.end_station_id] += 1
    
    # 收集运行时枢纽白名单，并构造“超级节点”
    junction_station_ids: set[str] = set()
    junction_names: Dict[str, str] = {}  # station_id → 枢纽名
    station_to_junction_id: Dict[str, str] = {}
    station_to_junction_kind: Dict[str, str] = {}
    junction_nodes: Dict[str, Dict[str, Any]] = {}
    try:
        all_junctions = load_runtime_junction_groups(session)
        for jg in all_junctions:
            ids = jg["station_ids"]
            member_stations = [station_map[sid] for sid in ids if sid in station_map]
            if not member_stations:
                continue
            for sid in ids:
                junction_station_ids.add(sid)
                junction_names[sid] = jg["name"]
                station_to_junction_kind[sid] = jg.get("junction_kind", "junction")

            if len(member_stations) < 2:
                continue

            junction_id = f"JUNCTION-{jg['id']}"
            center_lng = sum(st.longitude for st in member_stations) / len(member_stations)
            center_lat = sum(st.latitude for st in member_stations) / len(member_stations)
            junction_nodes[junction_id] = {
                "id": junction_id,
                "name": jg["name"],
                "type": "junction",
                "rawType": "junction",
                "coordinate": {
                    "longitude": center_lng,
                    "latitude": center_lat,
                },
                "pressureLevel": "high",
                "status": "normal",
                "isHub": True,
                "properties": {
                    "rawType": "junction",
                    "junctionKind": jg.get("junction_kind", "junction"),
                    "sourceStationIds": ids,
                    "junctionId": jg["id"],
                    "sourceGroupIds": jg.get("raw_group_ids", []),
                    "systemIds": jg.get("system_ids", []),
                    "memberCount": jg.get("member_count", len(ids)),
                    "pipeline": jg["name"],
                },
                "hubInfo": {
                    "degree": len(ids),
                    "isJunction": True,
                    "junctionName": jg["name"],
                    "junctionKind": jg.get("junction_kind", "junction"),
                    "isMajorJunction": jg.get("junction_kind") == "major_junction",
                },
            }
            for sid in ids:
                station_to_junction_id[sid] = junction_id
    except Exception:
        pass  # junction_groups 表可能未创建
    
    # 按 ID 前缀分组站场和管段
    stations_by_prefix: Dict[str, List[Station]] = {}
    pipelines_by_prefix: Dict[str, List[Pipeline]] = {}
    
    for s in all_stations:
        parts = s.id.split('-')
        if len(parts) >= 3 and parts[1].startswith('B'):
            prefix = f"{parts[0]}-{parts[1]}"
        else:
            prefix = parts[0]
        stations_by_prefix.setdefault(prefix, []).append(s)
    
    for p in all_pipelines:
        parts = p.id.split('-')
        if len(parts) >= 3 and parts[1].startswith('B'):
            prefix = f"{parts[0]}-{parts[1]}"
        else:
            prefix = parts[0]
        pipelines_by_prefix.setdefault(prefix, []).append(p)
    
    # 组装结果
    result = []
    
    def _build_node(s: Station, layer_name: str) -> Dict[str, Any]:
        """构建节点字典（含枢纽标记和气源信息）"""
        degree = node_degree.get(s.id, 0)
        is_junction = s.id in junction_station_ids
        is_whitelist_hub = s.name in HUB_STATION_NAMES
        is_hub = is_junction or is_whitelist_hub
        
        # 检查是否关联气源
        gas_source = gas_source_by_station.get(s.id)
        
        node = {
            "id": s.id,
            "name": s.name,
            "type": _map_node_type_to_frontend(s.type),
            "rawType": s.type,
            "coordinate": {
                "longitude": s.longitude,
                "latitude": s.latitude,
            },
            "pressureLevel": "high",
            "status": "normal",
            "isHub": is_hub,
            "properties": {
                "pipeline": layer_name,
                "rawType": s.type,
                "layerName": layer_name,
                "rawSource": _parse_properties_json(s.properties),
            },
        }
        
        # 附加气源信息
        if gas_source:
            node["properties"]["gasSource"] = {
                "id": gas_source.id,
                "name": gas_source.name,
                "sourceType": gas_source.source_type,
                "capacityMcmPerDay": gas_source.capacity_mcm_per_day,
                "currentOutputMcmPerDay": gas_source.current_output_mcm_per_day,
                "status": gas_source.status,
            }
            # 气源节点默认标记为 isHub（供应侧关键节点）
            if not is_hub:
                node["isHub"] = True
                is_hub = True
        
        if is_hub:
            node["hubInfo"] = {
                "degree": degree,
                "isJunction": is_junction,
                "isWhitelistHub": is_whitelist_hub,
                "isGasSource": gas_source is not None,
                "junctionName": junction_names.get(s.id, ""),
                "junctionKind": station_to_junction_kind.get(s.id, "junction"),
                "isMajorJunction": station_to_junction_kind.get(s.id) == "major_junction",
            }
        return node

    def _build_display_node(display_id: str, layer_name: str) -> Optional[Dict[str, Any]]:
        """构建最终给前端的显示节点：普通站点或枢纽超级节点"""
        if display_id in junction_nodes:
            base = junction_nodes[display_id]
            node = {
                **base,
                "properties": {
                    **base.get("properties", {}),
                    "pipeline": layer_name,
                    "layerName": layer_name,
                },
            }
            return node

        station = station_map.get(display_id)
        if not station:
            return None
        return _build_node(station, layer_name)

    def _build_line_path_from_node_dict(start_node: Dict[str, Any], end_node: Dict[str, Any]) -> list:
        return [
            start_node["coordinate"],
            end_node["coordinate"],
        ]
    
    for system in systems:
        system_color = PIPELINE_SYSTEM_COLOR_OVERRIDES.get(system.id.lower(), system.color)
        layers_config = json.loads(system.layers_config) if system.layers_config else []
        
        package_layers = []
        for layer_cfg in layers_config:
            id_prefix = layer_cfg["id_prefix"]
            layer_stations = stations_by_prefix.get(id_prefix, [])
            layer_pipelines = pipelines_by_prefix.get(id_prefix, [])
            
            # 构建显示节点列表（带枢纽收缩）
            display_node_ids: set[str] = set()
            for station in layer_stations:
                display_node_ids.add(station_to_junction_id.get(station.id, station.id))
            for pipeline in layer_pipelines:
                display_node_ids.add(station_to_junction_id.get(pipeline.start_station_id, pipeline.start_station_id))
                display_node_ids.add(station_to_junction_id.get(pipeline.end_station_id, pipeline.end_station_id))

            nodes = []
            node_map_in_layer: Dict[str, Dict[str, Any]] = {}
            for display_id in display_node_ids:
                node = _build_display_node(display_id, layer_cfg["name"])
                if node is None:
                    continue
                nodes.append(node)
                node_map_in_layer[display_id] = node
            
            # 构建管段列表
            lines = []
            for p in layer_pipelines:
                pipeline_kind = _resolve_pipeline_kind(p.category, layer_cfg.get("type"))
                start_display_id = station_to_junction_id.get(p.start_station_id, p.start_station_id)
                end_display_id = station_to_junction_id.get(p.end_station_id, p.end_station_id)

                # 内部边被枢纽吸收，不再显示
                if start_display_id == end_display_id:
                    continue

                start_node = node_map_in_layer.get(start_display_id)
                end_node = node_map_in_layer.get(end_display_id)
                path = _build_line_path_from_node_dict(start_node, end_node) if start_node and end_node else []

                lines.append({
                    "id": p.id,
                    "name": p.name,
                    "startNodeId": start_display_id,
                    "endNodeId": end_display_id,
                    "path": path,
                    "pipelineKind": pipeline_kind,
                    "diameter": p.diameter or (int(p.diameter_mm) if p.diameter_mm else 1016),
                    "material": "Steel",
                    "pressureLevel": "high",
                    "length": p.length_km * 1000 if p.length_km else p.length,
                    "status": "normal",
                    "systemId": system.id,
                    "layerName": layer_cfg["name"],
                    "properties": {
                        "category": system.name,
                        "color": system_color,
                        "pipelineKind": pipeline_kind,
                        "systemId": system.id,
                        "layerName": layer_cfg["name"],
                        "rawCategory": p.category,
                        "rawSource": _parse_properties_json(p.properties),
                    },
                })
            
            package_layers.append({
                "id": f"{system.id}:{layer_cfg['type']}:{id_prefix}",
                "name": layer_cfg["name"],
                "type": layer_cfg["type"],
                "nodes": nodes,
                "lines": lines,
                "visible": layer_cfg.get("visible", True),
            })
        
        result.append({
            "id": system.id,
            "name": system.name,
            "color": system_color,
            "layers": package_layers,
        })
    
    return result


@router.get("/pipeline-packages/pilots/we1")
def get_we1_pilot_scopes() -> Dict[str, Any]:
    """返回 WE1 试点样板范围定义，供前后端和补数脚本统一使用。"""
    return {
        "system_id": "we1",
        "pilots": list_we1_pilots(),
    }


@router.get("/pipeline-packages/pilots/we1/{pilot_id}")
def get_we1_pilot_package(
    pilot_id: str,
    session: Session = Depends(get_session),
) -> Dict[str, Any]:
    """
    返回 WE1 指定试点样板的数据快照。

    当前阶段先提供：
    - 过滤后的样板拓扑包
    - 场景模板
    - 补数要求
    """
    try:
        pilot = get_we1_pilot_or_raise(pilot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"未找到 WE1 试点样板: {pilot_id}")

    packages = get_pipeline_packages(system_id="we1", session=session)
    if not packages:
        raise HTTPException(status_code=404, detail="未找到 WE1 管线数据包")

    system_package = packages[0]
    return build_pilot_package(system_package, pilot)


@router.get("/pipeline-packages/pilots/we1/{pilot_id}/seed")
def get_we1_pilot_seed(pilot_id: str) -> Dict[str, Any]:
    """返回 WE1 指定试点样板的机器可读 seed，供补数脚本和后续求解层共用。"""
    try:
        return get_we1_pilot_seed_or_raise(pilot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"未找到 WE1 试点样板: {pilot_id}")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"未找到 WE1 试点 seed: {exc}")


@router.get("/pipeline-packages/pilots/we1/{pilot_id}/solver-input")
def get_we1_pilot_solver_input(
    pilot_id: str,
    session: Session = Depends(get_session),
) -> Dict[str, Any]:
    """返回 WE1 指定试点样板的统一 solver input。"""
    try:
        pilot = get_we1_pilot_or_raise(pilot_id)
        seed_data = get_we1_pilot_seed_or_raise(pilot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"未找到 WE1 试点样板: {pilot_id}")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"未找到 WE1 试点 seed: {exc}")

    packages = get_pipeline_packages(system_id="we1", session=session)
    if not packages:
        raise HTTPException(status_code=404, detail="未找到 WE1 管线数据包")

    system_package = packages[0]
    pilot_package = build_pilot_package(system_package, pilot)
    return build_we1_solver_input(
        pilot=pilot,
        pilot_package=pilot_package,
        seed_data=seed_data,
    )
