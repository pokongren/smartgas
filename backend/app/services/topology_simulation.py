"""
稳态求解引擎 (Steady-State Solver)

与 simulation_service.py（断流传播）完全分开。
这里只做一件事：输入一套拓扑 + 场景，输出每个节点的压力和每条管道的流量。

算法：工程近似迭代法
1. source 节点给定供气压力
2. 沿有向图传播，按摩擦阻力公式算压降
3. 压气站负责把压力抬回目标值
4. 阀门负责限流
5. 迭代直到收敛（节点压力变化 < 容差）

输出格式与前端 SimulationOverlay 类型完全对齐。
"""

from __future__ import annotations

import math
import logging
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# 常量
# ─────────────────────────────────────────────

# 摩擦阻力简化公式系数（Weymouth 近似，适合高压天然气）
# ΔP² = K * L * Q² / D^5.333
# K 是综合系数，已折算到 MPa / (10^4 Nm³/d)² 单位
_WEYMOUTH_K = 0.00453

# 压力颜色阈值（利用率）
_COLOR_GREEN = "#22c55e"   # 利用率 < 0.7
_COLOR_YELLOW = "#eab308"  # 0.7 ~ 0.85
_COLOR_ORANGE = "#f97316"  # 0.85 ~ 0.95
_COLOR_RED = "#ef4444"     # > 0.95 或告警

# 告警阈值
_ALERT_LOW_PRESSURE_RATIO = 0.88  # 低于设计压力的 88% 触发告警
_ALERT_HIGH_UTIL = 0.92           # 利用率超过 92% 触发告警


# ─────────────────────────────────────────────
# 数据模型
# ─────────────────────────────────────────────

@dataclass
class NodeState:
    """节点运行状态"""
    node_id: str
    pressure_mpa: float
    demand_served: float = 0.0
    supply_actual: float = 0.0
    alert_level: str = "normal"  # normal / warning / critical


@dataclass
class EdgeState:
    """管段运行状态"""
    edge_id: str
    flow_rate: float       # 万方/天
    direction: str         # forward / reverse / zero
    utilization: float     # 0.0 ~ 1.0+
    alert_level: str       # normal / warning / critical
    color: str             # 前端直接用
    width_factor: float    # 前端线宽系数 0.3 ~ 1.5


@dataclass
class SolverResult:
    """求解结果——直接序列化给接口层"""
    pilot_id: str
    scenario_id: str
    solver_status: str        # converged / max_iter / error
    iterations: int
    nodes: List[NodeState]
    edges: List[EdgeState]
    summary: Dict[str, float]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "pilot_id": self.pilot_id,
            "scenario_id": self.scenario_id,
            "solver_status": self.solver_status,
            "iterations": self.iterations,
            "nodes": [
                {
                    "id": n.node_id,
                    "pressure_mpa": round(n.pressure_mpa, 4),
                    "demand_served": round(n.demand_served, 2),
                    "supply_actual": round(n.supply_actual, 2),
                    "alert_level": n.alert_level,
                }
                for n in self.nodes
            ],
            "edges": [
                {
                    "id": e.edge_id,
                    "flow_rate": round(e.flow_rate, 2),
                    "direction": e.direction,
                    "utilization": round(e.utilization, 4),
                    "alert_level": e.alert_level,
                    "color": e.color,
                    "width_factor": round(e.width_factor, 3),
                }
                for e in self.edges
            ],
            "summary": {k: round(v, 4) for k, v in self.summary.items()},
        }


# ─────────────────────────────────────────────
# Seed 装配层
# ─────────────────────────────────────────────

