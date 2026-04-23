"""
WE1 阶段 3 验证脚本：求解与覆盖层链路收口

不依赖启动 HTTP 服务，直接调用后端服务层与装配层。
运行方式：
    python backend/scripts/verify_we1_phase3.py
"""

from __future__ import annotations

import copy
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable
from uuid import uuid4

from sqlmodel import Session


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import engine  # noqa: E402
from app.routers.pipeline_packages import get_pipeline_packages  # noqa: E402
from app.services.topology_simulation import solve_steady  # noqa: E402
from app.services.we1_pilot_service import (  # noqa: E402
    build_pilot_package,
    get_we1_pilot_or_raise,
    get_we1_pilot_seed_or_raise,
    list_we1_pilots,
)
from app.services.we1_steady_validation_service import evaluate_steady_result  # noqa: E402
from app.services.we1_solver_input_service import build_we1_solver_input  # noqa: E402


PILOT_IDS = [
    "mainline_zhongwei_jingbian",
    "zhengzhou_xuedian_changlv",
]


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _assert_keys(data: Dict[str, Any], keys: Iterable[str], label: str) -> None:
    missing = [key for key in keys if key not in data]
    if missing:
        raise AssertionError(f"{label} 缺少字段: {missing}")


def _build_solver_input(session: Session, pilot_id: str) -> Dict[str, Any]:
    pilot = get_we1_pilot_or_raise(pilot_id)
    seed_data = get_we1_pilot_seed_or_raise(pilot_id)
    packages = get_pipeline_packages(system_id="we1", session=session)
    _assert(bool(packages), "未找到 WE1 管线数据包")
    pilot_package = build_pilot_package(packages[0], pilot)
    return build_we1_solver_input(
        pilot=pilot,
        pilot_package=pilot_package,
        seed_data=seed_data,
    )


def _build_failure_seed(
    solver_input: Dict[str, Any],
    base_scenario_id: str,
    failure_node_id: str,
    failure_type: str,
) -> Dict[str, Any]:
    base_scenario = next(
        (scenario for scenario in solver_input.get("scenarios", []) if scenario["id"] == base_scenario_id),
        {"id": base_scenario_id, "node_overrides": [], "edge_overrides": [], "compressor_overrides": []},
    )
    failure_scenario = copy.deepcopy(base_scenario)
    failure_scenario["id"] = f"failure_{failure_node_id}"

    if failure_type == "compressor_offline":
        failure_scenario.setdefault("compressor_overrides", []).append(
            {"node_id": failure_node_id, "compressor_enabled": False}
        )
    elif failure_type in {"pipe_break", "valve_close"}:
        failure_scenario.setdefault("edge_overrides", []).append(
            {"edge_id": failure_node_id, "status": "closed"}
        )
    else:
        failure_scenario.setdefault("node_overrides", []).append(
            {"node_id": failure_node_id, "compressor_enabled": False}
        )

    failure_seed = copy.deepcopy(solver_input)
    failure_seed["scenarios"] = [failure_scenario]
    return failure_seed


def _build_overlay_payload(
    solver_input: Dict[str, Any],
    pilot_id: str,
    scenario_id: str,
) -> Dict[str, Any]:
    payload = solve_steady(
        seed=solver_input,
        scenario_id=scenario_id,
        pilot_id=pilot_id,
    ).to_dict()
    payload["run_id"] = f"verify-{uuid4().hex[:12]}"
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    payload["meta"] = {
        "pilot_id": pilot_id,
        "scenario_id": scenario_id,
        "available_scenarios": [scenario["id"] for scenario in solver_input.get("scenarios", [])],
        "node_count": len(payload["nodes"]),
        "edge_count": len(payload["edges"]),
        "solver_input_version": solver_input.get("solver_input_version"),
    }
    return payload


def _decorate_solver_payload(
    payload: Dict[str, Any],
    solver_input: Dict[str, Any],
    pilot_id: str,
    scenario_id: str,
) -> Dict[str, Any]:
    payload["pilot_id"] = pilot_id
    payload["scenario_id"] = scenario_id
    payload["run_id"] = f"verify-{uuid4().hex[:12]}"
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    payload["meta"] = {
        "pilot_id": pilot_id,
        "scenario_id": scenario_id,
        "available_scenarios": [scenario["id"] for scenario in solver_input.get("scenarios", [])],
        "node_count": len(payload["nodes"]),
        "edge_count": len(payload["edges"]),
        "solver_input_version": solver_input.get("solver_input_version"),
    }
    return payload


