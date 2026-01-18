import sqlite3

def diagnose_line4():
    """诊断西四线数据问题"""
    conn = sqlite3.connect('data/smartgas.db')
    cursor = conn.cursor()
    
    print("=" * 60)
    print("🔍 西气东输四线数据诊断")
    print("=" * 60)
    
    # 1. 检查管线数量
    cursor.execute("SELECT COUNT(*) FROM pipelines WHERE id LIKE 'LINE4-SEG%'")
    pipe_count = cursor.fetchone()[0]
    print(f"\n1️⃣ 管线数量: {pipe_count} 条")
    
    # 2. 检查前3条管线的详细信息
    cursor.execute("""
        SELECT p.id, p.name, p.start_station_id, p.end_station_id, p.length, p.category
        FROM pipelines p
        WHERE p.id LIKE 'LINE4-SEG%'
        LIMIT 3
    """)
    print(f"\n2️⃣ 前3条管线详情:")
    for row in cursor.fetchall():
        print(f"   ID: {row[0]}")
        print(f"   名称: {row[1]}")
        print(f"   起点ID: {row[2]}")
        print(f"   终点ID: {row[3]}")
        print(f"   长度: {row[4]} km")
        print(f"   类别: {row[5]}")
        print()
    
    # 3. 检查站点是否存在且有坐标
    cursor.execute("""
        SELECT DISTINCT p.start_station_id
        FROM pipelines p
        WHERE p.id LIKE 'LINE4-SEG%'
        LIMIT 3
    """)
    start_ids = [row[0] for row in cursor.fetchall()]
    
    print(f"3️⃣ 检查站点坐标:")
    for sid in start_ids:
        cursor.execute("SELECT id, name, longitude, latitude FROM stations WHERE id = ?", (sid,))
        station = cursor.fetchone()
        if station:
            print(f"   站点ID: {station[0]}")
            print(f"   名称: {station[1]}")
            print(f"   经度: {station[2]}")
            print(f"   纬度: {station[3]}")
            if station[2] == 0 or station[3] == 0:
                print(f"   ⚠️ 警告: 坐标为(0, 0)")
        else:
            print(f"   ❌ 错误: 站点 {sid} 不存在!")
        print()
    
    # 4. 统计所有西四线站点的坐标情况
    cursor.execute("""
        SELECT COUNT(DISTINCT s.id)
        FROM stations s
        JOIN pipelines p ON s.id = p.start_station_id OR s.id = p.end_station_id
        WHERE p.id LIKE 'LINE4-SEG%'
        AND (s.longitude = 0 OR s.latitude = 0)
    """)
    zero_coord_count = cursor.fetchone()[0]
    print(f"4️⃣ 坐标为(0,0)的站点数: {zero_coord_count}")
    
    # 5. 检查一个完整的管段和其起终点坐标
    cursor.execute("""
        SELECT 
            p.name,
            s1.name, s1.longitude, s1.latitude,
            s2.name, s2.longitude, s2.latitude
        FROM pipelines p
        JOIN stations s1 ON p.start_station_id = s1.id
        JOIN stations s2 ON p.end_station_id = s2.id
        WHERE p.id LIKE 'LINE4-SEG%'
        LIMIT 1
    """)
    result = cursor.fetchone()
    if result:
        print(f"\n5️⃣ 完整管段示例:")
        print(f"   管段名称: {result[0]}")
        print(f"   起点: {result[1]} ({result[2]}, {result[3]})")
        print(f"   终点: {result[4]} ({result[5]}, {result[6]})")
    
    conn.close()
    print("\n" + "=" * 60)

if __name__ == "__main__":
    diagnose_line4()
