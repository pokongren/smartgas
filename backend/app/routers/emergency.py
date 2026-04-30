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
# NOTE: PhysicsTopologyService 已合并到 TopologyService 中
PhysicsTopologyService = TopologyService
from app.services.simulation_service import OptimizedSimulationEngine as SimulationEngine
from app.services.rag_mock import RAGService
import logging
from fastapi import HTTPException

# 配置当前模块日志
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

router = APIRouter()

@router.post("/route-analysis", response_model=RouteAnalysisResponse)
def analyze_route(
    request: RouteAnalysisRequest,
    session: Session = Depends(get_session)
):
    """
    路径分析 - 寻找备用路径
    
    通过图算法在屏蔽故障管线节点的基础上计算新的最短、可用的物理连通拓扑路径。
    使用场景：当发生管线泄漏或阻断时，快速得出物资或调气的备用方案。
    """
    logger.info(f"开始路径分析: 从 {request.source_station} 到 {request.target_station}")
    try:
        topo = TopologyService(session)
        
        routes = topo.find_alternative_routes(
            request.source_station,
            request.target_station,
            request.blocked_pipelines
        )
        
        affected = topo.calculate_impact_area(request.blocked_pipelines[0]) if request.blocked_pipelines else []
        
        logger.info(f"路径分析完成，找到 {len(routes)} 条备选路径")
        return RouteAnalysisResponse(
            alternative_routes=routes,
            affected_stations=affected,
            recommendation="建议启用备用路径,并加强沿线监控"
        )
    except Exception as e:
        logger.error(f"路径分析失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="执行路径分析过程中发生内部错误")

@router.post("/impact-analysis", response_model=ImpactAnalysisResponse)
def analyze_impact(
    request: ImpactAnalysisRequest,
    session: Session = Depends(get_session)
):
    """
    影响范围分析
    
    计算故障管段可能波及的所有直接与间接下游站点。
    """
    logger.info(f"开始分析故障管线影响: {request.failed_pipeline}")
    try:
        topo = TopologyService(session)
        
        affected_stations = topo.calculate_impact_area(request.failed_pipeline)
        
        logger.info(f"影响范围分析完毕: 共波及 {len(affected_stations)} 个站点")
        # TODO: 人口与工业用户数需接入真实业务模型，当前使用保守估算
        # 保守估算：每个受影响场站平均服务约5万人口和5个工业用户
        estimated_population = len(affected_stations) * 50000 if affected_stations else 0
        estimated_industrial = len(affected_stations) * 5 if affected_stations else 0
        
        return ImpactAnalysisResponse(
            affected_area=ImpactArea(
                stations=affected_stations,
                population=estimated_population,
                industrial_users=estimated_industrial
            ),
            supply_gap="待计算",
            recommendation="启动应急预案,调配周边管网资源",
            recovery_plan="启动应急预案,调配周边管网资源"
        )
    except Exception as e:
        logger.error(f"影响范围分析失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="执行影响分析过程中出错")

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
    主要用于前端呈现动态的沿线降压报警的过程。
    """
    logger.info(f"开始断流推演，故障节点：{request.failure_node_id}, 最大推演步长：{request.max_ticks}")
    try:
        topo = PhysicsTopologyService(session)
        engine = SimulationEngine()

        result = engine.run(
            graph=topo.graph,
            failure_node=request.failure_node_id,
            max_ticks=request.max_ticks,
        )

        raw = result.to_dict()
        logger.info(f"断流推演完毕，共推演 {raw['total_ticks']} 帧")
        return SimulationResponse(
            total_ticks=raw['total_ticks'],
            affected_pipes=raw['affected_pipes'],
            frames=[SimulationFrame(**f) for f in raw['frames']],
        )
    except ValueError as ve:
        logger.warning(f"推演参数错误: {str(ve)}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"推演过程出错: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="推演引擎内部执行出错")

