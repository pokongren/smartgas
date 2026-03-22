"""
SmartGas MCP Core 模块

定义核心的 FastMCP 实例和数据库会话依赖。
"""
from mcp.server.fastmcp import FastMCP
from sqlmodel import Session

from app.database import engine

mcp = FastMCP(
    "SmartGas-Grid",
    instructions=(
        "SmartGas 智慧管网系统 MCP Server。"
        "提供天然气管网的站场查询、管线查询、故障影响分析、"
        "备选路径搜索、断流推演等能力。"
    ),
)


def _get_session() -> Session:
    """创建一个数据库会话，调用完需手动关闭"""
    return Session(engine)
