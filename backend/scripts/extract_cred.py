"""
中俄东线管线拓扑提取脚本
根据数据库实际字段提取干线和支线结构
"""
import sqlite3
import json
import os

def extract_cred() -> None:
    """
    提取中俄东线完整拓扑结构
    """
    db_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'smartgas.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    pipeline_name = "中俄东线"

    # 干线段名（按地理顺序：北→南）
    TRUNK_SEGMENTS = [
        '中俄东线跨境段',
        '中俄东线北段干线',
        '中俄东线中段干线',
        '中俄东线南段干线（安平-泰兴）',
        '中俄东线南段干线（南通-甪直）',
    ]

    # 支线段名
    BRANCH_SEGMENTS = [
        '齐齐哈尔支线',
        '明水-哈尔滨支线',
        '兰西-绥化支线',
        '大庆-双合支线',
        '长岭-长春支线',
        '双台子储气库双向输气管道',
        '中俄东天津-武清联络线',
        '中俄东线与济青二线齐河联通线',
    ]

    # 提取所有节点
    cursor.execute("""
        SELECT id, trunk_name, branch_name, node_name, mileage, node_type_2025
        FROM node_relation_details
        WHERE trunk_name = ?
        ORDER BY branch_name, mileage
    """, (pipeline_name,))

    rows = cursor.fetchall()
    print(f"总节点数: {len(rows)}")

    # 分离干线和支线
    trunk_nodes = []
    branches_dict = {}

    for row_id, trunk, branch, name, mileage, node_type in rows:
        node = {
            "id": row_id,
            "name": name,
            "mileage": mileage if mileage else 0.0,
            "type": classify_type(name, node_type),
            "branch_name": branch or ""
        }

        if branch in TRUNK_SEGMENTS:
            trunk_nodes.append(node)
        else:
            if branch not in branches_dict:
                branches_dict[branch] = []
            branches_dict[branch].append(node)

    # 干线排序：按段序 + 里程
    def trunk_sort_key(node):
        try:
            order = TRUNK_SEGMENTS.index(node["branch_name"])
        except ValueError:
            order = 999
        return (order, node["mileage"])

    trunk_nodes.sort(key=trunk_sort_key)

    # 去重（同名节点在不同段可能重复，如"黑河压气站"在跨境段和北段都出现）
    seen = set()
    unique_trunk = []
    for n in trunk_nodes:
        if n["name"] not in seen:
            seen.add(n["name"])
            unique_trunk.append(n)
    
    trunk_nodes = unique_trunk

    # 构建输出
    branch_names = [bn for bn in BRANCH_SEGMENTS if bn in branches_dict]
    branches = [branches_dict[bn] for bn in branch_names]

    result = {
        "pipeline_name": pipeline_name,
        "trunk": trunk_nodes,
        "branches": branches,
        "branch_names": branch_names,
        "stats": {
            "trunk_count": len(trunk_nodes),
            "branch_count": len(branches),
            "total_nodes": len(rows)
        }
    }

    # 输出统计
    print(f"\n干线节点: {len(trunk_nodes)}")
    print(f"干线段序: {TRUNK_SEGMENTS}")
    
    print(f"\n干线关键节点（压气站和分输站）:")
    for n in trunk_nodes:
        if n["type"] in ("compressor", "distribution"):
            print(f"  {n['name']} ({n['type']}, 里程: {n['mileage']}km, 段: {n['branch_name']})")

    for bn in branch_names:
        print(f"\n支线 [{bn}]: {len(branches_dict[bn])} 个节点")

    # 保存
    out_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'cred_structure.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print(f"\n结构已保存到: {out_path}")
    conn.close()


def classify_type(name: str, db_type: str = None) -> str:
    """根据名称和数据库字段分类节点类型"""
    if '压气站' in name:
        return 'compressor'
    elif '分输站' in name or '门站' in name or '末站' in name or '首站' in name:
        return 'distribution'
    elif '阀室' in name or '阀门' in name or '#' in name:
        return 'valve'
    elif '交气点' in name or '接收站' in name:
        return 'distribution'
    else:
        return 'other'


if __name__ == "__main__":
    extract_cred()
