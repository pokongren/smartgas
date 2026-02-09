import sqlite3

conn = sqlite3.connect('data/smartgas.db')
cursor = conn.cursor()

# 查询西四线的管径参数
cursor.execute("""
    SELECT DISTINCT p.diameter, p.category, COUNT(*) as count 
    FROM pipelines p 
    WHERE p.id LIKE 'LINE4%' 
    GROUP BY p.diameter, p.category
""")
rows = cursor.fetchall()
print('西四线管径参数:')
for row in rows:
    print(f'  管径: {row[0]}mm, 类别: {row[1]}, 数量: {row[2]}')

# 查询其他管道管径示例
cursor.execute("""
    SELECT DISTINCT diameter, category 
    FROM pipelines 
    WHERE diameter IS NOT NULL 
    LIMIT 20
""")
rows2 = cursor.fetchall()
print('\n其他管道管径示例:')
for row in rows2[:10]:
    print(f'  管径: {row[0]}mm, 类别: {row[1]}')

conn.close()
