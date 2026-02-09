import sqlite3
conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()
cursor.execute("SELECT id, name FROM pipelines WHERE id LIKE 'LINE1%' OR id LIKE 'LINE2%' OR id LIKE 'LINE3%' LIMIT 5")
print("LINE 1/2/3 Examples:")
for r in cursor.fetchall():
    print(f"ID: {r[0]}, Name: {r[1]}")
conn.close()
