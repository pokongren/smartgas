"""
阶段二：后端核心推演引擎 (Simulation Engine) - 优化版

基于带权 BFS 的断流传播仿真，严格按照 Tick 推进状态机。
优化内容：
- 图快照缓存，避免重复深拷贝
- 压力等级系数
- 动态消耗速率
"""

import networkx as nx
from collections import deque, defaultdict
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
import copy


class PipeStatus(str, Enum):
    """管线状态枚举"""
    NORMAL = "normal"
    DEPRESSURIZING = "depressurizing"
    OUTAGE = "outage"


@dataclass
class SimulationConfig:
    """仿真配置"""
    tick_minutes: int = 10
    consumption_rate_base: float = 1000.0  # m³/tick
    pressure_factor_enabled: bool = True
    season_factor_enabled: bool = False
    max_ticks: int = 10000


@dataclass
class SimulationFrame:
    """仿真时间帧"""
    tick: int
    timestamp: str
    changed_pipes: Dict[str, Dict[str, str]]


@dataclass
class SimulationResult:
    """仿真结果契约"""
    total_ticks: int
    affected_pipes: int
    ai_summary_context: str
    frames: List[SimulationFrame]
    failure_nodes: List[str]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_ticks": self.total_ticks,
            "affected_pipes": self.affected_pipes,
            "ai_summary_context": self.ai_summary_context,
            "failure_nodes": self.failure_nodes,
            "frames": [
                {
                    "tick": f.tick,
                    "timestamp": f.timestamp,
                    "changed_pipes": f.changed_pipes
                }
                for f in self.frames
            ]
        }


