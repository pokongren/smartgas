"""
SmartGas MCP Tools 模块

定义供 AI 客户端主动调用的工具节点。
包括：站场查询、管线查询、故障影响分析、备选路径搜索、推演等。
"""
import json

from .core import mcp, _get_session
from app.services.assistant_tools import execute_tool
from app.routers.topology_simulation import (
    _apply_initial_conditions,
    _build_solver_input_or_raise,
    _finalize_result_payload,
)
from app.services.ai_sim_evaluator import evaluate_simulation_result_text
from app.services.topology_simulation import solve_steady
from app.services.we1_result_snapshot_service import get_snapshot, list_snapshots, save_snapshot


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


@mcp.tool()
def run_steady_sim(
    pilot_id: str = "mainline_zhongwei_jingbian",
    scenario_id: str = "steady_base",
    initial_conditions_json: str = "",
) -> str:
    """
    运行稳态仿真，并自动归档最新快照。

    @param pilot_id 试点 ID，默认主样板
    @param scenario_id 场景 ID
    @param initial_conditions_json 初值覆盖 JSON 字符串
    @returns 仿真结果摘要
    """
    with _get_session() as session:
        solver_input = _build_solver_input_or_raise(pilot_id, session)
        initial_conditions = None
        if initial_conditions_json.strip():
            initial_conditions = json.loads(initial_conditions_json)
        _apply_initial_conditions(solver_input, scenario_id, initial_conditions)
        result = solve_steady(seed=solver_input, scenario_id=scenario_id, pilot_id=pilot_id)
        payload = _finalize_result_payload(result.to_dict(), solver_input, pilot_id, scenario_id)
        saved = save_snapshot(payload, solver_input)
        evaluation = evaluate_simulation_result_text(saved["result"])
        return "\n".join([
            f"稳态仿真已完成：{saved['run_id']}",
            f"试点：{saved['pilot_id']}，场景：{saved['scenario_id']}，状态：{saved['solver_status']}，迭代：{saved['iterations']}",
            f"总供气：{saved['output_summary'].get('total_supply', 0):.1f}，未满足需求：{saved['output_summary'].get('unserved_demand', 0):.1f}，平均利用率：{saved['output_summary'].get('avg_utilization', 0) * 100:.1f}%",
            "AI 评价：",
            evaluation,
        ])


@mcp.tool()
def evaluate_sim_result(
    run_id: str = "",
    pilot_id: str = "",
    overlay_json: str = "",
    baseline_run_id: str = "",
) -> str:
    """
    评价稳态仿真结果，可按 run_id 或直接传 overlay JSON。

    @param run_id 快照 run_id
    @param pilot_id 试点 ID，配合 run_id 读取快照
    @param overlay_json 直接传入仿真结果 JSON
    @param baseline_run_id 对比基线快照 run_id
    @returns 人话评价
    """
    result_data: dict[str, object] | None = None
    baseline_data: dict[str, object] | None = None

    if overlay_json.strip():
        result_data = json.loads(overlay_json)
    elif run_id.strip():
        snapshot = get_snapshot(run_id.strip(), pilot_id=pilot_id.strip() or None)
        result_data = snapshot.get("result") or snapshot
    else:
        return "请提供 run_id 或 overlay_json。"

    if baseline_run_id.strip():
        try:
            baseline_snapshot = get_snapshot(baseline_run_id.strip(), pilot_id=pilot_id.strip() or None)
            baseline_data = baseline_snapshot.get("result") or baseline_snapshot
        except Exception:
            baseline_data = None

    evaluation = evaluate_simulation_result_text(result_data or {}, baseline_data)
    return evaluation or "暂时没有可评价的结果。"
