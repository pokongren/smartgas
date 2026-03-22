"""
更新陕京四线 layers_config 的支线名称
从管段首末站推断支线的真实名称
"""
import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 获取每条支线的首末站名称
branch_names = {}
for bn in range(1, 11):
    prefix = f'SJ4-B{bn}-'
    cur.execute("""
        SELECT id, start_station_id, end_station_id 
        FROM pipelines WHERE id LIKE ?
        ORDER BY CAST(SUBSTR(id, ?) AS INTEGER)
    """, (f"{prefix}%", len(prefix) + 1))
    bpipes = cur.fetchall()
    if not bpipes:
        continue
    
    # 首站
    cur.execute("SELECT name FROM stations WHERE id = ?", (bpipes[0][1],))
    first = cur.fetchone()[0]
    # 末站
    cur.execute("SELECT name FROM stations WHERE id = ?", (bpipes[-1][2],))
    last = cur.fetchone()[0]
    
    # 用首末站生成支线名称
    branch_names[f'SJ4-B{bn}'] = f'{first}-{last}支线'

print("=== 支线名称映射 ===")
for k, v in branch_names.items():
    print(f"  {k}: {v}")

# 更新 layers_config
cur.execute("SELECT layers_config FROM pipeline_systems WHERE id = 'sj4'")
layers = json.loads(cur.fetchone()[0])

new_layers = []
for layer in layers:
    if layer['type'] == 'branch':
        prefix = layer['id_prefix']
        if prefix in branch_names:
            layer['name'] = branch_names[prefix]
            layer['visible'] = True  # 默认显示
    new_layers.append(layer)

cur.execute("UPDATE pipeline_systems SET layers_config = ? WHERE id = 'sj4'",
           (json.dumps(new_layers, ensure_ascii=False),))
conn.commit()

# 验证
cur.execute("SELECT layers_config FROM pipeline_systems WHERE id = 'sj4'")
layers = json.loads(cur.fetchone()[0])
print("\n=== 更新后的 layers_config ===")
for layer in layers:
    print(f"  {layer['id_prefix']}: {layer['name']} ({layer['type']}, visible={layer.get('visible')})")

conn.close()
print("\n完成！")
