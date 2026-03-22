"""
批量提取管线拓扑结构脚本
从 smartgas.db 中提取指定管线的干线和支线结构，输出为 JSON
"""
import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'smartgas.db')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'data')

# 要提取的管线配置
PIPELINES = [
    {'trunk_name': '中缅线（国内段）', 'output': 'zm_structure.json'},
    {'trunk_name': '广南支干线',       'output': 'gn_structure.json'},
    {'trunk_name': '广深支干线',       'output': 'gs_structure.json'},
    {'trunk_name': '西气东输一线',       'output': 'xyx_structure.json'},
]


def classify_node_type(name: str) -> str:
    """根据名称分类节点类型"""
    if '压气站' in name:
        return 'compressor'
    elif any(k in name for k in ('分输站', '门站', '末站', '首站')):
        return 'distribution'
    elif any(k in name for k in ('阀室', '阀门', '#')):
        return 'valve'
    return 'other'


def is_trunk(branch_name: str, pipeline_name: str) -> bool:
    """判断是否为干线"""
    if not branch_name:
        return True
    bn = branch_name.strip()
    if '干线' in bn:
        return True
    if bn == pipeline_name:
        return True
    # 广南支干线特殊处理：广南广东段、广南广西段都是干线的不同分段
    if pipeline_name == '广南支干线' and bn.startswith('广南'):
        return True
    return False


def extract_one(cursor: sqlite3.Cursor, pipeline_name: str, output_file: str) -> None:
    """提取单条管线的拓扑"""
    cursor.execute("""
        SELECT DISTINCT node_name, mileage, branch_name
        FROM node_relation_details
        WHERE trunk_name = ?
        ORDER BY branch_name, mileage
    """, (pipeline_name,))
    rows = cursor.fetchall()

    if not rows:
        print(f"  ❌ 未找到管线: {pipeline_name}")
        return

    trunk_nodes = []
    branches_dict: dict[str, list] = {}

    for name, mileage, branch_name in rows:
        node = {
            "id": abs(hash(f"{pipeline_name}-{branch_name}-{name}")) % 100000,
            "name": name,
            "mileage": mileage if mileage else 0.0,
            "type": classify_node_type(name),
            "branch_name": branch_name or ""
        }

        if is_trunk(branch_name, pipeline_name):
            trunk_nodes.append(node)
        else:
            if branch_name not in branches_dict:
                branches_dict[branch_name] = []
            branches_dict[branch_name].append(node)

    # 干线按里程排序
    trunk_nodes.sort(key=lambda x: x["mileage"])

    branch_names = sorted(branches_dict.keys())
    branches = [branches_dict[bn] for bn in branch_names]

    result = {
        "pipeline_name": pipeline_name,
        "trunk": trunk_nodes,
        "branches": branches,
        "branch_names": branch_names,
    }

    out_path = os.path.join(OUTPUT_DIR, output_file)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    compressors = sum(1 for n in trunk_nodes if n['type'] == 'compressor')
    distributions = sum(1 for n in trunk_nodes if n['type'] == 'distribution')
    print(f"  ✅ {pipeline_name}: 干线 {len(trunk_nodes)} 节点 (压气站={compressors}, 分输站={distributions}), {len(branches)} 条支线 → {output_file}")


def main():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print("=" * 60)
    print("Pipeline Master System - 批量拓扑提取")
    print("=" * 60)

    for cfg in PIPELINES:
        extract_one(cursor, cfg['trunk_name'], cfg['output'])

    conn.close()
    print("\n全部完成！")


if __name__ == "__main__":
    main()
