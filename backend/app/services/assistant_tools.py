"""
AI 助手工具注册表
将系统已有的查询、分析、推演能力封装为 AI 可调用的工具函数。
每个工具包含：名称、描述、参数定义、执行函数。
"""
import json
import logging
import math
import re
import time
from typing import Any
from datetime import datetime, timedelta

from sqlalchemy import or_
from sqlmodel import Session, select

from app.database import scada_history_engine
from app.models import Pipeline, PipelineSystem, Station
from app.scada_models import ScadaHistory
from app.routers.topology_simulation import (
    InitialConditionsInput,
    _apply_initial_conditions,
    _build_solver_input_or_raise,
    _finalize_result_payload,
)
from app.services.ai_sim_evaluator import evaluate_simulation_result_text
from app.services.raw_excel_ai_index import STATION_TYPE_LABELS, raw_excel_ai_index
from app.services.topology import TopologyService
from app.services.topology_simulation import solve_steady
from app.services.we1_result_snapshot_service import get_snapshot, save_snapshot
from app.services.simulation_service import OptimizedSimulationEngine as SimulationEngine
from app.services.we1_data_alignment_service import (
    explain_flow_topology_situation as build_we1_flow_topology_explanation,
    get_flow_direction as get_we1_flow_direction,
    get_pressure_profile as get_we1_pressure_profile,
    get_we1_alignment_report,
    query_sim_flow_topology as query_we1_sim_flow_topology,
    query_topology_relation as query_we1_topology_relation,
)

logger = logging.getLogger(__name__)

SCADA_STATION_SUFFIXES = ("分输站", "压气站", "气源站", "阀室", "站")
SCADA_PIPELINE_PREFIXES = (
    "西气东输一线",
    "西气东输二线",
    "西气东输三线",
    "西气东输四线",
    "西气东输",
    "西一线",
    "西二线",
    "西三线",
    "西四线",
    "中俄",
    "中缅",
    "中亚",
    "川气东送",
    "陕京",
    "忠武",
)
SEARCH_ALIAS_MAP = {
    "压缩机": ("压气站", "机组", "压机"),
    "压气站": ("压缩机", "机组", "压机"),
    "分输口": ("分输站", "用户", "下载点", "下载用户"),
    "分输站": ("分输口", "用户", "下载点", "下载用户"),
    "鼓浪": ("古浪",),
    "古浪": ("鼓浪",),
}
# ============ 工具定义（供 AI System Prompt 使用） ============

TOOL_DEFINITIONS = [
    {
        "name": "universal_search",
        "description": (
            "全域检索入口。用户说查不到、搜一下、找某个站/管线/用户/参数/预案时优先调用。"
            "它会同时检索站场、管线、分输用户、拓扑主库、SCADA 历史站名和规程知识库，并返回每个来源的命中情况。"
        ),
        "parameters": {
            "query": {"description": "用户原始检索词或问题", "required": True},
            "limit": {"description": "每类最多返回多少条，默认 8", "required": False},
            "include_knowledge": {"description": "是否同时检索规程/预案知识库，默认 true", "required": False},
        },
    },
    {
        "name": "query_stations",
        "description": "查询站场列表。可按类型(type)或名称关键字(keyword)过滤。",
        "parameters": {
            "type": {"description": "站场类型过滤: source/compressor/distribution/valve", "required": False},
            "keyword": {"description": "站场名称关键字模糊搜索", "required": False},
        },
    },
    {
        "name": "get_station_details",
        "description": "获取指定站场的详细物理属性（如坐标、进出站压力、温度、处理能力等）。",
        "parameters": {
            "station_id": {"description": "站场 ID 或精确名称", "required": True},
        },
    },
    {
        "name": "query_pipelines",
        "description": "查询管线列表。可按类别(category)或名称关键字(keyword)过滤。",
        "parameters": {
            "category": {"description": "管线类别: trunk(干线)/branch(支线)", "required": False},
            "keyword": {"description": "管线名称关键字模糊搜索", "required": False},
        },
    },
    {
        "name": "count_by_type",
        "description": "统计站场或管线的数量。可按类型分组统计。",
        "parameters": {
            "entity": {"description": "实体类型: station(站场) 或 pipeline(管线)", "required": True},
            "group_by_type": {"description": "是否按类型/类别分组统计，默认 true", "required": False},
        },
    },
    {
        "name": "analyze_impact",
        "description": "分析某条管线故障后的影响范围，计算波及的下游站点。",
        "parameters": {
            "pipeline_id": {"description": "故障管线 ID（如 line-001）", "required": True},
        },
    },
    {
        "name": "find_routes",
        "description": "在屏蔽故障管线后，寻找两个站场之间的备选路径。",
        "parameters": {
            "source_station": {"description": "起点站场名称或 ID", "required": True},
            "target_station": {"description": "终点站场名称或 ID", "required": True},
            "blocked_pipelines": {"description": "被阻断的管线 ID 列表", "required": False},
        },
    },
    {
        "name": "get_topology_summary",
        "description": "获取管网拓扑概览：节点数、边数、总管存等关键指标。",
        "parameters": {},
    },
    {
        "name": "find_critical_nodes",
        "description": "通过介数中心性算法(Betweenness Centrality)，识别管网中最关键的卡脖子节点。这属于拓扑关系知识库。",
        "parameters": {},
    },
    {
        "name": "simulate_failure",
        "description": "模拟某个站场发生故障后的断流推演，返回传播过程摘要。",
        "parameters": {
            "station_id": {"description": "故障站场 ID（如 node-001）", "required": True},
            "max_ticks": {"description": "最大推演步数，默认 50", "required": False},
        },
    },
    {
        "name": "search_knowledge_base",
        "description": "专门用于检索天然气管网操作规程、现场处置应急预案等官方文档，以回答如何处理故障、参数对标、操作步骤等特定业务知识问题。",
        "parameters": {
            "query": {"description": "用户检索问题的关键字或完整句子", "required": True},
        },
    },
    {
        "name": "predict_trend",
        "description": "对指定站场的历史压力/温度数据做线性回归，预测增速和何时触及设计上限。返回斜率、当前值、预计超标剩余时间。",
        "parameters": {
            "station_id": {"description": "站场名称（如 靖边压气站）", "required": True},
            "metric": {"description": "分析指标：pressure 或 temperature，默认 pressure", "required": False},
            "hours": {"description": "回溯小时数，默认 6", "required": False},
        },
    },
    {
        "name": "analyze_correlation",
        "description": "分析指定站场进站压力与出站流量之间的皮尔逊相关系数，用于诊断憋压、冰堵等异常。返回相关系数和异常诊断结论。",
        "parameters": {
            "station_id": {"description": "站场名称（如 靖边压气站）", "required": True},
            "hours": {"description": "回溯小时数，默认 6", "required": False},
        },
    },
    {
        "name": "simulate_cutoff",
        "description": "模拟某个站场突然停机后的截断推演：用 BFS 图算法找出所有受影响的下游站点，并根据管存容量估算下游可支撑的剩余时间。",
        "parameters": {
            "station_id": {"description": "故障站场名称或 ID", "required": True},
        },
    },
    {
        "name": "run_steady_sim",
        "description": "运行稳态仿真并自动归档最新快照，用于查看压力、流量、利用率和答辩口径。返回运行摘要和 AI 评价。",
        "parameters": {
            "pilot_id": {"description": "试点 ID，默认主样板", "required": False},
            "scenario_id": {"description": "场景 ID", "required": False},
            "initial_conditions_json": {"description": "初值覆盖 JSON 字符串", "required": False},
        },
    },
    {
        "name": "evaluate_sim_result",
        "description": "评价稳态仿真结果，支持按 run_id 或直接传 overlay JSON。可选基线快照做对比。",
        "parameters": {
            "run_id": {"description": "快照 run_id", "required": False},
            "pilot_id": {"description": "试点 ID", "required": False},
            "overlay_json": {"description": "仿真结果 JSON", "required": False},
            "baseline_run_id": {"description": "对比基线 run_id", "required": False},
        },
    },
    {
        "name": "query_we1_data_alignment",
        "description": "查询 WE1 中卫样板数据库对照结果，确认站点映射、压力来源、真实流量缺口和跨系统边界。",
        "parameters": {},
    },
    {
        "name": "get_we1_pressure_profile",
        "description": "查询 WE1 样板站点统一压力口径，区分当前压力、起始压力、仿真压力和基线压力。",
        "parameters": {
            "station_ref": {"description": "站点名称或 ID，如 中卫、盐池、靖边、WE1-76", "required": True},
            "run_id": {"description": "可选仿真快照 run_id", "required": False},
            "baseline_run_id": {"description": "可选基线快照 run_id", "required": False},
        },
    },
    {
        "name": "get_flow_direction",
        "description": "查询管段流向。优先用仿真结果，其次按压力差推断，最后回退拓扑默认方向。",
        "parameters": {
            "edge_id": {"description": "管段 ID 或名称，如 WE1-T-76", "required": True},
            "run_id": {"description": "可选仿真快照 run_id，不填则尝试读取最新快照", "required": False},
        },
    },
    {
        "name": "query_topology_relation",
        "description": "查询 WE1 站点上下游、相邻管段和两站路径。",
        "parameters": {
            "station_ref": {"description": "起点站点名称或 ID，如 中卫", "required": True},
            "target_ref": {"description": "可选目标站点，如 靖边", "required": False},
            "scope": {"description": "查询范围，默认 we1，可填 all 纳入跨系统边", "required": False},
            "depth": {"description": "路径搜索深度，默认 20", "required": False},
        },
    },
    {
        "name": "query_sim_flow_topology",
        "description": "查询仿真后流量和拓扑变化，返回流量变化、压力变化、高利用率管段和依据。",
        "parameters": {
            "run_id": {"description": "可选仿真快照 run_id，不填则读取最新快照", "required": False},
            "baseline_run_id": {"description": "可选基线快照 run_id", "required": False},
            "top_n": {"description": "返回前 N 项，默认 5", "required": False},
        },
    },
    {
        "name": "explain_flow_topology_situation",
        "description": "把 WE1 仿真后的流量、压力和拓扑变化归纳成人话结论。",
        "parameters": {
            "run_id": {"description": "可选仿真快照 run_id，不填则读取最新快照", "required": False},
            "baseline_run_id": {"description": "可选基线快照 run_id", "required": False},
        },
    },
    {
        "name": "query_users",
        "description": (
            "查询分输口（也叫用户、下载点、下载用户、分输点）。"
            "当用户问多少个用户、几个下载点、干线有多少用户时调用此工具。"
        ),
        "parameters": {
            "keyword": {"description": "分输口名称关键字", "required": False},
            "trunk_name": {"description": "按干线名称过滤，如西一线、陕京二线", "required": False},
        },
    },
    {
        "name": "compare_stations",
        "description": (
            "横向对比多个站场（2~5站）的压力、温度、水露点数据，给出排名与调度建议。"
            "当用户说A站和B站压力对比、甲乙丙三站温度对比、XX和YY综合对比时调用。"
        ),
        "parameters": {
            "stations": {
                "description": "站场名称列表，逗号分隔，如 甪直分输站,中卫分输站",
                "required": True,
            },
            "metric": {
                "description": "对比指标: pressure(压力) / temperature(温度) / dewpoint(水露点) / all(全量，默认)",
                "required": False,
            },
            "hours": {
                "description": "回溯小时数，默认 24",
                "required": False,
            },
        },
    },
]
def build_tools_description() -> str:
    """
    将工具定义格式化为 AI 可理解的文本说明。
    AI 会根据这些描述决定何时调用哪个工具。
    """
    lines = ["你可以使用以下工具来获取事实数据以回答用户的问题。你应该像使用知识库一样使用它们。\n"]
    lines.append("你的系统接入了【四大知识库】：")
    lines.append("1. **全域检索入口**：不确定该查哪个库时，先调用 universal_search；")
    lines.append("2. **AI 索引库**（raw_excel_index + JSON cache）：通过 query_stations 等工具进行精确检索；")
    lines.append("3. **规程向量库**（ChromaDB）：通过 search_knowledge_base 工具检索官方文档原文；")
    lines.append("4. **拓扑关系库**（NetworkX）：通过 analyze_impact, find_routes, simulate_failure, find_critical_nodes 进行图计算推理。\n")
    lines.append("检索策略：用户说“搜不到、查一下、有没有、在哪里、是什么、参数、压力、站场、管线、预案”且你不确定专用工具时，优先调用 universal_search。")
    lines.append("当需要查询数据或执行分析时，请输出相应的工具调用指令。\n")
    lines.append("## 可用工具\n")

    for tool in TOOL_DEFINITIONS:
        lines.append(f"### {tool['name']}")
        lines.append(f"功能: {tool['description']}")
        if tool["parameters"]:
            lines.append("参数:")
            for param_name, param_info in tool["parameters"].items():
                required_mark = "（必填）" if param_info.get("required") else "（可选）"
                lines.append(f"  - {param_name}: {param_info['description']} {required_mark}")
        lines.append("")

    lines.append("## 调用格式\n")
    lines.append("如果你需要调用工具，请严格按以下 JSON 格式输出（不要输出任何其他内容）：")
    lines.append('```json')
    lines.append('{"tool": "工具名称", "args": {"参数名": "参数值"}}')
    lines.append('```')
    lines.append("")
    lines.append("如果不需要调用工具（比如用户在闲聊），直接正常回复即可。")

    return "\n".join(lines)


