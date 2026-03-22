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

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models import PipelineSystem, Station, Pipeline, JunctionGroup
from collections import defaultdict

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


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
    }
    return mapping.get(raw_type, "junction")


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
    
    # 预加载所有站场和管段（避免 N+1 查询）
    all_stations = session.exec(select(Station)).all()
    all_pipelines = session.exec(select(Pipeline)).all()
    
    # 构建站场索引（按 ID 快速查找）
    station_map: Dict[str, Station] = {s.id: s for s in all_stations}
    
    # 计算节点度数（用于枢纽标记）
    node_degree: Dict[str, int] = defaultdict(int)
    for p in all_pipelines:
        node_degree[p.start_station_id] += 1
        node_degree[p.end_station_id] += 1
    
    # 收集 junction_groups 中的枢纽站场
    junction_station_ids: set = set()
    junction_names: Dict[str, str] = {}  # station_id → 枢纽名
    try:
        all_junctions = session.exec(select(JunctionGroup)).all()
        for jg in all_junctions:
            ids = json.loads(jg.station_ids)
            for sid in ids:
                junction_station_ids.add(sid)
                junction_names[sid] = jg.name
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
        """构建节点字典（含枢纽标记）"""
        degree = node_degree.get(s.id, 0)
        is_junction = s.id in junction_station_ids
        is_hub = (degree >= 3 and s.type != 'valve') or is_junction
        
        node = {
            "id": s.id,
            "name": s.name,
            "type": _map_node_type_to_frontend(s.type),
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
            },
        }
        if is_hub:
            node["hubInfo"] = {
                "degree": degree,
                "isJunction": is_junction,
                "junctionName": junction_names.get(s.id, ""),
            }
        return node
    
    for system in systems:
        layers_config = json.loads(system.layers_config) if system.layers_config else []
        
        package_layers = []
        for layer_cfg in layers_config:
            id_prefix = layer_cfg["id_prefix"]
            layer_stations = stations_by_prefix.get(id_prefix, [])
            layer_pipelines = pipelines_by_prefix.get(id_prefix, [])
            
            # 构建节点列表（按前缀归属的站场）
            node_ids_in_layer = set()
            nodes = []
            for s in layer_stations:
                nodes.append(_build_node(s, layer_cfg["name"]))
                node_ids_in_layer.add(s.id)
            
            # 构建管段列表
            lines = []
            for p in layer_pipelines:
                start_s = station_map.get(p.start_station_id)
                end_s = station_map.get(p.end_station_id)
                
                # 构建路径
                path = []
                if start_s and end_s:
                    path = _build_line_path(start_s, end_s)
                
                lines.append({
                    "id": p.id,
                    "name": p.name,
                    "startNodeId": p.start_station_id,
                    "endNodeId": p.end_station_id,
                    "path": path,
                    "diameter": p.diameter or (int(p.diameter_mm) if p.diameter_mm else 1016),
                    "material": "Steel",
                    "pressureLevel": "high",
                    "length": p.length_km * 1000 if p.length_km else p.length,
                    "status": "normal",
                    "properties": {
                        "category": system.name,
                        "color": system.color,
                    },
                })
            
            # 补充支线管段引用的共享站场（SJ4 等管线中支线与干线共用节点）
            for p in layer_pipelines:
                for ref_id in [p.start_station_id, p.end_station_id]:
                    if ref_id not in node_ids_in_layer:
                        ref_s = station_map.get(ref_id)
                        if ref_s:
                            nodes.append(_build_node(ref_s, layer_cfg["name"]))
                            node_ids_in_layer.add(ref_id)
            
            package_layers.append({
                "name": layer_cfg["name"],
                "type": layer_cfg["type"],
                "nodes": nodes,
                "lines": lines,
                "visible": layer_cfg.get("visible", True),
            })
        
        result.append({
            "id": system.id,
            "name": system.name,
            "color": system.color,
            "layers": package_layers,
        })
    
    return result