class OptimizedSimulationEngine:
    """
    优化的管网断流仿真推演引擎
    
    核心优化：
    1. 图快照缓存 - 避免每次仿真都重建图
    2. 压力等级系数 - 高压管道存气更多
    3. 惰性求值 - 按需计算状态
    """
    
    def __init__(self, directed_graph: nx.DiGraph, config: Optional[SimulationConfig] = None):
        self.base_graph = directed_graph
        self.config = config or SimulationConfig()
        self._graph_template = None  # 缓存图模板
    
    def _get_graph_template(self) -> nx.DiGraph:
        """获取图模板（缓存避免重复创建）"""
        if self._graph_template is None:
            self._graph_template = self._create_graph_template()
        return self._graph_template
    
    def _create_graph_template(self) -> nx.DiGraph:
        """创建图模板（只包含静态属性）"""
        G = nx.DiGraph()
        
        for node, data in self.base_graph.nodes(data=True):
            G.add_node(node, **data)
        
        for u, v, data in self.base_graph.edges(data=True):
            edge_attrs = {
                # 基础属性
                'pipeline_id': data.get('pipeline_id'),
                'name': data.get('name'),
                'category': data.get('category'),
                # 物理属性
                'diameter_mm': data.get('diameter_mm'),
                'length_km': data.get('length_km'),
                'linepack_volume': data.get('linepack_volume', 0),
                # 计算属性
                'delay_ticks': self._calculate_effective_delay(data),
                # 运行时状态（会被重置）
                'remaining_ticks': 0,
                'status': 'normal'
            }
            G.add_edge(u, v, **edge_attrs)
        
        return G
    
    def _calculate_effective_delay(self, edge_data: Dict) -> int:
        """计算有效延迟（考虑压力等级）"""
        base_delay = edge_data.get('delay_ticks', 1)
        
        if not self.config.pressure_factor_enabled:
            return base_delay
        
        # 压力系数：高压管道存气更多
        # 假设设计压力 10MPa 为基准
        design_pressure = edge_data.get('design_pressure_mpa', 10.0)
        pressure_factor = max(0.5, design_pressure / 10.0)
        
        effective_delay = int(base_delay * pressure_factor)
        return max(1, effective_delay)
    
    def _create_simulation_graph(self) -> nx.DiGraph:
        """创建仿真图（从模板复制，重置状态）"""
        template = self._get_graph_template()
        G = nx.DiGraph()
        
        # 复制节点
        for node, data in template.nodes(data=True):
            G.add_node(node, **data)
        
        # 复制边，重置运行时状态
        for u, v, data in template.edges(data=True):
            edge_attrs = dict(data)
            edge_attrs['remaining_ticks'] = edge_attrs['delay_ticks']
            edge_attrs['status'] = 'normal'
            G.add_edge(u, v, **edge_attrs)
        
        return G
    
    def simulate(
        self,
        failure_nodes: List[str],
        max_ticks: Optional[int] = None
    ) -> SimulationResult:
        """
        执行断流仿真推演（支持多故障源）
        
        Args:
            failure_nodes: 故障源节点 ID 列表
            max_ticks: 最大推演 Tick 数
        
        Returns:
            SimulationResult: 仿真结果
        """
        max_ticks = max_ticks or self.config.max_ticks
        
        # 1. 创建仿真图
        G = self._create_simulation_graph()
        
        # 2. 应用所有故障
        for node in failure_nodes:
            if node in G:
                self._apply_failure(G, node)
        
        # 3. 初始化队列（所有故障节点的下游）
        queue = deque()
        affected_pipes = set()
        
        for failure_node in failure_nodes:
            for _, v, data in G.out_edges(failure_node, data=True):
                delay = data.get('delay_ticks', 1)
                queue.append((v, delay, failure_node))
                affected_pipes.add(data['pipeline_id'])
        
        # 4. 时间轴演进
        frames = []
        tick = 0
        
        # 初始帧
        if queue:
            initial_changes = {}
            for v, _, failure_node in queue:
                edge_data = G[failure_node][v]
                initial_changes[edge_data['pipeline_id']] = {
                    "from": "normal",
                    "to": "depressurizing"
                }
            frames.append(SimulationFrame(
                tick=0,
                timestamp=self._tick_to_timestamp(0),
                changed_pipes=initial_changes
            ))
        
        # 主循环
        while queue and tick < max_ticks:
            tick += 1
            tick_changes = {}
            
            queue_size = len(queue)
            for _ in range(queue_size):
                node, depletion_tick, from_node = queue.popleft()
                
                if depletion_tick > tick:
                    queue.append((node, depletion_tick, from_node))
                    continue
                
                # 管存耗尽
                edge_data = G[from_node][node]
                if edge_data['status'] != 'outage':
                    edge_data['status'] = 'outage'
                    edge_data['remaining_ticks'] = 0
                    tick_changes[edge_data['pipeline_id']] = {
                        "from": "depressurizing",
                        "to": "outage"
                    }
                    
                    # 向下一级传播
                    for _, next_node, next_data in G.out_edges(node, data=True):
                        if next_data.get('status') == 'normal':
                            next_data['status'] = 'depressurizing'
                            next_delay = next_data.get('delay_ticks', 1)
                            queue.append((next_node, tick + next_delay, node))
                            affected_pipes.add(next_data['pipeline_id'])
                            
                            tick_changes[next_data['pipeline_id']] = {
                                "from": "normal",
                                "to": "depressurizing"
                            }
            
            if tick_changes:
                frames.append(SimulationFrame(
                    tick=tick,
                    timestamp=self._tick_to_timestamp(tick),
                    changed_pipes=tick_changes
                ))
        
        # 5. 生成结果
        summary = self._generate_summary(
            failure_nodes=failure_nodes,
            affected_count=len(affected_pipes),
            total_ticks=tick,
            max_outage_tick=self._find_max_outage_tick(frames)
        )
        
        return SimulationResult(
            total_ticks=tick,
            affected_pipes=len(affected_pipes),
            ai_summary_context=summary,
            frames=frames,
            failure_nodes=failure_nodes
        )
    
    def _apply_failure(self, G: nx.DiGraph, failure_node: str):
        """应用故障到节点"""
        for _, v, data in list(G.out_edges(failure_node, data=True)):
            data['status'] = 'depressurizing'
            data['remaining_ticks'] = data.get('delay_ticks', 1)
    
    def _tick_to_timestamp(self, tick: int) -> str:
        """Tick 转时间戳"""
        base_time = datetime.now()
        delta = timedelta(minutes=tick * self.config.tick_minutes)
        return (base_time + delta).isoformat()
    
    def _find_max_outage_tick(self, frames: List[SimulationFrame]) -> int:
        """找到最后 outage 的 tick"""
        max_tick = 0
        for frame in frames:
            for change in frame.changed_pipes.values():
                if change.get('to') == 'outage':
                    max_tick = max(max_tick, frame.tick)
        return max_tick
    
    def _generate_summary(
        self,
        failure_nodes: List[str],
        affected_count: int,
        total_ticks: int,
        max_outage_tick: int
    ) -> str:
        """生成 AI 摘要"""
        hours = max_outage_tick * self.config.tick_minutes / 60
        
        node_str = f"{len(failure_nodes)}个故障源" if len(failure_nodes) > 1 else failure_nodes[0][:20]
        
        if affected_count == 0:
            return f"推演结论：{node_str}故障未对管网造成影响。"
        
        if hours < 1:
            time_desc = f"{int(hours * 60)}分钟"
        else:
            time_desc = f"约{hours:.1f}小时"
        
        return (
            f"推演结论：{node_str}共波及{affected_count}条管线，"
            f"预计{time_desc}后下游彻底断气。"
        )


# 便捷函数
def run_simulation(
    topology_service,
    failure_node: str,
    tick_minutes: int = 10,
    **kwargs
) -> SimulationResult:
    """便捷函数：运行仿真"""
    directed_graph = topology_service.get_directed_graph()
    config = SimulationConfig(tick_minutes=tick_minutes, **kwargs)
    simulator = OptimizedSimulationEngine(directed_graph, config)
    return simulator.simulate([failure_node])


def run_multi_failure_simulation(
    topology_service,
    failure_nodes: List[str],
    tick_minutes: int = 10,
    **kwargs
) -> SimulationResult:
    """便捷函数：多故障源仿真"""
    directed_graph = topology_service.get_directed_graph()
    config = SimulationConfig(tick_minutes=tick_minutes, **kwargs)
    simulator = OptimizedSimulationEngine(directed_graph, config)
    return simulator.simulate(failure_nodes)