# ============ 工具执行函数 ============

def execute_tool(tool_name: str, args: dict[str, Any], session: Session) -> str:
    """
    根据工具名调用对应的处理函数，返回结果的文本摘要。
    """
    handler = TOOL_HANDLERS.get(tool_name)
    if not handler:
        return f"未知工具: {tool_name}"

    try:
        result = handler(args, session)
        return result
    except Exception as e:
        logger.error(f"工具 {tool_name} 执行失败: {e}", exc_info=True)
        return f"工具执行出错: {str(e)}"


def _search_key(value: Any) -> str:
    return re.sub(r"[\s\-_/()（）【】\[\]<>《》,，.。:：;；“”\"'‘’·]+", "", str(value or "")).lower()


def _contains_query(*values: Any, query_key: str) -> bool:
    if not query_key:
        return False
    return any(query_key in _search_key(value) for value in values)


def _expand_query_terms(query: str) -> list[str]:
    base = str(query or "").strip()
    if not base:
        return []

    terms: set[str] = {base}
    compact = _search_key(base)
    if compact:
        terms.add(compact)

    # 去掉常见后缀，提升站名命中率
    stripped = base
    for suffix in ("参数列表", "参数清单", "列表", "清单", "分输站", "压气站", "站", "枢纽站", "枢纽"):
        if stripped.endswith(suffix) and len(stripped) > len(suffix):
            stripped = stripped[: -len(suffix)]
    if stripped and stripped != base:
        terms.add(stripped)
        terms.add(_search_key(stripped))

    for key, aliases in SEARCH_ALIAS_MAP.items():
        if key in base or key in compact:
            for alias in aliases:
                terms.add(alias)
                terms.add(_search_key(alias))
                terms.add(base.replace(key, alias))

    return [item for item in terms if str(item).strip()]


def _contains_any_query(values: list[Any], query_keys: list[str]) -> bool:
    if not query_keys:
        return False
    value_keys = [_search_key(v) for v in values]
    for key in query_keys:
        if not key:
            continue
        for value_key in value_keys:
            if key in value_key:
                return True
    return False


def _looks_like_knowledge_query(query: str) -> bool:
    text = str(query or "").strip()
    if not text:
        return False
    keywords = ("预案", "规程", "应急", "处置", "步骤", "流程", "规范", "标准", "制度", "法规")
    return any(k in text for k in keywords)


def _limit_int(value: Any, default: int = 8, minimum: int = 1, maximum: int = 20) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = default
    return max(minimum, min(maximum, parsed))


