import argparse
import json
import sqlite3
from collections import Counter
from pathlib import Path


DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "smartgas.db"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="校验 junction_groups 或影子重编结果。")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="SQLite DB 路径")
    parser.add_argument(
        "--table",
        default="junction_groups",
        help="要校验的表名，默认 junction_groups，可选 junction_groups_rebuilt",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="发现问题时返回非 0 退出码",
    )
    parser.add_argument(
        "--json-out",
        help="可选：将校验 summary + issues 写入 JSON 文件，便于验收归档",
    )
    parser.add_argument(
        "--max-issues",
        type=int,
        default=200,
        help="最多打印/输出多少条 issue（默认 200）",
    )
    return parser.parse_args()


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def load_station_systems(conn: sqlite3.Connection) -> dict[str, str]:
    station_systems: dict[str, str] = {}
    for station_id, in conn.execute("SELECT id FROM stations"):
        parts = str(station_id).split("-")
        if len(parts) >= 2 and parts[1].startswith("B"):
            prefix = f"{parts[0]}-{parts[1]}"
        else:
            prefix = parts[0] if parts else str(station_id)
        station_systems[str(station_id)] = prefix.lower()
    return station_systems


def extract_kind(row: sqlite3.Row, table_name: str) -> str:
    if table_name == "junction_groups_rebuilt":
        return str(row["junction_kind"])
    description = str(row["description"] or "")
    for chunk in description.split(";"):
        if chunk.startswith("kind="):
            return chunk.split("=", 1)[1].strip()
    return "unknown"


def extract_station_ids(raw_value: str) -> list[str]:
    try:
        parsed = json.loads(raw_value)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed]


def verify_groups(conn: sqlite3.Connection, table_name: str) -> tuple[list[str], dict[str, int]]:
    station_systems = load_station_systems(conn)
    issues: list[str] = []
    kind_counter: Counter[str] = Counter()

    rows = conn.execute(f"SELECT * FROM {table_name} ORDER BY id").fetchall()
    for row in rows:
        group_id = row["id"]
        station_ids = extract_station_ids(row["station_ids"])
        if len(station_ids) < 2:
            issues.append(f"[group {group_id}] 成员数少于 2: {station_ids}")
            continue

        if any(item.upper().startswith("JUNCTION-") for item in station_ids):
            issues.append(f"[group {group_id}] 仍包含嵌套引用: {station_ids}")

        missing_station_ids = [item for item in station_ids if item not in station_systems]
        if missing_station_ids:
            issues.append(f"[group {group_id}] 存在缺失站点: {missing_station_ids}")
            continue

        systems = sorted({station_systems[item] for item in station_ids})
        if len(systems) < 2:
            issues.append(f"[group {group_id}] 不满足跨系统条件: systems={systems}, station_ids={station_ids}")

        kind = extract_kind(row, table_name)
        expected_kind = "major_junction" if len(systems) >= 3 else "junction"
        kind_counter[kind] += 1
        if kind != "unknown" and kind != expected_kind:
            issues.append(
                f"[group {group_id}] 类型不匹配: kind={kind}, expected={expected_kind}, systems={systems}"
            )

    stats = {
        "group_count": len(rows),
        "junction_count": kind_counter.get("junction", 0),
        "major_junction_count": kind_counter.get("major_junction", 0),
        "unknown_kind_count": kind_counter.get("unknown", 0),
        "issue_count": len(issues),
    }
    return issues, stats


def main() -> int:
    args = parse_args()
    db_path = Path(args.db).resolve()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        if not table_exists(conn, args.table):
            print(f"表不存在: {args.table}")
            return 2

        issues, stats = verify_groups(conn, args.table)
        print(f"DB: {db_path}")
        print(f"TABLE: {args.table}")
        for key in ["group_count", "junction_count", "major_junction_count", "unknown_kind_count", "issue_count"]:
            if key in stats:
                print(f"{key}: {stats.get(key)}")
        print("")
        if issues:
            print("发现的问题:")
            for issue in issues[: max(0, int(args.max_issues))]:
                print(f"- {issue}")
        else:
            print("未发现结构性问题。")

        summary_payload = {
            "db": str(db_path),
            "table": args.table,
            "stats": stats,
            "issue_count": len(issues),
            "issues": issues[: max(0, int(args.max_issues))],
        }
        if args.json_out:
            out_path = Path(args.json_out).resolve()
            out_path.write_text(json.dumps(summary_payload, ensure_ascii=False, indent=2), encoding="utf-8")
            print("")
            print(f"已输出 JSON -> {out_path}")

        # 额外输出一个一行 summary，方便脚本 grep
        print("")
        print(
            "SUMMARY "
            f"group_count={stats.get('group_count')} "
            f"junction={stats.get('junction_count')} "
            f"major_junction={stats.get('major_junction_count')} "
            f"unknown_kind={stats.get('unknown_kind_count')} "
            f"issues={stats.get('issue_count')}"
        )

        return 1 if args.strict and issues else 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
