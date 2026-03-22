"""
验证 SJ4 管段的连接顺序是否正确
检查干线管段是否形成连续路径，还是有跳跃/混乱
"""
import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 获取干线管段
cur.execute("""
    SELECT id, start_station_id, end_station_id 
    FROM pipelines WHERE id LIKE 'SJ4-T-%'
    ORDER BY CAST(SUBSTR(id, 7) AS INTEGER)
""")
trunk_pipes = cur.fetchall()

print(f"=== SJ4 干线管段 ({len(trunk_pipes)}) ===")
print(f"检查管段是否形成连续路径（前一段 end = 下一段 start）\n")

prev_end = None
broken_links = 0
for i, (pid, start, end) in enumerate(trunk_pipes):
    cur.execute("SELECT name, longitude, latitude FROM stations WHERE id = ?", (start,))
    s1 = cur.fetchone()
    cur.execute("SELECT name, longitude, latitude FROM stations WHERE id = ?", (end,))
    s2 = cur.fetchone()
    
    is_continuous = "✓" if prev_end is None or prev_end == start else f"⚠️ 断裂! (prev_end={prev_end})"
    if prev_end is not None and prev_end != start:
        broken_links += 1
    
    s1_name = s1[0] if s1 else "?"
    s2_name = s2[0] if s2 else "?"
    
    print(f"  T-{i+1}: {start}({s1_name}) → {end}({s2_name}) {is_continuous}")
    prev_end = end

print(f"\n断裂点: {broken_links}")

# 支线管段也检查
print(f"\n=== SJ4 支线管段 ===")
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
    
    prev_end = None
    broken = 0
    for pid, start, end in bpipes:
        if prev_end and prev_end != start:
            broken += 1
        prev_end = end
    
    # 显示首末站名
    cur.execute("SELECT name FROM stations WHERE id = ?", (bpipes[0][1],))
    first = cur.fetchone()
    cur.execute("SELECT name FROM stations WHERE id = ?", (bpipes[-1][2],))
    last = cur.fetchone()
    
    first_name = first[0] if first else "?"
    last_name = last[0] if last else "?"
    
    status = f"⚠️ {broken}断裂" if broken else "✓"
    print(f"  B{bn}: {first_name} → {last_name} ({len(bpipes)}段) {status}")

conn.close()