def _merge_by_id(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        item_id = str(item.get("id") or "")
        if not item_id or item_id in seen:
            continue
        seen.add(item_id)
        merged.append(item)
    return merged


def _handle_universal_search(args: dict, session: Session) -> str:
    query = str(args.get("query") or "").strip()
    if not query:
        return "请提供要检索的关键词。"

    limit = _limit_int(args.get("limit"), default=8)
    include_knowledge_arg = args.get("include_knowledge", None)
    if include_knowledge_arg is None:
        include_knowledge = _looks_like_knowledge_query(query)
    else:
        include_knowledge = include_knowledge_arg is not False
    started_at = time.time()
    query_terms = _expand_query_terms(query)
    query_keys = [_search_key(item) for item in query_terms if _search_key(item)]
    query_key = query_keys[0] if query_keys else _search_key(query)
    payload: dict[str, Any] = {
        "query": query,
        "query_terms": query_terms[:10],
        "limit_per_source": limit,
        "sources": {},
        "hit_summary": {},
        "missed_sources": [],
    }

    raw_station_items: list[dict[str, Any]] = []
    raw_pipeline_items: list[dict[str, Any]] = []
    raw_user_items: list[dict[str, Any]] = []
    for term in query_terms[:6]:
        raw_station_items.extend(raw_excel_ai_index.find_station_candidates(term, limit=limit))
        raw_station_items.extend(raw_excel_ai_index.query_stations(keyword=term))
        raw_pipeline_items.extend(raw_excel_ai_index.query_pipelines(keyword=term))
        raw_user_items.extend(raw_excel_ai_index.query_distributions(keyword=term))
    raw_stations = _merge_by_id(raw_station_items)[:limit]
    raw_pipelines = _merge_by_id(raw_pipeline_items)[:limit]
    raw_users = _merge_by_id(raw_user_items)[:limit]

    payload["sources"]["raw_excel_stations"] = [
        {
            "id": item.get("id"),
            "name": item.get("name"),
            "type": item.get("type_label") or STATION_TYPE_LABELS.get(item.get("type_code"), item.get("type_code")),
            "systems": item.get("systems", [])[:3],
            "branches": item.get("branches", [])[:3],
        }
        for item in raw_stations
    ]
    payload["sources"]["raw_excel_pipelines"] = [
        {
            "id": item.get("id"),
            "name": item.get("name"),
            "kind": item.get("kind"),
            "scope": item.get("scope_name"),
            "length_km": item.get("length_km"),
            "design_pressure_mpa": item.get("design_pressure_mpa"),
        }
        for item in raw_pipelines
    ]
    payload["sources"]["raw_excel_users"] = [
        {
            "id": item.get("id"),
            "name": item.get("name"),
            "trunk_name": item.get("trunk_name"),
            "station_abbr": item.get("station_abbr"),
            "contract_pressure_mpa": item.get("contract_pressure_mpa"),
        }
        for item in raw_users
    ]

    def _sql_or_contains(columns: list[Any], terms: list[str]) -> Any:
        conditions = []
        for term in terms[:8]:
            raw = str(term or "").strip()
            if not raw:
                continue
            for col in columns:
                conditions.append(col.contains(raw))
        return or_(*conditions) if conditions else None

    station_where = _sql_or_contains([Station.id, Station.name, Station.type], query_terms)
    pipeline_where = _sql_or_contains([Pipeline.id, Pipeline.name, Pipeline.start_station_id, Pipeline.end_station_id, Pipeline.category], query_terms)
    system_where = _sql_or_contains([PipelineSystem.id, PipelineSystem.name], query_terms)

    station_stmt = select(Station)
    if station_where is not None:
        station_stmt = station_stmt.where(station_where)
    db_stations = session.exec(station_stmt.limit(limit)).all()

    pipeline_stmt = select(Pipeline)
    if pipeline_where is not None:
        pipeline_stmt = pipeline_stmt.where(pipeline_where)
    db_pipelines = session.exec(pipeline_stmt.limit(limit)).all()

    system_stmt = select(PipelineSystem)
    if system_where is not None:
        system_stmt = system_stmt.where(system_where)
    db_systems = session.exec(system_stmt.limit(limit)).all()

    payload["sources"]["smartgas_stations"] = [
        {
            "id": item.id,
            "name": item.name,
            "type": item.type,
            "longitude": item.longitude,
            "latitude": item.latitude,
            "design_pressure": item.design_pressure,
            "pressure_in": item.operating_pressure_in,
            "pressure_out": item.operating_pressure_out,
            "capacity": item.capacity,
        }
        for item in db_stations
    ]
    payload["sources"]["smartgas_pipelines"] = [
        {
            "id": item.id,
            "name": item.name,
            "start_station_id": item.start_station_id,
            "end_station_id": item.end_station_id,
            "length_km": item.length_km,
            "diameter_mm": item.diameter_mm,
            "category": item.category,
        }
        for item in db_pipelines
    ]
    payload["sources"]["pipeline_systems"] = [
        {"id": item.id, "name": item.name, "sort_order": item.sort_order}
        for item in db_systems
    ]

    try:
        with Session(scada_history_engine) as scada_session:
            scada_stmt = select(
                ScadaHistory.station_name,
                ScadaHistory.station_id,
                ScadaHistory.pipeline_id,
                ScadaHistory.metric_type,
            ).distinct()
            scada_where = _sql_or_contains(
                [
                    ScadaHistory.station_name,
                    ScadaHistory.station_id,
                    ScadaHistory.pipeline_id,
                    ScadaHistory.metric_type,
                ],
                query_terms,
            )
            if scada_where is not None:
                scada_stmt = scada_stmt.where(scada_where)
            scada_rows = scada_session.exec(scada_stmt.limit(limit * 4)).all()
        seen_scada: set[tuple[str, str, str, str]] = set()
        scada_hits = []
        for station_name, station_id, pipeline_id, metric_type in scada_rows:
            key_tuple = (
                str(station_name or ""),
                str(station_id or ""),
                str(pipeline_id or ""),
                str(metric_type or ""),
            )
            if key_tuple in seen_scada:
                continue
            if not _contains_any_query(list(key_tuple), query_keys):
                continue
            seen_scada.add(key_tuple)
            scada_hits.append(
                {
                    "station_name": key_tuple[0],
                    "station_id": key_tuple[1],
                    "pipeline_id": key_tuple[2],
                    "metric_type": key_tuple[3],
                }
            )
            if len(scada_hits) >= limit:
                break
        payload["sources"]["scada_history"] = scada_hits
    except Exception as exc:
        payload["sources"]["scada_history"] = {"error": str(exc)}

    if include_knowledge:
        knowledge_started = time.time()
        knowledge_text = _handle_search_knowledge_base({"query": query}, session)
        knowledge_found = "未检索到" not in knowledge_text and "执行出错" not in knowledge_text
        payload["sources"]["knowledge_base"] = {
            "found": knowledge_found,
            "preview": knowledge_text[:1200],
            "elapsed_ms": int((time.time() - knowledge_started) * 1000),
        }

    for source_name, value in payload["sources"].items():
        if isinstance(value, list):
            payload["hit_summary"][source_name] = len(value)
            if not value:
                payload["missed_sources"].append(source_name)
        elif isinstance(value, dict) and "found" in value:
            payload["hit_summary"][source_name] = 1 if value.get("found") else 0
            if not value.get("found"):
                payload["missed_sources"].append(source_name)
        else:
            payload["hit_summary"][source_name] = 0
            payload["missed_sources"].append(source_name)

    total_hits = sum(int(count or 0) for count in payload["hit_summary"].values())
    payload["total_hits"] = total_hits
    payload["elapsed_ms"] = int((time.time() - started_at) * 1000)
    payload["guidance"] = (
        "有命中时，回答要说明命中来源；没命中的来源也要说清楚，别直接说系统没有。"
        if total_hits else
        "所有已接入来源都没命中。建议提示用户换全称、简称、站场后缀或提供管线范围。"
    )

    return _json_result("全域检索结果", payload)


def _handle_get_station_details(args: dict, session: Session) -> str:
    """获取站场详细物理属性"""
    station_id = args.get("station_id", "")
    if not station_id:
        return "请提供站场 ID 或名称"

    station = raw_excel_ai_index.get_station(station_id)
    if not station:
        return f"未找到站场: {station_id}"

    lines = [f"站场详情 —— {station.get('name')}（{station.get('type_label') or '站场'}）"]
    lines.append(f"  索引ID: {station.get('id')}")
    lines.append(f"  所属干线: {'、'.join(station.get('systems', [])) or '未知'}")
    lines.append(f"  关联支线: {'、'.join(station.get('branches', [])) or '未知'}")
    lines.append(f"  地理位置: {station.get('location') or '未知'}")
    if station.get("compressor_unit_count"):
        lines.append(f"  压缩机组记录数: {station.get('compressor_unit_count')} 台")
    if station.get("compressor_configs"):
        lines.append(f"  机组配置: {'、'.join(station.get('compressor_configs', []))}")
    return "\n".join(lines)



def _handle_query_stations(args: dict, session: Session) -> str:
    """查询站场"""
    filters = []

    station_type = args.get("type")
    keyword = args.get("keyword")

    if station_type:
        filters.append(f"类型={station_type}")
    if keyword:
        filters.append(f"名称含'{keyword}'")

    stations = raw_excel_ai_index.query_stations(station_type=station_type, keyword=keyword)

    if not stations:
        filter_desc = "、".join(filters) if filters else "无过滤条件"
        return f"未找到符合条件的站场（{filter_desc}）"

    lines = [f"共找到 {len(stations)} 个站场：\n"]
    for s in stations[:50]:
        type_label = STATION_TYPE_LABELS.get(s.get("type_code"), s.get("type_label") or "站场")
        scope_name = "、".join(s.get("systems", [])[:2]) or "未知干线"
        lines.append(f"  - {s.get('name')}（{type_label}，索引ID: {s.get('id')}，所属干线: {scope_name}）")

    if len(stations) > 50:
        lines.append(f"\n  ...还有 {len(stations) - 50} 个未显示")

    return "\n".join(lines)


def _handle_query_pipelines(args: dict, session: Session) -> str:
    """查询管线"""
    filters = []

    category = args.get("category")
    keyword = args.get("keyword")

    if category:
        filters.append(f"类别={category}")
    if keyword:
        filters.append(f"名称含'{keyword}'")

    pipelines = raw_excel_ai_index.query_pipelines(kind=category, keyword=keyword)

    if not pipelines:
        filter_desc = "、".join(filters) if filters else "无过滤条件"
        return f"未找到符合条件的管线（{filter_desc}）"

    lines = [f"共找到 {len(pipelines)} 条管线：\n"]
    for p in pipelines[:50]:
        length = f"长度{p.get('length_km'):.2f}km" if p.get("length_km") is not None else ""
        pressure = f"设计压力{p.get('design_pressure_mpa'):.2f}MPa" if p.get("design_pressure_mpa") is not None else ""
        detail = "，".join(filter(None, [length, pressure]))
        lines.append(
            f"  - {p.get('name')}（{detail or '无详细参数'}，"
            f"{'干线' if p.get('kind') == 'trunk' else '支线'}，索引ID: {p.get('id')}）"
        )

    if len(pipelines) > 50:
        lines.append(f"\n  ...还有 {len(pipelines) - 50} 条未显示")

    return "\n".join(lines)


def _handle_count_by_type(args: dict, session: Session) -> str:
    """统计数量"""
    entity = args.get("entity", "station")

    if entity == "pipeline":
        pipelines = raw_excel_ai_index.query_pipelines()
        groups: dict[str, int] = {}
        for p in pipelines:
            cat = p.get("kind") or "未分类"
            groups[cat] = groups.get(cat, 0) + 1

        lines = [f"管线总数: {len(pipelines)} 条"]
        category_map = {"trunk": "干线", "branch": "支线"}
        for cat, count in groups.items():
            label = category_map.get(cat, cat)
            lines.append(f"  - {label}: {count} 条")
        return "\n".join(lines)
    else:
        stations = raw_excel_ai_index.query_stations()
        groups: dict[str, int] = {}
        for s in stations:
            t = s.get("type_code") or "未分类"
            groups[t] = groups.get(t, 0) + 1

        lines = [f"站场总数: {len(stations)} 个"]
        for t, count in groups.items():
            label = STATION_TYPE_LABELS.get(t, t)
            lines.append(f"  - {label}: {count} 个")
        return "\n".join(lines)


def _handle_analyze_impact(args: dict, session: Session) -> str:
    """影响范围分析"""
    pipeline_id = args.get("pipeline_id", "")
    if not pipeline_id:
        return "请提供故障管线 ID（如 line-001）"

    topo = TopologyService(session)
    affected = topo.calculate_impact_area(pipeline_id)

    if not affected:
        return f"管线 {pipeline_id} 故障后未发现受影响的站点（可能该管线不存在或孤立）"

    lines = [f"管线 {pipeline_id} 故障影响分析："]
    lines.append(f"共波及 {len(affected)} 个站点：")
    for station_name in affected:
        lines.append(f"  - {station_name}")
    return "\n".join(lines)


def _handle_find_routes(args: dict, session: Session) -> str:
    """路径搜索"""
    source = args.get("source_station", "")
    target = args.get("target_station", "")
    blocked = args.get("blocked_pipelines", [])

    if not source or not target:
        return "请提供起点和终点站场名称"

    if isinstance(blocked, str):
        blocked = [blocked]

    topo = TopologyService(session)
    routes = topo.find_alternative_routes(source, target, blocked)

    if not routes:
        return f"未找到从 {source} 到 {target} 的可用路径"

    lines = [f"从 {source} 到 {target} 的备选路径（屏蔽: {blocked or '无'}）："]
    for i, route in enumerate(routes, 1):
        lines.append(f"\n路径 {i}: {' → '.join(route.get('path', []))}")
        if "distance" in route:
            lines.append(f"  总长度: {route['distance']} km")
    return "\n".join(lines)


def _handle_topology_summary(args: dict, session: Session) -> str:
    """拓扑概览"""
    topo = TopologyService(session)
    summary = topo.get_graph_summary()

    lines = ["管网拓扑概览："]
    lines.append(f"  - 节点数: {summary.get('node_count', 0)}")
    lines.append(f"  - 边数: {summary.get('edge_count', 0)}")
    if "total_linepack" in summary:
        lines.append(f"  - 总管存: {summary['total_linepack']:.1f} 万方")
    if "total_length" in summary:
        lines.append(f"  - 总长度: {summary['total_length']:.1f} km")

    return "\n".join(lines)


def _handle_simulate_failure(args: dict, session: Session) -> str:
    """断流推演"""
    station_id = args.get("station_id", "")
    max_ticks = int(args.get("max_ticks", 50))

    if not station_id:
        return "请提供故障站场 ID（如 node-001）"

    topo = TopologyService(session)
    engine = SimulationEngine()

    result = engine.run(
        graph=topo.graph,
        failure_node=station_id,
        max_ticks=max_ticks,
    )

    raw = result.to_dict()

    lines = [f"断流推演结果（故障节点: {station_id}）："]
    lines.append(f"  - 推演步数: {raw['total_ticks']} 帧")
    lines.append(f"  - 受影响管线: {raw['affected_pipes']} 条")

    # 提取关键帧信息
    if raw.get("frames"):
        lines.append("\n关键时间节点：")
        for frame in raw["frames"][:5]:
            tick = frame.get("tick", 0)
            changes = frame.get("changes", [])
            if changes:
                pipe_names = [c.get("pipe_id", "?") for c in changes[:3]]
                lines.append(f"  T+{tick * 10}分钟: {', '.join(pipe_names)} 受到影响")

    return "\n".join(lines)


def _handle_search_knowledge_base(args: dict, session: Session) -> str:
    """查询结构化 PDF 操作规程与应急预案库"""
    query = args.get("query", "")
    if not query:
        return "请提供要查询的具体问题或关键字。"

    try:
        from app.services.rag_enhanced import EnhancedRAGService
        rag_service = EnhancedRAGService()
        
        # 强制只走 ChromaDB 向量搜索，这里跳过 Text2SQL 以免干扰
        vector_result = rag_service.query_vector_db(query, n_results=4)
        
        if vector_result and vector_result.get('documents'):
            docs = vector_result['documents']
            metas = vector_result['metadatas']
            
            lines = ["下面是从《操作规程》与《应急预案》库中为您检索到的相关原文片段：\n"]
            for i, doc in enumerate(docs):
                meta = metas[i] if i < len(metas) else {}
                source = meta.get("source", "未知文件")
                chunk_idx = meta.get("chunk", "?")
                lines.append(f"【参考来源 {i+1} : {source} (切片位置: #{chunk_idx})】\n{doc}\n")
                
            lines.append("\n【系统提示：请综合上述官方文本，为用户提炼出重点步骤与专业数值进行回答。注意呈现 Markdown 表格以保持清晰。】")
            return "\n".join(lines)
        else:
            return "抱歉，知识库中未检索到相关的规程与预案记载。"
            
    except Exception as e:
        logger.error(f"知识库检索失败: {e}", exc_info=True)
        return "知识库检索工具执行出错: 当前环境无法完成规程库检索，已自动降级为业务数据库检索。"


def _handle_query_users(args: dict, session: Session) -> str:
    """查询分输口（也叫用户/下载点/下载用户/分输点）"""
    keyword = args.get("keyword")
    trunk_name = args.get("trunk_name")

    distributions = raw_excel_ai_index.query_distributions(
        keyword=keyword,
        trunk_name=trunk_name,
    )

    if not distributions:
        conditions = []
        if trunk_name:
            conditions.append(f"干线={trunk_name}")
        if keyword:
            conditions.append(f"名称含'{keyword}'")
        cond_str = "、".join(conditions) if conditions else "无过滤条件"
        return f"未找到符合条件的分输口/用户（{cond_str}）"

    lines = [f"共找到 {len(distributions)} 个分输口（用户/下载点）：\n"]
    for d in distributions[:60]:
        pressure = f"，接气压力 {d.get('contract_pressure_mpa')} MPa" if d.get("contract_pressure_mpa") else ""
        trunk = f"，所属干线: {d.get('trunk_name')}" if d.get("trunk_name") else ""
        abbr = f"（{d.get('station_abbr')}）" if d.get("station_abbr") and d.get("station_abbr") != d.get("name") else ""
        lines.append(f"  - {d.get('name')}{abbr}{trunk}{pressure}")

    if len(distributions) > 60:
        lines.append(f"\n  ...还有 {len(distributions) - 60} 个未显示")

    return "\n".join(lines)


def _handle_find_critical_nodes(args: dict, session: Session) -> str:
    """识别管网中的关键节点（介数中心性）"""
    topo = TopologyService(session)
    critical_nodes = topo.find_critical_nodes()

    if not critical_nodes:
        return "未分析出关键节点"

    lines = ["管网拓扑关系核心节点（基于介数中心性：承担最多最短输送路径的卡脖子站点）："]
    for i, (node_name, score) in enumerate(critical_nodes.items(), 1):
        lines.append(f"  {i}. {node_name} (中心性得分: {score})")
    return "\n".join(lines)


def _normalize_station_alias(name: str) -> str:
    text = (name or "").strip()
    if not text:
        return ""
    text = re.sub(r"[\s\-_/()（）【】\[\]<>《》,，.。:：;；'\"“”‘’]+", "", text)
    for prefix in SCADA_PIPELINE_PREFIXES:
        if text.startswith(prefix) and len(text) > len(prefix):
            text = text[len(prefix):]
            break
    for suffix in SCADA_STATION_SUFFIXES:
        if text.endswith(suffix) and len(text) > len(suffix):
            text = text[: -len(suffix)]
            break
    return text.lower()


def _candidate_station_aliases(name: str) -> list[str]:
    raw = (name or "").strip()
    if not raw:
        return []
    result: list[str] = [raw]

    root = raw
    for suffix in SCADA_STATION_SUFFIXES:
        if root.endswith(suffix) and len(root) > len(suffix):
            root = root[: -len(suffix)]
            break

    if root and root not in result:
        result.append(root)
    for suffix in SCADA_STATION_SUFFIXES:
        candidate = f"{root}{suffix}" if root else raw
        if candidate not in result:
            result.append(candidate)
    return result


def _resolve_scada_station_name(
    session: Session,
    station_ref: str,
    *,
    metric_types: tuple[str, ...] = ("pressure", "temperature"),
) -> tuple[str | None, str]:
    from app.scada_models import ScadaHistory

    ref = (station_ref or "").strip()
    if not ref:
        return None, ""

    rows = session.exec(
        select(ScadaHistory.station_name, ScadaHistory.metric_type)
        .where(ScadaHistory.metric_type.in_(metric_types))
        .distinct()
        .order_by(ScadaHistory.station_name)
    ).all()
    if not rows:
        return None, ""

    name_set = {str(row[0]).strip() for row in rows if row and row[0]}
    metric_map: dict[str, set[str]] = {}
    for row in rows:
        if not row or not row[0] or not row[1]:
            continue
        station_name = str(row[0]).strip()
        metric_type = str(row[1]).strip()
        metric_map.setdefault(station_name, set()).add(metric_type)

    for alias in _candidate_station_aliases(ref):
        if alias in name_set:
            hint = "" if alias == ref else f"已按近似站名命中 {alias}。"
            if metric_map.get(alias, set()) >= set(metric_types):
                return alias, hint
            partial_hint = f"当前仅匹配到 {alias} 的部分指标数据。"
            if hint:
                partial_hint = f"{hint}{partial_hint}"
            return alias, partial_hint

    ref_key = _normalize_station_alias(ref)
    normalized_map: dict[str, list[str]] = {}
    for station_name in name_set:
        normalized_map.setdefault(_normalize_station_alias(station_name), []).append(station_name)

    if ref_key in normalized_map:
        candidates = sorted(normalized_map[ref_key], key=len)
        best = candidates[0]
        if metric_map.get(best, set()) >= set(metric_types):
            return best, ""
        return best, f"当前仅匹配到 {best} 的部分指标数据。"

    fuzzy_candidates: list[tuple[int, str]] = []
    for station_name in name_set:
        station_key = _normalize_station_alias(station_name)
        if not station_key:
            continue
        if ref_key in station_key or station_key in ref_key:
            score = abs(len(station_key) - len(ref_key))
            fuzzy_candidates.append((score, station_name))
    if fuzzy_candidates:
        fuzzy_candidates.sort(key=lambda item: (item[0], len(item[1])))
        best_score = fuzzy_candidates[0][0]
        best_bucket = [name for score, name in fuzzy_candidates if score == best_score]
        if best_score > 2 or len(best_bucket) > 1:
            suggestions = "、".join(sorted(best_bucket)[:5])
            return None, f"近似站名存在歧义：{suggestions}。请补充站场全称。"
        best = best_bucket[0]
        return best, f"已按近似站名命中 {best}。"

    suggestions = "、".join(sorted(name_set)[:8])
    return None, f"未找到匹配站名，当前可用站名示例：{suggestions}。"


def _fetch_scada_metric_records(
    session: Session,
    station_name: str,
    metric_type: str,
    *,
    hours: int,
):
    from app.scada_models import ScadaHistory

    base_query = (
        select(ScadaHistory)
        .where(
            ScadaHistory.station_name == station_name,
            ScadaHistory.metric_type == metric_type,
        )
        .order_by(ScadaHistory.recorded_at)
    )
    if hours > 0:
        cutoff = datetime.now() - timedelta(hours=hours)
        window_records = session.exec(
            base_query.where(ScadaHistory.recorded_at >= cutoff)
        ).all()
        if len(window_records) >= 3:
            return window_records
    return session.exec(base_query).all()


def _select_predict_dataset(
    session: Session,
    station_ref: str,
    metric: str,
    hours: int,
) -> tuple[str | None, str, list[Any], str]:
    preferred_candidate: tuple[str | None, str, list[Any], str] = (None, "", [], "scada_history.db")
    fallback_candidate: tuple[str | None, str, list[Any], str] = (None, "", [], "smartgas.db")

    try:
        with Session(scada_history_engine) as scada_session:
            resolved_station, resolve_hint = _resolve_scada_station_name(
                scada_session,
                station_ref,
                metric_types=(metric,),
            )
            if resolved_station:
                records = _fetch_scada_metric_records(
                    scada_session,
                    resolved_station,
                    metric,
                    hours=hours,
                )
                preferred_candidate = (resolved_station, resolve_hint, records, "scada_history.db")
                if len(records) >= 3:
                    return preferred_candidate
    except Exception as exc:
        logger.warning("读取 scada_history.db 失败，回退主库: %s", exc)

    resolved_station, resolve_hint = _resolve_scada_station_name(
        session,
        station_ref,
        metric_types=(metric,),
    )
    if resolved_station:
        records = _fetch_scada_metric_records(
            session,
            resolved_station,
            metric,
            hours=hours,
        )
        fallback_candidate = (resolved_station, resolve_hint, records, "smartgas.db")
        if len(records) >= 3:
            return fallback_candidate

    if preferred_candidate[0]:
        return preferred_candidate
    return fallback_candidate


def _select_correlation_dataset(
    session: Session,
    station_ref: str,
    hours: int,
) -> tuple[str | None, str, list[Any], list[Any], str]:
    preferred_candidate: tuple[str | None, str, list[Any], list[Any], str] = (None, "", [], [], "scada_history.db")
    fallback_candidate: tuple[str | None, str, list[Any], list[Any], str] = (None, "", [], [], "smartgas.db")

    try:
        with Session(scada_history_engine) as scada_session:
            resolved_station, resolve_hint = _resolve_scada_station_name(
                scada_session,
                station_ref,
                metric_types=("pressure", "temperature"),
            )
            if resolved_station:
                pressure_records = _fetch_scada_metric_records(
                    scada_session,
                    resolved_station,
                    "pressure",
                    hours=hours,
                )
                temp_records = _fetch_scada_metric_records(
                    scada_session,
                    resolved_station,
                    "temperature",
                    hours=hours,
                )
                preferred_candidate = (
                    resolved_station,
                    resolve_hint,
                    pressure_records,
                    temp_records,
                    "scada_history.db",
                )
                if len(pressure_records) >= 3 and len(temp_records) >= 3:
                    return preferred_candidate
    except Exception as exc:
        logger.warning("读取 scada_history.db 失败，回退主库: %s", exc)

    resolved_station, resolve_hint = _resolve_scada_station_name(
        session,
        station_ref,
        metric_types=("pressure", "temperature"),
    )
    if resolved_station:
        pressure_records = _fetch_scada_metric_records(
            session,
            resolved_station,
            "pressure",
            hours=hours,
        )
        temp_records = _fetch_scada_metric_records(
            session,
            resolved_station,
            "temperature",
            hours=hours,
        )
        fallback_candidate = (
            resolved_station,
            resolve_hint,
            pressure_records,
            temp_records,
            "smartgas.db",
        )
        if len(pressure_records) >= 3 and len(temp_records) >= 3:
            return fallback_candidate

    if preferred_candidate[0]:
        return preferred_candidate
    return fallback_candidate


def _build_history_action_token(
    station_name: str,
    *,
    view: str,
    hours: int,
    metric: str = "",
) -> str:
    safe_station = str(station_name or "").replace("|", " ").replace("]", " ").strip()
    safe_view = str(view or "pressure").replace("|", "").replace("]", "").strip() or "pressure"
    safe_metric = str(metric or "").replace("|", " ").replace("]", " ").strip()
    safe_hours = max(int(hours or 0), 0)
    return (
        f"[ACTION:OPEN_HISTORY_PANEL|station={safe_station}|view={safe_view}|hours={safe_hours}|metric={safe_metric}]"
    )


def _handle_predict_trend(args: dict, session: Session) -> str:
    """时序预测：线性回归估算超标剩余时间"""
    station_id = args.get("station_id", "")
    metric = args.get("metric", "pressure")
    hours = int(args.get("hours", 6))

    if not station_id:
        return "请提供站场名称"

    resolved_station, resolve_hint, records, data_source = _select_predict_dataset(
        session,
        station_id,
        metric,
        hours,
    )
    if not resolved_station:
        return f"目前查不到 {station_id} 的{metric}历史记录。{resolve_hint or '请确认站场全称。'}"

    if len(records) < 3:
        return (
            f"{resolved_station} 的 {metric} 历史数据点不足（仅 {len(records)} 条），无法进行趋势预测。"
            f"数据源: {data_source}"
        )

    # 将时间转换为小时偏移量，做线性回归 y = a*x + b
    t0 = records[0].recorded_at
    xs = [(r.recorded_at - t0).total_seconds() / 3600.0 for r in records]
    ys = [r.value for r in records]
    n = len(xs)

    sum_x = sum(xs)
    sum_y = sum(ys)
    sum_xy = sum(x * y for x, y in zip(xs, ys))
    sum_x2 = sum(x * x for x in xs)

    denom = n * sum_x2 - sum_x * sum_x
    if abs(denom) < 1e-10:
        return f"{resolved_station} 数据方差为0，无法回归"

    slope = (n * sum_xy - sum_x * sum_y) / denom  # MPa/h 或 °C/h
    intercept = (sum_y - slope * sum_x) / n

    current_val = ys[-1]
    current_time_h = xs[-1]

    # 查站场设计压力上限，优先走 raw_excel AI 索引
    design_limit = raw_excel_ai_index.get_design_pressure(resolved_station) or 12.0

    lines = [f"📊 {resolved_station} {metric} 趋势预测（基于近 {len(records)} 个数据点）："]
    if resolve_hint:
        lines.append(f"  站名命中说明: {resolve_hint}")
    lines.append(f"  数据源: {data_source}")
    lines.append(f"  当前值: {current_val:.3f} {'MPa' if metric == 'pressure' else '°C'}")
    direction = "上升" if slope > 0 else "下降"
    lines.append(f"  变化速率: {abs(slope):.4f}/h（{direction}趋势）")

    if metric == "pressure" and slope > 0.001:
        remaining_h = (design_limit - current_val) / slope
        if remaining_h > 0:
            hours_part = int(remaining_h)
            mins_part = int((remaining_h - hours_part) * 60)
            lines.append(f"  ⚠️ 预计 {hours_part}小时{mins_part}分钟 后触及设计上限 {design_limit} MPa")
        else:
            lines.append(f"  ❗ 当前值已超过设计上限 {design_limit} MPa！")
    elif metric == "pressure" and slope < -0.001:
        # 预测降至最低安全值（假设 3 MPa）
        min_safe = 3.0
        remaining_h = (current_val - min_safe) / abs(slope)
        if remaining_h > 0:
            hours_part = int(remaining_h)
            mins_part = int((remaining_h - hours_part) * 60)
            lines.append(f"  ⚠️ 预计 {hours_part}小时{mins_part}分钟 后降至最低安全线 {min_safe} MPa")
    else:
        lines.append("  趋势平稳，暂无超标风险")

    lines.extend(["", _build_history_action_token(resolved_station, view=metric, hours=hours, metric=metric)])
    return "\n".join(lines)


def _handle_analyze_correlation(args: dict, session: Session) -> str:
    """归因分析：计算压力与温度的皮尔逊相关系数，诊断异常"""
    station_id = args.get("station_id", "")
    hours = int(args.get("hours", 6))

    if not station_id:
        return "请提供站场名称"

    resolved_station, resolve_hint, pressure_records, temp_records, data_source = _select_correlation_dataset(
        session,
        station_id,
        hours,
    )
    if not resolved_station:
        return f"目前查不到 {station_id} 的压力或温度历史记录。{resolve_hint or '请确认站场全称。'}"

    if len(pressure_records) < 3 or len(temp_records) < 3:
        return (
            f"{resolved_station} 的压力或温度历史数据不足，无法进行相关性分析。"
            f"数据源: {data_source}"
        )

    # 按时间对齐（取交集时间戳）
    p_map = {r.recorded_at.isoformat(): r.value for r in pressure_records}
    t_map = {r.recorded_at.isoformat(): r.value for r in temp_records}
    common_times = sorted(set(p_map.keys()) & set(t_map.keys()))

    if len(common_times) < 3:
        # 如果时间点没有精确对齐，按顺序截取相同长度
        min_len = min(len(pressure_records), len(temp_records))
        p_vals = [r.value for r in pressure_records[:min_len]]
        t_vals = [r.value for r in temp_records[:min_len]]
    else:
        p_vals = [p_map[t] for t in common_times]
        t_vals = [t_map[t] for t in common_times]

    n = len(p_vals)

    # 计算皮尔逊相关系数
    mean_p = sum(p_vals) / n
    mean_t = sum(t_vals) / n
    cov = sum((p - mean_p) * (t - mean_t) for p, t in zip(p_vals, t_vals)) / n
    std_p = math.sqrt(sum((p - mean_p) ** 2 for p in p_vals) / n)
    std_t = math.sqrt(sum((t - mean_t) ** 2 for t in t_vals) / n)

    if std_p < 1e-10 or std_t < 1e-10:
        return f"{resolved_station} 数据无波动，无法计算相关性"

    r = cov / (std_p * std_t)

    # 分析压力变化趋势
    p_change = p_vals[-1] - p_vals[0]
    t_change = t_vals[-1] - t_vals[0]

    lines = [f"🔍 {resolved_station} 压力-温度相关性分析（{n} 个对齐数据点）："]
    if resolve_hint:
        lines.append(f"  站名命中说明: {resolve_hint}")
    lines.append(f"  数据源: {data_source}")
    lines.append(f"  压力范围: {min(p_vals):.3f} ~ {max(p_vals):.3f} MPa（变化: {p_change:+.3f}）")
    lines.append(f"  温度范围: {min(t_vals):.1f} ~ {max(t_vals):.1f} °C（变化: {t_change:+.1f}）")
    lines.append(f"  皮尔逊相关系数 r = {r:.4f}")

    # 诊断结论
    if r > 0.7:
        lines.append("  【诊断】压力与温度高度正相关，属正常热力学耦合")
    elif r < -0.7:
        lines.append("  【诊断】压力与温度强负相关，可能存在异常工况（如压缩机效率衰减）")
    elif abs(r) < 0.3:
        lines.append("  【诊断】压力与温度几乎无关，可能受外部因素（如下游调节阀操作）主导")

    # 特殊模式检测：压力升但温度降 → 典型憋压
    if p_change > 0.3 and t_change < -1.0:
        lines.append("  ⚠️ 【异常模式】压力上升但温度下降，疑似下游憋压或冰堵")
    elif p_change < -0.3 and t_change > 1.0:
        lines.append("  ⚠️ 【异常模式】压力下降但温度上升，疑似管线泄漏导致节流效应")

    lines.extend(["", _build_history_action_token(resolved_station, view="overview", hours=hours, metric="pressure-temperature")])
    return "\n".join(lines)


def _handle_simulate_cutoff(args: dict, session: Session) -> str:
    """截断推演：BFS 找受影响下游 + 管存时长估算"""
    station_id = args.get("station_id", "")
    if not station_id:
        return "请提供故障站场名称或 ID"

    topo = TopologyService(session)

    # 先按名称找到对应的图节点
    target_node = None
    for node_id, data in topo.graph.nodes(data=True):
        if data.get("name") == station_id or node_id == station_id:
            target_node = node_id
            break

    if target_node is None:
        return f"在拓扑图中未找到站场: {station_id}"

    # BFS 遍历：从故障节点出发，找所有可达的下游节点
    import networkx as nx
    # 获取所有从该节点可达的节点（不含自身）
    try:
        descendants = nx.descendants(topo.graph.to_undirected(), target_node)
    except Exception:
        # 如果图是无向的，直接用连通分量
        descendants = set()
        visited = set()
        queue = [target_node]
        while queue:
            current = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)
            for neighbor in topo.graph.neighbors(current):
                if neighbor not in visited:
                    queue.append(neighbor)
                    descendants.add(neighbor)

    if not descendants:
        return f"{station_id} 是末端站点，停机不会波及其他站场"

    # 整理受影响站点信息
    affected_stations = []
    total_linepack = 0.0
    for node_id in descendants:
        node_data = topo.graph.nodes.get(node_id, {})
        name = node_data.get("name", node_id)
        node_type = node_data.get("type", "unknown")
        affected_stations.append({"name": name, "type": node_type})

    # 估算管存（简化模型：按管线长度和管径估算体积）
    affected_edges = []
    for u, v, data in topo.graph.edges(data=True):
        if u in descendants or v in descendants or u == target_node or v == target_node:
            length = data.get("length_km", 10)
            diameter = data.get("diameter_mm", 1000)
            # 管存体积 = π * (d/2)^2 * L（简化，单位：万方）
            volume = math.pi * (diameter / 2000) ** 2 * length * 1000 / 10000
            total_linepack += volume
            affected_edges.append(data.get("name", f"{u}-{v}"))

    # 估算支撑时长（假设平均日消耗为管存的 5 倍 → 每小时消耗 = 管存/4.8）
    hourly_consumption = total_linepack / 4.8 if total_linepack > 0 else 0
    support_hours = total_linepack / hourly_consumption if hourly_consumption > 0 else 0

    # 分类统计
    type_map = {"source": "气源站", "compressor": "压气站", "distribution": "分输站", "valve": "阀室"}
    type_counts: dict[str, int] = {}
    for s in affected_stations:
        t = type_map.get(s["type"], s["type"])
        type_counts[t] = type_counts.get(t, 0) + 1

    lines = [f"🚨 截断推演结果 —— 假设 {station_id} 突发停机："]
    lines.append(f"\n📌 波及范围：下游共 {len(affected_stations)} 个站场受影响")
    for t, c in type_counts.items():
        lines.append(f"  - {t}: {c} 个")

    lines.append(f"\n📌 受影响站场清单：")
    for s in affected_stations[:15]:
        lines.append(f"  - {s['name']}（{type_map.get(s['type'], s['type'])}）")
    if len(affected_stations) > 15:
        lines.append(f"  ...还有 {len(affected_stations) - 15} 个未列出")

    lines.append(f"\n📌 管存估算：")
    lines.append(f"  - 受影响管段管存总量: {total_linepack:.1f} 万方")
    hours_part = int(support_hours)
    mins_part = int((support_hours - hours_part) * 60)
    lines.append(f"  - 预计可支撑下游: {hours_part}小时{mins_part}分钟")

    lines.append(f"\n【抢险建议】必须在 {hours_part}小时{mins_part}分钟 内完成倒换干线操作")

    return "\n".join(lines)


