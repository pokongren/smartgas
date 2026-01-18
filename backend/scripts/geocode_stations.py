"""
站点坐标生成脚本（使用预定义城市坐标）

坐标生成策略：
1. 站场（压气站、分输站等）：使用预定义的城市坐标字典
2. 阀室：根据相邻站场的坐标和里程进行线性插值计算
"""

import sqlite3

# 预定义西四线沿途城市坐标（从高德地图查询）
CITY_COORDS = {
    # 新疆段
    '吐鲁番': (89.1841, 42.9476),
    '连木沁': (89.75, 42.85),
    '了墩': (91.50, 42.10),
    '烟墩': (93.20, 41.10),
    '红柳': (94.20, 40.80),
    '瓜州': (95.7826, 40.5206),
    # 甘肃段
    '嘉峪关': (98.2773, 39.7865),
    '张掖': (100.4497, 38.9255),
    '永昌': (101.9716, 38.2478),
    '古浪': (102.8869, 37.4710),
    # 宁夏段
    '中卫': (105.1967, 37.5149),
}

def is_valve_room(name: str) -> bool:
    """判断是否为阀室"""
    return '阀室' in name or '阀门' in name or '#' in name

def is_station(name: str) -> bool:
    """判断是否为站场"""
    return '压气站' in name or '分输站' in name or '计量站' in name or '首站' in name or '末站' in name

def extract_city_from_name(station_name: str) -> str:
    """从站点名称中提取城市名"""
    suffixes = ['压气站', '分输站', '计量站', '首站', '末站', '站']
    
    for suffix in suffixes:
        if suffix in station_name:
            city = station_name.replace(suffix, '').strip()
            if city:
                return city
    return None

def update_coordinates():
    """更新站点坐标"""
    conn = sqlite3.connect('backend/data/smartgas.db')
    cursor = conn.cursor()
    
    # 获取西四线所有节点及里程
    cursor.execute("""
        SELECT DISTINCT node_name, mileage 
        FROM node_relation_details 
        WHERE trunk_name LIKE '%西气东输四线%' 
        ORDER BY mileage
    """)
    nodes = cursor.fetchall()
    
    if not nodes:
        print("❌ 未找到西四线节点数据")
        return
    
    print(f"📊 共找到 {len(nodes)} 个节点")
    
    # 第一步：为站场设置城市坐标
    station_coords = {}  # {node_name: (lng, lat, mileage)}
    
    print("\n🏭 === 第一步：设置站场坐标 ===")
    for name, mileage in nodes:
        if is_station(name):
            city = extract_city_from_name(name)
            if city and city in CITY_COORDS:
                lng, lat = CITY_COORDS[city]
                station_coords[name] = (lng, lat, mileage)
                cursor.execute(
                    "UPDATE stations SET longitude = ?, latitude = ? WHERE name = ?",
                    (lng, lat, name)
                )
                print(f"✅ 城市匹配: {name} -> {city} ({lng}, {lat})")
            else:
                print(f"⚠️ 未找到城市坐标: {name} (城市: {city})")
    
    print(f"\n📍 成功设置 {len(station_coords)} 个站场坐标")
    
    # 第二步：为阀室插值计算坐标
    print("\n🔧 === 第二步：计算阀室坐标 ===")
    
    # 按里程排序站场
    sorted_stations = sorted(station_coords.items(), key=lambda x: x[1][2])
    
    if not sorted_stations:
        print("❌ 没有可用的站场坐标作为参考")
        return
    
    valve_count = 0
    for name, mileage in nodes:
        if is_valve_room(name):
            # 找到最近的前后两个站场
            prev_station = None
            next_station = None
            
            for sname, (slng, slat, smileage) in sorted_stations:
                if smileage <= mileage:
                    prev_station = (sname, slng, slat, smileage)
                elif next_station is None:
                    next_station = (sname, slng, slat, smileage)
                    break
            
            if prev_station and next_station:
                # 线性插值
                total_dist = next_station[3] - prev_station[3]
                if total_dist > 0:
                    ratio = (mileage - prev_station[3]) / total_dist
                    lng = prev_station[1] + (next_station[1] - prev_station[1]) * ratio
                    lat = prev_station[2] + (next_station[2] - prev_station[2]) * ratio
                else:
                    lng, lat = prev_station[1], prev_station[2]
            elif prev_station:
                lng, lat = prev_station[1], prev_station[2]
            elif next_station:
                lng, lat = next_station[1], next_station[2]
            else:
                print(f"⚠️ 无法计算坐标: {name}")
                continue
            
            cursor.execute(
                "UPDATE stations SET longitude = ?, latitude = ? WHERE name = ?",
                (lng, lat, name)
            )
            valve_count += 1
            if valve_count <= 5 or valve_count % 10 == 0:
                print(f"📌 插值计算: {name} -> ({lng:.4f}, {lat:.4f})")
    
    print(f"\n📌 共计算 {valve_count} 个阀室坐标")
    
    conn.commit()
    conn.close()
    print("\n✅ 坐标更新完成!")

if __name__ == "__main__":
    update_coordinates()
