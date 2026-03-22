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
