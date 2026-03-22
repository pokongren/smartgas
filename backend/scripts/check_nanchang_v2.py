import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 检查 node_relation_details 表中南昌-上海相关数据
cur.execute("""
    SELECT DISTINCT trunk_name, branch_name, COUNT(*) as cnt
    FROM node_relation_details
    WHERE branch_name LIKE '%南昌%' OR branch_name LIKE '%上海%'
    GROUP BY trunk_name, branch_name
    ORDER BY trunk_name
""")
print("=== 南昌/上海相关支线 ===")
for r in cur.fetchall():
    print(f"  干线: {r[0]} | 支线: {r[1]} | 节点数: {r[2]}")

print()

# 看一下具体节点
cur.execute("""
    SELECT node_name, mileage, branch_name
    FROM node_relation_details
    WHERE branch_name LIKE '%南昌%上海%' OR branch_name LIKE '%上海%南昌%'
    ORDER BY mileage
    LIMIT 30
""")
print("=== 南昌-上海支干线节点 ===")
for r in cur.fetchall():
    print(f"  {r[0]}: mileage={r[1]}, branch={r[2]}")

# 也搜一下所有含 "上海" 的支线
cur.execute("""
    SELECT DISTINCT branch_name FROM node_relation_details
    WHERE branch_name LIKE '%上海%'
""")
print("\n=== 含'上海'的支线名 ===")
for r in cur.fetchall():
    print(f"  {r[0]}")

# 也列出 we2 structure 的支线名
print("\n=== we2_structure.json 中的支线 ===")
with open('src/data/pipelines/we2_structure.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
for i, name in enumerate(data.get('branch_names', [])):
    branch = data['branches'][i] if i < len(data.get('branches', [])) else []
    print(f"  B{i+1}: {name} ({len(branch)} 节点)")

conn.close()
