"""
多库查询执行器集成
将现有的各个服务封装为统一的异步查询函数
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import func
from sqlmodel import Session, select

from app.database import get_session, scada_history_engine
from app.models import Pipeline, Station
from app.scada_models import ScadaHistory
from app.services.raw_excel_ai_index import raw_excel_ai_index
from app.services.topology import TopologyService
from app.services.we1_result_snapshot_service import get_snapshot, list_snapshots

_rag_service_instance = None

def _get_rag_service():
    global _rag_service_instance
    if _rag_service_instance is None:
        from app.services.rag_enhanced import EnhancedRAGService
        _rag_service_instance = EnhancedRAGService()
    return _rag_service_instance

from .evidence_models import EvidenceItem, EvidenceSource

logger = logging.getLogger(__name__)


def _fmt_optional(value: Any, unit: str = "") -> str:
    if value in (None, ""):
        return "未知"
    return f"{value}{unit}"


async def query_smartgas_db(
    query_text: str,
    entity_name: str = "",
    metric_type: str = "",
    **kwargs: Any,
) -> EvidenceItem | None:
    """
    查询主业务库（smartgas.db）
    返回站场、管线、拓扑信息
    """
    start_time = __import__("time").time()
    try:
        with next(get_session()) as session:
            # 1. 站场查询
            stations = []
            if entity_name:
                stmt = select(Station).where(
                    Station.name.contains(entity_name)
                )
                stations = session.exec(stmt).all()

            # 2. 管线查询
            pipelines = []
            if entity_name:
                stmt_pipe = select(Pipeline).where(
                    Pipeline.name.contains(entity_name)
                )
                pipelines = session.exec(stmt_pipe).all()

            # 3. 如果没有指定实体，返回拓扑概览；指定了实体但没命中时，不能用概览冒充命中证据。
            if not stations and not pipelines:
                if entity_name:
                    return EvidenceItem(
                        source=EvidenceSource.SMARTGAS_DB,
                        query=query_text,
                        matched_entity=entity_name,
                        metric=metric_type or "station_info",
                        confidence=0.35,
                        evidence_text=f"主业务库未找到 {entity_name} 的站场或管线记录",
                        missing_fields=["station_detail", "pipeline_detail"],
                        query_time_ms=int((__import__("time").time() - start_time) * 1000),
                    )

                total_stations = session.exec(
                    select(func.count()).select_from(Station)
                ).one()
                total_pipelines = session.exec(
                    select(func.count()).select_from(Pipeline)
                ).one()
                evidence_text = (
                    f"主业务库概览：当前共 {total_stations} 个站场，"
                    f"{total_pipelines} 条管线。"
                )
                return EvidenceItem(
                    source=EvidenceSource.SMARTGAS_DB,
                    query=query_text,
                    matched_entity="",
                    metric="topology_summary",
                    value=f"stations={total_stations}, pipelines={total_pipelines}",
                    confidence=0.95,
                    evidence_text=evidence_text,
                    query_time_ms=int((__import__("time").time() - start_time) * 1000),
                )

            # 构建详细证据
            parts = []
            for s in stations[:3]:
                parts.append(f"站场 {s.name}（类型:{s.type or '未知'}）")
            for p in pipelines[:3]:
                parts.append(f"管线 {p.name}（类别:{p.category or '未知'}）")

            return EvidenceItem(
                source=EvidenceSource.SMARTGAS_DB,
                query=query_text,
                matched_entity=entity_name,
                metric=metric_type or "station_info",
                value=len(stations) + len(pipelines),
                confidence=0.9 if (stations or pipelines) else 0.5,
                evidence_text="；".join(parts) if parts else f"未在主业务库找到 {entity_name} 的详细信息",
                missing_fields=[] if (stations or pipelines) else ["station_detail", "pipeline_detail"],
                query_time_ms=int((__import__("time").time() - start_time) * 1000),
            )
    except Exception as exc:
        logger.warning("smartgas_db query failed: %s", exc)
        return EvidenceItem(
            source=EvidenceSource.SMARTGAS_DB,
            query=query_text,
            matched_entity=entity_name,
            confidence=0.0,
            evidence_text=f"主业务库查询失败：{exc}",
            missing_fields=["all"],
            query_time_ms=int((__import__("time").time() - start_time) * 1000),
        )


async def query_scada_history(
    query_text: str,
    entity_name: str = "",
    metric_type: str = "",
    **kwargs: Any,
) -> EvidenceItem | None:
    """
    查询时序库（scada_history.db）
    返回压力、温度、水露点等历史数据摘要
    """
    start_time = __import__("time").time()
    try:
        with Session(scada_history_engine) as session:
            # 1. 查找可用站名（模糊匹配）
            available_rows = session.exec(
                select(ScadaHistory.station_name).distinct()
            ).all()
            available_names = sorted({str(n).strip() for n in available_rows if n})

            resolved_station = ""
            if entity_name and available_names:
                # 简单模糊匹配
                for name in available_names:
                    if entity_name in name or name in entity_name:
                        resolved_station = name
                        break
                if not resolved_station:
                    # 尝试去掉后缀匹配
                    clean = entity_name.replace("站", "").replace("分输", "").replace("压气", "")
                    for name in available_names:
                        if clean in name:
                            resolved_station = name
                            break

            if not resolved_station:
                return EvidenceItem(
                    source=EvidenceSource.SCADA_HISTORY,
                    query=query_text,
                    matched_entity=entity_name,
                    confidence=0.3,
                    evidence_text=f"时序库中未找到 {entity_name} 的匹配记录",
                    missing_fields=["station_match"],
                    query_time_ms=int((__import__("time").time() - start_time) * 1000),
                )

            # 2. 确定指标类型
            db_metric = metric_type or "pressure"
            if db_metric == "dewpoint":
                db_metric = "dewpoint"
            elif db_metric == "temperature":
                db_metric = "temperature"
            else:
                db_metric = "pressure"

            # 3. 查询最近24小时数据
            from datetime import datetime, timedelta, timezone
            cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

            rows = session.exec(
                select(ScadaHistory)
                .where(
                    ScadaHistory.station_name == resolved_station,
                    ScadaHistory.metric_type == db_metric,
                    ScadaHistory.recorded_at >= cutoff,
                )
                .order_by(ScadaHistory.recorded_at)
            ).all()

            if not rows:
                return EvidenceItem(
                    source=EvidenceSource.SCADA_HISTORY,
                    query=query_text,
                    matched_entity=resolved_station,
                    metric=db_metric,
                    confidence=0.5,
                    evidence_text=f"{resolved_station} 最近24小时无 {db_metric} 数据",
                    missing_fields=["recent_data"],
                    query_time_ms=int((__import__("time").time() - start_time) * 1000),
                )

            values = [float(r.value) for r in rows]
            latest = values[-1]
            earliest = values[0]
            min_v = min(values)
            max_v = max(values)
            avg_v = sum(values) / len(values)
            delta = latest - earliest

            trend = "基本持平"
            if delta > 0.05:
                trend = "上升"
            elif delta < -0.05:
                trend = "下降"

            unit = rows[0].unit or ""
            evidence_text = (
                f"{resolved_station} 最近24小时{db_metric}数据："
                f"当前 {latest:.2f}{unit}，"
                f"区间 {min_v:.2f}~{max_v:.2f}{unit}，"
                f"均值 {avg_v:.2f}{unit}，"
                f"较24小时前{trend} {abs(delta):.2f}{unit}"
            )

            return EvidenceItem(
                source=EvidenceSource.SCADA_HISTORY,
                query=query_text,
                matched_entity=resolved_station,
                metric=db_metric,
                time_window="最近24小时",
                value=round(latest, 4),
                trend=trend,
                confidence=0.92,
                evidence_text=evidence_text,
                raw_data={
                    "count": len(values),
                    "min": round(min_v, 4),
                    "max": round(max_v, 4),
                    "avg": round(avg_v, 4),
                    "delta": round(delta, 4),
                },
                query_time_ms=int((__import__("time").time() - start_time) * 1000),
            )
    except Exception as exc:
        logger.warning("scada_history query failed: %s", exc)
        return EvidenceItem(
            source=EvidenceSource.SCADA_HISTORY,
            query=query_text,
            matched_entity=entity_name,
            confidence=0.0,
            evidence_text=f"时序库查询失败：{exc}",
            missing_fields=["all"],
            query_time_ms=int((__import__("time").time() - start_time) * 1000),
        )


async def query_raw_excel(
    query_text: str,
    entity_name: str = "",
    metric_type: str = "",
    **kwargs: Any,
) -> EvidenceItem | None:
    """
    查询Excel索引库
    返回原始资料中的站场、管线静态信息
    """
    start_time = __import__("time").time()
    try:
        hits: list[dict[str, Any]] = []
        if entity_name:
            station_hits = raw_excel_ai_index.find_station_candidates(entity_name, limit=3)
            pipeline_hits = raw_excel_ai_index.find_pipeline_candidates(entity_name, limit=2)
            hits = [
                {"evidence_kind": "station", **item}
                for item in station_hits
            ] + [
                {"evidence_kind": "pipeline", **item}
                for item in pipeline_hits
            ]
        else:
            scope = raw_excel_ai_index.match_scope(query_text)
            if scope:
                hits.append({"evidence_kind": "scope", **scope})
            station_hits = raw_excel_ai_index.query_stations(keyword=query_text)[:3]
            pipeline_hits = raw_excel_ai_index.query_pipelines(keyword=query_text)[:2]
            hits.extend({"evidence_kind": "station", **item} for item in station_hits)
            hits.extend({"evidence_kind": "pipeline", **item} for item in pipeline_hits)

        if not hits:
            return EvidenceItem(
                source=EvidenceSource.RAW_EXCEL,
                query=query_text,
                matched_entity=entity_name,
                confidence=0.4,
                evidence_text=f"Excel索引库未找到 {query_text} 的相关原始资料",
                missing_fields=["excel_records"],
                query_time_ms=int((__import__("time").time() - start_time) * 1000),
            )

        parts = []
        for hit in hits[:3]:
            kind = hit.get("evidence_kind", "")
            name = hit.get("name", "")
            if kind == "station":
                systems = "、".join(hit.get("systems", [])[:2]) if isinstance(hit.get("systems"), list) else ""
                pressure = _fmt_optional(hit.get("design_pressure_mpa"), "MPa")
                parts.append(
                    f"站场 {name}（类型:{hit.get('type_label') or '站场'}，所属:{systems or hit.get('scope_name') or '未知'}，设计压力:{pressure}）"
                )
            elif kind == "pipeline":
                length = _fmt_optional(hit.get("length_km"), "km")
                parts.append(
                    f"管线 {name}（类别:{'干线' if hit.get('kind') == 'trunk' else '支线'}，所属:{hit.get('scope_name') or '未知'}，长度:{length}）"
                )
            elif kind == "scope":
                aliases = "、".join(hit.get("aliases", [])[:3]) if isinstance(hit.get("aliases"), list) else ""
                parts.append(f"管线系统 {name}（别名:{aliases or '无'}）")

        return EvidenceItem(
            source=EvidenceSource.RAW_EXCEL,
            query=query_text,
            matched_entity=entity_name,
            confidence=0.75,
            evidence_text="Excel索引命中：" + "；".join(parts),
            raw_data={"hit_count": len(hits)},
            query_time_ms=int((__import__("time").time() - start_time) * 1000),
        )
    except Exception as exc:
        logger.warning("raw_excel query failed: %s", exc)
        return EvidenceItem(
            source=EvidenceSource.RAW_EXCEL,
            query=query_text,
            matched_entity=entity_name,
            confidence=0.0,
            evidence_text=f"Excel索引库查询失败：{exc}",
            missing_fields=["all"],
            query_time_ms=int((__import__("time").time() - start_time) * 1000),
        )


async def query_chroma_db(
    query_text: str,
    entity_name: str = "",
    metric_type: str = "",
    **kwargs: Any,
) -> EvidenceItem | None:
    """
    查询规程向量库（RAG）
    返回规程、预案、处置建议
    """
    start_time = __import__("time").time()
    try:
        rag_result = _get_rag_service().query(query_text, top_k=3)
        docs = rag_result.get("documents", [])

        if not docs:
            return EvidenceItem(
                source=EvidenceSource.CHROMA_DB,
                query=query_text,
                matched_entity=entity_name,
                confidence=0.4,
                evidence_text="规程向量库未检索到相关预案或规程",
                missing_fields=["regulation_docs"],
                query_time_ms=int((__import__("time").time() - start_time) * 1000),
            )

        parts = []
        for doc in docs[:3]:
            content = str(doc.get("content", "") if isinstance(doc, dict) else doc)
            parts.append(content[:120] + "..." if len(content) > 120 else content)

        return EvidenceItem(
            source=EvidenceSource.CHROMA_DB,
            query=query_text,
            matched_entity=entity_name,
            confidence=0.78,
            evidence_text="规程依据：" + "；".join(parts),
            raw_data={"doc_count": len(docs)},
            query_time_ms=int((__import__("time").time() - start_time) * 1000),
        )
    except Exception as exc:
        logger.warning("chroma_db query failed: %s", exc)
        return EvidenceItem(
            source=EvidenceSource.CHROMA_DB,
            query=query_text,
            matched_entity=entity_name,
            confidence=0.0,
            evidence_text=f"规程向量库查询失败：{exc}",
            missing_fields=["all"],
            query_time_ms=int((__import__("time").time() - start_time) * 1000),
        )


async def query_simulation(
    query_text: str,
    entity_name: str = "",
    metric_type: str = "",
    **kwargs: Any,
) -> EvidenceItem | None:
    """
    查询仿真快照库
    返回最近的仿真结果摘要
    """
    start_time = __import__("time").time()
    try:
        # 列出最近快照
        snaps = list_snapshots(limit=5)
        if not snaps:
            return EvidenceItem(
                source=EvidenceSource.SIMULATION,
                query=query_text,
                matched_entity=entity_name,
                confidence=0.4,
                evidence_text="当前无可用仿真快照",
                missing_fields=["snapshot"],
                is_simulation=True,
                query_time_ms=int((__import__("time").time() - start_time) * 1000),
            )

        # 取最新快照
        latest = snaps[0]
        run_id = latest.get("run_id", "")

        try:
            detail = get_snapshot(run_id)
        except FileNotFoundError:
            detail = None

        summary = latest.get("output_summary", {})
        key_nodes = summary.get("key_nodes", []) if isinstance(summary, dict) else []

        # 如果有实体名，尝试找相关节点
        related = []
        if entity_name and key_nodes:
            for node in key_nodes:
                name = str(node.get("name", ""))
                if entity_name in name:
                    related.append(node)

        if related:
            parts = []
            for node in related[:3]:
                p = node.get("pressure", "N/A")
                q = node.get("flow", "N/A")
                parts.append(f"{node.get('name','')} 压力{p} 流量{q}")
            evidence_text = "仿真快照（最新）相关节点：" + "；".join(parts)
        else:
            evidence_text = (
                f"最新仿真快照（{run_id[:8]}...）"
                f"包含 {len(key_nodes)} 个关键节点"
            )
        missing_fields = [] if key_nodes else ["key_nodes"]
        confidence = 0.82 if key_nodes else 0.45

        return EvidenceItem(
            source=EvidenceSource.SIMULATION,
            query=query_text,
            matched_entity=entity_name,
            confidence=confidence,
            evidence_text=evidence_text,
            missing_fields=missing_fields,
            is_simulation=True,
            raw_data={
                "run_id": run_id,
                "snapshot_count": len(snaps),
                "key_node_count": len(key_nodes),
            },
            query_time_ms=int((__import__("time").time() - start_time) * 1000),
        )
    except Exception as exc:
        logger.warning("simulation query failed: %s", exc)
        return EvidenceItem(
            source=EvidenceSource.SIMULATION,
            query=query_text,
            matched_entity=entity_name,
            confidence=0.0,
            evidence_text=f"仿真快照查询失败：{exc}",
            missing_fields=["all"],
            is_simulation=True,
            query_time_ms=int((__import__("time").time() - start_time) * 1000),
        )


# 执行器映射表
EXECUTOR_MAP = {
    EvidenceSource.SMARTGAS_DB: query_smartgas_db,
    EvidenceSource.SCADA_HISTORY: query_scada_history,
    EvidenceSource.RAW_EXCEL: query_raw_excel,
    EvidenceSource.CHROMA_DB: query_chroma_db,
    EvidenceSource.SIMULATION: query_simulation,
}
