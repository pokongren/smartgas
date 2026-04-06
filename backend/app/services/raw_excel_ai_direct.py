from __future__ import annotations

import re
from typing import Any

from app.services.raw_excel_ai_index import STATION_TYPE_LABELS, raw_excel_ai_index


def try_direct_count_reply(message: str) -> str | None:
    request = _parse_direct_collection_request(message)
    if not request or not _user_asks_for_count(message):
        return None

    if request["kind"] == "stations":
        stations = raw_excel_ai_index.query_stations(
            station_type=request.get("station_type"),
            scope_name=request.get("scope_name"),
        )
        return _format_station_count_reply(
            stations=stations,
            label=request["label"],
            scope_label=request.get("scope_label"),
            user_message=message,
        )

    pipelines = raw_excel_ai_index.query_pipelines(
        kind=request.get("category"),
        scope_name=request.get("scope_name"),
    )
    return _format_pipeline_count_reply(
        pipelines=pipelines,
        label=request["label"],
        scope_label=request.get("scope_label"),
        user_message=message,
    )


def try_direct_list_reply(message: str) -> str | None:
    request = _parse_direct_collection_request(message)
    if not request:
        return None

    if request["kind"] == "stations":
        stations = raw_excel_ai_index.query_stations(
            station_type=request.get("station_type"),
            scope_name=request.get("scope_name"),
        )
        return _format_station_list_reply(
            stations=stations,
            label=request["label"],
            include_type=request.get("station_type") is None,
            scope_label=request.get("scope_label"),
            user_message=message,
        )

    pipelines = raw_excel_ai_index.query_pipelines(
        kind=request.get("category"),
        scope_name=request.get("scope_name"),
    )
    return _format_pipeline_list_reply(
        pipelines=pipelines,
        label=request["label"],
        scope_label=request.get("scope_label"),
        user_message=message,
    )


def try_direct_entity_lookup(message: str) -> str | None:
    entity_name = _extract_entity_lookup_name(message)
    if not entity_name:
        return None

    stations = raw_excel_ai_index.find_station_candidates(entity_name)
    if stations:
        best_station = raw_excel_ai_index.pick_best_station_candidate(entity_name, stations)
        if best_station:
            return _append_completeness_hint(
                _build_station_lookup_reply(best_station),
                message,
                is_complete=True,
                reason="已按 raw_excel_index 返回该对象的完整基础信息。",
            )
        names = "、".join(item.get("name", "") for item in stations[:5])
        return _append_completeness_hint(
            f"我先查了 AI 索引库，和“{entity_name}”接近的站场有：{names}。",
            message,
            is_complete=False,
            reason="当前只给了候选项，还没法确认你具体指的是哪一个。",
        )

    pipelines = raw_excel_ai_index.find_pipeline_candidates(entity_name)
    if pipelines:
        if len(pipelines) == 1:
            return _append_completeness_hint(
                _build_pipeline_lookup_reply(pipelines[0]),
                message,
                is_complete=True,
                reason="已按 raw_excel_index 返回该对象的完整基础信息。",
            )
        names = "、".join(item.get("name", "") for item in pipelines[:5])
        return _append_completeness_hint(
            f"我查到几个接近的管线名称：{names}。",
            message,
            is_complete=False,
            reason="当前只给了候选项，还没法确认你具体指的是哪一条。",
        )

    return _append_completeness_hint(
        f"我先查了 AI 索引库，当前没找到“{entity_name}”对应的站场或管线。"
        "如果你说的是简称、别名，或者少了“分输站/压气站”这类后缀，可以发完整名称我再查。",
        message,
        is_complete=True,
        reason="已按 raw_excel_index 索引完整检索，但没有找到匹配对象。",
    )


def _parse_direct_collection_request(message: str) -> dict[str, str] | None:
    if not (_user_asks_for_list(message) or _user_asks_for_count(message)):
        return None

    normalized = re.sub(r"\s+", "", message or "")
    scope = _extract_pipeline_scope(normalized)

    station_patterns = [
        ("compressor", "压气站"),
        ("distribution", "分输站"),
        ("source", "气源站"),
        ("valve", "阀室"),
    ]
    for station_type, label in station_patterns:
        if label in normalized:
            request = {"kind": "stations", "station_type": station_type, "label": label}
            if scope:
                request.update(scope)
            return request

    if "站场" in normalized or "站点" in normalized:
        request = {"kind": "stations", "label": "站场"}
        if scope:
            request.update(scope)
        return request

    pipeline_patterns = [("trunk", "干线"), ("branch", "支线")]
    for category, label in pipeline_patterns:
        if label in normalized:
            request = {"kind": "pipelines", "category": category, "label": label}
            if scope:
                request.update(scope)
            return request

    if "管线" in normalized or "管道" in normalized:
        request = {"kind": "pipelines", "label": "管线"}
        if scope:
            request.update(scope)
        return request

    return None


