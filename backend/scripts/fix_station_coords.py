"""
从前端 _structure.json + 数据库已有坐标进行插值修复

策略：
1. 读取数据库中有坐标的站场（锚点）
2. 读取 _structure.json 中的里程信息
3. 对无坐标的中间站场执行线性插值
4. UPDATE 回数据库
"""
import sqlite3
import json
import os
import re
import math

DB_PATH = 'backend/data/smartgas.db'
DATA_DIR = 'src/data'

# ========== 1. 从 TS 文件中提取坐标字典 ==========

def extract_coords_from_ts(ts_path: str) -> dict:
    """
    解析 TS 文件中的坐标字典定义
    格式: 'xxx站': { lng: 84.25, lat: 41.78 }
    """
    coords = {}
    with open(ts_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 匹配形如 'xxx': { lng: 84.25, lat: 41.78 } 的模式
    pattern = r"'([^']+)':\s*\{\s*lng:\s*([\d.]+),\s*lat:\s*([\d.]+)\s*\}"
    for match in re.finditer(pattern, content):
        name, lng, lat = match.group(1), float(match.group(2)), float(match.group(3))
        coords[name] = {'lng': lng, 'lat': lat}
    
    return coords

# ========== 2. 读取 structure.json ==========

def load_structure(json_path: str) -> dict:
    """加载管线结构文件"""
    with open(json_path, 'r', encoding='utf-8') as f:
        return json.load(f)

# ========== 3. 插值逻辑 ==========

def interpolate(start_coord, end_coord, ratio):
    """线性插值"""
    return {
        'lng': start_coord['lng'] + (end_coord['lng'] - start_coord['lng']) * ratio,
        'lat': start_coord['lat'] + (end_coord['lat'] - start_coord['lat']) * ratio
    }

def compute_interpolated_coords(nodes, coords):
    """
    对节点列表执行里程插值
    nodes: [{ name, mileage, type, ... }]
    coords: { name: { lng, lat } }
    返回: { name: { lng, lat } }  包含所有节点的坐标
    """
    result = {}
    
    # 找出锚点（有坐标的节点）
    anchors = []
    for i, node in enumerate(nodes):
        if node['name'] in coords:
            anchors.append({'index': i, 'node': node, 'coord': coords[node['name']]})
            result[node['name']] = coords[node['name']]
    
    if len(anchors) < 2:
        # 锚点不足，只能使用已有坐标
        return result
    
    # 对每对锚点之间的中间节点插值
    for a in range(len(anchors) - 1):
        curr = anchors[a]
        nxt = anchors[a + 1]
        section_dist = nxt['node']['mileage'] - curr['node']['mileage']
        
        if section_dist <= 0:
            continue
        
        # 遍历中间节点
        for j in range(curr['index'] + 1, nxt['index']):
            mid_node = nodes[j]
            if mid_node['name'] in result:
                continue  # 已有坐标
            
            ratio = (mid_node['mileage'] - curr['node']['mileage']) / section_dist
            ratio = max(0, min(1, ratio))  # 限制在 0-1
            
            mid_coord = interpolate(curr['coord'], nxt['coord'], ratio)
            result[mid_node['name']] = mid_coord
    
    return result

# ========== 4. 主逻辑 ==========

# 管线配置: (系统ID, TS文件, structure.json)
PIPELINE_CONFIGS = [
    ('we1', 'src/data/pipelines/we1.ts', 'src/data/we1_structure.json'),
    ('we2', 'src/data/pipelines/we2.ts', 'src/data/pipelines/we2_structure.json'),
    ('cred', 'src/data/pipelines/cred.ts', 'src/data/cred_structure.json'),
    ('pt', 'src/data/pipelines/pt.ts', 'src/data/pt_structure.json'),
    ('zg', 'src/data/pipelines/zg.ts', 'src/data/zg_structure.json'),
    ('zm', 'src/data/pipelines/zm.ts', 'src/data/zm_structure.json'),
    ('gn', 'src/data/pipelines/gn.ts', 'src/data/gn_structure.json'),
    ('gs', 'src/data/pipelines/gs.ts', 'src/data/gs_structure.json'),
    ('sj4', 'src/data/pipelines/sj4.ts', None),  # 陕京四线无 structure.json
]

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

# 获取所有零坐标站场
cur.execute("SELECT id, name FROM stations WHERE longitude = 0 OR latitude = 0")
zero_stations = {row[1]: row[0] for row in cur.fetchall()}
print(f"数据库中零坐标站场: {len(zero_stations)} 个\n")

total_fixed = 0

for sys_id, ts_path, json_path in PIPELINE_CONFIGS:
    if not os.path.exists(ts_path):
        print(f"  [{sys_id}] TS 文件不存在: {ts_path}")
        continue
    
    # 提取 TS 文件中的坐标字典
    coords = extract_coords_from_ts(ts_path)
    print(f"  [{sys_id}] TS 坐标字典: {len(coords)} 个锚点")
    
    if json_path and os.path.exists(json_path):
        # 有 structure.json，可以执行插值
        structure = load_structure(json_path)
        
        # 处理干线
        trunk_nodes = structure.get('trunk', [])
        trunk_coords = compute_interpolated_coords(trunk_nodes, coords)
        
        # 处理支线
        branches = structure.get('branches', [])
        branch_names = structure.get('branch_names', [])
        branch_coords = {}
        for branch_nodes in branches:
            bc = compute_interpolated_coords(branch_nodes, coords)
            branch_coords.update(bc)
        
        all_coords = {**trunk_coords, **branch_coords}
        print(f"         插值后总坐标: {len(all_coords)} 个")
        
        # 更新数据库
        fixed = 0
        for name, coord in all_coords.items():
            if name in zero_stations:
                station_id = zero_stations[name]
                cur.execute(
                    "UPDATE stations SET longitude = ?, latitude = ? WHERE id = ?",
                    (round(coord['lng'], 6), round(coord['lat'], 6), station_id)
                )
                fixed += 1
        
        print(f"         修复: {fixed} 个站场")
        total_fixed += fixed
    else:
        # 无 structure.json（如 sj4），只用 TS 坐标字典直接更新
        fixed = 0
        for name, coord in coords.items():
            if name in zero_stations:
                station_id = zero_stations[name]
                cur.execute(
                    "UPDATE stations SET longitude = ?, latitude = ? WHERE id = ?",
                    (round(coord['lng'], 6), round(coord['lat'], 6), station_id)
                )
                fixed += 1
        print(f"         直接修复: {fixed} 个站场")
        total_fixed += fixed

conn.commit()

# 验证修复结果
cur.execute("SELECT COUNT(*) FROM stations WHERE longitude = 0 OR latitude = 0")
remaining = cur.fetchone()[0]
print(f"\n总修复: {total_fixed} 个站场")
print(f"剩余零坐标: {remaining} 个")

if remaining > 0:
    cur.execute("SELECT type, COUNT(*) FROM stations WHERE longitude = 0 OR latitude = 0 GROUP BY type")
    print("剩余按类型:", cur.fetchall())
    
    # 显示部分剩余
    cur.execute("SELECT id, name, type FROM stations WHERE longitude = 0 OR latitude = 0 LIMIT 10")
    for r in cur.fetchall():
        print(f"  {r}")

conn.close()
print("\n完成！")
