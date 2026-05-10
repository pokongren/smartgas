"""
补齐泰兴联络站到南通联络站的中俄东线主干管段。

现有数据库中 CRED-T-157 到泰兴联络站，CRED-T-159 从南通联络站继续向下游，
中间缺少 CRED-T-158，导致前端拓扑图上两个联络站断开。
"""
import json
import math
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "smartgas.db"
PIPELINE_ID = "CRED-T-158"
START_STATION_ID = "CRED-2225"
END_STATION_ID = "CRED-2226"


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
        raise RuntimeError("缺少泰兴联络站或南通联络站，不能补管段")

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
        "reason": "connect_taixing_nantong_for_map_topology",
        "startStationName": start["name"],
        "endStationName": end["name"],
        "displayLayerPrefix": "CRED",
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
            "中俄东线-泰兴至南通段",
            START_STATION_ID,
            END_STATION_ID,
            1422.0,
            length_km,
            design_pressure,
            start["operating_pressure_out"] or start["operating_pressure_in"],
            end["operating_pressure_in"] or end["operating_pressure_out"],
            1422,
            round(length_km * 1000, 1),
            "trunk",
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
