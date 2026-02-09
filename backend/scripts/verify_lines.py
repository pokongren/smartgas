"""
验证西一线、西二线、西三线的管道数据
"""
import sqlite3
import sys

conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()

print("=" * 70, flush=True)
print("管道数据验证报告", flush=True)
print("=" * 70, flush=True)

# 按线路统计管道段数量
cursor.execute("""
    SELECT 
        CASE 
            WHEN id LIKE 'LINE1%' THEN '西一线'
            WHEN id LIKE 'LINE2%' THEN '西二线'
            WHEN id LIKE 'LINE3%' THEN '西三线'
            WHEN id LIKE 'LINE4%' THEN '西四线'
            ELSE '其他'
        END as line_name,
        COUNT(*) as segment_count,
        AVG(length) as avg_length,
        SUM(length) as total_length,
        MIN(diameter) as diameter
    FROM pipelines
    WHERE id LIKE 'LINE%'
    GROUP BY line_name
    ORDER BY line_name
""")

print("\n各线路管道段统计:", flush=True)
print("-" * 70, flush=True)
print(f"{'线路':<10} {'段数':>8} {'平均长度(km)':>15} {'总长度(km)':>15} {'管径(mm)':>10}", flush=True)
print("-" * 70, flush=True)

for row in cursor.fetchall():
    line_name, count, avg_len, total_len, diameter = row
    print(f"{line_name:<10} {count:>8} {avg_len:>15.2f} {total_len:>15.2f} {diameter:>10}", flush=True)

# 检查每条线路的首尾站点
print("\n" + "=" * 70, flush=True)
print("各线路首尾站点:", flush=True)
print("-" * 70, flush=True)

for line_prefix, line_name in [('LINE1', '西一线'), ('LINE2', '西二线'), ('LINE3', '西三线')]:
    # 获取第一段
    cursor.execute("""
        SELECT p.name, s1.name, s2.name, p.length
        FROM pipelines p
        JOIN stations s1 ON p.start_station_id = s1.id
        JOIN stations s2 ON p.end_station_id = s2.id
        WHERE p.id LIKE ?
        ORDER BY p.id
        LIMIT 1
    """, (f'{line_prefix}%',))
    
    first = cursor.fetchone()
    
    # 获取最后一段
    cursor.execute("""
        SELECT p.name, s1.name, s2.name, p.length
        FROM pipelines p
        JOIN stations s1 ON p.start_station_id = s1.id
        JOIN stations s2 ON p.end_station_id = s2.id
        WHERE p.id LIKE ?
        ORDER BY p.id DESC
        LIMIT 1
    """, (f'{line_prefix}%',))
    
    last = cursor.fetchone()
    
    if first and last:
        print(f"\n{line_name}:", flush=True)
        print(f"  起点: {first[1]} → {first[2]} (长度: {first[3]:.2f}km)", flush=True)
        print(f"  终点: {last[1]} → {last[2]} (长度: {last[3]:.2f}km)", flush=True)
    else:
        print(f"\n{line_name}: 未找到数据", flush=True)

# 检查是否有孤立的站点(没有连接的管道)
print("\n" + "=" * 70, flush=True)
print("数据完整性检查:", flush=True)
print("-" * 70, flush=True)

cursor.execute("""
    SELECT COUNT(DISTINCT start_station_id) + COUNT(DISTINCT end_station_id) as connected_stations
    FROM pipelines
    WHERE id LIKE 'LINE1%' OR id LIKE 'LINE2%' OR id LIKE 'LINE3%'
""")
connected = cursor.fetchone()[0]

cursor.execute("""
    SELECT COUNT(*) FROM stations
""")
total_stations = cursor.fetchone()[0]

print(f"总站点数: {total_stations}", flush=True)
print(f"已连接站点数(西一/二/三线): {connected}", flush=True)
print(f"连接率: {connected/total_stations*100:.1f}%", flush=True)

print("\n" + "=" * 70, flush=True)
print("✓ 验证完成", flush=True)
print("=" * 70, flush=True)

conn.close()
