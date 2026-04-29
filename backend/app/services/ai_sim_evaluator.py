from __future__ import annotations

from typing import Any, Dict, Optional


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number == number else fallback


def _severity_level(score: int, alert_count: int, solver_status: str) -> str:
    if solver_status == "error":
        return "critical"
    if score < 45 or alert_count >= 5:
        return "critical"
    if score < 75 or alert_count > 0 or solver_status == "max_iter":
        return "warning"
    return "normal"


def _score_summary(result: Dict[str, Any]) -> tuple[int, list[str], list[str]]:
    summary = result.get("summary") or {}
    nodes = [item for item in result.get("nodes", []) if isinstance(item, dict)]
    edges = [item for item in result.get("edges", []) if isinstance(item, dict)]

    score = 100
    findings: list[str] = []
    risks: list[str] = []

    solver_status = str(result.get("solver_status") or "converged")
    alert_count = int(summary.get("alert_count") or 0)
    avg_utilization = _safe_float(summary.get("avg_utilization"))
    total_supply = _safe_float(summary.get("total_supply"))
    total_demand = _safe_float(summary.get("total_demand"))
    unserved_demand = _safe_float(summary.get("unserved_demand"))

    if solver_status == "error":
        score -= 40
        findings.append("求解失败，结果不适合直接用于答辩或调度判断。")
    elif solver_status == "max_iter":
        score -= 15
        findings.append("求解达到了迭代上限，结果可看，但稳定性需要再核一下。")

    if alert_count > 0:
        score -= min(25, alert_count * 5)
        findings.append(f"当前共有 {alert_count} 个告警点，说明结果不是完全平稳。")

    if avg_utilization >= 0.92:
        score -= 18
        risks.append(f"平均利用率达到 {avg_utilization * 100:.1f}%，主干负荷偏紧。")
    elif avg_utilization >= 0.82:
        score -= 8
        findings.append(f"平均利用率 {avg_utilization * 100:.1f}%，已经开始往高位走。")

    if total_demand > 0:
        shortage_ratio = unserved_demand / total_demand
        if shortage_ratio > 0.08:
            score -= 18
            risks.append(f"未满足需求占比 {shortage_ratio * 100:.1f}%，供需缺口比较明显。")
        elif shortage_ratio > 0:
            score -= 8
            findings.append(f"还有 {unserved_demand:.1f} 万方/天未满足，需要关注供给裕度。")

    critical_nodes = sorted(
        [node for node in nodes if str(node.get("alert_level") or "normal") == "critical"],
        key=lambda item: _safe_float(item.get("pressure_mpa")),
    )
    warning_nodes = sorted(
        [node for node in nodes if str(node.get("alert_level") or "normal") == "warning"],
        key=lambda item: _safe_float(item.get("pressure_mpa")),
    )
    critical_edges = sorted(
        [edge for edge in edges if str(edge.get("alert_level") or "normal") == "critical"],
        key=lambda item: _safe_float(item.get("utilization")),
        reverse=True,
    )

    if critical_nodes:
        risks.append("低压告警站点：" + "、".join(str(node.get("id") or "") for node in critical_nodes[:3]))
    if critical_edges:
        risks.append("高负荷管段：" + "、".join(str(edge.get("id") or "") for edge in critical_edges[:3]))
    elif warning_nodes:
        findings.append("存在少量预警站点，建议把这些点先盯紧。")

    score = max(0, min(100, score))
    return score, findings, risks


