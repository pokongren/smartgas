import sqlite3
import numpy as np

def update_line4_coords():
    conn = sqlite3.connect('data/smartgas.db')
    cursor = conn.cursor()
    
    # Get nodes in order of mileage
    cursor.execute("""
        SELECT DISTINCT node_name, mileage 
        FROM node_relation_details 
        WHERE trunk_name LIKE '%西气东输四线%' 
        ORDER BY mileage
    """)
    nodes = cursor.fetchall()
    
    if not nodes:
        print("No nodes found for Line 4")
        return

    # Start: Wuqia (75.25, 39.71) - Approximate
    # End: Zhongwei (105.18, 37.51) - Approximate
    start_lng, start_lat = 75.25, 39.71
    end_lng, end_lat = 105.18, 37.51
    
    total_mileage = nodes[-1][1] - nodes[0][1]
    if total_mileage == 0: total_mileage = 1
    
    for name, mileage in nodes:
        # Interpolate
        ratio = (mileage - nodes[0][1]) / total_mileage
        lng = start_lng + (end_lng - start_lng) * ratio
        lat = start_lat + (end_lat - start_lat) * ratio
        
        # Jitter a bit to avoid perfectly straight line
        lng += (np.random.rand() - 0.5) * 0.2
        lat += (np.random.rand() - 0.5) * 0.2
        
        # Update stations table
        cursor.execute("UPDATE stations SET longitude = ?, latitude = ? WHERE name = ?", (lng, lat, name))
        print(f"Updated {name}: {lng:.4f}, {lat:.4f}")
        
    conn.commit()
    conn.close()
    print("Coordinates updated for Line 4")

if __name__ == "__main__":
    update_line4_coords()
