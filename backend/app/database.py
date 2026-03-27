import os
from pathlib import Path

from sqlalchemy import inspect
from sqlmodel import SQLModel, Session, create_engine, select


DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = DATA_DIR / "smartgas.db"
SCADA_HISTORY_DB_PATH = DATA_DIR / "scada_history.db"

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}")
SCADA_HISTORY_DATABASE_URL = os.getenv("SCADA_HISTORY_DATABASE_URL", f"sqlite:///{SCADA_HISTORY_DB_PATH}")
SQL_ECHO = os.getenv("SQL_ECHO", "False").lower() in ("true", "1", "t")


def _build_engine(database_url: str):
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(
        database_url,
        echo=SQL_ECHO,
        connect_args=connect_args,
    )


engine = _build_engine(DATABASE_URL)
scada_history_engine = _build_engine(SCADA_HISTORY_DATABASE_URL)


def create_db_and_tables():
    """
    创建主业务库和 SCADA 历史库所需表结构。

    设计原则：
    - 主库：业务主数据、实时快照、拓扑等
    - 时序库：ScadaHistory 高频历史数据
    """
    from app.scada_models import ScadaHistory

    main_tables = [
        table
        for table in SQLModel.metadata.sorted_tables
        if table.name != ScadaHistory.__tablename__
    ]
    SQLModel.metadata.create_all(engine, tables=main_tables)
    ScadaHistory.__table__.create(scada_history_engine, checkfirst=True)
    _migrate_scada_history_if_needed()


def get_session():
    """获取主业务库会话。"""
    with Session(engine) as session:
        yield session


def get_scada_history_session():
    """获取 SCADA 历史时序库会话。"""
    with Session(scada_history_engine) as session:
        yield session


def _migrate_scada_history_if_needed():
    """
    首次启用双库时，将主库里的 scada_history 自动迁移到独立时序库。

    仅在以下条件同时满足时执行：
    - 主库仍存在 scada_history 表
    - 历史库当前为空
    """
    from app.scada_models import ScadaHistory

    main_inspector = inspect(engine)
    if not main_inspector.has_table(ScadaHistory.__tablename__):
        return

    with Session(scada_history_engine) as history_session:
        existing = history_session.exec(select(ScadaHistory)).first()
        if existing:
            return

    with Session(engine) as main_session:
        old_rows = main_session.exec(select(ScadaHistory)).all()
        if not old_rows:
            return

    with Session(scada_history_engine) as history_session:
        for row in old_rows:
            history_session.add(
                ScadaHistory(
                    station_name=row.station_name,
                    pipeline_id=row.pipeline_id,
                    tag_name=row.tag_name,
                    metric_type=row.metric_type,
                    recorded_at=row.recorded_at,
                    value=row.value,
                )
            )
        history_session.commit()
