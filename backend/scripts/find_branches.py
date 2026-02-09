import sqlite3
import sys

sys.stdout.reconfigure(encoding='utf-8')

def find_zhongmian_branches():
    db_path = 'backend/data/smartgas_temp.db'
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 1. Get Zhongmian Trunk Stations for reference
    cursor.execute("""
        SELECT node_name, mileage 
        FROM node_relation_details 
        WHERE trunk_name = '中缅线（国内段）'
    """)
    zm_nodes = {row[0] for row in cursor.fetchall()}
    print(f"Loaded {len(zm_nodes)} Zhongmian Trunk Nodes")
    
    # 2. Find ALL pipelines with '支线' in name
    print("\n=== All Branch Lines ===")
    cursor.execute("""
        SELECT DISTINCT trunk_name 
        FROM node_relation_details 
        WHERE trunk_name LIKE '%支线%' OR trunk_name LIKE '%联络线%'
    """)
    candidates = cursor.fetchall()
    
    potential_branches = []
    
    with open('backend/scripts/potential_branches.txt', 'w', encoding='utf-8') as f:
        f.write("=== Potential Zhongmian Branches ===\n")
        
        for (name,) in candidates:
            # Get start and end node
            cursor.execute("SELECT node_name, mileage FROM node_relation_details WHERE trunk_name=? ORDER BY mileage ASC", (name,))
            nodes = cursor.fetchall()
            if not nodes: continue
            
            start_node = nodes[0][0]
            end_node = nodes[-1][0]
            
            # Check if start or end node is in Zhongmian Trunk
            is_connected = False
            connection = ""
            if start_node in zm_nodes:
                is_connected = True
                connection = f"Starts at {start_node}"
            elif end_node in zm_nodes:
                is_connected = True
                connection = f"Ends at {end_node}"
            
            # Also check if name contains key cities
            if '玉溪' in name or '广西' in name or '都匀' in name:
                is_connected = True
                connection += " (Name matched keyword)"

            if is_connected:
                f.write(f"Pipeline: {name}\n")
                f.write(f"  Connection: {connection}\n")
                f.write(f"  Route: {start_node} -> {end_node}\n")
                f.write(f"  Length: {nodes[-1][1] - nodes[0][1]:.2f} km\n")
                f.write("-" * 30 + "\n")
                potential_branches.append(name)
    
        print(f"Found {len(potential_branches)} potential branches. Check backend/scripts/potential_branches.txt")

    conn.close()

if __name__ == "__main__":
    find_zhongmian_branches()
