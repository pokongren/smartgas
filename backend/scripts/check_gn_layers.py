import sqlite3, json
conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 查看广南支干线的图层配置
cur.execute("SELECT id, name, layers_config FROM pipeline_systems WHERE id = 'gn'")
r = cur.fetchone()
print(f"=== {r[0]}: {r[1]} ===")
for layer in json.loads(r[2]):
    print(json.dumps(layer, ensure_ascii=False))

print()

# 也查看前端原始文件中支线名称
cur.execute("SELECT id, name, layers_config FROM pipeline_systems WHERE id = 'gs'")
r = cur.fetchone()
print(f"=== {r[0]}: {r[1]} ===")
for layer in json.loads(r[2]):
    print(json.dumps(layer, ensure_ascii=False))

conn.close()
