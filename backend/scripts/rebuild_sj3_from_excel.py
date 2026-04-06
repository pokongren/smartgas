import json
import re
import sqlite3
from pathlib import Path
from typing import Any

import openpyxl
import requests

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DB_PATH = DATA_DIR / "smartgas.db"
SHEET_NAME = "\u7ba1\u9053\u7ad9\u573a\u9600\u5ba4\u5173\u7cfb"
PIPELINE_NAME = "\u9655\u4eac\u4e09\u7ebf"
BRANCH_NAME = "\u9655\u4eac\u4e09\u7ebf\u5e72\u7ebf"
SYSTEM_ID = "sj3"
SYSTEM_NAME = PIPELINE_NAME
ID_PREFIX = "SJ3"
COLOR = "#78909C"
GEOCODE_URL = (
    "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates"
)
STATION_COORD_OVERRIDES: dict[str, tuple[float, float, str]] = {
    # 永清压气站在多系统里是同一处站场，地理编码容易打偏到永清县城区南侧。
    "永清压气站": (116.50, 39.32, "manual_override:aligned_with_yongqing_hub"),
}


def resolve_xlsx_path() -> Path:
    raw_dir = DATA_DIR / "raw_csvs"
    files = sorted(p for p in raw_dir.glob("*.xlsx") if not p.name.startswith("~$"))
    if not files:
        raise FileNotFoundError(f"No usable xlsx found under {raw_dir}")
    return files[0]


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def load_entries() -> list[dict[str, Any]]:
    workbook = openpyxl.load_workbook(resolve_xlsx_path(), read_only=True, data_only=True)
    sheet = workbook[SHEET_NAME]
    entries: list[dict[str, Any]] = []
    for row_index, row in enumerate(sheet.iter_rows(values_only=True), start=1):
        if row_index == 1:
            continue
        if normalize_text(row[0]) != PIPELINE_NAME or normalize_text(row[1]) != BRANCH_NAME:
            continue
        entries.append(
            {
                "row": row_index,
                "station": normalize_text(row[2]),
                "calc_station": normalize_text(row[3]),
                "mileage": float(row[6] or 0.0),
                "symbol": normalize_text(row[13]),
                "type2024": normalize_text(row[14]),
                "type2025": normalize_text(row[15]),
                "location": normalize_text(row[16]),
            }
        )
    workbook.close()
    return entries


def determine_station_type(entry: dict[str, Any]) -> str:
    text = " ".join(
        part for part in (entry["station"], entry["type2024"], entry["type2025"]) if part
    )
    if "\u9600\u5ba4" in text:
        return "valve"
    if "\u538b\u6c14\u7ad9" in text:
        return "compressor"
    return "distribution"


def extract_region_prefix(location: str) -> str:
    if not location:
        return ""
    direct = [
        "\u5317\u4eac\u5e02",
        "\u5929\u6d25\u5e02",
        "\u4e0a\u6d77\u5e02",
        "\u91cd\u5e86\u5e02",
    ]
    for city in direct:
        if location.startswith(city):
            match = re.match(rf"^({city}.+?(?:\u533a|\u53bf|\u5e02))", location)
            return match.group(1) if match else city
    match = re.match(
        r"^(.+?(?:\u7701|\u81ea\u6cbb\u533a).+?(?:\u5e02|\u5dde|\u76df).+?(?:\u533a|\u53bf|\u5e02))",
        location,
    )
    if match:
        return match.group(1)
    match = re.match(r"^(.+?(?:\u5e02|\u5dde|\u76df).+?(?:\u533a|\u53bf|\u5e02))", location)
    if match:
        return match.group(1)
    return location[:12]


def infer_location_context(entries: list[dict[str, Any]], index: int) -> str:
    target_mileage = entries[index]["mileage"]
    same_mileage_locations = [
        item["location"]
        for item in entries
        if item["location"] and abs(item["mileage"] - target_mileage) < 1e-6
    ]
    if same_mileage_locations:
        return same_mileage_locations[0]

    for offset in range(1, len(entries)):
        left = index - offset
        if left >= 0 and entries[left]["location"]:
            return entries[left]["location"]
        right = index + offset
        if right < len(entries) and entries[right]["location"]:
            return entries[right]["location"]
    return ""


