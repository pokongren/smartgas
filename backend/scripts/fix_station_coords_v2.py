"""
增强修复脚本 - 处理剩余的 146 个零坐标站场

策略：
1. 从 sj4.ts 提取所有内联节点（干线+支线），执行里程插值
2. 对各管线支线也从 structure.json 提取支线节点去做插值
3. 回填数据库
"""
import sqlite3
import json
import os
import re

DB_PATH = 'backend/data/smartgas.db'

def extract_coords_from_ts(ts_path: str) -> dict:
    coords = {}
    with open(ts_path, 'r', encoding='utf-8') as f:
        content = f.read()
    pattern = r"'([^']+)':\s*\{\s*lng:\s*([\d.]+),\s*lat:\s*([\d.]+)\s*\}"
    for match in re.finditer(pattern, content):
        name, lng, lat = match.group(1), float(match.group(2)), float(match.group(3))
        coords[name] = {'lng': lng, 'lat': lat}
    return coords

def extract_inline_nodes_from_ts(ts_path: str) -> list:
    """提取 TS 文件中的内联节点数组（如 sj4.ts 中的 TRUNK_NODES, BRANCH_N_NODES）"""
    node_lists = []
    with open(ts_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 匹配 const XXXX_NODES = [...] 或 const XXXX = [...]
    # 用简单的方式：匹配 { name: 'xxx', mileage: N, type: 'xxx' }
    pattern = r"\{\s*name:\s*'([^']+)',\s*mileage:\s*([\d.]+),\s*type:\s*'([^']+)'"
    
    # 按块分组：找到 const XXXX_NODES = [ 块
    block_pattern = r'const\s+\w+\s*=\s*\[(.*?)\]\s*(?:as\s+const)?'
    for block_match in re.finditer(block_pattern, content, re.DOTALL):
        block = block_match.group(1)
        nodes = []
        for node_match in re.finditer(pattern, block):
            nodes.append({
                'name': node_match.group(1),
                'mileage': float(node_match.group(2)),
                'type': node_match.group(3)
            })
        if nodes:
            node_lists.append(nodes)
    
    return node_lists

def interpolate(start, end, ratio):
    return {
        'lng': start['lng'] + (end['lng'] - start['lng']) * ratio,
        'lat': start['lat'] + (end['lat'] - start['lat']) * ratio
    }

def compute_interpolated_coords(nodes, coords):
    result = {}
    anchors = []
    for i, node in enumerate(nodes):
        if node['name'] in coords:
            anchors.append({'index': i, 'node': node, 'coord': coords[node['name']]})
            result[node['name']] = coords[node['name']]
    
    if len(anchors) < 2:
        return result
    
    for a in range(len(anchors) - 1):
        curr = anchors[a]
        nxt = anchors[a + 1]
        section_dist = nxt['node']['mileage'] - curr['node']['mileage']
        if section_dist <= 0:
            continue
        for j in range(curr['index'] + 1, nxt['index']):
            mid_node = nodes[j]
            if mid_node['name'] in result:
                continue
            ratio = max(0, min(1, (mid_node['mileage'] - curr['node']['mileage']) / section_dist))
            result[mid_node['name']] = interpolate(curr['coord'], nxt['coord'], ratio)
    return result

# ========== 主逻辑 ==========

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

cur.execute("SELECT id, name FROM stations WHERE longitude = 0 OR latitude = 0")
zero_stations = {row[1]: row[0] for row in cur.fetchall()}
print(f"剩余零坐标站场: {len(zero_stations)} 个\n")

total_fixed = 0

# ---- 1. 处理 sj4：从内联数据提取 ----
print("=== sj4 (陕京四线) ===")
sj4_coords = extract_coords_from_ts('src/data/pipelines/sj4.ts')
sj4_node_lists = extract_inline_nodes_from_ts('src/data/pipelines/sj4.ts')
print(f"  坐标字典: {len(sj4_coords)} 个锚点, {len(sj4_node_lists)} 个节点列表")

for i, node_list in enumerate(sj4_node_lists):
    all_coords = compute_interpolated_coords(node_list, sj4_coords)
    fixed = 0
    for name, coord in all_coords.items():
        if name in zero_stations:
            station_id = zero_stations[name]
            cur.execute(
                "UPDATE stations SET longitude = ?, latitude = ? WHERE id = ?",
                (round(coord['lng'], 6), round(coord['lat'], 6), station_id)
            )
            fixed += 1
            del zero_stations[name]
    if fixed > 0:
        print(f"  节点列表[{i}]: 修复 {fixed} 个")
    total_fixed += fixed

# ---- 2. 处理其他管线的支线（也需要插值） ----
configs = [
    ('we1', 'src/data/pipelines/we1.ts', 'src/data/we1_structure.json'),
    ('we2', 'src/data/pipelines/we2.ts', 'src/data/pipelines/we2_structure.json'),
    ('cred', 'src/data/pipelines/cred.ts', 'src/data/cred_structure.json'),
    ('pt', 'src/data/pipelines/pt.ts', 'src/data/pt_structure.json'),
    ('zg', 'src/data/pipelines/zg.ts', 'src/data/zg_structure.json'),
    ('zm', 'src/data/pipelines/zm.ts', 'src/data/zm_structure.json'),
    ('gn', 'src/data/pipelines/gn.ts', 'src/data/gn_structure.json'),
    ('gs', 'src/data/pipelines/gs.ts', 'src/data/gs_structure.json'),
]

print("\n=== 其他管线支线 ===")
for sys_id, ts_path, json_path in configs:
    if not os.path.exists(ts_path) or not json_path or not os.path.exists(json_path):
        continue
    
    coords = extract_coords_from_ts(ts_path)
    
    # 也把数据库中有坐标的站场加入坐标字典（用于支线连接干线的情况）
    for name in list(coords.keys()):
        pass  # 已有
    
    # 从数据库获取该管线已有坐标的站场
    prefix = sys_id.upper()
    cur.execute(f"SELECT name, longitude, latitude FROM stations WHERE id LIKE '{prefix}%' AND longitude != 0 AND latitude != 0")
    for row in cur.fetchall():
        if row[0] not in coords:
            coords[row[0]] = {'lng': row[1], 'lat': row[2]}
    
    structure = json.load(open(json_path, 'r', encoding='utf-8'))
    
    # 支线处理
    branches = structure.get('branches', [])
    fixed = 0
    for branch_nodes in branches:
        bc = compute_interpolated_coords(branch_nodes, coords)
        for name, coord in bc.items():
            if name in zero_stations:
                station_id = zero_stations[name]
                cur.execute(
                    "UPDATE stations SET longitude = ?, latitude = ? WHERE id = ?",
                    (round(coord['lng'], 6), round(coord['lat'], 6), station_id)
                )
                fixed += 1
                del zero_stations[name]
    
    if fixed > 0:
        print(f"  [{sys_id}] 支线修复: {fixed} 个")
    total_fixed += fixed

# ---- 3. 也尝试从 TS 内联数据提取其他管线 ----
print("\n=== 从 TS 内联数据提取 ===")
for sys_id, ts_path, _ in configs:
    if not os.path.exists(ts_path):
        continue
    coords = extract_coords_from_ts(ts_path)
    # 补充数据库已有坐标
    prefix = sys_id.upper()
    cur.execute(f"SELECT name, longitude, latitude FROM stations WHERE id LIKE '{prefix}%' AND longitude != 0 AND latitude != 0")
    for row in cur.fetchall():
        if row[0] not in coords:
            coords[row[0]] = {'lng': row[1], 'lat': row[2]}
    
    inline_lists = extract_inline_nodes_from_ts(ts_path)
    fixed = 0
    for node_list in inline_lists:
        bc = compute_interpolated_coords(node_list, coords)
        for name, coord in bc.items():
            if name in zero_stations:
                station_id = zero_stations[name]
                cur.execute(
                    "UPDATE stations SET longitude = ?, latitude = ? WHERE id = ?",
                    (round(coord['lng'], 6), round(coord['lat'], 6), station_id)
                )
                fixed += 1
                del zero_stations[name]
    if fixed > 0:
        print(f"  [{sys_id}] 内联修复: {fixed} 个")
    total_fixed += fixed

conn.commit()

# 验证
cur.execute("SELECT COUNT(*) FROM stations WHERE longitude = 0 OR latitude = 0")
remaining = cur.fetchone()[0]
print(f"\n本次修复: {total_fixed} 个")
print(f"剩余零坐标: {remaining} 个")

if remaining > 0:
    cur.execute("SELECT type, COUNT(*) FROM stations WHERE longitude = 0 OR latitude = 0 GROUP BY type")
    print("剩余按类型:", cur.fetchall())
    cur.execute("SELECT id, name, type FROM stations WHERE longitude = 0 OR latitude = 0 LIMIT 10")
    for r in cur.fetchall():
        print(f"  {r}")

conn.close()
print("\n完成！")
