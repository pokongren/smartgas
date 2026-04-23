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

SCADA_HISTORY_TABLE_NAMES = {
    "scada_history",
    "scada_metric_catalog",
    "scada_ingest_batch",
}


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
    from app.scada_models import ScadaMetricCatalog, ScadaIngestBatch, ScadaHistory

    main_tables = [
        table
        for table in SQLModel.metadata.sorted_tables
        if table.name not in SCADA_HISTORY_TABLE_NAMES
    ]
    scada_tables = [
        table
        for table in SQLModel.metadata.sorted_tables
        if table.name in SCADA_HISTORY_TABLE_NAMES
    ]
    SQLModel.metadata.create_all(engine, tables=main_tables)
    SQLModel.metadata.create_all(scada_history_engine, tables=scada_tables)
    _ensure_scada_history_schema_optimized()
    _migrate_scada_history_if_needed()
    _seed_scada_metric_catalog()


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
    table_name = "scada_history"
    main_inspector = inspect(engine)
    history_inspector = inspect(scada_history_engine)
    if not main_inspector.has_table(table_name):
        return
    if not history_inspector.has_table(table_name):
        return

    with scada_history_engine.connect() as history_conn:
        existing_count = history_conn.exec_driver_sql(
            "SELECT COUNT(1) FROM scada_history"
        ).scalar() or 0
        if existing_count > 0:
            return

    with engine.connect() as main_conn:
        old_rows = main_conn.exec_driver_sql(
            """
            SELECT station_name, pipeline_id, tag_name, metric_type, recorded_at, value
            FROM scada_history
            """
        ).fetchall()
        if len(old_rows) == 0:
            return

    with scada_history_engine.begin() as history_conn:
        for row in old_rows:
            station_name, pipeline_id, tag_name, metric_type, recorded_at, value = row
            history_conn.exec_driver_sql(
                """
                INSERT INTO scada_history (
                    station_name,
                    pipeline_id,
                    tag_name,
                    metric_type,
                    metric_code,
                    recorded_at,
                    value
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    station_name,
                    pipeline_id,
                    tag_name,
                    metric_type,
                    metric_type,
                    recorded_at,
                    value,
                ),
            )


def _ensure_scada_history_schema_optimized():
    """
    为 scada_history 增量补齐可扩展字段与查询索引。
    设计目标：支持多站场、多指标（压力/温度/水露点/硫化氢等）高频检索。
    """
    inspector = inspect(scada_history_engine)
    if not inspector.has_table("scada_history"):
        return

    columns = {col["name"] for col in inspector.get_columns("scada_history")}
    column_ddl = {
        "station_id": "TEXT",
        "metric_code": "TEXT",
        "unit": "TEXT",
        "quality_code": "INTEGER",
        "source_system": "TEXT",
        "source_file": "TEXT",
        "ingest_batch_id": "TEXT",
        "extra_json": "TEXT",
    }

    with scada_history_engine.begin() as conn:
        for column_name, ddl in column_ddl.items():
            if column_name not in columns:
                conn.exec_driver_sql(f"ALTER TABLE scada_history ADD COLUMN {column_name} {ddl}")

        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS idx_scada_history_station_metric_time "
            "ON scada_history (station_name, metric_type, recorded_at)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS idx_scada_history_station_pipeline_metric_time "
            "ON scada_history (station_name, pipeline_id, metric_type, recorded_at)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS idx_scada_history_metric_code_time "
            "ON scada_history (metric_code, recorded_at)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS idx_scada_history_tag_time "
            "ON scada_history (tag_name, recorded_at)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS idx_scada_history_station_id_time "
            "ON scada_history (station_id, recorded_at)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS idx_scada_history_ingest_batch "
            "ON scada_history (ingest_batch_id)"
        )
        conn.exec_driver_sql(
            "UPDATE scada_history SET metric_code = metric_type "
            "WHERE metric_code IS NULL OR metric_code = ''"
        )
        conn.exec_driver_sql(
            """
            UPDATE scada_history
            SET unit = CASE
                WHEN metric_code = 'pressure' THEN 'MPa'
                WHEN metric_code = 'temperature' THEN '℃'
                WHEN metric_code = 'dewpoint' THEN '℃'
                WHEN metric_code = 'h2s' THEN 'ppm'
                ELSE unit
            END
            WHERE unit IS NULL OR unit = ''
            """
        )
        conn.exec_driver_sql(
            "UPDATE scada_history SET source_system = 'legacy' "
            "WHERE source_system IS NULL OR source_system = ''"
        )


def _seed_scada_metric_catalog():
    """
    写入默认指标字典，便于后续统一扩展到硫化氢等参数。
    """
    defaults = [
        ("pressure", "压力", "pressure", "MPa", "站场压力指标"),
        ("temperature", "温度", "temperature", "℃", "站场温度指标"),
        ("dewpoint", "水露点", "gas_quality", "℃", "气质露点指标"),
        ("h2s", "硫化氢", "gas_quality", "ppm", "硫化氢含量"),
        ("flow", "流量", "flow", "10^4Nm3/d", "输量指标"),
    ]

    with scada_history_engine.begin() as conn:
        for metric_code, metric_name, metric_group, default_unit, desc in defaults:
            conn.exec_driver_sql(
                """
                INSERT OR IGNORE INTO scada_metric_catalog
                (metric_code, metric_name, metric_group, default_unit, description, enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                (metric_code, metric_name, metric_group, default_unit, desc),
            )