def geocode_candidates(entry: dict[str, Any], entries: list[dict[str, Any]], index: int) -> list[str]:
    candidates: list[str] = []
    location = entry["location"]
    station = entry["station"]
    if location:
        candidates.append(location)
        candidates.append(f"{location} {station}")
    context_location = infer_location_context(entries, index)
    context_prefix = extract_region_prefix(context_location)
    if context_prefix:
        candidates.append(f"{context_prefix}{station}")
        candidates.append(context_prefix)
    candidates.append(station)

    deduped: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        normalized = normalize_text(item)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


def geocode_address(query: str) -> tuple[float, float, str] | None:
    params = {
        "f": "json",
        "singleLine": query,
        "maxLocations": 1,
        "outFields": "Match_addr,Addr_type,Type,PlaceName,Place_addr,Score",
    }
    response = requests.get(GEOCODE_URL, params=params, timeout=20)
    response.raise_for_status()
    data = response.json()
    candidates = data.get("candidates") or []
    if not candidates:
        return None
    location = candidates[0].get("location") or {}
    if "x" not in location or "y" not in location:
        return None
    return float(location["x"]), float(location["y"]), query


def assign_anchor_coordinates(entries: list[dict[str, Any]]) -> dict[str, int]:
    stats = {
        "anchor_total": 0,
        "geocode_success": 0,
        "same_mileage_copy": 0,
        "missing_anchor": 0,
    }
    geocode_cache: dict[str, tuple[float, float, str] | None] = {}
    mileage_anchor_cache: dict[float, tuple[float, float, str]] = {}

    for index, entry in enumerate(entries):
        entry["type"] = determine_station_type(entry)
        entry["lng"] = 0.0
        entry["lat"] = 0.0
        entry["position_meta"] = {"mode": "pending"}

        if entry["type"] == "valve":
            continue

        stats["anchor_total"] += 1
        override = STATION_COORD_OVERRIDES.get(entry["station"])
        if override is not None:
            lng, lat, source = override
            entry["lng"] = lng
            entry["lat"] = lat
            entry["position_meta"] = {"mode": "manual_override", "source": source}
            mileage_anchor_cache.setdefault(entry["mileage"], (lng, lat, f"copied:{entry['station']}"))
            continue

        result: tuple[float, float, str] | None = None
        for query in geocode_candidates(entry, entries, index):
            if query not in geocode_cache:
                try:
                    geocode_cache[query] = geocode_address(query)
                except Exception:
                    geocode_cache[query] = None
            result = geocode_cache[query]
            if result:
                break

        if result is None and entry["mileage"] in mileage_anchor_cache:
            lng, lat, source = mileage_anchor_cache[entry["mileage"]]
            result = (lng, lat, source)
            stats["same_mileage_copy"] += 1

        if result is None:
            stats["missing_anchor"] += 1
            entry["position_meta"] = {"mode": "missing"}
            continue

        lng, lat, source = result
        entry["lng"] = lng
        entry["lat"] = lat
        mode = "copied_same_mileage" if source.startswith("copied:") else "geocode"
        entry["position_meta"] = {"mode": mode, "source": source}
        if mode == "geocode":
            stats["geocode_success"] += 1
        mileage_anchor_cache.setdefault(entry["mileage"], (lng, lat, f"copied:{entry['station']}"))

    return stats


