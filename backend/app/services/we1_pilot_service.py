from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
from typing import Any, Dict, List


PILOT_DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "pilots"


def _build_mainline_station_ids(start: int, end: int) -> List[str]:
    return [f"WE1-{idx}" for idx in range(start, end + 1)]


WE1_PILOTS: Dict[str, Dict[str, Any]] = {
    "zhongwei_shanghai_baihe": {
        "id": "zhongwei_shanghai_baihe",
        "system_id": "we1",
        "name": "主样板：中卫压气站 -> 上海白鹤末站",
        "summary": "打通西一线中卫到上海白鹤全段稳态仿真，覆盖中游压气站链、华东负荷和末端交付。",
        "recommended_scope": [
            "中卫压气站",
            "郑州压气站",
            "定远压气站",
            "白鹤末站",
        ],
        "benefits": [
            "覆盖中卫到华东末端完整主干",
            "压气站、分输站和末站链路连续",
            "适合展示全国图入口到局部仿真的主流程",
            "新 pilot 独立归档，不污染中卫到靖边旧快照",
        ],
        "focus": [
            "全段稳态",
            "华东末端负荷",
            "压气站停运",
            "末端限流",
        ],
        "seed_file": "we1_zhongwei_shanghai_baihe_seed.json",
        "layer_prefixes": ["WE1"],
        "station_ids": _build_mainline_station_ids(76, 181),
        "junction_candidate_station_ids": ["WE1-76", "WE1-127", "WE1-152", "WE1-181"],
        "scenario_templates": [
            {
                "id": "steady_base",
                "name": "常规稳态输气",
                "description": "验证中卫到上海白鹤全段主干方向、压力梯度和末端交付。",
            },
            {
                "id": "zhongwei_supply_pressure_drop",
                "name": "中卫出站压力下调",
                "description": "验证中卫边界压力降低后，全段压力和华东末端承接变化。",
            },
            {
                "id": "zhengzhou_compressor_offline",
                "name": "郑州压气站停运",
                "description": "验证中游关键压气站停运后，下游压力恢复能力。",
            },
            {
                "id": "east_china_peak_demand",
                "name": "华东末端负荷上调",
                "description": "验证苏锡常沪方向负荷抬升后的主干利用率和告警变化。",
            },
            {
                "id": "baihe_delivery_limited",
                "name": "白鹤末端交付受限",
                "description": "验证白鹤前最后管段限流后的末端交付能力。",
            },
        ],
        "data_requirements": {
            "nodes": [
                "role",
                "supply_max",
                "demand_nominal",
                "target_pressure_mpa",
                "min_pressure_mpa",
                "max_pressure_mpa",
            ],
            "edges": [
                "design_pressure_mpa",
                "start_pressure_mpa",
                "end_pressure_mpa",
                "roughness_mm",
                "max_flow",
                "direction_mode",
                "status",
            ],
            "devices": [
                "compressor_enabled",
                "compressor_ratio_or_target_pressure",
                "distribution_demand",
                "valve_status",
            ],
        },
    },
    "mainline_zhongwei_jingbian": {
        "id": "mainline_zhongwei_jingbian",
        "system_id": "we1",
        "name": "主样板：中卫压气站前后主干段",
        "summary": "先打通主干方向、主干压力、压气站链影响和中卫附近故障传播。",
        "recommended_scope": [
            "古浪压气站",
            "中卫压气站",
            "西一盐池压气站",
            "西一靖边压气站",
        ],
        "benefits": [
            "压气站链比较清楚",
            "主干连续性强",
            "中卫本身还是跨系统枢纽候选点",
            "适合验证主干方向、主干压力、故障传播",
        ],
        "focus": [
            "拓扑",
            "稳态求解",
            "枢纽逻辑",
        ],
        "seed_file": "we1_mainline_zhongwei_jingbian_seed.json",
        "layer_prefixes": ["WE1"],
        "station_ids": _build_mainline_station_ids(66, 92),
        "junction_candidate_station_ids": ["WE1-76"],
        "scenario_templates": [
            {
                "id": "steady_base",
                "name": "常规稳态输气",
                "description": "验证古浪到靖边主干方向、压力梯度和主干连续输气。",
            },
            {
                "id": "zhongwei_compressor_offline",
                "name": "中卫压气站停运",
                "description": "验证中卫压气站停运后，下游压力和主干流量变化。",
            },
            {
                "id": "zhongwei_trunk_break",
                "name": "中卫附近主干中断",
                "description": "验证中卫附近单段主干中断后的影响传播。",
            },
            {
                "id": "yanchi_jingbian_limited",
                "name": "盐池到靖边段限流",
                "description": "验证主干限流对下游供给和压力的影响。",
            },
        ],
        "data_requirements": {
            "nodes": [
                "role",
                "supply_max",
                "demand_nominal",
                "target_pressure_mpa",
                "min_pressure_mpa",
                "max_pressure_mpa",
            ],
            "edges": [
                "design_pressure_mpa",
                "start_pressure_mpa",
                "end_pressure_mpa",
                "roughness_mm",
                "max_flow",
                "direction_mode",
            ],
            "devices": [
                "compressor_ratio_or_target_pressure",
                "valve_status",
                "valve_opening",
            ],
        },
    },
    "zhengzhou_xuedian_changlv": {
        "id": "zhengzhou_xuedian_changlv",
        "system_id": "we1",
        "name": "辅样板：郑州压气站 -> 薛店分输站 -> 长铝支线",
        "summary": "先打通主干到支线分流、分输需求变化和末端负荷承接。",
        "recommended_scope": [
            "郑州压气站",
            "薛店分输站",
            "WE1-B1 长铝支线",
        ],
        "benefits": [
            "有明显分输场景",
            "有主干到支线的分流关系",
            "有末端负荷点",
            "范围不大，适合先做支线分配验证",
        ],
        "focus": [
            "主干分流",
            "支线供气",
            "末端负荷",
        ],
        "seed_file": "we1_zhengzhou_xuedian_changlv_seed.json",
        "layer_prefixes": ["WE1", "WE1-B1"],
        "station_ids": [
            "WE1-127",
            "WE1-128",
            "WE1-129",
            "WE1-130",
            "WE1-131",
            "WE1-B1-1",
            "WE1-B1-2",
        ],
        "junction_candidate_station_ids": ["WE1-127", "WE1-129"],
        "scenario_templates": [
            {
                "id": "steady_branch_base",
                "name": "常规分输",
                "description": "验证主干到薛店和长铝支线的基线分流。",
            },
            {
                "id": "xuedian_load_up",
                "name": "薛店负荷上调",
                "description": "验证薛店负荷提升后主干和支线分配变化。",
            },
            {
                "id": "changlv_load_up",
                "name": "长铝支线负荷上调",
                "description": "验证长铝末端拉升后支线供气变化。",
            },
            {
                "id": "branch_limited",
                "name": "支线限流",
                "description": "验证长铝支线限流或中断后的主干侧响应。",
            },
        ],
        "data_requirements": {
            "nodes": [
                "role",
                "supply_max",
                "demand_nominal",
                "target_pressure_mpa",
                "min_pressure_mpa",
            ],
            "edges": [
                "design_pressure_mpa",
                "roughness_mm",
                "max_flow",
                "direction_mode",
                "status",
            ],
            "devices": [
                "compressor_ratio_or_target_pressure",
                "distribution_demand",
                "valve_status",
            ],
        },
    },
}


