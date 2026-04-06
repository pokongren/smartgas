from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
DB_PATH = ROOT_DIR / "backend" / "data" / "raw_excel_index.db"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Query the raw Excel index database.")
    parser.add_argument("keyword", help="Keyword to search in indexed rows.")
    parser.add_argument("--db", type=Path, default=DB_PATH, help="Path to raw_excel_index.db")
    parser.add_argument("--sheet", default="", help="Optional sheet name filter")
    parser.add_argument("--limit", type=int, default=20, help="Max rows to return")
    return parser.parse_args()


def open_connection(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def fts_available(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'indexed_rows_fts'"
    ).fetchone()
    return row is not None


def search(conn: sqlite3.Connection, keyword: str, sheet: str, limit: int) -> list[sqlite3.Row]:
    if fts_available(conn):
        sql = """
        SELECT r.sheet_name, r.table_name, r.row_number, r.row_text
        FROM indexed_rows_fts f
        JOIN indexed_rows r ON r.id = f.rowid
        WHERE indexed_rows_fts MATCH ?
        """
        params: list[object] = [keyword]
        if sheet:
            sql += " AND r.sheet_name = ?"
            params.append(sheet)
        sql += " ORDER BY r.sheet_name, r.row_number LIMIT ?"
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()
        if rows:
            return rows

    sql = """
    SELECT sheet_name, table_name, row_number, row_text
    FROM indexed_rows
    WHERE row_text LIKE ?
    """
    params = [f"%{keyword}%"]
    if sheet:
        sql += " AND sheet_name = ?"
        params.append(sheet)
    sql += " ORDER BY sheet_name, row_number LIMIT ?"
    params.append(limit)
    return conn.execute(sql, params).fetchall()


def main() -> None:
    args = parse_args()
    conn = open_connection(args.db.resolve())
    try:
        rows = search(conn, args.keyword, args.sheet, args.limit)
        if not rows:
            print("No matches found.")
            return
        for row in rows:
            print(f'[{row["sheet_name"]}] row={row["row_number"]} table={row["table_name"]}')
            print(row["row_text"])
            print("-" * 72)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
