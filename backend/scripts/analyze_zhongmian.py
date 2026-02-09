import sqlite3
import json

def analyze_zhongmian_structure():
    conn = sqlite3.connect('data/smartgas.db')
    cursor = conn.cursor()
    
    # 1. 查找所有包含"中缅"的干线名称
    print("=== Distinct Trunk Names containing '中缅' ===")
    cursor.execute("""
        SELECT DISTINCT trunk_name, COUNT(*) as count
        FROM node_relation_details 
        WHERE trunk_name LIKE '%中缅%'
        GROUP BY trunk_name
        ORDER BY count DESC
    """)
    trunks = cursor.fetchall()
    for name, count in trunks:
        print(f"- {name}: {count} records")
        
    # 2. 针对每个干线，获取起始和结束节点，以及节点数量，辅助判断
    print("\n=== Detailed Route Analysis ===")
    results = {}
    
    for trunk_name, _ in trunks:
        cursor.execute("""
            SELECT node_name, mileage 
            FROM node_relation_details 
            WHERE trunk_name = ? 
            ORDER BY mileage ASC
        """, (trunk_name,))
        nodes = cursor.fetchall()
        
        if nodes:
            start_node = nodes[0]
            end_node = nodes[-1]
            results[trunk_name] = {
                'count': len(nodes),
                'start': f"{start_node[0]} ({start_node[1]}km)",
                'end': f"{end_node[0]} ({end_node[1]}km)",
                'nodes_sample': [n[0] for n in nodes] # Keep all nodes for analysis if needed, or sample
            }
            print(f"\nPipeline: {trunk_name}")
            print(f"  Range: {start_node[0]} -> {end_node[0]}")
            print(f"  Length: {end_node[1] - start_node[1]:.2f} km")
            print(f"  Nodes: {len(nodes)}")
            
            # Print specific station types to help verify
            stations = [n[0] for n in nodes if '站' in n[0] and '阀' not in n[0]]
            print(f"  Major Stations ({len(stations)}): {', '.join(stations[:5])} ... {', '.join(stations[-5:])}")

    conn.close()

if __name__ == "__main__":
    analyze_zhongmian_structure()
