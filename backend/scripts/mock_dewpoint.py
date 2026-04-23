import sqlite3
import random
from datetime import datetime, timedelta

db_path = r"f:\smartgas-grid\backend\data\scada_history.db"
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Delete old mock if exists
cur.execute("DELETE FROM scada_history WHERE station_name = '甪直分输站' AND metric_type = 'dewpoint'")

cur.execute("SELECT MAX(recorded_at) FROM scada_history WHERE station_name='甪直分输站'")
res = cur.fetchone()[0]
if res:
    end_time = datetime.fromisoformat(res)
else:
    end_time = datetime.now()

start_time = end_time - timedelta(hours=12)
records = []
current_time = start_time
current_val = -15.0 # Typical natural gas dewpoint

while current_time <= end_time:
    records.append((
        "甪直分输站",
        "we1",
        "ZE_DP1101.PV",
        "dewpoint",
        current_time.isoformat(),
        round(current_val, 2)
    ))
    current_time += timedelta(minutes=1)
    # Add a slightly downward trend to trigger a warning (e.g. drop by 3.5 eventually to get '高' risk)
    # the drop must be within 6h. Let's make it drop steadily so it triggers an AI conclusion!
    current_val += random.uniform(-0.1, 0.05) 

cur.executemany("""
INSERT INTO scada_history (station_name, pipeline_id, tag_name, metric_type, recorded_at, value)
VALUES (?, ?, ?, ?, ?, ?)
""", records)
conn.commit()
print(f"Inserted {len(records)} dewpoint records into scada_history.db")
cur.close()
conn.close()
