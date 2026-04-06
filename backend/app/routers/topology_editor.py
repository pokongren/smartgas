"""
拓扑图编辑器 API - 可视化拓扑管理

功能：
1. 获取所有站点和管线数据（带拓扑状态）
2. 创建/删除拓扑连接
3. 验证拓扑合法性
4. 批量保存拓扑修改
"""

import os

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List, Optional, Dict, Any
from pydantic import BaseModel

from app.database import get_session
from app.models import Station, Pipeline, JunctionGroup
from app.services.junction_groups import (
    build_manual_overlay_description,
    expand_station_ids_for_request,
    find_conflicting_manual_overlay_groups,
    load_runtime_junction_groups,
    validate_manual_overlay_station_span,
)
from app.services.position_commit import PositionCommitService
from app.services.topology import TopologyService

router = APIRouter(prefix="/api/topology", tags=["拓扑编辑器"])


MANUAL_JUNCTION_EDIT_ENABLED = os.getenv("TOPOLOGY_MANUAL_JUNCTION_EDIT", "1") == "1"
MANUAL_JUNCTION_EDIT_HINT = (
    "当前枢纽由运行时重编结果维护，手工 merge/创建/删除已降级为只读。"
    "如需关闭，请设置 TOPOLOGY_MANUAL_JUNCTION_EDIT=0 后重启后端。"
)


def ensure_manual_junction_edit_enabled() -> None:
    if MANUAL_JUNCTION_EDIT_ENABLED:
        return
    raise HTTPException(status_code=409, detail=MANUAL_JUNCTION_EDIT_HINT)


# ============ 请求/响应模型 ============

class StationNode(BaseModel):
    """站点节点"""
    id: str
    name: str
    type: str
    longitude: float
    latitude: float
    # 拓扑状态
    has_topology: bool  # 是否有连接
    connection_count: int  # 连接数
    is_isolated: bool  # 是否孤立（在网状结构中可能是正常的）


class PipelineEdge(BaseModel):
    """管线边"""
    id: str
    name: str
    start_station_id: str
    end_station_id: str
    start_station_name: str
    end_station_name: str
    length_km: float
    diameter_mm: Optional[float] = None
    category: str = 'branch'
    # 拓扑状态
    is_orphan: bool  # 是否是孤立连接（端点不存在）


class TopologyData(BaseModel):
    """完整拓扑数据"""
    nodes: List[StationNode]
    edges: List[PipelineEdge]
    stats: Dict[str, Any]


class CreateConnectionRequest(BaseModel):
    """创建连接请求"""
    start_station_id: str
    end_station_id: str
    name: Optional[str] = None
    length_km: float = 0.0
    diameter_mm: Optional[float] = None
    category: str = 'branch'


class UpdateConnectionRequest(BaseModel):
    """更新连接请求"""
    pipeline_id: str
    start_station_id: Optional[str] = None
    end_station_id: Optional[str] = None
    name: Optional[str] = None
    length_km: Optional[float] = None


class BatchTopologyRequest(BaseModel):
    """批量拓扑操作请求"""
    create: List[CreateConnectionRequest] = []
    update: List[UpdateConnectionRequest] = []
    delete: List[str] = []  # pipeline_ids to delete


class TopologyValidationResult(BaseModel):
    """拓扑验证结果"""
    is_valid: bool
    errors: List[Dict[str, Any]]
    warnings: List[Dict[str, Any]]


class ConnectionSuggestion(BaseModel):
    """连接建议"""
    station_id: str
    station_name: str
    suggested_connections: List[Dict[str, Any]]


# ============ API 路由 ============

