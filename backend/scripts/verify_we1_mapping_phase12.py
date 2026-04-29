"""WE1 database alignment verification for phase 1 round 1-2.

Usage:
    python backend/scripts/verify_we1_mapping_phase12.py
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
from app.services.we1_data_alignment_service import (  # noqa: E402
    WE1_SAMPLE_STATIONS,
    get_flow_direction,
    get_pressure_profile,
    get_we1_alignment_report,
    query_sim_flow_topology,
    query_topology_relation,
    resolve_we1_station,
)


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _check(checks: list[dict[str, Any]], check_id: str, condition: bool, detail: Any = None) -> None:
    if not isinstance(detail, (str, int, float, bool, list, dict, type(None))):
        detail = str(detail)
    checks.append({"id": check_id, "passed": bool(condition), "detail": detail})
    _assert(condition, f"{check_id} failed: {detail}")


def main() -> int:
    try:
        checks: list[dict[str, Any]] = []
        with Session(engine) as session:
            report = get_we1_alignment_report(session)
            station_reports = report.get("sample_stations") or []
            by_id = {
                ((item.get("station") or {}).get("id")): item
                for item in station_reports
            }

            _check(checks, "sample_station_count", len(station_reports) == 3, len(station_reports))
            _check(checks, "zhongwei_present", "WE1-76" in by_id, by_id.keys())
            _check(checks, "yanchi_present", "WE1-86" in by_id, by_id.keys())
            _check(checks, "jingbian_present", "WE1-92" in by_id, by_id.keys())
            _check(checks, "no_orphan_edges", report.get("integrity", {}).get("orphan_edge_count") == 0, report.get("integrity"))
            _check(checks, "scada_flow_boundary_known", report.get("flow_boundary", {}).get("scada_flow_count") == 0, report.get("flow_boundary"))

            for alias in ("中卫", "中卫压气站", "WE1-76", "WE1-ZHONGWEI"):
                resolved = resolve_we1_station(session, alias)
                _check(
                    checks,
                    f"resolve_{alias}",
                    (resolved.get("station") or {}).get("id") == "WE1-76",
                    resolved,
                )

            pressure_zhongwei = get_pressure_profile(session, "中卫")
            pressure_yanchi = get_pressure_profile(session, "盐池")
            pressure_jingbian = get_pressure_profile(session, "靖边")
            _check(
                checks,
                "zhongwei_scada_pressure_found",
                bool(pressure_zhongwei.get("scada", {}).get("pressure", {}).get("found")),
                pressure_zhongwei.get("scada", {}).get("pressure"),
            )
            _check(
                checks,
                "yanchi_static_pressure_fallback",
                pressure_yanchi.get("source_type") == "station_static" and pressure_yanchi.get("current_pressure") is not None,
                pressure_yanchi,
            )
            _check(
                checks,
                "jingbian_static_pressure_fallback",
                pressure_jingbian.get("source_type") == "station_static" and pressure_jingbian.get("current_pressure") is not None,
                pressure_jingbian,
            )

            _check(
                checks,
                "zhongwei_we1_connected_edges",
                len(by_id["WE1-76"].get("connected_edges_we1") or []) == 2,
                by_id["WE1-76"].get("connected_edges_we1"),
            )
            _check(
                checks,
                "zhongwei_cross_system_edges_visible",
                len(by_id["WE1-76"].get("connected_edges_all") or []) >= 5,
                by_id["WE1-76"].get("connected_edges_all"),
            )

            relation = query_topology_relation(session, "中卫", target_ref="靖边", scope="we1", depth=20)
            _check(checks, "topology_relation_found", bool(relation.get("found")), relation)
            _check(checks, "zhongwei_to_jingbian_path_found", bool(relation.get("path")), relation.get("path"))

            flow = get_flow_direction(session, "WE1-T-76")
            _check(checks, "flow_direction_found", bool(flow.get("found")), flow)
            _check(
                checks,
                "flow_direction_has_basis",
                flow.get("basis") in {"simulation_result", "pressure_delta_inferred", "topology_default"},
                flow,
            )

            sim = query_sim_flow_topology(session, top_n=3)
            sim_available = bool(sim.get("found"))

        output = {
            "status": "passed",
            "checks": checks,
            "sample_station_ids": [item["station_id"] for item in WE1_SAMPLE_STATIONS.values()],
            "scada_boundary": report.get("flow_boundary"),
            "latest_sim_snapshot_available": sim_available,
            "failure_triage_order": [
                "WE1 样板站点映射",
                "smartgas.db stations/pipelines 字段",
                "scada_history.db 压力映射",
                "we1_data_alignment_service 只读聚合",
                "AI 工具入口",
            ],
        }
        print("WE1 数据库对照第1-2轮验证通过")
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print("WE1 数据库对照第1-2轮验证失败")
        print(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
