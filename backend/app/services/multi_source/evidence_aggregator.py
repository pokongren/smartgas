"""
证据汇总器
接收多源证据 → 按规则判断优先级 → 生成最终结论
"""

from __future__ import annotations

import logging
from typing import Any

from .evidence_models import AggregatedResult, EvidenceItem, EvidenceSource

logger = logging.getLogger(__name__)


# 数据源可信度权重（实时/历史数据权重更高）
_SOURCE_WEIGHTS: dict[EvidenceSource, float] = {
    EvidenceSource.SCADA_HISTORY: 1.0,    # 实时/历史数据最优先
    EvidenceSource.SMARTGAS_DB: 0.9,       # 主业务库次之
    EvidenceSource.SIMULATION: 0.7,        # 仿真结果（需标注场景）
    EvidenceSource.RAW_EXCEL: 0.6,         # 静态资料
    EvidenceSource.CHROMA_DB: 0.5,         # 规程只提供处置依据
}

# 风险关键词映射
_RISK_KEYWORDS_HIGH = ["高", "异常", "超限", "故障", "泄漏", "中断", "紧急"]
_RISK_KEYWORDS_MEDIUM = ["偏大", "波动", "注意", "关注", "偏差"]
_RISK_KEYWORDS_LOW = ["低", "轻微", "可见", "偏小"]


