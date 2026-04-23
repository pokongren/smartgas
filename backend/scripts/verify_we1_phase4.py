"""
WE1 阶段 4 验收脚本：独立验收与回归闭环

运行方式：
    python backend/scripts/verify_we1_phase4.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterable

from sqlmodel import Session


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
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
from app.services.we1_steady_validation_service import evaluate_branch_results  # noqa: E402


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _assert_keys(data: Dict[str, Any], keys: Iterable[str], label: str) -> None:
    missing = [key for key in keys if key not in data]
    if missing:
        raise AssertionError(f"{label} 缺少字段: {missing}")


def _node_map(result: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {
        str(node["id"]): node
        for node in result.get("nodes", [])
        if isinstance(node, dict) and "id" in node
    }


def _edge_map(result: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {
        str(edge["id"]): edge
        for edge in result.get("edges", [])
        if isinstance(edge, dict) and "id" in edge
    }


def _assert_overlay_contract(data: Dict[str, Any], label: str) -> None:
    _assert_keys(
        data,
        ["pilot_id", "scenario_id", "run_id", "generated_at", "solver_status", "iterations", "nodes", "edges", "summary", "meta"],
        label,
    )
    _assert(bool(data["nodes"]), f"{label} 没有 nodes")
    _assert(bool(data["edges"]), f"{label} 没有 edges")
    _assert_keys(
        data["summary"],
        ["total_supply", "total_demand", "unserved_demand", "avg_utilization", "alert_count"],
        f"{label}.summary",
    )
    if "meta" in data:
        _assert_keys(
            data["meta"],
            ["pilot_id", "scenario_id", "available_scenarios", "node_count", "edge_count", "solver_input_version"],
            f"{label}.meta",
        )
        _assert(data["meta"]["node_count"] == len(data["nodes"]), f"{label}.meta node_count 不一致")
        _assert(data["meta"]["edge_count"] == len(data["edges"]), f"{label}.meta edge_count 不一致")


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _check_frontend_contract() -> Dict[str, Any]:
    hook_path = REPO_ROOT / "src" / "hooks" / "useSimulation.ts"
    panel_path = REPO_ROOT / "src" / "components" / "topology" / "SimPanel.tsx"
    hook_text = _read_text(hook_path)
    panel_text = _read_text(panel_path)

    checks = [
        {
            "id": "useSimulation_overlay_endpoint",
            "passed": "/pipeline-packages/simulation-overlay" in hook_text,
            "file": str(hook_path),
        },
        {
            "id": "useSimulation_snapshot_endpoint",
            "passed": "/topology-simulation/snapshots" in hook_text,
            "file": str(hook_path),
        },
        {
            "id": "useSimulation_overlay_meta",
            "passed": "meta" in hook_text and "solver_status" in hook_text,
            "file": str(hook_path),
        },
        {
            "id": "SimPanel_summary_render",
            "passed": "summary" in panel_text and "solver_status" in panel_text,
            "file": str(panel_path),
        },
        {
            "id": "SimPanel_snapshot_actions",
            "passed": "保存快照" in panel_text and "加载快照" in panel_text,
            "file": str(panel_path),
        },
    ]
    _assert(all(item["passed"] for item in checks), "前端 overlay 消费契约回归")
    return {"passed": True, "checks": checks}


def main() -> int:
    try:
        print("=== WE1 阶段4验收开始 ===")

        with Session(engine) as session:
            steady_mainline = solve_steady_api(
                SolveSteadyRequest(
                    pilot_id="mainline_zhongwei_jingbian",
                    scenario_id="steady_base",
                ),
                session=session,
            )
            _assert_overlay_contract(steady_mainline, "mainline.steady_base")

            failure_mainline = solve_failure_api(
                SolveFailureRequest(
                    pilot_id="mainline_zhongwei_jingbian",
                    base_scenario_id="steady_base",
                    failure_node_id="WE1-76",
                    failure_type="compressor_offline",
                ),
                session=session,
            )
            _assert_overlay_contract(failure_mainline, "mainline.failure")

            branch_base = get_simulation_overlay(
                pilot_id="zhengzhou_xuedian_changlv",
                scenario_id="steady_branch_base",
                session=session,
            )
            _assert_overlay_contract(branch_base, "branch.steady_branch_base")

            branch_xuedian = get_simulation_overlay(
                pilot_id="zhengzhou_xuedian_changlv",
                scenario_id="xuedian_load_up",
                session=session,
            )
            _assert_overlay_contract(branch_xuedian, "branch.xuedian_load_up")

            branch_changlv = get_simulation_overlay(
                pilot_id="zhengzhou_xuedian_changlv",
                scenario_id="changlv_load_up",
                session=session,
            )
            _assert_overlay_contract(branch_changlv, "branch.changlv_load_up")

            branch_limited = get_simulation_overlay(
                pilot_id="zhengzhou_xuedian_changlv",
                scenario_id="branch_limited",
                session=session,
            )
            _assert_overlay_contract(branch_limited, "branch.branch_limited")

        steady_nodes = _node_map(steady_mainline)
        failure_nodes = _node_map(failure_mainline)
        branch_base_edges = _edge_map(branch_base)
        branch_limited_edges = _edge_map(branch_limited)
        branch_validation = evaluate_branch_results(
            branch_base,
            branch_xuedian,
            branch_changlv,
            branch_limited,
        )
        _assert(branch_validation["passed"], "辅样板固定断言未通过")

        for node_id in ["WE1-76", "WE1-86", "WE1-92"]:
            _assert(node_id in steady_nodes, f"steady 缺少节点 {node_id}")
            _assert(node_id in failure_nodes, f"failure 缺少节点 {node_id}")

        _assert(
            steady_mainline["solver_status"] == "converged",
            "主样板 steady_base 未收敛",
        )
        _assert(
            float(failure_nodes["WE1-86"]["pressure_mpa"]) < float(steady_nodes["WE1-86"]["pressure_mpa"]),
            "中卫停运后 WE1-86 压力未下降，主样板故障趋势不成立",
        )
        _assert(
            float(failure_nodes["WE1-92"]["pressure_mpa"]) < float(steady_nodes["WE1-92"]["pressure_mpa"]),
            "中卫停运后 WE1-92 压力未下降，主样板下游传播不成立",
        )

        _assert(
            "branch_limited" in branch_base["meta"]["available_scenarios"],
            "辅样板 overlay.meta 未暴露 branch_limited 场景",
        )

        changed_edges = []
        for edge_id, base_edge in branch_base_edges.items():
            limited_edge = branch_limited_edges.get(edge_id)
            if not limited_edge:
                continue
            if abs(float(base_edge.get("flow_rate", 0.0)) - float(limited_edge.get("flow_rate", 0.0))) > 0.01:
                changed_edges.append(edge_id)
        _assert(bool(changed_edges), "辅样板限流场景没有引起任何边流量变化")

        frontend_contract = _check_frontend_contract()

        output = {
            "status": "passed",
            "acceptance_checks": [
                "主样板 steady/failure API 契约可用",
                "主样板故障后下游压力下降",
                "辅样板 overlay 契约带 meta，且暴露 branch_limited",
                "辅样板负荷上调和限流场景已导致分流变化",
                "前端继续消费统一 overlay 契约",
            ],
            "mainline": {
                "steady_pressure_WE1_86": steady_nodes["WE1-86"]["pressure_mpa"],
                "failure_pressure_WE1_86": failure_nodes["WE1-86"]["pressure_mpa"],
                "steady_pressure_WE1_92": steady_nodes["WE1-92"]["pressure_mpa"],
                "failure_pressure_WE1_92": failure_nodes["WE1-92"]["pressure_mpa"],
                "advisory_alert_count": {
                    "steady": steady_mainline["summary"]["alert_count"],
                    "failure": failure_mainline["summary"]["alert_count"],
                },
                "advisory_unserved_demand": {
                    "steady": steady_mainline["summary"]["unserved_demand"],
                    "failure": failure_mainline["summary"]["unserved_demand"],
                },
            },
            "branch": {
                "changed_edges": changed_edges,
                "available_scenarios": branch_base["meta"]["available_scenarios"],
                "validation_profile": branch_validation["profile"],
                "validation_passed": branch_validation["passed"],
                "advisory_alert_count": {
                    "base": branch_base["summary"]["alert_count"],
                    "limited": branch_limited["summary"]["alert_count"],
                },
                "advisory_avg_utilization": {
                    "base": branch_base["summary"]["avg_utilization"],
                    "limited": branch_limited["summary"]["avg_utilization"],
                },
            },
            "frontend_contract": frontend_contract["checks"],
            "triage_order": [
                "pilot/seed 定义层",
                "solver input/solve 路由层",
                "steady/failure 求解层",
                "overlay 契约层",
                "前端消费层",
            ],
        }

        print("WE1 阶段4验收通过")
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print("WE1 阶段4验收失败")
        print(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
