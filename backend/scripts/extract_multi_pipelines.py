"""
提取多条管线的节点数据
"""
import sqlite3
import json

conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()

pipelines = [
    ('中缅线', '%中缅%'),
    ('广西管道', '%广西管道%'),
    ('广南支干线', '%广南%'),
    ('广深支干线', '%广深%'),
]

result = {}

for name, pattern in pipelines:
    cursor.execute("""
        SELECT DISTINCT node_name, mileage 
        FROM node_relation_details 
        WHERE trunk_name LIKE ? 
        ORDER BY mileage
    """, (pattern,))
    
    nodes = cursor.fetchall()
    
    compressors = []
    distributions = []
    valves = []
    
    for node_name, mileage in nodes:
        if '压气站' in node_name:
            compressors.append({'name': node_name, 'mileage': mileage})
        elif any(k in node_name for k in ['分输站', '首站', '末站', '门站', '调压站']):
            distributions.append({'name': node_name, 'mileage': mileage})
        elif '阀室' in node_name or '#' in node_name:
            valves.append({'name': node_name, 'mileage': mileage})
    
    result[name] = {
        'total_nodes': len(nodes),
        'compressors': compressors,
        'distributions': distributions,
        'valves_count': len(valves)
    }
    
    print(f"\n=== {name} ===")
    print(f"总节点: {len(nodes)}")
    print(f"压气站: {len(compressors)}")
    for c in compressors[:10]:
        print(f"  - {c['name']} @ {c['mileage']}km")
    print(f"分输站/首末站: {len(distributions)}")
    for d in distributions[:10]:
        print(f"  - {d['name']} @ {d['mileage']}km")
    print(f"阀室: {len(valves)}")

# 保存结果
with open('scripts/multi_pipeline_data.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print("\n数据已保存到 scripts/multi_pipeline_data.json")
conn.close()
