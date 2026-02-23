"""探查明细表数据结构，为迁移脚本做准备"""
import sqlite3

conn = sqlite3.connect('backend/data/smartgas.db')
c = conn.cursor()

# 1. branch_pipeline_details 样本
print("=== branch_pipeline_details ===")
c.execute('PRAGMA table_info(branch_pipeline_details)')
for col in c.fetchall():
    print(f"  {col[1]:20s} {col[2]}")
c.execute('SELECT name, trunk_link, start_point, end_point, length, diameter FROM branch_pipeline_details WHERE diameter > 0 LIMIT 5')
for r in c.fetchall():
    print(f"  name={r[0]}, trunk={r[1]}, start={r[2]}, end={r[3]}, len={r[4]}, dia={r[5]}")

# 2. node_relation_details 独特站点类型
print("\n=== node_relation_details node_type_2025 ===")
c.execute('SELECT DISTINCT node_type_2025 FROM node_relation_details WHERE node_type_2025 IS NOT NULL')
for r in c.fetchall():
    print(f"  {r[0]}")

# 3. trunk_pipeline_details 样本
print("\n=== trunk_pipeline_details ===")
c.execute('SELECT name, length, capacity, station_count, valve_count FROM trunk_pipeline_details LIMIT 5')
for r in c.fetchall():
    print(f"  name={r[0]}, len={r[1]}, cap={r[2]}, stations={r[3]}, valves={r[4]}")

# 4. 统计
print("\n=== stats ===")
c.execute('SELECT COUNT(*) FROM branch_pipeline_details')
print(f"  branch_pipeline_details: {c.fetchone()[0]}")
c.execute('SELECT COUNT(DISTINCT node_name) FROM node_relation_details')
print(f"  unique nodes: {c.fetchone()[0]}")
c.execute('SELECT COUNT(DISTINCT trunk_name) FROM node_relation_details')
print(f"  unique trunks: {c.fetchone()[0]}")

conn.close()
