"""
完整提取多条管线的节点数据 - 包括详细坐标信息
"""
import sqlite3
import json

conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()

# 目标管线
pipelines = [
    ('中缅线', '%中缅%'),
    ('广西管道', '%广西管道%'),
    ('广南支干线', '%广南%'),
    ('广深支干线', '%广深%'),
]

result = {}

for name, pattern in pipelines:
    print(f"\n{'='*60}")
    print(f"管线: {name}")
    print('='*60)
    
    # 查询所有节点
    cursor.execute("""
        SELECT DISTINCT node_name, mileage 
        FROM node_relation_details 
        WHERE trunk_name LIKE ? 
        ORDER BY mileage
    """, (pattern,))
    
    nodes = cursor.fetchall()
    
    # 分类节点
    compressors = []
    distributions = []
    valves = []
    
    for node_name, mileage in nodes:
        entry = {'name': node_name, 'mileage': round(mileage, 2) if mileage else 0}
        
        if '压气站' in node_name:
            compressors.append(entry)
        elif any(k in node_name for k in ['分输站', '首站', '末站', '门站', '调压站', '分输清管站']):
            distributions.append(entry)
        elif '阀室' in node_name or '#' in node_name:
            valves.append(entry)
    
    # 去重压气站
    seen_comp = set()
    unique_comp = []
    for c in compressors:
        if c['name'] not in seen_comp:
            seen_comp.add(c['name'])
            unique_comp.append(c)
    
    # 去重分输站
    seen_dist = set()
    unique_dist = []
    for d in distributions:
        if d['name'] not in seen_dist:
            seen_dist.add(d['name'])
            unique_dist.append(d)
    
    # 按里程排序
    unique_comp.sort(key=lambda x: x['mileage'])
    unique_dist.sort(key=lambda x: x['mileage'])
    
    result[name] = {
        'total_nodes': len(nodes),
        'compressors': unique_comp,
        'distributions': unique_dist,
        'valves_count': len(valves)
    }
    
    print(f"\n压气站 ({len(unique_comp)}):")
    for c in unique_comp:
        print(f"  {c['mileage']:>8.2f} km | {c['name']}")
    
    print(f"\n分输站/首末站 ({len(unique_dist)}):")
    for d in unique_dist:
        print(f"  {d['mileage']:>8.2f} km | {d['name']}")
    
    print(f"\n阀室数量: {len(valves)}")

# 保存结果
with open('scripts/pipeline_stations_detailed.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print(f"\n\n数据已保存到 scripts/pipeline_stations_detailed.json")
conn.close()
