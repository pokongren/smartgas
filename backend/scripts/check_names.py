import sqlite3

conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()

# Get first 5 nodes from Line 4
cursor.execute("""
    SELECT node_name 
    FROM node_relation_details 
    WHERE trunk_name LIKE '%西气东输四线%' 
    ORDER BY mileage
    LIMIT 5
""")
print("西四线节点名称:")
for row in cursor.fetchall():
    print(f"  '{row[0]}'")

# Get matching stations
cursor.execute("SELECT name FROM stations WHERE name LIKE '%吐鲁番%' OR name LIKE '%压气%' LIMIT 10")
print("\n包含'吐鲁番'或'压气'的站点:")
for row in cursor.fetchall():
    print(f"  '{row[0]}'")

conn.close()
