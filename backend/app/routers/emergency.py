from fastapi import APIRouter, Depends
from sqlmodel import Session
from app.database import get_session
from app.schemas import (
    RouteAnalysisRequest, RouteAnalysisResponse,
    ImpactAnalysisRequest, ImpactAnalysisResponse,
    KnowledgeQueryRequest, KnowledgeQueryResponse,
    ImpactArea
)
from app.services.topology import TopologyService
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
