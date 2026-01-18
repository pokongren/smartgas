import networkx as nx
from sqlmodel import Session, select
from app.models import Station, Pipeline
from typing import List, Tuple, Dict

class TopologyService:
    """管网拓扑图算法服务"""
    
    def __init__(self, session: Session):
        self.session = session
        self.graph = self._build_graph()
    
    def _build_graph(self) -> nx.Graph:
        """从数据库构建 NetworkX 图"""
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
        
        # 添加边 (管线)
        pipelines = self.session.exec(select(Pipeline)).all()
        for pipeline in pipelines:
            G.add_edge(
                pipeline.start_station_id,
                pipeline.end_station_id,
                pipeline_id=pipeline.id,
                name=pipeline.name,
                weight=pipeline.length,
                category=pipeline.category
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
