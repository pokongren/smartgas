"""
添加 design_pressure_mpa 字段到 pipelines 表
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import sqlite3
from app.database import DB_PATH


def migrate():
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    # 检查列是否存在
    cursor.execute("PRAGMA table_info(pipelines)")
    columns = [col[1] for col in cursor.fetchall()]
    
    if 'design_pressure_mpa' not in columns:
        print("Adding design_pressure_mpa column...")
        cursor.execute("ALTER TABLE pipelines ADD COLUMN design_pressure_mpa FLOAT DEFAULT 10.0")
        conn.commit()
        print("Column added successfully")
    else:
        print("Column design_pressure_mpa already exists")
    
    conn.close()


if __name__ == "__main__":
    migrate()
