"""
重新绘制陕京四线 (SJ4) - 仅限干线

基于 Pipeline Master System 工作流，从前端 sj4.ts 读取坐标和干线节点数据，
仅建立干线的站场和管段，丢弃之前未连线的杂乱支线。
"""
import sys, os, re, json, sqlite3
sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = os.path.join(os.getcwd(), 'backend', 'data', 'smartgas.db')
if not os.path.exists(DB_PATH):
    DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'backend', 'data', 'smartgas.db')

TS_PATH = os.path.join(os.path.dirname(DB_PATH), '..', '..', 'src', 'data', 'pipelines', 'sj4.ts')

SYSTEM_ID = 'sj4'
SYSTEM_NAME = '陕京四线'
SYSTEM_COLOR = '#607D8B'
ID_PREFIX = 'SJ4'

def main():
    print(f"Reading from {TS_PATH}")
    with open(TS_PATH, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # 1. 解析坐标 (COORDS)
    coords = {}
    coord_pattern = r"'([^']+)'\s*:\s*\{\s*lng\s*:\s*([\d.]+)\s*,\s*lat\s*:\s*([\d.]+)\s*\}"
    for match in re.finditer(coord_pattern, content):
        name = match.group(1)
        lng = float(match.group(2))
        lat = float(match.group(3))
        coords[name] = (lng, lat)
    
    # 2. 解析 TRUNK_NODES
    trunk_match = re.search(r"const\s+TRUNK_NODES\s*=\s*\[(.*?)\]\s*as\s*const", content, re.DOTALL)
    if not trunk_match:
        print("未找到 TRUNK_NODES")
        return
        
    trunk_content = trunk_match.group(1)
    node_pattern = r"\{\s*name\s*:\s*'([^']+)'\s*,\s*mileage\s*:\s*([\d.]+)\s*,\s*type\s*:\s*'([^']+)'"
    
    trunk_nodes = []
    for match in re.finditer(node_pattern, trunk_content):
        trunk_nodes.append({
            'name': match.group(1),
            'mileage': float(match.group(2)),
            'type': match.group(3),
        })
    
    print(f"提取到 {len(coords)} 个坐标和 {len(trunk_nodes)} 个干线节点")
    
    # 构建数据库插入数据
    stations = []
    for i, node in enumerate(trunk_nodes):
        name = node['name']
        stype = 'compressor' if 'compressor' in node['type'] else ('distribution' if 'distribution' in node['type'] else 'valve')
        lng, lat = coords.get(name, (0.0, 0.0))
        stations.append((i+1, name, stype, lng, lat))
        
    # 写入数据库
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    # 清理旧数据（以防万一）
    cur.execute(f"DELETE FROM pipeline_systems WHERE id='{SYSTEM_ID}'")
    cur.execute(f"DELETE FROM pipelines WHERE id LIKE '{ID_PREFIX}%'")
    cur.execute(f"DELETE FROM stations WHERE id LIKE '{ID_PREFIX}%'")
    
    cur.execute("SELECT MAX(sort_order) FROM pipeline_systems")
    max_sort = cur.fetchone()[0] or 0
    
    # 注册管线系统
    layers_config = json.dumps([
        {"id_prefix": ID_PREFIX, "name": f"{SYSTEM_NAME}干线", "type": "trunk", "visible": True},
    ], ensure_ascii=False)
    
    cur.execute("""
        INSERT INTO pipeline_systems (id, name, color, sort_order, layers_config)
        VALUES (?, ?, ?, ?, ?)
    """, (SYSTEM_ID, SYSTEM_NAME, SYSTEM_COLOR, max_sort + 1, layers_config))
    
    # 写入站场
    for seq, name, stype, lng, lat in stations:
        sid = f"{ID_PREFIX}-{seq}"
        cur.execute("""
            INSERT INTO stations (id, name, type, longitude, latitude)
            VALUES (?, ?, ?, ?, ?)
        """, (sid, name, stype, lng, lat))
        
    print(f"写入了 {len(stations)} 个站场")
        
    # 写入管段
    for i in range(len(stations) - 1):
        seg_id = f"{ID_PREFIX}-T-{i+1}"
        start_id = f"{ID_PREFIX}-{stations[i][0]}"
        end_id = f"{ID_PREFIX}-{stations[i+1][0]}"
        seg_name = f"{SYSTEM_NAME}干线-段{i+1}"
        length_km = abs(trunk_nodes[i+1]['mileage'] - trunk_nodes[i]['mileage'])
        
        cur.execute("""
            INSERT INTO pipelines (id, name, start_station_id, end_station_id,
                                   diameter_mm, length_km, diameter, length, category)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (seg_id, seg_name, start_id, end_id, 1016, length_km, 1016, length_km, SYSTEM_NAME))
        
    print(f"写入了 {len(stations)-1} 个管段")
    
    # 执行坐标均分插值
    trunk_ids = [f"{ID_PREFIX}-{s[0]}" for s in stations]
    anchors = []
    for i, sid in enumerate(trunk_ids):
        cur.execute("SELECT longitude, latitude FROM stations WHERE id = ?", (sid,))
        r = cur.fetchone()
        if r and r[0] != 0 and r[1] != 0:
            anchors.append({'index': i, 'lng': r[0], 'lat': r[1]})

    fixed = 0
    for a in range(len(anchors) - 1):
        curr = anchors[a]
        nxt = anchors[a + 1]
        mid_count = nxt['index'] - curr['index'] - 1
        if mid_count <= 0:
            continue
        for k, j in enumerate(range(curr['index'] + 1, nxt['index']), start=1):
            ratio = k / (mid_count + 1)
            new_lng = round(curr['lng'] + (nxt['lng'] - curr['lng']) * ratio, 6)
            new_lat = round(curr['lat'] + (nxt['lat'] - curr['lat']) * ratio, 6)
            sid = trunk_ids[j]
            cur.execute("UPDATE stations SET longitude = ?, latitude = ? WHERE id = ? AND longitude = 0",
                        (new_lng, new_lat, sid))
            if cur.rowcount > 0:
                fixed += 1

    print(f"插值了 {fixed} 个阀室坐标")
    
    conn.commit()
    conn.close()
    print("重新绘制陕京四线完毕！")

if __name__ == '__main__':
    main()
