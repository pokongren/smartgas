import sqlite3

conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()

# Get nodes
cursor.execute("""
    SELECT node_name, mileage 
    FROM node_relation_details 
    WHERE trunk_name LIKE '%西气东输四线%' 
    ORDER BY mileage
""")
nodes = cursor.fetchall()
print(f"找到 {len(nodes)} 个节点")

# Get stations
cursor.execute("SELECT id, name FROM stations")
name_to_id = {row[1]: row[0] for row in cursor.fetchall()}
print(f"找到 {len(name_to_id)} 个站点")

# Check mapping
matched = 0
for node_name, _ in nodes[:5]:
    if node_name in name_to_id:
        matched += 1
        print(f"✓ {node_name} -> {name_to_id[node_name]}")
    else:
        print(f"✗ {node_name} 未找到对应站点")

print(f"\n前5个节点中有 {matched} 个匹配到站点")

conn.close()