def _extract_pipeline_scope(message: str) -> dict[str, str] | None:
    system = raw_excel_ai_index.match_scope(message)
    if not system:
        return None
    return {"scope_name": str(system["name"]), "scope_label": str(system["name"])}


def _user_asks_for_count(message: str) -> bool:
    normalized = re.sub(r"\s+", "", message or "")
    patterns = (
        "多少",
        "多少个",
        "多少座",
        "多少条",
        "多少站",
        "几个",
        "几座",
        "几条",
        "数量",
        "总数",
        "总共有",
        "共有",
    )
    return any(pattern in normalized for pattern in patterns)


def _user_asks_for_list(message: str) -> bool:
    normalized = re.sub(r"\s+", "", message or "")
    patterns = (
        "列表",
        "清单",
        "列出",
        "有哪些",
        "全部",
        "完整",
        "所有",
    )
    return any(pattern in normalized for pattern in patterns)


def _format_station_list_reply(
    *,
    stations: list[dict[str, Any]],
    label: str,
    include_type: bool,
    scope_label: str | None,
    user_message: str,
) -> str:
    scoped_label = f"{scope_label}{label}" if scope_label else label
    if not stations:
        return _append_completeness_hint(
            f"当前 AI 索引库里没有查到{scoped_label}列表。",
            user_message,
            is_complete=True,
            reason="已按 raw_excel_index 索引完整检索，但没有匹配结果。",
        )

    lines = [f"{scoped_label}完整列表如下，共 {len(stations)} 座：", ""]
    lines.append("| 序号 | 名称 | ID | 类型 | 所属干线 | 所属支线 | 地理位置 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- |")
    for index, station in enumerate(stations, start=1):
        type_label = STATION_TYPE_LABELS.get(station.get("type_code"), station.get("type_label") or "站场")
        lines.append(
            f"| {index} | {station.get('name')} | {station.get('id')} | "
            f"{type_label if include_type else label} | "
            f"{'、'.join(station.get('systems', [])[:2]) or '未知'} | "
            f"{'、'.join(station.get('branches', [])[:2]) or '未知'} | "
            f"{station.get('location') or '未知'} |"
        )

    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"已按 raw_excel_index 返回完整列表，共 {len(stations)} 座。",
    )


def _format_pipeline_list_reply(
    *,
    pipelines: list[dict[str, Any]],
    label: str,
    scope_label: str | None,
    user_message: str,
) -> str:
    scoped_label = f"{scope_label}{label}" if scope_label else label
    if not pipelines:
        return _append_completeness_hint(
            f"当前 AI 索引库里没有查到{scoped_label}列表。",
            user_message,
            is_complete=True,
            reason="已按 raw_excel_index 索引完整检索，但没有匹配结果。",
        )

    lines = [f"{scoped_label}完整列表如下，共 {len(pipelines)} 条：", ""]
    lines.append("| 序号 | 名称 | ID | 类型 | 所属干线 | 连接关系 | 长度(km) | 设计压力(MPa) |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for index, pipeline in enumerate(pipelines, start=1):
        lines.append(
            f"| {index} | {pipeline.get('name')} | {pipeline.get('id')} | "
            f"{'干线' if pipeline.get('kind') == 'trunk' else '支线'} | "
            f"{pipeline.get('scope_name') or '未知'} | "
            f"{(pipeline.get('start_station') or '未知')} -> {(pipeline.get('end_station') or '未知')} | "
            f"{_format_optional_number(pipeline.get('length_km'), '')} | "
            f"{_format_optional_number(pipeline.get('design_pressure_mpa'), '')} |"
        )

    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"已按 raw_excel_index 返回完整列表，共 {len(pipelines)} 条。",
    )


def _format_station_count_reply(
    *,
    stations: list[dict[str, Any]],
    label: str,
    scope_label: str | None,
    user_message: str,
) -> str:
    scoped_label = f"{scope_label}{label}" if scope_label else label
    if not stations:
        return _append_completeness_hint(
            f"{scoped_label}共 0 座，当前 AI 索引库里没有匹配结果。",
            user_message,
            is_complete=True,
            reason="已按 raw_excel_index 索引完整检索，但没有匹配结果。",
        )

    lines = [f"{scoped_label}共 {len(stations)} 座。", ""]
    lines.append("| 序号 | 名称 | ID | 类型 | 所属干线 |")
    lines.append("| --- | --- | --- | --- | --- |")
    for index, station in enumerate(stations, start=1):
        lines.append(
            f"| {index} | {station.get('name')} | {station.get('id')} | "
            f"{station.get('type_label') or '站场'} | "
            f"{'、'.join(station.get('systems', [])[:2]) or '未知'} |"
        )

    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"已按 raw_excel_index 返回完整统计和明细，共 {len(stations)} 座。",
    )


