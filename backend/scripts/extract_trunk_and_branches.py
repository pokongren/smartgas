import sqlite3
import sys
import json
import argparse
import os

# Set stdout to UTF-8
sys.stdout.reconfigure(encoding='utf-8')

def extract_pipelines(db_path, trunk_name_pattern, output_file):
    """
    从数据库提取管线节点，使用 branch_name 字段区分干线和支线。
    
    判断逻辑：
    - branch_name 包含 "干线" -> 干线
    - 其他 -> 支线
    """
    if not os.path.exists(db_path):
        print(f"错误: 数据库文件不存在: {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    print(f"正在查询管线: '{trunk_name_pattern}'...")
    
    # 获取所有节点及 branch_name
    cursor.execute("""
        SELECT id, node_name, mileage, branch_name 
        FROM node_relation_details 
        WHERE trunk_name LIKE ? 
        ORDER BY id ASC
    """, (f'%{trunk_name_pattern}%',))
    
    nodes = cursor.fetchall()
    
    if not nodes:
        print("未找到匹配的节点。")
        conn.close()
        return

    print(f"共找到 {len(nodes)} 个节点。正在按 branch_name 分类...")

    # 按 branch_name 分组
    trunk_nodes = []
    branch_dict = {}  # key: branch_name, value: list of nodes
    
    for node_id, name, mileage, branch_name in nodes:
        # 推断节点类型
        ntype = 'valve'
        if '压气站' in name: 
            ntype = 'compressor'
        elif any(x in name for x in ['分输站', '末站', '首站', '门站']): 
            ntype = 'distribution'

        node_data = {
            'id': node_id,
            'name': name,
            'mileage': mileage,
            'type': ntype,
            'branch_name': branch_name or ''
        }
        
        # 核心判断逻辑: branch_name 包含 "干线" 视为干线
        if branch_name and '干线' in branch_name:
            trunk_nodes.append(node_data)
        else:
            # 支线：按 branch_name 分组
            key = branch_name if branch_name else '未命名支线'
            if key not in branch_dict:
                branch_dict[key] = []
            branch_dict[key].append(node_data)
    
    # 对干线按里程排序
    trunk_nodes.sort(key=lambda x: x['mileage'])
    
    # 对每条支线按里程排序
    branches = []
    for branch_name, nodes_list in branch_dict.items():
        nodes_list.sort(key=lambda x: x['mileage'])
        branches.append({
            'name': branch_name,
            'nodes': nodes_list
        })

    # 输出统计
    print(f"\n=== 分析结果 ===")
    print(f"干线节点数: {len(trunk_nodes)}")
    if trunk_nodes:
        print(f"  起点: {trunk_nodes[0]['name']} (里程 {trunk_nodes[0]['mileage']})")
        print(f"  终点: {trunk_nodes[-1]['name']} (里程 {trunk_nodes[-1]['mileage']})")
    
    print(f"\n支线数量: {len(branches)}")
    for b in branches:
        print(f"  - {b['name']}: {len(b['nodes'])} 个节点")

    # 生成输出
    output_data = {
        'pipeline_name': trunk_name_pattern,
        'trunk': trunk_nodes,
        'branches': [b['nodes'] for b in branches],
        'branch_names': [b['name'] for b in branches]
    }
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
        
    print(f"\n分析完成。数据已保存到: {output_file}")
    conn.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='管道拓扑提取器 - 自动分离干线与支线')
    parser.add_argument('trunk_name', help='管线名称 (如 "中缅线", "西气东输二线")')
    parser.add_argument('--db', default='backend/data/smartgas.db', help='数据库路径')
    parser.add_argument('--out', default='pipeline_structure.json', help='输出 JSON 文件')
    
    args = parser.parse_args()
    
    extract_pipelines(args.db, args.trunk_name, args.out)
