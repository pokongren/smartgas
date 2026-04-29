"""WE1 AI query tools verification for phase 3-6.

This script is read-only. It does not run a new simulation and does not create snapshots.

Usage:
    python backend/scripts/verify_we1_ai_query_tools_phase36.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from sqlmodel import Session


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import engine  # noqa: E402
from app.routers.topology_simulation import InitialConditionsInput  # noqa: E402
from app.services.assistant_tools import TOOL_DEFINITIONS, execute_tool  # noqa: E402


EXPECTED_TOOLS = {
    "query_we1_data_alignment",
    "get_we1_pressure_profile",
    "get_flow_direction",
    "query_topology_relation",
    "query_sim_flow_topology",
    "explain_flow_topology_situation",
}


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _payload(tool_output: str) -> dict[str, Any]:
    lines = tool_output.splitlines()
    json_text = "\n".join(lines[1:]).strip()
    return json.loads(json_text)


def _check(checks: list[dict[str, Any]], check_id: str, condition: bool, detail: Any = None) -> None:
    checks.append({"id": check_id, "passed": bool(condition), "detail": detail})
    _assert(condition, f"{check_id} failed: {detail}")


def main() -> int:
    try:
        checks: list[dict[str, Any]] = []
        tool_names = {item.get("name") for item in TOOL_DEFINITIONS}
        _check(checks, "expected_tools_registered", EXPECTED_TOOLS.issubset(tool_names), sorted(EXPECTED_TOOLS - tool_names))

        parsed_conditions = InitialConditionsInput.model_validate(
            {
                "node_overrides": [{"node_id": "WE1-76", "target_pressure_mpa": 8.8}],
                "edge_overrides": [{"edge_id": "WE1-T-76", "flow_rate": 120.0, "length_km": 12.75}],
                "default_flow_rate": 100.0,
            }
        ) if hasattr(InitialConditionsInput, "model_validate") else InitialConditionsInput(
            node_overrides=[{"node_id": "WE1-76", "target_pressure_mpa": 8.8}],
            edge_overrides=[{"edge_id": "WE1-T-76", "flow_rate": 120.0, "length_km": 12.75}],
            default_flow_rate=100.0,
        )
        _check(checks, "initial_conditions_can_parse_dict", parsed_conditions is not None, str(parsed_conditions))

        with Session(engine) as session:
            alignment = _payload(execute_tool("query_we1_data_alignment", {}, session))
            _check(checks, "alignment_flow_boundary_returned", alignment.get("flow_boundary", {}).get("scada_flow_count") == 0, alignment.get("flow_boundary"))

            pressure = _payload(execute_tool("get_we1_pressure_profile", {"station_ref": "中卫"}, session))
            _check(checks, "pressure_profile_has_scada", bool(pressure.get("scada", {}).get("pressure", {}).get("found")), pressure.get("scada", {}).get("pressure"))

            direction = _payload(execute_tool("get_flow_direction", {"edge_id": "WE1-T-76"}, session))
            _check(checks, "direction_has_basis", direction.get("basis") in {"simulation_result", "pressure_delta_inferred", "topology_default"}, direction)

            relation = _payload(
                execute_tool(
                    "query_topology_relation",
                    {"station_ref": "中卫", "target_ref": "靖边", "scope": "we1"},
                    session,
                )
            )
            _check(checks, "topology_path_has_jingbian", "西一靖边压气站" in (relation.get("path") or {}).get("node_names", []), relation.get("path"))

            sim = _payload(execute_tool("query_sim_flow_topology", {"top_n": 2}, session))
            _check(checks, "sim_query_returns_gap_statement", "不是 SCADA 实测流量" in " ".join(sim.get("data_gaps") or []), sim.get("data_gaps"))

            explanation = _payload(execute_tool("explain_flow_topology_situation", {}, session))
            _check(checks, "explanation_has_plain_summary", bool(explanation.get("plain_summary")), explanation)

        output = {
            "status": "passed",
            "checks": checks,
            "verified_tools": sorted(EXPECTED_TOOLS),
            "failure_triage_order": [
                "assistant_tools 工具注册",
                "we1_data_alignment_service 返回结构",
                "快照读取",
                "数据库站点和管段映射",
            ],
        }
        print("WE1 AI 查询工具第3-6轮验证通过")
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print("WE1 AI 查询工具第3-6轮验证失败")
        print(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
