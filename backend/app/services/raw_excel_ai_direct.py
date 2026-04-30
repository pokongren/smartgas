from __future__ import annotations

import re
from typing import Any

from app.services.raw_excel_ai_index import STATION_TYPE_LABELS, raw_excel_ai_index

RAW_EXCEL_SOURCE_LABEL = "raw_excel_index \u9759\u6001\u7d22\u5f15"
RAW_EXCEL_TIME_RANGE_LABEL = "\u5f53\u524d\u4ed3\u5e93\u7d22\u5f15\u5feb\u7167\uff0c\u975e\u5b9e\u65f6 SCADA \u65f6\u95f4\u7a97"

TEXT_COMPRESSOR = "\u538b\u6c14\u7ad9"
TEXT_DISTRIBUTION = "\u5206\u8f93\u7ad9"
TEXT_SOURCE = "\u6c14\u6e90\u7ad9"
TEXT_VALVE = "\u9600\u5ba4"
TEXT_STATION = "\u7ad9\u573a"
TEXT_STATION_POINT = "\u7ad9\u70b9"
TEXT_TRUNK = "\u5e72\u7ebf"
TEXT_BRANCH = "\u652f\u7ebf"
TEXT_PIPELINE = "\u7ba1\u7ebf"
TEXT_PIPE = "\u7ba1\u9053"
TEXT_UNKNOWN = "\u672a\u77e5"


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
                reason="\u5df2\u6309 raw_excel_index \u8fd4\u56de\u8be5\u5bf9\u8c61\u7684\u57fa\u7840\u4fe1\u606f\u548c\u8bc1\u636e\u8bf4\u660e\u3002",
            )

        names = "\u3001".join(item.get("name", "") for item in stations[:5] if item.get("name"))
        return _append_completeness_hint(
            f"\u6211\u5148\u67e5\u4e86 AI \u7d22\u5f15\u5e93\uff0c\u548c\u201c{entity_name}\u201d\u63a5\u8fd1\u7684\u7ad9\u573a\u6709\uff1a{names}\u3002",
            message,
            is_complete=False,
            reason="\u5f53\u524d\u53ea\u7ed9\u4e86\u5019\u9009\u9879\uff0c\u8fd8\u6ca1\u6cd5\u786e\u8ba4\u4f60\u5177\u4f53\u6307\u7684\u662f\u54ea\u4e00\u4e2a\u3002",
        )

    pipelines = raw_excel_ai_index.find_pipeline_candidates(entity_name)
    if pipelines:
        if len(pipelines) == 1:
            return _append_completeness_hint(
                _build_pipeline_lookup_reply(pipelines[0]),
                message,
                is_complete=True,
                reason="\u5df2\u6309 raw_excel_index \u8fd4\u56de\u8be5\u5bf9\u8c61\u7684\u57fa\u7840\u4fe1\u606f\u548c\u8bc1\u636e\u8bf4\u660e\u3002",
            )

        names = "\u3001".join(item.get("name", "") for item in pipelines[:5] if item.get("name"))
        return _append_completeness_hint(
            f"\u6211\u67e5\u5230\u51e0\u4e2a\u63a5\u8fd1\u7684\u7ba1\u7ebf\u540d\u79f0\uff1a{names}\u3002",
            message,
            is_complete=False,
            reason="\u5f53\u524d\u53ea\u7ed9\u4e86\u5019\u9009\u9879\uff0c\u8fd8\u6ca1\u6cd5\u786e\u8ba4\u4f60\u5177\u4f53\u6307\u7684\u662f\u54ea\u4e00\u6761\u3002",
        )

    return _append_completeness_hint(
        (
            f"\u6211\u5148\u67e5\u4e86 AI \u7d22\u5f15\u5e93\uff0c\u5f53\u524d\u6ca1\u627e\u5230\u201c{entity_name}\u201d\u5bf9\u5e94\u7684\u7ad9\u573a\u6216\u7ba1\u7ebf\u3002"
            "\u5982\u679c\u4f60\u8bf4\u7684\u662f\u7b80\u79f0\u3001\u522b\u540d\uff0c\u6216\u8005\u5c11\u4e86\u201c\u5206\u8f93\u7ad9/\u538b\u6c14\u7ad9\u201d\u8fd9\u7c7b\u540e\u7f00\uff0c\u53ef\u4ee5\u53d1\u5b8c\u6574\u540d\u79f0\u6211\u518d\u67e5\u3002"
        ),
        message,
        is_complete=True,
        reason="\u5df2\u6309 raw_excel_index \u5b8c\u6574\u68c0\u7d22\uff0c\u4f46\u6ca1\u6709\u627e\u5230\u5339\u914d\u5bf9\u8c61\u3002",
    )


