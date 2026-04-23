import sqlite3
import os

db_path = r"f:\smartgas-grid\backend\data\scada_history.db"
conn = sqlite3.connect(db_path)
cur = conn.cursor()
try:
    cur.execute("SELECT station_name, metric_type, COUNT(*) FROM scada_history GROUP BY station_name, metric_type")
    rows = cur.fetchall()
    print("Station | Metric | Count")
    for row in rows:
        print(row)
except Exception as e:
    print("Error:", e)
cur.close()
conn.close()
