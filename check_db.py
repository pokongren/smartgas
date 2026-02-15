import sqlite3

conn = sqlite3.connect('backend/data/smartgas.db')
cursor = conn.cursor()

with open('db_info.txt', 'w', encoding='utf-8') as f:
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cursor.fetchall()]
    f.write("=== 数据库表 ===\n")
    for t in tables:
        count = cursor.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
        f.write(f"  {t}: {count} 条记录\n")

    for t in tables:
        f.write(f"\n=== 表 [{t}] 结构 ===\n")
        cursor.execute(f"PRAGMA table_info([{t}])")
        for col in cursor.fetchall():
            f.write(f"  {col[1]} ({col[2]})\n")

conn.close()
print("Done -> db_info.txt")
