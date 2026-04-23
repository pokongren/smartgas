"""
甪直站 AI 试点第4阶段验收脚本：
1. 命中甪直试点时，应返回回链动作指令；
2. 应写入留痕文件；
3. 关闭环境开关后，应自动回退（不命中试点分支）。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.append(str(ROOT / "backend"))

import app.routers.ai_assistant as ai_router  # noqa: E402
from app.services.ai_analysis_orchestrator import AssistantContext  # noqa: E402


def build_context() -> AssistantContext:
    return AssistantContext(
        page="global-pipeline",
        selection={
            "pilot_enabled": True,
            "pilot_station_name": ai_router.LUZHI_PILOT_STATION,
            "luzhi_snapshot": {
                "stationName": ai_router.LUZHI_PILOT_STATION,
                "generatedAt": "2026-04-07T14:00:00",
                "timeRange": {
                    "start": "2026-03-11T00:00:00",
                    "end": "2026-03-12T23:00:00",
                },
                "metrics": [
                    {
                        "label": "西一线进站压力",
                        "pipeline": "西一线",
                        "type": "pressure",
                        "unit": "MPa",
                        "latest": 5.31,
                        "min": 5.01,
                        "max": 5.36,
                        "avg": 5.11,
                        "delta6h": 0.16,
                    },
                    {
                        "label": "西二线进站温度",
                        "pipeline": "西二线",
                        "type": "temperature",
                        "unit": "C",
                        "latest": 14.2,
                        "min": 10.2,
                        "max": 14.4,
                        "avg": 12.3,
                        "delta6h": 1.8,
                    },
                ],
            },
        },
    )


def line_count(path: Path) -> int:
    if not path.exists():
        return 0
    return len(path.read_text(encoding="utf-8").splitlines())


def main() -> int:
    trace_path = ai_router.LUZHI_TRACE_PATH
    before_lines = line_count(trace_path)

    old_env = os.getenv(ai_router.LUZHI_PILOT_ENV_KEY)
    os.environ[ai_router.LUZHI_PILOT_ENV_KEY] = "1"
    try:
        context = build_context()
        reply = ai_router.try_luzhi_pilot_reply(context, "请分析甪直并给调度建议") or ""
        assert "[ACTION:OPEN_HISTORY_PANEL|" in reply, "未返回回链动作指令"
        assert "完整性提示：" in reply, "未返回完整性提示"

        after_lines = line_count(trace_path)
        assert after_lines >= before_lines + 1, "留痕文件未新增记录"

        os.environ[ai_router.LUZHI_PILOT_ENV_KEY] = "0"
        fallback = ai_router.try_luzhi_pilot_reply(context, "请继续分析甪直")
        assert fallback is None, "环境开关关闭后未回退"
    finally:
        if old_env is None:
            os.environ.pop(ai_router.LUZHI_PILOT_ENV_KEY, None)
        else:
            os.environ[ai_router.LUZHI_PILOT_ENV_KEY] = old_env

    print("verify_luzhi_pilot_phase4: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
