import sqlite3
import sys

# Set encoding to utf-8 for console output
sys.stdout.reconfigure(encoding='utf-8')

def list_zhongmian_trunks():
    db_path = 'backend/data/smartgas_temp.db'
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    with open('backend/scripts/zhongmian_trunks.txt', 'w', encoding='utf-8') as f:
        f.write("=== Zhongmian Pipeline Trunks ===\n")
        try:
            cursor.execute("""
                SELECT trunk_name, COUNT(*) as count, MIN(mileage), MAX(mileage)
                FROM node_relation_details 
                WHERE trunk_name LIKE '%中缅%'
                GROUP BY trunk_name
                ORDER BY count DESC
            """)
            results = cursor.fetchall()
            
            for name, count, min_m, max_m in results:
                f.write(f"Name: {name}\n")
                f.write(f"  Nodes: {count}\n")
                f.write(f"  Mileage: {min_m} - {max_m}\n")
                
                # Get start and end node names
                cursor.execute("SELECT node_name FROM node_relation_details WHERE trunk_name=? AND mileage=?", (name, min_m))
                start_res = cursor.fetchone()
                start_node = start_res[0] if start_res else "Unknown"

                cursor.execute("SELECT node_name FROM node_relation_details WHERE trunk_name=? AND mileage=?", (name, max_m))
                end_res = cursor.fetchone()
                end_node = end_res[0] if end_res else "Unknown"

                f.write(f"  Route: {start_node} -> {end_node}\n")
                f.write("-" * 30 + "\n")

        except Exception as e:
            f.write(f"Error: {e}\n")
        finally:
            conn.close()

if __name__ == "__main__":
    list_zhongmian_trunks()
