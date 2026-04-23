"""
SCADA 实时数据模型

站场实时监测数据表，存储压力、温度等 SCADA 参数。
所有视图（表格、坡降线、拓扑图）共用这一张表作为唯一数据源。
"""
from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class ScadaStation(SQLModel, table=True):
    """SCADA 站场实时数据"""
    __tablename__ = "scada_stations"

    id: Optional[int] = Field(default=None, primary_key=True)
    pipeline_id: str = Field(index=True)          # 管线ID: we1, we2, we1_west, cred, pt
    name: str = Field()                            # 站名: 中卫压气站
    type: str = Field(default="valve")             # compressor / distribution / valve
    seq_order: int = Field(default=0)              # 站序号（从西到东）
    in_pressure: Optional[float] = Field(default=None)   # 进站压力 MPa
    out_pressure: Optional[float] = Field(default=None)  # 出站压力 MPa
    in_temp: Optional[float] = Field(default=None)       # 进站温度 ℃
    out_temp: Optional[float] = Field(default=None)      # 出站温度 ℃
    # 基准值（模拟器用：在此基准上加随机波动）
    base_in_pressure: Optional[float] = Field(default=None)
    base_out_pressure: Optional[float] = Field(default=None)
    base_in_temp: Optional[float] = Field(default=None)
    base_out_temp: Optional[float] = Field(default=None)
    updated_at: Optional[datetime] = Field(default_factory=datetime.now)


class ScadaHistory(SQLModel, table=True):
    """SCADA 历史时间序列数据（从 PI 导出的 Excel 导入）"""
    __tablename__ = "scada_history"

    id: Optional[int] = Field(default=None, primary_key=True)
    station_name: str = Field(index=True)       # 站名: 甪直分输站
    station_id: Optional[str] = Field(default=None, index=True)  # 站场ID（可选）
    pipeline_id: str = Field(index=True)        # 管线ID
    tag_name: str = Field()                     # PI tag名: ZE_PT1101.PV
    metric_type: str = Field()                  # pressure / temperature / dewpoint
    metric_code: Optional[str] = Field(default=None, index=True)  # 统一指标编码，如 h2s
    unit: Optional[str] = Field(default=None)   # 指标单位，如 MPa/℃/ppm
    quality_code: Optional[int] = Field(default=None)  # 质量码（0正常，其他异常）
    source_system: Optional[str] = Field(default=None)  # 数据来源系统，如 PI/SCADA/手工
    source_file: Optional[str] = Field(default=None)    # 源文件路径
    ingest_batch_id: Optional[str] = Field(default=None, index=True)  # 导入批次ID
    extra_json: Optional[str] = Field(default=None)  # 扩展字段（JSON字符串）
    recorded_at: datetime = Field(index=True)   # 采样时间
    value: float = Field()                      # 测量值


class ScadaMetricCatalog(SQLModel, table=True):
    """SCADA 指标字典：统一维护指标编码、分组和单位。"""
    __tablename__ = "scada_metric_catalog"

    metric_code: str = Field(primary_key=True)  # pressure / temperature / dewpoint / h2s
    metric_name: str = Field()                  # 压力 / 温度 / 水露点 / 硫化氢
    metric_group: str = Field(index=True)       # pressure / temperature / gas_quality / safety
    default_unit: Optional[str] = Field(default=None)
    description: Optional[str] = Field(default=None)
    thresholds_json: Optional[str] = Field(default=None)  # 阈值JSON，便于AI分析
    enabled: bool = Field(default=True, index=True)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


class ScadaIngestBatch(SQLModel, table=True):
    """SCADA 导入批次信息：追踪一次导入的来源、范围与结果。"""
    __tablename__ = "scada_ingest_batch"

    batch_id: str = Field(primary_key=True)
    station_name: Optional[str] = Field(default=None, index=True)
    pipeline_id: Optional[str] = Field(default=None, index=True)
    metric_type: Optional[str] = Field(default=None, index=True)
    source_system: Optional[str] = Field(default=None)
    source_file: Optional[str] = Field(default=None)
    row_count: int = Field(default=0)
    status: str = Field(default="success", index=True)  # success/failed/partial
    note: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.now, index=True)