@router.get("/graph")
def get_topology_graph(session: Session = Depends(get_session)):
    """获取整合与捏合后的运行时计算图 (供可视化与仿真使用)"""
    service = TopologyService(session)
    # 获取计算图对象（内部已聚合 JunctionGroup）
    graph_obj = service.get_computation_graph(directed=True)
    
    # 组装为前端 D3/Canvas 画布所需结构
    from app.services.topology_computation import TopologyMetrics
    
    nodes_data = []
    # 获取所有在图中的节点ID（有边相连）来判断孤立
    connected_ids = set()
    for e in graph_obj._edges.values():
        connected_ids.add(e.source)
        connected_ids.add(e.target)
        
    for nid, node in graph_obj._nodes.items():
        nd = node.to_dict()
        nd["hasConnection"] = nid in connected_ids
        nd["designPressure"] = nd.get("pressure_mpa")
        # 对部分特供前端的名称做修改 (如: type, name)
        nodes_data.append(nd)
        
    edges_data = []
    for e in graph_obj._edges.values():
        ed = e.to_dict()
        ed["category"] = ed.get("type", "branch")
        ed["diameterMm"] = ed.get("diameter_mm")
        ed["lengthKm"] = ed.get("length_km")
        edges_data.append(ed)
        
    isolated = [n["id"] for n in nodes_data if not n["hasConnection"]]
    
    try:
        critical_nodes = list(service.find_critical_nodes().keys())
    except Exception:
        critical_nodes = []
        
    return {
        "nodes": nodes_data,
        "edges": edges_data,
        "isolatedNodes": isolated,
        "criticalNodes": critical_nodes,
        "stats": {
            "nodeCount": graph_obj.node_count,
            "edgeCount": graph_obj.edge_count,
            "isolatedCount": len(isolated),
            "componentCount": 1
        }
    }

@router.get("/editor-data", response_model=TopologyData)
def get_editor_data(session: Session = Depends(get_session)):
    """
    获取拓扑编辑器所需的所有数据
    
    包含：
    - 所有站点节点（带拓扑状态标记）
    - 所有管线连接（带孤立状态标记）
    - 统计信息
    """
    # 获取所有站点
    stations = session.exec(select(Station)).all()
    station_map = {s.id: s for s in stations}
    
    # 获取所有管线
    pipelines = session.exec(select(Pipeline)).all()
    
    # 计算每个站点的连接数
    connection_counts: Dict[str, int] = {}
    for p in pipelines:
        connection_counts[p.start_station_id] = connection_counts.get(p.start_station_id, 0) + 1
        connection_counts[p.end_station_id] = connection_counts.get(p.end_station_id, 0) + 1
    
    # 构建节点列表
    nodes = []
    for s in stations:
        count = connection_counts.get(s.id, 0)
        nodes.append(StationNode(
            id=s.id,
            name=s.name,
            type=s.type,
            longitude=s.longitude,
            latitude=s.latitude,
            has_topology=count > 0,
            connection_count=count,
            is_isolated=count == 0  # 孤立节点在网状结构中可能需要关注
        ))
    
    # 构建边列表
    edges = []
    for p in pipelines:
        start_exists = p.start_station_id in station_map
        end_exists = p.end_station_id in station_map
        
        edges.append(PipelineEdge(
            id=p.id,
            name=p.name,
            start_station_id=p.start_station_id,
            end_station_id=p.end_station_id,
            start_station_name=station_map.get(p.start_station_id, Station(name="[不存在]")).name if start_exists else "[站点不存在]",
            end_station_name=station_map.get(p.end_station_id, Station(name="[不存在]")).name if end_exists else "[站点不存在]",
            length_km=p.length_km or p.length or 0.0,
            diameter_mm=p.diameter_mm or (float(p.diameter) if p.diameter else None),
            category=p.category,
            is_orphan=not (start_exists and end_exists)
        ))
    
    # 统计信息
    orphan_edges = [e for e in edges if e.is_orphan]
    isolated_nodes = [n for n in nodes if n.is_isolated]
    
    stats = {
        "total_nodes": len(nodes),
        "total_edges": len(edges),
        "connected_nodes": len(nodes) - len(isolated_nodes),
        "isolated_nodes": len(isolated_nodes),
        "orphan_edges": len(orphan_edges),
        "error_count": len(orphan_edges) + len(isolated_nodes)
    }
    
    return TopologyData(nodes=nodes, edges=edges, stats=stats)


