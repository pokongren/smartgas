import sqlite3
import numpy as np

# 线路起始点坐标 (近似值)
LINE_COORDS = {
    '西气东输一线': {
        'start': (84.2, 41.7),  # 轮南
        'end': (121.4, 31.2)    # 上海
    },
    '西气东输二线': {
        'start': (80.4, 44.2),  # 霍尔果斯
        'end': (113.2, 23.1)    # 广州
    },
    '西气东输三线': {
        'start': (80.4, 44.2),  # 霍尔果斯
        'end': (119.3, 26.1)    # 福州
    },
    '西气东输四线': {
        'start': (75.25, 39.71), # 乌恰
        'end': (105.18, 37.51)   # 中卫/灵武
    }
}

def update_coords():
    conn = sqlite3.connect('data/smartgas.db')
    cursor = conn.cursor()
    
    total_updated = 0
    
    for trunk_name, coords in LINE_COORDS.items():
        print(f"正在为 {trunk_name} 更新坐标...")
        
        # 获取该线路的所有节点,按里程排序
        cursor.execute("""
            SELECT DISTINCT node_name, mileage 
            FROM node_relation_details 
            WHERE trunk_name LIKE ? 
            ORDER BY mileage
        """, (f'%{trunk_name}%',))
        nodes = cursor.fetchall()
        
        if not nodes:
            print(f"  未找到 {trunk_name} 的节点")
            continue

        start_lng, start_lat = coords['start']
        end_lng, end_lat = coords['end']
        
        min_mile = nodes[0][1]
        max_mile = nodes[-1][1]
        total_mileage = max_mile - min_mile
        if total_mileage == 0: total_mileage = 1
        
        line_updated = 0
        for name, mileage in nodes:
            # 线性插值
            ratio = (mileage - min_mile) / total_mileage
            lng = start_lng + (end_lng - start_lng) * ratio
            lat = start_lat + (end_lat - start_lat) * ratio
            
            # 添加随机扰动,让线条更自然(非纯直线)
            lng += (np.random.rand() - 0.5) * 0.3
            lat += (np.random.rand() - 0.5) * 0.3
            
            # 更新站点坐标
            cursor.execute("""
                UPDATE stations 
                SET longitude = ?, latitude = ? 
                WHERE name = ?
            """, (str(lng), str(lat), name))
            line_updated += cursor.rowcount
            
        print(f"  ✓ {trunk_name} 已更新 {line_updated} 个站点坐标")
        total_updated += line_updated
        
    conn.commit()
    conn.close()
    print(f"\n总计更新 {total_updated} 个站点的坐标数据")

if __name__ == "__main__":
    update_coords()
