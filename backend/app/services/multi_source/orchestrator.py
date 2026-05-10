"""
多库并行分析编排器
封装完整的流程：计划 → 并行执行 → 交叉验证 → 汇总结论
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from .data_source_registry import datasource_registry
from .evidence_models import AggregatedResult, EvidenceItem, QueryPlan
from .evidence_aggregator import evidence_aggregator
from .cross_validator import cross_validator
from .executors import EXECUTOR_MAP
from .query_planner import query_planner

logger = logging.getLogger(__name__)


class MultiSourceOrchestrator:
    """
    多库并行交叉分析编排器
    使用方式：
        result = await MultiSourceOrchestrator().analyze("中卫压力为什么低")
    """

    def __init__(self):
        # 注册所有执行器到数据源注册表
        for source, executor in EXECUTOR_MAP.items():
            datasource_registry.register_executor(source, executor)

    async def analyze(self, question: str, **kwargs: Any) -> AggregatedResult:
        """
        主入口：接收用户问题，返回多库分析结果
        """
        total_start = time.time()

        # 1. 生成查询计划
        plan = query_planner.plan(question)
        logger.info(
            "[MultiSource] plan=%s intent=%s tasks=%d",
            plan.plan_id, plan.primary_intent.value, len(plan.tasks),
        )

        if not plan.tasks:
            return AggregatedResult(
                conclusion="未能识别出需要查询的数据源，请尝试更具体的问题。",
                is_complete=False,
                completeness_reason="查询计划为空",
            )

        # 2. 并行执行所有任务
        evidence_list = await self._execute_tasks_parallel(plan, **kwargs)

        # 3. 交叉验证
        validation_report = cross_validator.validate(evidence_list)
        conflict_warnings = [c.suggestion for c in validation_report.conflicts if c.severity in ("警告", "严重")]

        # 4. 汇总结论
        result = evidence_aggregator.aggregate(
            evidence_list=evidence_list,
            original_question=question,
            conflict_warnings=conflict_warnings,
        )

        result.response_time_ms = int((time.time() - total_start) * 1000)

        logger.info(
            "[MultiSource] done plan=%s sources=%s missing=%s complete=%s",
            plan.plan_id,
            result.data_sources,
            result.missing_sources,
            result.is_complete,
        )

        return result

    async def _execute_tasks_parallel(
        self, plan: QueryPlan, **kwargs: Any
    ) -> list[EvidenceItem]:
        """
        并行执行查询计划中的所有任务
        每个任务有独立的超时控制
        """
        tasks_to_run: list[asyncio.Task] = []
        task_meta: list[tuple[str, Any]] = []  # (task_id, source)

        for task in plan.tasks:
            executor = datasource_registry.get_executor(task.source)
            if not executor:
                logger.warning("[MultiSource] no executor for %s", task.source.value)
                continue

            coro = executor(
                query_text=task.query_text,
                entity_name=task.entity_name,
                metric_type=task.metric_type,
                **kwargs,
            )
            # 包装超时
            coro_with_timeout = asyncio.wait_for(coro, timeout=task.timeout_seconds)
            aio_task = asyncio.create_task(coro_with_timeout)
            tasks_to_run.append(aio_task)
            task_meta.append((task.task_id, task.source))

        if not tasks_to_run:
            return []

        # 等待所有任务完成（无论成功或超时）
        results = await asyncio.gather(*tasks_to_run, return_exceptions=True)

        evidence_list: list[EvidenceItem] = []
        for (task_id, source), result in zip(task_meta, results):
            if isinstance(result, Exception):
                logger.warning("[MultiSource] task=%s source=%s failed: %s", task_id, source.value, result)
                # 生成失败证据
                evidence_list.append(EvidenceItem(
                    source=source,
                    query=plan.original_question,
                    confidence=0.0,
                    evidence_text=f"{source.value} 查询超时或失败：{result}",
                    missing_fields=["query_result"],
                ))
            elif result is not None:
                evidence_list.append(result)

        return evidence_list


# 全局单例
multi_source_orchestrator = MultiSourceOrchestrator()
