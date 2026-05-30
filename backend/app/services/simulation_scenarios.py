from __future__ import annotations

from copy import deepcopy
from typing import Any


ZHONGWEI_SOURCE_NODE_ID = "WE1-76"
ZHONGWEI_FIRST_TRUNK_EDGE_ID = "WE1-T-76"
ZHONGWEI_MULTI_SCENARIO_BASE_SCENARIO_ID = "steady_base"

_ZHONGWEI_MULTI_SCENARIO_CASES: list[dict[str, Any]] = [
    {
        "id": "zhongwei-3000",
        "label": "中卫 3000 万标方/天",
        "flow_text": "3000",
        "description": "基准供气工况，验证常规稳态能跑通。",
        "scenario_id": ZHONGWEI_MULTI_SCENARIO_BASE_SCENARIO_ID,
        "initial_input": {
            "node_overrides": [{
                "node_id": ZHONGWEI_SOURCE_NODE_ID,
                "supply_max": 3000,
                "nominal_flow": 3000,
                "supply_nominal": 3000,
                "target_pressure_mpa": 9.8,
            }],
        },
    },
    {
        "id": "zhongwei-2000",
        "label": "中卫 2000 万标方/天",
        "flow_text": "2000",
        "description": "上游供气下降工况，观察压力、流量和缺口变化。",
        "scenario_id": ZHONGWEI_MULTI_SCENARIO_BASE_SCENARIO_ID,
        "initial_input": {
            "node_overrides": [{
                "node_id": ZHONGWEI_SOURCE_NODE_ID,
                "supply_max": 2000,
                "nominal_flow": 2000,
                "supply_nominal": 2000,
                "target_pressure_mpa": 9.8,
            }],
        },
    },
    {
        "id": "zhongwei-cutoff",
        "label": "中卫截断",
        "flow_text": "0",
        "description": "上游首段关闭工况，演示故障传播和供气缺口。",
        "scenario_id": ZHONGWEI_MULTI_SCENARIO_BASE_SCENARIO_ID,
        "initial_input": {
            "node_overrides": [{
                "node_id": ZHONGWEI_SOURCE_NODE_ID,
                "supply_max": 0,
                "nominal_flow": 0,
                "supply_nominal": 0,
                "target_pressure_mpa": 0,
            }],
            "edge_overrides": [{
                "edge_id": ZHONGWEI_FIRST_TRUNK_EDGE_ID,
                "flow_rate": 0,
                "status": "closed",
            }],
        },
    },
]

DEFAULT_ZHONGWEI_MULTI_SCENARIO_IDS = [item["id"] for item in _ZHONGWEI_MULTI_SCENARIO_CASES]


def get_zhongwei_multi_scenario_cases() -> list[dict[str, Any]]:
    return deepcopy(_ZHONGWEI_MULTI_SCENARIO_CASES)
