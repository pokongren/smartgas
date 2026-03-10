"""
管网拓扑计算服务 - 核心计算引擎

提供完整的拓扑分析、图算法计算和物理仿真能力。
整合 NetworkX 图算法与物理计算模型。
"""

import networkx as nx
import math
from typing import List, Dict, Optional, Tuple, Set, Any, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict
import json


class NodeType(str, Enum):
    """节点类型"""
    SOURCE = "source"           # 气源
    COMPRESSOR = "compressor"   # 压气站
    DISTRIBUTION = "distribution"  # 分输站
    VALVE = "valve"             # 阀室
    STORAGE = "storage"         # 储气库
    JUNCTION = "junction"       # 连接点


class EdgeType(str, Enum):
    """边类型"""
    TRUNK = "trunk"             # 干线
    BRANCH = "branch"           # 支线
    INTERCONNECT = "interconnect"  # 互联互通


class PathAlgorithm(str, Enum):
    """路径算法枚举"""
    DIJKSTRA = "dijkstra"
    ASTAR = "astar"
    BELLMAN_FORD = "bellman_ford"


@dataclass
class TopoNode:
    """拓扑节点"""
    id: str
    name: str
    node_type: NodeType
    longitude: float = 0.0
    latitude: float = 0.0
    pressure_mpa: float = 10.0
    capacity: float = 0.0
    properties: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.node_type.value,
            "longitude": self.longitude,
            "latitude": self.latitude,
            "pressure_mpa": self.pressure_mpa,
            "capacity": self.capacity,
            "properties": self.properties
        }


@dataclass
class TopoEdge:
    """拓扑边"""
    id: str
    source: str
    target: str
    name: str = ""
    edge_type: EdgeType = EdgeType.TRUNK
    length_km: float = 0.0
    diameter_mm: float = 0.0
    design_pressure_mpa: float = 10.0
    
    # 物理计算属性
    linepack_volume: float = 0.0
    flow_rate: float = 0.0
    delay_ticks: int = 1
    
    properties: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "source": self.source,
            "target": self.target,
            "name": self.name,
            "type": self.edge_type.value,
            "length_km": self.length_km,
            "diameter_mm": self.diameter_mm,
            "design_pressure_mpa": self.design_pressure_mpa,
            "linepack_volume": self.linepack_volume,
            "flow_rate": self.flow_rate,
            "delay_ticks": self.delay_ticks,
            "properties": self.properties
        }


@dataclass
class PathResult:
    """路径计算结果"""
    path: List[str]
    path_names: List[str]
    total_length: float
    total_delay: int
    edges: List[str]
    
    def to_dict(self) -> Dict:
        return {
            "path": self.path,
            "path_names": self.path_names,
            "total_length": round(self.total_length, 2),
            "total_delay": self.total_delay,
            "edge_count": len(self.edges)
        }


@dataclass
class TopologyMetrics:
    """拓扑指标"""
    node_count: int
    edge_count: int
    density: float
    avg_degree: float
    connected_components: int
    cycle_count: int
    diameter: int
    avg_shortest_path: float
    
    def to_dict(self) -> Dict:
        return {
            "node_count": self.node_count,
            "edge_count": self.edge_count,
            "density": round(self.density, 4),
            "avg_degree": round(self.avg_degree, 2),
            "connected_components": self.connected_components,
            "cycle_count": self.cycle_count,
            "diameter": self.diameter,
            "avg_shortest_path": round(self.avg_shortest_path, 2)
        }


@dataclass
class CentralityResult:
    """中心性分析结果"""
    betweenness: Dict[str, float]      # 介数中心性
    degree: Dict[str, float]           # 度中心性
    closeness: Dict[str, float]        # 接近中心性
    eigenvector: Dict[str, float]      # 特征向量中心性
    
    def get_top_nodes(self, metric: str, n: int = 5) -> List[Tuple[str, float]]:
        """获取指定指标的前N个节点"""
        data = getattr(self, metric, {})
        return sorted(data.items(), key=lambda x: x[1], reverse=True)[:n]
    
    def to_dict(self) -> Dict:
        return {
            "betweenness": self.betweenness,
            "degree": self.degree,
            "closeness": self.closeness,
            "eigenvector": self.eigenvector
        }


