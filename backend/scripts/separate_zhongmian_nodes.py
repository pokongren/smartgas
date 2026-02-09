import sqlite3
import sys

sys.stdout.reconfigure(encoding='utf-8')

def separate_nodes():
    db_path = 'backend/data/smartgas_temp.db'
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    with open('backend/scripts/zhongmian_nodes.txt', 'w', encoding='utf-8') as f:
        f.write("=== All Zhongmian Nodes (Sorted by Mileage) ===\n")
        
        cursor.execute("""
            SELECT node_name, mileage 
            FROM node_relation_details 
            WHERE trunk_name = '中缅线（国内段）' 
            ORDER BY mileage ASC
        """)
        all_nodes = cursor.fetchall()
        
        for name, mileage in all_nodes:
            f.write(f"{mileage:8.2f} : {name}\n")
            
    conn.close()

if __name__ == "__main__":
    separate_nodes()
