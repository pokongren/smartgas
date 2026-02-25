import sqlite3
import pandas as pd
from pathlib import Path

DB_PATH = Path('f:/smartgas-grid/backend/data/smartgas.db')

def check_pipelines():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(pipelines);")
    cols = [row[1] for row in cursor.fetchall()]
    print(f"Pipeline columns: {cols}")
    
    for match in ['design_pressure_mpa', 'start_pressure_mpa', 'end_pressure_mpa']:
        if match in cols:
            cursor.execute(f"SELECT COUNT(*) FROM pipelines WHERE {match} IS NOT NULL")
            valid = cursor.fetchone()[0]
            cursor.execute(f"SELECT COUNT(*) FROM pipelines")
            total = cursor.fetchone()[0]
            print(f"{match}: {valid}/{total}")

if __name__ == '__main__':
    check_pipelines()
