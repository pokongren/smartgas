import sqlite3

conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()

# 查询西气东输二线的所有节点
cursor.execute("""
    SELECT DISTINCT node_name, mileage
    FROM node_relation_details
    WHERE trunk_name LIKE '%西气东输二线%'
    ORDER BY mileage
""")

nodes = cursor.fetchall()

print(f"西气东输二线节点总数: {len(nodes)}")
print("\n前10个节点:")
for i, (name, mileage) in enumerate(nodes[:10]):
    print(f"{i+1}. {name} (里程: {mileage}km)")

print(f"\n后10个节点:")
for i, (name, mileage) in enumerate(nodes[-10:], len(nodes)-9):
    print(f"{i}. {name} (里程: {mileage}km)")

# 统计节点类型
compressor_count = sum(1 for name, _ in nodes if '压气站' in name)
valve_count = sum(1 for name, _ in nodes if '阀室' in name or '#' in name)
other_count = len(nodes) - compressor_count - valve_count

print(f"\n节点类型统计:")
print(f"  压气站: {compressor_count}")
print(f"  阀室: {valve_count}")
print(f"  其他: {other_count}")

# 列出所有压气站
print(f"\n所有压气站:")
for name, mileage in nodes:
    if '压气站' in name:
        print(f"  - {name} (里程: {mileage}km)")

conn.close()