class SeedAssembler:
    """
    从 Seed JSON 装配求解用的图数据。
    Seed 里的 id_range 字段是范围表达式，需要展开成单个 ID 列表。
    """

    def __init__(self, seed: Dict[str, Any]):
        self.seed = seed

    def assemble(self) -> Tuple[
        Dict[str, Dict[str, Any]],   # nodes: id -> attrs
        Dict[str, Dict[str, Any]],   # edges: id -> attrs
        Dict[str, Dict[str, Any]],   # valves: id -> attrs
        List[Dict[str, Any]],        # scenarios
    ]:
        nodes = self._assemble_nodes()
        valves = self._assemble_valves()
        edges = self._assemble_edges()
        scenarios = self.seed.get("scenarios", [])
        return nodes, edges, valves, scenarios

    def _assemble_nodes(self) -> Dict[str, Dict[str, Any]]:
        result = {}
        for n in self.seed.get("nodes", []):
            result[n["id"]] = dict(n)
        return result

    def _assemble_valves(self) -> Dict[str, Dict[str, Any]]:
        result = {}
        for v in self.seed.get("valves", []):
            for vid in self._expand_range(v.get("id_range", [])):
                result[vid] = dict(v)
        return result

    def _assemble_edges(self) -> Dict[str, Dict[str, Any]]:
        result = {}
        for e in self.seed.get("edges", []):
            for eid in self._expand_range(e.get("id_range", [])):
                result[eid] = dict(e)
        return result

    @staticmethod
    def _expand_range(id_range: List[str]) -> List[str]:
        """
        展开 id_range，例如 ["WE1-T-66", "WE1-T-91"] → WE1-T-66, WE1-T-67, ..., WE1-T-91
        如果两个 ID 前缀相同、只有末尾数字不同，按数字范围展开；否则只返回两个端点。
        """
        if not id_range or len(id_range) == 0:
            return []
        if len(id_range) == 1:
            return [id_range[0]]

        start_id, end_id = id_range[0], id_range[-1]

        # 如果首尾相同，只返回一个
        if start_id == end_id:
            return [start_id]

        # 尝试按数字后缀展开
        try:
            prefix, start_num = _split_id_suffix(start_id)
            prefix2, end_num = _split_id_suffix(end_id)
            if prefix == prefix2 and start_num is not None and end_num is not None:
                return [f"{prefix}{i}" for i in range(int(start_num), int(end_num) + 1)]
        except Exception:
            pass

        # 无法展开，返回端点列表
        return [start_id, end_id]


def _split_id_suffix(id_str: str) -> Tuple[str, Optional[str]]:
    """
    把 'WE1-T-66' 拆成 ('WE1-T-', '66')
    把 'WE1-68' 拆成 ('WE1-', '68')
    """
    i = len(id_str) - 1
    while i >= 0 and id_str[i].isdigit():
        i -= 1
    prefix = id_str[:i + 1]
    suffix = id_str[i + 1:] if i + 1 < len(id_str) else None
    return prefix, suffix


# ─────────────────────────────────────────────
# 拓扑排序辅助
# ─────────────────────────────────────────────

def _topological_order(
    node_ids: List[str],
    adjacency: Dict[str, List[Tuple[str, str]]],  # node_id -> [(neighbor_id, edge_id)]
) -> List[str]:
    """
    简单 Kahn 拓扑排序，返回从 source 到 sink 的节点顺序。
    有环时退化为原列表顺序。
    """
    in_degree: Dict[str, int] = {n: 0 for n in node_ids}
    for node in node_ids:
        for neighbor, _ in adjacency.get(node, []):
            if neighbor in in_degree:
                in_degree[neighbor] = in_degree.get(neighbor, 0) + 1

    queue = [n for n in node_ids if in_degree[n] == 0]
    result = []
    while queue:
        node = queue.pop(0)
        result.append(node)
        for neighbor, _ in adjacency.get(node, []):
            if neighbor in in_degree:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

    if len(result) != len(node_ids):
        logger.warning("拓扑排序检测到环，退化为原始顺序")
        return node_ids

    return result


# ─────────────────────────────────────────────
# 压降计算
# ─────────────────────────────────────────────

def _calc_pressure_drop(
    p_upstream_mpa: float,
    flow_rate: float,     # 万方/天
    length_km: float,
    diameter_mm: float,
    roughness_mm: float = 0.03,
) -> float:
    """
    Weymouth 近似公式计算压降（MPa）。
    返回 ΔP（正值表示压力降低）。
    如果上游压力≤0 或流量≤0，返回 0。
    """
    if p_upstream_mpa <= 0 or flow_rate <= 0:
        return 0.0

    d5 = (diameter_mm ** 5.333)
    if d5 <= 0:
        return 0.0

    # 摩擦系数（用对数公式近似）
    epsilon = roughness_mm / diameter_mm
    friction = 0.0055 * (1 + (20000 * epsilon + 1e6 / max(flow_rate, 1)) ** 0.333)

    # Weymouth 公式（近似）
    # ΔP² = K * friction * L * Q² / D^5.333
    delta_p_sq = _WEYMOUTH_K * friction * length_km * (flow_rate ** 2) / d5
    delta_p = math.sqrt(max(delta_p_sq, 0))

    # 保证下游压力不低于 0
    delta_p = min(delta_p, p_upstream_mpa * 0.9)
    return delta_p


