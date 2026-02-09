"""
列出南部调度台所辖管道的转供点
"""
import sqlite3
from collections import defaultdict

# 南部调度台所辖管道列表
SOUTH_PIPELINES = [
    # 西气东输二线
    '西气东输二线',
    # 西气东输三线
    '西气东输三线',
    # LNG管道
    '漳州LNG外输管道', '深圳LNG外输管道',
    # 中贵线
    '中贵线',
    # 中缅线
    '中缅线（国内段）', '中缅线',
    # 广南支干线
    '广南支干线',
    # 广深支干线
    '广深支干线',
    # 香港支线
    '香港支线',
    # 广西管道
    '广西管道',
    # 海西
    '海西二期',
    # 闽粤
    '闽粤支干线',
]

def list_south_junctions():
    conn = sqlite3.connect('backend/data/smartgas.db')
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT node_name, trunk_name 
        FROM node_relation_details 
        WHERE node_name IS NOT NULL AND trunk_name IS NOT NULL
    """)
    rows = cursor.fetchall()
    
    node_pipelines = defaultdict(set)
    for node_name, trunk_name in rows:
        node_pipelines[node_name].add(trunk_name)
    
    # 只保留连接多条管道的节点
    junctions = {n: list(p) for n, p in node_pipelines.items() if len(p) > 1}
    
    # 筛选：至少有一条管道属于南部调度台
    south_junctions = {}
    for node, pipelines in junctions.items():
        south_related = [p for p in pipelines if any(sp in p for sp in SOUTH_PIPELINES)]
        if south_related:
            south_junctions[node] = pipelines
    
    # 按连接管线数量排序
    sorted_junctions = sorted(south_junctions.items(), key=lambda x: -len(x[1]))
    
    print(f"南部调度台所辖管道转供点共 {len(south_junctions)} 个\n")
    print("=" * 60)
    
    for node, pipelines in sorted_junctions:
        pipes_str = " / ".join(pipelines)
        print(f"{node}\t{pipes_str}")
    
    conn.close()

if __name__ == "__main__":
    list_south_junctions()
