import sqlite3
import os

db_path = "f:/smartgas-grid/backend/data/smartgas.db"

if not os.path.exists(db_path):
    # Try alternate path seen in code
    db_path = "f:/smartgas-grid/backend/smartgas.db"

print(f"Checking database at: {db_path}")

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check pipelines table
    cursor.execute("PRAGMA table_info(pipelines)")
    columns = [row[1] for row in cursor.fetchall()]
    print(f"Current columns in 'pipelines': {columns}")
    
    missing_columns = [
        ("start_pressure_mpa", "REAL"),
        ("end_pressure_mpa", "REAL"),
        ("diameter_mm", "REAL"),
        ("length_km", "REAL")
    ]
    
    for col_name, col_type in missing_columns:
        if col_name not in columns:
            print(f"Adding missing column: {col_name}")
            cursor.execute(f"ALTER TABLE pipelines ADD COLUMN {col_name} {col_type}")
    
    # Check stations table
    cursor.execute("PRAGMA table_info(stations)")
    station_columns = [row[1] for row in cursor.fetchall()]
    print(f"Current columns in 'stations': {station_columns}")
    
    missing_station_columns = [
        ("design_pressure", "REAL"),
        ("operating_pressure_in", "REAL"),
        ("operating_pressure_out", "REAL"),
        ("operating_temp_in", "REAL"),
        ("operating_temp_out", "REAL"),
        ("capacity", "REAL")
    ]
    
    for col_name, col_type in missing_station_columns:
        if col_name not in station_columns:
            print(f"Adding missing column to stations: {col_name}")
            cursor.execute(f"ALTER TABLE stations ADD COLUMN {col_name} {col_type}")
    
    conn.commit()
    print("Database schema updated successfully.")
    conn.close()
except Exception as e:
    print(f"Error: {e}")