def _parse_direct_collection_request(message: str) -> dict[str, str] | None:
    if not (_user_asks_for_list(message) or _user_asks_for_count(message)):
        return None

    normalized = re.sub(r"\s+", "", message or "")
    scope = _extract_pipeline_scope(normalized)

    station_patterns = [
        ("compressor", (TEXT_COMPRESSOR, "压缩机", "机组", "压机")),
        ("distribution", (TEXT_DISTRIBUTION, "分输口", "用户", "下载点")),
        ("source", (TEXT_SOURCE,)),
        ("valve", (TEXT_VALVE, "阀厅")),
    ]
    for station_type, labels in station_patterns:
        if any(alias in normalized for alias in labels):
            label = labels[0]
            request = {"kind": "stations", "station_type": station_type, "label": label}
            if scope:
                request.update(scope)
            return request

    if TEXT_STATION in normalized or TEXT_STATION_POINT in normalized:
        request = {"kind": "stations", "label": TEXT_STATION}
        if scope:
            request.update(scope)
        return request

    pipeline_patterns = [("trunk", TEXT_TRUNK), ("branch", TEXT_BRANCH)]
    for category, label in pipeline_patterns:
        if label in normalized:
            request = {"kind": "pipelines", "category": category, "label": label}
            if scope:
                request.update(scope)
            return request

    if TEXT_PIPELINE in normalized or TEXT_PIPE in normalized:
        request = {"kind": "pipelines", "label": TEXT_PIPELINE}
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
        "\u591a\u5c11",
        "\u591a\u5c11\u4e2a",
        "\u591a\u5c11\u5ea7",
        "\u591a\u5c11\u6761",
        "\u591a\u5c11\u7ad9",
        "\u51e0\u4e2a",
        "\u51e0\u5ea7",
        "\u51e0\u6761",
        "\u6570\u91cf",
        "\u603b\u6570",
        "\u603b\u5171",
        "\u5171\u6709",
    )
    return any(pattern in normalized for pattern in patterns)


