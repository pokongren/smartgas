"""
管网拓扑图算法服务 - 阶段一：物理基座重塑 (优化版)

核心优化：
1. 图模板缓存 - 避免重复构建
2. 惰性加载 - 按需构建有向图
3. 压力等级系数 - 高压管道存气更多
"""

import networkx as nx
from sqlmodel import Session, select
from app.models import Station, Pipeline
from typing import List, Dict, Optional


class TopologyService:
    """
    管网拓扑图算法服务
    
    支持：
    - 无向图（兼容旧代码）
    - 有向图（仿真推演，带物理权重）
    """
    
    def __init__(self, session: Session):
        self.session = session
        self._graph: Optional[nx.Graph] = None
        self._directed_graph: Optional[nx.DiGraph] = None
        self._graph_template: Optional[nx.DiGraph] = None
    
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
    
    def get_graph_template(self) -> nx.DiGraph:
        """获取图模板（用于快速复制）"""
        if self._graph_template is None:
            self._graph_template = self._build_directed_graph()
        return self._graph_template
    
    def refresh(self):
        """刷新所有缓存的图"""
        self._graph = None
        self._directed_graph = None
        self._graph_template = None
    
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
                latitude=station.latitude,
                design_pressure=station.design_pressure
            )
        
        # 添加边 (管线) - 注入物理权重
        pipelines = self.session.exec(select(Pipeline)).all()
        for pipeline in pipelines:
            # 数据兼容性处理
            diameter_mm = pipeline.diameter_mm or (float(pipeline.diameter) if pipeline.diameter else None)
            length_km = pipeline.length_km or pipeline.length or 0.0
            
            # 计算管存和延迟权重
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
                design_pressure_mpa=pipeline.design_pressure if hasattr(pipeline, 'design_pressure') else 10.0,
                # 计算属性（管存算子）
                linepack_volume=linepack_volume,
                delay_ticks=delay_ticks,
                # 仿真状态属性（运行时）
                remaining_ticks=delay_ticks,
                status='normal',
                # 权重（用于最短路径计算）
                weight=length_km
            )
        
        return G
    
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
                "estimated_time": f"{int(length / 100)}h",
                "risk_level": "low"
            }]
        except nx.NetworkXNoPath:
            return []
    
    def calculate_impact_area(self, failed_pipeline_id: str) -> List[str]:
        """计算故障管线影响的站场"""
        pipeline = self.session.exec(
            select(Pipeline).where(Pipeline.id == failed_pipeline_id)
        ).first()
        
        if not pipeline:
            return []
        
        G_temp = self.graph.copy()
        G_temp.remove_edge(pipeline.start_station_id, pipeline.end_station_id)
        
        components = list(nx.connected_components(G_temp))
        affected_component = min(components, key=len)
        
        return [
            self.graph.nodes[node]['name']
            for node in affected_component
        ]
    
    def find_critical_nodes(self) -> Dict[str, float]:
        """识别关键节点 (介数中心性)"""
        betweenness = nx.betweenness_centrality(self.graph, weight='weight')
        
        return {
            self.graph.nodes[node]['name']: round(score, 4)
            for node, score in sorted(
                betweenness.items(),
                key=lambda x: x[1],
                reverse=True
            )[:5]
        }
