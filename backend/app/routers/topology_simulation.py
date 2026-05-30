"""
Steady simulation API router.

Endpoints:
1. POST /topology-simulation/solve-steady
2. POST /topology-simulation/solve-failure
3. GET /api/pipeline-packages/simulation-overlay
4. Snapshot CRUD endpoints
"""

from __future__ import annotations

import copy
import logging
from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.params import Param as QueryParam
from pydantic import BaseModel
from sqlmodel import Session

from app.database import get_session
from app.routers.pipeline_packages import get_pipeline_packages
from app.services.topology_simulation import solve_steady
from app.services.we1_pilot_service import (
    build_pilot_package,
    get_we1_pilot_or_raise,
    get_we1_pilot_seed_or_raise,
)
from app.services.we1_result_snapshot_service import (
    get_snapshot,
    list_snapshots,
    save_snapshot,
)
from app.services.we1_solver_input_service import build_we1_solver_input

logger = logging.getLogger(__name__)
router = APIRouter(tags=["steady-simulation"])


class NodeInitialOverrideInput(BaseModel):
    node_id: str
    target_pressure_mpa: Optional[float] = None
    min_pressure_mpa: Optional[float] = None
    temperature_c: Optional[float] = None
    supply_max: Optional[float] = None
    nominal_flow: Optional[float] = None
    supply_nominal: Optional[float] = None
    compressor_enabled: Optional[bool] = None


class EdgeInitialOverrideInput(BaseModel):
    edge_id: str
    flow_rate: Optional[float] = None
    length_km: Optional[float] = None
    max_flow: Optional[float] = None
    status: Optional[str] = None


class InitialConditionsInput(BaseModel):
    node_overrides: Optional[List[NodeInitialOverrideInput]] = None
    edge_overrides: Optional[List[EdgeInitialOverrideInput]] = None
    default_pressure_mpa: Optional[float] = None
    default_temperature_c: Optional[float] = None
    default_flow_rate: Optional[float] = None
    apply_to_sources: bool = False


class SolveSteadyRequest(BaseModel):
    pilot_id: str
    scenario_id: str = "steady_base"
    initial_conditions: Optional[InitialConditionsInput] = None


class SolveFailureRequest(BaseModel):
    pilot_id: str
    base_scenario_id: str = "steady_base"
    failure_node_id: str
    failure_type: str = "compressor_offline"


class SaveSnapshotRequest(BaseModel):
    pilot_id: str
    scenario_id: str = "steady_base"
    initial_conditions: Optional[InitialConditionsInput] = None


def _sanitize_query_value(value: Any) -> Any:
    if isinstance(value, QueryParam):
        return value.default
    return value


def _build_solver_input_or_raise(pilot_id: str, session: Session) -> Dict[str, Any]:
    try:
        pilot = get_we1_pilot_or_raise(pilot_id)
        seed_data = get_we1_pilot_seed_or_raise(pilot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"pilot not found: {pilot_id}")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"seed file not found: {exc}")

    packages = get_pipeline_packages(system_id="we1", session=session)
    if not packages:
        raise HTTPException(status_code=404, detail="WE1 pipeline package not found")

    pilot_package = build_pilot_package(packages[0], pilot)
    return build_we1_solver_input(pilot=pilot, pilot_package=pilot_package, seed_data=seed_data)


def _finalize_result_payload(
    data: Dict[str, Any],
    solver_input: Dict[str, Any],
    pilot_id: str,
    scenario_id: str,
) -> Dict[str, Any]:
    payload = dict(data)
    payload["pilot_id"] = pilot_id
    payload["scenario_id"] = scenario_id
    payload["run_id"] = f"we1-{uuid4().hex[:12]}"
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    payload["meta"] = {
        "pilot_id": pilot_id,
        "scenario_id": scenario_id,
        "available_scenarios": [s["id"] for s in solver_input.get("scenarios", [])],
        "node_count": len(payload.get("nodes", [])),
        "edge_count": len(payload.get("edges", [])),
        "solver_input_version": solver_input.get("solver_input_version"),
    }
    return payload


