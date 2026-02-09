
import sqlite3
import sys

def drop_column(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 检查版本
    sqlite_version = sqlite3.sqlite_version
    print(f"SQLite Version: {sqlite_version}")
    
    try:
        # 尝试直接删除列 (SQLite 3.35.0+)
        print("尝试删除 location_desc 列...")
        cursor.execute("ALTER TABLE node_relation_details DROP COLUMN location_desc")
        print("列已成功删除。")
    except sqlite3.OperationalError as e:
        if "near \"DROP\": syntax error" in str(e):
            print("当前 SQLite 版本不支持 DROP COLUMN，尝试清空该列...")
            # 备选方案：清空内容
            cursor.execute("UPDATE node_relation_details SET location_desc = NULL")
            print("location_desc 列内容已清空 (物理删除列需要重建表，暂执行清空操作)。")
        else:
            print(f"操作失败: {e}")
            # 如果列不存在
            if "no such column" in str(e):
                print("列 location_desc 不存在，无需删除。")

    conn.commit()
    conn.close()

if __name__ == "__main__":
    drop_column('backend/data/smartgas.db')
