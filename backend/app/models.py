from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime

# =================================================================
# 核心业务模型 (保留兼容性)
# =================================================================

class Station(SQLModel, table=True):
    """通用站场表 (通过各 Sheet 汇总)"""
    __tablename__ = "stations"
    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    type: str  # 'source', 'compressor', 'distribution', 'valve', etc.
    longitude: float = 0.0
    latitude: float = 0.0
    design_pressure: Optional[float] = None
    properties: Optional[str] = None  # JSON string for extra data

class Pipeline(SQLModel, table=True):
    """通用管线表 (通过各 Sheet 汇总)"""
    __tablename__ = "pipelines"
    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    start_station_id: str
    end_station_id: str
    diameter: Optional[int] = None
    length: float = 0.0
    category: str  # 'trunk', 'branch'
    properties: Optional[str] = None

class EmergencyEvent(SQLModel, table=True):
    """应急事件表"""
    __tablename__ = "emergency_events"
    id: Optional[int] = Field(default=None, primary_key=True)
    event_type: str
    location: str
    severity: str
    status: str = "active"
    description: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())

# =================================================================
# 原始 Excel 对应明细表 (根据 20251031 模板)
# =================================================================

class TrunkPipelineDetail(SQLModel, table=True):
    """干线管道明细 (Sheet: 干线管道)"""
    __tablename__ = "trunk_pipeline_details"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    control_level: Optional[str] = None  # 调控级别
    length: float = 0.0
    capacity: Optional[float] = None    # 物理管容
    station_count: int = 0
    valve_count: int = 0
    compressor_count: int = 0

class BranchPipelineDetail(SQLModel, table=True):
    """支线管道明细 (Sheet: 支线管道)"""
    __tablename__ = "branch_pipeline_details"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    trunk_link: Optional[str] = None    # 关联干线管道
    start_point: Optional[str] = None
    end_point: Optional[str] = None
    length: float = 0.0
    diameter: Optional[int] = None
    thickness: Optional[float] = None
    design_pressure: Optional[float] = None
    design_flow: Optional[float] = None
    commission_date: Optional[str] = None
    dispatch_console: Optional[str] = None

class NodeRelationDetail(SQLModel, table=True):
    """管道站场阀室关系 (Sheet: 管道站场阀室关系)"""
    __tablename__ = "node_relation_details"
    id: Optional[int] = Field(default=None, primary_key=True)
    trunk_name: Optional[str] = None
    branch_name: Optional[str] = None
    node_name: str = Field(index=True)
    node_name_calc: Optional[str] = None
    company: Optional[str] = None
    work_area: Optional[str] = None
    mileage: float = 0.0
    spacing: float = 0.0
    elevation: float = 0.0
    node_type_2025: Optional[str] = None
    location_desc: Optional[str] = None

class DistributionPointDetail(SQLModel, table=True):
    """分输口明细 (Sheet: 分输口)"""
    __tablename__ = "distribution_point_details"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    trunk_name: Optional[str] = None
    node_link: Optional[str] = None      # 关联站场/阀室
    station_abbr: Optional[str] = None   # 站场简称
    dispatch_console: Optional[str] = None
    metering_info: Optional[str] = None
    pressure_reg_info: Optional[str] = None
    commission_date: Optional[str] = None

class CompressorDetail(SQLModel, table=True):
    """压缩机明细 (Sheet: 压缩机)"""
    __tablename__ = "compressor_details"
    id: Optional[int] = Field(default=None, primary_key=True)
    station_name: str = Field(index=True)
    trunk_name: Optional[str] = None
    branch_name: Optional[str] = None
    unit_config: Optional[str] = None   # 机组配置
    unit_id: Optional[str] = None       # 压缩机组编号
    drive_type: Optional[str] = None    # 驱动方式
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    power: Optional[float] = None       # 额定功率
    commission_status: Optional[str] = None

class StorageDetail(SQLModel, table=True):
    """储气库明细 (Sheet: 储气库)"""
    __tablename__ = "storage_details"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    storage_type: Optional[str] = None  # 类型
    commission_date: Optional[str] = None
    working_capacity: Optional[float] = None
    daily_extract_max: Optional[float] = None
    daily_inject_max: Optional[float] = None
    company: Optional[str] = None

class DispatchConsoleDetail(SQLModel, table=True):
    """调度台明细 (Sheet: 调度台)"""
    __tablename__ = "dispatch_console_details"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