def list_we1_pilots() -> List[Dict[str, Any]]:
    pilots: List[Dict[str, Any]] = []
    for pilot in WE1_PILOTS.values():
        pilots.append(
            {
                "id": pilot["id"],
                "system_id": pilot["system_id"],
                "name": pilot["name"],
                "summary": pilot["summary"],
                "recommended_scope": list(pilot["recommended_scope"]),
                "benefits": list(pilot["benefits"]),
                "focus": list(pilot["focus"]),
                "seed_file": pilot.get("seed_file"),
            }
        )
    return pilots


def get_we1_pilot_or_raise(pilot_id: str) -> Dict[str, Any]:
    pilot = WE1_PILOTS.get(pilot_id)
    if pilot is None:
        raise KeyError(pilot_id)
    return deepcopy(pilot)


def get_we1_pilot_seed_or_raise(pilot_id: str) -> Dict[str, Any]:
    pilot = get_we1_pilot_or_raise(pilot_id)
    seed_file = str(pilot.get("seed_file") or "").strip()
    if not seed_file:
        raise FileNotFoundError(f"pilot seed file is not configured: {pilot_id}")

    seed_path = PILOT_DATA_DIR / seed_file
    if not seed_path.exists():
        raise FileNotFoundError(str(seed_path))

    with seed_path.open("r", encoding="utf-8") as fp:
        seed = json.load(fp)

    return {
        "pilot_id": pilot["id"],
        "system_id": pilot["system_id"],
        "seed_file": seed_file,
        "seed_path": str(seed_path.relative_to(Path(__file__).resolve().parents[2])),
        "seed": seed,
    }


