"""
重建广南支干线拓扑结构

问题: 广东段和广西段里程体系独立, 合并排序导致渲染混乱
方案: 广东段正序 + 广西段(去横县后偏移里程)接续, 横县插入正确位置
"""
import sqlite3
import json

conn = sqlite3.connect('backend/data/smartgas.db')
cursor = conn.cursor()


def classify(name):
    if '压气站' in name:
        return 'compressor'
    elif any(k in name for k in ('分输站', '门站', '末站', '首站')):
        return 'distribution'
    elif any(k in name for k in ('阀室', '阀门', '#')):
        return 'valve'
    return 'other'


# 1. 广东段: 广州(0) → 德庆(202) 正序
cursor.execute(
    'SELECT DISTINCT node_name, mileage FROM node_relation_details '
    'WHERE trunk_name=? AND branch_name=? ORDER BY mileage',
    ('广南支干线', '广南广东段')
)
gd_rows = cursor.fetchall()

# 2. 广西段: 去掉横县, 正序 (梧州270 → 贵港485 → 南宁599)
cursor.execute(
    'SELECT DISTINCT node_name, mileage FROM node_relation_details '
    'WHERE trunk_name=? AND branch_name=? AND node_name != ? ORDER BY mileage',
    ('广南支干线', '广南广西段', '横县分输站')
)
gx_rows = cursor.fetchall()

# 3. 偏移广西段里程, 使其接续广东段
gd_max = gd_rows[-1][1] if gd_rows else 0
gap = 50  # 跨省空隙
offset = gd_max + gap

trunk_nodes = []

for name, mile in gd_rows:
    trunk_nodes.append({
        'id': abs(hash('GN-' + name)) % 100000,
        'name': name,
        'mileage': mile,
        'type': classify(name),
        'branch_name': '广南广东段'
    })

for name, mile in gx_rows:
    trunk_nodes.append({
        'id': abs(hash('GN-' + name)) % 100000,
        'name': name,
        'mileage': offset + mile,
        'type': classify(name),
        'branch_name': '广南广西段'
    })

# 4. 横县插到南宁之前 (地理上在南宁东南方)
hx_node = {
    'id': abs(hash('GN-横县分输站')) % 100000,
    'name': '横县分输站',
    'mileage': offset + 550,
    'type': 'distribution',
    'branch_name': '广南广西段'
}
for i, n in enumerate(trunk_nodes):
    if n['name'] == '南宁分输站':
        trunk_nodes.insert(i, hx_node)
        break

# 5. 提取支线
branches_dict = {}
cursor.execute(
    'SELECT DISTINCT branch_name FROM node_relation_details WHERE trunk_name=?',
    ('广南支干线',)
)
for (bn,) in cursor.fetchall():
    if bn in ('广南广东段', '广南广西段'):
        continue
    cursor.execute(
        'SELECT DISTINCT node_name, mileage FROM node_relation_details '
        'WHERE trunk_name=? AND branch_name=? ORDER BY mileage',
        ('广南支干线', bn)
    )
    nodes = []
    for name, mile in cursor.fetchall():
        nodes.append({
            'id': abs(hash('GN-' + bn + '-' + name)) % 100000,
            'name': name,
            'mileage': mile if mile else 0.0,
            'type': classify(name),
            'branch_name': bn
        })
    if nodes:
        branches_dict[bn] = nodes

branch_names = sorted(branches_dict.keys())
branches = [branches_dict[bn] for bn in branch_names]

result = {
    'pipeline_name': '广南支干线',
    'trunk': trunk_nodes,
    'branches': branches,
    'branch_names': branch_names
}

with open('src/data/gn_structure.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print(f'干线: {len(trunk_nodes)} nodes')
for n in trunk_nodes:
    tag = '*' if n['type'] in ('compressor', 'distribution') else ' '
    print(f'  {tag} {n["name"]}  ({n["mileage"]:.1f}km)')
print(f'支线: {len(branches)} branches')
for bn in branch_names:
    print(f'  - {bn}: {len(branches_dict[bn])} nodes')

conn.close()
