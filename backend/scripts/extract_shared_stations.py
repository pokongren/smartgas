import sqlite3
import json

conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()

# 查询西二、三、四线的所有站场
lines_to_query = ['西气东输二线', '西气东输三线', '西气东输四线']

all_stations = {}

for line_name in lines_to_query:
    cursor.execute("""
        SELECT DISTINCT node_name, mileage
        FROM node_relation_details
        WHERE trunk_name LIKE ?
        ORDER BY mileage
    """, (f'%{line_name}%',))
    
    nodes = cursor.fetchall()
    
    for name, mileage in nodes:
        # 只提取站场（压气站、分输站等），跳过阀室
        if '阀室' in name or '#' in name:
            continue
            
        if name not in all_stations:
            all_stations[name] = {
                'name': name,
                'lines': {},
                'type': 'unknown'
            }
        
        # 判断类型
        if '压气站' in name:
            all_stations[name]['type'] = 'compressor'
        elif '分输站' in name or '门站' in name or '末站' in name:
            all_stations[name]['type'] = 'distribution'
        
        # 记录在各条线上的里程
        line_key = line_name.replace('西气东输', '西')  # 简化名称
        all_stations[name]['lines'][line_key] = mileage

# 统计
shared_count = 0
line2_only = 0
line3_only = 0
line4_only = 0

for station in all_stations.values():
    num_lines = len(station['lines'])
    if num_lines > 1:
        shared_count += 1
    elif '西二线' in station['lines']:
        line2_only += 1
    elif '西三线' in station['lines']:
        line3_only += 1
    elif '西四线' in station['lines']:
        line4_only += 1

print(f"站场统计:")
print(f"  总站场数: {len(all_stations)}")
print(f"  共用站场: {shared_count}")
print(f"  仅西二线: {line2_only}")
print(f"  仅西三线: {line3_only}")
print(f"  仅西四线: {line4_only}")

print(f"\n共用站场列表:")
for name, station in all_stations.items():
    if len(station['lines']) > 1:
        lines_str = ', '.join([f"{k}({v}km)" for k, v in station['lines'].items()])
        print(f"  - {name}: {lines_str}")

# 保存结果
with open('scripts/unified_stations.json', 'w', encoding='utf-8') as f:
    json.dump(list(all_stations.values()), f, ensure_ascii=False, indent=2)

print(f"\n数据已保存到 scripts/unified_stations.json")

conn.close()
