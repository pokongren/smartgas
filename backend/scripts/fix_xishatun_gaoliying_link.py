"""
补齐西沙屯分输站到高丽营分输站的联络管段。

前端全国管网页通过 /api/pipeline-packages 读取 smartgas.db。
该接口按管段 ID 前缀归入图层，所以这里使用 SJ3 前缀，
保证联络线能进入现有陕京三线图层并被前端渲染。
"""
import json
import math
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "smartgas.db"
PIPELINE_ID = "SJ3-LINK-XST-GLY"
START_STATION_ID = "SJ3-71"
END_STATION_ID = "SJ4-56"


def haversine_km(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    radius_km = 6371.0088
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * radius_km * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    start = cur.execute(
        "SELECT * FROM stations WHERE id = ?", (START_STATION_ID,)
    ).fetchone()
    end = cur.execute("SELECT * FROM stations WHERE id = ?", (END_STATION_ID,)).fetchone()
    if not start or not end:
        raise RuntimeError("缺少西沙屯或高丽营站点，不能补联络线")

    length_km = round(
        haversine_km(
            start["longitude"],
            start["latitude"],
            end["longitude"],
            end["latitude"],
        ),
        3,
    )
    design_pressure = min(
        value
        for value in (start["design_pressure"], end["design_pressure"])
        if value is not None
    )
    properties = {
        "source": "manual_topology_fix",
        "reason": "connect_xishatun_gaoliying_for_map_topology",
        "startStationName": start["name"],
        "endStationName": end["name"],
        "displayLayerPrefix": "SJ3",
    }

    cur.execute(
        """
        INSERT INTO pipelines (
            id, name, start_station_id, end_station_id,
            diameter_mm, length_km, design_pressure_mpa,
            start_pressure_mpa, end_pressure_mpa,
            diameter, length, category, properties
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            start_station_id = excluded.start_station_id,
            end_station_id = excluded.end_station_id,
            diameter_mm = excluded.diameter_mm,
            length_km = excluded.length_km,
            design_pressure_mpa = excluded.design_pressure_mpa,
            start_pressure_mpa = excluded.start_pressure_mpa,
            end_pressure_mpa = excluded.end_pressure_mpa,
            diameter = excluded.diameter,
            length = excluded.length,
            category = excluded.category,
            properties = excluded.properties
        """,
        (
            PIPELINE_ID,
            "西沙屯-高丽营联络线",
            START_STATION_ID,
            END_STATION_ID,
            1016.0,
            length_km,
            design_pressure,
            start["operating_pressure_out"] or start["operating_pressure_in"],
            end["operating_pressure_in"] or end["operating_pressure_out"],
            1016,
            round(length_km * 1000, 1),
            "interconnect",
            json.dumps(properties, ensure_ascii=False),
        ),
    )
    conn.commit()

    row = cur.execute(
        """
        SELECT p.id, p.name, s1.name AS start_name, s2.name AS end_name,
               p.length_km, p.diameter_mm, p.category
        FROM pipelines p
        JOIN stations s1 ON s1.id = p.start_station_id
        JOIN stations s2 ON s2.id = p.end_station_id
        WHERE p.id = ?
        """,
        (PIPELINE_ID,),
    ).fetchone()
    print(dict(row))
    conn.close()


if __name__ == "__main__":
    main()
