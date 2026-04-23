from __future__ import annotations

import sys
from pathlib import Path

from sqlmodel import Session


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.database import engine  # noqa: E402
from app.routers.ai_assistant import _apply_yuqian_style  # noqa: E402
from app.services.assistant_tools import (  # noqa: E402
    _handle_analyze_correlation,
    _handle_predict_trend,
    _resolve_scada_station_name,
)


def _show(text: str) -> str:
    return text.encode("unicode_escape").decode("ascii")


def main() -> int:
    checks: list[tuple[str, bool, str]] = []

    short_in = "你好，我在。"
    short_out = _apply_yuqian_style(short_in)
    checks.append(
        (
            "short_style_prefix",
            short_out.startswith("要我说，先给准话："),
            _show(short_out),
        )
    )

    long_in = "这是一段较长的分析文本。" * 12
    long_out = _apply_yuqian_style(long_in)
    checks.append(
        (
            "long_style_no_forced_prefix",
            long_out == long_in,
            _show(long_out[:60]),
        )
    )

    with Session(engine) as session:
        matched, hint = _resolve_scada_station_name(session, "甪直站", metric_types=("pressure",))
        checks.append(
            (
                "alias_match_luzhi",
                matched == "甪直分输站",
                f"matched={_show(matched or '')}, hint={_show(hint)}",
            )
        )

        trend = _handle_predict_trend({"station_id": "甪直站", "metric": "pressure", "hours": 6}, session)
        checks.append(
            (
                "trend_contains_source",
                ("数据源:" in trend) and ("甪直分输站" in trend),
                _show(trend[:160]),
            )
        )

        corr = _handle_analyze_correlation({"station_id": "甪直站", "hours": 6}, session)
        checks.append(
            (
                "correlation_contains_source",
                ("数据源:" in corr) and ("甪直分输站" in corr),
                _show(corr[:160]),
            )
        )

    failed = [item for item in checks if not item[1]]
    for name, ok, detail in checks:
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {name} :: {detail}")

    print(f"summary: total={len(checks)}, passed={len(checks) - len(failed)}, failed={len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
