import networkx as nx
from sqlmodel import Session, select
from app.models import Station, Pipeline
from typing import List, Tuple, Dict, Optional

class TopologyService:
    """管网拓扑图算法服务 - 阶段一：物理基座重塑
    
    新增能力：
    1. 构建带有管存权重的有向图 (DiGraph)
    2. 为每条边计算延迟权重 (Delay Ticks)
    """
    
    def __init__(self, session: Session):
        self.session = session
        self._graph: Optional[nx.DiGraph] = None
        self._directed_graph: Optional[nx.DiGraph] = None
    
    @property
    def graph(self) -> nx.Graph:
        """兼容旧代码：返回无向图"""
        if self._graph is None:
            self._graph = self._build_graph()
        return self._graph
    
    def get_directed_graph(self) -> nx.DiGraph:
        """获取带有物理权重的有向图（用于仿真推演）"""
        if self._directed_graph is None:
            self._directed_graph = self._build_directed_graph()
        return self._directed_graph
    
    def _build_graph(self) -> nx.Graph:
        """从数据库构建 NetworkX 无向图（兼容旧代码）"""
        G = nx.Graph()
        
        # 添加节点 (站场)
        stations = self.session.exec(select(Station)).all()
        for station in stations:
            G.add_node(
                station.id,
                name=station.name,
                type=station.type,
                longitude=station.longitude,
                latitude=station.latitude
            )
        
        # 添加边 (管线) - 使用新字段，兼容旧数据
        pipelines = self.session.exec(select(Pipeline)).all()
        for pipeline in pipelines:
            # 数据兼容性处理
            diameter_mm = pipeline.diameter_mm or (float(pipeline.diameter) if pipeline.diameter else None)
            length_km = pipeline.length_km or pipeline.length or 0.0
            
            G.add_edge(
                pipeline.start_station_id,
                pipeline.end_station_id,
                pipeline_id=pipeline.id,
                name=pipeline.name,
                weight=length_km,
                category=pipeline.category,
                diameter_mm=diameter_mm,
                length_km=length_km
            )
        
        return G
    
    def _build_directed_graph(self) -> nx.DiGraph:
        """
        构建带有物理权重的有向图 (DiGraph)
        
        特点：
        1. 方向：start_station → end_station（气流方向）
        2. 边属性包含管存和延迟权重
        3. 支持断流仿真的时间推演
        """
        G = nx.DiGraph()
        
        # 添加节点 (站场)
        stations = self.session.exec(select(Station)).all()
        for station in stations:
            G.add_node(
                station.id,
                name=station.name,
                type=station.type,
                longitude=station.longitude,
                latitude=station.latitude
            )
        
        # 添加边 (管线) - 注入物理权重
        pipelines = self.session.exec(select(Pipeline)).all()
        for pipeline in pipelines:
            # 数据兼容性处理
            diameter_mm = pipeline.diameter_mm or (float(pipeline.diameter) if pipeline.diameter else None)
            length_km = pipeline.length_km or pipeline.length or 0.0
            
            # 计算管存和延迟权重
            # 创建临时 Pipeline 对象用于计算（不保存到数据库）
            temp_pipeline = Pipeline(
                diameter_mm=diameter_mm,
                length_km=length_km
            )
            linepack_volume = temp_pipeline.calculate_linepack_volume()
            delay_ticks = temp_pipeline.calculate_delay_ticks()
            
            # 添加有向边：start → end
            G.add_edge(
                pipeline.start_station_id,
                pipeline.end_station_id,
                # 基础属性
                pipeline_id=pipeline.id,
                name=pipeline.name,
                category=pipeline.category,
                # 物理属性
                diameter_mm=diameter_mm,
                length_km=length_km,
                # 计算属性（管存算子）
                linepack_volume=linepack_volume,      # 管存体积 (m³)
                delay_ticks=delay_ticks,              # 延迟 Tick 数
                # 仿真状态属性（运行时）
                remaining_ticks=delay_ticks,          # 剩余 Tick（初始=延迟）
                status='normal',                      # 状态: normal/depressurizing/outage
                # 权重（用于最短路径计算）
                weight=length_km
            )
        
        return G
    
    def refresh_graph(self):
        """刷新图（数据更新后调用）"""
        self._graph = None
        self._directed_graph = None
    
    def find_alternative_routes(
        self,
        source: str,
        target: str,
        blocked_pipelines: List[str] = None
    ) -> List[Dict]:
        """寻找备用路径"""
        G_temp = self.graph.copy()
        
        # 移除故障管线
        if blocked_pipelines:
            edges_to_remove = []
            for u, v, data in G_temp.edges(data=True):
                if data.get('pipeline_id') in blocked_pipelines:
                    edges_to_remove.append((u, v))
            G_temp.remove_edges_from(edges_to_remove)
        
        # 计算最短路径
        try:
            path = nx.shortest_path(G_temp, source, target, weight='weight')
            length = nx.shortest_path_length(G_temp, source, target, weight='weight')
            
            return [{
                "path": [G_temp.nodes[node]['name'] for node in path],
                "total_length": round(length, 2),
                "estimated_time": f"{int(length / 100)}h",  # 假设 100km/h
                "risk_level": "low"
            }]
        except nx.NetworkXNoPath:
            return []
    
    def calculate_impact_area(self, failed_pipeline_id: str) -> List[str]:
        """计算故障管线影响的站场"""
        # 找到故障管线
        pipeline = self.session.exec(
            select(Pipeline).where(Pipeline.id == failed_pipeline_id)
        ).first()
        
        if not pipeline:
            return []
        
        # 移除故障管线后,检查连通性
        G_temp = self.graph.copy()
        G_temp.remove_edge(pipeline.start_station_id, pipeline.end_station_id)
        
        # 找到受影响的连通分量
        components = list(nx.connected_components(G_temp))
        
        # 返回较小的连通分量(受影响区域)
        affected_component = min(components, key=len)
        
        return [
            self.graph.nodes[node]['name']
            for node in affected_component
        ]
    
    def find_critical_nodes(self) -> Dict[str, float]:
        """识别关键节点 (介数中心性)"""
        betweenness = nx.betweenness_centrality(self.graph, weight='weight')
        
        # 转换为站场名称和分数
        return {
            self.graph.nodes[node]['name']: round(score, 4)
            for node, score in sorted(
                betweenness.items(),
                key=lambda x: x[1],
                reverse=True
            )[:5]  # 返回前5个关键节点
        }
