"""
WE1 阶段3-4三段自动推进：第三次联合回归脚本

运行方式：
    python backend/scripts/verify_we1_phase34_final.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterable

from sqlmodel import Session


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import engine  # noqa: E402
from app.routers.topology_simulation import (  # noqa: E402
    SolveFailureRequest,
    SolveSteadyRequest,
    get_simulation_overlay,
    solve_failure_api,
    solve_steady_api,
)


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _assert_keys(data: Dict[str, Any], keys: Iterable[str], label: str) -> None:
    missing = [key for key in keys if key not in data]
    if missing:
        raise AssertionError(f"{label} 缺少字段: {missing}")


def _node_keys(result: Dict[str, Any]) -> set[str]:
    nodes = result.get("nodes", [])
    return set(nodes[0].keys()) if nodes else set()


def _edge_keys(result: Dict[str, Any]) -> set[str]:
    edges = result.get("edges", [])
    return set(edges[0].keys()) if edges else set()


def _top_keys(result: Dict[str, Any]) -> set[str]:
    return set(result.keys())


def _summary_keys(result: Dict[str, Any]) -> set[str]:
    return set((result.get("summary") or {}).keys())


def _meta_keys(result: Dict[str, Any]) -> set[str]:
    return set((result.get("meta") or {}).keys())


def _node_map(result: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {
        str(item.get("id")): item
        for item in result.get("nodes", [])
        if isinstance(item, dict) and item.get("id")
    }


def main() -> int:
    try:
        print("=== WE1 阶段3-4第三次联合回归开始 ===")

        with Session(engine) as session:
            mainline_steady = solve_steady_api(
                SolveSteadyRequest(
                    pilot_id="mainline_zhongwei_jingbian",
                    scenario_id="steady_base",
                ),
                session=session,
            )
            mainline_failure = solve_failure_api(
                SolveFailureRequest(
                    pilot_id="mainline_zhongwei_jingbian",
                    base_scenario_id="steady_base",
                    failure_node_id="WE1-76",
                    failure_type="compressor_offline",
                ),
                session=session,
            )
            mainline_overlay = get_simulation_overlay(
                pilot_id="mainline_zhongwei_jingbian",
                scenario_id="steady_base",
                session=session,
            )
            branch_overlay = get_simulation_overlay(
                pilot_id="zhengzhou_xuedian_changlv",
                scenario_id="steady_branch_base",
                session=session,
            )

        base_required = {
            "pilot_id",
            "scenario_id",
            "run_id",
            "generated_at",
            "solver_status",
            "iterations",
            "nodes",
            "edges",
            "summary",
            "meta",
        }
        overlay_required = base_required
        summary_required = {
            "total_supply",
            "total_demand",
            "unserved_demand",
            "avg_utilization",
            "alert_count",
        }
        node_required = {
            "id",
            "pressure_mpa",
            "pressure_in_mpa",
            "demand_served",
            "supply_actual",
            "alert_level",
        }
        edge_required = {
            "id",
            "flow_rate",
            "direction",
            "utilization",
            "alert_level",
            "color",
            "width_factor",
        }
        meta_required = {
            "pilot_id",
            "scenario_id",
            "available_scenarios",
            "node_count",
            "edge_count",
            "solver_input_version",
        }

        for label, payload in [
            ("mainline_steady", mainline_steady),
            ("mainline_failure", mainline_failure),
            ("mainline_overlay", mainline_overlay),
            ("branch_overlay", branch_overlay),
        ]:
            _assert_keys(payload, overlay_required if "overlay" in label else base_required, label)
            _assert(bool(payload["nodes"]), f"{label} nodes 为空")
            _assert(bool(payload["edges"]), f"{label} edges 为空")
            _assert_keys(payload["summary"], summary_required, f"{label}.summary")
            if "overlay" in label:
                _assert_keys(payload["meta"], meta_required, f"{label}.meta")

        _assert(
            _top_keys(mainline_overlay) == _top_keys(branch_overlay),
            "主样板 overlay 和辅样板 overlay 顶层结构不一致",
        )
        _assert(
            _summary_keys(mainline_overlay) == _summary_keys(branch_overlay) == summary_required,
            "主辅样板 summary 结构不一致",
        )
        _assert(
            _node_keys(mainline_overlay) == _node_keys(branch_overlay) == node_required,
            "主辅样板 node 结构不一致",
        )
        _assert(
            _edge_keys(mainline_overlay) == _edge_keys(branch_overlay) == edge_required,
            "主辅样板 edge 结构不一致",
        )
        _assert(
            _meta_keys(mainline_overlay) == _meta_keys(branch_overlay) == meta_required,
            "主辅样板 overlay meta 结构不一致",
        )
        _assert(
            mainline_steady["solver_status"] == "converged"
            and mainline_failure["solver_status"] == "converged"
            and branch_overlay["solver_status"] == "converged",
            "主辅样板联合回归要求关键场景都收敛",
        )
        _assert(
            float(_node_map(mainline_failure)["WE1-86"]["pressure_mpa"])
            <= float(_node_map(mainline_steady)["WE1-86"]["pressure_mpa"]),
            "主样板故障场景下游压力趋势不成立",
        )
        _assert(
            "branch_limited" in branch_overlay["meta"]["available_scenarios"],
            "辅样板 overlay 没暴露完整场景列表",
        )

        output = {
            "status": "passed",
            "contract_checks": {
                "top_level_keys": sorted(_top_keys(mainline_overlay)),
                "summary_keys": sorted(_summary_keys(mainline_overlay)),
                "node_keys": sorted(_node_keys(mainline_overlay)),
                "edge_keys": sorted(_edge_keys(mainline_overlay)),
                "meta_keys": sorted(_meta_keys(mainline_overlay)),
            },
            "mainline": {
                "steady_status": mainline_steady["solver_status"],
                "failure_status": mainline_failure["solver_status"],
                "steady_node_count": len(mainline_overlay["nodes"]),
                "steady_edge_count": len(mainline_overlay["edges"]),
            },
            "branch": {
                "steady_status": branch_overlay["solver_status"],
                "steady_node_count": len(branch_overlay["nodes"]),
                "steady_edge_count": len(branch_overlay["edges"]),
                "available_scenarios": branch_overlay["meta"]["available_scenarios"],
            },
            "conclusion": [
                "主样板和辅样板的 overlay 契约已经统一。",
                "主样板稳态和故障场景都能收敛。",
                "辅样板场景列表完整，可直接进入最终展示或后续维护阶段。",
            ],
        }

        print("WE1 阶段3-4第三次联合回归通过")
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print("WE1 阶段3-4第三次联合回归失败")
        print(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
