"""
WE1 第一张图主仿真第 5 阶段验收脚本。

运行方式:
    python backend/scripts/verify_we1_map_phase5.py
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
    SaveSnapshotRequest,
    SolveSteadyRequest,
    create_simulation_snapshot,
    get_simulation_overlay,
    solve_steady_api,
)
from app.services.we1_result_snapshot_service import list_snapshots  # noqa: E402


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _assert_keys(data: Dict[str, Any], keys: Iterable[str], label: str) -> None:
    missing = [key for key in keys if key not in data]
    if missing:
        raise AssertionError(f"{label} 缺少字段: {missing}")


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _normalize_source(text: str) -> str:
    return " ".join(text.split())


def _verify_overlay_contract(session: Session) -> Dict[str, Any]:
    steady_overlay = get_simulation_overlay(
        pilot_id="mainline_zhongwei_jingbian",
        scenario_id="steady_base",
        session=session,
    )
    solve_payload = solve_steady_api(
        SolveSteadyRequest(
            pilot_id="mainline_zhongwei_jingbian",
            scenario_id="steady_base",
        ),
        session=session,
    )

    for label, payload in [
        ("overlay", steady_overlay),
        ("solve_steady", solve_payload),
    ]:
        _assert_keys(
            payload,
            [
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
            ],
            label,
        )
        _assert(bool(payload["nodes"]), f"{label} nodes 为空")
        _assert(bool(payload["edges"]), f"{label} edges 为空")

    return {
        "solver_status": steady_overlay["solver_status"],
        "node_count": len(steady_overlay["nodes"]),
        "edge_count": len(steady_overlay["edges"]),
        "scenario_id": steady_overlay["scenario_id"],
    }


def _verify_snapshot_archive(session: Session) -> Dict[str, Any]:
    created = create_simulation_snapshot(
        SaveSnapshotRequest(
            pilot_id="mainline_zhongwei_jingbian",
            scenario_id="steady_base",
        ),
        session=session,
    )
    _assert(str(created.get("run_id") or ""), "快照创建后缺少 run_id")
    _assert(created.get("snapshot_version") == "we1-snapshot-v1", "快照版本不正确")
    _assert("result" in created and isinstance(created["result"], dict), "快照缺少 result")
    _assert("input_summary" in created, "快照缺少 input_summary")
    _assert("output_summary" in created, "快照缺少 output_summary")

    items = list_snapshots(
        pilot_id="mainline_zhongwei_jingbian",
        scenario_id=None,
        limit=200,
    )
    scenario_ids = {str(item.get("scenario_id")) for item in items if isinstance(item, dict)}
    expected = {
        "steady_base",
        "zhongwei_compressor_offline",
        "zhongwei_trunk_break",
        "yanchi_jingbian_limited",
    }
    missing = sorted(expected - scenario_ids)
    auto_created: list[str] = []
    if missing:
        for scenario_id in missing:
            create_simulation_snapshot(
                SaveSnapshotRequest(
                    pilot_id="mainline_zhongwei_jingbian",
                    scenario_id=scenario_id,
                ),
                session=session,
            )
            auto_created.append(scenario_id)

        items = list_snapshots(
            pilot_id="mainline_zhongwei_jingbian",
            scenario_id=None,
            limit=200,
        )
        scenario_ids = {str(item.get("scenario_id")) for item in items if isinstance(item, dict)}
        missing = sorted(expected - scenario_ids)

    _assert(not missing, f"主样板快照覆盖不完整，缺少场景: {missing}")

    return {
        "created_run_id": created["run_id"],
        "listed_count": len(items),
        "covered_scenarios": sorted(scenario_ids),
        "missing_scenarios": missing,
        "all_mainline_scenarios_covered": not missing,
        "auto_created_scenarios": auto_created,
    }


def _verify_frontend_phase5_contract() -> Dict[str, Any]:
    map_path = REPO_ROOT / "src" / "views" / "MapTopologyView.tsx"
    hook_path = REPO_ROOT / "src" / "hooks" / "useSimulation.ts"
    map_text = _read_text(map_path)
    hook_text = _read_text(hook_path)
    normalized_map_text = _normalize_source(map_text)

    checks = [
        {
            "id": "useSimulation_baseline_comparison",
            "passed": all(
                token in hook_text
                for token in [
                    "baselineSnapshotRunId",
                    "SimulationComparison",
                    "setBaselineSnapshotRunId",
                    "runMissingTrialScenarios",
                ]
            ),
            "file": str(hook_path),
        },
        {
            "id": "map_phase5_primary_operation_panel_contract",
            "passed": all(
                token in normalized_map_text
                for token in [
                    "Simulation Live",
                    "steadyMetricCards",
                    "runSteadySimulation",
                    "saveSteadySnapshot",
                    "refreshSteadySnapshots",
                    "clearSteadyOverlay",
                    "exportSimulationReport",
                    "applySelectedSnapshotAsBaseline",
                    "applyLatestCoveredSnapshotAsBaseline",
                ]
            ),
            "file": str(map_path),
        },
        {
            "id": "map_phase5_demo_context_guard",
            "passed": all(
                token in map_text
                for token in [
                    "demoGuideSteps",
                    "failureInvestigationLayerLabel",
                    "coverageResultSummary",
                    "coverageChecklistItems",
                ]
            ),
            "file": str(map_path),
        },
        {
            "id": "map_phase5_snapshot_actions",
            "passed": all(
                token in map_text
                for token in [
                    "runSteadySimulation",
                    "saveSteadySnapshot",
                    "loadSteadySelectedSnapshot",
                    "runSteadyMissingTrialScenarios",
                ]
            ),
            "file": str(map_path),
        },
    ]
    _assert(all(item["passed"] for item in checks), "第一张图第5阶段前端收口未完成")
    return {"checks": checks}


def _triage_order() -> list[str]:
    return [
        "主入口状态层",
        "映射层 source IDs / overlay IDs",
        "overlay 与快照归档层",
        "基线对比与覆盖结果清单层",
        "求解主链层",
    ]


def main() -> int:
    output: Dict[str, Any]
    try:
        with Session(engine) as session:
            overlay_contract = _verify_overlay_contract(session)
            snapshot_archive = _verify_snapshot_archive(session)

        frontend_contract = _verify_frontend_phase5_contract()

        output = {
            "status": "passed",
            "mode": "phase5_acceptance",
            "overlay_contract": overlay_contract,
            "snapshot_archive": snapshot_archive,
            "frontend_contract": frontend_contract["checks"],
            "triage_order": _triage_order(),
            "next_mode": "maintenance",
        }
    except Exception as exc:
        output = {
            "status": "failed",
            "mode": "phase5_acceptance",
            "error": str(exc),
            "triage_order": _triage_order(),
            "next_mode": "maintenance",
        }

    sys.stdout.buffer.write(b"=== WE1 map phase5 verification start ===\\n")
    sys.stdout.buffer.write((json.dumps(output, ensure_ascii=False, indent=2) + "\\n").encode("utf-8", errors="replace"))
    return 0 if output.get("status") == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
