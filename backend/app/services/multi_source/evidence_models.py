"""
多库并行分析的统一数据模型
定义证据结构、查询计划、汇总结果等核心类型
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class EvidenceSource(str, Enum):
    """证据来源枚举"""
    SMARTGAS_DB = "smartgas_db"           # 主业务库：站场、管线、拓扑
    SCADA_HISTORY = "scada_history"       # 时序库：压力、温度、水露点
    RAW_EXCEL = "raw_excel"               # Excel索引库：原始资料、别名
    CHROMA_DB = "chroma_db"               # 向量知识库：规程、预案
    SIMULATION = "simulation"             # 仿真快照库


class QueryIntent(str, Enum):
    """查询意图分类"""
    STATIC_INFO = "static_info"           # 静态信息（站场属性、管线参数）
    HISTORY_TREND = "history_trend"       # 历史趋势（压力曲线、温度变化）
    TOPOLOGY_RELATION = "topology_relation"  # 拓扑关系（上下游、连通性）
    SIMULATION_IMPACT = "simulation_impact"  # 仿真影响（参数变化、结果对比）
    EMERGENCY_GUIDE = "emergency_guide"   # 应急处置（规程、预案、操作建议）
    COMPREHENSIVE = "comprehensive"       # 综合分析（多库交叉）


class EvidenceItem(BaseModel):
    """
    单条证据项
    每个数据源侦察代理返回的统一格式
    """
    source: EvidenceSource = Field(..., description="数据来源")
    query: str = Field(..., description="实际执行的查询描述")
    matched_entity: str = Field("", description="命中的实体名称（如站名、管线名）")
    metric: str = Field("", description="指标类型（如压力、温度、水露点）")
    time_window: str = Field("", description="时间窗口描述")
    value: str | float | int = Field("", description="关键数值")
    trend: str = Field("", description="趋势描述（上升/下降/持平/波动）")
    confidence: float = Field(0.85, ge=0.0, le=1.0, description="置信度 0~1")
    evidence_text: str = Field("", description="人可读的证据描述文本")
    missing_fields: list[str] = Field(default_factory=list, description="缺失的字段/维度")
    raw_data: dict[str, Any] = Field(default_factory=dict, description="原始数据，供下游使用")
    query_time_ms: int = Field(0, description="查询耗时（毫秒）")
    is_simulation: bool = Field(False, description="是否为仿真场景结果")


class QueryTask(BaseModel):
    """
    单个查询任务
    由 QueryPlanner 拆分生成
    """
    task_id: str = Field(..., description="任务唯一标识")
    intent: QueryIntent = Field(..., description="查询意图")
    source: EvidenceSource = Field(..., description="目标数据源")
    query_text: str = Field(..., description="查询文本")
    entity_name: str = Field("", description="关联的实体名称（如站名）")
    metric_type: str = Field("", description="指标类型")
    priority: int = Field(1, ge=1, le=5, description="优先级 1~5，数字越大越优先")
    timeout_seconds: int = Field(5, ge=1, le=30, description="超时时间（秒）")
    fallback_sources: list[EvidenceSource] = Field(default_factory=list, description="降级数据源")


class QueryPlan(BaseModel):
    """
    查询计划
    一次用户提问对应的完整查询方案
    """
    plan_id: str = Field(..., description="计划唯一标识")
    original_question: str = Field(..., description="用户原始问题")
    primary_intent: QueryIntent = Field(..., description="主意图")
    tasks: list[QueryTask] = Field(default_factory=list, description="并行任务列表")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AggregatedResult(BaseModel):
    """
    汇总结果
    结论汇总器的输出
    """
    conclusion: str = Field("", description="最终结论")
    evidence_list: list[EvidenceItem] = Field(default_factory=list, description="证据列表")
    conflict_warnings: list[str] = Field(default_factory=list, description="冲突提示")
    risk_level: str = Field("正常", description="风险等级（正常/低/中/高）")
    suggestions: list[str] = Field(default_factory=list, description="建议动作")
    data_sources: list[str] = Field(default_factory=list, description="涉及的数据源")
    missing_sources: list[str] = Field(default_factory=list, description="未命中/缺失的数据源")
    response_time_ms: int = Field(0, description="总响应时间（毫秒）")
    is_complete: bool = Field(True, description="是否完整回答")
    completeness_reason: str = Field("", description="完整性说明")


class ConflictItem(BaseModel):
    """
    冲突项
    交叉验证器发现的跨库不一致
    """
    conflict_type: str = Field(..., description="冲突类型（名称/数值/时间/单位/存在性）")
    source_a: EvidenceSource = Field(..., description="数据源A")
    source_b: EvidenceSource = Field(..., description="数据源B")
    entity: str = Field("", description="冲突涉及的实体")
    field: str = Field("", description="冲突字段")
    value_a: str = Field("", description="A源的值")
    value_b: str = Field("", description="B源的值")
    severity: str = Field("提示", description="严重程度（提示/警告/严重）")
    suggestion: str = Field("", description="处理建议")


class CrossValidationReport(BaseModel):
    """
    交叉验证报告
    """
    validated: bool = Field(True, description="是否通过验证")
    conflicts: list[ConflictItem] = Field(default_factory=list, description="冲突列表")
    name_normalization_map: dict[str, str] = Field(
        default_factory=dict, description="名称归一映射"
    )
    summary: str = Field("", description="验证摘要")
