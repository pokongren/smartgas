"""
SubAgent simulation request detection and summary collection.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from sqlmodel import Session

from app.services.assistant_tools import execute_tool
from app.services.simulation_scenarios import DEFAULT_ZHONGWEI_MULTI_SCENARIO_IDS

logger = logging.getLogger(__name__)


def _looks_like_zhongwei_simulation_request(message: str) -> bool:
    compact = re.sub(r"\s+", "", str(message or ""))
    if "中卫" not in compact:
        return False
    return any(
        word in compact
        for word in (
            "仿真",
            "模拟",
            "推演",
            "演示",
            "接入",
            "风险",
            "影响",
            "分析",
            "限流",
            "下降",
            "截断",
        )
    )


def _collect_subagent_simulation_summary(message: str, session: Session) -> dict[str, Any]:
    compact = re.sub(r"\s+", "", message or "")
    is_zhongwei_auto_demo = _looks_like_zhongwei_simulation_request(message)
    should_run_model = is_zhongwei_auto_demo or any(word in compact for word in ("仿真", "模拟", "推演", "限流", "下降", "截断", "三库一模", "一模"))
    summary: dict[str, Any] = {
        "connected": should_run_model,
        "tool": "run_steady_sim",
        "pilot_id": "zhongwei_shanghai_baihe",
        "scenario_id": "steady_base",
        "status": "not_required",
        "auto_demo": is_zhongwei_auto_demo,
        "demo_action": "START_MULTI_SCENARIO_AI" if is_zhongwei_auto_demo else "",
        "selected_scenario_ids": DEFAULT_ZHONGWEI_MULTI_SCENARIO_IDS if is_zhongwei_auto_demo else [],
    }
    if not should_run_model:
        return summary
    try:
        tool_result = execute_tool(
            "run_steady_sim",
            {"pilot_id": "zhongwei_shanghai_baihe", "scenario_id": "steady_base"},
            session,
        )
        status_match = re.search(r"状态：([^，\n]+)", tool_result)
        supply_match = re.search(r"总供气：([0-9.]+)\s*万方/天", tool_result)
        unserved_match = re.search(r"未满足需求：([0-9.]+)\s*万方/天", tool_result)
        risk_match = re.search(r"风险等级：([A-Za-z0-9_\u4e00-\u9fa5-]+)", tool_result)
        run_id_match = re.search(r"稳态仿真已完成：([^\s，\n]+)", tool_result)
        summary.update({
            "run_id": run_id_match.group(1).strip() if run_id_match else "",
            "status": status_match.group(1).strip() if status_match else "returned",
            "total_supply": float(supply_match.group(1)) if supply_match else None,
            "unserved_demand": float(unserved_match.group(1)) if unserved_match else None,
            "risk_level": risk_match.group(1).strip() if risk_match else "",
        })
    except Exception as exc:
        logger.warning("collect subagent simulation evidence failed: %s", exc)
        summary.update({"status": "error", "error": str(exc)})
    return summary
