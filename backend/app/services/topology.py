"""
管网拓扑图算法服务 - 阶段一：物理基座重塑 (优化版)

核心优化：
1. 整合计算引擎 - 基于 TopologyComputationService 实现高性能图算法
2. 缓存驱动 - 自动管理 NetworkX 图实例与计算结果
3. 物理权重 - 计算包含管存与延迟属性的有向拓扑
"""

import networkx as nx
from sqlmodel import Session, select
from app.models import Station, Pipeline, JunctionGroup
from app.services.junction_groups import load_normalized_junction_groups
from typing import List, Dict, Optional, Any
from app.services.topology_computation import (
    topology_service, 
    TopologyGraph, 
    TopoNode, 
    TopoEdge,
    NodeType,
    EdgeType
)


class TopologyService:
    """
    管网拓扑图算法服务
    
    支持：
    - 无向图（兼容旧代码，用于连通性分析）
    - 有向图（用于物理仿真与流向推演）
    """
    
    def __init__(self, session: Session):
        self.session = session
    
    @property
    def graph(self) -> nx.Graph:
        """兼容旧代码：返回无向图句柄"""
        return self.get_computation_graph(directed=False).graph
    
    def get_directed_graph(self) -> nx.DiGraph:
        """获取带有物理权重的有向图句柄"""
        return self.get_computation_graph(directed=True).graph

    def get_computation_graph(self, directed: bool = True) -> TopologyGraph:
        """获取已构建的 TopologyGraph 实例（带缓存管理）"""
        cache_key = f"db_graph_v2_{'directed' if directed else 'undirected'}"
        graph = topology_service.get_graph(cache_key)
        if graph is None:
            graph = self._build_computation_graph(directed)
            topology_service._graphs[cache_key] = graph
        return graph

    def refresh(self):
        """刷新所有缓存的图及计算指标"""
        topology_service.clear_cache()
        # 移除以 db_graph_ 开头的内部缓存图
        keys_to_del = [k for k in topology_service._graphs if k.startswith("db_graph_")]
        for key in keys_to_del:
            del topology_service._graphs[key]
    
    def _build_computation_graph(self, directed: bool = True) -> TopologyGraph:
        """从数据库物理模型构建高性能拓扑图，并执行节点收缩（JunctionGroup）"""
        graph = TopologyGraph(directed=directed)
        
        # 0. 预加载 JunctionGroup 进行节点收缩映射
        junctions = load_normalized_junction_groups(self.session)
        station_to_junction = {}  # station_id -> super_node_id
        junction_nodes = {}       # super_node_id -> info
        
        for j in junctions:
            sids = j["station_ids"]
            if not sids:
                continue
            super_node_id = f"JUNC_{j['id']}"
            junction_nodes[super_node_id] = {
                "id": super_node_id,
                "name": j["name"],
                "sids": sids
            }
            for sid in sids:
                station_to_junction[sid] = super_node_id
                
        # 1. 注入节点 (站场)
        stations = self.session.exec(select(Station)).all()
        added_super_nodes = set()
        
        for s in stations:
            super_node_id = station_to_junction.get(s.id)
            
            if super_node_id:
                # 属于枢纽的节点，合并为超级节点
                if super_node_id not in added_super_nodes:
                    j_info = junction_nodes[super_node_id]
                    graph.add_node(TopoNode(
                        id=super_node_id,
                        name=j_info["name"],
                        node_type=NodeType.JUNCTION,
                        longitude=s.longitude,
                        latitude=s.latitude,
                        pressure_mpa=s.design_pressure or 10.0,
                        capacity=s.capacity or 0.0,
                        properties={"is_super_junction": True, "original_stations": j_info["sids"]}
                    ))
                    added_super_nodes.add(super_node_id)
            else:
                # 安全转换类型：DB 中可能有 'other'/'shared' 等不在枚举内的值
                try:
                    node_type = NodeType(s.type)
                except ValueError:
                    node_type = NodeType.JUNCTION
                graph.add_node(TopoNode(
                    id=s.id,
                    name=s.name,
                    node_type=node_type,
                    longitude=s.longitude,
                    latitude=s.latitude,
                    pressure_mpa=s.design_pressure or 10.0,
                    capacity=s.capacity or 0.0
                ))
            
        # 2. 注入边 (管线)
        pipelines = self.session.exec(select(Pipeline)).all()
        for p in pipelines:
            source_id = station_to_junction.get(p.start_station_id, p.start_station_id)
            target_id = station_to_junction.get(p.end_station_id, p.end_station_id)
            
            # 防自环：若起止点均归属同一个超级枢纽内部，视为内部短路，消除断头路/自环
            if source_id == target_id:
                continue
                
            diameter_mm = p.diameter_mm or (float(p.diameter) if p.diameter else 0.0)
            length_km = p.length_km or p.length or 0.0
            
            graph.add_edge(TopoEdge(
                id=p.id,
                source=source_id,
                target=target_id,
                name=p.name,
                edge_type=EdgeType.TRUNK if p.category == 'trunk' else EdgeType.BRANCH,
                length_km=length_km,
                diameter_mm=diameter_mm,
                design_pressure_mpa=p.design_pressure_mpa or 10.0,
                # 初始物理值为0，add_edge 会触发自动计算
                linepack_volume=0.0, 
                flow_rate=0.0
            ))
            
        return graph

    def find_alternative_routes(
        self,
        source: str,
        target: str,
        blocked_pipelines: Optional[List[str]] = None
    ) -> List[Dict]:
        """寻找两点间的备用路径 (整合高性能路径搜索)"""
        graph = self.get_computation_graph(directed=False)
        
        # 如果存在阻塞管线，创建临时子图或在搜索时排除
        if blocked_pipelines:
            # 找到需要保留的节点
            all_node_ids = set(graph._nodes.keys())
            # 简化方案：TopologyGraph 目前通过 exclude_nodes 过滤。
            # 为了过滤“边”，我们目前通过 reconstruct 临时子图。
            sub = TopologyGraph(directed=False)
            for nid, node in graph._nodes.items():
                sub.add_node(node)
            for eid, edge in graph._edges.items():
                if eid not in blocked_pipelines:
                    sub.add_edge(edge)
            result = sub.find_path(source, target)
        else:
            result = graph.find_path(source, target)
            
        if not result: return []
        
        # 转换为前端兼容的旧格式数据
        res_dict = result.to_dict()
        res_dict["estimated_time"] = f"{int(res_dict['total_length'] / 100)}h"
        res_dict["risk_level"] = "low"
        return [res_dict]
    
    def calculate_impact_area(self, failed_pipeline_id: str) -> List[str]:
        """计算管线故障导致的受影响站场范围（基于图连通性）"""
        graph_obj = self.get_computation_graph(directed=False)
        nx_g = graph_obj.graph
        
        # 定位需要断开的 A-B 节点对
        u_v = None
        for u, v, data in nx_g.edges(data=True):
            if data.get('id') == failed_pipeline_id:
                u_v = (u, v)
                break
        
        if not u_v: return []
        
        # 模拟断开
        temp_g = nx_g.copy()
        temp_g.remove_edge(*u_v)
        
        # 计算连通分量，受影响通常是较小的那个分量（孤岛）
        components = list(nx.connected_components(temp_g))
        if len(components) <= 1: return []
        
        affected_nodes = min(components, key=len)
        return [
            graph_obj.get_node(nid).name 
            for nid in affected_nodes 
            if graph_obj.get_node(nid)
        ]
    
    def find_critical_nodes(self) -> Dict[str, float]:
        """智能识别管网枢纽节点 (基于介数中心性)"""
        graph_obj = self.get_computation_graph(directed=False)
        centrality = graph_obj.calculate_centrality()
        
        # 提取介数中心性前5名并映射名称
        top_5 = sorted(
            centrality.betweenness.items(),
            key=lambda x: x[1],
            reverse=True
        )[:5]
        
        return {
            graph_obj.get_node(nid).name: round(score, 4)
            for nid, score in top_5
            if graph_obj.get_node(nid)
        }
    
    def get_graph_summary(self) -> Dict:
        """获取全管网拓扑物理概览"""
        graph_obj = self.get_computation_graph(directed=True)
        total_linepack = sum(
            e.linepack_volume for e in graph_obj._edges.values()
        )
        return {
            "node_count": graph_obj.node_count,
            "edge_count": graph_obj.edge_count,
            "total_linepack": round(total_linepack, 2)
        }