@router.post("/connection", response_model=PipelineEdge)
def create_connection(
    request: CreateConnectionRequest,
    session: Session = Depends(get_session)
):
    """创建新的拓扑连接（管线）"""
    # 验证站点存在
    start_station = session.get(Station, request.start_station_id)
    end_station = session.get(Station, request.end_station_id)
    
    if not start_station:
        raise HTTPException(status_code=404, detail=f"起点站点不存在: {request.start_station_id}")
    if not end_station:
        raise HTTPException(status_code=404, detail=f"终点站点不存在: {request.end_station_id}")
    if request.start_station_id == request.end_station_id:
        raise HTTPException(status_code=400, detail="起点和终点不能相同")
    
    # 检查是否已存在相同连接
    existing = session.exec(
        select(Pipeline).where(
            (Pipeline.start_station_id == request.start_station_id) &
            (Pipeline.end_station_id == request.end_station_id)
        )
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="该连接已存在")
    
    # 生成管线名称
    name = request.name or f"{start_station.name}-{end_station.name}管线"
    
    # 创建管线
    pipeline = Pipeline(
        id=f"pipe_{request.start_station_id}_{request.end_station_id}",
        name=name,
        start_station_id=request.start_station_id,
        end_station_id=request.end_station_id,
        length_km=request.length_km,
        diameter_mm=request.diameter_mm,
        category=request.category
    )
    
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)
    
    return PipelineEdge(
        id=pipeline.id,
        name=pipeline.name,
        start_station_id=pipeline.start_station_id,
        end_station_id=pipeline.end_station_id,
        start_station_name=start_station.name,
        end_station_name=end_station.name,
        length_km=pipeline.length_km or 0.0,
        diameter_mm=pipeline.diameter_mm,
        category=pipeline.category,
        is_orphan=False
    )


@router.delete("/connection/{pipeline_id}")
def delete_connection(pipeline_id: str, session: Session = Depends(get_session)):
    """删除拓扑连接"""
    pipeline = session.get(Pipeline, pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="管线不存在")
    
    session.delete(pipeline)
    session.commit()
    
    return {"message": "连接已删除", "pipeline_id": pipeline_id}


@router.put("/connection/{pipeline_id}", response_model=PipelineEdge)
def update_connection(
    pipeline_id: str,
    request: UpdateConnectionRequest,
    session: Session = Depends(get_session)
):
    """更新拓扑连接"""
    pipeline = session.get(Pipeline, pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="管线不存在")
    
    # 更新字段
    if request.start_station_id:
        if not session.get(Station, request.start_station_id):
            raise HTTPException(status_code=404, detail="起点站点不存在")
        pipeline.start_station_id = request.start_station_id
    
    if request.end_station_id:
        if not session.get(Station, request.end_station_id):
            raise HTTPException(status_code=404, detail="终点站点不存在")
        pipeline.end_station_id = request.end_station_id
    
    if request.name:
        pipeline.name = request.name
    if request.length_km is not None:
        pipeline.length_km = request.length_km
    
    session.commit()
    session.refresh(pipeline)
    
    start_station = session.get(Station, pipeline.start_station_id)
    end_station = session.get(Station, pipeline.end_station_id)
    
    return PipelineEdge(
        id=pipeline.id,
        name=pipeline.name,
        start_station_id=pipeline.start_station_id,
        end_station_id=pipeline.end_station_id,
        start_station_name=start_station.name if start_station else "[不存在]",
        end_station_name=end_station.name if end_station else "[不存在]",
        length_km=pipeline.length_km or 0.0,
        diameter_mm=pipeline.diameter_mm,
        category=pipeline.category,
        is_orphan=not (start_station and end_station)
    )


@router.post("/batch", response_model=Dict[str, Any])
def batch_update_topology(
    request: BatchTopologyRequest,
    session: Session = Depends(get_session)
):
    """批量更新拓扑"""
    results = {
        "created": [],
        "updated": [],
        "deleted": [],
        "errors": []
    }
    
    # 处理删除
    for pipeline_id in request.delete:
        try:
            pipeline = session.get(Pipeline, pipeline_id)
            if pipeline:
                session.delete(pipeline)
                results["deleted"].append(pipeline_id)
        except Exception as e:
            results["errors"].append({"operation": "delete", "id": pipeline_id, "error": str(e)})
    
    # 处理创建
    for conn in request.create:
        try:
            start_station = session.get(Station, conn.start_station_id)
            end_station = session.get(Station, conn.end_station_id)
            
            if not start_station or not end_station:
                results["errors"].append({
                    "operation": "create",
                    "error": f"站点不存在: {conn.start_station_id} -> {conn.end_station_id}"
                })
                continue
            
            pipeline = Pipeline(
                id=f"pipe_{conn.start_station_id}_{conn.end_station_id}_{hash(conn.name)}",
                name=conn.name or f"{start_station.name}-{end_station.name}管线",
                start_station_id=conn.start_station_id,
                end_station_id=conn.end_station_id,
                length_km=conn.length_km,
                diameter_mm=conn.diameter_mm,
                category=conn.category
            )
            session.add(pipeline)
            results["created"].append(pipeline.id)
        except Exception as e:
            results["errors"].append({"operation": "create", "error": str(e)})
    
    session.commit()
    return results


