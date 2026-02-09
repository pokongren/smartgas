"""
输出所有转供点及其连接的管道
"""
import sqlite3
from collections import defaultdict

def list_junction_points():
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
    
    # 按连接管线数量排序
    sorted_junctions = sorted(junctions.items(), key=lambda x: -len(x[1]))
    
    for node, pipelines in sorted_junctions:
        pipes_str = " / ".join(pipelines)
        print(f"{node}\t{pipes_str}")
    
    conn.close()

if __name__ == "__main__":
    list_junction_points()
