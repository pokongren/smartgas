import json
import sqlite3
from pathlib import Path


DB_PATH = Path(__file__).resolve().parents[1] / "data" / "smartgas.db"
WE3_DISPLAY_NAME = "西气东输三线（局部）"
YONGQING_HUB_NAME = "永清大枢纽"
YONGQING_HUB_MEMBERS = ["CRED-2160", "SJ2-61", "WE3-1", "SJ3-52"]
YONGQING_COORD = (116.50, 39.32)
MANUAL_OVERLAY_DESC = "manual_overlay=1;manual_overlay_source=cleanup_we3_beijing_runtime"


def load_station_ids(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []
    try:
        parsed = json.loads(raw_value)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if str(item).strip()]


def update_station_properties(raw_value: str | None) -> str:
    try:
        properties = json.loads(raw_value) if raw_value else {}
    except Exception:
        properties = {}
    if not isinstance(properties, dict):
        properties = {}

    properties["positionMeta"] = {
        "mode": "manual_override",
        "source": "cleanup_we3_beijing_runtime",
        "note": "aligned_with_yongqing_hub",
    }
    return json.dumps(properties, ensure_ascii=False)


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("UPDATE pipeline_systems SET name = ? WHERE id = 'we3'", (WE3_DISPLAY_NAME,))

    station_row = cur.execute(
        "SELECT properties FROM stations WHERE id = 'SJ3-52'"
    ).fetchone()
    if station_row is None:
        raise RuntimeError("SJ3-52 不存在，无法清洗永清压气站")

    cur.execute(
        """
        UPDATE stations
        SET longitude = ?, latitude = ?, properties = ?
        WHERE id = 'SJ3-52'
        """,
        (
            YONGQING_COORD[0],
            YONGQING_COORD[1],
            update_station_properties(station_row[0]),
        ),
    )

    manual_rows = cur.execute(
        """
        SELECT id, name, station_ids
        FROM junction_groups
        WHERE description LIKE '%manual_overlay=1%'
        ORDER BY id
        """
    ).fetchall()

    conflict_group_ids: list[int] = []
    target_group_id: int | None = None
    member_set = set(YONGQING_HUB_MEMBERS)
    for group_id, _name, station_ids_raw in manual_rows:
        station_ids = set(load_station_ids(station_ids_raw))
        if not station_ids.intersection(member_set):
            continue
        conflict_group_ids.append(int(group_id))
        if target_group_id is None or "SJ3-52" in station_ids:
            target_group_id = int(group_id)

    merged_station_ids_json = json.dumps(YONGQING_HUB_MEMBERS, ensure_ascii=False)
    if target_group_id is not None:
        cur.execute(
            """
            UPDATE junction_groups
            SET name = ?, description = ?, station_ids = ?
            WHERE id = ?
            """,
            (YONGQING_HUB_NAME, MANUAL_OVERLAY_DESC, merged_station_ids_json, target_group_id),
        )
        for group_id in conflict_group_ids:
            if group_id == target_group_id:
                continue
            cur.execute("DELETE FROM junction_groups WHERE id = ?", (group_id,))
    else:
        cur.execute(
            """
            INSERT INTO junction_groups (name, description, station_ids)
            VALUES (?, ?, ?)
            """,
            (YONGQING_HUB_NAME, MANUAL_OVERLAY_DESC, merged_station_ids_json),
        )
        target_group_id = int(cur.lastrowid)

    conn.commit()

    print("cleanup complete")
    print("we3_name =", cur.execute("SELECT name FROM pipeline_systems WHERE id = 'we3'").fetchone()[0])
    print(
        "sj3_52 =",
        cur.execute(
            "SELECT id, name, longitude, latitude FROM stations WHERE id = 'SJ3-52'"
        ).fetchone(),
    )
    print(
        "yongqing_group =",
        cur.execute(
            "SELECT id, name, station_ids FROM junction_groups WHERE id = ?",
            (target_group_id,),
        ).fetchone(),
    )

    conn.close()


if __name__ == "__main__":
    main()