@router.get("/validate", response_model=TopologyValidationResult)
def validate_topology(session: Session = Depends(get_session)):
    """
    验证拓扑合法性
    
    检查项：
    1. 孤立管线（端点不存在）
    2. 孤立站点（无连接）
    3. 重复连接
    4. 自环连接
    """
    errors = []
    warnings = []
    
    stations = session.exec(select(Station)).all()
    station_ids = {s.id for s in stations}
    station_map = {s.id: s for s in stations}
    
    pipelines = session.exec(select(Pipeline)).all()
    
    # 检查孤立管线
    for p in pipelines:
        if p.start_station_id not in station_ids:
            errors.append({
                "type": "orphan_start",
                "pipeline_id": p.id,
                "pipeline_name": p.name,
                "missing_station_id": p.start_station_id,
                "message": f"管线 '{p.name}' 的起点站点不存在"
            })
        if p.end_station_id not in station_ids:
            errors.append({
                "type": "orphan_end",
                "pipeline_id": p.id,
                "pipeline_name": p.name,
                "missing_station_id": p.end_station_id,
                "message": f"管线 '{p.name}' 的终点站点不存在"
            })
    
    # 检查孤立站点（在网状结构中可能是警告而非错误）
    connected_stations = set()
    for p in pipelines:
        connected_stations.add(p.start_station_id)
        connected_stations.add(p.end_station_id)
    
    for s in stations:
        if s.id not in connected_stations:
            warnings.append({
                "type": "isolated_station",
                "station_id": s.id,
                "station_name": s.name,
                "message": f"站点 '{s.name}' 没有拓扑连接（孤立节点）"
            })
    
    # 检查重复连接
    connection_pairs = {}
    for p in pipelines:
        pair = tuple(sorted([p.start_station_id, p.end_station_id]))
        if pair in connection_pairs:
            warnings.append({
                "type": "duplicate_connection",
                "pipeline_id": p.id,
                "existing_id": connection_pairs[pair],
                "message": f"站点间存在重复连接: {p.name}"
            })
        else:
            connection_pairs[pair] = p.id
    
    # 检查自环
    for p in pipelines:
        if p.start_station_id == p.end_station_id:
            errors.append({
                "type": "self_loop",
                "pipeline_id": p.id,
                "message": f"管线 '{p.name}' 起点和终点相同（自环）"
            })
    
    return TopologyValidationResult(
        is_valid=len(errors) == 0,
        errors=errors,
        warnings=warnings
    )


@router.get("/suggestions/{station_id}", response_model=ConnectionSuggestion)
def get_connection_suggestions(
    station_id: str,
    max_distance_km: float = 50.0,
    session: Session = Depends(get_session)
):
    """
    获取连接建议
    
    基于地理距离推荐可能的连接
    """
    from math import radians, sin, cos, sqrt, atan2
    
    def haversine_distance(lat1, lon1, lat2, lon2):
        """计算两点间距离（公里）"""
        R = 6371  # 地球半径
        lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * atan2(sqrt(a), sqrt(1-a))
        return R * c
    
    station = session.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=404, detail="站点不存在")
    
    # 获取已连接的站点
    pipelines = session.exec(select(Pipeline)).all()
    connected_ids = set()
    for p in pipelines:
        if p.start_station_id == station_id:
            connected_ids.add(p.end_station_id)
        if p.end_station_id == station_id:
            connected_ids.add(p.start_station_id)
    
    # 查找附近的未连接站点
    all_stations = session.exec(select(Station)).all()
    suggestions = []
    
    for s in all_stations:
        if s.id == station_id or s.id in connected_ids:
            continue
        
        distance = haversine_distance(
            station.latitude, station.longitude,
            s.latitude, s.longitude
        )
        
        if distance <= max_distance_km:
            suggestions.append({
                "station_id": s.id,
                "station_name": s.name,
                "station_type": s.type,
                "distance_km": round(distance, 2),
                "longitude": s.longitude,
                "latitude": s.latitude
            })
    
    # 按距离排序
    suggestions.sort(key=lambda x: x["distance_km"])
    
    return ConnectionSuggestion(
        station_id=station_id,
        station_name=station.name,
        suggested_connections=suggestions[:10]  # 最多返回10个
    )


