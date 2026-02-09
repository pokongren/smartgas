"""
分析数据库中的转供点（多条管线交汇的节点）
"""
import sqlite3
from collections import defaultdict

def analyze_junction_points():
    conn = sqlite3.connect('backend/data/smartgas.db')
    cursor = conn.cursor()
    
    # 查询所有节点及其所属管线
    cursor.execute("""
        SELECT node_name, trunk_name 
        FROM node_relation_details 
        WHERE node_name IS NOT NULL AND trunk_name IS NOT NULL
    """)
    rows = cursor.fetchall()
    
    # 统计每个节点出现在哪些管线中
    node_pipelines = defaultdict(set)
    for node_name, trunk_name in rows:
        node_pipelines[node_name].add(trunk_name)
    
    # 找出出现在多条管线中的节点（转供点）
    junction_points = {
        node: list(pipelines) 
        for node, pipelines in node_pipelines.items() 
        if len(pipelines) > 1
    }
    
    print(f"📊 数据库中共有 {len(node_pipelines)} 个节点")
    print(f"🔀 其中 {len(junction_points)} 个是转供点（出现在多条管线中）\n")
    
    print("=" * 80)
    print("转供点列表（按连接管线数量排序）")
    print("=" * 80)
    
    # 按连接管线数量排序
    sorted_junctions = sorted(junction_points.items(), key=lambda x: -len(x[1]))
    
    for i, (node, pipelines) in enumerate(sorted_junctions, 1):
        print(f"\n{i}. 【{node}】 - 连接 {len(pipelines)} 条管线")
        for p in pipelines:
            print(f"   └─ {p}")
    
    conn.close()
    
    return junction_points

if __name__ == "__main__":
    analyze_junction_points()
