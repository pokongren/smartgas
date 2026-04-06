"""
稳态仿真 API 路由

提供三个接口：
1. POST /topology-simulation/solve-steady       跑稳态求解
2. POST /topology-simulation/solve-failure      叠加故障场景
3. GET  /api/pipeline-packages/simulation-overlay  给前端返回覆盖层
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.we1_pilot_service import get_we1_pilot_seed_or_raise
from app.services.topology_simulation import solve_steady

logger = logging.getLogger(__name__)

router = APIRouter(tags=["稳态仿真：压力流量求解"])


# ─────────────────────────────────────────────
# 请求/响应模型
# ─────────────────────────────────────────────

class SolveSteadyRequest(BaseModel):
    pilot_id: str
    scenario_id: str = "steady_base"


class SolveFailureRequest(BaseModel):
    pilot_id: str
    base_scenario_id: str = "steady_base"
    failure_node_id: str
    failure_type: str = "compressor_offline"  # compressor_offline / pipe_break / valve_close


# ─────────────────────────────────────────────
# 接口
# ─────────────────────────────────────────────

@router.post("/topology-simulation/solve-steady")
def solve_steady_api(req: SolveSteadyRequest) -> Dict[str, Any]:
    """
    对指定试点样板跑一次稳态求解。

    输入：pilot_id + scenario_id
    输出：每个节点的压力、每条管道的流量和利用率、全局告警汇总

    前端可以直接用这份结果驱动颜色、线宽、箭头渲染。
    """
    try:
        seed_data = get_we1_pilot_seed_or_raise(req.pilot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"未找到样板: {req.pilot_id}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"未找到 seed 文件: {e}")

    seed = seed_data["seed"]

    try:
        result = solve_steady(
            seed=seed,
            scenario_id=req.scenario_id,
            pilot_id=req.pilot_id,
        )
    except Exception as e:
        logger.exception(f"稳态求解失败: {e}")
        raise HTTPException(status_code=500, detail=f"求解失败: {str(e)}")

    return result.to_dict()


@router.post("/topology-simulation/solve-failure")
def solve_failure_api(req: SolveFailureRequest) -> Dict[str, Any]:
    """
    在稳态基线上叠加单点故障，重新求解。

    故障类型：
    - compressor_offline：压气站停运（compressor_enabled = false）
    - pipe_break：管段中断（status = closed）
    - valve_close：阀门关闭（status = closed）

    这个接口会自动把故障注入到对应场景里，不需要你手动改 seed。
    """
    try:
        seed_data = get_we1_pilot_seed_or_raise(req.pilot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"未找到样板: {req.pilot_id}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"未找到 seed 文件: {e}")

    seed = seed_data["seed"]

    # 在 seed 的场景列表里找基线场景，然后注入故障覆盖
    base_scenario = next(
        (s for s in seed.get("scenarios", []) if s["id"] == req.base_scenario_id),
        {"id": req.base_scenario_id, "node_overrides": [], "edge_overrides": [], "compressor_overrides": []},
    )

    # 深拷贝，加入故障覆盖
    import copy
    failure_scenario = copy.deepcopy(base_scenario)
    failure_scenario["id"] = f"failure_{req.failure_node_id}"

    if req.failure_type == "compressor_offline":
        failure_scenario.setdefault("compressor_overrides", []).append({
            "node_id": req.failure_node_id,
            "compressor_enabled": False,
        })
    elif req.failure_type in ("pipe_break", "valve_close"):
        failure_scenario.setdefault("edge_overrides", []).append({
            "edge_id": req.failure_node_id,
            "status": "closed",
        })
    else:
        failure_scenario.setdefault("node_overrides", []).append({
            "node_id": req.failure_node_id,
            "compressor_enabled": False,
        })

    # 注入到 seed
    failure_seed = copy.deepcopy(seed)
    failure_seed["scenarios"] = [failure_scenario]

    try:
        result = solve_steady(
            seed=failure_seed,
            scenario_id=failure_scenario["id"],
            pilot_id=req.pilot_id,
        )
    except Exception as e:
        logger.exception(f"故障求解失败: {e}")
        raise HTTPException(status_code=500, detail=f"求解失败: {str(e)}")

    return result.to_dict()


@router.get("/api/pipeline-packages/simulation-overlay")
def get_simulation_overlay(
    pilot_id: str = Query(..., description="试点样板 ID，如 mainline_zhongwei_jingbian"),
    scenario_id: str = Query("steady_base", description="场景 ID"),
) -> Dict[str, Any]:
    """
    给前端返回仿真覆盖层数据。

    这个接口专门为前端设计：
    - color 字段已经算好（绿/黄/橙/红），前端直接用
    - width_factor 已经算好，前端直接乘以基础线宽
    - alert_level 已经分级，前端直接判断是否显示告警图标
    - 地图和拓扑图吃同一份数据，不会不一致

    GET 方便前端直接 fetch，不用处理 POST body。
    """
    try:
        seed_data = get_we1_pilot_seed_or_raise(pilot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"未找到样板: {pilot_id}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"未找到 seed 文件: {e}")

    seed = seed_data["seed"]

    try:
        result = solve_steady(
            seed=seed,
            scenario_id=scenario_id,
            pilot_id=pilot_id,
        )
    except Exception as e:
        logger.exception(f"覆盖层生成失败: {e}")
        raise HTTPException(status_code=500, detail=f"覆盖层生成失败: {str(e)}")

    data = result.to_dict()

    # 覆盖层接口额外返回元数据，方便前端展示
    data["meta"] = {
        "pilot_id": pilot_id,
        "scenario_id": scenario_id,
        "available_scenarios": [s["id"] for s in seed.get("scenarios", [])],
        "node_count": len(data["nodes"]),
        "edge_count": len(data["edges"]),
    }

    return data