def _layer_prefix(layer: Dict[str, Any]) -> str:
    layer_id = str(layer.get("id") or "")
    parts = layer_id.split(":")
    if len(parts) >= 3:
        return parts[2]
    return str(layer.get("name") or "")


def _stable_token(value: str) -> List[Any]:
    parts: List[Any] = []
    buff = ""
    for ch in value:
        if ch.isdigit():
            buff += ch
            continue
        if buff:
            parts.append(int(buff))
            buff = ""
        parts.append(ch)
    if buff:
        parts.append(int(buff))
    return parts


def build_pilot_package(system_package: Dict[str, Any], pilot: Dict[str, Any]) -> Dict[str, Any]:
    allowed_station_ids = set(pilot["station_ids"])
    allowed_prefixes = set(pilot["layer_prefixes"])
    force_visible = pilot["id"] in {"mainline_zhongwei_jingbian", "zhongwei_shanghai_baihe"}

    filtered_layers: List[Dict[str, Any]] = []
    for layer in system_package.get("layers", []):
        prefix = _layer_prefix(layer)
        if prefix not in allowed_prefixes:
            continue

        lines = []
        used_node_ids = set()
        for line in layer.get("lines", []):
            start_id = str(line.get("startNodeId") or "")
            end_id = str(line.get("endNodeId") or "")
            if start_id in allowed_station_ids and end_id in allowed_station_ids:
                lines.append(deepcopy(line))
                used_node_ids.add(start_id)
                used_node_ids.add(end_id)

        nodes = []
        for node in layer.get("nodes", []):
            node_id = str(node.get("id") or "")
            if node_id in used_node_ids or node_id in allowed_station_ids:
                payload = deepcopy(node)
                if force_visible:
                    properties = dict(payload.get("properties") or {})
                    properties["forceVisible"] = True
                    payload["properties"] = properties
                nodes.append(payload)

        nodes.sort(key=lambda item: _stable_token(str(item.get("id") or "")))
        lines.sort(key=lambda item: _stable_token(str(item.get("id") or "")))

        if not nodes and not lines:
            continue

        filtered_layers.append(
            {
                **deepcopy(layer),
                "nodes": nodes,
                "lines": lines,
            }
        )

    node_count = sum(len(layer.get("nodes", [])) for layer in filtered_layers)
    line_count = sum(len(layer.get("lines", [])) for layer in filtered_layers)

    return {
        "id": system_package.get("id"),
        "name": system_package.get("name"),
        "color": system_package.get("color"),
        "pilot": {
            "id": pilot["id"],
            "name": pilot["name"],
            "summary": pilot["summary"],
            "recommended_scope": pilot["recommended_scope"],
            "benefits": pilot["benefits"],
            "focus": pilot["focus"],
            "seed_file": pilot.get("seed_file"),
            "junction_candidate_station_ids": pilot["junction_candidate_station_ids"],
        },
        "layers": filtered_layers,
        "summary": {
            "layer_count": len(filtered_layers),
            "node_count": node_count,
            "line_count": line_count,
        },
        "scenario_templates": deepcopy(pilot["scenario_templates"]),
        "data_requirements": deepcopy(pilot["data_requirements"]),
    }
