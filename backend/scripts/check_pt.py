import sqlite3, json

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 1. 检查 pipeline_systems 表中是否有 pt
cur.execute("SELECT id, name, sort_order FROM pipeline_systems")
print("=== 所有管线系统 ===")
for r in cur.fetchall():
    print(f"  {r[0]}: {r[1]} (sort: {r[2]})")

print()

# 2. 单独检查 pt
cur.execute("SELECT * FROM pipeline_systems WHERE id = 'pt'")
r = cur.fetchone()
if r:
    print(f"pt 存在: {r}")
else:
    print("!!! pt 不存在 !!!")

print()

# 3. 检查 stations 中 PT 前缀的站场
cur.execute("SELECT COUNT(*) FROM stations WHERE id LIKE 'PT%'")
print(f"PT 前缀站场数: {cur.fetchone()[0]}")

cur.execute("SELECT id, name FROM stations WHERE id LIKE 'PT%' LIMIT 5")
for r in cur.fetchall():
    print(f"  {r[0]}: {r[1]}")

print()

# 4. 检查 pipelines 中 PT 前缀的管段
cur.execute("SELECT COUNT(*) FROM pipelines WHERE id LIKE 'PT%'")
print(f"PT 前缀管段数: {cur.fetchone()[0]}")

conn.close()