def _handle_run_steady_sim(args: dict, session: Session) -> str:
    pilot_id = str(args.get("pilot_id") or "mainline_zhongwei_jingbian").strip() or "mainline_zhongwei_jingbian"
    scenario_id = str(args.get("scenario_id") or "steady_base").strip() or "steady_base"
    initial_conditions_json = str(args.get("initial_conditions_json") or "").strip()

    solver_input = _build_solver_input_or_raise(pilot_id, session)
    initial_conditions_raw = json.loads(initial_conditions_json) if initial_conditions_json else None
    if isinstance(initial_conditions_raw, dict):
        if hasattr(InitialConditionsInput, "model_validate"):
            initial_conditions = InitialConditionsInput.model_validate(initial_conditions_raw)
        else:
            initial_conditions = InitialConditionsInput(**initial_conditions_raw)
    else:
        initial_conditions = initial_conditions_raw
    _apply_initial_conditions(solver_input, scenario_id, initial_conditions)
    result = solve_steady(seed=solver_input, scenario_id=scenario_id, pilot_id=pilot_id)
    payload = _finalize_result_payload(result.to_dict(), solver_input, pilot_id, scenario_id)
    saved = save_snapshot(payload, solver_input)
    evaluation = evaluate_simulation_result_text(saved.get("result") or payload)

    lines = [
        f"稳态仿真已完成：{saved['run_id']}",
        f"试点：{saved['pilot_id']}，场景：{saved['scenario_id']}，状态：{saved['solver_status']}，迭代：{saved['iterations']}",
        f"总供气：{saved['output_summary'].get('total_supply', 0):.1f} 万方/天",
        f"未满足需求：{saved['output_summary'].get('unserved_demand', 0):.1f} 万方/天",
        f"平均利用率：{saved['output_summary'].get('avg_utilization', 0) * 100:.1f}%",
        "AI 评价：",
        evaluation or "暂无可评价内容",
    ]
    return "\n".join(lines)


