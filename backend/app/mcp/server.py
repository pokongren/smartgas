"""
SmartGas MCP Server 挂载模块

负责将 MCP 实例作为 ASGI 应用挂载到 FastAPI 上，支持 SSE 连接。
"""
import logging
from typing import Any
from .core import mcp

logger = logging.getLogger(__name__)


def setup_mcp(app: Any) -> None:
    """
    将 MCP Server 挂载到 FastAPI 应用上。

    挂载后，MCP 客户端可通过 SSE 连接到 /mcp/... 端点，
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
