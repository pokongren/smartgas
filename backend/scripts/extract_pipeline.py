"""
通用管线拓扑提取脚本
从 smartgas.db 中提取指定管线的干线和支线结构
"""
import sqlite3
import json
import sys
import os

# 定义常见管线的段序（西→东，北→南）
# 解决 trunk 节点排序时不同段里程重置导致的“跳跃连接”问题
TRUNK_SEGMENT_ORDERS = {
    "西气东输二线": [
        "西二线新疆段",
        "西二线甘肃段",
        "西二线宁夏段",
        "西二线陕西段",
        "西二线河南段",
        "西二线湖北段",
        "西二线江西段",
        "西二线广东段",
        "西二线广西段",
        "西二线浙江段",
        "西二线上海段",
        "中卫-吉安段", # 特殊段名
        "吉安-广州段",
    ],
    "中缅线": [
        "中缅线云南段",
        "中缅线贵州段",
        "中缅缅段",
    ]
}

def extract_pipeline(pipeline_name: str, output_path: str) -> None:
    """
    根据 trunk_name 提取管线拓扑结构
    """
    db_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'smartgas.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 查询所有节点及其分支名
    cursor.execute("""
        SELECT DISTINCT node_name, mileage, node_type_2025, branch_name
        FROM node_relation_details
        WHERE trunk_name = ?
        ORDER BY branch_name, mileage
    """, (pipeline_name,))

    rows = cursor.fetchall()
    if not rows:
        print(f"未找到管线: {pipeline_name}")
        conn.close()
        return

    print(f"管线 [{pipeline_name}] 共找到 {len(rows)} 个节点")

    # 分离干线和支线
    trunk_nodes = []
    branches_dict: dict[str, list] = {}
    branch_names_set: set[str] = set()

    for name, mileage, node_type, branch_name in rows:
        node = {
            "id": hash(f"{pipeline_name}-{branch_name}-{name}") % 100000,
            "name": name,
            "mileage": mileage if mileage else 0.0,
            "type": classify_node_type(name),
            "branch_name": branch_name or ""
        }

        # 判断干线或支线
        if is_trunk(branch_name, pipeline_name):
            trunk_nodes.append(node)
        else:
            if branch_name not in branches_dict:
                branches_dict[branch_name] = []
                branch_names_set.add(branch_name)
            branches_dict[branch_name].append(node)

    # 干线排序：段序第一优先级，里程第二优先级
    segment_order = TRUNK_SEGMENT_ORDERS.get(pipeline_name, [])
    
    def get_sort_key(node):
        bn = node["branch_name"]
        # 获取段在序列中的索引，未定义的排在最后
        try:
            order = -1
            for i, pattern in enumerate(segment_order):
                if pattern in bn:
                    order = i
                    break
            if order == -1: order = 999
        except:
            order = 999
        return (order, node["mileage"])

    trunk_nodes.sort(key=get_sort_key)

    # 构建输出结构
    branch_names = sorted(branches_dict.keys())
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
    for bn in branch_names:
        print(f"支线 [{bn}]: {len(branches_dict[bn])} 个节点")

    # 打印干线所有段名
    trunk_segments = set(n["branch_name"] for n in trunk_nodes)
    print(f"\n干线包含段: {sorted(trunk_segments)}")

    # 打印干线前10和后10节点
    print(f"\n干线前10个节点:")
    for n in trunk_nodes[:10]:
        print(f"  {n['name']} (里程: {n['mileage']}km, 段: {n['branch_name']})")
    print(f"\n干线后10个节点:")
    for n in trunk_nodes[-10:]:
        print(f"  {n['name']} (里程: {n['mileage']}km, 段: {n['branch_name']})")

    # 统计节点类型
    compressor = sum(1 for n in trunk_nodes if n['type'] == 'compressor')
    distribution = sum(1 for n in trunk_nodes if n['type'] == 'distribution')
    valve = sum(1 for n in trunk_nodes if n['type'] == 'valve')
    print(f"\n干线节点类型: 压气站={compressor}, 分输站={distribution}, 阀室={valve}")

    # 保存
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print(f"\n结构已保存到: {output_path}")
    conn.close()


def classify_node_type(name: str) -> str:
    """根据名称分类节点类型"""
    if '压气站' in name:
        return 'compressor'
    elif '分输站' in name or '门站' in name or '末站' in name or '首站' in name:
        return 'distribution'
    elif '阀室' in name or '阀门' in name or '#' in name:
        return 'valve'
    else:
        return 'other'


def is_trunk(branch_name: str, pipeline_name: str) -> bool:
    """判断是否为干线"""
    if not branch_name:
        return True
    bn = branch_name.strip()
    # 包含"干线"字样 → 干线
    if '干线' in bn:
        return True
    # 和管线名一致 → 干线
    if bn == pipeline_name:
        return True
    return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python extract_pipeline.py <管线名称> [--out <输出路径>]")
        sys.exit(1)

    name = sys.argv[1]
    out = "backend/data/pipeline_structure.json"
    
    if "--out" in sys.argv:
        idx = sys.argv.index("--out")
        if idx + 1 < len(sys.argv):
            out = sys.argv[idx + 1]

    extract_pipeline(name, out)