def _handle_evaluate_sim_result(args: dict, session: Session) -> str:
    run_id = str(args.get("run_id") or "").strip()
    pilot_id = str(args.get("pilot_id") or "").strip()
    overlay_json = str(args.get("overlay_json") or "").strip()
    baseline_run_id = str(args.get("baseline_run_id") or "").strip()

    if overlay_json:
        result_data = json.loads(overlay_json)
    elif run_id:
        snapshot = get_snapshot(run_id, pilot_id=pilot_id or None)
        result_data = snapshot.get("result") or snapshot
    else:
        return "请提供 run_id 或 overlay_json。"

    baseline_data = None
    if baseline_run_id:
        try:
            snapshot = get_snapshot(baseline_run_id, pilot_id=pilot_id or None)
            baseline_data = snapshot.get("result") or snapshot
        except Exception:
            baseline_data = None

    return evaluate_simulation_result_text(result_data, baseline_data)


def _json_result(title: str, payload: dict[str, Any]) -> str:
    return f"{title}\n{json.dumps(payload, ensure_ascii=False, indent=2)}"


def _handle_query_we1_data_alignment(args: dict, session: Session) -> str:
    report = get_we1_alignment_report(session)
    compact = {
        "pilot_id": report.get("pilot_id"),
        "scope": report.get("scope"),
        "database_sources": report.get("database_sources"),
        "integrity": report.get("integrity"),
        "flow_boundary": report.get("flow_boundary"),
        "sample_stations": [
            {
                "station": item.get("station"),
                "mapping": item.get("mapping"),
                "pressure_source_type": (item.get("pressure") or {}).get("source_type"),
                "scada_pressure_found": bool(
                    ((item.get("pressure") or {}).get("scada") or {}).get("pressure", {}).get("found")
                ),
                "we1_edge_count": len(item.get("connected_edges_we1") or []),
                "all_edge_count": len(item.get("connected_edges_all") or []),
            }
            for item in report.get("sample_stations", [])
        ],
    }
    return _json_result("WE1 数据库对照结果", compact)


