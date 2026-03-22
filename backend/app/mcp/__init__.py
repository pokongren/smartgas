"""
SmartGas MCP 模块

聚合所有的工具、资源、提示词模板。
并向外暴露 FastAPI 的设置函数 `setup_mcp`。
"""
# 先加载各子模块，使修饰器注册生效
from . import tools, resources, prompts

# 暴露挂载函数
from .server import setup_mcp

__all__ = ["setup_mcp"]
