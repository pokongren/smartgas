import argparse
import json
import math
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "smartgas.db"
DEFAULT_TOLERANCE_DEG = 0.0008
NAME_SUFFIXES = (
    "压气站",
    "分输站",
    "计量站",
    "联络站",
    "首站",
    "末站",
    "阀室",
    "站场",
    "站",
)


@dataclass(frozen=True)
class StationRecord:
    id: str
    name: str
    station_type: str
    longitude: float
    latitude: float
    system_id: str


class UnionFind:
    def __init__(self, values: Iterable[str]):
        self.parent = {value: value for value in values}

    def find(self, value: str) -> str:
        parent = self.parent[value]
        if parent != value:
            parent = self.find(parent)
            self.parent[value] = parent
        return parent

    def union(self, left: str, right: str) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root != right_root:
            self.parent[right_root] = left_root


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="按新规则重编枢纽，默认只做 dry-run，可选写入影子表。"
    )
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="SQLite DB 路径")
    parser.add_argument(
        "--tolerance-deg",
        type=float,
        default=DEFAULT_TOLERANCE_DEG,
        help="坐标归并容差（经纬度度数）",
    )
    parser.add_argument(
        "--include-valves",
        action="store_true",
        help="是否把阀室也纳入枢纽候选，默认不纳入",
    )
    parser.add_argument(
        "--write-shadow",
        action="store_true",
        help="把结果写入影子表 junction_groups_rebuilt",
    )
    parser.add_argument(
        "--json-out",
        help="把重编结果写入 JSON 文件",
    )
    return parser.parse_args()


def load_pipeline_system_prefixes(conn: sqlite3.Connection) -> dict[str, str]:
    prefixes: dict[str, str] = {}
    query = "SELECT id, layers_config FROM pipeline_systems"
    for system_id, raw_layers in conn.execute(query):
        if not raw_layers:
            continue
        try:
            layers = json.loads(raw_layers)
        except Exception:
            continue
        if not isinstance(layers, list):
            continue
        for layer in layers:
            if not isinstance(layer, dict):
                continue
            prefix = str(layer.get("id_prefix") or "").strip()
            if prefix:
                prefixes[prefix] = str(system_id)
    return prefixes


def derive_system_id(station_id: str, prefix_map: dict[str, str]) -> str:
    parts = station_id.split("-")
    if len(parts) >= 2 and parts[1].startswith("B"):
        prefix = f"{parts[0]}-{parts[1]}"
    else:
        prefix = parts[0] if parts else station_id
    return prefix_map.get(prefix, prefix.lower())


def load_candidate_stations(
    conn: sqlite3.Connection,
    prefix_map: dict[str, str],
    include_valves: bool,
) -> list[StationRecord]:
    rows = conn.execute(
        """
        SELECT id, name, type, longitude, latitude
        FROM stations
        WHERE longitude != 0 AND latitude != 0
        """
    ).fetchall()
    stations: list[StationRecord] = []
    for station_id, name, station_type, longitude, latitude in rows:
        if not include_valves and station_type == "valve":
            continue
        stations.append(
            StationRecord(
                id=str(station_id),
                name=str(name or station_id),
                station_type=str(station_type or "other"),
                longitude=float(longitude),
                latitude=float(latitude),
                system_id=derive_system_id(str(station_id), prefix_map),
            )
        )
    return stations


def build_spatial_buckets(
    stations: list[StationRecord],
    tolerance_deg: float,
) -> dict[tuple[int, int], list[StationRecord]]:
    buckets: dict[tuple[int, int], list[StationRecord]] = defaultdict(list)
    for station in stations:
        key = (
            int(math.floor(station.longitude / tolerance_deg)),
            int(math.floor(station.latitude / tolerance_deg)),
        )
        buckets[key].append(station)
    return buckets


def distance_deg(left: StationRecord, right: StationRecord) -> float:
    return math.sqrt(
        (left.longitude - right.longitude) ** 2 + (left.latitude - right.latitude) ** 2
    )


def normalize_place_name(raw_name: str) -> str:
    value = raw_name.strip()
    for suffix in NAME_SUFFIXES:
        if value.endswith(suffix):
            value = value[: -len(suffix)].strip()
            break
    return value or raw_name.strip() or "未命名"


