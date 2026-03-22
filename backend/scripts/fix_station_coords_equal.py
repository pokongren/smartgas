"""
重新计算所有阀室坐标 —— 均分策略

策略：两个有坐标锚点之间的 N 个中间节点，按 1/(N+1), 2/(N+1), ... 等间距分配坐标，
不再使用里程比例。
"""
import sqlite3
import json
import os
import re
from collections import defaultdict

DB_PATH = 'backend/data/smartgas.db'

def extract_coords_from_ts(ts_path):
    coords = {}
    with open(ts_path, 'r', encoding='utf-8') as f:
        content = f.read()
    for m in re.finditer(r"'([^']+)':\s*\{\s*lng:\s*([\d.]+),\s*lat:\s*([\d.]+)\s*\}", content):
        coords[m.group(1)] = {'lng': float(m.group(2)), 'lat': float(m.group(3))}
    return coords

def extract_inline_nodes(ts_path):
    """提取 TS 中所有 [...] 节点数组"""
    with open(ts_path, 'r', encoding='utf-8') as f:
        content = f.read()
    lists = []
    for block in re.finditer(r'const\s+\w+\s*=\s*\[(.*?)\]\s*(?:as\s+const)?', content, re.DOTALL):
        nodes = []
        for m in re.finditer(r"\{\s*name:\s*'([^']+)',\s*mileage:\s*([\d.]+),\s*type:\s*'([^']+)'", block.group(1)):
            nodes.append({'name': m.group(1), 'mileage': float(m.group(2)), 'type': m.group(3)})
        if nodes:
            lists.append(nodes)
    return lists

def interpolate_equal(start, end, ratio):
    return {
        'lng': start['lng'] + (end['lng'] - start['lng']) * ratio,
        'lat': start['lat'] + (end['lat'] - start['lat']) * ratio
    }

def compute_equal_spacing(nodes, coords):
    """均分插值：两个锚点之间的中间节点等间距分配"""
    result = {}
    
    # 找锚点
    anchors = []
    for i, node in enumerate(nodes):
        if node['name'] in coords:
            anchors.append({'index': i, 'node': node, 'coord': coords[node['name']]})
            result[node['name']] = coords[node['name']]
    
    if len(anchors) < 2:
        return result
    
    # 对每对锚点之间的中间节点均分
    for a in range(len(anchors) - 1):
        curr = anchors[a]
        nxt = anchors[a + 1]
        
        # 中间节点数
        mid_count = nxt['index'] - curr['index'] - 1
        if mid_count <= 0:
            continue
        
        # 均分：第 k 个中间节点的比例 = k / (mid_count + 1)
        for k, j in enumerate(range(curr['index'] + 1, nxt['index']), start=1):
            mid_node = nodes[j]
            if mid_node['name'] in result:
                continue
            ratio = k / (mid_count + 1)
            result[mid_node['name']] = interpolate_equal(curr['coord'], nxt['coord'], ratio)
    
    return result

# ========== 主逻辑 ==========

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

# 先把所有非锚点站场坐标清零，重新计算
# 获取锚点集合（来自 TS 坐标字典的站场名）
all_anchor_names = set()

CONFIGS = [
    ('we1', 'src/data/pipelines/we1.ts', 'src/data/we1_structure.json'),
    ('we2', 'src/data/pipelines/we2.ts', 'src/data/pipelines/we2_structure.json'),
    ('cred', 'src/data/pipelines/cred.ts', 'src/data/cred_structure.json'),
    ('pt', 'src/data/pipelines/pt.ts', 'src/data/pt_structure.json'),
    ('zg', 'src/data/pipelines/zg.ts', 'src/data/zg_structure.json'),
    ('zm', 'src/data/pipelines/zm.ts', 'src/data/zm_structure.json'),
    ('gn', 'src/data/pipelines/gn.ts', 'src/data/gn_structure.json'),
    ('gs', 'src/data/pipelines/gs.ts', 'src/data/gs_structure.json'),
    ('sj4', 'src/data/pipelines/sj4.ts', None),
]

# 收集所有锚点名称和坐标
all_coords = {}
for sys_id, ts_path, _ in CONFIGS:
    if os.path.exists(ts_path):
        c = extract_coords_from_ts(ts_path)
        all_anchor_names.update(c.keys())
        all_coords.update(c)

print(f"锚点总数: {len(all_anchor_names)}")

