"""
气源管理 API

提供气源数据的增删改查，供前端地图、拓扑、调度台使用。
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models import GasSource, Station
from app.schemas import GasSourceCreate, GasSourceUpdate, GasSourceResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


@router.get("/gas-sources", response_model=List[GasSourceResponse])
def list_gas_sources(
    province: Optional[str] = Query(None, description="按省份筛选"),
    source_type: Optional[str] = Query(None, description="按气源类型筛选"),
    status: Optional[str] = Query(None, description="按状态筛选"),
    session: Session = Depends(get_session),
):
    """获取所有气源列表"""
    query = select(GasSource)
    if province:
        query = query.where(GasSource.province == province)
    if source_type:
        query = query.where(GasSource.source_type == source_type)
    if status:
        query = query.where(GasSource.status == status)
    
    results = session.exec(query).all()
    return results


@router.get("/gas-sources/{source_id}", response_model=GasSourceResponse)
def get_gas_source(
    source_id: str,
    session: Session = Depends(get_session),
):
    """获取单个气源详情"""
    source = session.get(GasSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"未找到气源: {source_id}")
    return source


@router.post("/gas-sources", response_model=GasSourceResponse)
def create_gas_source(
    data: GasSourceCreate,
    session: Session = Depends(get_session),
):
    """创建气源"""
    # 检查 ID 是否已存在
    existing = session.get(GasSource, data.id)
    if existing:
        raise HTTPException(status_code=409, detail=f"气源 ID 已存在: {data.id}")
    
    # 如果提供了 station_id，检查关联站场是否存在
    if data.station_id:
        station = session.get(Station, data.station_id)
        if not station:
            raise HTTPException(status_code=400, detail=f"关联站场不存在: {data.station_id}")
    
    source = GasSource(**data.model_dump())
    session.add(source)
    session.commit()
    session.refresh(source)
    logger.info(f"创建气源: {source.name} ({source.id})")
    return source


@router.put("/gas-sources/{source_id}", response_model=GasSourceResponse)
def update_gas_source(
    source_id: str,
    data: GasSourceUpdate,
    session: Session = Depends(get_session),
):
    """更新气源"""
    source = session.get(GasSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"未找到气源: {source_id}")
    
    # 如果更新 station_id，检查关联站场是否存在
    if data.station_id:
        station = session.get(Station, data.station_id)
        if not station:
            raise HTTPException(status_code=400, detail=f"关联站场不存在: {data.station_id}")
    
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(source, key, value)
    
    session.add(source)
    session.commit()
    session.refresh(source)
    logger.info(f"更新气源: {source.name} ({source.id})")
    return source


@router.delete("/gas-sources/{source_id}")
def delete_gas_source(
    source_id: str,
    session: Session = Depends(get_session),
):
    """删除气源"""
    source = session.get(GasSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"未找到气源: {source_id}")
    
    session.delete(source)
    session.commit()
    logger.info(f"删除气源: {source_id}")
    return {"message": f"气源 {source_id} 已删除"}


@router.get("/gas-sources/stats/summary")
def gas_source_stats(
    session: Session = Depends(get_session),
):
    """气源统计摘要"""
    sources = session.exec(select(GasSource)).all()
    
    total_capacity = sum(
        s.capacity_mcm_per_day or 0 for s in sources
    )
    total_output = sum(
        s.current_output_mcm_per_day or 0 for s in sources
    )
    
    type_count = {}
    province_count = {}
    for s in sources:
        type_count[s.source_type] = type_count.get(s.source_type, 0) + 1
        if s.province:
            province_count[s.province] = province_count.get(s.province, 0) + 1
    
    return {
        "total_count": len(sources),
        "total_capacity_mcm_per_day": total_capacity,
        "total_output_mcm_per_day": total_output,
        "utilization_rate": round(total_output / total_capacity, 4) if total_capacity > 0 else 0,
        "type_distribution": type_count,
        "province_distribution": province_count,
    }
