"""
阶段二：后端核心推演引擎 (Simulation Engine)

基于带权 BFS 的断流传播仿真，严格按照 Tick 推进状态机。
"""

import networkx as nx
from collections import deque, defaultdict
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum


class PipeStatus(str, Enum):
    """管线状态枚举"""
    NORMAL = "normal"              # 正常（绿色）
    DEPRESSURIZING = "depressurizing"  # 降压中（黄色）
    OUTAGE = "outage"              # 断流（红色）


@dataclass
class PipeStateChange:
    """管线状态变化事件"""
    tick: int
    pipe_id: str
    from_status: str
    to_status: str


@dataclass
class SimulationFrame:
    """仿真时间帧"""
    tick: int
    timestamp: str
    changed_pipes: Dict[str, Dict[str, str]]  # pipe_id -> {from, to}


@dataclass
class SimulationResult:
    """仿真结果契约"""
    total_ticks: int
    affected_pipes: int
    ai_summary_context: str
    frames: List[SimulationFrame]
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典（用于 JSON 序列化）"""
        return {
            "total_ticks": self.total_ticks,
            "affected_pipes": self.affected_pipes,
            "ai_summary_context": self.ai_summary_context,
            "frames": [
                {
                    "tick": f.tick,
                    "timestamp": f.timestamp,
                    "changed_pipes": f.changed_pipes
                }
                for f in self.frames
            ]
        }


class SimulationService:
    """
    管网断流仿真推演引擎
    
    核心算法：带权 BFS 状态机
    - 每个 Tick = 10 分钟现实时间
    - 管存以 1000m³/tick 的速率消耗
    - 状态跃迁：normal → depressurizing → outage
    """
    
    def __init__(self, directed_graph: nx.DiGraph, tick_minutes: int = 10):
        """
        初始化仿真引擎
        
        Args:
            directed_graph: 带有物理权重的有向图
            tick_minutes: 每个 Tick 代表现实时间（分钟）
        """
        self.base_graph = directed_graph
        self.tick_minutes = tick_minutes
    
    def simulate(
        self,
        failure_node: str,
        max_ticks: int = 1000
    ) -> SimulationResult:
        """
        执行断流仿真推演
        
        Args:
            failure_node: 故障源节点 ID（如压气站）
            max_ticks: 最大推演 Tick 数（防止无限循环）
        
        Returns:
            SimulationResult: 包含完整时间轴帧序列的仿真结果
        """
        # 1. 快照隔离：深拷贝图，不污染原始数据
        G = self._create_simulation_graph()
        
        # 2. 拓扑切断：断开故障节点的所有外输边
        self._apply_failure(G, failure_node)
        
        # 3. 时间轴演进：Tick Loop
        frames = []
        tick = 0
        affected_pipes = set()
        
        # BFS 队列：(当前节点, 管存耗尽时间, 来自节点)
        # 故障节点的直接下游边已经在 _apply_failure 中标记为 depressurizing
        queue = deque()
        for _, v, data in G.out_edges(failure_node, data=True):
            delay_ticks = data.get('delay_ticks', 1)
            queue.append((v, delay_ticks, failure_node))
            affected_pipes.add(data['pipeline_id'])
        
        # 记录初始状态变化（故障节点下游立即降压）
        if queue:
            initial_changes = {}
            for v, _, _ in queue:  # (v, delay_ticks, failure_node)
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
        
        # 主循环：按时间推进
        while queue and tick < max_ticks:
            tick += 1
            tick_changes = {}
            
            # 处理当前 Tick 的所有事件
            queue_size = len(queue)
            for _ in range(queue_size):
                node, depletion_tick, from_node = queue.popleft()
                
                if depletion_tick > tick:
                    # 还未耗尽，放回队列
                    queue.append((node, depletion_tick, from_node))
                    continue
                
                # 管存耗尽，状态跃迁为 outage
                edge_data = G[from_node][node]
                if edge_data['status'] != 'outage':
                    edge_data['status'] = 'outage'
                    edge_data['remaining_ticks'] = 0
                    tick_changes[edge_data['pipeline_id']] = {
                        "from": "depressurizing",
                        "to": "outage"
                    }
                    
                    # 向下一级传播：下游管线开始降压
                    for _, next_node, next_data in G.out_edges(node, data=True):
                        if next_data.get('status') == 'normal':
                            next_data['status'] = 'depressurizing'
                            next_data['remaining_ticks'] = next_data['delay_ticks']
                            queue.append((next_node, tick + next_data['delay_ticks'], node))
                            affected_pipes.add(next_data['pipeline_id'])
                            
                            tick_changes[next_data['pipeline_id']] = {
                                "from": "normal",
                                "to": "depressurizing"
                            }
            
            # 记录本帧变化
            if tick_changes:
                frames.append(SimulationFrame(
                    tick=tick,
                    timestamp=self._tick_to_timestamp(tick),
                    changed_pipes=tick_changes
                ))
        
        # 4. 生成 AI 摘要
        summary = self._generate_summary(
            failure_node=G.nodes[failure_node].get('name', failure_node),
            affected_count=len(affected_pipes),
            total_ticks=tick,
            max_outage_tick=self._find_max_outage_tick(frames)
        )
        
        return SimulationResult(
            total_ticks=tick,
            affected_pipes=len(affected_pipes),
            ai_summary_context=summary,
            frames=frames
        )
    
    def _create_simulation_graph(self) -> nx.DiGraph:
        """
        创建仿真用的图快照
        
        策略：不 deep copy 整个图，而是复制节点和边的属性
        这样更高效，且避免污染原始图
        """
        G = nx.DiGraph()
        
        # 复制节点
        for node, data in self.base_graph.nodes(data=True):
            G.add_node(node, **data)
        
        # 复制边，并重置仿真状态
        for u, v, data in self.base_graph.edges(data=True):
            edge_attrs = dict(data)
            # 重置仿真状态
            edge_attrs['remaining_ticks'] = edge_attrs.get('delay_ticks', 1)
            edge_attrs['status'] = 'normal'
            G.add_edge(u, v, **edge_attrs)
        
        return G
    
    def _apply_failure(self, G: nx.DiGraph, failure_node: str):
        """
        在图中应用故障：故障节点停止向外输气
        
        业务逻辑：
        1. 压气站停机后，它不能向外出气
        2. 但其出边管内存气仍可支撑一段时间（depressurizing）
        3. 只有当管存耗尽后，才变为 outage
        """
        if failure_node not in G:
            raise ValueError(f"故障节点 {failure_node} 不存在于图中")
        
        # 故障节点的出边立即进入 depressurizing 状态
        # （管存开始消耗，但还未完全断流）
        for _, v, data in list(G.out_edges(failure_node, data=True)):
            data['status'] = 'depressurizing'
            data['remaining_ticks'] = data.get('delay_ticks', 1)
    
    def _tick_to_timestamp(self, tick: int) -> str:
        """将 Tick 转换为时间戳字符串"""
        base_time = datetime.now()
        delta = timedelta(minutes=tick * self.tick_minutes)
        return (base_time + delta).isoformat()
    
    def _find_max_outage_tick(self, frames: List[SimulationFrame]) -> int:
        """找到最后一条管线断流的 Tick"""
        max_tick = 0
        for frame in frames:
            for change in frame.changed_pipes.values():
                if change.get('to') == 'outage':
                    max_tick = max(max_tick, frame.tick)
        return max_tick
    
    def _generate_summary(
        self,
        failure_node: str,
        affected_count: int,
        total_ticks: int,
        max_outage_tick: int
    ) -> str:
        """生成 AI 摘要上下文"""
        hours = max_outage_tick * self.tick_minutes / 60
        
        if affected_count == 0:
            return f"推演结论：{failure_node}故障未对管网造成影响，下游可通过其他路径供气。"
        
        if hours < 1:
            time_desc = f"{int(hours * 60)} 分钟"
        else:
            time_desc = f"约 {hours:.1f} 小时"
        
        return (
            f"推演结论：{failure_node}停机共波及 {affected_count} 条管线，"
            f"预计 {time_desc} 后下游最后一处将彻底断气。"
            f"总推演时长 {total_ticks} ticks（{total_ticks * self.tick_minutes} 分钟）。"
        )


# =============================================================================
# 便捷函数
# =============================================================================

def run_simulation(
    topology_service,
    failure_node: str,
    tick_minutes: int = 10
) -> SimulationResult:
    """
    便捷函数：从拓扑服务直接运行仿真
    
    使用示例：
        from app.services.topology import TopologyService
        from app.services.simulation_service import run_simulation
        from app.database import get_session
        
        session = next(get_session())
        topo = TopologyService(session)
        result = run_simulation(topo, "station_001")
        print(result.ai_summary_context)
    """
    directed_graph = topology_service.get_directed_graph()
    simulator = SimulationService(directed_graph, tick_minutes)
    return simulator.simulate(failure_node)
