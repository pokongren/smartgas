"""
为西气东输四线创建站点记录
从 node_relation_details 读取节点信息,在 stations 表中创建对应记录
"""
import sqlite3

def create_line4_stations():
    conn = sqlite3.connect('data/smartgas.db')
    cursor = conn.cursor()
    
    # 获取西四线的所有节点
    cursor.execute("""
        SELECT DISTINCT node_name 
        FROM node_relation_details 
        WHERE trunk_name LIKE '%西气东输四线%'
    """)
    nodes = cursor.fetchall()
    
    print(f"找到 {len(nodes)} 个西四线节点")
    
    created = 0
    existing = 0
    
    for (node_name,) in nodes:
        # 检查站点是否已存在
        cursor.execute("SELECT id FROM stations WHERE name = ?", (node_name,))
        if cursor.fetchone():
            existing += 1
            continue
        
        # 生成站点ID
        station_id = f"NODE-{created+10000:05d}"
        
        # 判断站点类型
        if '压气站' in node_name:
            station_type = 'compressor'
        elif '阀室' in node_name or '#' in node_name:
            station_type = 'valve'
        elif '分输站' in node_name or '门站' in node_name:
            station_type = 'distribution'
        elif '首站' in node_name or '末站' in node_name:
            station_type = 'source'
        else:
            station_type = 'junction'
        
        # 插入站点记录(坐标暂时为0,后续由mock_line4_coords.py更新)
        cursor.execute("""
            INSERT INTO stations (id, name, type, longitude, latitude)
            VALUES (?, ?, ?, ?, ?)
        """, (station_id, node_name, station_type, '0.0', '0.0'))
        
        created += 1
        if created <= 5:
            print(f"  创建: {node_name} ({station_type})")
    
    conn.commit()
    conn.close()
    
    print(f"\n✓ 创建了 {created} 个新站点")
    print(f"✓ 跳过了 {existing} 个已存在的站点")
    print(f"✓ 总计 {created + existing} 个站点")

if __name__ == "__main__":
    create_line4_stations()
