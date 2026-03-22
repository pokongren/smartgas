import sqlite3
conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()
cur.execute("DELETE FROM pipeline_systems WHERE id='ncsh'")
cur.execute("DELETE FROM stations WHERE id LIKE 'NCSH%'")
cur.execute("DELETE FROM pipelines WHERE id LIKE 'NCSH%'")
conn.commit()
print("Cleaned NCSH data")
conn.close()