def _apply_initial_conditions(
    solver_input: Dict[str, Any],
    scenario_id: str,
    initial_conditions: Optional[InitialConditionsInput],
) -> None:
    if initial_conditions is None:
        return

    node_overrides: List[Dict[str, Any]] = []
    edge_overrides: List[Dict[str, Any]] = []
    explicit_node_ids: set[str] = set()
    explicit_edge_ids: set[str] = set()

    for item in initial_conditions.node_overrides or []:
        node_id = str(item.node_id or "").strip()
        if not node_id:
            continue
        override: Dict[str, Any] = {"node_id": node_id}
        if item.target_pressure_mpa is not None:
            override["target_pressure_mpa"] = float(item.target_pressure_mpa)
        if item.min_pressure_mpa is not None:
            override["min_pressure_mpa"] = float(item.min_pressure_mpa)
        if item.temperature_c is not None:
            override["temperature_c"] = float(item.temperature_c)
        if item.supply_max is not None:
            override["supply_max"] = float(item.supply_max)
        if item.nominal_flow is not None:
            override["nominal_flow"] = float(item.nominal_flow)
        if item.supply_nominal is not None:
            override["supply_nominal"] = float(item.supply_nominal)
        if item.compressor_enabled is not None:
            override["compressor_enabled"] = bool(item.compressor_enabled)
        if len(override) > 1:
            node_overrides.append(override)
            explicit_node_ids.add(node_id)

    for item in initial_conditions.edge_overrides or []:
        edge_id = str(item.edge_id or "").strip()
        if not edge_id:
            continue
        override: Dict[str, Any] = {"edge_id": edge_id}
        if item.flow_rate is not None:
            override["flow_rate"] = float(item.flow_rate)
        if item.length_km is not None:
            override["length_km"] = float(item.length_km)
        if item.max_flow is not None:
            override["max_flow"] = float(item.max_flow)
        if item.status in ("open", "limited", "closed"):
            override["status"] = item.status
        if len(override) > 1:
            edge_overrides.append(override)
            explicit_edge_ids.add(edge_id)

    if initial_conditions.default_pressure_mpa is not None or initial_conditions.default_temperature_c is not None:
        for node in solver_input.get("nodes", []):
            node_id = str(node.get("id") or "")
            if not node_id or node_id in explicit_node_ids:
                continue
            if not initial_conditions.apply_to_sources and str(node.get("role") or "") == "source":
                continue
            override: Dict[str, Any] = {"node_id": node_id}
            if initial_conditions.default_pressure_mpa is not None:
                override["target_pressure_mpa"] = float(initial_conditions.default_pressure_mpa)
            if initial_conditions.default_temperature_c is not None:
                override["temperature_c"] = float(initial_conditions.default_temperature_c)
            node_overrides.append(override)

    if initial_conditions.default_flow_rate is not None:
        for edge in solver_input.get("edges", []):
            edge_id = str(edge.get("id") or "")
            if not edge_id or edge_id in explicit_edge_ids:
                continue
            edge_overrides.append({"edge_id": edge_id, "flow_rate": float(initial_conditions.default_flow_rate)})

    if not node_overrides and not edge_overrides:
        return

    scenarios = solver_input.setdefault("scenarios", [])
    scenario = next((item for item in scenarios if item.get("id") == scenario_id), None)
    if scenario is None:
        scenario = {
            "id": scenario_id,
            "node_overrides": [],
            "edge_overrides": [],
            "compressor_overrides": [],
        }
        scenarios.append(scenario)

    scenario.setdefault("node_overrides", [])
    scenario.setdefault("edge_overrides", [])
    scenario.setdefault("compressor_overrides", [])
    scenario["node_overrides"].extend(node_overrides)
    scenario["edge_overrides"].extend(edge_overrides)


