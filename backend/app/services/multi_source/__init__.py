"""
多库并行交叉分析模块 (Multi-Source Parallel Cross-Analysis)

核心组件：
- DataSourceRegistry: 统一数据源注册表
- QueryPlanner: 查询意图拆分与并行调度
- EvidenceAggregator: 多源证据汇总与结论生成
- CrossValidator: 跨库交叉验证与冲突检测
"""

from .data_source_registry import DataSourceRegistry, SourceCapability, datasource_registry
from .evidence_models import (
    EvidenceItem,
    EvidenceSource,
    QueryPlan,
    QueryTask,
    AggregatedResult,
    CrossValidationReport,
    ConflictItem,
)
from .query_planner import QueryPlanner, query_planner
from .evidence_aggregator import EvidenceAggregator, evidence_aggregator
from .cross_validator import CrossValidator, cross_validator

__all__ = [
    "DataSourceRegistry",
    "SourceCapability",
    "datasource_registry",
    "EvidenceItem",
    "EvidenceSource",
    "QueryPlan",
    "QueryTask",
    "AggregatedResult",
    "CrossValidationReport",
    "ConflictItem",
    "QueryPlanner",
    "query_planner",
    "EvidenceAggregator",
    "evidence_aggregator",
    "CrossValidator",
    "cross_validator",
]
