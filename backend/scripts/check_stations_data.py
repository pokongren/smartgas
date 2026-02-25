import sqlite3
import pandas as pd
from pathlib import Path

DB_PATH = Path('f:/smartgas-grid/backend/data/smartgas.db')

def check_stations():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(stations);")
    cols = [row[1] for row in cursor.fetchall()]
    print(f"Station columns: {cols}")
    
    for match in ['design_pressure', 'operating_pressure_in', 'operating_pressure_out', 'operating_temp_in', 'operating_temp_out', 'capacity']:
        if match in cols:
            cursor.execute(f"SELECT COUNT(*) FROM stations WHERE {match} IS NOT NULL")
            valid = cursor.fetchone()[0]
            cursor.execute(f"SELECT COUNT(*) FROM stations")
            total = cursor.fetchone()[0]
            print(f"{match}: {valid}/{total}")
            
            cursor.execute(f"SELECT {match} FROM stations LIMIT 5")
            samples = cursor.fetchall()
            print(f"Samples: {[s[0] for s in samples]}")

if __name__ == '__main__':
    check_stations()
