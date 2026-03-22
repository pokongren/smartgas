"""检查数据库表结构和坐标异常"""
import sqlite3

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 列出所有表
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in cur.fetchall()]
print("Tables:", tables)

# 查找 station 表
for t in tables:
    if 'station' in t.lower():
        cur.execute(f"PRAGMA table_info({t})")
        cols = [(r[1], r[2]) for r in cur.fetchall()]
        print(f"\n{t} columns: {cols}")
        
        lng_col = next((c[0] for c in cols if 'lon' in c[0].lower() or 'lng' in c[0].lower()), None)
        lat_col = next((c[0] for c in cols if 'lat' in c[0].lower()), None)
        
        if lng_col and lat_col:
            cur.execute(f"SELECT COUNT(*) FROM {t}")
            total = cur.fetchone()[0]
            cur.execute(f"SELECT COUNT(*) FROM {t} WHERE {lng_col}=0 OR {lat_col}=0 OR {lng_col} IS NULL OR {lat_col} IS NULL")
            zero = cur.fetchone()[0]
            print(f"Total: {total}, Zero/null coords: {zero}")
            
            cur.execute(f"SELECT type, COUNT(*) FROM {t} WHERE ({lng_col}=0 OR {lat_col}=0) GROUP BY type")
            print("Zero coords by type:", cur.fetchall())
            
            cur.execute(f"SELECT id, name, type, {lng_col}, {lat_col} FROM {t} WHERE {lng_col} != 0 LIMIT 5")
            print("\nSample WITH coords:")
            for r in cur.fetchall():
                print(f"  {r}")
            
            cur.execute(f"SELECT id, name, type, {lng_col}, {lat_col} FROM {t} WHERE {lng_col} = 0 LIMIT 5")
            print("\nSample WITHOUT coords:")
            for r in cur.fetchall():
                print(f"  {r}")

conn.close()