def _handle_get_we1_pressure_profile(args: dict, session: Session) -> str:
    station_ref = str(args.get("station_ref") or args.get("station_id") or "").strip()
    if not station_ref:
        return "请提供 station_ref，例如 中卫、盐池、靖边 或 WE1-76。"
    payload = get_we1_pressure_profile(
        session,
        station_ref,
        run_id=str(args.get("run_id") or "").strip() or None,
        baseline_run_id=str(args.get("baseline_run_id") or "").strip() or None,
    )
    return _json_result("WE1 压力口径", payload)


def _handle_get_flow_direction(args: dict, session: Session) -> str:
    edge_ref = str(args.get("edge_id") or args.get("edge_ref") or "").strip()
    if not edge_ref:
        return "请提供 edge_id，例如 WE1-T-76。"
    payload = get_we1_flow_direction(
        session,
        edge_ref,
        run_id=str(args.get("run_id") or "").strip() or None,
    )
    return _json_result("WE1 管段流向", payload)


def _handle_query_topology_relation(args: dict, session: Session) -> str:
    station_ref = str(args.get("station_ref") or args.get("station_id") or "").strip()
    if not station_ref:
        return "请提供 station_ref，例如 中卫。"
    depth_raw = args.get("depth")
    try:
        depth = int(depth_raw or 20)
    except (TypeError, ValueError):
        depth = 20
    payload = query_we1_topology_relation(
        session,
        station_ref,
        target_ref=str(args.get("target_ref") or "").strip() or None,
        scope=str(args.get("scope") or "we1").strip() or "we1",
        depth=depth,
    )
    return _json_result("WE1 拓扑关系", payload)


