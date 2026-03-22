import os
from sqlmodel import SQLModel, create_engine, Session
from pathlib import Path

# SQLite 数据库文件路径
DB_PATH = Path(__file__).parent.parent / "data" / "smartgas.db"
DB_PATH.parent.mkdir(exist_ok=True)

# 读取环境变量中真实的数据库包（默认回退到 SQLite）
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}")

# 是否在日志中回显 SQL 语句
# 推荐仅在开发环境打开，可通过环境变量覆盖
SQL_ECHO = os.getenv("SQL_ECHO", "False").lower() in ("true", "1", "t")

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

# 创建引擎
engine = create_engine(
    DATABASE_URL, 
    echo=SQL_ECHO,
    connect_args=connect_args
)

def create_db_and_tables():
    """
    创建数据库表
    
    在应用启动 (lifespan) 阶段被调用。
    """
    SQLModel.metadata.create_all(engine)

def get_session():
    """
    获取数据库会话 (Generator)
    
    作为 FastAPI 的 Depends 依赖使用，保证每个请求有独立的安全连接。
    在结束时自动回收。
    """
    with Session(engine) as session:
        yield session
