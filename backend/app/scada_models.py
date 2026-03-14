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
    pipeline_id: str = Field(index=True)        # 管线ID
    tag_name: str = Field()                     # PI tag名: ZE_PT1101.PV
    metric_type: str = Field()                  # pressure / temperature / dewpoint
    recorded_at: datetime = Field(index=True)   # 采样时间
    value: float = Field()                      # 测量值