def _handle_query_sim_flow_topology(args: dict, session: Session) -> str:
    try:
        top_n = int(args.get("top_n") or 5)
    except (TypeError, ValueError):
        top_n = 5
    payload = query_we1_sim_flow_topology(
        session,
        run_id=str(args.get("run_id") or "").strip() or None,
        baseline_run_id=str(args.get("baseline_run_id") or "").strip() or None,
        top_n=max(1, min(top_n, 20)),
    )
    return _json_result("WE1 仿真后流量拓扑", payload)


def _handle_explain_flow_topology_situation(args: dict, session: Session) -> str:
    payload = build_we1_flow_topology_explanation(
        session,
        run_id=str(args.get("run_id") or "").strip() or None,
        baseline_run_id=str(args.get("baseline_run_id") or "").strip() or None,
    )
    return _json_result("WE1 仿真人话归纳", payload)


# 工具名 → 处理函数的映射
TOOL_HANDLERS = {
    "universal_search": _handle_universal_search,
    "query_stations": _handle_query_stations,
    "get_station_details": _handle_get_station_details,
    "query_pipelines": _handle_query_pipelines,
    "count_by_type": _handle_count_by_type,
    "analyze_impact": _handle_analyze_impact,
    "find_routes": _handle_find_routes,
    "get_topology_summary": _handle_topology_summary,
    "find_critical_nodes": _handle_find_critical_nodes,
    "simulate_failure": _handle_simulate_failure,
    "search_knowledge_base": _handle_search_knowledge_base,
    "predict_trend": _handle_predict_trend,
    "analyze_correlation": _handle_analyze_correlation,
    "simulate_cutoff": _handle_simulate_cutoff,
    "run_steady_sim": _handle_run_steady_sim,
    "evaluate_sim_result": _handle_evaluate_sim_result,
    "query_we1_data_alignment": _handle_query_we1_data_alignment,
    "get_we1_pressure_profile": _handle_get_we1_pressure_profile,
    "get_flow_direction": _handle_get_flow_direction,
    "query_topology_relation": _handle_query_topology_relation,
    "query_sim_flow_topology": _handle_query_sim_flow_topology,
    "explain_flow_topology_situation": _handle_explain_flow_topology_situation,
    "query_users": _handle_query_users,
}


