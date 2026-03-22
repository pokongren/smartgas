"""补充漏掉的跨系统枢纽到 junction_groups"""
import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 需要补充的跨系统枢纽（从 analyze_hubs.py 发现）
# 中卫: WE1 ↔ WE2 ↔ ZG (三线汇聚)
# 广州: WE2 ↔ GN ↔ GS (珠三角)
# 贵阳: ZG ↔ ZM (西南)
# 薛店: WE1 ↔ PT
# 古浪: WE1 ↔ WE2
# 红柳: WE1 ↔ WE2
# 鲁山: WE2 ↔ PT
# 泰安: CRED ↔ PT
# 南宁: ZM ↔ GN
# 贵港: ZM ↔ GN

new_hubs = [
    # (名称, 描述, 站场名关键词列表)
    ('中卫枢纽', '三线汇聚：WE1 ↔ WE2 ↔ ZG', ['中卫']),
    ('广州枢纽', '珠三角枢纽：WE2 ↔ GN ↔ GS', ['广州']),
    ('贵阳枢纽', '西南枢纽：ZG ↔ ZM', ['贵阳']),
    ('薛店枢纽', 'WE1 ↔ PT', ['薛店']),
    ('古浪枢纽', 'WE1 ↔ WE2', ['古浪']),
    ('红柳枢纽', 'WE1 ↔ WE2', ['红柳']),
    ('鲁山枢纽', 'WE2 ↔ PT', ['鲁山']),
    ('泰安枢纽', 'CRED ↔ PT', ['泰安']),
    ('南宁枢纽', 'ZM ↔ GN', ['南宁分输']),
    ('贵港枢纽', 'ZM ↔ GN', ['贵港']),
]

added = 0
for hub_name, desc, keywords in new_hubs:
    # 检查是否已存在
    cur.execute("SELECT id FROM junction_groups WHERE name = ?", (hub_name,))
    if cur.fetchone():
        print(f"  ⏭️  {hub_name} 已存在")
        continue
    
    # 查找跨系统的同名/近名站场
    station_ids = []
    for kw in keywords:
        cur.execute("""
            SELECT id, name FROM stations 
            WHERE name LIKE ? AND longitude != 0 AND type != 'valve'
        """, (f"%{kw}%",))
        for sid, sname in cur.fetchall():
            station_ids.append(sid)
    
    if len(station_ids) < 2:
        # 单个站场但度数>=3也算枢纽（管内枢纽）
        if len(station_ids) == 1:
            print(f"  ⚠️  {hub_name}: 只有1个站场 {station_ids[0]}，作为管内枢纽录入")
        else:
            print(f"  ❌ {hub_name}: 未找到站场")
            continue
    
    ids_json = json.dumps(sorted(station_ids))
    cur.execute("INSERT INTO junction_groups (name, description, station_ids) VALUES (?, ?, ?)",
               (hub_name, desc, ids_json))
    added += 1
    print(f"  ✅ {hub_name}: {len(station_ids)} 个站场 {station_ids}")

conn.commit()

# 验证
cur.execute("SELECT id, name, description, station_ids FROM junction_groups ORDER BY id")
rows = cur.fetchall()
print(f"\n{'='*50}")
print(f"junction_groups 总计 {len(rows)} 个枢纽 (新增 {added})")
for r in rows:
    ids = json.loads(r[3])
    print(f"  #{r[0]} {r[1]}: {len(ids)} 站场 — {r[2]}")

conn.close()