class EvidenceAggregator:
    """
    证据汇总器
    规则：
    1. 实时/历史数据优先于静态资料
    2. 仿真结果必须标注"仿真场景"
    3. 规程库只提供处置依据，不提供现场事实
    4. 多个库冲突时必须输出"冲突提示"
    """

    def __init__(self):
        pass

    def aggregate(
        self,
        evidence_list: list[EvidenceItem],
        original_question: str = "",
        conflict_warnings: list[str] | None = None,
    ) -> AggregatedResult:
        """
        汇总多源证据，生成最终结论
        """
        if not evidence_list:
            return AggregatedResult(
                conclusion="未从任何数据源获取到有效证据，无法得出结论。",
                evidence_list=[],
                is_complete=False,
                completeness_reason="所有数据源查询均未返回结果",
            )

        # 1. 按可信度排序
        sorted_evidence = sorted(
            evidence_list,
            key=lambda e: (_SOURCE_WEIGHTS.get(e.source, 0.5), e.confidence),
            reverse=True,
        )

        # 2. 分离仿真证据（需特殊标注）
        sim_evidence = [e for e in sorted_evidence if e.is_simulation]
        real_evidence = [e for e in sorted_evidence if not e.is_simulation]

        # 3. 构建结论段落
        conclusion_parts: list[str] = []
        suggestions: list[str] = []
        data_sources: list[str] = []
        missing_sources: list[str] = []

        # 3.1 实时/历史数据结论（最高优先级）
        scada_items = [e for e in real_evidence if e.source == EvidenceSource.SCADA_HISTORY]
        if scada_items:
            for best in scada_items:
                if best.evidence_text and best.confidence >= 0.5:
                    conclusion_parts.append(best.evidence_text)
            data_sources.append("时序库(SCADA)")
            for best in scada_items:
                if best.trend in ["上升", "下降"] and best.confidence > 0.8:
                    suggestions.append(f"关注 {best.matched_entity} 的{best.metric}趋势变化")
        else:
            missing_sources.append("时序库")

        # 3.2 拓扑/静态信息
        static_items = [e for e in real_evidence if e.source in {
            EvidenceSource.SMARTGAS_DB, EvidenceSource.RAW_EXCEL
        }]
        if static_items:
            for item in static_items[:2]:
                if item.evidence_text and item.confidence > 0.5:
                    conclusion_parts.append(item.evidence_text)
            if any(item.source == EvidenceSource.SMARTGAS_DB for item in static_items):
                data_sources.append("主业务库")
            if any(item.source == EvidenceSource.RAW_EXCEL for item in static_items):
                data_sources.append("Excel索引库")
        else:
            if any(e.source == EvidenceSource.SMARTGAS_DB for e in evidence_list):
                missing_sources.append("主业务库")

        # 3.3 规程依据（只作为建议，不下事实结论）
        reg_items = [e for e in evidence_list if e.source == EvidenceSource.CHROMA_DB]
        if reg_items:
            best_reg = max(reg_items, key=lambda e: e.confidence)
            if best_reg.confidence > 0.5:
                suggestions.append(f"规程依据：{best_reg.evidence_text[:100]}")
            data_sources.append("规程向量库")
        else:
            if any(kw in original_question for kw in ["怎么", "处理", "处置", "建议", "规程", "预案", "应急"]):
                missing_sources.append("规程向量库")

        # 3.4 仿真结果（必须标注）
        if sim_evidence:
            for sim in sim_evidence[:1]:
                conclusion_parts.append(f"【仿真场景】{sim.evidence_text}")
            data_sources.append("仿真快照库")
        else:
            if "仿真" in original_question or "模拟" in original_question:
                missing_sources.append("仿真快照库")

        # 4. 风险等级判断
        all_text = " ".join(conclusion_parts)
        risk_level = self._judge_risk_level(all_text)

        # 5. 组装最终结论
        if conclusion_parts:
            conclusion = "；".join(conclusion_parts)
        else:
            conclusion = "各数据源返回的信息不足以形成明确结论。"
            is_complete = False
            completeness_reason = "证据置信度均低于阈值"

        # 6. 完整性判断
        unresolved_required = [
            e for e in evidence_list
            if e.source in {EvidenceSource.SCADA_HISTORY, EvidenceSource.SMARTGAS_DB}
            and e.confidence <= 0.3
            and e.missing_fields
        ]
        if any(kw in original_question for kw in ["仿真", "模拟", "场景", "可信", "验证"]):
            unresolved_required.extend(
                e for e in evidence_list
                if e.source == EvidenceSource.SIMULATION
                and e.confidence <= 0.5
                and e.missing_fields
            )
        is_complete = len(real_evidence) >= 1 and any(
            e.confidence > 0.6 for e in real_evidence
        ) and not unresolved_required
        completeness_reason = ""
        if not is_complete:
            missing_entities = [
                f"{e.source.value}:{e.matched_entity or '未识别对象'}"
                for e in unresolved_required
            ]
            reason_parts = []
            if missing_sources:
                reason_parts.append(f"缺失来源：{', '.join(missing_sources)}")
            if missing_entities:
                reason_parts.append(f"未命中对象：{', '.join(missing_entities)}")
            completeness_reason = "；".join(reason_parts) if reason_parts else "有效证据不足"
        else:
            completeness_reason = "已基于多源证据形成结论"

        # 去重数据源
        data_sources = list(dict.fromkeys(data_sources))
        missing_sources = list(dict.fromkeys(missing_sources))

        return AggregatedResult(
            conclusion=conclusion,
            evidence_list=sorted_evidence,
            conflict_warnings=conflict_warnings or [],
            risk_level=risk_level,
            suggestions=suggestions,
            data_sources=data_sources,
            missing_sources=missing_sources,
            is_complete=is_complete,
            completeness_reason=completeness_reason,
        )

    def _judge_risk_level(self, text: str) -> str:
        """根据文本判断风险等级"""
        text_lower = text.lower()
        high_score = sum(1 for kw in _RISK_KEYWORDS_HIGH if kw in text_lower)
        medium_score = sum(1 for kw in _RISK_KEYWORDS_MEDIUM if kw in text_lower)
        low_score = sum(1 for kw in _RISK_KEYWORDS_LOW if kw in text_lower)

        if high_score > 0:
            return "高"
        if medium_score > 0:
            return "中"
        if low_score > 0:
            return "低"
        return "正常"


# 全局单例
evidence_aggregator = EvidenceAggregator()
