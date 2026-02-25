"""
添加 Station 表的新字段
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "smartgas.db"


def migrate():
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    # 获取现有列
    cursor.execute("PRAGMA table_info(stations)")
    existing_columns = {col[1] for col in cursor.fetchall()}
    
    new_columns = {
        'operating_pressure_in': 'FLOAT',
        'operating_pressure_out': 'FLOAT',
        'operating_temp_in': 'FLOAT',
        'operating_temp_out': 'FLOAT',
        'capacity': 'FLOAT'
    }
    
    for col_name, col_type in new_columns.items():
        if col_name not in existing_columns:
            print(f"添加列: {col_name}")
            cursor.execute(f"ALTER TABLE stations ADD COLUMN {col_name} {col_type}")
        else:
            print(f"列已存在: {col_name}")
    
    conn.commit()
    conn.close()
    print("迁移完成")


if __name__ == "__main__":
    migrate()
