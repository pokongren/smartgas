
import sqlite3

def check_valves():
    try:
        conn = sqlite3.connect('data/smartgas.db')
        cursor = conn.cursor()
        
        # Check for West-East Pipeline II valves
        cursor.execute("SELECT node_name, mileage FROM node_relation_details WHERE trunk_name LIKE '%西气东输二线%' AND (node_name LIKE '%阀室%' OR node_name LIKE '%#%') LIMIT 5")
        results = cursor.fetchall()
        
        print("\n--- West-East Pipeline II Valves ---")
        if results:
            for row in results:
                print(f"Valve found: {row[0]} at {row[1]} km")
        else:
            print("No valves found for West-East Pipeline II using '%阀室%' or '%#%'")

        # Check for Zhongmian Line valves
        cursor.execute("SELECT node_name, mileage FROM node_relation_details WHERE trunk_name LIKE '%中缅%' AND (node_name LIKE '%阀室%' OR node_name LIKE '%#%') LIMIT 5")
        results = cursor.fetchall()

        print("\n--- Zhongmian Pipeline Valves ---")
        if results:
            for row in results:
                print(f"Valve found: {row[0]} at {row[1]} km")
        else:
            print("No valves found for Zhongmian Pipeline using '%阀室%' or '%#%'")
            
        conn.close()
        
    except Exception as e:
        print(f"Error checking valves: {e}")

if __name__ == "__main__":
    check_valves()
