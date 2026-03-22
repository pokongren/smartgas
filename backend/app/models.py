from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime

# =================================================================
# 核心业务模型 (保留兼容性)
# =================================================================


class JunctionGroup(SQLModel, table=True):
    """跨管线联络点（枢纽）
    
    记录不同管线系统之间的物理连接关系。
    同一枢纽内的站场视为可互通，在构建全国联合拓扑图时
    会在它们之间添加虚拟互联边。
    
    示例：靖边枢纽连接了陕京四线首站和西一线起点。
    """
    __tablename__ = "junction_groups"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(title="枢纽名称")                # 靖边枢纽
    description: Optional[str] = Field(default=None, title="描述")
    station_ids: str = Field(title="关联站场ID列表(JSON)")  # '["SJ4-1022", "WE1-1"]'

class PipelineSystem(SQLModel, table=True):
    """管线系统元数据（对应前端 PipelinePackage）
    
    每条管线系统（如"西气东输一线"）包含若干图层（干线+支线），
    此表存储系统级别的分组信息，用于 pipeline-packages API。
    """
    __tablename__ = "pipeline_systems"
    id: str = Field(primary_key=True)        # 'we1', 'we2', 'zm' ...
    name: str = Field(title="管线系统名称")    # '西气东输一线'
    color: str = Field(title="主题色")         # '#FF5722'
    sort_order: int = Field(default=0, title="排序序号")
    # 图层配置 JSON: [{"name": "西一线干线", "type": "trunk", "id_prefix": "WE1", "visible": true}, ...]
    layers_config: Optional[str] = Field(default=None, title="图层配置(JSON)")


class Station(SQLModel, table=True):
    """通用站场表 (通过各 Sheet 汇总) - 数据质量修复版
    
    新增物理参数字段：
    - 设计压力、运行压力（进出站）
    - 运行温度
    - 处理能力
    """
    __tablename__ = "stations"
    id: str = Field(primary_key=True, title="站场编号")
    name: str = Field(index=True, title="站场名称")
    type: str = Field(title="站场类型")  # 'source', 'compressor', 'distribution', 'valve', etc.
    longitude: float = Field(default=0.0, title="经度")
    latitude: float = Field(default=0.0, title="纬度")
    
    # 压力参数 (MPa)
    design_pressure: Optional[float] = Field(default=10.0, title="设计压力(MPa)", description="设计压力 (MPa)")
    operating_pressure_in: Optional[float] = Field(default=None, title="进站运行压力(MPa)", description="进站运行压力 (MPa)")
    operating_pressure_out: Optional[float] = Field(default=None, title="出站运行压力(MPa)", description="出站运行压力 (MPa)")
    
    # 温度参数 (°C)
    operating_temp_in: Optional[float] = Field(default=None, title="进站温度(°C)", description="进站温度 (°C)")
    operating_temp_out: Optional[float] = Field(default=None, title="出站温度(°C)", description="出站温度 (°C)")
    
    # 处理能力 (万方/天)
    capacity: Optional[float] = Field(default=None, title="设计处理能力(万方/天)", description="设计处理能力 (万方/天)")
    
    properties: Optional[str] = None  # JSON string for extra data
    
    def get_avg_pressure(self) -> float:
        """获取平均运行压力"""
        if self.operating_pressure_in and self.operating_pressure_out:
            return (self.operating_pressure_in + self.operating_pressure_out) / 2
        return self.design_pressure or 10.0
    
    def get_avg_temperature(self) -> float:
        """获取平均运行温度"""
        if self.operating_temp_in and self.operating_temp_out:
            return (self.operating_temp_in + self.operating_temp_out) / 2
        # 根据站类型返回默认温度
        if self.type == 'compressor':
            return 45.0  # 压气站温度较高
        elif self.type == 'valve':
            return 20.0  # 阀室常温
        else:
            return 25.0  # 默认