def _user_asks_for_list(message: str) -> bool:
    normalized = re.sub(r"\s+", "", message or "")
    patterns = (
        "\u5217\u8868",
        "\u6e05\u5355",
        "\u5217\u51fa",
        "\u6709\u54ea\u4e9b",
        "\u5168\u90e8",
        "\u5b8c\u6574",
        "\u6240\u6709",
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
            f"\u5f53\u524d AI \u7d22\u5f15\u5e93\u91cc\u6ca1\u6709\u67e5\u5230{scoped_label}\u5217\u8868\u3002",
            user_message,
            is_complete=True,
            reason="\u5df2\u6309 raw_excel_index \u5b8c\u6574\u68c0\u7d22\uff0c\u4f46\u6ca1\u6709\u5339\u914d\u7ed3\u679c\u3002",
        )

    lines = [f"{scoped_label}\u5b8c\u6574\u5217\u8868\u5982\u4e0b\uff0c\u5171 {len(stations)} \u5ea7\uff1a", ""]
    lines.append("| \u5e8f\u53f7 | \u540d\u79f0 | ID | \u7c7b\u578b | \u6240\u5c5e\u5e72\u7ebf | \u6240\u5c5e\u652f\u7ebf | \u5730\u7406\u4f4d\u7f6e |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- |")
    for index, station in enumerate(stations, start=1):
        type_label = STATION_TYPE_LABELS.get(station.get("type_code"), station.get("type_label") or TEXT_STATION)
        lines.append(
            f"| {index} | {station.get('name')} | {station.get('id')} | "
            f"{type_label if include_type else label} | "
            f"{'、'.join(station.get('systems', [])[:2]) or TEXT_UNKNOWN} | "
            f"{'、'.join(station.get('branches', [])[:2]) or TEXT_UNKNOWN} | "
            f"{station.get('location') or TEXT_UNKNOWN} |"
        )

    lines.append(
        _build_evidence_block(
            sample_size=f"{len(stations)} \u6761\u7ad9\u573a\u7d22\u5f15\u8bb0\u5f55",
            key_values=[
                f"\u7ed3\u679c\u603b\u6570 {len(stations)}",
                f"\u5bf9\u8c61\u7c7b\u578b {scoped_label}",
                f"\u9996\u6761\u8bb0\u5f55 {stations[0].get('name') or TEXT_UNKNOWN}",
            ],
        )
    )
    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"\u5df2\u6309 raw_excel_index \u8fd4\u56de\u5b8c\u6574\u5217\u8868\uff0c\u5171 {len(stations)} \u5ea7\u3002",
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
            f"\u5f53\u524d AI \u7d22\u5f15\u5e93\u91cc\u6ca1\u6709\u67e5\u5230{scoped_label}\u5217\u8868\u3002",
            user_message,
            is_complete=True,
            reason="\u5df2\u6309 raw_excel_index \u5b8c\u6574\u68c0\u7d22\uff0c\u4f46\u6ca1\u6709\u5339\u914d\u7ed3\u679c\u3002",
        )

    lines = [f"{scoped_label}\u5b8c\u6574\u5217\u8868\u5982\u4e0b\uff0c\u5171 {len(pipelines)} \u6761\uff1a", ""]
    lines.append("| \u5e8f\u53f7 | \u540d\u79f0 | ID | \u7c7b\u578b | \u6240\u5c5e\u5e72\u7ebf | \u8fde\u63a5\u5173\u7cfb | \u957f\u5ea6(km) | \u8bbe\u8ba1\u538b\u529b(MPa) |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for index, pipeline in enumerate(pipelines, start=1):
        lines.append(
            f"| {index} | {pipeline.get('name')} | {pipeline.get('id')} | "
            f"{TEXT_TRUNK if pipeline.get('kind') == 'trunk' else TEXT_BRANCH} | "
            f"{pipeline.get('scope_name') or TEXT_UNKNOWN} | "
            f"{(pipeline.get('start_station') or TEXT_UNKNOWN)} -> {(pipeline.get('end_station') or TEXT_UNKNOWN)} | "
            f"{_format_optional_number(pipeline.get('length_km'), '')} | "
            f"{_format_optional_number(pipeline.get('design_pressure_mpa'), '')} |"
        )

    lines.append(
        _build_evidence_block(
            sample_size=f"{len(pipelines)} \u6761\u7ba1\u7ebf\u7d22\u5f15\u8bb0\u5f55",
            key_values=[
                f"\u7ed3\u679c\u603b\u6570 {len(pipelines)}",
                f"\u5bf9\u8c61\u7c7b\u578b {scoped_label}",
                f"\u9996\u6761\u8bb0\u5f55 {pipelines[0].get('name') or TEXT_UNKNOWN}",
            ],
        )
    )
    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"\u5df2\u6309 raw_excel_index \u8fd4\u56de\u5b8c\u6574\u5217\u8868\uff0c\u5171 {len(pipelines)} \u6761\u3002",
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
            f"{scoped_label}\u5171 0 \u5ea7\uff0c\u5f53\u524d AI \u7d22\u5f15\u5e93\u91cc\u6ca1\u6709\u5339\u914d\u7ed3\u679c\u3002",
            user_message,
            is_complete=True,
            reason="\u5df2\u6309 raw_excel_index \u5b8c\u6574\u68c0\u7d22\uff0c\u4f46\u6ca1\u6709\u5339\u914d\u7ed3\u679c\u3002",
        )

    lines = [f"{scoped_label}\u5171 {len(stations)} \u5ea7\u3002", ""]
    lines.append("| \u5e8f\u53f7 | \u540d\u79f0 | ID | \u7c7b\u578b | \u6240\u5c5e\u5e72\u7ebf |")
    lines.append("| --- | --- | --- | --- | --- |")
    for index, station in enumerate(stations, start=1):
        lines.append(
            f"| {index} | {station.get('name')} | {station.get('id')} | "
            f"{station.get('type_label') or TEXT_STATION} | "
            f"{'、'.join(station.get('systems', [])[:2]) or TEXT_UNKNOWN} |"
        )

    lines.append(
        _build_evidence_block(
            sample_size=f"{len(stations)} \u6761\u7ad9\u573a\u7d22\u5f15\u8bb0\u5f55",
            key_values=[
                f"\u7edf\u8ba1\u7ed3\u679c {len(stations)}",
                f"\u5bf9\u8c61\u7c7b\u578b {scoped_label}",
                f"\u9996\u6761\u8bb0\u5f55 {stations[0].get('name') or TEXT_UNKNOWN}",
            ],
        )
    )
    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"\u5df2\u6309 raw_excel_index \u8fd4\u56de\u5b8c\u6574\u7edf\u8ba1\u548c\u660e\u7ec6\uff0c\u5171 {len(stations)} \u5ea7\u3002",
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
            f"{scoped_label}\u5171 0 \u6761\uff0c\u5f53\u524d AI \u7d22\u5f15\u5e93\u91cc\u6ca1\u6709\u5339\u914d\u7ed3\u679c\u3002",
            user_message,
            is_complete=True,
            reason="\u5df2\u6309 raw_excel_index \u5b8c\u6574\u68c0\u7d22\uff0c\u4f46\u6ca1\u6709\u5339\u914d\u7ed3\u679c\u3002",
        )

    lines = [f"{scoped_label}\u5171 {len(pipelines)} \u6761\u3002", ""]
    lines.append("| \u5e8f\u53f7 | \u540d\u79f0 | ID | \u7c7b\u578b | \u6240\u5c5e\u5e72\u7ebf | \u8fde\u63a5\u5173\u7cfb |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for index, pipeline in enumerate(pipelines, start=1):
        lines.append(
            f"| {index} | {pipeline.get('name')} | {pipeline.get('id')} | "
            f"{TEXT_TRUNK if pipeline.get('kind') == 'trunk' else TEXT_BRANCH} | "
            f"{pipeline.get('scope_name') or TEXT_UNKNOWN} | "
            f"{(pipeline.get('start_station') or TEXT_UNKNOWN)} -> {(pipeline.get('end_station') or TEXT_UNKNOWN)} |"
        )

    lines.append(
        _build_evidence_block(
            sample_size=f"{len(pipelines)} \u6761\u7ba1\u7ebf\u7d22\u5f15\u8bb0\u5f55",
            key_values=[
                f"\u7edf\u8ba1\u7ed3\u679c {len(pipelines)}",
                f"\u5bf9\u8c61\u7c7b\u578b {scoped_label}",
                f"\u9996\u6761\u8bb0\u5f55 {pipelines[0].get('name') or TEXT_UNKNOWN}",
            ],
        )
    )
    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"\u5df2\u6309 raw_excel_index \u8fd4\u56de\u5b8c\u6574\u7edf\u8ba1\u548c\u660e\u7ec6\uff0c\u5171 {len(pipelines)} \u6761\u3002",
    )


