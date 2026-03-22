"""
SmartGas MCP Resources 模块

定义供 AI 客户端读取的数据资源。
包括：站场列表、管线列表、拓扑概览、系统状态等只读 JSON 数据。
"""
import json
from sqlmodel import select
from datetime import datetime

from .core import mcp, _get_session
from app.models import Station, Pipeline
from app.services.topology import TopologyService


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
    return json.dumps({
        "status": "Running",
        "database": "Connected",
        "simulation_engine": "Ready",
        "timestamp": datetime.now().isoformat()
    }, ensure_ascii=False, indent=2)
