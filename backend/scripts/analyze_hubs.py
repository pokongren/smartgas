"""分析各管线汇聚点：找出度数最高的非阀室站场"""
import sqlite3, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 1. 每个站场的管段连接数（度数）
cur.execute("""
    SELECT s.id, s.name, s.type, s.longitude, s.latitude,
           COUNT(DISTINCT p.id) as degree
    FROM stations s
    JOIN pipelines p ON p.start_station_id = s.id OR p.end_station_id = s.id
    WHERE s.longitude != 0 AND s.type != 'valve'
    GROUP BY s.id
    HAVING degree >= 3
    ORDER BY degree DESC
""")
high_degree = cur.fetchall()
print(f"=== 度数 >= 3 的非阀室站场（天然枢纽） ===")
print(f"| 站场名 | 类型 | 度数 | 经度 | 纬度 | 来源管线 |")
print(f"|--------|------|------|------|------|---------|")
for sid, name, stype, lng, lat, deg in high_degree:
    # 获取关联管线系统
    cur.execute("""
        SELECT DISTINCT 
            CASE WHEN p.id LIKE '%%-T-%%' THEN SUBSTR(p.id, 1, INSTR(p.id, '-T-') - 1)
                 ELSE SUBSTR(p.id, 1, INSTR(p.id, '-') - 1)
            END
        FROM pipelines p 
        WHERE p.start_station_id = ? OR p.end_station_id = ?
    """, (sid, sid))
    systems = [r[0] for r in cur.fetchall()]
    print(f"| {name} | {stype} | {deg} | {lng:.2f} | {lat:.2f} | {','.join(systems)} |")

# 2. 跨管线系统的站场（真正的枢纽）
print(f"\n=== 跨管线系统站场（通过 junction_groups 发现） ===")
cur.execute("SELECT id, name, description, station_ids FROM junction_groups ORDER BY id")
for jid, jname, desc, ids_json in cur.fetchall():
    import json
    ids = json.loads(ids_json)
    stations_info = []
    for sid in ids:
        cur.execute("SELECT name, type FROM stations WHERE id = ?", (sid,))
        r = cur.fetchone()
        if r:
            prefix = sid.split('-')[0]
            stations_info.append(f"{prefix}:{r[0]}")
    print(f"  #{jid} {jname} — {' ↔ '.join(stations_info)}")

conn.close()
