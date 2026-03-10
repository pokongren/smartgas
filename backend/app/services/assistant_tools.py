"""
AI 助手工具注册表
将系统已有的查询、分析、推演能力封装为 AI 可调用的工具函数。
每个工具包含：名称、描述、参数定义、执行函数。
"""
import json
import logging
from typing import Any

from sqlmodel import Session, select, func

from app.models import Station, Pipeline
from app.services.topology import TopologyService
from app.services.simulation_service import OptimizedSimulationEngine as SimulationEngine

logger = logging.getLogger(__name__)


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
        "description": "专门用于检索《天然气管网操作规程》、《现场处置应急预案》等官方文档，以回答如何处理故障、参数对标、操作步骤等特定业务知识问题。",
        "parameters": {
            "query": {"description": "用户检索问题的关键字或完整句子", "required": True},
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
    lines.append("1. **业务数据库**（SQL）：通过 query_stations 等工具进行精确统计查询；")
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

    # 先按 ID 查，查不到再按名称精确匹配
    station = session.get(Station, station_id)
    if not station:
        station = session.exec(
            select(Station).where(Station.name == station_id)
        ).first()

    if not station:
        return f"未找到站场: {station_id}"

    type_map = {"source": "气源站", "compressor": "压气站", "distribution": "分输站", "valve": "阀室", "shared": "转供站"}
    lines = [f"站场详情 —— {station.name}（{type_map.get(station.type, station.type)}）"]
    lines.append(f"  ID: {station.id}")
    lines.append(f"  坐标: ({station.longitude}, {station.latitude})")
    lines.append(f"  设计压力: {station.design_pressure or '未知'} MPa")
    lines.append(f"  进站压力: {station.operating_pressure_in or '未知'} MPa")
    lines.append(f"  出站压力: {station.operating_pressure_out or '未知'} MPa")
    lines.append(f"  进站温度: {station.operating_temp_in or '未知'} °C")
    lines.append(f"  出站温度: {station.operating_temp_out or '未知'} °C")
    lines.append(f"  处理能力: {station.capacity or '未知'} 万方/天")
    return "\n".join(lines)



def _handle_query_stations(args: dict, session: Session) -> str:
    """查询站场"""
    stmt = select(Station)
    filters = []

    station_type = args.get("type")
    keyword = args.get("keyword")

    if station_type:
        stmt = stmt.where(Station.type == station_type)
        filters.append(f"类型={station_type}")
    if keyword:
        stmt = stmt.where(Station.name.contains(keyword))
        filters.append(f"名称含'{keyword}'")

    stations = session.exec(stmt).all()

    if not stations:
        filter_desc = "、".join(filters) if filters else "无过滤条件"
        return f"未找到符合条件的站场（{filter_desc}）"

    # 按类型分组统计
    type_map = {"source": "气源站", "compressor": "压气站", "distribution": "分输站", "valve": "阀室"}
    lines = [f"共找到 {len(stations)} 个站场：\n"]
    for s in stations[:20]:  # 最多显示 20 条，避免过长
        type_label = type_map.get(s.type, s.type)
        lines.append(f"  - {s.name}（{type_label}，ID: {s.id}）")

    if len(stations) > 20:
        lines.append(f"\n  ...还有 {len(stations) - 20} 个未显示")

    return "\n".join(lines)


def _handle_query_pipelines(args: dict, session: Session) -> str:
    """查询管线"""
    stmt = select(Pipeline)
    filters = []

    category = args.get("category")
    keyword = args.get("keyword")

    if category:
        stmt = stmt.where(Pipeline.category == category)
        filters.append(f"类别={category}")
    if keyword:
        stmt = stmt.where(Pipeline.name.contains(keyword))
        filters.append(f"名称含'{keyword}'")

    pipelines = session.exec(stmt).all()

    if not pipelines:
        filter_desc = "、".join(filters) if filters else "无过滤条件"
        return f"未找到符合条件的管线（{filter_desc}）"

    lines = [f"共找到 {len(pipelines)} 条管线：\n"]
    for p in pipelines[:20]:
        diameter = f"管径{p.diameter_mm}mm" if p.diameter_mm else ""
        length = f"长{p.length_km}km" if p.length_km else ""
        detail = ", ".join(filter(None, [diameter, length]))
        lines.append(f"  - {p.name}（{detail or '无详细参数'}，ID: {p.id}）")

    if len(pipelines) > 20:
        lines.append(f"\n  ...还有 {len(pipelines) - 20} 条未显示")

    return "\n".join(lines)


def _handle_count_by_type(args: dict, session: Session) -> str:
    """统计数量"""
    entity = args.get("entity", "station")

    if entity == "pipeline":
        pipelines = session.exec(select(Pipeline)).all()
        # 按 category 分组
        groups: dict[str, int] = {}
        for p in pipelines:
            cat = p.category or "未分类"
            groups[cat] = groups.get(cat, 0) + 1

        lines = [f"管线总数: {len(pipelines)} 条"]
        category_map = {"trunk": "干线", "branch": "支线"}
        for cat, count in groups.items():
            label = category_map.get(cat, cat)
            lines.append(f"  - {label}: {count} 条")
        return "\n".join(lines)
    else:
        stations = session.exec(select(Station)).all()
        groups: dict[str, int] = {}
        for s in stations:
            t = s.type or "未分类"
            groups[t] = groups.get(t, 0) + 1

        type_map = {"source": "气源站", "compressor": "压气站", "distribution": "分输站", "valve": "阀室"}
        lines = [f"站场总数: {len(stations)} 个"]
        for t, count in groups.items():
            label = type_map.get(t, t)
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
        return f"知识库检索工具执行出错: {str(e)}"


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
}
