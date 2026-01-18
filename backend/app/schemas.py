from pydantic import BaseModel
from typing import List, Optional

# ============ 请求模型 ============

class RouteAnalysisRequest(BaseModel):
    """路径分析请求"""
    source_station: str
    target_station: str
    scenario: str  # 'pipeline_break', 'maintenance'
    blocked_pipelines: Optional[List[str]] = []

class ImpactAnalysisRequest(BaseModel):
    """影响范围分析请求"""
    failed_pipeline: str
    failure_type: str  # 'complete_break', 'partial_damage'

class KnowledgeQueryRequest(BaseModel):
    """知识问答请求"""
    question: str

# ============ 响应模型 ============

class AlternativeRoute(BaseModel):
    """备用路径"""
    path: List[str]
    total_length: float
    estimated_time: str
    risk_level: str

class RouteAnalysisResponse(BaseModel):
    """路径分析响应"""
    alternative_routes: List[AlternativeRoute]
    affected_stations: List[str]
    recommendation: str

class ImpactArea(BaseModel):
    """影响区域"""
    stations: List[str]
    population: int
    industrial_users: int

class ImpactAnalysisResponse(BaseModel):
    """影响范围分析响应"""
    affected_area: ImpactArea
    supply_gap: str
    recovery_plan: str

class KnowledgeQueryResponse(BaseModel):
    """知识问答响应"""
    answer: str
    source: Optional[str]
    confidence: float