@router.get("/stats")
def get_topology_stats(session: Session = Depends(get_session)):
    """获取拓扑统计信息"""
    service = TopologyService(session)
    summary = service.get_graph_summary()
    
    stations = session.exec(select(Station)).all()
    pipelines = session.exec(select(Pipeline)).all()
    
    # 按类型统计
    station_types = {}
    for s in stations:
        station_types[s.type] = station_types.get(s.type, 0) + 1
    
    # 干线/支线统计
    trunk_count = sum(1 for p in pipelines if p.category == 'trunk')
    branch_count = sum(1 for p in pipelines if p.category == 'branch')
    
    return {
        "graph_summary": summary,
        "station_count": len(stations),
        "station_types": station_types,
        "pipeline_count": len(pipelines),
        "trunk_pipelines": trunk_count,
        "branch_pipelines": branch_count
    }


# ============ 坐标保存 ============

class UpdatePositionRequest(BaseModel):
    """更新站场坐标"""
    longitude: float
    latitude: float


class BatchUpdatePositionRequest(BaseModel):
    """批量更新坐标"""
    updates: List[Dict[str, Any]]  # [{id, longitude, latitude}, ...]


class PositionCommitItem(BaseModel):
    id: str
    longitude: float
    latitude: float


class PositionCommitRequest(BaseModel):
    updates: List[PositionCommitItem]
    cascade_valves: bool = True
    cascade_scope: str = 'segment'


@router.put("/station/{station_id}/position")
def update_station_position(
    station_id: str,
    request: UpdatePositionRequest,
    session: Session = Depends(get_session)
):
    """前端拖拽节点后保存坐标到数据库"""
    station = session.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=404, detail=f"站场不存在: {station_id}")
    
    old_lng, old_lat = station.longitude, station.latitude
    station.longitude = request.longitude
    station.latitude = request.latitude
    session.commit()
    TopologyService(session).refresh()
    
    return {
        "message": f"{station.name} 坐标已更新",
        "station_id": station_id,
        "old": {"longitude": old_lng, "latitude": old_lat},
        "new": {"longitude": request.longitude, "latitude": request.latitude}
    }


@router.put("/stations/batch-position")
def batch_update_positions(
    request: BatchUpdatePositionRequest,
    session: Session = Depends(get_session)
):
    """批量保存多个节点的坐标修改"""
    results = {"updated": [], "errors": []}
    
    for item in request.updates:
        sid = item.get("id")
        station = session.get(Station, sid)
        if not station:
            results["errors"].append({"id": sid, "error": "站场不存在"})
            continue
        station.longitude = item["longitude"]
        station.latitude = item["latitude"]
        results["updated"].append(sid)
    
    session.commit()
    TopologyService(session).refresh()
    return results


@router.put("/positions/commit")
def commit_positions(
    request: PositionCommitRequest,
    session: Session = Depends(get_session)
):
    """提交地图拓扑页的点位编辑，并按区段联动阀室坐标"""
    service = PositionCommitService(session)
    result = service.commit(
        updates=[item.model_dump() for item in request.updates],
        cascade_valves=request.cascade_valves,
        cascade_scope=request.cascade_scope,
    )
    TopologyService(session).refresh()

    return {
        "message": "点位保存成功",
        **result,
    }


@router.post("/positions/preview")
def preview_positions(
    request: PositionCommitRequest,
    session: Session = Depends(get_session)
):
    """预览点位提交会影响哪些区段和阀室，不真正写库"""
    service = PositionCommitService(session)
    result = service.commit(
        updates=[item.model_dump() for item in request.updates],
        cascade_valves=request.cascade_valves,
        cascade_scope=request.cascade_scope,
        preview_only=True,
    )

    return {
        "message": "点位影响预览",
        **result,
    }


# ============ 合建站（两站合并） ============

class MergeStationsRequest(BaseModel):
    """合并两个站场为合建站"""
    keep_station_id: str       # 保留的站场 ID
    remove_station_id: str     # 被移除的站场 ID
    new_name: Optional[str] = None  # 合建站新名称，默认 "A/B合建站"


