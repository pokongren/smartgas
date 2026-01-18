import sqlite3
import json

def search_pipeline(keyword):
    conn = sqlite3.connect('data/smartgas.db')
    cursor = conn.cursor()
    
    print(f"--- Searching Trunk Pipelines for '{keyword}' ---")
    cursor.execute("SELECT * FROM trunk_pipeline_details WHERE name LIKE ?", (f'%{keyword}%',))
    trunk_cols = [d[0] for d in cursor.description]
    trunks = [dict(zip(trunk_cols, row)) for row in cursor.fetchall()]
    for t in trunks:
        print(t)
    
    print(f"\n--- Searching Node Relations for '{keyword}' ---")
    cursor.execute("SELECT * FROM node_relation_details WHERE trunk_name LIKE ? OR branch_name LIKE ?", (f'%{keyword}%', f'%{keyword}%'))
    node_cols = [d[0] for d in cursor.description]
    nodes = [dict(zip(node_cols, row)) for row in cursor.fetchall()]
    print(f"Found {len(nodes)} nodes")
    for n in nodes[:20]: # Show first 20
        print(n)
        
    conn.close()

if __name__ == "__main__":
    search_pipeline("西气东输四线")
