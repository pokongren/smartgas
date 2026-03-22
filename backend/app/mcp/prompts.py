"""
SmartGas MCP Prompts 模块

定义供 AI 客户端调用的标准化业务处理模板。
包含故障影响分析、备选路径规划、管网概览等。
"""
from .core import mcp


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
        "需要包含：站场总数及分类统计、管线总数及分类统计、关键拓扑指标。\n"
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
