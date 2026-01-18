import sqlite3
from pathlib import Path

db_path = Path("data/smartgas.db")

def check_counts():
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [r[0] for r in cursor.fetchall() if not r[0].startswith('sqlite_')]
    
    print(f"📊 Database Stats for {db_path.name}:")
    for table in sorted(tables):
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        print(f"  - {table}: {count} rows")
    
    conn.close()

if __name__ == "__main__":
    check_counts()