@router.post("/merge-stations")
def merge_stations(
    request: MergeStationsRequest,
    session: Session = Depends(get_session)
):
    """
    合并两个站场为合建站
    
    逻辑：
    1. 保留 keep_station，重命名为合建站
    2. 将 remove_station 的所有管段端点重定向到 keep_station
    3. 删除 remove_station
    4. 自动创建 junction_group 记录
    5. 删除因合并产生的自环管段
    """
    ensure_manual_junction_edit_enabled()

    import json as json_mod
    from app.models import JunctionGroup
    
    keep = session.get(Station, request.keep_station_id)
    remove = session.get(Station, request.remove_station_id)
    
    if not keep:
        raise HTTPException(status_code=404, detail=f"保留站场不存在: {request.keep_station_id}")
    if not remove:
        raise HTTPException(status_code=404, detail=f"移除站场不存在: {request.remove_station_id}")
    if request.keep_station_id == request.remove_station_id:
        raise HTTPException(status_code=400, detail="不能合并同一个站场")
    
    # 记录原始信息
    old_keep_name = keep.name
    old_remove_name = remove.name
    
    # 1. 重命名保留站场
    merged_name = request.new_name or f"{old_keep_name}/{old_remove_name}合建站"
    keep.name = merged_name
    
    # 2. 重定向所有管段引用
    all_pipelines = session.exec(select(Pipeline)).all()
    redirected = 0
    self_loops_removed = 0
    
    for p in all_pipelines:
        changed = False
        if p.start_station_id == request.remove_station_id:
            p.start_station_id = request.keep_station_id
            changed = True
        if p.end_station_id == request.remove_station_id:
            p.end_station_id = request.keep_station_id
            changed = True
        
        if changed:
            redirected += 1
            # 检查是否因合并产生自环
            if p.start_station_id == p.end_station_id:
                session.delete(p)
                self_loops_removed += 1
    
    # 3. 删除被移除的站场
    session.delete(remove)
    
    # 4. 创建 junction_group 记录
    try:
        junction = JunctionGroup(
            name=merged_name,
            description=build_manual_overlay_description(
                f"merge_stations:{old_keep_name}+{old_remove_name}",
                source="merge_stations",
            ),
            station_ids=json_mod.dumps([request.keep_station_id])
        )
        session.add(junction)
    except Exception:
        pass  # junction_groups 表可能未创建
    
    session.commit()
    
    return {
        "message": f"合并成功: {old_keep_name} + {old_remove_name} → {merged_name}",
        "kept_station": {
            "id": request.keep_station_id,
            "old_name": old_keep_name,
            "new_name": merged_name,
        },
        "removed_station": {
            "id": request.remove_station_id,
            "name": old_remove_name,
        },
        "pipelines_redirected": redirected,
        "self_loops_removed": self_loops_removed,
    }

# ============ 枢纽组(JunctionGroup)捏合与查询 ============

class CreateJunctionGroupRequest(BaseModel):
    name: str
    description: Optional[str] = None
    station_ids: List[str]
    append_mode: bool = True
    target_junction_id: Optional[int] = None


def _dedupe_station_ids(values: List[str]) -> List[str]:
    seen: set[str] = set()
    deduped: List[str] = []
    for value in values:
        normalized = str(value).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


def _collect_conflict_group_ids(conflicts: List[Dict[str, Any]]) -> List[int]:
    group_ids: List[int] = []
    for conflict in conflicts:
        raw_ids = conflict.get("raw_group_ids") or []
        if raw_ids:
            for raw_id in raw_ids:
                try:
                    group_ids.append(int(raw_id))
                except Exception:
                    continue
            continue
        conflict_id = conflict.get("id")
        if conflict_id is None:
            continue
        try:
            group_ids.append(int(conflict_id))
        except Exception:
            continue
    return sorted(set(group_ids))

