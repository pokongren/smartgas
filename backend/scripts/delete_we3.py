import json
import sqlite3
from pathlib import Path


DB_PATH = Path(__file__).resolve().parents[1] / "data" / "smartgas.db"
SYSTEM_ID = "we3"
ID_PREFIX = "WE3-"
MANUAL_OVERLAY_TAG = "manual_overlay=1"


def parse_station_ids(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []
    try:
        parsed = json.loads(raw_value)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if str(item).strip()]


def dump_station_ids(station_ids: list[str]) -> str:
    return json.dumps(station_ids, ensure_ascii=False)


def remove_we3_from_manual_groups(cur: sqlite3.Cursor) -> dict[str, list[int]]:
    deleted_group_ids: list[int] = []
    updated_group_ids: list[int] = []

    rows = cur.execute(
        """
        SELECT id, name, description, station_ids
        FROM junction_groups
        ORDER BY id
        """
    ).fetchall()

    for group_id, _name, description, raw_station_ids in rows:
        station_ids = parse_station_ids(raw_station_ids)
        if not any(station_id.startswith(ID_PREFIX) for station_id in station_ids):
            continue

        remaining_station_ids = [
            station_id for station_id in station_ids if not station_id.startswith(ID_PREFIX)
        ]

        is_manual_overlay = MANUAL_OVERLAY_TAG in str(description or "")
        if not is_manual_overlay or len(remaining_station_ids) < 2:
            cur.execute("DELETE FROM junction_groups WHERE id = ?", (group_id,))
            deleted_group_ids.append(int(group_id))
            continue

        cur.execute(
            "UPDATE junction_groups SET station_ids = ? WHERE id = ?",
            (dump_station_ids(remaining_station_ids), group_id),
        )
        updated_group_ids.append(int(group_id))

    return {
        "deleted": deleted_group_ids,
        "updated": updated_group_ids,
    }


def remove_we3_from_rebuilt_groups(cur: sqlite3.Cursor) -> dict[str, list[int]]:
    deleted_group_ids: list[int] = []
    updated_group_ids: list[int] = []

    table_exists = cur.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='junction_groups_rebuilt'"
    ).fetchone()
    if not table_exists:
        return {"deleted": deleted_group_ids, "updated": updated_group_ids}

    rows = cur.execute(
        """
        SELECT id, station_ids, system_ids
        FROM junction_groups_rebuilt
        ORDER BY id
        """
    ).fetchall()

    for group_id, raw_station_ids, raw_system_ids in rows:
        station_ids = parse_station_ids(raw_station_ids)
        if not any(station_id.startswith(ID_PREFIX) for station_id in station_ids):
            continue

        remaining_station_ids = [
            station_id for station_id in station_ids if not station_id.startswith(ID_PREFIX)
        ]

        if len(remaining_station_ids) < 2:
            cur.execute("DELETE FROM junction_groups_rebuilt WHERE id = ?", (group_id,))
            deleted_group_ids.append(int(group_id))
            continue

        try:
            system_ids = json.loads(raw_system_ids or "[]")
        except Exception:
            system_ids = []
        remaining_system_ids = [
            str(system_id) for system_id in system_ids if str(system_id).lower() != SYSTEM_ID
        ]
        remaining_system_ids = sorted(dict.fromkeys(remaining_system_ids))
        member_count = len(remaining_station_ids)
        junction_kind = "major_junction" if len(remaining_system_ids) >= 3 else "junction"

        cur.execute(
            """
            UPDATE junction_groups_rebuilt
            SET station_ids = ?, system_ids = ?, member_count = ?, junction_kind = ?
            WHERE id = ?
            """,
            (
                dump_station_ids(remaining_station_ids),
                dump_station_ids(remaining_system_ids),
                member_count,
                junction_kind,
                group_id,
            ),
        )
        updated_group_ids.append(int(group_id))

    return {
        "deleted": deleted_group_ids,
        "updated": updated_group_ids,
    }


def delete_we3_entities(cur: sqlite3.Cursor) -> dict[str, int]:
    pipeline_count = cur.execute(
        "SELECT COUNT(*) FROM pipelines WHERE id LIKE 'WE3-%'"
    ).fetchone()[0]
    station_count = cur.execute(
        "SELECT COUNT(*) FROM stations WHERE id LIKE 'WE3-%'"
    ).fetchone()[0]
    system_count = cur.execute(
        "SELECT COUNT(*) FROM pipeline_systems WHERE id = ?",
        (SYSTEM_ID,),
    ).fetchone()[0]

    cur.execute("DELETE FROM pipelines WHERE id LIKE 'WE3-%'")
    cur.execute("DELETE FROM stations WHERE id LIKE 'WE3-%'")
    cur.execute("DELETE FROM pipeline_systems WHERE id = ?", (SYSTEM_ID,))

    return {
        "pipelines": int(pipeline_count),
        "stations": int(station_count),
        "systems": int(system_count),
    }


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    manual_result = remove_we3_from_manual_groups(cur)
    rebuilt_result = remove_we3_from_rebuilt_groups(cur)
    deleted_entities = delete_we3_entities(cur)

    conn.commit()

    we3_exists = cur.execute(
        "SELECT COUNT(*) FROM pipeline_systems WHERE id = ?",
        (SYSTEM_ID,),
    ).fetchone()[0]
    we3_station_count = cur.execute(
        "SELECT COUNT(*) FROM stations WHERE id LIKE 'WE3-%'"
    ).fetchone()[0]
    we3_pipeline_count = cur.execute(
        "SELECT COUNT(*) FROM pipelines WHERE id LIKE 'WE3-%'"
    ).fetchone()[0]

    print("delete_we3 complete")
    print("deleted_entities =", deleted_entities)
    print("manual_groups =", manual_result)
    print("rebuilt_groups =", rebuilt_result)
    print(
        "remaining =",
        {
            "pipeline_system": we3_exists,
            "stations": we3_station_count,
            "pipelines": we3_pipeline_count,
        },
    )

    conn.close()


if __name__ == "__main__":
    main()
