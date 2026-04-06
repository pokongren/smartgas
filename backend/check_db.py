import argparse
import json
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any


DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "smartgas.db"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="smartgas.db 基础验收脚本（WE3/SJ2/SJ3 + junction shadow）。")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="SQLite DB 路径")
    parser.add_argument("--strict", action="store_true", help="发现问题时返回非 0 退出码")
    parser.add_argument(
        "--show-junction-samples",
        action="store_true",
        help="打印 junction_groups / junction_groups_rebuilt 的少量样本行，方便人工核对",
    )
    parser.add_argument(
        "--require-prefix",
        action="append",
        default=[],
        help="要求必须存在的站点/管段前缀，例如 WE3/SJ2/SJ3。可重复传参。",
    )
    parser.add_argument(
        "--require-system",
        action="append",
        default=[],
        help="要求必须存在的 pipeline_systems.id，例如 we3/sj2/sj3。可重复传参。",
    )
    return parser.parse_args()


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return row is not None


def count_like(conn: sqlite3.Connection, table: str, column: str, prefix: str) -> int:
    row = conn.execute(
        f"SELECT COUNT(*) FROM {table} WHERE {column} LIKE ?",
        (f"{prefix}%",),
    ).fetchone()
    return int(row[0] if row else 0)


def load_station_systems(conn: sqlite3.Connection) -> dict[str, str]:
    """
    用 station_id 前缀派生 systemId，用于 junction shadow 校验。
    这里不依赖 pipeline_systems.layers_config，避免耦合。
    """
    mapping: dict[str, str] = {}
    for (station_id,) in conn.execute("SELECT id FROM stations"):
        raw = str(station_id)
        parts = raw.split("-")
        if len(parts) >= 2 and parts[1].startswith("B"):
            prefix = f"{parts[0]}-{parts[1]}"
        else:
            prefix = parts[0] if parts else raw
        mapping[raw] = prefix.lower()
    return mapping


def parse_station_ids(raw_value: Any) -> list[str]:
    if raw_value is None:
        return []
    try:
        parsed = json.loads(raw_value)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed]


def verify_shadow_junctions(conn: sqlite3.Connection) -> tuple[list[str], dict[str, int]]:
    issues: list[str] = []
    kind_counter: Counter[str] = Counter()

    if not table_exists(conn, "junction_groups_rebuilt"):
        issues.append("缺少影子表 junction_groups_rebuilt")
        stats = {
            "group_count": 0,
            "junction_count": 0,
            "major_junction_count": 0,
            "issue_count": len(issues),
        }
        return issues, stats

    station_systems = load_station_systems(conn)
    rows = conn.execute("SELECT id, station_ids, junction_kind, system_ids, member_count FROM junction_groups_rebuilt ORDER BY id").fetchall()
    for group_id, station_ids_raw, kind, system_ids_raw, member_count in rows:
        station_ids = parse_station_ids(station_ids_raw)
        if len(station_ids) < 2:
            issues.append(f"[rebuilt {group_id}] 成员数少于 2: {station_ids}")
            continue

        if any(str(item).upper().startswith("JUNCTION-") for item in station_ids):
            issues.append(f"[rebuilt {group_id}] 仍包含嵌套引用: {station_ids}")

        missing = [sid for sid in station_ids if sid not in station_systems]
        if missing:
            issues.append(f"[rebuilt {group_id}] 存在缺失站点: {missing}")
            continue

        systems = sorted({station_systems[sid] for sid in station_ids})
        expected_kind = "major_junction" if len(systems) >= 3 else "junction"
        kind_counter[str(kind)] += 1

        if str(kind) != expected_kind:
            issues.append(
                f"[rebuilt {group_id}] 类型不匹配: kind={kind}, expected={expected_kind}, systems={systems}"
            )

        # member_count 允许不完全一致（防止历史写入不一致），但严重不一致要提示。
        try:
            mc = int(member_count)
        except Exception:
            mc = len(station_ids)
        if mc != len(station_ids):
            issues.append(f"[rebuilt {group_id}] member_count 不一致: member_count={mc}, len(station_ids)={len(station_ids)}")

    stats = {
        "group_count": len(rows),
        "junction_count": kind_counter.get("junction", 0),
        "major_junction_count": kind_counter.get("major_junction", 0),
        "issue_count": len(issues),
    }
    return issues, stats


