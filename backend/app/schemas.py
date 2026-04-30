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

# ============ 仿真模型 (阶段一) ============

class SimulationRequest(BaseModel):
    """断流推演请求"""
    failure_node_id: str                    # 故障节点 ID
    failure_type: str = "complete"          # complete / partial
    max_ticks: int = 500                    # 最大推演步数

class SimulationFrame(BaseModel):
    """推演时间轴帧"""
    tick: int
    timestamp: str
    changed_pipes: dict                     # pipe_id → {from, to, pipe_name}

class SimulationResponse(BaseModel):
    """断流推演响应"""
    total_ticks: int
    affected_pipes: int
    frames: List[SimulationFrame]

class TopologySummary(BaseModel):
    """拓扑概览"""
    nodes: int
    edges: int
    total_linepack_m3: float
    is_directed: bool


# ============ 气源模型 ============

class GasSourceBase(BaseModel):
    """气源基础模型"""
    id: str
    name: str
    station_id: Optional[str] = None
    source_type: str = "domestic"
    capacity_mcm_per_day: Optional[float] = None
    current_output_mcm_per_day: Optional[float] = None
    proven_reserves_tcm: Optional[float] = None
    reserve_years: Optional[float] = None
    operator: Optional[str] = None
    province: Optional[str] = None
    status: str = "active"
    properties: Optional[str] = None


class GasSourceCreate(BaseModel):
    """创建气源请求"""
    id: str
    name: str
    station_id: Optional[str] = None
    source_type: str = "domestic"
    capacity_mcm_per_day: Optional[float] = None
    current_output_mcm_per_day: Optional[float] = None
    proven_reserves_tcm: Optional[float] = None
    reserve_years: Optional[float] = None
    operator: Optional[str] = None
    province: Optional[str] = None
    status: str = "active"
    properties: Optional[str] = None


class GasSourceUpdate(BaseModel):
    """更新气源请求"""
    name: Optional[str] = None
    station_id: Optional[str] = None
    source_type: Optional[str] = None
    capacity_mcm_per_day: Optional[float] = None
    current_output_mcm_per_day: Optional[float] = None
    proven_reserves_tcm: Optional[float] = None
    reserve_years: Optional[float] = None
    operator: Optional[str] = None
    province: Optional[str] = None
    status: Optional[str] = None
    properties: Optional[str] = None


class GasSourceResponse(GasSourceBase):
    """气源响应模型"""
    pass