@router.post("/topology-simulation/solve-steady")
def solve_steady_api(req: SolveSteadyRequest, session: Session = Depends(get_session)) -> Dict[str, Any]:
    solver_input = _build_solver_input_or_raise(req.pilot_id, session)
    _apply_initial_conditions(solver_input, req.scenario_id, req.initial_conditions)

    try:
        result = solve_steady(seed=solver_input, scenario_id=req.scenario_id, pilot_id=req.pilot_id)
    except Exception as exc:
        logger.exception("steady solve failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"solve failed: {exc}")

    return _finalize_result_payload(result.to_dict(), solver_input, req.pilot_id, req.scenario_id)


@router.post("/topology-simulation/solve-failure")
def solve_failure_api(req: SolveFailureRequest, session: Session = Depends(get_session)) -> Dict[str, Any]:
    solver_input = _build_solver_input_or_raise(req.pilot_id, session)

    base_scenario = next(
        (s for s in solver_input.get("scenarios", []) if s["id"] == req.base_scenario_id),
        {"id": req.base_scenario_id, "node_overrides": [], "edge_overrides": [], "compressor_overrides": []},
    )

    failure_scenario = copy.deepcopy(base_scenario)
    failure_scenario["id"] = f"failure_{req.failure_node_id}"

    if req.failure_type == "compressor_offline":
        failure_scenario.setdefault("compressor_overrides", []).append({"node_id": req.failure_node_id, "compressor_enabled": False})
    elif req.failure_type in ("pipe_break", "valve_close"):
        failure_scenario.setdefault("edge_overrides", []).append({"edge_id": req.failure_node_id, "status": "closed"})
    else:
        failure_scenario.setdefault("node_overrides", []).append({"node_id": req.failure_node_id, "compressor_enabled": False})

    failure_seed = copy.deepcopy(solver_input)
    failure_seed["scenarios"] = [failure_scenario]

    try:
        result = solve_steady(seed=failure_seed, scenario_id=failure_scenario["id"], pilot_id=req.pilot_id)
    except Exception as exc:
        logger.exception("failure solve failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"solve failed: {exc}")

    return _finalize_result_payload(result.to_dict(), failure_seed, req.pilot_id, failure_scenario["id"])


@router.get("/api/pipeline-packages/simulation-overlay")
def get_simulation_overlay(
    pilot_id: str = Query(..., description="pilot id"),
    scenario_id: str = Query("steady_base", description="scenario id"),
    session: Session = Depends(get_session),
) -> Dict[str, Any]:
    solver_input = _build_solver_input_or_raise(pilot_id, session)

    try:
        result = solve_steady(seed=solver_input, scenario_id=scenario_id, pilot_id=pilot_id)
    except Exception as exc:
        logger.exception("overlay generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"overlay generation failed: {exc}")

    return _finalize_result_payload(result.to_dict(), solver_input, pilot_id, scenario_id)


@router.post("/topology-simulation/snapshots")
def create_simulation_snapshot(req: SaveSnapshotRequest, session: Session = Depends(get_session)) -> Dict[str, Any]:
    solver_input = _build_solver_input_or_raise(req.pilot_id, session)
    _apply_initial_conditions(solver_input, req.scenario_id, req.initial_conditions)

    try:
        result = solve_steady(seed=solver_input, scenario_id=req.scenario_id, pilot_id=req.pilot_id)
    except Exception as exc:
        logger.exception("snapshot generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"snapshot generation failed: {exc}")

    payload = _finalize_result_payload(result.to_dict(), solver_input, req.pilot_id, req.scenario_id)

    try:
        return save_snapshot(payload, solver_input)
    except Exception as exc:
        logger.exception("snapshot save failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"snapshot save failed: {exc}")


@router.get("/topology-simulation/snapshots")
def list_simulation_snapshots(
    pilot_id: Annotated[Optional[str], Query(description="pilot id")] = None,
    scenario_id: Annotated[Optional[str], Query(description="scenario id")] = None,
    limit: Annotated[int, Query(ge=1, le=200, description="item limit")] = 20,
) -> Dict[str, Any]:
    pilot_id = _sanitize_query_value(pilot_id)
    scenario_id = _sanitize_query_value(scenario_id)
    limit = _sanitize_query_value(limit)

    items = list_snapshots(pilot_id=pilot_id, scenario_id=scenario_id, limit=limit)
    return {"items": items, "count": len(items), "pilot_id": pilot_id, "scenario_id": scenario_id}


@router.get("/topology-simulation/snapshots/{run_id}")
def get_simulation_snapshot(
    run_id: str,
    pilot_id: Annotated[Optional[str], Query(description="pilot id (optional)")] = None,
) -> Dict[str, Any]:
    try:
        return get_snapshot(run_id, pilot_id=_sanitize_query_value(pilot_id))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
