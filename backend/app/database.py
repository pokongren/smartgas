from sqlmodel import SQLModel, create_engine, Session
from pathlib import Path

# SQLite 数据库文件路径
DB_PATH = Path(__file__).parent.parent / "data" / "smartgas.db"
DB_PATH.parent.mkdir(exist_ok=True)

# 数据库连接字符串
DATABASE_URL = f"sqlite:///{DB_PATH}"

# 创建引擎
engine = create_engine(DATABASE_URL, echo=True)

def create_db_and_tables():
    """创建数据库表"""
    SQLModel.metadata.create_all(engine)

def get_session():
    """获取数据库会话"""
    with Session(engine) as session:
        yield session