def _extract_entity_lookup_name(message: str) -> str | None:
    normalized = re.sub(r"[\uff0c\u3002\uff01\uff1f\s]+", "", message or "")
    if not normalized or len(normalized) > 24:
        return None

    core = normalized
    prefixes = [
        "\u5e2e\u6211",
        "\u770b\u4e0b",
        "\u770b\u770b",
        "\u67e5\u4e0b",
        "\u67e5\u67e5",
        "\u8bf4\u8bf4",
        "\u4ecb\u7ecd\u4e0b",
        "\u4ecb\u7ecd\u4e00\u4e2a",
        "\u8bf7\u95ee",
    ]
    stripped = True
    while stripped and core:
        stripped = False
        for prefix in prefixes:
            if core.startswith(prefix):
                core = core[len(prefix):]
                stripped = True
                break

    patterns = [
        r"^(?P<name>.+?)(?:\u662f\u4ec0\u4e48\u7ad9|\u662f\u4ec0\u4e48|\u662f\u5565|\u5565\u610f\u601d|\u505a\u4ec0\u4e48\u7684|\u662f\u5e72\u4ec0\u4e48\u7684)$",
        r"^(?:\u4ecb\u7ecd\u4e0b|\u4ecb\u7ecd\u4e00\u4e2a|\u8bf4\u8bf4)(?P<name>.+)$",
    ]
    for pattern in patterns:
        match = re.match(pattern, core)
        if match:
            return _normalize_entity_name(match.group("name"))
    if core:
        return _normalize_entity_name(core)
    return None


