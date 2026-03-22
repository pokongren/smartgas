import sqlite3, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 查找跨管线系统的同名站场
cur.execute("""
    SELECT s1.name, s1.id, s2.id,
           SUBSTR(s1.id, 1, INSTR(s1.id, '-') - 1) AS sys1,
           SUBSTR(s2.id, 1, INSTR(s2.id, '-') - 1) AS sys2
    FROM stations s1 
    JOIN stations s2 ON s1.name = s2.name AND s1.id < s2.id
    WHERE s1.longitude != 0
    ORDER BY s1.name
""")
rows = cur.fetchall()

print(f"| 站场名 | 保留ID (来源) | 去重ID (来源) |")
print(f"|--------|-------------|-------------|")
for name, id1, id2, sys1, sys2 in rows:
    print(f"| {name} | {id1} ({sys1}) | {id2} ({sys2}) |")

print(f"\n共 {len(rows)} 对重名站场")
conn.close()