def _verify_overlay_shape(data: Dict[str, Any], label: str) -> None:
    _assert_keys(
        data,
        ["pilot_id", "scenario_id", "run_id", "generated_at", "solver_status", "iterations", "nodes", "edges", "summary", "meta"],
        label,
    )
    _assert(bool(data["nodes"]), f"{label} 缺少 nodes")
    _assert(bool(data["edges"]), f"{label} 缺少 edges")
    _assert(data["solver_status"] in {"converged", "max_iter", "error"}, f"{label} solver_status 非法")


def main() -> int:
    try:
        print("=== WE1 阶段3链路验证开始 ===")
        pilots = list_we1_pilots()
        pilot_ids = sorted(item["id"] for item in pilots)
        for expected in PILOT_IDS:
            _assert(expected in pilot_ids, f"pilot 列表缺少 {expected}")

        output: Dict[str, Any] = {
            "status": "passed",
            "pilot_count": len(pilots),
            "pilot_ids": pilot_ids,
            "seed_checks": [],
        }

        with Session(engine) as session:
            solver_inputs: Dict[str, Dict[str, Any]] = {}
            for pilot_id in PILOT_IDS:
                solver_input = _build_solver_input(session, pilot_id)
                solver_inputs[pilot_id] = solver_input
                scenarios = solver_input.get("scenarios", [])
                _assert(bool(scenarios), f"{pilot_id} solver_input 没有 scenarios")
                output["seed_checks"].append(
                    {
                        "pilot_id": pilot_id,
                        "solver_input_version": solver_input.get("solver_input_version"),
                        "scenario_ids": [item["id"] for item in scenarios],
                        "node_count": len(solver_input.get("nodes", [])),
                        "edge_count": len(solver_input.get("edges", [])),
                    }
                )

            steady_mainline = _decorate_solver_payload(
                solve_steady(
                    seed=solver_inputs["mainline_zhongwei_jingbian"],
                    scenario_id="steady_base",
                    pilot_id="mainline_zhongwei_jingbian",
                ).to_dict(),
                solver_inputs["mainline_zhongwei_jingbian"],
                pilot_id="mainline_zhongwei_jingbian",
                scenario_id="steady_base",
            )
            _verify_overlay_shape(steady_mainline, "主样板 steady_base")
            steady_validation = evaluate_steady_result(
                "mainline_zhongwei_jingbian",
                "steady_base",
                solver_inputs["mainline_zhongwei_jingbian"],
                steady_mainline,
            )
            _assert(steady_validation["passed"], "主样板 steady_base 固定断言未通过")

            failure_seed = _build_failure_seed(
                solver_inputs["mainline_zhongwei_jingbian"],
                base_scenario_id="steady_base",
                failure_node_id="WE1-76",
                failure_type="compressor_offline",
            )
            failure_mainline = _decorate_solver_payload(
                solve_steady(
                    seed=failure_seed,
                    scenario_id="failure_WE1-76",
                    pilot_id="mainline_zhongwei_jingbian",
                ).to_dict(),
                failure_seed,
                pilot_id="mainline_zhongwei_jingbian",
                scenario_id="failure_WE1-76",
            )
            _verify_overlay_shape(failure_mainline, "主样板 compressor_offline")

            branch_overlay = _build_overlay_payload(
                solver_inputs["zhengzhou_xuedian_changlv"],
                pilot_id="zhengzhou_xuedian_changlv",
                scenario_id="steady_branch_base",
            )
            _verify_overlay_shape(branch_overlay, "辅样板 overlay")
            _assert_keys(
                branch_overlay["meta"],
                ["pilot_id", "scenario_id", "available_scenarios", "node_count", "edge_count", "solver_input_version"],
                "辅样板 overlay.meta",
            )

            output["steady_mainline"] = {
                "solver_status": steady_mainline["solver_status"],
                "iterations": steady_mainline["iterations"],
                "node_count": len(steady_mainline["nodes"]),
                "edge_count": len(steady_mainline["edges"]),
                "validation_profile": steady_validation["profile"],
                "validation_passed": steady_validation["passed"],
            }
            output["failure_mainline"] = {
                "solver_status": failure_mainline["solver_status"],
                "iterations": failure_mainline["iterations"],
                "alert_count": failure_mainline["summary"].get("alert_count"),
            }
            output["branch_overlay"] = {
                "scenario_id": branch_overlay["scenario_id"],
                "node_count": branch_overlay["meta"]["node_count"],
                "edge_count": branch_overlay["meta"]["edge_count"],
                "available_scenarios": branch_overlay["meta"]["available_scenarios"],
            }

        print("WE1 阶段3链路验证通过")
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print("WE1 阶段3链路验证失败")
        print(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
