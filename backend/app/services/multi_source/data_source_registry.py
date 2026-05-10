"""
统一数据源注册表
登记每个库的能力、优先级、失败降级策略
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine

from .evidence_models import EvidenceItem, EvidenceSource, QueryIntent

logger = logging.getLogger(__name__)


@dataclass
class SourceCapability:
    """数据源能力描述"""
    source: EvidenceSource
    name: str                              # 人类可读名称
    description: str                       # 能力描述
    supported_intents: list[QueryIntent]   # 支持的查询意图
    priority: int = 3                      # 优先级 1~5
    timeout_seconds: int = 5               # 默认超时
    fallback_sources: list[EvidenceSource] = field(default_factory=list)


# 内置数据源能力定义
_BUILTIN_CAPABILITIES: list[SourceCapability] = [
    SourceCapability(
        source=EvidenceSource.SMARTGAS_DB,
        name="主业务库",
        description="站场、管线、拓扑基础信息、节点边关系",
        supported_intents=[
            QueryIntent.STATIC_INFO,
            QueryIntent.TOPOLOGY_RELATION,
            QueryIntent.COMPREHENSIVE,
        ],
        priority=4,
        timeout_seconds=3,
        fallback_sources=[EvidenceSource.RAW_EXCEL],
    ),
    SourceCapability(
        source=EvidenceSource.SCADA_HISTORY,
        name="时序库",
        description="压力、温度、水露点、硫化氢等历史数据",
        supported_intents=[
            QueryIntent.HISTORY_TREND,
            QueryIntent.COMPREHENSIVE,
        ],
        priority=5,
        timeout_seconds=5,
        fallback_sources=[],
    ),
    SourceCapability(
        source=EvidenceSource.RAW_EXCEL,
        name="Excel索引库",
        description="原始资料整理出的站场、管线、分输口、压气站静态资料",
        supported_intents=[
            QueryIntent.STATIC_INFO,
            QueryIntent.COMPREHENSIVE,
        ],
        priority=2,
        timeout_seconds=3,
        fallback_sources=[EvidenceSource.SMARTGAS_DB],
    ),
    SourceCapability(
        source=EvidenceSource.CHROMA_DB,
        name="规程向量库",
        description="规程、预案、说明文档、应急处置知识",
        supported_intents=[
            QueryIntent.EMERGENCY_GUIDE,
            QueryIntent.COMPREHENSIVE,
        ],
        priority=3,
        timeout_seconds=5,
        fallback_sources=[],
    ),
    SourceCapability(
        source=EvidenceSource.SIMULATION,
        name="仿真快照库",
        description="仿真前、仿真中、仿真后压力流量结果",
        supported_intents=[
            QueryIntent.SIMULATION_IMPACT,
            QueryIntent.COMPREHENSIVE,
        ],
        priority=3,
        timeout_seconds=4,
        fallback_sources=[],
    ),
]


# 查询意图 → 推荐数据源映射
_INTENT_SOURCE_MAP: dict[QueryIntent, list[EvidenceSource]] = {
    QueryIntent.STATIC_INFO: [
        EvidenceSource.SMARTGAS_DB,
        EvidenceSource.RAW_EXCEL,
    ],
    QueryIntent.HISTORY_TREND: [
        EvidenceSource.SCADA_HISTORY,
    ],
    QueryIntent.TOPOLOGY_RELATION: [
        EvidenceSource.SMARTGAS_DB,
    ],
    QueryIntent.SIMULATION_IMPACT: [
        EvidenceSource.SIMULATION,
        EvidenceSource.SMARTGAS_DB,
    ],
    QueryIntent.EMERGENCY_GUIDE: [
        EvidenceSource.CHROMA_DB,
    ],
    QueryIntent.COMPREHENSIVE: [
        EvidenceSource.SCADA_HISTORY,
        EvidenceSource.SMARTGAS_DB,
        EvidenceSource.SIMULATION,
        EvidenceSource.CHROMA_DB,
        EvidenceSource.RAW_EXCEL,
    ],
}


class DataSourceRegistry:
    """
    数据源注册表
    负责：
    1. 登记/查询每个库的能力
    2. 根据意图推荐数据源
    3. 管理查询执行器（异步函数）
    """

    def __init__(self):
        self._capabilities: dict[EvidenceSource, SourceCapability] = {
            cap.source: cap for cap in _BUILTIN_CAPABILITIES
        }
        self._executors: dict[
            EvidenceSource,
            Callable[..., Coroutine[Any, Any, EvidenceItem | None]],
        ] = {}

    def register_executor(
        self,
        source: EvidenceSource,
        executor: Callable[..., Coroutine[Any, Any, EvidenceItem | None]],
    ) -> None:
        """注册某个数据源的异步查询执行器"""
        self._executors[source] = executor
        logger.info("Registered executor for %s", source.value)

    def get_capability(self, source: EvidenceSource) -> SourceCapability | None:
        return self._capabilities.get(source)

    def list_sources(self) -> list[EvidenceSource]:
        return list(self._capabilities.keys())

    def recommend_sources(self, intent: QueryIntent) -> list[EvidenceSource]:
        """根据意图推荐数据源（按优先级排序）"""
        sources = _INTENT_SOURCE_MAP.get(intent, [])
        # 按优先级降序排列
        return sorted(
            sources,
            key=lambda s: self._capabilities.get(s, SourceCapability(s, "", "", [])).priority,
            reverse=True,
        )

    def get_executor(
        self, source: EvidenceSource
    ) -> Callable[..., Coroutine[Any, Any, EvidenceItem | None]] | None:
        return self._executors.get(source)

    def get_timeout(self, source: EvidenceSource) -> int:
        cap = self._capabilities.get(source)
        return cap.timeout_seconds if cap else 5

    def get_fallback_sources(self, source: EvidenceSource) -> list[EvidenceSource]:
        cap = self._capabilities.get(source)
        return cap.fallback_sources if cap else []

    def can_handle(self, source: EvidenceSource, intent: QueryIntent) -> bool:
        cap = self._capabilities.get(source)
        if not cap:
            return False
        return intent in cap.supported_intents


# 全局单例
datasource_registry = DataSourceRegistry()
