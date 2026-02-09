import sqlite3
import json

conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()

# 查询西气东输二线的所有节点
cursor.execute("""
    SELECT DISTINCT node_name, mileage
    FROM node_relation_details
    WHERE trunk_name LIKE '%西气东输二线%'
    ORDER BY mileage
""")

nodes = cursor.fetchall()

# 提取所有压气站
compressor_stations = [(name, mileage) for name, mileage in nodes if '压气站' in name]

print(f"西气东输二线压气站列表 (共{len(compressor_stations)}个):\n")
for i, (name, mileage) in enumerate(compressor_stations, 1):
    print(f"{i}. {name} - 里程: {mileage}km")

# 保存到JSON文件供后续使用
data = {
    'total_nodes': len(nodes),
    'compressor_stations': [{'name': name, 'mileage': mileage} for name, mileage in compressor_stations],
    'all_nodes': [{'name': name, 'mileage': mileage} for name, mileage in nodes]
}

with open('scripts/line2_nodes.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"\n数据已保存到 scripts/line2_nodes.json")

conn.close()