@router.post("/junctions")
def create_junction_group(
    request: CreateJunctionGroupRequest,
    session: Session = Depends(get_session)
):
    """
    在不删除原站场的情况下，将多个站场捏合为一个大枢纽节点
    """
    ensure_manual_junction_edit_enabled()

    import json
    
    normalized_station_ids = expand_station_ids_for_request(session, request.station_ids)

    if len(normalized_station_ids) < 2:
        raise HTTPException(status_code=400, detail="合并枢纽至少需要包含两个底层站场。")

    span_error = validate_manual_overlay_station_span(session, normalized_station_ids)
    if span_error:
        raise HTTPException(status_code=400, detail=span_error)

    conflicts = find_conflicting_manual_overlay_groups(session, normalized_station_ids)
    if conflicts:
        if not request.append_mode:
            conflict_names = "、".join(group["name"] for group in conflicts)
            raise HTTPException(
                status_code=409,
                detail=f"选中的站点已经存在手工捏合覆盖：{conflict_names}。请先拆分后再重建。",
            )

        conflict_group_ids = _collect_conflict_group_ids(conflicts)
        if not conflict_group_ids:
            raise HTTPException(status_code=409, detail="当前枢纽冲突数据不可用，请先拆分后再试。")

        target_group_id = request.target_junction_id if request.target_junction_id is not None else max(conflict_group_ids)
        if target_group_id not in conflict_group_ids:
            raise HTTPException(
                status_code=400,
                detail=f"目标枢纽 {target_group_id} 不在当前冲突范围内，无法追加。",
            )

        target_group = session.get(JunctionGroup, target_group_id)
        if not target_group:
            raise HTTPException(status_code=404, detail=f"目标枢纽 {target_group_id} 不存在。")

        merged_station_ids = _dedupe_station_ids(
            [
                *normalized_station_ids,
                *[
                    station_id
                    for conflict in conflicts
                    for station_id in conflict.get("station_ids", [])
                ],
            ]
        )
        if len(merged_station_ids) < 2:
            raise HTTPException(status_code=400, detail="追加后的枢纽至少需要两个站点。")

        span_error = validate_manual_overlay_station_span(session, merged_station_ids)
        if span_error:
            raise HTTPException(status_code=400, detail=span_error)

        target_group.name = (request.name or target_group.name).strip() or target_group.name
        target_group.description = build_manual_overlay_description(
            request.description or target_group.description,
            source="api_topology_junctions_append",
        )
        target_group.station_ids = json.dumps(merged_station_ids, ensure_ascii=False)

        removed_group_ids: List[int] = []
        for group_id in conflict_group_ids:
            if group_id == target_group_id:
                continue
            duplicate_group = session.get(JunctionGroup, group_id)
            if duplicate_group:
                session.delete(duplicate_group)
                removed_group_ids.append(group_id)

        session.add(target_group)
        session.commit()
        session.refresh(target_group)
        TopologyService(session).refresh()
        return {
            "message": f"枢纽 '{target_group.name}' 追加成功",
            "id": target_group.id,
            "mode": "appended",
            "member_count": len(merged_station_ids),
            "merged_group_ids": conflict_group_ids,
            "removed_group_ids": removed_group_ids,
        }
        
    junction = JunctionGroup(
        name=request.name,
        description=build_manual_overlay_description(
            request.description,
            source="api_topology_junctions_create",
        ),
        station_ids=json.dumps(normalized_station_ids, ensure_ascii=False)
    )
    session.add(junction)
    session.commit()
    session.refresh(junction)
    TopologyService(session).refresh()
    
    return {"message": f"枢纽 '{request.name}' 合并成功！", "id": junction.id, "mode": "created"}

@router.get("/junctions")
def get_junction_groups(session: Session = Depends(get_session)):
    """获取运行时枢纽群组（优先读取重编影子结果）"""
    return {
        "junctions": load_runtime_junction_groups(session),
        "manual_editing_enabled": MANUAL_JUNCTION_EDIT_ENABLED,
        "mode": "runtime_readonly" if not MANUAL_JUNCTION_EDIT_ENABLED else "legacy_editable",
    }


@router.delete("/junctions/{junction_id}")
def delete_junction_group(junction_id: int, session: Session = Depends(get_session)):
    """拆分枢纽：删除 JunctionGroup 记录，还原物理站点的独立显示"""
    ensure_manual_junction_edit_enabled()

    from app.models import JunctionGroup

    group = session.get(JunctionGroup, junction_id)
    if not group:
        raise HTTPException(status_code=404, detail=f"枢纽 {junction_id} 不存在")
    
    name = group.name
    session.delete(group)
    session.commit()
    TopologyService(session).refresh()
    return {"ok": True, "message": f"枢纽 '{name}' 已拆分还原"}
