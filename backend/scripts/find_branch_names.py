import sqlite3
import sys

# Set encoding to utf-8
sys.stdout.reconfigure(encoding='utf-8')

def find_branch_trunk_names():
    db_path = 'backend/data/smartgas_temp.db'
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    target_stations = ['玉溪末站', '防城港末站', '都匀分输站', '钦州分输站', '丽江分输站', '禄丰分输站', '安宁分输站']
    
    with open('backend/scripts/found_branch_names.txt', 'w', encoding='utf-8') as f:
        f.write("=== Identifying Trunks for Specific Stations ===\n")
        for station in target_stations:
            f.write(f"Searching for station: {station}\n")
            cursor.execute("SELECT trunk_name, mileage FROM node_relation_details WHERE node_name = ?", (station,))
            results = cursor.fetchall()
            if results:
                for trunk, mileage in results:
                    f.write(f"  Found in trunk: '{trunk}' at mileage {mileage}\n")
            else:
                f.write("  Not found in any trunk.\n")
            f.write("-" * 20 + "\n")
            
    conn.close()

if __name__ == "__main__":
    find_branch_trunk_names()
