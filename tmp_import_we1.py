import sqlite3
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = 'backend/data/smartgas.db'
SYSTEM_ID = 'we1'
SYSTEM_NAME = '西气东输一线'
SYSTEM_COLOR = '#2196f3'
ID_PREFIX = 'WE1'

def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    # 1. 读坐标
    with open('tmp_coords.json', 'r', encoding='utf-8') as f:
        coords = json.load(f)
        
    # 2. 读结构
    with open('src/data/we1_structure.json', 'r', encoding='utf-8') as f:
        struct = json.load(f)

    # 清理旧数据
    cur.execute("DELETE FROM pipeline_systems WHERE id = ?", (SYSTEM_ID,))
    cur.execute("DELETE FROM pipelines WHERE id LIKE ?", (f"{ID_PREFIX}%",))
    cur.execute("DELETE FROM stations WHERE id LIKE ?", (f"{ID_PREFIX}%",))

    cur.execute("SELECT MAX(sort_order) FROM pipeline_systems")
    max_sort = (cur.fetchone()[0] or 0) + 1

    layers_config = []
    
    # 干线配置
    layers_config.append({"id_prefix": f"{ID_PREFIX}", "name": f"{SYSTEM_NAME}干线", "type": "trunk", "visible": True})
    
    # 支线配置
    bnames = struct.get('branch_names', [])
    for i, b_name in enumerate(bnames):
        layers_config.append({"id_prefix": f"{ID_PREFIX}-B{i}", "name": b_name, "type": "branch", "visible": True})

    cur.execute("""
        INSERT INTO pipeline_systems (id, name, color, sort_order, layers_config)
        VALUES (?, ?, ?, ?, ?)
    """, (SYSTEM_ID, SYSTEM_NAME, SYSTEM_COLOR, max_sort, json.dumps(layers_config, ensure_ascii=False)))
    
    station_count = 0
    pipeline_count = 0
    
    def process_line(nodes, prefix, category):
        nonlocal station_count, pipeline_count
        anchors = []
        node_ids = []
        for seq, n in enumerate(nodes, start=1):
            name = n['name']
            stype = n['type']
            sid = f"{prefix}-{seq}"
            node_ids.append(sid)
            
            lng = 0
            lat = 0
            if name in coords:
                lng = coords[name]['lng']
                lat = coords[name]['lat']
            else:
                lng = 0
                lat = 0
                
            cur.execute("""
                INSERT INTO stations (id, name, type, longitude, latitude)
                VALUES (?, ?, ?, ?, ?)
            """, (sid, name, stype, lng, lat))
            station_count += 1
            
            if lng != 0 and lat != 0:
                anchors.append({'index': seq - 1, 'lng': lng, 'lat': lat})
                
        # 补全坐标
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
                sid = node_ids[j]
                cur.execute("UPDATE stations SET longitude = ?, latitude = ? WHERE id = ? AND longitude = 0",
                            (new_lng, new_lat, sid))
                            
        # 连线
        for i in range(len(node_ids) - 1):
            seg_id = f"{prefix}-T-{i + 1}"
            start_id = node_ids[i]
            end_id = node_ids[i + 1]
            seg_name = f"{SYSTEM_NAME}-段{pipeline_count + 1}"
            
            n1 = nodes[i]
            n2 = nodes[i+1]
            mlg1 = n1.get('mileage', 0)
            mlg2 = n2.get('mileage', 0)
            length = mlg2 - mlg1
            
            cur.execute("""
                INSERT INTO pipelines (id, name, start_station_id, end_station_id,
                                       diameter_mm, length_km, diameter, length, category)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (seg_id, seg_name, start_id, end_id, 1016, length, 1016, length * 1000, category))
            pipeline_count += 1

    # process trunk
    process_line(struct.get('trunk', []), ID_PREFIX, 'trunk')
    
    # process branches
    for i, b_nodes in enumerate(struct.get('branches', [])):
        process_line(b_nodes, f"{ID_PREFIX}-B{i}", 'branch')
        
    conn.commit()
    print(f"✅ 管线系统写入完成! Stations: {station_count}, Pipelines: {pipeline_count}")
    conn.close()

if __name__ == "__main__":
    main()
