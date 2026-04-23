"""
甪直站 AI 试点第 7 阶段验收脚本：
1. report 接口返回结构完整；
2. markdown 复盘内容包含关键章节；
3. report.summary 与 summary 接口核心统计一致。
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.append(str(ROOT / "backend"))

from app.routers.ai_assistant import get_luzhi_pilot_report, get_luzhi_pilot_summary  # noqa: E402


async def main() -> int:
    summary_payload = await get_luzhi_pilot_summary(days=7, scan_limit=1000)
    report_payload = await get_luzhi_pilot_report(days=7, scan_limit=1000, recent_limit=20)

    assert isinstance(report_payload, dict), "report 接口返回结构异常"
    for key in ("pilot_enabled", "summary", "report_markdown", "report_filename", "generated_at"):
        assert key in report_payload, f"report 缺少字段: {key}"

    markdown = str(report_payload.get("report_markdown") or "")
    assert markdown.strip(), "report_markdown 为空"
    for marker in (
        "# 甪直站AI试点复盘报告",
        "## 风险分布",
        "## 异常热点（按中高风险频次）",
        "## 连续告警（仅列出连续 >=2 次的指标）",
        "## 最近分析明细",
    ):
        assert marker in markdown, f"markdown 缺少章节: {marker}"

    report_summary = report_payload.get("summary")
    assert isinstance(report_summary, dict), "report.summary 结构异常"

    assert report_summary.get("total_in_window") == summary_payload.get("total_in_window"), "summary.total_in_window 不一致"
    assert report_summary.get("latest_trace_time") == summary_payload.get("latest_trace_time"), "summary.latest_trace_time 不一致"

    report_distribution = report_summary.get("risk_distribution") or {}
    summary_distribution = summary_payload.get("risk_distribution") or {}
    for key in ("正常", "低", "中", "高"):
        assert report_distribution.get(key, 0) == summary_distribution.get(key, 0), f"risk_distribution[{key}] 不一致"

    assert isinstance(report_summary.get("hotspots"), list), "summary.hotspots 不是列表"
    assert isinstance(report_summary.get("continuous_alerts"), list), "summary.continuous_alerts 不是列表"

    print("verify_luzhi_pilot_phase7: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
