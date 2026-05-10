"""
Register Shenzhen LNG outbound pipeline from the raw indexed workbook data.

Data source:
- backend/data/raw_excel_index.db
- sheet_干线管道
- sheet_支线管道
- sheet_管道站场阀室关系

The source workbook does not contain coordinates for every Shenzhen LNG node.
Coordinates below are visualization anchors: existing runtime DB anchors are reused
where available, and missing LNG nodes are placed along the schematic direction in
the source diagram so the route is visible on the national map.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
SMARTGAS_DB = ROOT / "backend" / "data" / "smartgas.db"
RAW_INDEX_DB = ROOT / "backend" / "data" / "raw_excel_index.db"

SYSTEM_ID = "szlng"
ID_PREFIX = "SZLNG"
SYSTEM_NAME = "深圳LNG外输管道"
SYSTEM_COLOR = "#0284c7"
PARENT_SYSTEM_ID = "gs"
PARENT_SYSTEM_NAME = "广深支干线"
CANCELLED_PARENT_LAYER_PREFIXES = {"GS-B1"}
GS_11_VALVE_ID = "GS-86696"
GS_12_VALVE_ID = "GS-3302"
GS_11_DOWNSTREAM_TAP_ID = "GS-SZLNG-TAP-11D9K3"
GS_11_DOWNSTREAM_TAP_NAME = "广深11#阀室下游9.3km接入点"
GS_11_DOWNSTREAM_DISTANCE_KM = 9.3
GS_ORIGINAL_11_TO_12_PIPELINE_ID = "GS-T-12"
GS_SPLIT_PIPELINE_IDS = ("GS-T-12A", "GS-T-12B")


COORDS: dict[str, tuple[float, float]] = {
    "深圳LNG接收站": (114.5350, 22.5650),
    "深圳LNG东侧阀井": (114.5050, 22.6020),
    "深圳LNG1#阀室": (114.4720, 22.6520),
    "深圳LNG2#阀室": (114.4250, 22.7020),
    "深圳LNG3#阀室": (114.3650, 22.7520),
    "深圳LNG4#阀室": (114.2920, 22.8020),
    "深圳LNG5#阀室": (114.1980, 22.8650),
    "清溪清管站": (114.1580, 22.8850),
    "广深樟木头-12#阀室之间": (114.0700, 22.9100),
    "深圳燃气迭福门站": (114.5480, 22.5520),
}

STATION_IDS: dict[str, str] = {
    "深圳LNG接收站": f"{ID_PREFIX}-B0-RECEIVING",
    "深圳LNG东侧阀井": f"{ID_PREFIX}-EAST-VALVE",
    "深圳LNG1#阀室": f"{ID_PREFIX}-V1",
    "深圳LNG2#阀室": f"{ID_PREFIX}-V2",
    "深圳LNG3#阀室": f"{ID_PREFIX}-V3",
    "深圳LNG4#阀室": f"{ID_PREFIX}-V4",
    "深圳LNG5#阀室": f"{ID_PREFIX}-V5",
    "清溪清管站": f"{ID_PREFIX}-QINGXI",
    # 原始资料写作“广深樟木头-12#阀室之间”，现场口径按广深11#阀室下游9.3km接入。
    # 这里使用单独接入点并拆分11#→12#管段，避免视觉上吸到东莞/樟木头支线旧节点。
    "广深樟木头-12#阀室之间": GS_11_DOWNSTREAM_TAP_ID,
    "深圳燃气迭福门站": f"{ID_PREFIX}-B1-DIEFU",
}


def _is_owned_szlng_station(station_id: str) -> bool:
    return station_id.startswith(f"{ID_PREFIX}-")


def _to_float(value: Any, default: float | None = None) -> float | None:
    text = str(value or "").strip()
    if not text or text == "-":
        return default
    try:
        return float(text)
    except ValueError:
        return default


def _query_one(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...]) -> dict[str, Any] | None:
    conn.row_factory = sqlite3.Row
    row = conn.execute(sql, params).fetchone()
    return dict(row) if row else None


def _query_all(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    conn.row_factory = sqlite3.Row
    rows = conn.execute(sql, params).fetchall()
    return [dict(row) for row in rows]


def load_raw_data() -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    with sqlite3.connect(RAW_INDEX_DB) as conn:
        trunk = _query_one(
            conn,
            "SELECT * FROM sheet_干线管道 WHERE 干线管道 = ?",
            (SYSTEM_NAME,),
        )
        if not trunk:
            raise RuntimeError(f"Raw trunk row not found: {SYSTEM_NAME}")

        branches = _query_all(
            conn,
            """
            SELECT * FROM sheet_支线管道
            WHERE 关联_干线管道 = ?
            ORDER BY CAST(原始_序号 AS REAL)
            """,
            (SYSTEM_NAME,),
        )
        relations = _query_all(
            conn,
            """
            SELECT * FROM sheet_管道站场阀室关系
            WHERE 关联_干线管道 = ?
            ORDER BY 关联_支线管道, CAST(原始_里程_km AS REAL), _row_number
            """,
            (SYSTEM_NAME,),
        )

    return trunk, branches, relations


def infer_station_type(name: str, raw_type: str | None) -> str:
    if name == "深圳LNG接收站":
        return "source"
    if "阀" in name or "#" in name:
        return "valve"
    if "分输" in name or "门站" in name:
        return "distribution"
    return "other"


def station_properties(row: dict[str, Any] | None, trunk: dict[str, Any]) -> str:
    props: dict[str, Any] = {
        "source": "raw_excel_index.db",
        "system": SYSTEM_NAME,
        "trunkRaw": {
            "lengthKm": _to_float(trunk.get("长度")),
            "physicalLinepackM3": _to_float(trunk.get("物理管容")),
            "controlLevel": trunk.get("调控级别"),
            "stationCount": _to_float(trunk.get("站场")),
            "valveCount": _to_float(trunk.get("阀室")),
        },
    }
    if row:
        props["rawRelation"] = {
            "rowNumber": row.get("_row_number"),
            "branch": row.get("关联_支线管道"),
            "mileageKm": _to_float(row.get("原始_里程_km")),
            "distanceKm": _to_float(row.get("原始_站间距_km")),
            "elevationM": _to_float(row.get("原始_高程_m")),
            "segmentLinepackM3": _to_float(row.get("原始_站间管容_方")),
            "cumulativeLinepackM3": _to_float(row.get("原始_累计管容_方")),
            "rawType2025": row.get("原始_2025年类型"),
            "location": row.get("原始_地理位置"),
        }
    return json.dumps(props, ensure_ascii=False)


def pipeline_properties(branch: dict[str, Any], segment_relation: dict[str, Any] | None = None) -> str:
    props: dict[str, Any] = {
        "source": "raw_excel_index.db",
        "rawBranch": {
            "rowNumber": branch.get("_row_number"),
            "name": branch.get("原始_支线管道"),
            "start": branch.get("原始_起点"),
            "end": branch.get("原始_终点"),
            "lengthKm": _to_float(branch.get("计算_长度_km")),
            "diameterMm": _to_float(branch.get("原始_管径_mm")),
            "designPressureMpa": _to_float(branch.get("原始_设计压力_mpa")),
            "designFlow100McmPerYear": _to_float(branch.get("原始_设计输量_108m3_a")),
            "designFlow10kM3PerDay": _to_float(branch.get("原始_设计输量_104m3_d")),
            "physicalLinepackM3": _to_float(branch.get("计算_物理管容_m3")),
            "commissionDate": branch.get("原始_管道投产时间"),
            "dispatchConsole": branch.get("关联_调度台"),
        },
    }
    if segment_relation:
        props["rawSegment"] = {
            "distanceKm": _to_float(segment_relation.get("原始_站间距_km")),
            "segmentLinepackM3": _to_float(segment_relation.get("原始_站间管容_方")),
            "cumulativeLinepackM3": _to_float(segment_relation.get("原始_累计管容_方")),
        }
    return json.dumps(props, ensure_ascii=False)


def upsert_station(
    cur: sqlite3.Cursor,
    *,
    station_id: str,
    name: str,
    station_type: str,
    lng: float,
    lat: float,
    properties: str,
    design_pressure: float | None,
) -> None:
    cur.execute(
        """
        INSERT INTO stations (
            id, name, type, longitude, latitude, design_pressure, properties
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            type = excluded.type,
            longitude = excluded.longitude,
            latitude = excluded.latitude,
            design_pressure = excluded.design_pressure,
            properties = excluded.properties
        """,
        (station_id, name, station_type, lng, lat, design_pressure or 10.0, properties),
    )


def upsert_pipeline(
    cur: sqlite3.Cursor,
    *,
    pipeline_id: str,
    name: str,
    start_station_id: str,
    end_station_id: str,
    length_km: float,
    diameter_mm: float | None,
    design_pressure_mpa: float | None,
    category: str,
    properties: str,
) -> None:
    cur.execute(
        """
        INSERT INTO pipelines (
            id, name, start_station_id, end_station_id, diameter_mm, length_km,
            design_pressure_mpa, diameter, length, category, properties
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            start_station_id = excluded.start_station_id,
            end_station_id = excluded.end_station_id,
            diameter_mm = excluded.diameter_mm,
            length_km = excluded.length_km,
            design_pressure_mpa = excluded.design_pressure_mpa,
            diameter = excluded.diameter,
            length = excluded.length,
            category = excluded.category,
            properties = excluded.properties
        """,
        (
            pipeline_id,
            name,
            start_station_id,
            end_station_id,
            diameter_mm,
            length_km,
            design_pressure_mpa or 10.0,
            int(diameter_mm) if diameter_mm else None,
            length_km,
            category,
            properties,
        ),
    )


def ensure_gs_szlng_tap(cur: sqlite3.Cursor) -> None:
    valve_11 = cur.execute(
        "SELECT id, name, longitude, latitude FROM stations WHERE id = ?",
        (GS_11_VALVE_ID,),
    ).fetchone()
    valve_12 = cur.execute(
        "SELECT id, name, longitude, latitude FROM stations WHERE id = ?",
        (GS_12_VALVE_ID,),
    ).fetchone()
    original = cur.execute(
        """
        SELECT id, name, start_station_id, end_station_id, diameter_mm, length_km,
               design_pressure_mpa, diameter, category, properties
        FROM pipelines
        WHERE id = ?
        """,
        (GS_ORIGINAL_11_TO_12_PIPELINE_ID,),
    ).fetchone()

    if not valve_11 or not valve_12:
        raise RuntimeError("广深11#/12#阀室缺失，无法创建深圳LNG接入点")
    if original:
        original_length_km = _to_float(original[5], 13.718) or 13.718
        base_pipeline = original
    else:
        split_rows = [
            cur.execute(
                """
                SELECT id, name, start_station_id, end_station_id, diameter_mm, length_km,
                       design_pressure_mpa, diameter, category, properties
                FROM pipelines
                WHERE id = ?
                """,
                (pipeline_id,),
            ).fetchone()
            for pipeline_id in GS_SPLIT_PIPELINE_IDS
        ]
        if not all(split_rows):
            raise RuntimeError("广深11#至12#管段缺失，无法创建深圳LNG接入点")
        original_length_km = sum((_to_float(row[5], 0.0) or 0.0) for row in split_rows)
        base_pipeline = split_rows[0]

    ratio = max(0.0, min(1.0, GS_11_DOWNSTREAM_DISTANCE_KM / original_length_km))
    lng = float(valve_11[2]) + (float(valve_12[2]) - float(valve_11[2])) * ratio
    lat = float(valve_11[3]) + (float(valve_12[3]) - float(valve_11[3])) * ratio
    remaining_length_km = max(0.0, original_length_km - GS_11_DOWNSTREAM_DISTANCE_KM)

    cur.execute(
        """
        INSERT INTO stations (
            id, name, type, longitude, latitude, design_pressure, properties
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            type = excluded.type,
            longitude = excluded.longitude,
            latitude = excluded.latitude,
            design_pressure = excluded.design_pressure,
            properties = excluded.properties
        """,
        (
            GS_11_DOWNSTREAM_TAP_ID,
            GS_11_DOWNSTREAM_TAP_NAME,
            "valve",
            lng,
            lat,
            base_pipeline[6] or 10.0,
            json.dumps(
                {
                    "source": "manual_topology_correction",
                    "basis": "广深支线接入点为广深11#阀室下游9.3km",
                    "upstreamValveId": GS_11_VALVE_ID,
                    "downstreamValveId": GS_12_VALVE_ID,
                    "distanceFromUpstreamKm": GS_11_DOWNSTREAM_DISTANCE_KM,
                },
                ensure_ascii=False,
            ),
        ),
    )

    cur.execute("DELETE FROM pipelines WHERE id = ?", (GS_ORIGINAL_11_TO_12_PIPELINE_ID,))
    cur.execute("DELETE FROM pipelines WHERE id IN (?, ?)", GS_SPLIT_PIPELINE_IDS)

    upsert_pipeline(
        cur,
        pipeline_id=GS_SPLIT_PIPELINE_IDS[0],
        name=base_pipeline[1] or PARENT_SYSTEM_NAME,
        start_station_id=GS_11_VALVE_ID,
        end_station_id=GS_11_DOWNSTREAM_TAP_ID,
        length_km=GS_11_DOWNSTREAM_DISTANCE_KM,
        diameter_mm=_to_float(base_pipeline[4]),
        design_pressure_mpa=_to_float(base_pipeline[6]),
        category=base_pipeline[8] or "trunk",
        properties=base_pipeline[9] or "{}",
    )
    upsert_pipeline(
        cur,
        pipeline_id=GS_SPLIT_PIPELINE_IDS[1],
        name=base_pipeline[1] or PARENT_SYSTEM_NAME,
        start_station_id=GS_11_DOWNSTREAM_TAP_ID,
        end_station_id=GS_12_VALVE_ID,
        length_km=remaining_length_km,
        diameter_mm=_to_float(base_pipeline[4]),
        design_pressure_mpa=_to_float(base_pipeline[6]),
        category=base_pipeline[8] or "trunk",
        properties=base_pipeline[9] or "{}",
    )


def main() -> None:
    trunk, branches, relations = load_raw_data()
    relation_by_name: dict[str, dict[str, Any]] = {}
    for row in relations:
        relation_by_name.setdefault(str(row.get("原始_站场阀室") or ""), row)

    with sqlite3.connect(SMARTGAS_DB) as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM gas_sources WHERE id = ?", ("gas-szlng",))
        cur.execute("DELETE FROM pipelines WHERE id LIKE ?", (f"{ID_PREFIX}%",))
        cur.execute("DELETE FROM stations WHERE id LIKE ?", (f"{ID_PREFIX}%",))
        cur.execute("DELETE FROM pipeline_systems WHERE id = ?", (SYSTEM_ID,))
        ensure_gs_szlng_tap(cur)

        layers_config = [
            {"id_prefix": ID_PREFIX, "name": "深圳LNG外输管道", "type": "branch", "visible": True},
            {"id_prefix": f"{ID_PREFIX}-B1", "name": "深圳LNG深圳燃气联络线", "type": "branch", "visible": True},
            {"id_prefix": f"{ID_PREFIX}-B2", "name": "西二线深圳LNG联络线", "type": "branch", "visible": True},
        ]
        parent_row = cur.execute(
            "SELECT layers_config FROM pipeline_systems WHERE id = ?",
            (PARENT_SYSTEM_ID,),
        ).fetchone()
        if not parent_row:
            raise RuntimeError(f"Parent pipeline system not found: {PARENT_SYSTEM_NAME} ({PARENT_SYSTEM_ID})")

        parent_layers = json.loads(parent_row[0] or "[]")
        szlng_prefixes = {layer["id_prefix"] for layer in layers_config}
        removed_prefixes = szlng_prefixes | CANCELLED_PARENT_LAYER_PREFIXES
        parent_layers = [
            layer for layer in parent_layers
            if str(layer.get("id_prefix", "")) not in removed_prefixes
        ]
        parent_layers.extend(layers_config)
        cur.execute(
            "UPDATE pipeline_systems SET layers_config = ? WHERE id = ?",
            (json.dumps(parent_layers, ensure_ascii=False), PARENT_SYSTEM_ID),
        )

        for name, station_id in STATION_IDS.items():
            if not _is_owned_szlng_station(station_id):
                continue
            relation = relation_by_name.get(name)
            raw_type = relation.get("原始_2025年类型") if relation else ""
            station_type = infer_station_type(name, raw_type)
            lng, lat = COORDS[name]
            upsert_station(
                cur,
                station_id=station_id,
                name=name,
                station_type=station_type,
                lng=lng,
                lat=lat,
                properties=station_properties(relation, trunk),
                design_pressure=10.0 if station_type != "source" else 10.0,
            )

        cur.execute(
            """
            INSERT INTO gas_sources (
                id, name, station_id, source_type, capacity_mcm_per_day,
                current_output_mcm_per_day, status, properties
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "gas-szlng",
                "深圳LNG",
                STATION_IDS["深圳LNG接收站"],
                "lng",
                4600.0,
                0.0,
                "normal",
                json.dumps(
                    {
                        "source": "sheet_支线管道",
                        "basis": "深圳LNG外输管道设计输量 4600 万方/日",
                    },
                    ensure_ascii=False,
                ),
            ),
        )

        main_branch = next(item for item in branches if item["原始_支线管道"] == SYSTEM_NAME)
        main_route = [
            "深圳LNG东侧阀井",
            "深圳LNG1#阀室",
            "深圳LNG2#阀室",
            "深圳LNG3#阀室",
            "深圳LNG4#阀室",
            "深圳LNG5#阀室",
            "清溪清管站",
            "广深樟木头-12#阀室之间",
        ]
        for index, (start_name, end_name) in enumerate(zip(main_route, main_route[1:]), start=1):
            end_relation = relation_by_name.get(end_name)
            segment_length = _to_float(end_relation.get("原始_站间距_km") if end_relation else None)
            if not segment_length:
                segment_length = _to_float(main_branch.get("计算_长度_km"), 0.0) or 0.0
            upsert_pipeline(
                cur,
                pipeline_id=f"{ID_PREFIX}-T-{index}",
                name=SYSTEM_NAME,
                start_station_id=STATION_IDS[start_name],
                end_station_id=STATION_IDS[end_name],
                length_km=segment_length,
                diameter_mm=_to_float(main_branch.get("原始_管径_mm")),
                design_pressure_mpa=_to_float(main_branch.get("原始_设计压力_mpa")),
                category="branch",
                properties=pipeline_properties(main_branch, end_relation),
            )

        branch_specs = [
            ("SZLNG-B1-1", "深圳LNG深圳燃气联络线", "深圳LNG接收站", "深圳燃气迭福门站", "branch"),
            ("SZLNG-B2-1", "西二线深圳LNG联络线", "深圳LNG接收站", "深圳LNG东侧阀井", "branch"),
        ]
        for pipeline_id, branch_name, start_name, end_name, category in branch_specs:
            branch = next(item for item in branches if item["原始_支线管道"] == branch_name)
            upsert_pipeline(
                cur,
                pipeline_id=pipeline_id,
                name=branch_name,
                start_station_id=STATION_IDS[start_name],
                end_station_id=STATION_IDS[end_name],
                length_km=_to_float(branch.get("计算_长度_km"), 0.0) or 0.0,
                diameter_mm=_to_float(branch.get("原始_管径_mm")),
                design_pressure_mpa=_to_float(branch.get("原始_设计压力_mpa")),
                category=category,
                properties=pipeline_properties(branch, relation_by_name.get(end_name)),
            )

        conn.commit()

    print("深圳LNG外输管道已作为广深支干线支线写入 smartgas.db")
    print(f"  stations: {len([sid for sid in STATION_IDS.values() if _is_owned_szlng_station(sid)])}")
    print("  pipelines: 9")
    print("  gas_sources: 1 (source_type=lng)")
    print(f"  parent_system: {PARENT_SYSTEM_NAME} ({PARENT_SYSTEM_ID})")


if __name__ == "__main__":
    main()