def build_rebuilt_groups(
    stations: list[StationRecord],
    tolerance_deg: float,
) -> list[dict[str, object]]:
    union_find = UnionFind(station.id for station in stations)
    station_by_id = {station.id: station for station in stations}
    buckets = build_spatial_buckets(stations, tolerance_deg)

    for station in stations:
        base_x = int(math.floor(station.longitude / tolerance_deg))
        base_y = int(math.floor(station.latitude / tolerance_deg))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for peer in buckets.get((base_x + dx, base_y + dy), []):
                    if peer.id <= station.id:
                        continue
                    if station.system_id == peer.system_id:
                        continue
                    if distance_deg(station, peer) > tolerance_deg:
                        continue
                    union_find.union(station.id, peer.id)

    grouped_ids: dict[str, list[str]] = defaultdict(list)
    for station in stations:
        grouped_ids[union_find.find(station.id)].append(station.id)

    rebuilt: list[dict[str, object]] = []
    for member_ids in grouped_ids.values():
        if len(member_ids) < 2:
            continue
        members = sorted((station_by_id[item_id] for item_id in member_ids), key=lambda item: item.id)
        distinct_systems = sorted({member.system_id for member in members})
        if len(distinct_systems) < 2:
            continue

        place_counter = Counter(normalize_place_name(member.name) for member in members)
        place_name = place_counter.most_common(1)[0][0]
        kind = "major_junction" if len(distinct_systems) >= 3 else "junction"
        rebuilt.append(
            {
                "name": f"{place_name}大枢纽" if kind == "major_junction" else f"{place_name}枢纽",
                "description": (
                    f"rebuilt_by_rule;"
                    f"kind={kind};"
                    f"systems={','.join(distinct_systems)};"
                    f"tolerance_deg={tolerance_deg}"
                ),
                "station_ids": [member.id for member in members],
                "junction_kind": kind,
                "system_ids": distinct_systems,
                "member_count": len(members),
            }
        )

    rebuilt.sort(key=lambda item: (item["junction_kind"], item["name"], item["member_count"]))
    return rebuilt


def write_shadow_table(
    conn: sqlite3.Connection,
    rebuilt_groups: list[dict[str, object]],
    tolerance_deg: float,
) -> None:
    conn.execute("DROP TABLE IF EXISTS junction_groups_rebuilt")
    conn.execute(
        """
        CREATE TABLE junction_groups_rebuilt (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            station_ids TEXT NOT NULL,
            junction_kind TEXT NOT NULL,
            system_ids TEXT NOT NULL,
            member_count INTEGER NOT NULL,
            tolerance_deg REAL NOT NULL,
            generated_at TEXT NOT NULL
        )
        """
    )
    generated_at = datetime.now(timezone.utc).isoformat()
    for group in rebuilt_groups:
        conn.execute(
            """
            INSERT INTO junction_groups_rebuilt
            (name, description, station_ids, junction_kind, system_ids, member_count, tolerance_deg, generated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                group["name"],
                group["description"],
                json.dumps(group["station_ids"], ensure_ascii=False),
                group["junction_kind"],
                json.dumps(group["system_ids"], ensure_ascii=False),
                int(group["member_count"]),
                tolerance_deg,
                generated_at,
            ),
        )
    conn.commit()


def print_summary(rebuilt_groups: list[dict[str, object]], stations: list[StationRecord]) -> None:
    total_members = sum(int(group["member_count"]) for group in rebuilt_groups)
    kind_counter = Counter(str(group["junction_kind"]) for group in rebuilt_groups)
    print(f"候选站点总数: {len(stations)}")
    print(f"重编得到枢纽数: {len(rebuilt_groups)}")
    print(f"普通枢纽: {kind_counter.get('junction', 0)}")
    print(f"大枢纽: {kind_counter.get('major_junction', 0)}")
    print(f"覆盖站点数: {total_members}")
    print("")
    for group in rebuilt_groups[:20]:
        print(
            f"- {group['name']} | {group['junction_kind']} | "
            f"systems={','.join(group['system_ids'])} | members={group['member_count']}"
        )
        print(f"  station_ids={','.join(group['station_ids'])}")


def main() -> int:
    args = parse_args()
    db_path = Path(args.db).resolve()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        prefix_map = load_pipeline_system_prefixes(conn)
        stations = load_candidate_stations(conn, prefix_map, include_valves=args.include_valves)
        rebuilt_groups = build_rebuilt_groups(stations, tolerance_deg=args.tolerance_deg)
        print_summary(rebuilt_groups, stations)

        if args.write_shadow:
            write_shadow_table(conn, rebuilt_groups, tolerance_deg=args.tolerance_deg)
            print("")
            print(f"已写入影子表 junction_groups_rebuilt -> {db_path}")

        if args.json_out:
            output_path = Path(args.json_out).resolve()
            payload = {
                "db_path": str(db_path),
                "tolerance_deg": args.tolerance_deg,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "group_count": len(rebuilt_groups),
                "groups": rebuilt_groups,
            }
            output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"已输出 JSON -> {output_path}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