def _handle_compare_stations(args: dict, session: Session) -> str:
    import datetime as _dt
    raw_stations = args.get('stations', '')
    metric = str(args.get('metric') or 'all').strip().lower()
    hours = int(args.get('hours') or 24)

    station_names = [
        s.strip() for s in re.split(r'[,，、]', raw_stations) if s.strip()
    ][:5]

    if len(station_names) < 2:
        return '请至少提供两个站场名称，用逗号分隔，如：璒直分输站,中卫分输站'

    METRIC_LABEL = {
        'pressure': ('pressure', '压力', 'MPa'),
        'temperature': ('temperature', '温度', '°C'),
        'dewpoint': ('dewpoint', '水露点', '°C'),
    }

    if metric == 'all':
        selected_metrics = ['pressure', 'temperature', 'dewpoint']
    elif metric in METRIC_LABEL:
        selected_metrics = [metric]
    else:
        selected_metrics = ['pressure', 'temperature', 'dewpoint']

    def _fetch_one(station_ref: str, metric_type: str) -> dict:
        result: dict = {'station': station_ref, 'metric': metric_type, 'found': False}
        try:
            with Session(scada_history_engine) as sc:
                resolved, hint = _resolve_scada_station_name(
                    sc, station_ref, metric_types=(metric_type,)
                )
                if not resolved:
                    result['hint'] = hint or '未匹配到展场'
                    return result
                records = _fetch_scada_metric_records(sc, resolved, metric_type, hours=hours)
                if not records:
                    result['hint'] = '无历史数据'
                    return result
                values = [r.value for r in records]
                now_ts = records[-1].recorded_at
                cutoff6h = now_ts - _dt.timedelta(hours=6)
                recent = [r for r in records if r.recorded_at >= cutoff6h]
                delta6h = (recent[-1].value - recent[0].value) if len(recent) >= 2 else 0.0
                result.update({
                    'found': True, 'resolved': resolved, 'hint': hint or '',
                    'latest': values[-1], 'minimum': min(values),
                    'maximum': max(values), 'delta6h': delta6h, 'count': len(values),
                })
        except Exception as exc:
            logger.warning('compare_stations fetch failed: %s %s %s', station_ref, metric_type, exc)
        return result

    all_data: dict = {}
    for sname in station_names:
        all_data[sname] = {}
        for m in selected_metrics:
            all_data[sname][m] = _fetch_one(sname, m)

    output_lines = ['【多站对比】回溯 ' + str(hours) + 'h\n']
    dispatch: list = []

    for m in selected_metrics:
        _, label, unit = METRIC_LABEL[m]
        output_lines.append('## ' + label + '对比（' + unit + '）\n')
        output_lines.append('  站场                最新値    最小値    最大値    近6h变化    数据点')
        output_lines.append('-' * 62)

        valid: list = []
        for sname in station_names:
            r = all_data[sname][m]
            if not r.get('found'):
                hint_text = r.get('hint', '无数据')
                output_lines.append('  ' + sname + '  ---   ---    ---    [' + hint_text + ']')
            else:
                dname = r.get('resolved', sname)
                lat, lo, hi, d6, cnt = r['latest'], r['minimum'], r['maximum'], r['delta6h'], r['count']
                d6s = ('+' if d6 >= 0 else '') + (f'{d6:.3f}' if m == 'pressure' else f'{d6:.2f}')
                output_lines.append(f'  {dname:<16}{lat:>8.3f}  {lo:>8.3f}  {hi:>8.3f}  {d6s:>9}  {cnt:>5}')
                valid.append((dname, r))

        output_lines.append('')

        if valid:
            sorted_v = sorted(valid, key=lambda x: x[1]['latest'], reverse=True)
            hi_name, hi_r = sorted_v[0]
            lo_name, lo_r = sorted_v[-1]
            diff = hi_r['latest'] - lo_r['latest']
            if m == 'pressure':
                advice = (
                    '[压力] ' + hi_name + '最高(' + f"{hi_r['latest']:.3f}" + ' MPa)，'
                    + lo_name + '最低(' + f"{lo_r['latest']:.3f}" + ' MPa)，'
                    + ('压差 ' + f'{diff:.3f}' + ' MPa，建议关注来气量。'
                       if diff > 0.5 else '平衡，最大压差 ' + f'{diff:.3f}' + ' MPa。')
                )
            elif m == 'temperature':
                advice = (
                    '[温度] ' + hi_name + '最高(' + f"{hi_r['latest']:.1f}" + unit + ')，'
                    + lo_name + '最低(' + f"{lo_r['latest']:.1f}" + unit + ')，'
                    + ('温差' + f'{diff:.1f}' + unit + '，差异较大。'
                       if diff > 5 else '差多' + f'{diff:.1f}' + unit + '，正常。')
                )
            elif m == 'dewpoint':
                advice = (
                    '[水露点] ' + hi_name + '最高(' + f"{hi_r['latest']:.1f}" + unit + ')，'
                    + lo_name + '最低(' + f"{lo_r['latest']:.1f}" + unit + ')，'
                    + ('差値' + f'{diff:.1f}' + unit + '，请复核' + hi_name + '脱水效果。'
                       if diff > 3 else '相近，差値' + f'{diff:.1f}' + unit + '，正常。')
                )
            else:
                advice = '[' + label + '] 最高展场:' + hi_name + '，最低:' + lo_name
            dispatch.append(advice)

    if dispatch:
        output_lines.append('综合调度建议\n')
        for a in dispatch:
            output_lines.append('- ' + a)

    return '\n'.join(output_lines)


TOOL_HANDLERS['compare_stations'] = _handle_compare_stations
