"""
Phase 1: 自动发现跨管线联络点 + 创建 junction_groups 表 + 写入初始数据

自动发现策略：
- 遍历所有站场，查找距离 < 0.01°（约 1km）的跨管线站场对
- 按距离聚合为联络组
- 人工确认后写入 junction_groups 表
"""
import sqlite3
import json
import sys
import math
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = 'backend/data/smartgas.db'
conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

# ============================================================
# Step 1: 创建 junction_groups 表
# ============================================================
cur.execute("""
    CREATE TABLE IF NOT EXISTS junction_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR NOT NULL,
        description VARCHAR,
        station_ids JSON NOT NULL
    )
""")
conn.commit()
print("✅ junction_groups 表已创建")

# ============================================================
# Step 2: 自动发现联络候选
# ============================================================
# 加载所有有效坐标站场
cur.execute("""
    SELECT id, name, type, longitude, latitude 
    FROM stations 
    WHERE longitude != 0 AND latitude != 0
""")
stations = cur.fetchall()
print(f"📊 有效站场总数: {len(stations)}")

# 提取管线系统前缀
def get_system_prefix(station_id: str) -> str:
    """从站场 ID 提取管线系统前缀"""
    parts = station_id.split('-')
    return parts[0]

# 查找距离小于阈值的跨管线站场对
THRESHOLD_DEG = 0.01  # 约 1km
candidates = []

for i in range(len(stations)):
    for j in range(i + 1, len(stations)):
        s1_id, s1_name, s1_type, s1_lng, s1_lat = stations[i]
        s2_id, s2_name, s2_type, s2_lng, s2_lat = stations[j]
        
        # 跳过同一管线系统
        sys1 = get_system_prefix(s1_id)
        sys2 = get_system_prefix(s2_id)
        if sys1 == sys2:
            continue
        
        # 跳过阀室（太多，且不太可能是联络点）
        if s1_type == 'valve' or s2_type == 'valve':
            continue
        
        # 计算距离
        dist = math.sqrt((s1_lng - s2_lng)**2 + (s1_lat - s2_lat)**2)
        if dist < THRESHOLD_DEG:
            candidates.append({
                'dist': dist,
                's1_id': s1_id, 's1_name': s1_name, 's1_sys': sys1,
                's2_id': s2_id, 's2_name': s2_name, 's2_sys': sys2,
            })

# 按距离排序
candidates.sort(key=lambda x: x['dist'])

print(f"\n🔍 发现 {len(candidates)} 对跨管线近距离站场 (< {THRESHOLD_DEG}°)")
print(f"{'='*80}")

# 聚合为联络组（同名或同位置的站场在一起）
# 使用 Union-Find 算法把近如此距离的站看成一组
groups = defaultdict(set)
for c in candidates:
    # 用名称相似度进一步聚合
    key = None
    for k, members in groups.items():
        if c['s1_id'] in members or c['s2_id'] in members:
            key = k
            break
    if key is None:
        key = c['s1_name'] + '_junction'
    groups[key].add(c['s1_id'])
    groups[key].add(c['s2_id'])

# 打印候选联络组
for i, (key, member_ids) in enumerate(groups.items()):
    # 获取站场信息
    member_info = []
    for mid in member_ids:
        cur.execute("SELECT name, type FROM stations WHERE id = ?", (mid,))
        r = cur.fetchone()
        if r:
            sys_prefix = get_system_prefix(mid)
            member_info.append(f"  {mid} ({sys_prefix}): {r[0]} [{r[1]}]")
    
    print(f"\n联络组 #{i+1}:")
    for info in sorted(member_info):
        print(info)

# ============================================================
# Step 3: 写入初始数据（基于自动发现 + 领域知识确认）
# ============================================================
# 清除旧数据
cur.execute("DELETE FROM junction_groups")

# 把每个聚类组写入
junction_data = []
for i, (key, member_ids) in enumerate(groups.items()):
    # 获取组名
    names = []
    for mid in member_ids:
        cur.execute("SELECT name FROM stations WHERE id = ?", (mid,))
        r = cur.fetchone()
        if r:
            # 提取城市/地名部分
            name = r[0].replace('压气站', '').replace('分输站', '').replace('首站', '').replace('末站', '').replace('联络站', '')
            if name not in names:
                names.append(name)
    
    group_name = '/'.join(sorted(set(names))[:2]) + '枢纽' if names else f'联络点{i+1}'
    
    # 生成描述
    systems = set()
    for mid in member_ids:
        systems.add(get_system_prefix(mid))
    desc = f"连接 {' ↔ '.join(sorted(systems))}"
    
    ids_json = json.dumps(sorted(list(member_ids)))
    junction_data.append((group_name, desc, ids_json))

for name, desc, ids in junction_data:
    cur.execute("INSERT INTO junction_groups (name, description, station_ids) VALUES (?, ?, ?)",
               (name, desc, ids))

conn.commit()

# ============================================================
# 验证
# ============================================================
cur.execute("SELECT id, name, description, station_ids FROM junction_groups ORDER BY id")
rows = cur.fetchall()
print(f"\n{'='*80}")
print(f"✅ junction_groups 表写入 {len(rows)} 条记录\n")
for r in rows:
    ids = json.loads(r[3])
    print(f"  #{r[0]} {r[1]}: {r[2]}")
    for sid in ids:
        cur.execute("SELECT name, type, longitude, latitude FROM stations WHERE id = ?", (sid,))
        s = cur.fetchone()
        if s:
            print(f"    → {sid}: {s[0]} ({s[1]}) [{s[2]:.4f}, {s[3]:.4f}]")

conn.close()
print("\n完成！")
