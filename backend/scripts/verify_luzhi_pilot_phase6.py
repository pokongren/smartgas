"""
甪直站 AI 试点第6阶段验收脚本：
1. 留痕查询接口返回列表；
2. 留痕汇总接口返回风险分布与统计字段；
3. 关键字段结构完整。
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.append(str(ROOT / "backend"))

from app.routers.ai_assistant import get_luzhi_pilot_summary, get_luzhi_pilot_trace  # noqa: E402


async def main() -> int:
    trace_payload = await get_luzhi_pilot_trace(limit=20)
    assert isinstance(trace_payload, dict), "trace 接口返回结构异常"
    assert isinstance(trace_payload.get("items"), list), "trace.items 不是列表"
    assert "pilot_enabled" in trace_payload, "trace 缺少 pilot_enabled"

    summary_payload = await get_luzhi_pilot_summary(days=7, scan_limit=1000)
    assert isinstance(summary_payload, dict), "summary 接口返回结构异常"
    assert "risk_distribution" in summary_payload, "summary 缺少 risk_distribution"
    assert "total_in_window" in summary_payload, "summary 缺少 total_in_window"
    assert "avg_confidence" in summary_payload, "summary 缺少 avg_confidence"
    distribution = summary_payload.get("risk_distribution") or {}
    for key in ("正常", "低", "中", "高"):
        assert key in distribution, f"risk_distribution 缺少键: {key}"

    print("verify_luzhi_pilot_phase6: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