def main() -> int:
    args = parse_args()
    db_path = Path(args.db).resolve()
    if not db_path.exists():
        print(f"DB 不存在: {db_path}")
        return 2

    conn = sqlite3.connect(db_path)
    try:
        conn.row_factory = sqlite3.Row
        print(f"DB: {db_path}")

        # 基础表检查
        for table in [
            "pipeline_systems",
            "stations",
            "pipelines",
            "junction_groups",
            "junction_groups_backup_20260404",
            "junction_groups_rebuilt",
        ]:
            print(f"table_exists.{table}: {table_exists(conn, table)}")
        print("")

        # pipeline_systems 快照
        systems: list[str] = []
        if table_exists(conn, "pipeline_systems"):
            systems = [row[0] for row in conn.execute("SELECT id FROM pipeline_systems ORDER BY sort_order").fetchall()]
        print(f"pipeline_systems.count: {len(systems)}")
        if systems:
            print(f"pipeline_systems.ids: {', '.join(systems)}")
        print("")

        # 关键 system 快照
        watch_systems = ["we3", "sj2", "sj3"]
        system_rows: dict[str, tuple[str, str] | None] = {}
        if table_exists(conn, "pipeline_systems"):
            for sid in watch_systems:
                row = conn.execute("SELECT id, name FROM pipeline_systems WHERE id = ?", (sid,)).fetchone()
                system_rows[sid] = (row[0], row[1]) if row else None
        print("pipeline_systems.watch:")
        for sid in watch_systems:
            if system_rows.get(sid):
                print(f"- {sid}: exists name={system_rows[sid][1]}")
            else:
                print(f"- {sid}: missing")
        print("")

        # 关键前缀证据
        prefixes = ["WE3", "SJ2", "SJ3"]
        print("prefix_snapshot:")
        for prefix in prefixes:
            s_cnt = count_like(conn, "stations", "id", prefix) if table_exists(conn, "stations") else 0
            p_cnt = count_like(conn, "pipelines", "id", prefix) if table_exists(conn, "pipelines") else 0
            print(f"- {prefix}: stations={s_cnt}, pipelines={p_cnt}")
        print("")

        # junction_groups / backup / rebuilt 基础状态
        def _table_count(name: str) -> int:
            if not table_exists(conn, name):
                return 0
            row = conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()
            return int(row[0] if row else 0)

        print("junction_tables_snapshot:")
        print(f"- junction_groups.count: {_table_count('junction_groups')}")
        print(f"- junction_groups_backup_20260404.count: {_table_count('junction_groups_backup_20260404')}")
        print(f"- junction_groups_rebuilt.count: {_table_count('junction_groups_rebuilt')}")
        print("")

        # 要求的 system_id / prefix 约束（严格模式才会判 fail）
        required_systems = [str(item).strip() for item in args.require_system if str(item).strip()]
        required_prefixes = [str(item).strip().upper() for item in args.require_prefix if str(item).strip()]
        if required_systems:
            missing_systems = [sid for sid in required_systems if sid not in set(systems)]
            print(f"require_system: {required_systems}")
            print(f"missing_system: {missing_systems}")
            print("")
        else:
            missing_systems = []

        if required_prefixes:
            print(f"require_prefix: {required_prefixes}")
            missing_prefixes = []
            for prefix in required_prefixes:
                s_cnt = count_like(conn, "stations", "id", prefix) if table_exists(conn, "stations") else 0
                p_cnt = count_like(conn, "pipelines", "id", prefix) if table_exists(conn, "pipelines") else 0
                if s_cnt == 0 and p_cnt == 0:
                    missing_prefixes.append(prefix)
            print(f"missing_prefix: {missing_prefixes}")
            print("")
        else:
            missing_prefixes = []

        # junction shadow 验收
        issues, stats = verify_shadow_junctions(conn)
        print("junction_shadow_stats:")
        for key in ["group_count", "junction_count", "major_junction_count", "issue_count"]:
            print(f"- {key}: {stats.get(key)}")
        if issues:
            print("junction_shadow_issues:")
            for item in issues[:50]:
                print(f"- {item}")
        else:
            print("junction_shadow_issues: none")

        if table_exists(conn, "junction_groups_rebuilt"):
            row = conn.execute(
                "SELECT generated_at, tolerance_deg FROM junction_groups_rebuilt ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if row:
                print("")
                print(f"junction_groups_rebuilt.latest: generated_at={row[0]} tolerance_deg={row[1]}")

        if args.show_junction_samples:
            print("")
            if table_exists(conn, "junction_groups_rebuilt"):
                print("junction_groups_rebuilt.samples:")
                for row in conn.execute(
                    "SELECT id, name, junction_kind, member_count, system_ids FROM junction_groups_rebuilt ORDER BY id LIMIT 5"
                ).fetchall():
                    print(f"- {tuple(row)}")
            if table_exists(conn, "junction_groups"):
                print("junction_groups.samples:")
                for row in conn.execute(
                    "SELECT id, name, station_ids FROM junction_groups ORDER BY id LIMIT 5"
                ).fetchall():
                    print(f"- {tuple(row)}")

        # 返回码策略
        if args.strict:
            if issues:
                return 1
            if missing_systems or missing_prefixes:
                return 1
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
