from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from app.database import get_session
from app.models import Station, Pipeline
from typing import List, Dict, Any

router = APIRouter()

# ============ 查询接口 ============

@router.get("/stations", response_model=List[Station])
def get_stations(session: Session = Depends(get_session)):
    """获取所有站场"""
    stations = session.exec(select(Station)).all()
    return stations

@router.get("/stations/{station_id}", response_model=Station)
def get_station(station_id: str, session: Session = Depends(get_session)):
    """获取单个站场"""
    station = session.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=404, detail="站场不存在")
    return station

@router.get("/pipelines", response_model=List[Pipeline])
def get_pipelines(session: Session = Depends(get_session)):
    """获取所有管线"""
    pipelines = session.exec(select(Pipeline)).all()
    return pipelines

@router.get("/pipelines/{pipeline_id}", response_model=Pipeline)
def get_pipeline(pipeline_id: str, session: Session = Depends(get_session)):
    """获取单个管线"""
    pipeline = session.get(Pipeline, pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="管线不存在")
    return pipeline

# ============ 创建接口 ============

@router.post("/stations", response_model=Station)
def create_station(station: Station, session: Session = Depends(get_session)):
    """创建新站场
    
    示例请求:
    {
        "id": "node-013",
        "name": "重庆",
        "type": "distribution",
        "longitude": 106.55,
        "latitude": 29.56,
        "design_pressure": 6.0
    }
    """
    # 检查ID是否已存在
    existing = session.get(Station, station.id)
    if existing:
        raise HTTPException(status_code=400, detail=f"站场ID {station.id} 已存在")
    
    session.add(station)
    session.commit()
    session.refresh(station)
    return station

@router.post("/pipelines", response_model=Pipeline)
def create_pipeline(pipeline: Pipeline, session: Session = Depends(get_session)):
    """创建新管线
    
    示例请求:
    {
        "id": "line-012",
        "name": "重庆支线",
        "start_station_id": "node-003",
        "end_station_id": "node-013",
        "diameter": 508,
        "length": 320,
        "category": "其他"
    }
    """
    # 检查ID是否已存在
    existing = session.get(Pipeline, pipeline.id)
    if existing:
        raise HTTPException(status_code=400, detail=f"管线ID {pipeline.id} 已存在")
    
    # 检查起点和终点站场是否存在
    start_station = session.get(Station, pipeline.start_station_id)
    end_station = session.get(Station, pipeline.end_station_id)
    
    if not start_station:
        raise HTTPException(status_code=400, detail=f"起点站场 {pipeline.start_station_id} 不存在")
    if not end_station:
        raise HTTPException(status_code=400, detail=f"终点站场 {pipeline.end_station_id} 不存在")
    
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)
    return pipeline

# ============ 批量导入接口 ============

@router.post("/stations/batch")
def create_stations_batch(stations: List[Station], session: Session = Depends(get_session)):
    """批量创建站场"""
    created = []
    for station in stations:
        existing = session.get(Station, station.id)
        if not existing:
            session.add(station)
            created.append(station.id)
    
    session.commit()
    return {"created": len(created), "station_ids": created}

@router.post("/pipelines/batch")
def create_pipelines_batch(pipelines: List[Pipeline], session: Session = Depends(get_session)):
    """批量创建管线"""
    created = []
    for pipeline in pipelines:
        existing = session.get(Pipeline, pipeline.id)
        if not existing:
            session.add(pipeline)
            created.append(pipeline.id)
    
    session.commit()
    return {"created": len(created), "pipeline_ids": created}

# ============ 拓扑全景接口 ============

@router.get("/topology/graph")
def get_topology_graph(session: Session = Depends(get_session)) -> Dict[str, Any]:
    """获取拓扑全景数据，供前端力导向图渲染

    返回所有节点、连线、孤立节点、关键节点和统计信息。
    前端可据此一次性渲染完整的网络拓扑图。
    
    NOTE: 使用原生 SQL 查询管线数据，以兼容数据库 schema 与 ORM 模型不完全一致的情况。
    """
    import networkx as nx
    from sqlalchemy import text

    # 查询站场（Station 模型与表 schema 一致，可直接使用 ORM）
    stations = session.exec(select(Station)).all()

    # 查询管线（使用原生 SQL 避免 ORM 列映射错误）
    pipeline_rows = session.exec(
        text("SELECT id, name, start_station_id, end_station_id, diameter, length, category FROM pipelines")
    ).all()

    # 构建连接关系集合
    connected_station_ids: set[str] = set()
    for row in pipeline_rows:
        connected_station_ids.add(row[2])  # start_station_id
        connected_station_ids.add(row[3])  # end_station_id

    # 构建节点列表
    nodes = []
    for s in stations:
        nodes.append({
            "id": s.id,
            "name": s.name,
            "type": s.type,
            "longitude": s.longitude,
            "latitude": s.latitude,
            "designPressure": s.design_pressure,
            "capacity": s.capacity,
            "hasConnection": s.id in connected_station_ids,
        })

    # 构建边列表
    edges = []
    for row in pipeline_rows:
        edges.append({
            "id": row[0],
            "name": row[1],
            "source": row[2],
            "target": row[3],
            "category": row[6] or "branch",
            "diameterMm": float(row[4]) if row[4] else None,
            "lengthKm": float(row[5]) if row[5] else 0.0,
        })

    # 孤立节点
    isolated_ids = [s.id for s in stations if s.id not in connected_station_ids]

    # NOTE: 只用有连接的节点构建图，避免 3506 个孤立节点拖慢计算
    G = nx.Graph()
    for row in pipeline_rows:
        G.add_edge(row[2], row[3])

    critical_ids: list[str] = []
    if G.number_of_edges() > 0:
        betweenness = nx.betweenness_centrality(G)
        sorted_nodes = sorted(betweenness.items(), key=lambda x: x[1], reverse=True)
        critical_ids = [node_id for node_id, _ in sorted_nodes[:5]]

    # 连通分量数 = 图中的连通分量 + 孤立节点数（每个孤立节点就是一个独立分量）
    num_components = nx.number_connected_components(G) + len(isolated_ids)

    return {
        "nodes": nodes,
        "edges": edges,
        "isolatedNodes": isolated_ids,
        "criticalNodes": critical_ids,
        "stats": {
            "nodeCount": len(stations),
            "edgeCount": len(pipeline_rows),
            "isolatedCount": len(isolated_ids),
            "componentCount": num_components,
        },
    }


