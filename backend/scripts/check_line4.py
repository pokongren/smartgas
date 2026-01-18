import sqlite3

def check_line4_data():
    """检查西气东输四线的数据"""
    conn = sqlite3.connect('data/smartgas.db')
    cursor = conn.cursor()
    
    # 检查节点数量
    cursor.execute("SELECT COUNT(*) FROM stations WHERE name LIKE '%西四%' OR name LIKE '%吐鲁番%' OR name LIKE '%中卫%'")
    station_count = cursor.fetchone()[0]
    print(f"📍 西四线站点数量: {station_count}")
    
    # 检查管段数量
    cursor.execute("SELECT COUNT(*) FROM pipelines WHERE id LIKE 'LINE4-SEG%'")
    pipeline_count = cursor.fetchone()[0]
    print(f"🔗 西四线管段数量: {pipeline_count}")
    
    # 显示前5个节点的坐标
    cursor.execute("""
        SELECT name, longitude, latitude 
        FROM stations 
        WHERE name IN (
            SELECT node_name FROM node_relation_details 
            WHERE trunk_name LIKE '%西气东输四线%' 
            LIMIT 5
        )
    """)
    print("\n📊 前5个节点坐标示例:")
    for row in cursor.fetchall():
        print(f"  - {row[0]}: ({row[1]:.4f}, {row[2]:.4f})")
    
    # 显示前3个管段
    cursor.execute("""
        SELECT p.id, p.name, s1.name as start, s2.name as end, p.length
        FROM pipelines p
        JOIN stations s1 ON p.start_station_id = s1.id
        JOIN stations s2 ON p.end_station_id = s2.id
        WHERE p.id LIKE 'LINE4-SEG%'
        LIMIT 3
    """)
    print("\n🚰 前3个管段示例:")
    for row in cursor.fetchall():
        print(f"  - {row[1]}: {row[2]} → {row[3]} ({row[4]:.2f} km)")
    
    conn.close()
    print("\n✅ 数据检查完成")

if __name__ == "__main__":
    check_line4_data()