def interpolate_valves(entries: list[dict[str, Any]]) -> dict[str, int]:
    stats = {
        "interpolated_valves": 0,
        "copied_valves": 0,
        "unresolved_valves": 0,
    }
    anchors = [(idx, item) for idx, item in enumerate(entries) if item["type"] != "valve" and item["lng"] != 0.0]

    for idx, entry in enumerate(entries):
        if entry["type"] != "valve":
            continue

        prev_anchor = None
        next_anchor = None
        for anchor_idx, anchor_entry in anchors:
            if anchor_idx < idx:
                prev_anchor = (anchor_idx, anchor_entry)
            elif anchor_idx > idx:
                next_anchor = (anchor_idx, anchor_entry)
                break

        if prev_anchor and next_anchor:
            prev_entry = prev_anchor[1]
            next_entry = next_anchor[1]
            mileage_span = next_entry["mileage"] - prev_entry["mileage"]
            if mileage_span > 0:
                ratio = (entry["mileage"] - prev_entry["mileage"]) / mileage_span
            else:
                ratio = (idx - prev_anchor[0]) / (next_anchor[0] - prev_anchor[0])
            ratio = min(max(ratio, 0.0), 1.0)
            entry["lng"] = prev_entry["lng"] + (next_entry["lng"] - prev_entry["lng"]) * ratio
            entry["lat"] = prev_entry["lat"] + (next_entry["lat"] - prev_entry["lat"]) * ratio
            entry["position_meta"] = {
                "mode": "interpolated",
                "ratio": round(ratio, 6),
                "start": prev_entry["station"],
                "end": next_entry["station"],
            }
            stats["interpolated_valves"] += 1
            continue

        single_anchor = prev_anchor[1] if prev_anchor else next_anchor[1] if next_anchor else None
        if single_anchor:
            entry["lng"] = single_anchor["lng"]
            entry["lat"] = single_anchor["lat"]
            entry["position_meta"] = {"mode": "copied_anchor", "anchor": single_anchor["station"]}
            stats["copied_valves"] += 1
            continue

        stats["unresolved_valves"] += 1
        entry["position_meta"] = {"mode": "missing"}

    return stats


def spread_duplicate_coordinate_runs(entries: list[dict[str, Any]], epsilon: float = 1e-7) -> dict[str, int]:
    stats = {
        "duplicate_runs_fixed": 0,
        "duplicate_nodes_repositioned": 0,
        "duplicate_runs_skipped": 0,
    }

    def same_coord(left: dict[str, Any], right: dict[str, Any]) -> bool:
        return (
            abs(float(left["lng"]) - float(right["lng"])) <= epsilon
            and abs(float(left["lat"]) - float(right["lat"])) <= epsilon
        )

    index = 0
    while index < len(entries):
        current = entries[index]
        if current["lng"] == 0.0 or current["lat"] == 0.0:
            index += 1
            continue

        run_end = index
        while (
            run_end + 1 < len(entries)
            and entries[run_end + 1]["lng"] != 0.0
            and entries[run_end + 1]["lat"] != 0.0
            and same_coord(entries[index], entries[run_end + 1])
        ):
            run_end += 1

        if run_end == index:
            index += 1
            continue

        prev_entry = entries[index - 1] if index - 1 >= 0 else None
        next_entry = entries[run_end + 1] if run_end + 1 < len(entries) else None
        if (
            prev_entry is None
            or next_entry is None
            or prev_entry["lng"] == 0.0
            or prev_entry["lat"] == 0.0
            or next_entry["lng"] == 0.0
            or next_entry["lat"] == 0.0
            or same_coord(prev_entry, next_entry)
        ):
            stats["duplicate_runs_skipped"] += 1
            index = run_end + 1
            continue

        run_size = run_end - index + 1
        for offset, entry_index in enumerate(range(index, run_end + 1), start=1):
            ratio = offset / (run_size + 1)
            entry = entries[entry_index]
            original_lng = entry["lng"]
            original_lat = entry["lat"]
            entry["lng"] = prev_entry["lng"] + (next_entry["lng"] - prev_entry["lng"]) * ratio
            entry["lat"] = prev_entry["lat"] + (next_entry["lat"] - prev_entry["lat"]) * ratio
            entry["position_meta"] = {
                "mode": "duplicate_run_spread",
                "ratio": round(ratio, 6),
                "start": prev_entry["station"],
                "end": next_entry["station"],
                "original": [round(original_lng, 6), round(original_lat, 6)],
            }
            stats["duplicate_nodes_repositioned"] += 1

        stats["duplicate_runs_fixed"] += 1
        index = run_end + 1

    return stats


def delete_existing_sj3(cursor: sqlite3.Cursor) -> None:
    cursor.execute("SELECT id, station_ids FROM junction_groups")
    for group_id, station_ids in cursor.fetchall():
        try:
            parsed = json.loads(station_ids or "[]")
        except Exception:
            parsed = []
        if any(str(item).startswith(ID_PREFIX) for item in parsed):
            cursor.execute("DELETE FROM junction_groups WHERE id = ?", (group_id,))

    cursor.execute("DELETE FROM pipelines WHERE id LIKE 'SJ3-%'")
    cursor.execute("DELETE FROM stations WHERE id LIKE 'SJ3-%'")
    cursor.execute("DELETE FROM pipeline_systems WHERE id = ?", (SYSTEM_ID,))


