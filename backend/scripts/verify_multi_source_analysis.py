"""
Verify the multi-source AI analysis chain with fixed representative questions.

This script is intentionally lightweight: it prints the query plan and the
aggregated evidence summary so regressions in station extraction, executor
binding, and evidence coverage are easy to spot.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.multi_source.orchestrator import multi_source_orchestrator
from app.services.multi_source.query_planner import query_planner


QUESTIONS = [
    "中卫压力为什么不对",
    "甪直站和中卫站水露点对比",
    "这个仿真结果可信吗",
]


async def main() -> None:
    for question in QUESTIONS:
        plan = query_planner.plan(question)
        result = await multi_source_orchestrator.analyze(question)
        payload = {
            "question": question,
            "plan": {
                "intent": plan.primary_intent.value,
                "tasks": [
                    {
                        "source": task.source.value,
                        "intent": task.intent.value,
                        "entity": task.entity_name,
                        "metric": task.metric_type,
                    }
                    for task in plan.tasks
                ],
            },
            "result": {
                "conclusion": result.conclusion,
                "data_sources": result.data_sources,
                "missing_sources": result.missing_sources,
                "risk_level": result.risk_level,
                "is_complete": result.is_complete,
                "completeness_reason": result.completeness_reason,
                "evidence": [
                    {
                        "source": item.source.value,
                        "entity": item.matched_entity,
                        "metric": item.metric,
                        "confidence": item.confidence,
                        "missing_fields": item.missing_fields,
                        "text": item.evidence_text,
                    }
                    for item in result.evidence_list
                ],
            },
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