class TopologyGraph:
    """
    管网拓扑图 - 封装 NetworkX 图操作
    
    支持有向图和无向图两种模式：
    - 无向图: 用于连通性分析、最短路径
    - 有向图: 用于流向分析、仿真推演
    """
    
    def __init__(self, directed: bool = True):
        self.directed = directed
        self._graph = nx.DiGraph() if directed else nx.Graph()
        self._nodes: Dict[str, TopoNode] = {}
        self._edges: Dict[str, TopoEdge] = {}
        self._cached_metrics: Optional[TopologyMetrics] = None
        
    @property
    def graph(self) -> nx.Graph:
        """获取底层 NetworkX 图"""
        return self._graph
    
    @property
    def node_count(self) -> int:
        return self._graph.number_of_nodes()
    
    @property
    def edge_count(self) -> int:
        return self._graph.number_of_edges()
    
    def add_node(self, node: TopoNode) -> None:
        """添加节点"""
        self._nodes[node.id] = node
        self._graph.add_node(
            node.id,
            name=node.name,
            type=node.node_type.value,
            longitude=node.longitude,
            latitude=node.latitude,
            pressure_mpa=node.pressure_mpa,
            **node.properties
        )
        self._cached_metrics = None
    
    def add_edge(self, edge: TopoEdge) -> None:
        """添加边"""
        self._edges[edge.id] = edge
        
        # 计算物理属性（如果未提供）
        if edge.linepack_volume == 0:
            edge.linepack_volume = self._calculate_linepack(edge)
        if edge.delay_ticks == 1 and edge.flow_rate > 0:
            edge.delay_ticks = max(1, int(edge.linepack_volume / edge.flow_rate))
        
        self._graph.add_edge(
            edge.source,
            edge.target,
            id=edge.id,
            name=edge.name,
            type=edge.edge_type.value,
            weight=edge.length_km,
            length_km=edge.length_km,
            diameter_mm=edge.diameter_mm,
            design_pressure_mpa=edge.design_pressure_mpa,
            linepack_volume=edge.linepack_volume,
            flow_rate=edge.flow_rate,
            delay_ticks=edge.delay_ticks,
            **edge.properties
        )
        self._cached_metrics = None
    
    def _calculate_linepack(self, edge: TopoEdge) -> float:
        """计算管存体积"""
        if edge.diameter_mm <= 0 or edge.length_km <= 0:
            return 0.0
        
        diameter_m = edge.diameter_mm / 1000.0
        length_m = edge.length_km * 1000.0
        radius_m = diameter_m / 2.0
        
        # 几何体积
        geom_volume = math.pi * (radius_m ** 2) * length_m
        
        # 简化的压缩因子计算
        z_factor = 0.9
        
        # 转换为标况体积
        standard_volume = geom_volume * (edge.design_pressure_mpa / 0.101325) / z_factor
        
        return round(standard_volume, 2)
    
    def get_node(self, node_id: str) -> Optional[TopoNode]:
        """获取节点"""
        return self._nodes.get(node_id)
    
    def get_edge(self, edge_id: str) -> Optional[TopoEdge]:
        """获取边"""
        return self._edges.get(edge_id)
    
    def get_neighbors(self, node_id: str) -> List[str]:
        """获取邻居节点"""
        return list(self._graph.neighbors(node_id))
    
    def has_path(self, source: str, target: str) -> bool:
        """检查两节点间是否存在路径"""
        return nx.has_path(self._graph, source, target)
    
    def find_path(
        self,
        source: str,
        target: str,
        algorithm: PathAlgorithm = PathAlgorithm.DIJKSTRA,
        weight: str = "weight"
    ) -> Optional[PathResult]:
        """
        查找两节点间的最短路径
        
        Args:
            source: 起始节点ID
            target: 目标节点ID
            algorithm: 路径算法
            weight: 权重属性名
            
        Returns:
            PathResult 或 None（无路径时）
        """
        if source not in self._graph or target not in self._graph:
            return None
        
        try:
            if algorithm == PathAlgorithm.DIJKSTRA:
                path = nx.shortest_path(self._graph, source, target, weight=weight)
            elif algorithm == PathAlgorithm.ASTAR:
                path = nx.astar_path(self._graph, source, target, weight=weight)
            elif algorithm == PathAlgorithm.BELLMAN_FORD:
                path = nx.bellman_ford_path(self._graph, source, target, weight=weight)
            else:
                path = nx.shortest_path(self._graph, source, target, weight=weight)
        except nx.NetworkXNoPath:
            return None
        
        # 收集路径信息
        path_names = []
        edges = []
        total_length = 0.0
        total_delay = 0
        
        for i in range(len(path) - 1):
            u, v = path[i], path[i + 1]
            edge_data = self._graph[u][v]
            path_names.append(self._nodes[u].name if u in self._nodes else u)
            edges.append(edge_data.get('id', f"{u}-{v}"))
            total_length += edge_data.get('length_km', 0)
            total_delay += edge_data.get('delay_ticks', 1)
        
        path_names.append(self._nodes[target].name if target in self._nodes else target)
        
        return PathResult(
            path=path,
            path_names=path_names,
            total_length=total_length,
            total_delay=total_delay,
            edges=edges
        )
    
    def find_all_paths(
        self,
        source: str,
        target: str,
        max_paths: int = 3,
        cutoff: Optional[int] = None
    ) -> List[PathResult]:
        """
        查找多条备选路径
        
        Args:
            source: 起始节点ID
            target: 目标节点ID
            max_paths: 最大路径数
            cutoff: 最大跳数限制
            
        Returns:
            路径结果列表
        """
        if source not in self._graph or target not in self._graph:
            return []
        
        paths = []
        
        # 使用简单路径算法
        try:
            simple_paths = list(nx.shortest_simple_paths(
                self._graph, source, target, weight="weight"
            ))
            
            for path in simple_paths[:max_paths]:
                # 计算路径信息
                path_names = []
                edges = []
                total_length = 0.0
                total_delay = 0
                
                for i in range(len(path) - 1):
                    u, v = path[i], path[i + 1]
                    edge_data = self._graph[u][v]
                    path_names.append(self._nodes[u].name if u in self._nodes else u)
                    edges.append(edge_data.get('id', f"{u}-{v}"))
                    total_length += edge_data.get('length_km', 0)
                    total_delay += edge_data.get('delay_ticks', 1)
                
                path_names.append(self._nodes[path[-1]].name if path[-1] in self._nodes else path[-1])
                
                paths.append(PathResult(
                    path=path,
                    path_names=path_names,
                    total_length=total_length,
                    total_delay=total_delay,
                    edges=edges
                ))
                
        except nx.NetworkXNoPath:
            pass
        
        return paths
    
    def find_mst(self, weight: str = "weight") -> List[str]:
        """
        计算最小生成树
        
        Returns:
            包含在MST中的边ID列表
        """
        if self.directed:
            # 有向图使用最小树形图算法
            mst = nx.minimum_spanning_arborescence(self._graph, attr=weight)
        else:
            mst = nx.minimum_spanning_tree(self._graph, weight=weight)
        
        edge_ids = []
        for u, v, data in mst.edges(data=True):
            edge_ids.append(data.get('id', f"{u}-{v}"))
        
        return edge_ids
    
    def detect_cycles(self) -> List[List[str]]:
        """
        检测图中的环
        
        Returns:
            环列表，每个环是节点ID列表
        """
        if self.directed:
            return list(nx.simple_cycles(self._graph))
        else:
            # 无向图使用环基
            try:
                cycles = nx.cycle_basis(self._graph)
                return cycles
            except:
                return []
    
    def get_connected_components(self) -> List[List[str]]:
        """
        获取连通分量
        
        Returns:
            连通分量列表，每个分量是节点ID列表
        """
        if self.directed:
            # 有向图使用弱连通
            return [list(c) for c in nx.weakly_connected_components(self._graph)]
        else:
            return [list(c) for c in nx.connected_components(self._graph)]
    
    def calculate_centrality(self) -> CentralityResult:
        """
        计算节点中心性指标
        
        Returns:
            CentralityResult 包含多种中心性指标
        """
        # 介数中心性
        betweenness = nx.betweenness_centrality(self._graph, weight="weight")
        
        # 度中心性
        degree = nx.degree_centrality(self._graph)
        
        # 接近中心性
        try:
            closeness = nx.closeness_centrality(self._graph)
        except:
            closeness = {node: 0.0 for node in self._graph.nodes()}
        
        # 特征向量中心性
        try:
            eigenvector = nx.eigenvector_centrality(self._graph, max_iter=1000)
        except:
            eigenvector = {node: 0.0 for node in self._graph.nodes()}
        
        return CentralityResult(
            betweenness=betweenness,
            degree=degree,
            closeness=closeness,
            eigenvector=eigenvector
        )
    
    def calculate_metrics(self) -> TopologyMetrics:
        """
        计算拓扑指标
        
        Returns:
            TopologyMetrics 包含各种拓扑指标
        """
        if self._cached_metrics:
            return self._cached_metrics
        
        n = self.node_count
        m = self.edge_count
        
        # 密度
        if n > 1:
            if self.directed:
                density = m / (n * (n - 1))
            else:
                density = 2 * m / (n * (n - 1))
        else:
            density = 0.0
        
        # 平均度
        avg_degree = 2 * m / n if n > 0 else 0.0
        
        # 连通分量数
        if self.directed:
            connected_components = nx.number_weakly_connected_components(self._graph)
        else:
            connected_components = nx.number_connected_components(self._graph)
        
        # 环数
        cycles = self.detect_cycles()
        cycle_count = len(cycles)
        
        # 直径和平均最短路径
        try:
            if self.directed:
                diameter = nx.diameter(self._graph.to_undirected())
                avg_shortest_path = nx.average_shortest_path_length(
                    self._graph.to_undirected()
                )
            else:
                diameter = nx.diameter(self._graph)
                avg_shortest_path = nx.average_shortest_path_length(self._graph)
        except:
            diameter = -1
            avg_shortest_path = -1.0
        
        metrics = TopologyMetrics(
            node_count=n,
            edge_count=m,
            density=density,
            avg_degree=avg_degree,
            connected_components=connected_components,
            cycle_count=cycle_count,
            diameter=diameter,
            avg_shortest_path=avg_shortest_path
        )
        
        self._cached_metrics = metrics
        return metrics
    
    def get_subgraph(self, nodes: List[str]) -> "TopologyGraph":
        """
        获取子图
        
        Args:
            nodes: 节点ID列表
            
        Returns:
            包含指定节点的子图
        """
        subgraph = TopologyGraph(directed=self.directed)
        
        for node_id in nodes:
            if node_id in self._nodes:
                subgraph.add_node(self._nodes[node_id])
        
        for edge_id, edge in self._edges.items():
            if edge.source in nodes and edge.target in nodes:
                subgraph.add_edge(edge)
        
        return subgraph
    
    def to_dict(self) -> Dict:
        """转换为字典"""
        return {
            "directed": self.directed,
            "node_count": self.node_count,
            "edge_count": self.edge_count,
            "nodes": [n.to_dict() for n in self._nodes.values()],
            "edges": [e.to_dict() for e in self._edges.values()]
        }
    
    def export_to_json(self, filepath: str) -> None:
        """导出为JSON文件"""
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)


