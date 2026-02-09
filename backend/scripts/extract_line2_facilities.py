import sqlite3
import json

conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()

# 查询西气东输二线的所有节点,包括分输站、储气库等
cursor.execute("""
    SELECT DISTINCT node_name, mileage
    FROM node_relation_details
    WHERE trunk_name LIKE '%西气东输二线%'
    ORDER BY mileage
""")

all_nodes = cursor.fetchall()

# 分类统计
compressor_stations = []
distribution_stations = []
storage_facilities = []
valves = []
others = []

for name, mileage in all_nodes:
    if '压气站' in name:
        compressor_stations.append({'name': name, 'mileage': mileage})
    elif '分输站' in name or '门站' in name or '末站' in name:
        distribution_stations.append({'name': name, 'mileage': mileage})
    elif '储气库' in name or '储气' in name:
        storage_facilities.append({'name': name, 'mileage': mileage})
    elif '阀室' in name or '#' in name:
        valves.append({'name': name, 'mileage': mileage})
    else:
        others.append({'name': name, 'mileage': mileage})

print(f"西气东输二线设施统计:")
print(f"  压气站: {len(compressor_stations)}")
print(f"  分输站/门站: {len(distribution_stations)}")
print(f"  储气库: {len(storage_facilities)}")
print(f"  阀室: {len(valves)}")
print(f"  其他: {len(others)}")
print(f"  总计: {len(all_nodes)}")

print(f"\n所有分输站/门站:")
for item in distribution_stations:
    print(f"  - {item['name']} (里程: {item['mileage']}km)")

print(f"\n所有储气库:")
for item in storage_facilities:
    print(f"  - {item['name']} (里程: {item['mileage']}km)")

# 保存到JSON
data = {
    'compressor_stations': compressor_stations,
    'distribution_stations': distribution_stations,
    'storage_facilities': storage_facilities,
    'valves': valves,
    'others': others
}

with open('scripts/line2_all_facilities.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"\n数据已保存到 scripts/line2_all_facilities.json")

conn.close()
