import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 检查南昌相关站场
cur.execute("SELECT id, name, type, longitude, latitude FROM stations WHERE name LIKE '%南昌%' OR name LIKE '%上海%'")
results = cur.fetchall()
print(f"=== 南昌/上海相关站场 ({len(results)}) ===")
for r in results:
    print(f"  {r[0]}: {r[1]} ({r[2]}) [{r[3]}, {r[4]}]")

print()

# 检查 we2 的支线中是否有南昌-上海
cur.execute("SELECT layers_config FROM pipeline_systems WHERE id = 'we2'")
config = json.loads(cur.fetchone()[0])
print("=== we2 layers ===")
for layer in config:
    print(f"  {layer['id_prefix']}: {layer['name']} ({layer['type']})")

print()

# 查看所有 structure.json 中的 branch_names
import os, glob
for f in glob.glob('src/data/*_structure.json'):
    with open(f, 'r', encoding='utf-8') as fh:
        data = json.load(fh)
    names = data.get('branch_names', [])
    if any('南昌' in n or '上海' in n for n in names):
        print(f"  {f}: {[n for n in names if '南昌' in n or '上海' in n]}")

conn.close()
