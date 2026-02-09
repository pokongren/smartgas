import sqlite3

conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()

cursor.execute("""
    SELECT 
        CASE 
            WHEN id LIKE 'LINE1%' THEN '西一线'
            WHEN id LIKE 'LINE2%' THEN '西二线'
            WHEN id LIKE 'LINE3%' THEN '西三线'
            WHEN id LIKE 'LINE4%' THEN '西四线'
        END as line,
        COUNT(*) as count
    FROM pipelines
    WHERE id LIKE 'LINE%'
    GROUP BY line
    ORDER BY line
""")

rows = cursor.fetchall()
print("管道段统计:")
for r in rows:
    print(f'{r[0]}: {r[1]}段')

conn.close()
