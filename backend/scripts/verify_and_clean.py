import sqlite3
import os
from pathlib import Path

db_path = Path("data/smartgas.db")

def check_and_fix():
    if not db_path.exists():
        print(f"❌ Database not found at {db_path.absolute()}")
        return

    print(f"📂 Database file: {db_path.absolute()}")
    print(f"📏 Size: {db_path.stat().st_size} bytes")

    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    try:
        # Check tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [r[0] for r in cursor.fetchall() if not r[0].startswith('sqlite_')]
        print(f"📋 Tables found: {tables}")

        for table in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            print(f"  - Table {table}: {count} rows")
            
            if count > 0:
                print(f"  🗑️  Deleting {count} rows from {table}...")
                cursor.execute(f"DELETE FROM {table}")
        
        conn.commit()
        print("✅ Tables cleared.")

        # Re-check
        for table in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            print(f"  - Table {table} now has: {cursor.fetchone()[0]} rows")

        print("💧 Vacuuming database to shrink file...")
        cursor.execute("VACUUM")
        conn.close()

        print(f"📏 New size: {db_path.stat().st_size} bytes")
        print("✨ Database is now truly empty and compressed.")

    except Exception as e:
        print(f"❌ Error: {e}")
        conn.close()

if __name__ == "__main__":
    check_and_fix()