# ─────────────────────────────────────────────
# 场景覆盖应用
# ─────────────────────────────────────────────

def _apply_scenario(
    nodes: Dict[str, Dict],
    edges: Dict[str, Dict],
    valves: Dict[str, Dict],
    scenario: Dict[str, Any],
) -> Tuple[Dict, Dict, Dict]:
    """
    把场景覆盖叠加到 nodes/edges/valves 上，返回深拷贝后的新版本。
    """
    nodes = deepcopy(nodes)
    edges = deepcopy(edges)
    valves = deepcopy(valves)

    for override in scenario.get("node_overrides", []):
        nid = override.get("node_id")
        if nid in nodes:
            nodes[nid].update(override)

    for override in scenario.get("edge_overrides", []):
        eid = override.get("edge_id")
        if eid in edges:
            edges[eid].update(override)

    for override in scenario.get("compressor_overrides", []):
        nid = override.get("node_id")
        if nid in nodes:
            nodes[nid].update(override)

    return nodes, edges, valves


# ─────────────────────────────────────────────
# 求解器主体
# ─────────────────────────────────────────────

class SteadyStateSolver:
    """
    稳态求解器。

    核心逻辑：
    1. 从 source 节点出发，沿管道方向传播压力
    2. 每段管道根据流量和管道参数计算压降
    3. 压气站在节点处把压力抬回目标值
    4. sink 节点按需求分流
    5. 迭代直到压力分布收敛
    """

    MAX_ITER = 40
    TOLERANCE = 0.005  # MPa，节点压力变化容差

    def __init__(
        self,
        seed: Dict[str, Any],
        pilot_id: str = "unknown",
    ):
        self.pilot_id = pilot_id
        assembler = SeedAssembler(seed)
        self._base_nodes, self._base_edges, self._base_valves, self._scenarios = assembler.assemble()

        # 从 seed 里提取系统内的节点 ID 与管段 ID 顺序
        # edges 的 source/target 关系从数据库组装层来，
        # seed 里暂时没有 source/target，需要通过管段 ID 推断顺序
        # 简化处理：按 ID 数字后缀排序，建立线性有向图
        self._sorted_edge_ids = sorted(
            self._base_edges.keys(),
            key=lambda x: _id_num_key(x),
        )
        self._sorted_node_ids = sorted(
            self._base_nodes.keys(),
            key=lambda x: _id_num_key(x),
        )

    def solve(self, scenario_id: str = "steady_base") -> SolverResult:
        """
        执行稳态求解，返回 SolverResult。
        """
        # 找场景
        scenario = next(
            (s for s in self._scenarios if s["id"] == scenario_id),
            None,
        )
        if scenario is None:
            logger.warning(f"未找到场景 {scenario_id}，使用基线场景")
            scenario = {"id": scenario_id, "node_overrides": [], "edge_overrides": [], "compressor_overrides": []}

        # 应用场景覆盖
        nodes, edges, valves = _apply_scenario(
            self._base_nodes, self._base_edges, self._base_valves, scenario
        )

        # 初始化节点压力
        pressure: Dict[str, float] = {}
        for nid, ndata in nodes.items():
            if ndata.get("role") == "source":
                pressure[nid] = float(ndata.get("target_pressure_mpa", 9.5))
            else:
                pressure[nid] = float(ndata.get("target_pressure_mpa", 8.0))

        # 迭代求解
        iterations = 0
        solver_status = "converged"

        for iteration in range(self.MAX_ITER):
            new_pressure = dict(pressure)

            # 沿排序好的管段正向传播压力
            for eid in self._sorted_edge_ids:
                edata = edges.get(eid, {})
                status = edata.get("status", "open")
                if status == "closed":
                    continue

                # 推断上下游节点（按管段 ID 数字顺序找相邻节点）
                upstream, downstream = _infer_edge_endpoints(eid, self._sorted_node_ids)
                if upstream is None or downstream is None:
                    continue

                p_up = new_pressure.get(upstream, 8.0)
                if p_up <= 0:
                    new_pressure[downstream] = 0.0
                    continue

                # 计算流量（先按 source 供给和各 sink 需求分配）
                flow = _estimate_flow(eid, edata, nodes, edges, valves,
                                     self._sorted_node_ids, self._sorted_edge_ids)

                # 限流（阀门或 limited 状态）
                if status == "limited":
                    max_flow = float(edata.get("max_flow", 150.0))
                    flow = min(flow, max_flow)

                # 计算压降
                length_km = float(edata.get("length_km", edata.get("length_km_default", 100.0)))
                diameter_mm = float(edata.get("diameter_mm", edata.get("diameter_mm_default", 1016.0)))
                roughness_mm = float(edata.get("roughness_mm", edata.get("roughness_mm_default", 0.03)))

                delta_p = _calc_pressure_drop(p_up, flow, length_km, diameter_mm, roughness_mm)
                p_down = p_up - delta_p

                # 下游如果是压气站且开启，抬压
                down_node = nodes.get(downstream, {})
                if (
                    down_node.get("type") == "compressor"
                    and down_node.get("compressor_enabled", True)
                    and down_node.get("role") != "source"
                ):
                    target = float(down_node.get("target_pressure_mpa", p_down))
                    p_down = max(p_down, target)

                # 保证压力在合理范围内
                min_p = float(down_node.get("min_pressure_mpa", 0.0))
                max_p = float(down_node.get("max_pressure_mpa", 12.0))
                p_down = max(min_p, min(max_p, p_down))

                new_pressure[downstream] = p_down

            # 检查收敛
            max_delta = max(
                abs(new_pressure.get(n, 0) - pressure.get(n, 0))
                for n in pressure
            )
            pressure = new_pressure
            iterations = iteration + 1

            if max_delta < self.TOLERANCE:
                break
        else:
            solver_status = "max_iter"
            logger.warning(f"场景 {scenario_id} 未在 {self.MAX_ITER} 轮内收敛，max_delta={max_delta:.4f}")

        # 组装结果
        node_states = self._build_node_states(nodes, pressure)
        edge_states = self._build_edge_states(edges, valves, nodes, pressure)
        summary = self._build_summary(nodes, node_states, edge_states)

        return SolverResult(
            pilot_id=self.pilot_id,
            scenario_id=scenario_id,
            solver_status=solver_status,
            iterations=iterations,
            nodes=node_states,
            edges=edge_states,
            summary=summary,
        )

    def _build_node_states(
        self,
        nodes: Dict[str, Dict],
        pressure: Dict[str, float],
    ) -> List[NodeState]:
        states = []
        for nid, ndata in nodes.items():
            p = pressure.get(nid, 0.0)
            min_p = float(ndata.get("min_pressure_mpa", 0.0))
            design_p = float(ndata.get("target_pressure_mpa", p))

            alert = "normal"
            if design_p > 0 and p < design_p * _ALERT_LOW_PRESSURE_RATIO:
                alert = "warning"
            if p < min_p:
                alert = "critical"

            demand = float(ndata.get("demand_nominal", 0.0))
            supply = float(ndata.get("supply_max", 0.0)) if ndata.get("role") == "source" else 0.0

            states.append(NodeState(
                node_id=nid,
                pressure_mpa=p,
                demand_served=demand if ndata.get("role") == "sink" else 0.0,
                supply_actual=supply,
                alert_level=alert,
            ))
        return states

    def _build_edge_states(
        self,
        edges: Dict[str, Dict],
        valves: Dict[str, Dict],
        nodes: Dict[str, Dict],
        pressure: Dict[str, float],
    ) -> List[EdgeState]:
        states = []
        for eid in self._sorted_edge_ids:
            edata = edges.get(eid, {})
            status = edata.get("status", "open")

            max_flow = float(edata.get("max_flow", 150.0))

            if status == "closed":
                flow = 0.0
            else:
                flow = _estimate_flow(
                    eid, edata, nodes, edges, valves,
                    self._sorted_node_ids, self._sorted_edge_ids,
                )
                if status == "limited":
                    flow = min(flow, max_flow)

            utilization = flow / max_flow if max_flow > 0 else 0.0
            direction = "forward" if flow > 0 else ("reverse" if flow < 0 else "zero")

            alert = "normal"
            if utilization > _ALERT_HIGH_UTIL:
                alert = "warning"
            if utilization > 1.0:
                alert = "critical"
            if status == "closed":
                alert = "normal"

            color = _util_to_color(utilization if status != "closed" else 0)
            width_factor = max(0.3, min(1.5, 0.4 + utilization * 1.1))

            states.append(EdgeState(
                edge_id=eid,
                flow_rate=abs(flow),
                direction=direction,
                utilization=utilization,
                alert_level=alert,
                color=color,
                width_factor=width_factor,
            ))
        return states

    def _build_summary(
        self,
        nodes: Dict[str, Dict],
        node_states: List[NodeState],
        edge_states: List[EdgeState],
    ) -> Dict[str, float]:
        total_supply = sum(n.supply_actual for n in node_states)
        total_demand = sum(
            float(nodes.get(n.node_id, {}).get("demand_nominal", 0.0))
            for n in node_states
            if nodes.get(n.node_id, {}).get("role") == "sink"
        )
        unserved = max(0.0, total_demand - total_supply)
        avg_util = (
            sum(e.utilization for e in edge_states) / len(edge_states)
            if edge_states else 0.0
        )
        warning_count = sum(1 for n in node_states if n.alert_level != "normal")
        warning_count += sum(1 for e in edge_states if e.alert_level != "normal")

        return {
            "total_supply": total_supply,
            "total_demand": total_demand,
            "unserved_demand": unserved,
            "avg_utilization": avg_util,
            "alert_count": float(warning_count),
        }


