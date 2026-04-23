from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.database import DATA_DIR


SNAPSHOT_VERSION = "we1-snapshot-v1"
SNAPSHOT_ROOT = DATA_DIR / "we1_snapshots"
SNAPSHOT_ROOT.mkdir(parents=True, exist_ok=True)


def _severity_rank(level: str) -> int:
    if level == "critical":
        return 2
    if level == "warning":
        return 1
    return 0


def _snapshot_path(pilot_id: str, run_id: str) -> Path:
    pilot_dir = SNAPSHOT_ROOT / pilot_id
    pilot_dir.mkdir(parents=True, exist_ok=True)
    return pilot_dir / f"{run_id}.json"


def _load_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _build_input_summary(solver_input: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "solver_input_version": solver_input.get("solver_input_version"),
        "seed_file": solver_input.get("seed_file"),
        "node_count": len(solver_input.get("nodes", [])),
        "edge_count": len(solver_input.get("edges", [])),
        "valve_count": len(solver_input.get("valves", [])),
        "scenario_count": len(solver_input.get("scenarios", [])),
        "available_scenarios": [item.get("id") for item in solver_input.get("scenarios", []) if item.get("id")],
    }


def _build_key_nodes(result: Dict[str, Any], limit: int = 8) -> List[Dict[str, Any]]:
    nodes = [item for item in result.get("nodes", []) if isinstance(item, dict)]
    nodes.sort(
        key=lambda item: (
            -_severity_rank(str(item.get("alert_level") or "normal")),
            float(item.get("pressure_mpa") or 0.0),
            str(item.get("id") or ""),
        )
    )
    return [
        {
            "id": item.get("id"),
            "pressure_mpa": item.get("pressure_mpa"),
            "alert_level": item.get("alert_level"),
            "demand_served": item.get("demand_served"),
            "supply_actual": item.get("supply_actual"),
        }
        for item in nodes[:limit]
    ]


def _build_key_edges(result: Dict[str, Any], limit: int = 8) -> List[Dict[str, Any]]:
    edges = [item for item in result.get("edges", []) if isinstance(item, dict)]
    edges.sort(
        key=lambda item: (
            -_severity_rank(str(item.get("alert_level") or "normal")),
            -float(item.get("utilization") or 0.0),
            str(item.get("id") or ""),
        )
    )
    return [
        {
            "id": item.get("id"),
            "flow_rate": item.get("flow_rate"),
            "utilization": item.get("utilization"),
            "direction": item.get("direction"),
            "alert_level": item.get("alert_level"),
        }
        for item in edges[:limit]
    ]


def build_snapshot_record(
    result: Dict[str, Any],
    solver_input: Dict[str, Any],
) -> Dict[str, Any]:
    saved_at = datetime.now(timezone.utc).isoformat()
    return {
        "snapshot_version": SNAPSHOT_VERSION,
        "run_id": result.get("run_id"),
        "pilot_id": result.get("pilot_id"),
        "scenario_id": result.get("scenario_id"),
        "generated_at": result.get("generated_at"),
        "saved_at": saved_at,
        "solver_status": result.get("solver_status"),
        "iterations": result.get("iterations"),
        "input_summary": _build_input_summary(solver_input),
        "output_summary": dict(result.get("summary") or {}),
        "key_nodes": _build_key_nodes(result),
        "key_edges": _build_key_edges(result),
        "result": result,
    }


def save_snapshot(
    result: Dict[str, Any],
    solver_input: Dict[str, Any],
) -> Dict[str, Any]:
    run_id = str(result.get("run_id") or "").strip()
    pilot_id = str(result.get("pilot_id") or "").strip()
    if not run_id:
        raise ValueError("结果缺少 run_id，无法归档快照")
    if not pilot_id:
        raise ValueError("结果缺少 pilot_id，无法归档快照")

    snapshot = build_snapshot_record(result, solver_input)
    path = _snapshot_path(pilot_id, run_id)
    _write_json(path, snapshot)
    snapshot["snapshot_path"] = str(path)
    return snapshot


def _snapshot_summary(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "snapshot_version": snapshot.get("snapshot_version"),
        "run_id": snapshot.get("run_id"),
        "pilot_id": snapshot.get("pilot_id"),
        "scenario_id": snapshot.get("scenario_id"),
        "generated_at": snapshot.get("generated_at"),
        "saved_at": snapshot.get("saved_at"),
        "solver_status": snapshot.get("solver_status"),
        "iterations": snapshot.get("iterations"),
        "output_summary": snapshot.get("output_summary") or {},
        "key_nodes": snapshot.get("key_nodes") or [],
        "key_edges": snapshot.get("key_edges") or [],
    }


def list_snapshots(
    pilot_id: Optional[str] = None,
    scenario_id: Optional[str] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    roots: List[Path]
    if pilot_id:
        roots = [SNAPSHOT_ROOT / pilot_id]
    else:
        roots = [path for path in SNAPSHOT_ROOT.iterdir() if path.is_dir()] if SNAPSHOT_ROOT.exists() else []

    items: List[Dict[str, Any]] = []
    for root in roots:
        if not root.exists():
            continue
        for path in root.glob("*.json"):
            try:
                snapshot = _load_json(path)
            except Exception:
                continue
            if scenario_id and snapshot.get("scenario_id") != scenario_id:
                continue
            summary = _snapshot_summary(snapshot)
            summary["snapshot_path"] = str(path)
            items.append(summary)

    items.sort(key=lambda item: str(item.get("saved_at") or ""), reverse=True)
    return items[: max(1, limit)]


def get_snapshot(run_id: str, pilot_id: Optional[str] = None) -> Dict[str, Any]:
    candidate_paths: List[Path] = []
    if pilot_id:
        candidate_paths.append(_snapshot_path(pilot_id, run_id))
    else:
        if not SNAPSHOT_ROOT.exists():
            raise FileNotFoundError(f"未找到快照: {run_id}")
        for root in SNAPSHOT_ROOT.iterdir():
            if root.is_dir():
                candidate_paths.append(root / f"{run_id}.json")

    for path in candidate_paths:
        if path.exists():
            snapshot = _load_json(path)
            snapshot["snapshot_path"] = str(path)
            return snapshot

    raise FileNotFoundError(f"未找到快照: {run_id}")
