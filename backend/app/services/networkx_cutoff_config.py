from __future__ import annotations

from copy import deepcopy
from typing import Any


_NETWORKX_CUTOFF_DEMO_CONFIG: list[dict[str, Any]] = [
    {
        "aliases": {"jingbian", "靖边", "jb"},
        "edge_case": {
            "id": "jingbian",
            "label": "靖边站阀门边截断",
            "cutoff_node_ids": [],
            "description": "按靖边站内阀门动作只移除对应外部管段；西一线阀门截断不联动陕京线，陕京线只在对应陕京阀门关闭时参与展示。",
            "source": "WE1-91",
            "target": "WE1-181",
            "source_label": "西一77#阀室",
            "target_label": "白鹤末站",
        },
        "default_case": {
            "id": "jingbian",
            "label": "靖边枢纽截断",
            "cutoff_node_ids": ["WE1-92", "SJ2-1", "SJ4-1"],
            "cutoff_edge_ids": [],
            "source": "WE1-91",
            "target": "WE1-181",
            "source_label": "西一77#阀室",
            "target_label": "白鹤末站",
            "description": "移除西一靖边压气站、陕京二线靖边点、陕京四线靖边首站，观察西一线到华东末端是否仍有替代通路。",
        },
        "edge_cutoff_map": {
            "jb101": ["WE1-T-91"],
            "jb102": ["WE1-T-92"],
            "jb202": ["SJ2-T-1"],
            "jb301": ["SJ4-T-1"],
        },
        "stage_edge_map": {
            "we1": ["WE1-T-92"],
            "sj2": ["SJ2-T-1"],
            "sj4": ["SJ4-T-1"],
        },
        "edge_routes": {
            "jb202": {
                "source": "SJ2-1",
                "target": "SJ2-60",
                "source_label": "西一靖边压气站",
                "target_label": "陕二末端",
            },
            "sj2": {
                "source": "SJ2-1",
                "target": "SJ2-60",
                "source_label": "西一靖边压气站",
                "target_label": "陕二末端",
            },
            "jb301": {
                "source": "SJ4-1",
                "target": "SJ4-40",
                "source_label": "陕京靖边首站",
                "target_label": "陕四末端",
            },
            "sj4": {
                "source": "SJ4-1",
                "target": "SJ4-40",
                "source_label": "陕京靖边首站",
                "target_label": "陕四末端",
            },
        },
    },
    {
        "aliases": {"zhongwei", "中卫", "zw"},
        "edge_case": {
            "id": "zhongwei",
            "label": "中卫站阀门边截断",
            "cutoff_node_ids": [],
            "description": "按中卫站内阀门动作只移除对应外部管段，保留中卫枢纽节点和跨线联络，再计算可替代通路。",
            "source": "WE1-1",
            "target": "WE1-181",
            "source_label": "轮南压气站",
            "target_label": "白鹤末站",
        },
        "default_case": {
            "id": "zhongwei",
            "label": "中卫站拓扑截断",
            "cutoff_node_ids": ["WE1-76"],
            "cutoff_edge_ids": [],
            "source": "WE1-1",
            "target": "WE1-181",
            "source_label": "轮南压气站",
            "target_label": "白鹤末站",
            "description": "移除中卫压气站，观察西一线主干、二线联络和中贵线接入从中卫枢纽脱开后的全国网拓扑影响。",
        },
        "edge_cutoff_map": {
            "zw101": ["WE1-T-75"],
            "zw102": ["WE1-T-76"],
            "zw201": ["WE2-T-87"],
            "zw202": ["WE2-T-88"],
            "zw301": ["ZG-T-1"],
        },
        "stage_edge_map": {
            "we1": ["WE1-T-76"],
            "we2": ["WE2-T-88"],
            "zg": ["ZG-T-1"],
        },
        "edge_routes": {},
    },
    {
        "aliases": {"luzhi", "甪直", "lz"},
        "default_case": {
            "id": "luzhi",
            "label": "甪直站拓扑截断",
            "cutoff_node_ids": ["WE1-179", "JXLZ-11", "WE1-B10-1"],
            "cutoff_edge_ids": [],
            "source": "WE1-76",
            "target": "WE1-181",
            "source_label": "中卫压气站",
            "target_label": "白鹤末站",
            "description": "移除甪直分输站、甪直联络站和甪宝支线首站，观察华东末端附近干线、联络线和支线脱开后的拓扑影响。",
        },
    },
]


def resolve_networkx_cutoff_demo_case(station: str, *, stage: str = "all", valve_id: str = "") -> dict[str, Any]:
    key = station.strip().lower()
    valve_key = valve_id.strip().lower()
    stage_key = stage.strip().lower()

    for item in _NETWORKX_CUTOFF_DEMO_CONFIG:
        if key not in item["aliases"]:
            continue

        cutoff_edge_ids = (
            item.get("edge_cutoff_map", {}).get(valve_key)
            or item.get("stage_edge_map", {}).get(stage_key)
            or []
        )
        if cutoff_edge_ids and item.get("edge_case"):
            edge_case = deepcopy(item["edge_case"])
            edge_case["cutoff_edge_ids"] = list(cutoff_edge_ids)
            route_override = item.get("edge_routes", {}).get(valve_key) or item.get("edge_routes", {}).get(stage_key)
            if route_override:
                edge_case.update(route_override)
            return edge_case

        return deepcopy(item["default_case"])

    raise LookupError(f"暂未配置 {station} 的 NetworkX 截断演示")
