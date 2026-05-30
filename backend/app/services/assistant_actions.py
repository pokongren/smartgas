"""
Action token helpers for the AI assistant router.
"""

from __future__ import annotations

import re

from app.services.simulation_scenarios import DEFAULT_ZHONGWEI_MULTI_SCENARIO_IDS


def _sanitize_action_token_text(raw: str) -> str:
    return raw.replace("|", "/").replace("]", "")


def _build_zhongwei_multi_scenario_action_reply() -> str:
    return (
        "仿真 Agent 已准备好三工况演示：3000 万方/天、2000 万方/天、截断。请点击下面按钮开始，完成后主 Agent 再统一输出结论。\n\n"
        f"[ACTION:START_MULTI_SCENARIO_AI|scenario_ids={','.join(DEFAULT_ZHONGWEI_MULTI_SCENARIO_IDS)}|auto=0]\n\n"
    )


def _build_subagent_step_action_reply(
    *,
    step: str,
    status: str,
    title: str,
    message: str,
) -> str:
    step_token = _sanitize_action_token_text(step)
    status_token = _sanitize_action_token_text(status)
    title_token = _sanitize_action_token_text(title)
    message_token = _sanitize_action_token_text(re.sub(r"\s+", " ", message).strip()[:96])
    return (
        "[ACTION:SUBAGENT_STEP"
        f"|step={step_token}"
        f"|status={status_token}"
        f"|title={title_token}"
        f"|message={message_token}]"
    )
