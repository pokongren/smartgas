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
    """通用管线表 (通过各 Sheet 汇总) - 阶段一：物理基座重塑 (优化版)
    
    新增物理属性字段，支持管存计算和断流延迟推演
    优化：支持压力等级系数、动态消耗速率
    """
    __tablename__ = "pipelines"
    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    start_station_id: str
    end_station_id: str
    
    # 基础物理属性 (新)
    diameter_mm: Optional[float] = Field(default=None, description="管径 (毫米)")
    length_km: float = Field(default=0.0, description="管长 (公里)")
    
    # 压力等级 (影响管存计算)
    design_pressure_mpa: Optional[float] = Field(default=10.0, description="设计压力 (MPa)")
    
    # 兼容旧字段
    diameter: Optional[int] = Field(default=None, description="[兼容旧版] 管径")
    length: float = Field(default=0.0, description="[兼容旧版] 管长")
    
    category: str = Field(default='branch', description="管线类别: trunk(干线)/branch(支线)")
    properties: Optional[str] = None
    
    # 物理计算方法
    def calculate_linepack_volume(self, pressure_factor: bool = True) -> float:
        """
        管存算子 (Linepack Calculator) - 优化版
        
        公式: V = π × (D/2)² × L × (P / 10)  [如启用压力系数]
        
        其中:
        - D: 管内径 (米) = diameter_mm / 1000
        - L: 管长 (米) = length_km * 1000
        - P: 设计压力 (MPa)，相对于 10MPa 标准压力
        
        返回: 管道内部体积容量 (立方米 m³)
        """
        if not self.diameter_mm or self.length_km <= 0:
            return 0.0
        
        import math
        diameter_m = self.diameter_mm / 1000.0
        length_m = self.length_km * 1000.0
        radius_m = diameter_m / 2.0
        
        volume = math.pi * (radius_m ** 2) * length_m
        
        if pressure_factor and self.design_pressure_mpa:
            # 压力修正：高压管道存气更多
            volume *= (self.design_pressure_mpa / 10.0)
        
        return round(volume, 2)
    
    def calculate_delay_ticks(
        self,
        tick_minutes: int = 10,
        consumption_rate: float = 1000.0,
        pressure_factor: bool = True
    ) -> int:
        """
        延迟权重算子 (Delay Weight Calculator) - 优化版
        
        参数:
        - tick_minutes: 每个 Tick 代表现实时间 (分钟)
        - consumption_rate: 消耗速率 (m³/tick)
        - pressure_factor: 是否考虑压力系数
        
        返回: 延迟 Tick 数 (整数，最小为 1)
        """
        volume = self.calculate_linepack_volume(pressure_factor=pressure_factor)
        if volume <= 0:
            return 1
        
        delay_ticks = max(1, int(volume / consumption_rate))
        return delay_ticks
    
    def get_consumption_rate(
        self,
        hour_of_day: int = 12,
        month: int = 6,
        user_type: str = 'residential'
    ) -> float:
        """
        动态消耗速率 (Dynamic Consumption Rate)
        
        根据时间、季节、用户类型动态调整消耗速率
        
        返回: 消耗速率 (m³/tick)
        """
        base_rate = 1000.0
        
        # 季节系数: 冬季是夏季的 3-5 倍
        season_factor = 1.0
        if month in [11, 12, 1, 2]:
            season_factor = 4.0
        elif month in [3, 4, 10]:
            season_factor = 2.0
        
        # 时段系数: 早晚高峰
        peak_hours = [7, 8, 18, 19, 20]
        hour_factor = 2.0 if hour_of_day in peak_hours else 1.0
        
        # 用户类型系数
        user_factors = {
            'residential': 1.0,
            'industrial': 3.0,
            'power_plant': 5.0,
            'city_gate': 10.0
        }
        user_factor = user_factors.get(user_type, 1.0)
        
        return base_rate * season_factor * hour_factor * user_factor

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
