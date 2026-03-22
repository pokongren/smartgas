import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 查看 node_relation_details 中的所有 trunk_name
cur.execute("SELECT DISTINCT trunk_name, COUNT(*) FROM node_relation_details GROUP BY trunk_name ORDER BY trunk_name")
print("=== 所有 trunk_name ===")
for r in cur.fetchall():
    print(f"  {r[0]}: {r[1]} 条记录")

print()

# 搜索南昌-上海
cur.execute("""
    SELECT DISTINCT trunk_name, branch_name 
    FROM node_relation_details 
    WHERE trunk_name LIKE '%南昌%' OR trunk_name LIKE '%上海%'
       OR branch_name LIKE '%南昌%上海%'
""")
print("=== 含南昌/上海的管线 ===")
for r in cur.fetchall():
    print(f"  干: {r[0]} | 支: {r[1]}")

# 搜索 tables
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
print("\n=== 所有表 ===")
for r in cur.fetchall():
    print(f"  {r[0]}")

conn.close()