# 重置所有非锚点站场的坐标为 0（完全重新计算）
reset_count = 0
cur.execute("SELECT id, name FROM stations")
for sid, sname in cur.fetchall():
    if sname not in all_anchor_names:
        cur.execute("UPDATE stations SET longitude = 0, latitude = 0 WHERE id = ?", (sid,))
        reset_count += 1
print(f"重置非锚点站场: {reset_count} 个\n")

# 获取当前零坐标站场
cur.execute("SELECT id, name FROM stations WHERE longitude = 0 OR latitude = 0")
zero_stations = {row[1]: row[0] for row in cur.fetchall()}
print(f"待处理: {len(zero_stations)} 个\n")

total_fixed = 0

# ---- 1. 有 structure.json 的管线 ----
for sys_id, ts_path, json_path in CONFIGS:
    if not os.path.exists(ts_path):
        continue
    
    coords = extract_coords_from_ts(ts_path)
    
    if json_path and os.path.exists(json_path):
        structure = json.load(open(json_path, 'r', encoding='utf-8'))
        
        # 干线
        trunk = structure.get('trunk', [])
        trunk_coords = compute_equal_spacing(trunk, coords)
        
        # 支线
        branches = structure.get('branches', [])
        branch_coords = {}
        # 支线需要用干线已计算的坐标作为可选锚点
        extended_coords = {**coords, **trunk_coords}
        for branch_nodes in branches:
            bc = compute_equal_spacing(branch_nodes, extended_coords)
            branch_coords.update(bc)
            extended_coords.update(bc)
        
        all_c = {**trunk_coords, **branch_coords}
    else:
        # sj4 等：从内联数据提取
        node_lists = extract_inline_nodes(ts_path)
        all_c = {}
        extended_coords = dict(coords)
        for node_list in node_lists:
            nc = compute_equal_spacing(node_list, extended_coords)
            all_c.update(nc)
            extended_coords.update(nc)
    
    fixed = 0
    for name, coord in all_c.items():
        if name in zero_stations:
            cur.execute(
                "UPDATE stations SET longitude = ?, latitude = ? WHERE id = ?",
                (round(coord['lng'], 6), round(coord['lat'], 6), zero_stations[name])
            )
            del zero_stations[name]
            fixed += 1
    
    if fixed > 0:
        print(f"  [{sys_id}] 均分修复: {fixed} 个")
    total_fixed += fixed

# ---- 2. 邻接 BFS 处理剩余 ----
print(f"\n剩余: {len(zero_stations)} 个，BFS 扩散处理...")

# 刷新有坐标的站场
cur.execute("SELECT id, longitude, latitude FROM stations WHERE longitude != 0 AND latitude != 0")
coord_map = {r[0]: (r[1], r[2]) for r in cur.fetchall()}

cur.execute("SELECT start_station_id, end_station_id FROM pipelines")
adj = defaultdict(list)
for s, e in cur.fetchall():
    adj[s].append(e)
    adj[e].append(s)

zero_set = set(zero_stations.values())  # station IDs
iteration = 0
while True:
    iteration += 1
    new_fixes = 0
    for sname, sid in list(zero_stations.items()):
        neighbors = adj.get(sid, [])
        coord_neighbors = [(n, coord_map[n]) for n in neighbors if n in coord_map]
        if not coord_neighbors:
            continue
        if len(coord_neighbors) == 1:
            _, (lng, lat) = coord_neighbors[0]
            offset = 0.05 * (1 if sid > coord_neighbors[0][0] else -1)
            new_lng, new_lat = lng + offset, lat + offset * 0.3
        else:
            new_lng = sum(c[0] for _, c in coord_neighbors) / len(coord_neighbors)
            new_lat = sum(c[1] for _, c in coord_neighbors) / len(coord_neighbors)
        
        cur.execute("UPDATE stations SET longitude = ?, latitude = ? WHERE id = ?",
                    (round(new_lng, 6), round(new_lat, 6), sid))
        coord_map[sid] = (new_lng, new_lat)
        del zero_stations[sname]
        new_fixes += 1
        total_fixed += 1
    
    if new_fixes == 0:
        break
    print(f"  迭代 {iteration}: {new_fixes} 个")

conn.commit()

# 验证
cur.execute("SELECT COUNT(*) FROM stations WHERE longitude = 0 OR latitude = 0")
remaining = cur.fetchone()[0]
print(f"\n总修复: {total_fixed} 个")
print(f"剩余零坐标: {remaining} 个")
conn.close()
print("完成！")
