import sqlite3

conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()

# Check if table exists
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='node_relation_details'")
table_exists = cursor.fetchone()
print(f"Table exists: {table_exists is not None}")

if table_exists:
    cursor.execute("SELECT COUNT(*) FROM node_relation_details")
    total = cursor.fetchone()[0]
    print(f"Total rows: {total}")
    
    cursor.execute("SELECT COUNT(*) FROM node_relation_details WHERE trunk_name LIKE '%西气东输四线%'")
    line4 = cursor.fetchone()[0]
    print(f"西四线节点数: {line4}")
    
    if total > 0:
        cursor.execute("SELECT DISTINCT trunk_name FROM node_relation_details LIMIT 10")
        print("\n干线名称示例:")
        for row in cursor.fetchall():
            print(f"  - {row[0]}")

conn.close()
