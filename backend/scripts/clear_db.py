import sys
from pathlib import Path
from sqlmodel import Session, text

# 将项目根目录添加到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import engine

def clear_database():
    print("🗑️  正在清空所有数据库表...")
    try:
        with Session(engine) as session:
            # 禁用外键约束以确保删除成功（针对 SQLite）
            session.exec(text("PRAGMA foreign_keys = OFF"))
            
            # 删除所有表中的数据
            tables = ["emergency_events", "pipelines", "stations"]
            for table in tables:
                print(f"  - 清空表: {table}")
                session.exec(text(f"DELETE FROM {table}"))
            
            session.commit()
            print("✅ 数据库已成功清空!")
    except Exception as e:
        print(f"❌ 清空失败: {e}")

if __name__ == "__main__":
    clear_database()
