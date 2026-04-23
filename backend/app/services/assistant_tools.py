"""
AI 助手工具注册表
将系统已有的查询、分析、推演能力封装为 AI 可调用的工具函数。
每个工具包含：名称、描述、参数定义、执行函数。
"""
import json
import logging
import math
import re
from typing import Any
from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.database import scada_history_engine
from app.services.raw_excel_ai_index import STATION_TYPE_LABELS, raw_excel_ai_index
from app.services.topology import TopologyService
from app.services.simulation_service import OptimizedSimulationEngine as SimulationEngine

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
# ============ 工具定义（供 AI System Prompt 使用） ============

TOOL_DEFINITIONS = [
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
    lines.append("你的系统接入了【三大知识库】：")
    lines.append("1. **AI 索引库**（raw_excel_index + JSON cache）：通过 query_stations 等工具进行精确检索；")
    lines.append("2. **规程向量库**（ChromaDB）：通过 search_knowledge_base 工具检索官方文档原文；")
    lines.append("3. **拓扑关系库**（NetworkX）：通过 analyze_impact, find_routes, simulate_failure, find_critical_nodes 进行图计算推理。\n")
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
        import traceback
        err_msg = traceback.format_exc()
        logger.error(f"知识库检索失败: {e}\n{err_msg}")
        return f"知识库检索工具执行出错: {str(e)}\n详细错误信息: {err_msg}"


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


# 工具名 → 处理函数的映射
TOOL_HANDLERS = {
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
