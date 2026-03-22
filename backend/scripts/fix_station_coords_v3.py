"""
最终修复脚本 - 处理最后 75 个零坐标站场

策略：
1. 读取所有仍为0的站场
2. 按 ID 前缀分组（管线支线）
3. 对每组：从数据库已有坐标的相邻站场（按 pipeline 连接关系）推断坐标
4. 如果有两个以上锚点，执行插值；否则使用最近有坐标节点+微小偏移
"""
import sqlite3

DB_PATH = 'backend/data/smartgas.db'
conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

# 获取所有零坐标站场
cur.execute("SELECT id, name, type FROM stations WHERE longitude = 0 OR latitude = 0 ORDER BY id")
zero_list = cur.fetchall()
print(f"零坐标站场: {len(zero_list)} 个\n")

# 按 ID 前缀分组
from collections import defaultdict
groups = defaultdict(list)
for sid, name, stype in zero_list:
    # 解析前缀: WE1-B1, WE1-B2, etc.
    parts = sid.split('-')
    if len(parts) >= 3 and parts[1].startswith('B'):
        prefix = f"{parts[0]}-{parts[1]}"
    else:
        prefix = parts[0]
    groups[prefix].append((sid, name, stype))

for prefix, stations in sorted(groups.items()):
    print(f"  {prefix}: {len(stations)} 个")
    for sid, name, _ in stations[:3]:
        print(f"    {sid}: {name}")
    if len(stations) > 3:
        print(f"    ...")

# 策略：对于管段连接中从有坐标节点到无坐标节点，用管段端点推断
print("\n=== 通过 pipeline 连接关系推断坐标 ===")

# 获取所有管段连接
cur.execute("SELECT start_station_id, end_station_id FROM pipelines")
edges = cur.fetchall()

# 获取所有有坐标的站场
cur.execute("SELECT id, name, longitude, latitude FROM stations WHERE longitude != 0 AND latitude != 0")
coord_map = {}
for sid, name, lng, lat in cur.fetchall():
    coord_map[sid] = (lng, lat)

# 零坐标集合
zero_set = {sid for sid, _, _ in zero_list}

# 构建邻接表
adj = defaultdict(list)
for s, e in edges:
    adj[s].append(e)
    adj[e].append(s)

# BFS: 从有坐标节点扩散，给最近的零坐标节点分配相同坐标+微小偏移
fixed = 0
iteration = 0
while True:
    iteration += 1
    new_fixes = 0
    for sid in list(zero_set):
        neighbors = adj.get(sid, [])
        # 查找有坐标的邻居
        coord_neighbors = [(n, coord_map[n]) for n in neighbors if n in coord_map]
        if not coord_neighbors:
            continue
        
        # 如果只有一个有坐标邻居，微小偏移
        if len(coord_neighbors) == 1:
            n_id, (n_lng, n_lat) = coord_neighbors[0]
            # 确定方向: 如果有其他相邻有坐标节点，取平均方向
            # 简单方案: 基于管段顺序的微小经度偏移
            offset = 0.05 * (1 if sid > n_id else -1)
            new_lng = n_lng + offset
            new_lat = n_lat + offset * 0.3  # 略微偏上
        else:
            # 两个有坐标邻居，取中点
            lngs = [c[0] for _, c in coord_neighbors]
            lats = [c[1] for _, c in coord_neighbors]
            new_lng = sum(lngs) / len(lngs)
            new_lat = sum(lats) / len(lats)
        
        cur.execute(
            "UPDATE stations SET longitude = ?, latitude = ? WHERE id = ?",
            (round(new_lng, 6), round(new_lat, 6), sid)
        )
        coord_map[sid] = (new_lng, new_lat)
        zero_set.discard(sid)
        new_fixes += 1
        fixed += 1
    
    print(f"  迭代 {iteration}: 修复 {new_fixes} 个")
    if new_fixes == 0:
        break

conn.commit()

# 最终验证
cur.execute("SELECT COUNT(*) FROM stations WHERE longitude = 0 OR latitude = 0")
remaining = cur.fetchone()[0]
print(f"\n本次修复: {fixed} 个")
print(f"剩余零坐标: {remaining} 个")

if remaining > 0:
    cur.execute("SELECT id, name, type FROM stations WHERE longitude = 0 OR latitude = 0")
    for r in cur.fetchall():
        print(f"  {r}")

conn.close()
print("\n完成！")
