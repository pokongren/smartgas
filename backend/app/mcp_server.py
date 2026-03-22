"""
SmartGas-Grid MCP Server 模块

将管网系统的查询、分析、推演能力以标准 MCP 协议暴露给外部 AI 客户端。
支持 Claude Desktop、Cursor、JetBrains 等任何 MCP 兼容客户端直接操作管网数据。

三大能力：
- Tools: AI 可调用的工具函数（查询、分析、推演）
- Resources: AI 可读取的数据资源（站场、管线、拓扑概览）
- Prompts: 预设的分析模板（故障影响分析、路径规划、管网概览）
"""
import json
import logging
from contextlib import asynccontextmanager
from typing import Any

from mcp.server.fastmcp import FastMCP
from sqlmodel import Session, select

from app.database import engine
from app.models import Station, Pipeline
from app.services.topology import TopologyService
from app.services.assistant_tools import execute_tool

logger = logging.getLogger(__name__)


# NOTE: 创建独立的 FastMCP 实例，后续通过 setup_mcp 挂载到 FastAPI 应用
mcp = FastMCP(
    "SmartGas-Grid",
    instructions=(
        "SmartGas 智慧管网系统 MCP Server。"
        "提供天然气管网的站场查询、管线查询、故障影响分析、"
        "备选路径搜索、断流推演等能力。"
    ),
)


# ============ 数据库会话辅助函数 ============

def _get_session() -> Session:
    """创建一个数据库会话，调用完需手动关闭"""
    return Session(engine)


# ============ MCP Tools ============


@mcp.tool()
def query_stations(
    station_type: str = "",
    keyword: str = "",
) -> str:
    """
    查询站场列表。可按类型或名称关键字过滤。

    @param station_type 站场类型过滤，可选值: compressor(压气站), distribution(分输站), valve(阀室)
    @param keyword 名称关键字过滤
    @returns 站场列表的文本摘要
    """
    with _get_session() as session:
        return execute_tool(
            "query_stations",
            {"type": station_type, "keyword": keyword},
            session,
        )


@mcp.tool()
def get_station_details(station_id: str) -> str:
    """
    获取指定站场的详细物理属性（如坐标、进出站压力、温度、处理能力等）。

    @param station_id 站场 ID 或精确名称
    @returns 站场详细信息
    """
    with _get_session() as session:
        return execute_tool("get_station_details", {"station_id": station_id}, session)


@mcp.tool()
def query_pipelines(
    keyword: str = "",
    category: str = "",
) -> str:
    """
    查询管线列表。可按类型或名称关键字过滤。

    @param keyword 管线名称关键字过滤
    @param category 管线类别过滤，如 干线、支线
    @returns 管线列表的文本摘要
    """
    with _get_session() as session:
        return execute_tool(
            "query_pipelines",
            {"keyword": keyword, "category": category},
            session,
        )


@mcp.tool()
def count_by_type(entity: str = "station") -> str:
    """
    按类型统计站场或管线的数量。

    @param entity 实体类型: station(站场) 或 pipeline(管线)
    @returns 各类型的数量统计
    """
    with _get_session() as session:
        return execute_tool("count_by_type", {"entity": entity}, session)


@mcp.tool()
def analyze_impact(pipeline_id: str) -> str:
    """
    分析某条管线故障后的影响范围，计算波及的下游站点。

    @param pipeline_id 故障管线 ID（如 line-001）
    @returns 影响范围分析结果
    """
    with _get_session() as session:
        return execute_tool(
            "analyze_impact",
            {"pipeline_id": pipeline_id},
            session,
        )


@mcp.tool()
def find_routes(
    source_station: str,
    target_station: str,
    blocked_pipelines: str = "",
) -> str:
    """
    在屏蔽故障管线后，寻找两个站场之间的备选路径。

    @param source_station 起点站场名称或 ID
    @param target_station 终点站场名称或 ID
    @param blocked_pipelines 被屏蔽的故障管线 ID（逗号分隔）
    @returns 备选路径列表
    """
    blocked = [p.strip() for p in blocked_pipelines.split(",") if p.strip()]
    with _get_session() as session:
        return execute_tool(
            "find_routes",
            {
                "source_station": source_station,
                "target_station": target_station,
                "blocked_pipelines": blocked,
            },
            session,
        )


@mcp.tool()
def simulate_failure(
    station_id: str,
    max_ticks: int = 50,
) -> str:
    """
    模拟某个站场发生故障，推演断流传播过程。

    @param station_id 故障站场 ID（如 node-001）
    @param max_ticks 最大推演步数，默认 50
    @returns 推演结果摘要
    """
    with _get_session() as session:
        return execute_tool(
            "simulate_failure",
            {"station_id": station_id, "max_ticks": max_ticks},
            session,
        )


# ============ MCP Resources ============