def write_to_db(entries: list[dict[str, Any]]) -> None:
    connection = sqlite3.connect(DB_PATH)
    cursor = connection.cursor()
    delete_existing_sj3(cursor)

    max_sort = cursor.execute("SELECT MAX(sort_order) FROM pipeline_systems").fetchone()[0] or 0
    layers_config = json.dumps(
        [{"id_prefix": ID_PREFIX, "name": "\u9655\u4eac\u4e09\u7ebf\u5e72\u7ebf", "type": "trunk", "visible": True}],
        ensure_ascii=False,
    )
    cursor.execute(
        """
        INSERT INTO pipeline_systems (id, name, color, sort_order, layers_config)
        VALUES (?, ?, ?, ?, ?)
        """,
        (SYSTEM_ID, SYSTEM_NAME, COLOR, max_sort + 1, layers_config),
    )

    for index, entry in enumerate(entries, start=1):
        station_id = f"{ID_PREFIX}-{index}"
        properties = json.dumps(
            {
                "row": entry["row"],
                "mileageKm": entry["mileage"],
                "positionMeta": entry["position_meta"],
            },
            ensure_ascii=False,
        )
        cursor.execute(
            """
            INSERT INTO stations (id, name, type, longitude, latitude, properties)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (station_id, entry["station"], entry["type"], entry["lng"], entry["lat"], properties),
        )

    for index in range(len(entries) - 1):
        start = entries[index]
        end = entries[index + 1]
        segment_id = f"{ID_PREFIX}-T-{index + 1}"
        start_id = f"{ID_PREFIX}-{index + 1}"
        end_id = f"{ID_PREFIX}-{index + 2}"
        length_km = max(end["mileage"] - start["mileage"], 0.0)
        cursor.execute(
            """
            INSERT INTO pipelines (
                id, name, start_station_id, end_station_id,
                diameter_mm, length_km, diameter, length, category
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                segment_id,
                "\u9655\u4eac\u4e09\u7ebf\u5e72\u7ebf",
                start_id,
                end_id,
                1016,
                length_km,
                1016,
                length_km * 1000,
                "trunk",
            ),
        )

    connection.commit()
    connection.close()


def print_summary(
    entries: list[dict[str, Any]],
    anchor_stats: dict[str, int],
    valve_stats: dict[str, int],
    duplicate_stats: dict[str, int],
) -> None:
    resolved = sum(1 for item in entries if item["lng"] != 0.0 and item["lat"] != 0.0)
    zero_count = len(entries) - resolved
    print("=" * 60)
    print("SJ3 rebuild complete")
    print(f"rows: {len(entries)}")
    print(f"resolved: {resolved}")
    print(f"zero_coords: {zero_count}")
    print(f"anchors: {anchor_stats}")
    print(f"valves: {valve_stats}")
    print(f"duplicate_runs: {duplicate_stats}")
    print("head:")
    for item in entries[:5]:
        print(item["row"], item["station"], item["mileage"], round(item["lng"], 6), round(item["lat"], 6), item["position_meta"])
    print("tail:")
    for item in entries[-5:]:
        print(item["row"], item["station"], item["mileage"], round(item["lng"], 6), round(item["lat"], 6), item["position_meta"])


def main() -> None:
    entries = load_entries()
    if len(entries) != 71:
        raise RuntimeError(f"Expected 71 SJ3 rows, got {len(entries)}")
    anchor_stats = assign_anchor_coordinates(entries)
    valve_stats = interpolate_valves(entries)
    duplicate_stats = spread_duplicate_coordinate_runs(entries)
    unresolved = [item["station"] for item in entries if item["lng"] == 0.0 or item["lat"] == 0.0]
    if unresolved:
        raise RuntimeError(f"Unresolved coordinates remain: {unresolved}")
    write_to_db(entries)
    print_summary(entries, anchor_stats, valve_stats, duplicate_stats)


if __name__ == "__main__":
    main()
