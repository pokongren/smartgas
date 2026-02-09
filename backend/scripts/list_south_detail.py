"""
详细列出南部调度台相关的转供点
"""
import sqlite3
from collections import defaultdict

SOUTH_TRUNKS = [
    '西气东输二线', '西气东输三线', '中贵线', '中缅线', '广南支干线', 
    '广深支干线', '香港支线', '广西管道', '漳州LNG', '深圳LNG', '闽粤',
    '海西', '西二线', '西三线'
]

def is_south_pipeline(name):
    for trunk in SOUTH_TRUNKS:
        if trunk in name:
            return True
    return False

def list_all_south_junctions():
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
    
    # 只保留连接多条管道的节点，且至少有一条是南部管道
    south_related = {}
    for node, pipelines in node_pipelines.items():
        if len(pipelines) > 1:
            south_pipes = [p for p in pipelines if is_south_pipeline(p)]
            if south_pipes:
                south_related[node] = list(pipelines)
    
    # 按连接管线数量排序
    sorted_junctions = sorted(south_related.items(), key=lambda x: -len(x[1]))
    
    print(f"南部调度台相关转供点共 {len(sorted_junctions)} 个\n")
    
    for i, (node, pipelines) in enumerate(sorted_junctions, 1):
        south = [p for p in pipelines if is_south_pipeline(p)]
        other = [p for p in pipelines if not is_south_pipeline(p)]
        
        south_str = " / ".join(south)
        other_str = " / ".join(other) if other else "无"
        
        print(f"{i}. {node}")
        print(f"   南部管道: {south_str}")
        if other:
            print(f"   其他管道: {other_str}")
        print()
    
    conn.close()

if __name__ == "__main__":
    list_all_south_junctions()
