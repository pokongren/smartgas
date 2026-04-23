from __future__ import annotations

from typing import Any, Dict, List


def _check(condition: bool, check_id: str, expected: str, actual: Any, note: str) -> Dict[str, Any]:
    return {
        "id": check_id,
        "passed": bool(condition),
        "expected": expected,
        "actual": actual,
        "note": note,
    }


def evaluate_steady_result(
    pilot_id: str,
    scenario_id: str,
    solver_input: Dict[str, Any],
    result: Dict[str, Any],
) -> Dict[str, Any]:
    node_map = {str(item.get("id")): item for item in result.get("nodes", [])}
    edge_map = {str(item.get("id")): item for item in result.get("edges", [])}
    input_node_map = {str(item.get("id")): item for item in solver_input.get("nodes", [])}
    checks: List[Dict[str, Any]] = []

    checks.append(
        _check(
            result.get("solver_status") == "converged",
            "solver_status",
            "converged",
            result.get("solver_status"),
            "主样板基线场景先要求稳态求解能收敛。",
        )
    )
    checks.append(
        _check(
            len(result.get("nodes", [])) > 0 and len(result.get("edges", [])) > 0,
            "result_shape",
            "nodes>0 and edges>0",
            {
                "nodes": len(result.get("nodes", [])),
                "edges": len(result.get("edges", [])),
            },
            "阶段 3 先收口主样板结果对象，不接受空结果。",
        )
    )

    if pilot_id == "mainline_zhongwei_jingbian" and scenario_id == "steady_base":
        source_id = "WE1-67"
        source_result = node_map.get(source_id, {})
        source_input = input_node_map.get(source_id, {})
        source_target = float(source_input.get("target_pressure_mpa", 0.0))
        source_actual = float(source_result.get("pressure_mpa", 0.0))
        checks.append(
            _check(
                source_actual >= source_target - 0.2,
                "source_boundary_preserved",
                f">= {max(source_target - 0.2, 0):.2f} MPa",
                round(source_actual, 4),
                "源站应保持边界条件，不应被上游 transit 节点反向压低。",
            )
        )

        ordered_node_ids = ["WE1-67", "WE1-76", "WE1-86", "WE1-92"]
        ordered_pressures = [float(node_map.get(node_id, {}).get("pressure_mpa", 0.0)) for node_id in ordered_node_ids]
        is_non_increasing = all(
            ordered_pressures[idx] + 0.05 >= ordered_pressures[idx + 1]
            for idx in range(len(ordered_pressures) - 1)
        )
        checks.append(
            _check(
                is_non_increasing,
                "mainline_pressure_order",
                "WE1-67 >= WE1-76 >= WE1-86 >= WE1-92",
                dict(zip(ordered_node_ids, [round(value, 4) for value in ordered_pressures])),
                "主样板第一轮先收口主干压力阶梯，不要求更细的物理拟合。",
            )
        )

        tracked_edge_ids = ["WE1-T-66", "WE1-T-75", "WE1-T-90"]
        tracked_edges = {
            edge_id: {
                "direction": edge_map.get(edge_id, {}).get("direction"),
                "flow_rate": edge_map.get(edge_id, {}).get("flow_rate"),
            }
            for edge_id in tracked_edge_ids
        }
        checks.append(
            _check(
                all(
                    tracked_edges[edge_id]["direction"] == "forward"
                    and float(tracked_edges[edge_id]["flow_rate"] or 0.0) > 0
                    for edge_id in tracked_edge_ids
                ),
                "mainline_key_edges_forward",
                "tracked edges direction=forward and flow>0",
                tracked_edges,
                "主样板基线阶段先要求关键主干边方向稳定向前且有正流量。",
            )
        )

    passed = all(item["passed"] for item in checks)
    return {
        "profile": f"{pilot_id}:{scenario_id}:steady-validation-v1",
        "passed": passed,
        "checks": checks,
        "recommended_next_step": (
            "可以继续推进辅样板分流求解。"
            if passed
            else "先回查 solver input 边界和主样板稳态求解链。"
        ),
    }


def evaluate_branch_results(
    base_result: Dict[str, Any],
    xuedian_result: Dict[str, Any],
    changlv_result: Dict[str, Any],
    limited_result: Dict[str, Any],
) -> Dict[str, Any]:
    def _edge_map(result: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        return {str(item.get("id")): item for item in result.get("edges", [])}

    base_edges = _edge_map(base_result)
    xuedian_edges = _edge_map(xuedian_result)
    changlv_edges = _edge_map(changlv_result)
    limited_edges = _edge_map(limited_result)
    checks: List[Dict[str, Any]] = []

    trunk_edge_id = "WE1-T-128"
    branch_edge_id = "WE1-B1-T-1"

    checks.append(
        _check(
            base_result.get("solver_status") == "converged"
            and xuedian_result.get("solver_status") == "converged"
            and changlv_result.get("solver_status") == "converged"
            and limited_result.get("solver_status") == "converged",
            "branch_solver_status",
            "all converged",
            {
                "base": base_result.get("solver_status"),
                "xuedian": xuedian_result.get("solver_status"),
                "changlv": changlv_result.get("solver_status"),
                "limited": limited_result.get("solver_status"),
            },
            "辅样板 4 个场景先要求都能稳定收敛。",
        )
    )
    checks.append(
        _check(
            float(xuedian_edges.get(trunk_edge_id, {}).get("flow_rate", 0.0))
            > float(base_edges.get(trunk_edge_id, {}).get("flow_rate", 0.0)),
            "xuedian_load_changes_trunk",
            "xuedian trunk flow > base trunk flow",
            {
                "base": base_edges.get(trunk_edge_id, {}).get("flow_rate"),
                "xuedian": xuedian_edges.get(trunk_edge_id, {}).get("flow_rate"),
            },
            "薛店负荷上调后，主干分配应该增加。",
        )
    )
    checks.append(
        _check(
            float(changlv_edges.get(branch_edge_id, {}).get("flow_rate", 0.0))
            > float(base_edges.get(branch_edge_id, {}).get("flow_rate", 0.0)),
            "changlv_load_changes_branch",
            "changlv branch flow > base branch flow",
            {
                "base": base_edges.get(branch_edge_id, {}).get("flow_rate"),
                "changlv": changlv_edges.get(branch_edge_id, {}).get("flow_rate"),
            },
            "长铝负荷上调后，支线流量应该增加。",
        )
    )
    checks.append(
        _check(
            float(limited_edges.get(branch_edge_id, {}).get("flow_rate", 0.0))
            < float(base_edges.get(branch_edge_id, {}).get("flow_rate", 0.0)),
            "branch_limited_reduces_branch_flow",
            "limited branch flow < base branch flow",
            {
                "base": base_edges.get(branch_edge_id, {}).get("flow_rate"),
                "limited": limited_edges.get(branch_edge_id, {}).get("flow_rate"),
            },
            "支线限流后，支线流量应该下降。",
        )
    )

    passed = all(item["passed"] for item in checks)
    return {
        "profile": "zhengzhou_xuedian_changlv:branch-validation-v1",
        "passed": passed,
        "checks": checks,
        "recommended_next_step": (
            "可以继续推进主辅样板联合回归。"
            if passed
            else "先回查辅样板场景覆盖、分流估算和支线限流逻辑。"
        ),
    }
