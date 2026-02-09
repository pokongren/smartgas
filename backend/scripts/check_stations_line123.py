import sqlite3
conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()

# Get some stations from Line 1/2/3
cursor.execute("""
    SELECT DISTINCT s.id, s.name, s.type, s.longitude, s.latitude
    FROM stations s
    JOIN node_relation_details nrd ON s.name = nrd.node_name
    WHERE nrd.trunk_name LIKE '%西气东输一线%' 
       OR nrd.trunk_name LIKE '%西气东输二线%'
       OR nrd.trunk_name LIKE '%西气东输三线%'
    LIMIT 20
""")
print("Stations in Line 1/2/3:")
for r in cursor.fetchall():
    print(f"ID: {r[0]}, Name: {r[1]}, Type: {r[2]}, Lng: {r[3]}, Lat: {r[4]}")

conn.close()
