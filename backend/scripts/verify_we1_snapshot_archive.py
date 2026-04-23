"""
WE1 结果快照归档验证脚本。

运行方式:
    python backend/scripts/verify_we1_snapshot_archive.py
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
from app.routers.topology_simulation import (  # noqa: E402
    SaveSnapshotRequest,
    create_simulation_snapshot,
    get_simulation_snapshot,
    list_simulation_snapshots,
)


PILOT_ID = "mainline_zhongwei_jingbian"
SCENARIO_ID = "steady_base"


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    try:
        print("=== WE1 快照归档验证开始 ===")

        with Session(engine) as session:
            created = create_simulation_snapshot(
                SaveSnapshotRequest(
                    pilot_id=PILOT_ID,
                    scenario_id=SCENARIO_ID,
                ),
                session=session,
            )

        run_id = str(created.get("run_id") or "")
        _assert(run_id != "", "创建快照后缺少 run_id")
        _assert(created.get("snapshot_version") == "we1-snapshot-v1", "快照版本不正确")
        _assert(isinstance(created.get("result"), dict), "快照未保存 result")
        _assert("input_summary" in created, "快照缺少 input_summary")
        _assert("output_summary" in created, "快照缺少 output_summary")
        _assert(bool(created.get("key_nodes")), "快照缺少 key_nodes")
        _assert(bool(created.get("key_edges")), "快照缺少 key_edges")

        fetched = get_simulation_snapshot(run_id, pilot_id=PILOT_ID)
        _assert(fetched.get("run_id") == run_id, "按 run_id 读取快照失败")
        _assert(
            fetched.get("result", {}).get("summary") == created.get("result", {}).get("summary"),
            "回读快照后的 result.summary 不一致",
        )

        listing = list_simulation_snapshots(
            pilot_id=PILOT_ID,
            scenario_id=SCENARIO_ID,
            limit=10,
        )
        _assert(isinstance(listing, dict), "快照列表返回结构错误")
        _assert(int(listing.get("count") or 0) >= 1, "快照列表为空")
        _assert(
            any(item.get("run_id") == run_id for item in listing.get("items", [])),
            "快照列表中找不到刚创建的 run_id",
        )

        output: dict[str, Any] = {
            "status": "passed",
            "run_id": run_id,
            "snapshot_path": created.get("snapshot_path"),
            "pilot_id": created.get("pilot_id"),
            "scenario_id": created.get("scenario_id"),
            "list_count": listing.get("count"),
            "output_summary": created.get("output_summary"),
            "key_node_ids": [item.get("id") for item in created.get("key_nodes", [])],
            "key_edge_ids": [item.get("id") for item in created.get("key_edges", [])],
            "failure_triage_order": [
                "topology_simulation 快照 create/list/get 路由",
                "we1_result_snapshot_service 归档读写",
                "维护脚本聚合层",
                "solver input 与稳态求解主链",
            ],
        }

        print("WE1 快照归档验证通过")
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print("WE1 快照归档验证失败")
        print(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
