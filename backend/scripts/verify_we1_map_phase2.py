"""
WE1 ??????? ?2???1??????

?????
  python backend/scripts/verify_we1_map_phase2.py

?????
1) buildSimulationOverlayMapping ?????/?????????????
2) WE1 overlay ?????????
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Iterable

from sqlmodel import Session


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import engine  # noqa: E402
from app.routers.topology_simulation import get_simulation_overlay  # noqa: E402


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _assert_keys(data: Dict[str, Any], keys: Iterable[str], label: str) -> None:
    missing = [key for key in keys if key not in data]
    if missing:
        raise AssertionError(f"{label} missing keys: {missing}")


def _check_overlay_contract() -> Dict[str, Any]:
    with Session(engine) as session:
        overlay = get_simulation_overlay(
            pilot_id="mainline_zhongwei_jingbian",
            scenario_id="steady_base",
            session=session,
        )

    _assert_keys(
        overlay,
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
        "overlay",
    )
    _assert(bool(overlay.get("nodes")), "overlay.nodes is empty")
    _assert(bool(overlay.get("edges")), "overlay.edges is empty")

    _assert_keys(
        overlay["summary"],
        ["total_supply", "total_demand", "unserved_demand", "avg_utilization", "alert_count"],
        "overlay.summary",
    )
    _assert_keys(
        overlay["meta"],
        ["pilot_id", "scenario_id", "available_scenarios", "node_count", "edge_count", "solver_input_version"],
        "overlay.meta",
    )
    _assert(overlay["meta"]["node_count"] == len(overlay["nodes"]), "overlay.meta.node_count mismatch")
    _assert(overlay["meta"]["edge_count"] == len(overlay["edges"]), "overlay.meta.edge_count mismatch")

    return {
        "pilot_id": overlay["pilot_id"],
        "scenario_id": overlay["scenario_id"],
        "node_count": len(overlay["nodes"]),
        "edge_count": len(overlay["edges"]),
    }


def _run_mapping_function_case() -> Dict[str, Any]:
    mapping_ts = REPO_ROOT / "src" / "utils" / "simulationOverlayMapping.ts"
    script = r"""
const fs = require('fs')
const vm = require('vm')
const ts = require('typescript')

