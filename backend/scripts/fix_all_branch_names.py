"""
诊断所有管线系统的支线名称问题
找出所有用泛化名称（如"xxx支线1"）的支线，并提取真实首末站名称
"""
import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

cur.execute("SELECT id, name, layers_config FROM pipeline_systems ORDER BY sort_order")
systems = cur.fetchall()

all_fixes = {}

for sys_id, sys_name, layers_json in systems:
    layers = json.loads(layers_json)
    branches = [l for l in layers if l['type'] == 'branch']
    if not branches:
        continue
    
    has_generic = False
    for b in branches:
        # 检查是否是泛化名称（如"西气东输一线支线1"或"西气东输一线1"）
        name = b['name']
        if any(c.isdigit() for c in name) and name[-1].isdigit():
            has_generic = True
            break
    
    if not has_generic:
        continue
    
    print(f"\n{'='*50}")
    print(f"{sys_id}: {sys_name} — 有 {len(branches)} 条支线需要修复")
    
    fixes = {}
    for b in branches:
        prefix = b['id_prefix']
        
        # 查询该支线的管段
        cur.execute("""
            SELECT id, start_station_id, end_station_id 
            FROM pipelines WHERE id LIKE ?
            ORDER BY CAST(SUBSTR(id, ?) AS INTEGER)
        """, (f"{prefix}-%", len(prefix) + 2))
        bpipes = cur.fetchall()
        
        if not bpipes:
            print(f"  {prefix}: {b['name']} → ⚠️ 无管段数据")
            continue
        
        # 首站
        cur.execute("SELECT name FROM stations WHERE id = ?", (bpipes[0][1],))
        first = cur.fetchone()
        # 末站
        cur.execute("SELECT name FROM stations WHERE id = ?", (bpipes[-1][2],))
        last = cur.fetchone()
        
        first_name = first[0] if first else "?"
        last_name = last[0] if last else "?"
        
        new_name = f"{first_name}-{last_name}支线"
        fixes[prefix] = new_name
        
        print(f"  {prefix}: {b['name']} → {new_name} ({len(bpipes)}段)")
    
    all_fixes[sys_id] = fixes

# 执行修复
print(f"\n{'='*50}")
print("正在更新数据库...")

for sys_id, fixes in all_fixes.items():
    cur.execute("SELECT layers_config FROM pipeline_systems WHERE id = ?", (sys_id,))
    layers = json.loads(cur.fetchone()[0])
    
    updated = False
    for layer in layers:
        if layer['id_prefix'] in fixes:
            layer['name'] = fixes[layer['id_prefix']]
            layer['visible'] = True
            updated = True
    
    if updated:
        cur.execute("UPDATE pipeline_systems SET layers_config = ? WHERE id = ?",
                   (json.dumps(layers, ensure_ascii=False), sys_id))
        print(f"  ✅ {sys_id}: 更新了 {len(fixes)} 条支线名称")

conn.commit()

# 验证
print(f"\n{'='*50}")
print("验证结果:")
for sys_id, _ in all_fixes.items():
    cur.execute("SELECT layers_config FROM pipeline_systems WHERE id = ?", (sys_id,))
    layers = json.loads(cur.fetchone()[0])
    branches = [l for l in layers if l['type'] == 'branch']
    print(f"\n  {sys_id}:")
    for b in branches:
        print(f"    {b['id_prefix']}: {b['name']}")

conn.close()
print("\n完成！")