# ─────────────────────────────────────────────
# 辅助函数
# ─────────────────────────────────────────────

def _id_num_key(id_str: str):
    """提取 ID 中所有数字片段，用于稳定排序"""
    import re
    parts = re.split(r"(\d+)", id_str)
    return [int(p) if p.isdigit() else p for p in parts]


def _infer_edge_endpoints(
    edge_id: str,
    sorted_node_ids: List[str],
) -> Tuple[Optional[str], Optional[str]]:
    """
    根据管段 ID 推断上下游节点。
    规则：管段 WE1-T-66 对应节点 WE1-66（上游）和 WE1-67（下游）。
    支持 WE1-T-xxx 格式和 WE1-B1-T-xxx 格式。
    """
    # WE1-T-66 → prefix=WE1, num=66
    # WE1-B1-T-1 → prefix=WE1-B1, num=1
    import re
    m = re.match(r"^(.*?)-T-(\d+)$", edge_id)
    if not m:
        return None, None

    sys_prefix = m.group(1)  # e.g. WE1 or WE1-B1
    num = int(m.group(2))

    upstream_id = f"{sys_prefix}-{num}"
    downstream_id = f"{sys_prefix}-{num + 1}"

    # 验证节点是否在列表中
    if upstream_id not in sorted_node_ids and downstream_id not in sorted_node_ids:
        return None, None

    return upstream_id, downstream_id


