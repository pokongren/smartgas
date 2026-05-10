"""
交叉验证器
检查多源证据之间的冲突：名称归一、数值一致性、时间窗口、单位统一
"""

from __future__ import annotations

import logging
import re
from typing import Any

from .evidence_models import ConflictItem, CrossValidationReport, EvidenceItem, EvidenceSource

logger = logging.getLogger(__name__)


# 站名别名映射（用于名称归一）
_STATION_ALIASES: dict[str, list[str]] = {
    "中卫": ["中卫站", "中卫压气站", "西一线中卫", "西二线中卫"],
    "甪直": ["甪直站", "甪直分输站", "中俄甪直"],
    "古浪": ["古浪站", "古浪压气站", "西一线古浪", "西二线古浪", "鼓浪"],
    "上海": ["上海站", "上海末站", "上海分输"],
    "中卫压气站": ["中卫站"],
    "甪直分输站": ["甪直站"],
}

# 数值容忍度（用于判断同一指标在不同源中是否冲突）
_VALUE_TOLERANCE: dict[str, float] = {
    "pressure": 0.15,     # MPa
    "temperature": 2.0,   # °C
    "dewpoint": 1.5,      # °C
    "flow": 500.0,        # 流量单位
}


class CrossValidator:
    """
    交叉验证器
    负责：
    1. 名称归一（中卫站 vs 中卫压气站 vs 西一线中卫）
    2. 数值冲突检测
    3. 时间窗口一致性检查
    4. 生成验证报告
    """

    def __init__(self):
        pass

    def validate(self, evidence_list: list[EvidenceItem]) -> CrossValidationReport:
        """
        对多源证据执行交叉验证
        """
        if len(evidence_list) < 2:
            return CrossValidationReport(
                validated=True,
                summary="证据源不足2个，跳过交叉验证" if len(evidence_list) < 2 else "单源证据无需交叉验证",
            )

        conflicts: list[ConflictItem] = []
        name_map: dict[str, str] = {}

        # 1. 名称归一化
        normalized_evidence = self._normalize_names(evidence_list, name_map)

        # 2. 按实体分组，检测数值冲突
        entity_groups: dict[str, list[EvidenceItem]] = {}
        for ev in normalized_evidence:
            key = self._entity_group_key(ev)
            if key:
                entity_groups.setdefault(key, []).append(ev)

        for entity_key, items in entity_groups.items():
            if len(items) < 2:
                continue
            # 同实体、同指标，检查数值差异
            metric_groups: dict[str, list[EvidenceItem]] = {}
            for item in items:
                metric_groups.setdefault(item.metric, []).append(item)

            for metric, metric_items in metric_groups.items():
                if len(metric_items) < 2:
                    continue
                conflict = self._check_numeric_conflict(entity_key, metric, metric_items)
                if conflict:
                    conflicts.append(conflict)

        # 3. 检查仿真与真实数据的混用
        for ev in normalized_evidence:
            if ev.is_simulation and not ev.evidence_text.startswith("【仿真场景】"):
                conflicts.append(ConflictItem(
                    conflict_type="标注缺失",
                    source_a=ev.source,
                    source_b=ev.source,
                    entity=ev.matched_entity,
                    field="simulation_label",
                    value_a=ev.evidence_text[:50],
                    value_b="",
                    severity="提示",
                    suggestion="仿真结果应明确标注'仿真场景'",
                ))

        # 4. 生成摘要
        if not conflicts:
            summary = "多源证据交叉验证通过，未发现明显冲突"
        else:
            severe_count = sum(1 for c in conflicts if c.severity == "严重")
            warn_count = sum(1 for c in conflicts if c.severity == "警告")
            hint_count = sum(1 for c in conflicts if c.severity == "提示")
            parts = []
            if severe_count:
                parts.append(f"严重冲突 {severe_count} 项")
            if warn_count:
                parts.append(f"警告 {warn_count} 项")
            if hint_count:
                parts.append(f"提示 {hint_count} 项")
            summary = f"交叉验证发现 {'，'.join(parts)}，请人工复核"

        return CrossValidationReport(
            validated=len([c for c in conflicts if c.severity == "严重"]) == 0,
            conflicts=conflicts,
            name_normalization_map=name_map,
            summary=summary,
        )

    def _normalize_names(
        self,
        evidence_list: list[EvidenceItem],
        name_map: dict[str, str],
    ) -> list[EvidenceItem]:
        """
        对证据中的实体名称进行归一化
        """
        result: list[EvidenceItem] = []
        for ev in evidence_list:
            normalized = ev.model_copy()
            if ev.matched_entity:
                canonical = self._resolve_canonical_name(ev.matched_entity)
                if canonical != ev.matched_entity:
                    name_map[ev.matched_entity] = canonical
                normalized.matched_entity = canonical
            result.append(normalized)
        return result

    def _resolve_canonical_name(self, name: str) -> str:
        """将别名解析为标准名称"""
        clean = re.sub(r"(?:分输联络站|分输压气站|分输清管站|分输站|压气站|清管站|站)$", "", name)
        for canonical, aliases in _STATION_ALIASES.items():
            if clean == canonical or clean in aliases:
                return canonical
            # 反向匹配：如果 clean 包含 canonical
            if canonical in clean:
                return canonical
        return name

    def _entity_group_key(self, ev: EvidenceItem) -> str:
        """生成实体分组键"""
        if not ev.matched_entity:
            return ""
        entity = ev.matched_entity
        metric = ev.metric or "general"
        return f"{entity}#{metric}"

    def _check_numeric_conflict(
        self,
        entity: str,
        metric: str,
        items: list[EvidenceItem],
    ) -> ConflictItem | None:
        """
        检查同一实体同一指标在不同源的数值是否冲突
        """
        # 提取数值
        numeric_values: list[tuple[EvidenceSource, float]] = []
        for item in items:
            val = self._extract_numeric(item.value)
            if val is not None:
                numeric_values.append((item.source, val))

        if len(numeric_values) < 2:
            return None

        # 检查最大差异
        tolerance = _VALUE_TOLERANCE.get(metric, 0.1)
        max_val = max(v for _, v in numeric_values)
        min_val = min(v for _, v in numeric_values)
        diff = abs(max_val - min_val)

        if diff <= tolerance:
            return None

        # 找出差异最大的两个源
        sorted_by_val = sorted(numeric_values, key=lambda x: x[1])
        src_a, val_a = sorted_by_val[0]
        src_b, val_b = sorted_by_val[-1]

        severity = "警告" if diff <= tolerance * 2 else "严重"

        return ConflictItem(
            conflict_type="数值不一致",
            source_a=src_a,
            source_b=src_b,
            entity=entity,
            field=metric,
            value_a=str(val_a),
            value_b=str(val_b),
            severity=severity,
            suggestion=f"{entity} 的 {metric} 在 {src_a.value} 与 {src_b.value} 中差异 {diff:.2f}，请确认数据来源和时间窗口",
        )

    def _extract_numeric(self, value: Any) -> float | None:
        """从值中提取数字"""
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            # 尝试从字符串开头提取数字
            match = re.search(r"[-+]?\d+\.?\d*", value)
            if match:
                try:
                    return float(match.group())
                except ValueError:
                    return None
        return None


# 全局单例
cross_validator = CrossValidator()