def _format_pipeline_count_reply(
    *,
    pipelines: list[dict[str, Any]],
    label: str,
    scope_label: str | None,
    user_message: str,
) -> str:
    scoped_label = f"{scope_label}{label}" if scope_label else label
    if not pipelines:
        return _append_completeness_hint(
            f"{scoped_label}共 0 条，当前 AI 索引库里没有匹配结果。",
            user_message,
            is_complete=True,
            reason="已按 raw_excel_index 索引完整检索，但没有匹配结果。",
        )

    lines = [f"{scoped_label}共 {len(pipelines)} 条。", ""]
    lines.append("| 序号 | 名称 | ID | 类型 | 所属干线 | 连接关系 |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for index, pipeline in enumerate(pipelines, start=1):
        lines.append(
            f"| {index} | {pipeline.get('name')} | {pipeline.get('id')} | "
            f"{'干线' if pipeline.get('kind') == 'trunk' else '支线'} | "
            f"{pipeline.get('scope_name') or '未知'} | "
            f"{(pipeline.get('start_station') or '未知')} -> {(pipeline.get('end_station') or '未知')} |"
        )

    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"已按 raw_excel_index 返回完整统计和明细，共 {len(pipelines)} 条。",
    )


def _extract_entity_lookup_name(message: str) -> str | None:
    normalized = re.sub(r"[？?。！，,\s]+", "", message or "")
    if not normalized or len(normalized) > 24:
        return None

    prefix_pattern = r"^(?:帮我)?(?:看下|看看|查下|查查|说说|介绍下|介绍一下|请问)?"
    core = re.sub(prefix_pattern, "", normalized)

    patterns = [
        r"^(?P<name>.+?)(?:是什么站|是什么|是啥|啥意思|做什么的|是干什么的)$",
        r"^(?:介绍下|介绍一下|说说)(?P<name>.+)$",
    ]
    for pattern in patterns:
        match = re.match(pattern, core)
        if match:
            return _normalize_entity_name(match.group("name"))
    return None


def _normalize_entity_name(name: str) -> str:
    normalized = re.sub(r"(的情况|这个|这个站)$", "", name.strip())
    generic_names = {"站", "站场", "分输站", "压气站", "阀室", "清管站", "天然气站"}
    if normalized in generic_names:
        return ""
    return normalized


def _build_station_lookup_reply(station: dict[str, Any]) -> str:
    details = [
        f"{station.get('name')}是 AI 索引库里登记的一个{station.get('type_label') or '站场'}。",
        f"索引 ID 是 {station.get('id')}。",
    ]
    if station.get("systems"):
        details.append(f"所属干线是 {'、'.join(station.get('systems', []))}。")
    if station.get("branches"):
        details.append(f"关联支线有 {'、'.join(station.get('branches', []))}。")
    if station.get("location"):
        details.append(f"地理位置是 {station.get('location')}。")
    if station.get("compressor_unit_count"):
        details.append(f"压缩机组记录数 {station.get('compressor_unit_count')} 台。")
    if station.get("compressor_configs"):
        details.append(f"机组配置记录有 {'、'.join(station.get('compressor_configs', []))}。")
    return "".join(details)


def _build_pipeline_lookup_reply(pipeline: dict[str, Any]) -> str:
    category = "干线" if pipeline.get("kind") == "trunk" else "支线"
    details = [
        f"{pipeline.get('name')}是 AI 索引库里登记的一条{category}。",
        f"索引 ID 是 {pipeline.get('id')}。",
    ]
    if pipeline.get("scope_name"):
        details.append(f"所属干线是 {pipeline.get('scope_name')}。")
    if pipeline.get("length_km") is not None:
        details.append(f"长度约 {_format_optional_number(pipeline.get('length_km'), 'km')}。")
    if pipeline.get("design_pressure_mpa") is not None:
        details.append(f"设计压力约 {_format_optional_number(pipeline.get('design_pressure_mpa'), 'MPa')}。")
    if pipeline.get("start_station") or pipeline.get("end_station"):
        details.append(f"连接关系是 {pipeline.get('start_station') or '未知'} -> {pipeline.get('end_station') or '未知'}。")
    return "".join(details)


def _format_optional_number(value: float | None, unit: str) -> str:
    if value is None:
        return f"未知{unit}"
    if unit:
        return f"{value:.2f} {unit}"
    return f"{value:.2f}"


def _append_completeness_hint(reply: str, user_message: str, is_complete: bool, reason: str) -> str:
    if not reply:
        reply = "当前没有可返回的结果。"
    if "完整性提示：" in reply:
        return reply
    return f"{reply}\n\n完整性提示：{'是' if is_complete else '否'}，{reason}"
