"""
WE1 维护模式巡检总脚本。
用法:
    python backend/scripts/verify_we1_maintenance.py
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
SUBPROCESS_ENV = {
    **os.environ,
    "PYTHONIOENCODING": "utf-8",
    "PYTHONUTF8": "1",
}


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _normalize_source(text: str) -> str:
    return re.sub(r"\s+", " ", text)


def _route_present(app_text: str, path: str, element: str) -> bool:
    pattern = rf'<Route\s+path="{re.escape(path)}"\s+element=\{{<{element}\s*/?>\}}\s*/>'
    return re.search(pattern, app_text) is not None


def _navigate_call_present(text: str, path: str) -> bool:
    quote_group = r'(["\'])'
    pattern = rf'navigate\({quote_group}{re.escape(path)}\1\)'
    return re.search(pattern, text) is not None


def _sim_panel_gated_by_debug_actions(text: str) -> bool:
    pattern = r'debugActionsEnabled\s*&&\s*\(\s*<SimPanel\b'
    return re.search(pattern, text) is not None


def _extract_json_payload(stdout: str) -> Dict[str, Any]:
    start = stdout.find("{")
    end = stdout.rfind("}")
    _assert(start >= 0 and end > start, "maintenance sub-script did not emit JSON payload")
    payload = json.loads(stdout[start : end + 1])
    _assert(isinstance(payload, dict), "maintenance sub-script payload must be a JSON object")
    return payload


def _contains_cjk(value: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in value)


def _looks_unreadable_text(value: str) -> bool:
    if not value:
        return False
    if "\ufffd" in value or "???" in value:
        return True
    has_non_ascii = any(ord(char) > 127 for char in value)
    return has_non_ascii and not _contains_cjk(value)


def _contains_unreadable_content(value: Any) -> bool:
    if isinstance(value, str):
        return _looks_unreadable_text(value)
    if isinstance(value, dict):
        return any(_contains_unreadable_content(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_unreadable_content(item) for item in value)
    return False


def _decode_utf8_or_fail(raw_output: bytes, script_name: str, stream_name: str) -> str:
    try:
        return raw_output.decode("utf-8", errors="strict").strip()
    except UnicodeDecodeError as exc:
        raise AssertionError(f"{script_name} emitted non-UTF8 {stream_name}: {exc}") from exc


def _run_script(script_name: str) -> Dict[str, Any]:
    script_path = BACKEND_ROOT / "scripts" / script_name
    completed = subprocess.run(
        [sys.executable, "-X", "utf8", str(script_path)],
        cwd=str(REPO_ROOT),
        env=SUBPROCESS_ENV,
        capture_output=True,
    )
    stdout = _decode_utf8_or_fail(completed.stdout, script_name, "stdout")
    stderr = _decode_utf8_or_fail(completed.stderr, script_name, "stderr")
    result: Dict[str, Any] = {
        "script": script_name,
        "passed": completed.returncode == 0,
        "returncode": completed.returncode,
        "stdout": stdout,
        "stderr": stderr,
    }
    if stdout:
        result["payload"] = _extract_json_payload(stdout)
        result["encoding_clean"] = not any(
            (
                _looks_unreadable_text(stdout),
                _looks_unreadable_text(stderr),
                _contains_unreadable_content(result["payload"]),
            )
        )
    return result


def _verify_script_payloads(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    checks: List[Dict[str, Any]] = []
    payload_by_script = {item["script"]: item.get("payload") for item in results}

    def add_check(check_id: str, condition: bool, script_name: str) -> None:
        checks.append({"id": check_id, "passed": condition, "script": script_name})

    phase34_payload = payload_by_script.get("verify_we1_phase34_final.py") or {}
    map_phase5_payload = payload_by_script.get("verify_we1_map_phase5.py") or {}
    snapshot_payload = payload_by_script.get("verify_we1_snapshot_archive.py") or {}

    add_check(
        "phase34_status_passed",
        phase34_payload.get("status") == "passed",
        "verify_we1_phase34_final.py",
    )
    add_check(
        "phase5_status_passed",
        map_phase5_payload.get("status") == "passed",
        "verify_we1_map_phase5.py",
    )
    add_check(
        "phase5_next_mode_maintenance",
        map_phase5_payload.get("next_mode") == "maintenance",
        "verify_we1_map_phase5.py",
    )
    add_check(
        "phase5_mainline_scenarios_covered",
        bool((map_phase5_payload.get("snapshot_archive") or {}).get("all_mainline_scenarios_covered")),
        "verify_we1_map_phase5.py",
    )
    add_check(
        "snapshot_archive_status_passed",
        snapshot_payload.get("status") == "passed",
        "verify_we1_snapshot_archive.py",
    )
    add_check(
        "snapshot_archive_list_count_positive",
        isinstance(snapshot_payload.get("list_count"), int) and snapshot_payload["list_count"] > 0,
        "verify_we1_snapshot_archive.py",
    )
    for item in results:
        add_check(
            f"{item['script']}_encoding_clean",
            item.get("encoding_clean", False),
            item["script"],
        )

    _assert(all(item["passed"] for item in checks), "maintenance payload contract verification failed")
    return checks


def _verify_entry_semantics() -> Dict[str, Any]:
    app_path = REPO_ROOT / "src" / "App.tsx"
    map_path = REPO_ROOT / "src" / "views" / "MapTopologyView.tsx"
    topology_path = REPO_ROOT / "src" / "views" / "TopologyView.tsx"
    hook_path = REPO_ROOT / "src" / "hooks" / "useSimulation.ts"
    ai_context_path = REPO_ROOT / "src" / "components" / "ai-assistant" / "useAiAssistantPageContext.ts"
    app_text = _read_text(app_path)
    map_text = _read_text(map_path)
    topology_text = _read_text(topology_path)
    hook_text = _read_text(hook_path)
    ai_context_text = _read_text(ai_context_path)

    normalized_app_text = _normalize_source(app_text)
    normalized_map_text = _normalize_source(map_text)
    normalized_topology_text = _normalize_source(topology_text)
    normalized_ai_context_text = _normalize_source(ai_context_text)

    checks = [
        {
            "id": "map_topology_route_present",
            "passed": _route_present(normalized_app_text, "/map-topology", "MapTopologyView"),
            "file": str(app_path),
        },
        {
            "id": "topology_route_present",
            "passed": _route_present(normalized_app_text, "/topology", "TopologyView"),
            "file": str(app_path),
        },
        {
            "id": "map_navigation_present",
            "passed": _navigate_call_present(app_text, "/map-topology"),
            "file": str(app_path),
        },
        {
            "id": "topology_navigation_present",
            "passed": _navigate_call_present(app_text, "/topology?debugActions=1"),
            "file": str(app_path),
        },
        {
            "id": "topology_debug_navigation_present",
            "passed": "navigate('/topology?debugActions=1')" in _normalize_source(app_text),
            "file": str(app_path),
        },
        {
            "id": "view_switcher_labels_primary_vs_debug",
            "passed": all(
                token in normalized_app_text
                for token in [
                    "切换正式主仿真页 / 调试页",
                    "第一张图主仿真入口",
                    "TopologyView 调试页",
                ]
            ),
            "file": str(app_path),
        },
        {
            "id": "map_view_exposes_primary_entry_hint",
            "passed": all(
                token in normalized_map_text
                for token in [
                    "simulationEntryHint",
                    "runSteadySimulation",
                    "saveSteadySnapshot",
                    "loadSteadySelectedSnapshot",
                    "runSteadyMissingTrialScenarios",
                ]
            ),
            "file": str(map_path),
        },
        {
            "id": "map_view_primary_heading_copy",
            "passed": "SmartGas · WE1 第一张图主仿真" in map_text,
            "file": str(map_path),
        },
        {
            "id": "map_view_primary_hint_copy",
            "passed": "第一张图已经接上当前主仿真结果，先看场景摘要，再看覆盖结果清单。" in map_text,
            "file": str(map_path),
        },
        {
            "id": "map_view_rejects_legacy_failure_entry",
            "passed": all(
                token not in map_text and token not in hook_text
                for token in [
                    "/api/emergency/simulate-failure",
                    "emergencyAPI.simulate",
                    "failure_node_id",
                    "failed_node_id",
                ]
            ),
            "file": f"{map_path};{hook_path}",
        },
        {
            "id": "topology_view_retains_debug_tooling",
            "passed": all(
                token in normalized_topology_text
                for token in [
                    "MAINLINE_SCENARIOS",
                    "rawData",
                    "topology-canvas",
                    "debugActions",
                    "调试操作面已默认收起",
                    "返回第一张图主仿真入口",
                ]
            ),
            "file": str(topology_path),
        },
        {
            "id": "topology_view_hides_debug_actions_by_default",
            "passed": all(
                token in normalized_topology_text
                for token in [
                    "debugActionsEnabled && (",
                    "/topology?debugActions=1",
                ]
            ),
            "file": str(topology_path),
        },
        {
            "id": "topology_view_debug_entry_button",
            "passed": "navigate('/topology?debugActions=1')" in normalized_topology_text,
            "file": str(topology_path),
        },
        {
            "id": "topology_view_debug_boundary_copy",
            "passed": all(
                token in normalized_topology_text
                for token in [
                    "TopologyView 调试页",
                    "正式仿真运行、快照和基线对比请回第一张图主入口。",
                    "返回第一张图主仿真入口",
                ]
            ),
            "file": str(topology_path),
        },
        {
            "id": "topology_view_sim_panel_gated_by_debug_actions",
            "passed": _sim_panel_gated_by_debug_actions(topology_text),
            "file": str(topology_path),
        },
        {
            "id": "ai_context_map_vs_topology_distinct",
            "passed": all(
                token in normalized_ai_context_text
                for token in [
                    "'/topology':",
                    "page: 'topology-canvas'",
                    "module: 'topology-analysis'",
                    "Debug-only topology canvas",
                    "'/map-topology':",
                    "page: 'map-topology'",
                    "module: 'we1-simulation'",
                    "Primary WE1 simulation entry on the first map",
                ]
            ),
            "file": str(ai_context_path),
        },
    ]
    _assert(all(item["passed"] for item in checks), "maintenance entry semantics verification failed")
    return {"checks": checks}


def main() -> int:
    try:
        scripts = [
            "verify_we1_phase34_final.py",
            "verify_we1_map_phase5.py",
            "verify_we1_snapshot_archive.py",
        ]
        results: List[Dict[str, Any]] = [_run_script(script_name) for script_name in scripts]
        failed = [item for item in results if not item["passed"]]
        payload_checks = _verify_script_payloads(results)
        entry_semantics = _verify_entry_semantics()

        output = {
            "status": "passed" if not failed else "failed",
            "mode": "maintenance",
            "scripts": results,
            "payload_checks": payload_checks,
            "entry_semantics": entry_semantics["checks"],
            "failure_triage_order": [
                "map entry and frontend consumption layer",
                "mapping layer and source ID hit relation",
                "snapshot archive layer",
                "backend solver input and steady solve mainline",
            ],
            "next_action": "Keep maintenance mode when all checks pass; otherwise fix regressions only and do not expand stages.",
        }

        sys.stdout.buffer.write(b"=== WE1 maintenance verification start ===\n")
        sys.stdout.buffer.write((json.dumps(output, ensure_ascii=False, indent=2) + "\n").encode("utf-8", errors="replace"))
        return 0 if not failed else 1
    except Exception as exc:
        output = {
            "status": "failed",
            "mode": "maintenance",
            "error": str(exc),
            "failure_triage_order": [
                "map entry and frontend consumption layer",
                "mapping layer and source ID hit relation",
                "snapshot archive layer",
                "backend solver input and steady solve mainline",
            ],
            "next_action": "Repair entry semantics or regression chain first, then rerun maintenance verification.",
        }
        sys.stdout.buffer.write(b"=== WE1 maintenance verification start ===\n")
        sys.stdout.buffer.write((json.dumps(output, ensure_ascii=False, indent=2) + "\n").encode("utf-8", errors="replace"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())


