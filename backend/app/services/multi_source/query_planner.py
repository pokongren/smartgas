"""
查询计划器
理解用户问题 → 拆分意图 → 生成并行查询任务
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

from sqlmodel import Session, select

from app.database import get_session, scada_history_engine
from app.models import Pipeline, Station
from app.scada_models import ScadaHistory
from app.services.raw_excel_ai_index import raw_excel_ai_index
from app.services.we1_result_snapshot_service import get_snapshot, list_snapshots

from .data_source_registry import datasource_registry
from .evidence_models import (
    EvidenceItem,
    EvidenceSource,
    QueryIntent,
    QueryPlan,
    QueryTask,
)

logger = logging.getLogger(__name__)


# ========== 意图关键词映射 ==========
_INTENT_KEYWORDS: dict[QueryIntent, list[str]] = {
    QueryIntent.HISTORY_TREND: [
        "趋势", "曲线", "波动", "变化", "历史", "最近", "小时", "昨天", "今天",
        "上升", "下降", "持平", "走势", "chart", "trend", "history",
    ],
    QueryIntent.TOPOLOGY_RELATION: [
        "上下游", "连通", "拓扑", "路径", "路由", "关联", "连接", "经过",
        "之间", "到", "从", "走向", "管网结构",
    ],
    QueryIntent.SIMULATION_IMPACT: [
        "仿真", "模拟", "如果", "假设", "设置", "调整后", "影响", "会怎样",
        "前后对比", "snapshot", "场景",
    ],
    QueryIntent.EMERGENCY_GUIDE: [
        "怎么处理", "怎么办", "处置", "预案", "规程", "依据", "建议",
        "操作", "应急", "救援", "步骤", "指南",
    ],
    QueryIntent.STATIC_INFO: [
        "站场", "管线", "参数", "属性", "坐标", "能力", "规模", "类型",
        "多少个", "有哪些", "列表", "清单", "count", "list",
    ],
}

# 指标关键词
_METRIC_KEYWORDS: dict[str, list[str]] = {
    "pressure": ["压力", "pressure", "mpa", "mp"],
    "temperature": ["温度", "temperature", "温层"],
    "dewpoint": ["水露点", "露点", "dewpoint"],
    "flow": ["流量", "flow", "输量"],
    "h2s": ["硫化氢", "h2s", "硫"],
}

# 站名后缀模式
_STATION_SUFFIX_PATTERN = re.compile(
    r"[\u4e00-\u9fa5A-Za-z0-9]{1,24}?(?:分输联络站|分输压气站|分输清管站|分输站|压气站|清管站|站)"
)

_STATION_SUFFIX_RE = re.compile(r"(?:分输联络站|分输压气站|分输清管站|分输站|压气站|清管站|站)$")
_LEADING_NOISE_RE = re.compile(r"^(?:和|与|跟|及|、|到|从|对比|比较|分析)+")
_QUESTION_NOISE_RE = re.compile(
    r"(?:为什么|怎么回事|怎么样|是否|是不是|压力|温度|水露点|露点|流量|输量|趋势|曲线|历史|"
    r"对比|比较|差异|分析|诊断|评估|可信|验证|异常|不对|偏低|偏高|低|高|了|的|当前|最近|这个|结果)"
)


def _normalize_station_candidate(name: str) -> str:
    """清理从自然语言中切出来的站名候选。"""
    cleaned = _LEADING_NOISE_RE.sub("", name.strip())
    cleaned = _QUESTION_NOISE_RE.sub("", cleaned)
    cleaned = _STATION_SUFFIX_RE.sub("", cleaned)
    return cleaned.strip()


@lru_cache(maxsize=1)
def _known_station_roots() -> tuple[str, ...]:
    """
    从当前业务库、SCADA库、Excel索引库提取可识别站名根。
    计划器只做轻量名称识别，真正的数据仍由各执行器查询。
    """
    roots: set[str] = {"中卫", "甪直", "古浪", "上海"}

    try:
        with next(get_session()) as session:
            for name in session.exec(select(Station.name)).all():
                root = _normalize_station_candidate(str(name or ""))
                if len(root) >= 2:
                    roots.add(root)
    except Exception as exc:
        logger.debug("load station roots from smartgas failed: %s", exc)

    try:
        with Session(scada_history_engine) as session:
            for name in session.exec(select(ScadaHistory.station_name).distinct()).all():
                root = _normalize_station_candidate(str(name or ""))
                if len(root) >= 2:
                    roots.add(root)
    except Exception as exc:
        logger.debug("load station roots from scada failed: %s", exc)

    try:
        raw_excel_ai_index.ensure_loaded()
        for item in raw_excel_ai_index.station_catalog:
            root = _normalize_station_candidate(str(item.get("name", "")))
            if len(root) >= 2:
                roots.add(root)
            for alias in item.get("aliases", []):
                alias_root = _normalize_station_candidate(str(alias))
                if len(alias_root) >= 2:
                    roots.add(alias_root)
    except Exception as exc:
        logger.debug("load station roots from raw excel failed: %s", exc)

    return tuple(sorted(roots, key=len, reverse=True))


def _extract_station_names(text: str) -> list[str]:
    """从文本中提取站名"""
    compact = re.sub(r"\s+", "", text)
    matches = _STATION_SUFFIX_PATTERN.findall(compact)
    seen = set()
    result = []
    for m in matches:
        name = _normalize_station_candidate(m)
        if name and name not in seen:
            seen.add(name)
            result.append(name)

    for root in _known_station_roots():
        if root in compact and root not in seen:
            seen.add(root)
            result.append(root)
    return result


def _detect_intent(text: str) -> QueryIntent:
    """检测用户问题的主意图"""
    compact = re.sub(r"\s+", "", text).lower()
    scores: dict[QueryIntent, int] = {}
    for intent, keywords in _INTENT_KEYWORDS.items():
        scores[intent] = sum(1 for kw in keywords if kw.lower() in compact)

    # 仿真意图权重更高（一旦提到仿真相关词）
    if scores.get(QueryIntent.SIMULATION_IMPACT, 0) > 0:
        return QueryIntent.SIMULATION_IMPACT

    # 应急处置权重也高
    if scores.get(QueryIntent.EMERGENCY_GUIDE, 0) > 0:
        return QueryIntent.EMERGENCY_GUIDE

    # 历史趋势
    if scores.get(QueryIntent.HISTORY_TREND, 0) > 0:
        return QueryIntent.HISTORY_TREND

    # 拓扑关系
    if scores.get(QueryIntent.TOPOLOGY_RELATION, 0) > 0:
        return QueryIntent.TOPOLOGY_RELATION

    # 静态信息（查数量、列表等）
    if scores.get(QueryIntent.STATIC_INFO, 0) > 0:
        return QueryIntent.STATIC_INFO

    # 默认综合分析
    return QueryIntent.COMPREHENSIVE


def _detect_metric_type(text: str) -> str:
    """检测指标类型"""
    compact = re.sub(r"\s+", "", text).lower()
    for metric, keywords in _METRIC_KEYWORDS.items():
        if any(kw.lower() in compact for kw in keywords):
            return metric
    return ""


def _build_task_id() -> str:
    return uuid.uuid4().hex[:12]


class QueryPlanner:
    """
    查询计划器
    输入用户问题 → 输出并行查询计划
    """

    def __init__(self):
        pass

    def plan(self, question: str) -> QueryPlan:
        """
        根据用户问题生成查询计划
        """
        intent = _detect_intent(question)
        stations = _extract_station_names(question)
        metric = _detect_metric_type(question)

        # 获取推荐的数据源
        recommended = datasource_registry.recommend_sources(intent)

        tasks: list[QueryTask] = []

        primary_station = stations[0] if stations else ""
        station_targets = stations or [""]

        # 如果是综合分析，为每个相关数据源生成任务
        if intent == QueryIntent.COMPREHENSIVE:
            # 1. 时序库任务（如果有指标或站名）
            if stations or metric:
                for station in station_targets:
                    tasks.append(QueryTask(
                        task_id=_build_task_id(),
                        intent=QueryIntent.HISTORY_TREND,
                        source=EvidenceSource.SCADA_HISTORY,
                        query_text=question,
                        entity_name=station,
                        metric_type=metric,
                        priority=5,
                        timeout_seconds=5,
                    ))
            # 2. 主业务库任务（拓扑/静态）
            for station in stations:
                tasks.append(QueryTask(
                    task_id=_build_task_id(),
                    intent=QueryIntent.TOPOLOGY_RELATION,
                    source=EvidenceSource.SMARTGAS_DB,
                    query_text=question,
                    entity_name=station,
                    metric_type=metric,
                    priority=4,
                    timeout_seconds=3,
                ))
            # 3. Excel索引库（别名、原始资料）
            for station in stations:
                tasks.append(QueryTask(
                    task_id=_build_task_id(),
                    intent=QueryIntent.STATIC_INFO,
                    source=EvidenceSource.RAW_EXCEL,
                    query_text=question,
                    entity_name=station,
                    metric_type=metric,
                    priority=2,
                    timeout_seconds=3,
                    fallback_sources=[EvidenceSource.SMARTGAS_DB],
                ))
            # 4. 规程库（如果有处置/建议类关键词）
            if any(kw in question for kw in ["怎么", "处理", "处置", "建议", "规程", "预案"]):
                tasks.append(QueryTask(
                    task_id=_build_task_id(),
                    intent=QueryIntent.EMERGENCY_GUIDE,
                    source=EvidenceSource.CHROMA_DB,
                    query_text=question,
                    entity_name=primary_station,
                    metric_type=metric,
                    priority=3,
                    timeout_seconds=5,
                ))
            # 5. 仿真库（如果有仿真相关词）
            if any(kw in question for kw in ["仿真", "模拟", "如果", "场景", "snapshot"]):
                tasks.append(QueryTask(
                    task_id=_build_task_id(),
                    intent=QueryIntent.SIMULATION_IMPACT,
                    source=EvidenceSource.SIMULATION,
                    query_text=question,
                    entity_name=primary_station,
                    metric_type=metric,
                    priority=3,
                    timeout_seconds=4,
                ))
        else:
            # 非综合分析：为每个推荐源生成一个任务
            for src in recommended:
                cap = datasource_registry.get_capability(src)
                if not cap:
                    continue
                tasks.append(QueryTask(
                    task_id=_build_task_id(),
                    intent=intent,
                    source=src,
                    query_text=question,
                    entity_name=primary_station,
                    metric_type=metric,
                    priority=cap.priority,
                    timeout_seconds=cap.timeout_seconds,
                    fallback_sources=cap.fallback_sources,
                ))

        return QueryPlan(
            plan_id=uuid.uuid4().hex[:16],
            original_question=question,
            primary_intent=intent,
            tasks=tasks,
        )


# 全局单例
query_planner = QueryPlanner()