class TopologyComputationService:
    """
    拓扑计算服务 - 对外提供统一接口
    
    整合图构建、算法计算和结果缓存。
    """
    
    def __init__(self):
        self._graphs: Dict[str, TopologyGraph] = {}
        self._cache: Dict[str, Any] = {}
    
    def build_graph(
        self,
        name: str,
        nodes: List[Dict],
        edges: List[Dict],
        directed: bool = True
    ) -> TopologyGraph:
        """
        构建拓扑图
        
        Args:
            name: 图名称（用于缓存）
            nodes: 节点数据列表
            edges: 边数据列表
            directed: 是否有向图
            
        Returns:
            TopologyGraph 实例
        """
        graph = TopologyGraph(directed=directed)
        
        # 添加节点
        for node_data in nodes:
            node = TopoNode(
                id=node_data["id"],
                name=node_data.get("name", node_data["id"]),
                node_type=NodeType(node_data.get("type", "junction")),
                longitude=node_data.get("longitude", 0.0),
                latitude=node_data.get("latitude", 0.0),
                pressure_mpa=node_data.get("pressure_mpa", 10.0),
                capacity=node_data.get("capacity", 0.0),
                properties=node_data.get("properties", {})
            )
            graph.add_node(node)
        
        # 添加边
        for edge_data in edges:
            edge = TopoEdge(
                id=edge_data["id"],
                source=edge_data["source"],
                target=edge_data["target"],
                name=edge_data.get("name", ""),
                edge_type=EdgeType(edge_data.get("type", "trunk")),
                length_km=edge_data.get("length_km", 0.0),
                diameter_mm=edge_data.get("diameter_mm", 0.0),
                design_pressure_mpa=edge_data.get("design_pressure_mpa", 10.0),
                linepack_volume=edge_data.get("linepack_volume", 0.0),
                flow_rate=edge_data.get("flow_rate", 0.0),
                delay_ticks=edge_data.get("delay_ticks", 1),
                properties=edge_data.get("properties", {})
            )
            graph.add_edge(edge)
        
        self._graphs[name] = graph
        return graph
    
    def get_graph(self, name: str) -> Optional[TopologyGraph]:
        """获取已构建的图"""
        return self._graphs.get(name)
    
    def analyze_topology(self, graph_name: str) -> Dict:
        """
        完整拓扑分析
        
        Args:
            graph_name: 图名称
            
        Returns:
            包含各项指标的字典
        """
        graph = self._graphs.get(graph_name)
        if not graph:
            return {"error": "Graph not found"}
        
        cache_key = f"{graph_name}_analysis"
        if cache_key in self._cache:
            return self._cache[cache_key]
        
        # 基础指标
        metrics = graph.calculate_metrics()
        
        # 中心性分析
        centrality = graph.calculate_centrality()
        
        # 关键节点（介数中心性Top5）
        critical_nodes = centrality.get_top_nodes("betweenness", 5)
        
        # 连通分量
        components = graph.get_connected_components()
        
        # 环检测
        cycles = graph.detect_cycles()
        
        result = {
            "metrics": metrics.to_dict(),
            "centrality": {
                "top_betweenness": [
                    {"node_id": n, "score": round(s, 4), "name": graph.get_node(n).name if graph.get_node(n) else n}
                    for n, s in critical_nodes
                ]
            },
            "connected_components": [
                {
                    "id": i,
                    "node_count": len(comp),
                    "nodes": comp[:10]  # 最多显示10个
                }
                for i, comp in enumerate(components)
            ],
            "cycles": {
                "count": len(cycles),
                "examples": cycles[:3]  # 最多显示3个示例
            }
        }
        
        self._cache[cache_key] = result
        return result
    
    def find_path(
        self,
        graph_name: str,
        source: str,
        target: str,
        algorithm: str = "dijkstra",
        exclude_nodes: Optional[List[str]] = None
    ) -> Optional[Dict]:
        """
        路径查找
        
        Args:
            graph_name: 图名称
            source: 起始节点
            target: 目标节点
            algorithm: 算法名称
            exclude_nodes: 要排除的节点
            
        Returns:
            路径结果字典
        """
        graph = self._graphs.get(graph_name)
        if not graph:
            return None
        
        # 如果需要排除节点，创建临时子图
        if exclude_nodes:
            all_nodes = list(graph._nodes.keys())
            valid_nodes = [n for n in all_nodes if n not in exclude_nodes]
            temp_graph = graph.get_subgraph(valid_nodes)
            result = temp_graph.find_path(source, target, PathAlgorithm(algorithm))
        else:
            result = graph.find_path(source, target, PathAlgorithm(algorithm))
        
        return result.to_dict() if result else None
    
    def find_alternative_paths(
        self,
        graph_name: str,
        source: str,
        target: str,
        max_paths: int = 3
    ) -> List[Dict]:
        """
        查找多条备选路径
        
        Args:
            graph_name: 图名称
            source: 起始节点
            target: 目标节点
            max_paths: 最大路径数
            
        Returns:
            路径结果列表
        """
        graph = self._graphs.get(graph_name)
        if not graph:
            return []
        
        results = graph.find_all_paths(source, target, max_paths)
        return [r.to_dict() for r in results]
    
    def clear_cache(self, graph_name: Optional[str] = None):
        """清除缓存"""
        if graph_name:
            keys_to_remove = [k for k in self._cache if k.startswith(graph_name)]
            for k in keys_to_remove:
                del self._cache[k]
        else:
            self._cache.clear()


# 全局服务实例
topology_service = TopologyComputationService()


# 便捷函数
def build_topology_from_pipeline(
    pipeline_data: Dict,
    directed: bool = True
) -> TopologyGraph:
    """
    从管线数据构建拓扑图
    
    Args:
        pipeline_data: 包含 nodes 和 edges 的字典
        directed: 是否有向图
        
    Returns:
        TopologyGraph 实例
    """
    service = TopologyComputationService()
    name = pipeline_data.get("name", "pipeline")
    nodes = pipeline_data.get("nodes", [])
    edges = pipeline_data.get("edges", [])
    
    return service.build_graph(name, nodes, edges, directed)


def quick_path_find(
    nodes: List[Dict],
    edges: List[Dict],
    source: str,
    target: str
) -> Optional[Dict]:
    """
    快速路径查找（无需预先构建图）
    
    Args:
        nodes: 节点列表
        edges: 边列表
        source: 起始节点
        target: 目标节点
        
    Returns:
        路径结果或 None
    """
    graph = build_topology_from_pipeline({"nodes": nodes, "edges": edges})
    result = graph.find_path(source, target)
    return result.to_dict() if result else None