def _normalize_entity_name(name: str) -> str:
    normalized = re.sub(r"(\u7684\u60c5\u51b5|\u8fd9\u4e2a|\u8fd9\u4e2a\u7ad9)$", "", name.strip())
    normalized = re.sub(r"(参数列表|参数清单|列表|清单)$", "", normalized)
    generic_names = {
        "\u7ad9",
        TEXT_STATION,
        TEXT_DISTRIBUTION,
        TEXT_COMPRESSOR,
        "压缩机",
        "机组",
        "压机",
        TEXT_VALVE,
        "\u6e05\u7ba1\u7ad9",
        "\u5929\u7136\u6c14\u7ad9",
    }
    if normalized in generic_names:
        return ""
    return normalized


def _build_station_lookup_reply(station: dict[str, Any]) -> str:
    details = [
        f"{station.get('name')}\u662f AI \u7d22\u5f15\u5e93\u91cc\u767b\u8bb0\u7684\u4e00\u4e2a{station.get('type_label') or TEXT_STATION}\u3002",
        f"\u7d22\u5f15 ID \u662f {station.get('id')}\u3002",
    ]
    if station.get("systems"):
        details.append(f"\u6240\u5c5e\u5e72\u7ebf\u662f {'、'.join(station.get('systems', []))}\u3002")
    if station.get("branches"):
        details.append(f"\u5173\u8054\u652f\u7ebf\u6709 {'、'.join(station.get('branches', []))}\u3002")
    if station.get("location"):
        details.append(f"\u5730\u7406\u4f4d\u7f6e\u662f {station.get('location')}\u3002")
    if station.get("compressor_unit_count"):
        details.append(f"\u538b\u7f29\u673a\u7ec4\u8bb0\u5f55\u6570 {station.get('compressor_unit_count')} \u53f0\u3002")
    if station.get("compressor_configs"):
        details.append(f"\u673a\u7ec4\u914d\u7f6e\u8bb0\u5f55\u6709 {'、'.join(station.get('compressor_configs', []))}\u3002")
    details.append(
        _build_evidence_block(
            sample_size="1 \u6761\u7ad9\u573a\u7d22\u5f15\u8bb0\u5f55",
            key_values=[
                f"\u7ad9\u573aID {station.get('id') or TEXT_UNKNOWN}",
                f"\u7ad9\u573a\u7c7b\u578b {station.get('type_label') or TEXT_STATION}",
                f"\u6240\u5c5e\u5e72\u7ebf {'、'.join(station.get('systems', [])[:2]) or TEXT_UNKNOWN}",
            ],
        )
    )
    return "".join(details)


