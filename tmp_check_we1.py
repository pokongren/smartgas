import sqlite3, json

conn = sqlite3.connect('backend/data/smartgas.db')
cursor = conn.cursor()

output = []

# 1. stations 表字段
cursor.execute("PRAGMA table_info(stations)")
cols_st = [r[1] for r in cursor.fetchall()]
output.append("=== stations 字段 ===")
output.append(str(cols_st))

# 2. pipelines 表字段  
cursor.execute("PRAGMA table_info(pipelines)")
cols_pi = [r[1] for r in cursor.fetchall()]
output.append("=== pipelines 字段 ===")
output.append(str(cols_pi))

# 3. stations 样本
output.append("\n=== stations 样本(前2条) ===")
cursor.execute("SELECT * FROM stations LIMIT 2")
for row in cursor.fetchall():
    d = dict(zip(cols_st, row))
    output.append(json.dumps(d, ensure_ascii=False, indent=2))

# 4. pipelines 样本
output.append("\n=== pipelines 样本(前2条) ===")
cursor.execute("SELECT * FROM pipelines LIMIT 2")
for row in cursor.fetchall():
    d = dict(zip(cols_pi, row))
    output.append(json.dumps(d, ensure_ascii=False, indent=2))

# 5. 用 name 搜西一线
output.append("\n=== 名称含'西一'的站场 ===")
cursor.execute("SELECT * FROM stations WHERE name LIKE '%西一%' LIMIT 20")
rows = cursor.fetchall()
output.append(f"共 {len(rows)} 条")
for row in rows:
    d = dict(zip(cols_st, row))
    output.append(json.dumps(d, ensure_ascii=False))

# 6. properties 里找系统信息
output.append("\n=== properties 含'西一'的站场 ===")
cursor.execute("SELECT * FROM stations WHERE properties LIKE '%西一%' LIMIT 20")
rows2 = cursor.fetchall()
output.append(f"共 {len(rows2)} 条")
for row in rows2:
    d = dict(zip(cols_st, row))
    output.append(json.dumps(d, ensure_ascii=False))

# 7. properties 含'we1'或'WE1'
output.append("\n=== properties 含 we1/WE1 的站场 ===")
cursor.execute("SELECT * FROM stations WHERE properties LIKE '%we1%' OR properties LIKE '%WE1%' OR properties LIKE '%西气东输一%' LIMIT 20")
rows3 = cursor.fetchall()
output.append(f"共 {len(rows3)} 条")
for row in rows3:
    d = dict(zip(cols_st, row))
    output.append(json.dumps(d, ensure_ascii=False))

result = "\n".join(output)
with open("tmp_we1_result.txt", "w", encoding="utf-8") as f:
    f.write(result)

print("完成，结果写入 tmp_we1_result.txt")
conn.close()