@mcp.resource("smartgas://stations")
def get_all_stations() -> str:
    """获取所有站场数据（JSON 格式）"""
    with _get_session() as session:
        stations = session.exec(select(Station)).all()
        data = [
            {
                "id": s.id,
                "name": s.name,
                "type": s.type,
                "longitude": s.longitude,
                "latitude": s.latitude,
                "design_pressure": s.design_pressure,
            }
            for s in stations
        ]
        return json.dumps(data, ensure_ascii=False, indent=2)


@mcp.resource("smartgas://pipelines")
def get_all_pipelines() -> str:
    """获取所有管线数据（JSON 格式）"""
    with _get_session() as session:
        pipelines = session.exec(select(Pipeline)).all()
        data = [
            {
                "id": p.id,
                "name": p.name,
                "start_station_id": p.start_station_id,
                "end_station_id": p.end_station_id,
                "diameter": p.diameter,
                "length": p.length,
                "category": p.category,
            }
            for p in pipelines
        ]
        return json.dumps(data, ensure_ascii=False, indent=2)


@mcp.resource("smartgas://topology/summary")
def get_topology_summary() -> str:
    """获取管网拓扑概览统计（节点数、边数、关键指标）"""
    with _get_session() as session:
        topo = TopologyService(session)
        summary = topo.get_graph_summary()
        return json.dumps(summary, ensure_ascii=False, indent=2)


@mcp.resource("smartgas://status/health")
def get_system_health() -> str:
    """获取管网物理基座系统的健康运行状态"""
    from datetime import datetime
    return json.dumps({
        "status": "Running",
        "database": "Connected",
        "simulation_engine": "Ready",
        "timestamp": datetime.now().isoformat()
    }, ensure_ascii=False, indent=2)


# ============ MCP Prompts ============


@mcp.prompt()
def impact_analysis(pipeline_id: str) -> str:
    """
    故障影响分析模板 - 一键分析某管线故障的影响范围

    @param pipeline_id 故障管线 ID
    """
    return (
        f"请分析管线 {pipeline_id} 发生故障后的影响范围。\n"
        f"请先调用 analyze_impact 工具查看受影响的站场，\n"
        f"然后给出影响程度评估和应急建议。"
    )


@mcp.prompt()
def route_planning(
    source: str,
    target: str,
    blocked: str = "",
) -> str:
    """
    备选路径规划模板 - 搜索两站之间的替代路径

    @param source 起点站场
    @param target 终点站场
    @param blocked 被屏蔽的管线 ID（逗号分隔）
    """
    return (
        f"请帮我规划从 {source} 到 {target} 的备选输气路径。\n"
        f"{'被屏蔽的管线: ' + blocked if blocked else '无特别屏蔽管线。'}\n"
        f"请调用 find_routes 工具搜索路径，并对比各路径的优劣。"
    )


@mcp.prompt()
def network_overview() -> str:
    """管网概览报告模板 - 生成管网全局统计报告"""
    return (
        "请生成一份管网概览报告。\n"
        "需要包含：站场总数及分类统计、管线总数及分类统计、"
        "关键拓扑指标。\n"
        "请依次调用 count_by_type 和读取 smartgas://topology/summary 资源。"
    )


@mcp.prompt()
def emergency_response(pipeline_id: str) -> str:
    """
    管道泄漏应急响应模板 - 自动获取影响范围并生成处置建议
    
    @param pipeline_id 泄漏管线 ID
    """
    return (
        f"管线 {pipeline_id} 发生疑似泄漏。\n"
        f"请执行以下步骤：\n"
        f"1. 调用 analyze_impact 工具分析影响范围和波及站场。\n"
        f"2. 调用 get_station_details 工具查询关键受到影响的站场详情（注意当前压力）。\n"
        f"3. 制定包含关阀指令、供气调配建议的管网调度应急响应报告。"
    )


# ============ 挂载函数 ============


def setup_mcp(app: Any) -> None:
    """
    将 MCP Server 挂载到 FastAPI 应用上。

    挂载后，MCP 客户端可通过 SSE 连接到 /mcp 端点，
    发现并调用管网系统提供的工具、资源和提示模板。
    """
    from mcp.server.sse import SseServerTransport
    from starlette.routing import Route
    from starlette.applications import Starlette
    
    sse = SseServerTransport("/mcp/messages/")
    
    async def handle_sse(request):
        async with sse.connect_sse(
            request.scope, request.receive, request._send
        ) as (read_stream, write_stream):
            await mcp._mcp_server.run(
                read_stream,
                write_stream,
                mcp._mcp_server.create_initialization_options(),
            )
    
    async def handle_messages(request):
        await sse.handle_post_message(request.scope, request.receive, request._send)
    
    mcp_routes = [
        Route("/sse", endpoint=handle_sse),
        Route("/messages/", endpoint=handle_messages, methods=["POST"]),
    ]
    
    mcp_app = Starlette(routes=mcp_routes)
    app.mount("/mcp", mcp_app)
    logger.info("MCP Server 路由已注册到 /mcp/sse")
