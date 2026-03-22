"""
诊断陕京四线(SJ4)的渲染问题
检查: 站场坐标、管段连接、图层配置
"""
import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 1. SJ4 管线系统信息
cur.execute("SELECT id, name, layers_config FROM pipeline_systems WHERE id = 'sj4'")
r = cur.fetchone()
print(f"=== {r[0]}: {r[1]} ===")
layers = json.loads(r[2])
for layer in layers:
    print(f"  {layer['id_prefix']}: {layer['name']} ({layer['type']})")

print()

# 2. 站场统计
cur.execute("SELECT COUNT(*) FROM stations WHERE id LIKE 'SJ4%'")
print(f"SJ4 站场总数: {cur.fetchone()[0]}")

# 看干线站场
cur.execute("""
    SELECT id, name, type, longitude, latitude 
    FROM stations WHERE id LIKE 'SJ4_TRUNK%'
    ORDER BY id
""")
trunk_stations = cur.fetchall()
print(f"\n=== 干线站场 (SJ4_TRUNK) ===")
for r in trunk_stations[:15]:
    zero = " ⚠️零坐标" if r[3] == 0 or r[4] == 0 else ""
    print(f"  {r[0]}: {r[1]} ({r[2]}) [{r[3]:.4f}, {r[4]:.4f}]{zero}")
if len(trunk_stations) > 15:
    print(f"  ... 还有 {len(trunk_stations) - 15} 个")

print()

# 3. 管段统计
cur.execute("SELECT COUNT(*) FROM pipelines WHERE id LIKE 'SJ4%'")
print(f"SJ4 管段总数: {cur.fetchone()[0]}")

# 干线管段
cur.execute("""
    SELECT id, name, start_station_id, end_station_id 
    FROM pipelines WHERE id LIKE 'SJ4_TRUNK%'
    ORDER BY id
    LIMIT 20
""")
print(f"\n=== 干线管段 (SJ4_TRUNK) ===")
for r in cur.fetchall():
    # 检查端点站场是否存在
    cur.execute("SELECT name FROM stations WHERE id = ?", (r[2],))
    s1 = cur.fetchone()
    cur.execute("SELECT name FROM stations WHERE id = ?", (r[3],))
    s2 = cur.fetchone()
    s1_name = s1[0] if s1 else "❌不存在"
    s2_name = s2[0] if s2 else "❌不存在"
    print(f"  {r[0]}: {s1_name} → {s2_name}")

print()

# 4. 支线管段 - 检查站场引用是否有效
cur.execute("""
    SELECT p.id, p.start_station_id, p.end_station_id 
    FROM pipelines p 
    WHERE p.id LIKE 'SJ4%'
    AND (
        p.start_station_id NOT IN (SELECT id FROM stations)
        OR p.end_station_id NOT IN (SELECT id FROM stations)
    )
""")
broken = cur.fetchall()
print(f"=== 断裂管段（引用不存在的站场）: {len(broken)} 条 ===")
for r in broken[:10]:
    print(f"  {r[0]}: {r[1]} → {r[2]}")

# 5. 支线站场（0节点的支线）
for layer in layers:
    if layer['type'] == 'branch':
        prefix = layer['id_prefix']
        cur.execute("SELECT COUNT(*) FROM stations WHERE id LIKE ?", (f"{prefix}%",))
        cnt = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM pipelines WHERE id LIKE ?", (f"{prefix}%",))
        pcnt = cur.fetchone()[0]
        print(f"  {prefix} ({layer['name']}): {cnt} 站场, {pcnt} 管段")

conn.close()