def _build_pipeline_lookup_reply(pipeline: dict[str, Any]) -> str:
    category = TEXT_TRUNK if pipeline.get("kind") == "trunk" else TEXT_BRANCH
    details = [
        f"{pipeline.get('name')}\u662f AI \u7d22\u5f15\u5e93\u91cc\u767b\u8bb0\u7684\u4e00\u6761{category}\u3002",
        f"\u7d22\u5f15 ID \u662f {pipeline.get('id')}\u3002",
    ]
    if pipeline.get("scope_name"):
        details.append(f"\u6240\u5c5e\u5e72\u7ebf\u662f {pipeline.get('scope_name')}\u3002")
    if pipeline.get("length_km") is not None:
        details.append(f"\u957f\u5ea6\u7ea6 {_format_optional_number(pipeline.get('length_km'), 'km')}\u3002")
    if pipeline.get("design_pressure_mpa") is not None:
        details.append(f"\u8bbe\u8ba1\u538b\u529b\u7ea6 {_format_optional_number(pipeline.get('design_pressure_mpa'), 'MPa')}\u3002")
    if pipeline.get("start_station") or pipeline.get("end_station"):
        details.append(
            f"\u8fde\u63a5\u5173\u7cfb\u662f {pipeline.get('start_station') or TEXT_UNKNOWN} -> {pipeline.get('end_station') or TEXT_UNKNOWN}\u3002"
        )
    details.append(
        _build_evidence_block(
            sample_size="1 \u6761\u7ba1\u7ebf\u7d22\u5f15\u8bb0\u5f55",
            key_values=[
                f"\u7ba1\u7ebfID {pipeline.get('id') or TEXT_UNKNOWN}",
                f"\u7ba1\u7ebf\u7c7b\u578b {category}",
                f"\u957f\u5ea6 {_format_optional_number(pipeline.get('length_km'), 'km')}",
            ],
        )
    )
    return "".join(details)


def _format_optional_number(value: float | None, unit: str) -> str:
    if value is None:
        return f"{TEXT_UNKNOWN}{unit}"
    if unit:
        return f"{value:.2f} {unit}"
    return f"{value:.2f}"


def _build_evidence_block(*, sample_size: str, key_values: list[str]) -> str:
    compact_values = [item for item in key_values if item]
    return (
        "\n\n\u8bc1\u636e\uff1a\n"
        f"\u6570\u636e\u6765\u6e90\uff1a{RAW_EXCEL_SOURCE_LABEL}\n"
        f"\u65f6\u95f4\u8303\u56f4\uff1a{RAW_EXCEL_TIME_RANGE_LABEL}\n"
        f"\u6837\u672c\u91cf\uff1a{sample_size}\n"
        f"\u5173\u952e\u6570\u503c\uff1a{'\uff1b'.join(compact_values) if compact_values else '\u89c1\u4e0a\u6587'}"
    )


def _append_completeness_hint(reply: str, user_message: str, is_complete: bool, reason: str) -> str:
    del user_message
    if not reply:
        reply = "\u5f53\u524d\u6ca1\u6709\u53ef\u8fd4\u56de\u7684\u7ed3\u679c\u3002"
    if "\u5b8c\u6574\u6027\u63d0\u793a\uff1a" in reply:
        return reply
    return f"{reply}\n\n\u5b8c\u6574\u6027\u63d0\u793a\uff1a{'\u662f' if is_complete else '\u5426'}\uff0c{reason}"
