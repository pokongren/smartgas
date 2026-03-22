"""
SmartGas MCP Tools 模块

定义供 AI 客户端主动调用的工具节点。
包括：站场查询、管线查询、故障影响分析、备选路径搜索、推演等。
"""
from .core import mcp, _get_session
from app.services.assistant_tools import execute_tool


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
