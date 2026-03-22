"""
拓扑计算 API 路由

提供 RESTful API 接口用于拓扑分析、路径计算和仿真推演。
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
from enum import Enum

from app.services.topology_computation import (
    topology_service,
    TopologyComputationService,
    NodeType,
    EdgeType,
    PathAlgorithm
)


router = APIRouter(prefix="/topology", tags=["topology"])


# =============================================================================
# 请求/响应模型
# =============================================================================

class NodeTypeEnum(str, Enum):
    """节点类型枚举"""
    SOURCE = "source"
    COMPRESSOR = "compressor"
    DISTRIBUTION = "distribution"
    VALVE = "valve"
    STORAGE = "storage"
    JUNCTION = "junction"


class EdgeTypeEnum(str, Enum):
    """边类型枚举"""
    TRUNK = "trunk"
    BRANCH = "branch"
    INTERCONNECT = "interconnect"


class AlgorithmEnum(str, Enum):
    """算法枚举"""
    DIJKSTRA = "dijkstra"
    ASTAR = "astar"
    BELLMAN_FORD = "bellman_ford"


class TopoNodeInput(BaseModel):
    """拓扑节点输入"""
    id: str = Field(..., description="节点唯一标识")
    name: str = Field(..., description="节点名称")
    type: NodeTypeEnum = Field(default=NodeTypeEnum.JUNCTION, description="节点类型")
    longitude: float = Field(default=0.0, description="经度")
    latitude: float = Field(default=0.0, description="纬度")
    pressure_mpa: float = Field(default=10.0, description="压力(MPa)")
    capacity: float = Field(default=0.0, description="处理能力")
    properties: Optional[Dict[str, Any]] = Field(default=None, description="扩展属性")


class TopoEdgeInput(BaseModel):
    """拓扑边输入"""
    id: str = Field(..., description="边唯一标识")
    source: str = Field(..., description="起始节点ID")
    target: str = Field(..., description="目标节点ID")
    name: str = Field(default="", description="边名称")
    type: EdgeTypeEnum = Field(default=EdgeTypeEnum.TRUNK, description="边类型")
    length_km: float = Field(default=0.0, description="长度(km)")
    diameter_mm: float = Field(default=0.0, description="管径(mm)")
    design_pressure_mpa: float = Field(default=10.0, description="设计压力(MPa)")
    linepack_volume: float = Field(default=0.0, description="管存体积")
    flow_rate: float = Field(default=0.0, description="流量")
    delay_ticks: int = Field(default=1, description="延迟tick数")
    properties: Optional[Dict[str, Any]] = Field(default=None, description="扩展属性")


class BuildGraphRequest(BaseModel):
    """构建图请求"""
    name: str = Field(..., description="图名称")
    directed: bool = Field(default=True, description="是否有向图")
    nodes: List[TopoNodeInput] = Field(..., description="节点列表")
    edges: List[TopoEdgeInput] = Field(..., description="边列表")


class BuildGraphResponse(BaseModel):
    """构建图响应"""
    success: bool
    graph_name: str
    node_count: int
    edge_count: int
    message: str


class PathRequest(BaseModel):
    """路径计算请求"""
    graph_name: str = Field(..., description="图名称")
    source: str = Field(..., description="起始节点ID")
    target: str = Field(..., description="目标节点ID")
    algorithm: AlgorithmEnum = Field(default=AlgorithmEnum.DIJKSTRA, description="算法")
    exclude_nodes: Optional[List[str]] = Field(default=None, description="排除的节点")


class PathResponse(BaseModel):
    """路径计算响应"""
    found: bool
    path: List[str] = Field(default_factory=list)
    path_names: List[str] = Field(default_factory=list)
    total_length: float = 0.0
    total_delay: int = 0
    edge_count: int = 0


class MultiPathRequest(BaseModel):
    """多路径计算请求"""
    graph_name: str = Field(..., description="图名称")
    source: str = Field(..., description="起始节点ID")
    target: str = Field(..., description="目标节点ID")
    max_paths: int = Field(default=3, ge=1, le=10, description="最大路径数")


class MultiPathResponse(BaseModel):
    """多路径计算响应"""
    count: int
    paths: List[PathResponse]


class TopologyMetricsResponse(BaseModel):
    """拓扑指标响应"""
    node_count: int
    edge_count: int
    density: float
    avg_degree: float
    connected_components: int
    cycle_count: int
    diameter: int
    avg_shortest_path: float


class CentralityNode(BaseModel):
    """中心性节点"""
    node_id: str
    name: str
    score: float


class CentralityResponse(BaseModel):
    """中心性分析响应"""
    top_betweenness: List[CentralityNode]


class ConnectedComponent(BaseModel):
    """连通分量"""
    id: int
    node_count: int
    nodes: List[str]


class TopologyAnalysisResponse(BaseModel):
    """拓扑分析响应"""
    metrics: TopologyMetricsResponse
    centrality: CentralityResponse
    connected_components: List[ConnectedComponent]
    cycles: Dict[str, Any]


class CycleInfo(BaseModel):
    """环信息"""
    nodes: List[str]
    length: int


class CycleDetectionResponse(BaseModel):
    """环检测响应"""
    count: int
    cycles: List[CycleInfo]


class MSTResponse(BaseModel):
    """最小生成树响应"""
    edge_count: int
    edge_ids: List[str]
    total_length: float


# =============================================================================
# API 路由
# =============================================================================

@router.post("/build", response_model=BuildGraphResponse)
async def build_graph(request: BuildGraphRequest):
    """
    构建拓扑图
    
    从节点和边数据构建拓扑图，用于后续计算。
    """
    try:
        # 转换节点数据
        nodes_data = []
        for node in request.nodes:
            node_dict = node.model_dump()
            node_dict["type"] = node.type.value
            nodes_data.append(node_dict)
        
        # 转换边数据
        edges_data = []
        for edge in request.edges:
            edge_dict = edge.model_dump()
            edge_dict["type"] = edge.type.value
            edges_data.append(edge_dict)
        
        # 构建图
        graph = topology_service.build_graph(
            name=request.name,
            nodes=nodes_data,
            edges=edges_data,
            directed=request.directed
        )
        
        return BuildGraphResponse(
            success=True,
            graph_name=request.name,
            node_count=graph.node_count,
            edge_count=graph.edge_count,
            message=f"Successfully built graph '{request.name}'"
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/path", response_model=PathResponse)
async def find_path(request: PathRequest):
    """
    查找最短路径
    
    计算两节点间的最短路径，支持多种算法。
    """
    result = topology_service.find_path(
        graph_name=request.graph_name,
        source=request.source,
        target=request.target,
        algorithm=request.algorithm.value,
        exclude_nodes=request.exclude_nodes
    )
    
    if not result:
        return PathResponse(found=False)
    
    return PathResponse(
        found=True,
        path=result["path"],
        path_names=result["path_names"],
        total_length=result["total_length"],
        total_delay=result["total_delay"],
        edge_count=result["edge_count"]
    )


@router.post("/paths", response_model=MultiPathResponse)
async def find_alternative_paths(request: MultiPathRequest):
    """
    查找多条备选路径
    
    计算两节点间的多条备选路径，用于路由规划。
    """
    results = topology_service.find_alternative_paths(
        graph_name=request.graph_name,
        source=request.source,
        target=request.target,
        max_paths=request.max_paths
    )
    
    paths = [
        PathResponse(
            found=True,
            path=r["path"],
            path_names=r["path_names"],
            total_length=r["total_length"],
            total_delay=r["total_delay"],
            edge_count=r["edge_count"]
        )
        for r in results
    ]
    
    return MultiPathResponse(count=len(paths), paths=paths)


@router.get("/analyze/{graph_name}", response_model=TopologyAnalysisResponse)
async def analyze_topology(graph_name: str):
    """
    完整拓扑分析
    
    分析拓扑图的各项指标，包括连通性、中心性、环结构等。
    """
    result = topology_service.analyze_topology(graph_name)
    
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    
    metrics = result["metrics"]
    centrality = result["centrality"]
    
    return TopologyAnalysisResponse(
        metrics=TopologyMetricsResponse(**metrics),
        centrality=CentralityResponse(
            top_betweenness=[
                CentralityNode(**node) for node in centrality["top_betweenness"]
            ]
        ),
        connected_components=[
            ConnectedComponent(**comp) for comp in result["connected_components"]
        ],
        cycles=result["cycles"]
    )


@router.get("/metrics/{graph_name}", response_model=TopologyMetricsResponse)
async def get_metrics(graph_name: str):
    """
    获取拓扑指标
    
    获取图的基本拓扑指标。
    """
    graph = topology_service.get_graph(graph_name)
    if not graph:
        raise HTTPException(status_code=404, detail="Graph not found")
    
    metrics = graph.calculate_metrics()
    return TopologyMetricsResponse(**metrics.to_dict())


@router.get("/cycles/{graph_name}", response_model=CycleDetectionResponse)
async def detect_cycles(graph_name: str):
    """
    检测环
    
    检测图中的所有环结构。
    """
    graph = topology_service.get_graph(graph_name)
    if not graph:
        raise HTTPException(status_code=404, detail="Graph not found")
    
    cycles = graph.detect_cycles()
    cycle_infos = [
        CycleInfo(nodes=cycle, length=len(cycle))
        for cycle in cycles
    ]
    
    return CycleDetectionResponse(
        count=len(cycles),
        cycles=cycle_infos
    )


@router.get("/mst/{graph_name}", response_model=MSTResponse)
async def get_mst(graph_name: str):
    """
    计算最小生成树
    
    计算图的最小生成树，返回包含的边。
    """
    graph = topology_service.get_graph(graph_name)
    if not graph:
        raise HTTPException(status_code=404, detail="Graph not found")
    
    edge_ids = graph.find_mst()
    
    # 计算总长度
    total_length = sum(
        graph.get_edge(eid).length_km if graph.get_edge(eid) else 0
        for eid in edge_ids
    )
    
    return MSTResponse(
        edge_count=len(edge_ids),
        edge_ids=edge_ids,
        total_length=round(total_length, 2)
    )


@router.get("/centrality/{graph_name}")
async def get_centrality(graph_name: str):
    """
    获取中心性分析
    
    计算节点的各种中心性指标。
    """
    graph = topology_service.get_graph(graph_name)
    if not graph:
        raise HTTPException(status_code=404, detail="Graph not found")
    
    centrality = graph.calculate_centrality()
    
    return {
        "betweenness": centrality.betweenness,
        "degree": centrality.degree,
        "closeness": centrality.closeness,
        "eigenvector": centrality.eigenvector
    }


@router.get("/graphs")
async def list_graphs():
    """
    列出所有已构建的图
    
    返回所有可用的图名称和基本信息。
    """
    graphs = []
    for name, graph in topology_service._graphs.items():
        graphs.append({
            "name": name,
            "node_count": graph.node_count,
            "edge_count": graph.edge_count,
            "directed": graph.directed
        })
    
    return {"graphs": graphs}


@router.delete("/graphs/{graph_name}")
async def delete_graph(graph_name: str):
    """
    删除图
    
    删除指定的图及其缓存。
    """
    if graph_name not in topology_service._graphs:
        raise HTTPException(status_code=404, detail="Graph not found")
    
    del topology_service._graphs[graph_name]
    topology_service.clear_cache(graph_name)
    
    return {"success": True, "message": f"Graph '{graph_name}' deleted"}


@router.post("/clear-cache")
async def clear_cache(graph_name: Optional[str] = None):
    """
    清除缓存
    
    清除指定图或所有图的计算缓存。
    """
    topology_service.clear_cache(graph_name)
    
    if graph_name:
        return {"success": True, "message": f"Cache cleared for '{graph_name}'"}
    else:
        return {"success": True, "message": "All cache cleared"}


# =============================================================================
# 路径修正 API
# =============================================================================

class CorrectionPreviewRequest(BaseModel):
    """修正预览请求"""
    pipeline_data: Dict[str, Any] = Field(..., description="extract_pipeline 输出的 JSON")
    jump_threshold_km: float = Field(default=200.0, description="跳跃距离阈值 (km)")
    attach_radius_km: float = Field(default=50.0, description="支线挂接搜索半径 (km)")


class CorrectionApplyRequest(BaseModel):
    """修正应用请求"""
    pipeline_data: Dict[str, Any] = Field(..., description="原始管线数据")
    jump_threshold_km: float = Field(default=200.0)
    attach_radius_km: float = Field(default=50.0)


@router.post("/correct/preview")
async def preview_correction(request: CorrectionPreviewRequest):
    """
    预览拓扑修正结果（不写入数据库）
    
    扫描管线数据中的跳跃连接、支线挂接异常和孤立节点，
    返回修正建议供人工审核。
    """
    from app.services.topology_correction import TopologyCorrectionEngine

    engine = TopologyCorrectionEngine(
        jump_threshold_km=request.jump_threshold_km,
        attach_radius_km=request.attach_radius_km
    )
    report = engine.correct_pipeline(request.pipeline_data, dry_run=True)
    return report.to_dict()


@router.post("/correct/apply")
async def apply_correction(request: CorrectionApplyRequest):
    """
    执行拓扑修正并应用到数据
    
    自动修正可自动处理的问题（如干线排序跳跃），
    并将修正记录持久化到数据库。
    """
    from app.services.topology_correction import TopologyCorrectionEngine

    engine = TopologyCorrectionEngine(
        jump_threshold_km=request.jump_threshold_km,
        attach_radius_km=request.attach_radius_km
    )
    
    # 执行修正（dry_run=False 会修改 pipeline_data）
    report = engine.correct_pipeline(request.pipeline_data, dry_run=False)
    
    # 持久化修正记录（遍历 corrections）
    import json
    from app.database import get_session
    from app.models import TopologyCorrectionLog

    try:
        session = next(get_session())
        for c in report.corrections:
            log = TopologyCorrectionLog(
                pipeline_name=report.pipeline_name,
                correction_type=c.correction_type.value,
                severity=c.severity,
                description=c.description,
                before_json=json.dumps(c.before, ensure_ascii=False),
                after_json=json.dumps(c.after, ensure_ascii=False),
                status="applied" if c.auto_fixable else "pending"
            )
            session.add(log)
        session.commit()
    except Exception as e:
        # 持久化失败不影响修正结果返回
        import logging
        logging.getLogger(__name__).warning(f"修正记录持久化失败: {e}")

    return {
        "success": True,
        "report": report.to_dict(),
        "corrected_data": request.pipeline_data
    }


@router.get("/correct/history")
async def get_correction_history(pipeline_name: Optional[str] = None, limit: int = 50):
    """
    获取修正历史记录
    """
    from sqlmodel import select
    from app.database import get_session
    from app.models import TopologyCorrectionLog

    try:
        session = next(get_session())
        stmt = select(TopologyCorrectionLog).order_by(
            TopologyCorrectionLog.id.desc()
        ).limit(limit)
        
        if pipeline_name:
            stmt = stmt.where(TopologyCorrectionLog.pipeline_name == pipeline_name)
        
        logs = session.exec(stmt).all()
        return {
            "count": len(logs),
            "logs": [
                {
                    "id": log.id,
                    "pipeline_name": log.pipeline_name,
                    "correction_type": log.correction_type,
                    "severity": log.severity,
                    "description": log.description,
                    "status": log.status,
                    "created_at": log.created_at
                }
                for log in logs
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询失败: {str(e)}")
