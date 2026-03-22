import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

cur.execute("SELECT id, name, sort_order FROM pipeline_systems ORDER BY sort_order")
for r in cur.fetchall():
    print(f"  sort={r[2]} id={r[0]} name={r[1]}")

conn.close()