const file = process.argv[1]
const source = fs.readFileSync(file, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText

const sandbox = { module: { exports: {} }, exports: {}, require, console }
vm.runInNewContext(transpiled, sandbox, { filename: file })

const build = sandbox.module.exports.buildSimulationOverlayMapping || sandbox.exports.buildSimulationOverlayMapping
if (typeof build !== 'function') {
  throw new Error('buildSimulationOverlayMapping export not found')
}

const displayNodes = [
  { id: 'junction-1', name: 'J1', sourceNodeIds: ['N1', 'N2'], internalSourceEdgeIds: ['E2', 'E_missing_internal'] },
  { id: 'station-3', name: 'S3', sourceNodeIds: ['N3'] },
  { id: 'station-4', name: 'S4', sourceNodeIds: ['N1', 'N_missing_node'] },
]
const displayEdges = [
  { id: 'merged-A', name: 'A', sourceEdgeIds: ['E1', 'E2'] },
  { id: 'merged-B', name: 'B', sourceEdgeIds: ['E_missing'] },
  { id: 'merged-C', name: 'C', sourceEdgeIds: ['E1', 'E_missing_edge'] },
]
const overlay = {
  pilot_id: 'mainline_zhongwei_jingbian',
  scenario_id: 'steady_base',
  run_id: 'test-run',
  generated_at: '2026-04-08T00:00:00Z',
  solver_status: 'converged',
  iterations: 8,
  nodes: [
    { id: 'N1', pressure_mpa: 6.1, demand_served: 0, supply_actual: 0, alert_level: 'normal' },
    { id: 'N2', pressure_mpa: 5.4, demand_served: 0, supply_actual: 0, alert_level: 'warning' },
    { id: 'N_orphan', pressure_mpa: 4.8, demand_served: 0, supply_actual: 0, alert_level: 'critical' },
  ],
  edges: [
    { id: 'E1', flow_rate: 10.5, direction: 'forward', utilization: 0.6, alert_level: 'normal', color: '#22c55e', width_factor: 0.8 },
    { id: 'E2', flow_rate: 12.0, direction: 'forward', utilization: 0.9, alert_level: 'warning', color: '#f59e0b', width_factor: 1.0 },
    { id: 'E_orphan', flow_rate: 3.0, direction: 'zero', utilization: 0.0, alert_level: 'normal', color: '#64748b', width_factor: 0.3 },
  ],
  summary: { total_supply: 1, total_demand: 1, unserved_demand: 0, avg_utilization: 0.5, alert_count: 0 },
  meta: {
    pilot_id: 'mainline_zhongwei_jingbian',
    scenario_id: 'steady_base',
    available_scenarios: ['steady_base'],
    node_count: 3,
    edge_count: 3,
    solver_input_version: 'test-v1',
  },
}

const result = build(displayNodes, displayEdges, overlay)
const serializable = {
  summary: result.summary,
  nodeMatchesByDisplayId: Object.fromEntries(result.nodeMatchesByDisplayId.entries()),
  edgeMatchesByDisplayId: Object.fromEntries(result.edgeMatchesByDisplayId.entries()),
}
console.log(JSON.stringify(serializable))
"""

    proc = subprocess.run(
        ["node", "-e", script, str(mapping_ts)],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
        check=True,
    )
    parsed = json.loads(proc.stdout)

    summary = parsed["summary"]
    node_matches = parsed["nodeMatchesByDisplayId"]
    edge_matches = parsed["edgeMatchesByDisplayId"]

    if isinstance(node_matches, list):
        node_matches = dict(node_matches)
    if isinstance(edge_matches, list):
        edge_matches = dict(edge_matches)

    _assert(summary["displayNodeCount"] == 3, "displayNodeCount should be 3")
    _assert(summary["displayEdgeCount"] == 3, "displayEdgeCount should be 3")
    _assert(summary["displayNodesWithMatchedOverlay"] == 2, "displayNodesWithMatchedOverlay should be 2")
    _assert(summary["displayEdgesWithMatchedOverlay"] == 2, "displayEdgesWithMatchedOverlay should be 2")
    _assert(summary["displayNodesFullyMatched"] == 1, "displayNodesFullyMatched should be 1")
    _assert(summary["displayNodesPartiallyMatched"] == 1, "displayNodesPartiallyMatched should be 1")
    _assert(summary["displayNodesUnmatched"] == 1, "displayNodesUnmatched should be 1")
    _assert(summary["displayEdgesFullyMatched"] == 1, "displayEdgesFullyMatched should be 1")
    _assert(summary["displayEdgesPartiallyMatched"] == 1, "displayEdgesPartiallyMatched should be 1")
    _assert(summary["displayEdgesUnmatched"] == 1, "displayEdgesUnmatched should be 1")
    _assert(summary["displayNodesWithMatchedInternalEdges"] == 1, "displayNodesWithMatchedInternalEdges should be 1")
    _assert(summary["matchedOverlayNodeCount"] == 2, "matchedOverlayNodeCount should be 2")
    _assert(summary["matchedOverlayEdgeCount"] == 2, "matchedOverlayEdgeCount should be 2")
    _assert(summary["missingSourceNodeIdCount"] == 2, "missingSourceNodeIdCount should be 2")
    _assert(summary["missingSourceEdgeIdCount"] == 2, "missingSourceEdgeIdCount should be 2")
    _assert(summary["missingInternalSourceEdgeIdCount"] == 1, "missingInternalSourceEdgeIdCount should be 1")
    _assert("N_orphan" in summary["unmatchedOverlayNodeIds"], "N_orphan should be unmatched")
    _assert("E_orphan" in summary["unmatchedOverlayEdgeIds"], "E_orphan should be unmatched")
    _assert("N3" in summary["missingSourceNodeIdsPreview"], "N3 should be in missingSourceNodeIdsPreview")
    _assert("N_missing_node" in summary["missingSourceNodeIdsPreview"], "N_missing_node should be in missingSourceNodeIdsPreview")
    _assert("E_missing" in summary["missingSourceEdgeIdsPreview"], "E_missing should be in missingSourceEdgeIdsPreview")
    _assert("E_missing_edge" in summary["missingSourceEdgeIdsPreview"], "E_missing_edge should be in missingSourceEdgeIdsPreview")
    _assert("E_missing_internal" in summary["missingInternalSourceEdgeIdsPreview"], "E_missing_internal should be in missingInternalSourceEdgeIdsPreview")
    _assert(summary["failureInvestigationLayer"] == "mapping-source-ids", "failureInvestigationLayer should be mapping-source-ids")

    junction = node_matches.get("junction-1")
    _assert(junction is not None, "junction-1 match missing")
    _assert(set(junction["matchedNodeIds"]) == {"N1", "N2"}, "junction-1 matchedNodeIds mismatch")
    _assert(junction["highestAlertLevel"] == "warning", "junction-1 alert should be warning")
    _assert(set(junction["matchedInternalEdgeIds"]) == {"E2"}, "junction-1 matchedInternalEdgeIds mismatch")
    _assert("E_missing_internal" in junction["missingInternalSourceEdgeIds"], "junction-1 missingInternalSourceEdgeIds mismatch")

    merged_a = edge_matches.get("merged-A")
    _assert(merged_a is not None, "merged-A match missing")
    _assert(set(merged_a["matchedEdgeIds"]) == {"E1", "E2"}, "merged-A matchedEdgeIds mismatch")
    _assert(abs(float(merged_a["totalFlowRate"]) - 22.5) < 1e-6, "merged-A totalFlowRate mismatch")

    return {
        "summary": summary,
        "junction_alert": junction["highestAlertLevel"],
        "merged_a_total_flow": merged_a["totalFlowRate"],
    }


def main() -> int:
    try:
        overlay_contract = _check_overlay_contract()
        mapping_case = _run_mapping_function_case()
        result = {
            "status": "passed",
            "overlay_contract": overlay_contract,
            "mapping_case": mapping_case,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