class Pipeline(SQLModel, table=True):
    """通用管线表 (通过各 Sheet 汇总) - 阶段一：物理基座重塑 (优化版)
    
    新增物理属性字段，支持管存计算和断流延迟推演
    优化：支持压力等级系数、动态消耗速率
    """
    __tablename__ = "pipelines"
    id: str = Field(primary_key=True, title="管线编号")
    name: str = Field(index=True, title="管线名称")
    start_station_id: str = Field(title="起点站场编号")
    end_station_id: str = Field(title="终点站场编号")
    
    # 基础物理属性 (新)
    diameter_mm: Optional[float] = Field(default=None, title="管径(毫米)", description="管径 (毫米)")
    length_km: float = Field(default=0.0, title="管长(公里)", description="管长 (公里)")
    
    # 压力等级 (计算使用)
    design_pressure_mpa: Optional[float] = Field(default=10.0, title="设计压力(MPa)", description="设计压力 (MPa)")
    start_pressure_mpa: Optional[float] = Field(default=None, title="首站压力(MPa)", description="首站压力 (MPa)")
    end_pressure_mpa: Optional[float] = Field(default=None, title="末站压力(MPa)", description="末站压力 (MPa)")

    # 兼容旧字段
    diameter: Optional[int] = Field(default=None, title="管径(旧版)", description="[兼容旧版] 管径")
    length: float = Field(default=0.0, title="管长(旧版)", description="[兼容旧版] 管长")
    
    category: str = Field(default='branch', title="管线类别", description="管线类别: trunk(干线)/branch(支线)")
    properties: Optional[str] = Field(default=None, title="附加属性")
    
    # 物理计算方法
    def calculate_z_factor(self, pressure_mpa: float, temperature_c: float = 20.0) -> float:
        """
        计算天然气压缩因子 Z (带温度的 Papay 经验公式)
        
        天然气在高压下比理想气体更容易压缩（Z < 1）。
        因为有真实的管道地温数据，采用更精准的 Papay 公式：
        Z = 1 - (3.52 * Pr / Tr) * exp(-0.225 * Pr) + 0.274 * (Pr^2 / Tr^3)
        其中 Pr 为对比压力，Tr 为对比温度。
        """
        # ====================
        # 第一步：计算对比参数 (Reduced Properties)
        # ====================
        # 天然气(主要为甲烷)的临界压力 Pc 约为 4.60 MPa
        # 天然气的临界温度 Tc 约为 191 K (-82 ℃)
        Pc = 4.60
        Tc = 191.0
        
        # 把当前温度转换成开尔文(K)
        T_kelvin = temperature_c + 273.15
        
        # 计算对比压力和对比温度 (真实值 / 临界极值)
        Pr = pressure_mpa / Pc
        Tr = T_kelvin / Tc
        
        # ====================
        # 第二步：代入 Papay 公式计算
        # ====================
        import math
        
        part_1 = 3.52 * (Pr / Tr)
        part_2 = math.exp(-0.225 * Pr)
        part_3 = 0.274 * (Pr**2 / Tr**3)
        
        z_factor = 1.0 - (part_1 * part_2) + part_3
        
        # 兜底物理极值 (天然气一般不低于 0.7)
        return max(0.7, z_factor)

    def calculate_linepack_volume(self, pressure_factor: bool = True) -> float:
        """
        管存算子 (Linepack Calculator) - 真实物理状态
        
        公式: V = [π × (D/2)² × L] × (P_avg / 0.101325) / Z
        
        其中:
        - D: 管内径 (米)
        - L: 管长 (米)
        - P_avg: 平均运行压力 (MPa)
        - 0.101325: 标准大气压 (MPa)
        - Z: 气体压缩因子
        """
        if not self.diameter_mm or self.length_km <= 0:
            return 0.0
        
        import math
        diameter_m = self.diameter_mm / 1000.0
        length_m = self.length_km * 1000.0
        radius_m = diameter_m / 2.0
        
        geom_volume = math.pi * (radius_m ** 2) * length_m
        
        start_p = self.start_pressure_mpa or self.design_pressure_mpa or 10.0
        # 兜底：如果没存末站压力，假设压力损耗产生 80% 倍压降
        end_p = self.end_pressure_mpa or (start_p * 0.8)
        p_avg = (start_p + end_p) / 2.0
        
        # 计算压缩因子
        z_factor = self.calculate_z_factor(p_avg)
        
        # 转换为标况体积 (Nm³)
        standard_volume = geom_volume * (p_avg / 0.101325) / z_factor
        
        return round(standard_volume, 2)
    
    def calculate_flow_rate(self) -> float:
        """
        计算管道流量 (Flow Rate)
        基于目前长输高压天然气管网最常用的 【泛美B公式 (Panhandle B)】
        
        Panhandle B 专为高压主干线(大管径、高雷诺数)设计，无需单独计算摩阻f，内置了管径粗糙系数。
        公式: Q = C_pb * E * (T_b/P_b) * [ (P1^2 - P2^2) / (G^0.961 * T * L * Z) ]^0.51 * D^2.53
        
        其中:
        - Q: 每日标准体积流量 (m³/d)
        - E: 管道效率系数 (Pipeline Efficiency)，钢管通常取 0.85 左右 (计入内壁粗糙老化)
        - P1, P2: 起点/终点绝对压力 (MPa)
        - L: 管道长度 (km)
        - D: 内径 (mm)
        - G: 天然气相对密度 (此处按甲烷 90% 含量推算)
        - T: 运行平均温度 (此处经验取 293K)
        - Z: 压缩因子
        """
        if not self.diameter_mm or self.length_km <= 0:
            return 1000.0 # 默认保底值
            
        D_mm = self.diameter_mm
        L_km = self.length_km
        
        # 首末站压力
        P1 = self.start_pressure_mpa or self.design_pressure_mpa or 10.0
        P2 = self.end_pressure_mpa or (P1 * 0.8)

        if P1 <= P2:
            return 100.0 # 没压差或者压反了，给个物理低速蠕动防断供
            
        # 平均压力及压缩因子 Z
        P_avg = (P1 + P2) / 2.0
        Z = self.calculate_z_factor(P_avg)
        
        # 常数与假设条件
        E = 0.85            # 管道效率 (考虑到积液、粗糙度增加等因素)
        
        # 根据"甲烷含量稳定在 90%"计算天然气相对密度 G
        # 假设 90% 为甲烷(分子量 16.04)，10% 为重烃或惰性气体混合物(近似按乙烷 30.07 计算)
        m_air = 28.96
        m_ch4 = 16.04
        m_other = 30.07
        m_gas = 0.90 * m_ch4 + 0.10 * m_other
        G = m_gas / m_air   # 相对密度约为 0.6025
        
        T_gas = 293.15      # 管道气体温度 (20度左右)
        
        # 动力基础系数计算：[ 1 / (G^0.961 * T_gas * Z) ] ^ 0.51
        part1 = (P1**2 - P2**2) / (L_km * (G**0.961) * T_gas * Z)
        if part1 <= 0:
            return 100.0
            
        # 泛美 B 核心系数: 1.292 * 10^-3 是常数 C * (Tb/Pb) 换算后的结果
        # 注意：天然气工业公式里计算出的通常是 10^4 Nm³/d (万标方/天)。
        C_pb = 1.264 * 10**-3  # Panhandle B 修正系数
        
        # 工业常数计算出的是 标准立方米/天，为匹配我们的仿真时间颗粒我们将其进行正确换算
        # 真实现实的中国管网主干线日输气量通常在 1000万方 ~ 6000万方量级
        q_day = C_pb * E * (part1 ** 0.51) * (D_mm ** 2.53) 
        # 因为原公式基于某些特定单位制，在全 SI+MPa 的转换中可能爆出巨大数字，这里做了数量级修正乘子
        q_day *= 1000  # 修正：将基础计算结果提升至真实万方/千万方级别 的日流量，比如推算出来是 1500万方/天
        
        # 转换为 Tick 流量 (假设 1 tick = 10 min, 即一天 144 ticks)
        q_tick = q_day / 144.0
        
        return max(100.0, round(q_tick, 2))

    def calculate_delay_ticks(self) -> int:
        """
        物理延迟时间算子 (Physical Delay Simulator)
        
        基于纯流体力学：管内存气量 / 当下管网压差吸气流速 = 完全抽空管线需要的时间。
        如果发生彻底的截断断气，下游完全凭管存抽气，可以支撑的 Tick(每十分钟) 数量。
        
        返回: 延迟 Tick 数 (整数，最小为 1)
        """
        volume = self.calculate_linepack_volume()
        flow_rate = self.calculate_flow_rate()
        
        delay_ticks = max(1, int(volume / flow_rate))
        return delay_ticks


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


class TopologyCorrectionLog(SQLModel, table=True):
    """拓扑修正记录表
    
    记录每次拓扑修正的详细信息，用于审计和回溯。
    """
    __tablename__ = "topology_correction_logs"
    id: Optional[int] = Field(default=None, primary_key=True)
    pipeline_name: str = Field(index=True, title="关联管线名称")
    correction_type: str = Field(title="修正类型", description="trunk_jump / branch_attach / orphan_node / duplicate_edge")
    severity: str = Field(default="warning", title="严重程度", description="error / warning / info")
    description: str = Field(default="", title="修正描述")
    before_json: Optional[str] = Field(default=None, title="修正前快照 (JSON)")
    after_json: Optional[str] = Field(default=None, title="修正后快照 (JSON)")
    status: str = Field(default="pending", title="状态", description="pending / applied / rejected")
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    applied_at: Optional[str] = Field(default=None, title="应用时间")