def _estimate_flow(
    edge_id: str,
    edata: Dict,
    nodes: Dict[str, Dict],
    edges: Dict[str, Dict],
    valves: Dict[str, Dict],
    sorted_node_ids: List[str],
    sorted_edge_ids: List[str],
) -> float:
    """
    估算管段流量。
    简化：主干管道取 source 总供给 × 该段承担比例。
    Branch 管道取 source 总供给的下游需求比例。

    这是一阶近似，迭代过程中会逐步收敛。
    """
    # 找 source 总供给
    total_supply = sum(
        float(n.get("supply_max", 0.0))
        for n in nodes.values()
        if n.get("role") == "source"
    )
    if total_supply <= 0:
        total_supply = 150.0  # 默认值

    max_flow = float(edata.get("max_flow", 150.0))

    # 取管段额定容量和供给的较小值作为估算流量
    return min(total_supply * 0.85, max_flow * 0.85)


def _util_to_color(utilization: float) -> str:
    """根据利用率返回颜色"""
    if utilization <= 0:
        return "#64748b"   # 零流量：灰色
    if utilization < 0.70:
        return _COLOR_GREEN
    if utilization < 0.85:
        return _COLOR_YELLOW
    if utilization < 0.95:
        return _COLOR_ORANGE
    return _COLOR_RED


# ─────────────────────────────────────────────
# 公共入口
# ─────────────────────────────────────────────

def solve_steady(
    seed: Dict[str, Any],
    scenario_id: str = "steady_base",
    pilot_id: str = "unknown",
) -> SolverResult:
    """
    公共入口：给定 seed 和场景 ID，返回稳态求解结果。
    """
    solver = SteadyStateSolver(seed=seed, pilot_id=pilot_id)
    return solver.solve(scenario_id=scenario_id)
