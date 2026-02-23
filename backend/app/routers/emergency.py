from fastapi import APIRouter, Depends
from sqlmodel import Session
from app.database import get_session
from app.schemas import (
    RouteAnalysisRequest, RouteAnalysisResponse,
    ImpactAnalysisRequest, ImpactAnalysisResponse,
    KnowledgeQueryRequest, KnowledgeQueryResponse,
    ImpactArea,
    SimulationRequest, SimulationResponse, SimulationFrame,
    TopologySummary
)
from app.services.topology import TopologyService
from app.services.topology_service import PhysicsTopologyService
from app.services.simulation_service import SimulationEngine
from app.services.rag_mock import RAGService

router = APIRouter()

@router.post("/route-analysis", response_model=RouteAnalysisResponse)
def analyze_route(
    request: RouteAnalysisRequest,
    session: Session = Depends(get_session)
):
    """路径分析 - 寻找备用路径"""
    topo = TopologyService(session)
    
    routes = topo.find_alternative_routes(
        request.source_station,
        request.target_station,
        request.blocked_pipelines
    )
    
    affected = topo.calculate_impact_area(request.blocked_pipelines[0]) if request.blocked_pipelines else []
    
    return RouteAnalysisResponse(
        alternative_routes=routes,
        affected_stations=affected,
        recommendation="建议启用备用路径,并加强沿线监控"
    )

@router.post("/impact-analysis", response_model=ImpactAnalysisResponse)
def analyze_impact(
    request: ImpactAnalysisRequest,
    session: Session = Depends(get_session)
):
    """影响范围分析"""
    topo = TopologyService(session)
    
    affected_stations = topo.calculate_impact_area(request.failed_pipeline)
    
    return ImpactAnalysisResponse(
        affected_area=ImpactArea(
            stations=affected_stations,
            population=len(affected_stations) * 500000,  # 模拟数据
            industrial_users=len(affected_stations) * 50
        ),
        supply_gap="30%",
        recovery_plan="启动应急预案,调配周边管网资源"
    )

@router.post("/knowledge-query", response_model=KnowledgeQueryResponse)
def query_knowledge(request: KnowledgeQueryRequest):
    """RAG 知识问答"""
    rag = RAGService()
    result = rag.query(request.question)
    
    return KnowledgeQueryResponse(**result)

@router.get("/critical-nodes")
def get_critical_nodes(session: Session = Depends(get_session)):
    """获取关键节点"""
    topo = TopologyService(session)
    critical_nodes = topo.find_critical_nodes()
    
    return {"critical_nodes": critical_nodes}

# ============ 阶段一: 物理推演 API ============

@router.get("/topology-summary", response_model=TopologySummary)
def get_topology_summary(session: Session = Depends(get_session)):
    """
    获取物理拓扑概览

    返回节点数、边数、总管存等关键指标
    """
    topo = PhysicsTopologyService(session)
    summary = topo.get_graph_summary()
    return TopologySummary(**summary)

@router.post("/simulate-failure", response_model=SimulationResponse)
def simulate_failure(
    request: SimulationRequest,
    session: Session = Depends(get_session)
):
    """
    断流推演 — 返回时间轴帧序列

    模拟某个站场发生故障后，管存耗尽波及下游的传播过程。
    每个帧记录当前 Tick 的管线状态变化 (增量)。
    """
    topo = PhysicsTopologyService(session)
    engine = SimulationEngine()

    result = engine.run(
        graph=topo.graph,
        failure_node=request.failure_node_id,
        max_ticks=request.max_ticks,
    )

    raw = result.to_dict()
    return SimulationResponse(
        total_ticks=raw['total_ticks'],
        affected_pipes=raw['affected_pipes'],
        frames=[SimulationFrame(**f) for f in raw['frames']],
    )

