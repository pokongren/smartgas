import sqlite3
import sys

sys.stdout.reconfigure(encoding='utf-8')

def dump_by_id():
    db_path = 'backend/data/smartgas_temp.db'
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    with open('backend/scripts/zhongmian_by_id.txt', 'w', encoding='utf-8') as f:
        f.write("=== Zhongmian Nodes (Sorted by ID) ===\n")
        
        cursor.execute("""
            SELECT id, mileage, node_name 
            FROM node_relation_details 
            WHERE trunk_name = '中缅线（国内段）' 
            ORDER BY id ASC
        """)
        nodes = cursor.fetchall()
        
        for id_val, mileage, name in nodes:
            f.write(f"{id_val:5d} : {mileage:8.2f} : {name}\n")
            
    conn.close()

if __name__ == "__main__":
    dump_by_id()
