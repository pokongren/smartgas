import sqlite3
import json
import os

def analyze_zhongmian_structure():
    db_path = 'backend/data/smartgas_temp.db'
    if not os.path.exists(db_path):
        print(f"Database file not found: {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("=== Distinct Trunk Names containing '中缅' ===")
    try:
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
            
        print("\n=== Detailed Route Analysis ===")
        
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
                
                print(f"\nPipeline: {trunk_name}")
                print(f"  Range: {start_node[0]} -> {end_node[0]}")
                print(f"  Length: {end_node[1] - start_node[1]:.2f} km")
                print(f"  Nodes: {len(nodes)}")
                
                stations = [n[0] for n in nodes if '站' in n[0] and '阀' not in n[0]]
                if not stations: break
                
                if len(stations) > 10:
                     print(f"  Major Stations: {', '.join(stations[:5])} ... {', '.join(stations[-5:])}")
                else:
                     print(f"  Major Stations: {', '.join(stations)}")
                
                # Check for key junction points
                key_junctions = ['安宁', '贵港', '南宁']
                for kp in key_junctions:
                    for n in nodes:
                        if kp in n[0]:
                            print(f"  -> Contains Key Point: {n[0]} at {n[1]}km")

    except Exception as e:
        print(f"Error querying database: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    analyze_zhongmian_structure()