def _compare_overlays(current: Dict[str, Any], baseline: Dict[str, Any]) -> Dict[str, Any]:
    current_summary = current.get("summary") or {}
    baseline_summary = baseline.get("summary") or {}

    comparison = {
        "summary_delta": {
            "total_supply": _safe_float(current_summary.get("total_supply")) - _safe_float(baseline_summary.get("total_supply")),
            "total_demand": _safe_float(current_summary.get("total_demand")) - _safe_float(baseline_summary.get("total_demand")),
            "unserved_demand": _safe_float(current_summary.get("unserved_demand")) - _safe_float(baseline_summary.get("unserved_demand")),
            "avg_utilization": _safe_float(current_summary.get("avg_utilization")) - _safe_float(baseline_summary.get("avg_utilization")),
            "alert_count": int(current_summary.get("alert_count") or 0) - int(baseline_summary.get("alert_count") or 0),
        },
        "top_node_pressure_changes": [],
        "top_edge_flow_changes": [],
    }

    current_nodes = {str(item.get("id") or ""): item for item in current.get("nodes", []) if isinstance(item, dict)}
    baseline_nodes = {str(item.get("id") or ""): item for item in baseline.get("nodes", []) if isinstance(item, dict)}
    node_changes = []
    for node_id, current_node in current_nodes.items():
        baseline_node = baseline_nodes.get(node_id)
        if not baseline_node:
            continue
        current_pressure = _safe_float(current_node.get("pressure_mpa"))
        baseline_pressure = _safe_float(baseline_node.get("pressure_mpa"))
        node_changes.append(
            {
                "id": node_id,
                "current_pressure_mpa": round(current_pressure, 4),
                "baseline_pressure_mpa": round(baseline_pressure, 4),
                "delta_pressure_mpa": round(current_pressure - baseline_pressure, 4),
            }
        )
    node_changes.sort(key=lambda item: abs(_safe_float(item.get("delta_pressure_mpa"))), reverse=True)
    comparison["top_node_pressure_changes"] = node_changes[:5]

    current_edges = {str(item.get("id") or ""): item for item in current.get("edges", []) if isinstance(item, dict)}
    baseline_edges = {str(item.get("id") or ""): item for item in baseline.get("edges", []) if isinstance(item, dict)}
    edge_changes = []
    for edge_id, current_edge in current_edges.items():
        baseline_edge = baseline_edges.get(edge_id)
        if not baseline_edge:
            continue
        current_flow = _safe_float(current_edge.get("flow_rate"))
        baseline_flow = _safe_float(baseline_edge.get("flow_rate"))
        edge_changes.append(
            {
                "id": edge_id,
                "current_flow_rate": round(current_flow, 4),
                "baseline_flow_rate": round(baseline_flow, 4),
                "delta_flow_rate": round(current_flow - baseline_flow, 4),
            }
        )
    edge_changes.sort(key=lambda item: abs(_safe_float(item.get("delta_flow_rate"))), reverse=True)
    comparison["top_edge_flow_changes"] = edge_changes[:5]
    return comparison


def evaluate_simulation_result(
    result: Dict[str, Any],
    baseline_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    score, findings, risks = _score_summary(result)
    summary = result.get("summary") or {}
    alert_count = int(summary.get("alert_count") or 0)
    solver_status = str(result.get("solver_status") or "converged")
    level = _severity_level(score, alert_count, solver_status)

    recommendations: list[str] = []
    if summary.get("unserved_demand", 0) and _safe_float(summary.get("unserved_demand")) > 0:
        recommendations.append("优先补供给缺口，先看主干压气站和高负荷管段。")
    if _safe_float(summary.get("avg_utilization")) >= 0.85:
        recommendations.append("把高利用率管段先做限流或分流预案，别等它顶到红线。")
    if alert_count > 0:
        recommendations.append("把告警站点逐个抽查，先看进出站压力，再看是否有断流或限流。")
    if not recommendations:
        recommendations.append("当前结果比较平稳，可以把这次结果作为基线对照继续观察。")

    headline = {
        "normal": "这次仿真整体还算稳，能拿来做答辩展示。",
        "warning": "这次仿真能用，但已经有几个点开始冒头了。",
        "critical": "这次结果已经偏紧，答辩时要重点说明风险点。",
    }[level]

    comparison = _compare_overlays(result, baseline_result) if baseline_result else None

    text_lines = [
        f"结论：{headline}",
        f"评分：{score}/100，风险等级：{level}",
        f"求解状态：{solver_status}，告警数：{alert_count}",
    ]
    if findings:
        text_lines.append("关键发现：")
        text_lines.extend([f"  1. {item}" for item in findings[:4]])
    if risks:
        text_lines.append("风险点：")
        text_lines.extend([f"  1. {item}" for item in risks[:4]])
    text_lines.append("建议：")
    text_lines.extend([f"  1. {item}" for item in recommendations[:3]])

    if comparison:
        delta = comparison["summary_delta"]
        text_lines.append("和基线比：")
        text_lines.append(
            f"  1. 总供气变化 {delta['total_supply']:+.2f}，未满足需求变化 {delta['unserved_demand']:+.2f}，平均利用率变化 {delta['avg_utilization'] * 100:+.1f}%"
        )

    return {
        "score": score,
        "level": level,
        "headline": headline,
        "findings": findings,
        "risks": risks,
        "recommendations": recommendations,
        "comparison": comparison,
        "text": "\n".join(text_lines),
    }


def evaluate_simulation_result_text(
    result: Dict[str, Any],
    baseline_result: Optional[Dict[str, Any]] = None,
) -> str:
    return evaluate_simulation_result(result, baseline_result).get("text", "")
