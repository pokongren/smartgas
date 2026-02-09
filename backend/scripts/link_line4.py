import sqlite3

def link_line4():
    conn = sqlite3.connect('data/smartgas.db')
    cursor = conn.cursor()
    
    # Get nodes in order
    cursor.execute("""
        SELECT node_name, mileage 
        FROM node_relation_details 
        WHERE trunk_name LIKE '%西气东输四线%' 
        ORDER BY mileage
    """)
    nodes = cursor.fetchall()
    
    # Get Station IDs
    cursor.execute("SELECT id, name FROM stations")
    name_to_id = {row[1]: row[0] for row in cursor.fetchall()}
    
    
    pipeline_count = 0
    skipped = 0
    print(f"Total nodes: {len(nodes)}")
    print(f"Total stations: {len(name_to_id)}")
    
    for i in range(len(nodes) - 1):
        start_node_name, start_mile = nodes[i]
        end_node_name, end_mile = nodes[i+1]
        
        start_id = name_to_id.get(start_node_name)
        end_id = name_to_id.get(end_node_name)
        
        if start_id and end_id:
            length = abs(end_mile - start_mile)
            pipeline_id = f"LINE4-SEG-{i+1:03d}"
            cursor.execute("""
                INSERT OR REPLACE INTO pipelines (id, name, start_station_id, end_station_id, length, category, diameter)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (pipeline_id, f"西四线-{i+1}", start_id, end_id, length, 'trunk', 1219))
            pipeline_count += 1
        else:
            skipped += 1
            if skipped <= 3:
                print(f"Skipped: {start_node_name} -> {end_node_name} (start_id={start_id}, end_id={end_id})")
            
    conn.commit()
    conn.close()
    print(f"Created {pipeline_count} segments for West-East Line 4")

if __name__ == "__main__":
    link_line4()
