import sqlite3
import pandas as pd
from pathlib import Path

DB_PATH = Path('f:/smartgas-grid/backend/data/smartgas.db')

def check_data_quality():
    print("=== 数据质量检查: 物理参数 ===")
    
    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}")
        return
        
    conn = sqlite3.connect(DB_PATH)
    
    # 获取所有的表名
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [row[0] for row in cursor.fetchall()]
    
    print("\n--- 检查所有包含压力、温度、能力的字段 ---")
    for table in tables:
        cursor.execute(f"PRAGMA table_info({table});")
        columns = [row[1] for row in cursor.fetchall()]
        
        matches = []
        for col in columns:
            col_lower = col.lower()
            if any(keyword in col_lower for keyword in ['pressure', 'temp', 'capacity', 'flow', 'design', 'power']):
                matches.append(col)
                
        if matches:
            print(f"\n表 '{table}' 中的相关字段:")
            for match in matches:
                # 获取该字段非空的数据条数和总条数
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                total = cursor.fetchone()[0]
                
                cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE {match} IS NOT NULL AND {match} != '' AND {match} != 0")
                valid = cursor.fetchone()[0]
                
                print(f"  - {match}: {valid}/{total} ({(valid/total*100) if total > 0 else 0:.1f}%) 有效数据")
                
                # 如果有数据，打印几个样本
                if valid > 0:
                    cursor.execute(f"SELECT {match} FROM {table} WHERE {match} IS NOT NULL AND {match} != '' AND {match} != 0 LIMIT 3")
                    samples = [str(x[0]) for x in cursor.fetchall()]
                    print(f"    样本: {', '.join(samples)}")

if __name__ == '__main__':
    check_data_quality()
