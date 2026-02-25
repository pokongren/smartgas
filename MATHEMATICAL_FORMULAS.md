# 天然气管网仿真系统 - 数学公式大全

## 一、管存计算 (Linepack Volume)

### 1.1 基础几何体积
```
V_geom = π × (D/2)² × L

其中:
- V_geom: 几何体积 (m³)
- π: 圆周率 (≈3.14159)
- D: 管内径 (米) = diameter_mm / 1000
- L: 管长 (米) = length_km × 1000
```

### 1.2 压力修正体积
```
V = V_geom × (P_design / P_standard)

其中:
- V: 标准工况管存体积 (m³)
- P_design: 管线设计压力 (MPa)
- P_standard: 标准压力 = 10 MPa
```

### 1.3 完整计算公式
```
V = π × (diameter_mm/1000 / 2)² × (length_km × 1000) × (design_pressure_mpa / 10)

简化形式:
V = π × (diameter_mm)² × length_km × design_pressure_mpa / (4 × 10⁶)
```

### 1.4 计算示例
```
输入: diameter_mm=1016, length_km=100, design_pressure_mpa=10

计算:
  D = 1016 / 1000 = 1.016 m
  r = 1.016 / 2 = 0.508 m
  L = 100 × 1000 = 100,000 m
  V_geom = 3.14159 × (0.508)² × 100,000
         = 3.14159 × 0.258 × 100,000
         = 81,073 m³
  
  V = 81,073 × (10/10) = 81,073 m³
```

---

## 二、延迟权重计算 (Delay Ticks)

### 2.1 基础延迟公式
```
T_delay = max(1, ⌊V / R⌋)

其中:
- T_delay: 延迟 Tick 数
- V: 管存体积 (m³)
- R: 消耗速率 (m³/tick)
- ⌊ ⌋: 向下取整
- max(1, ...): 确保最小为 1 tick
```

### 2.2 现实时间转换
```
T_real = T_delay × t_tick

其中:
- T_real: 现实时间 (分钟)
- t_tick: 每个 Tick 代表的分钟数 (默认 10 分钟)
```

### 2.3 计算示例
```
输入: V=81,073 m³, R=1,000 m³/tick, t_tick=10分钟

计算:
  T_delay = max(1, ⌊81,073 / 1,000⌋)
          = max(1, 81)
          = 81 ticks
  
  T_real = 81 × 10 = 810 分钟
         = 13.5 小时
```

---

## 三、动态消耗速率 (Consumption Rate)

### 3.1 基础公式
```
R_dynamic = R_base × f_season × f_hour × f_user

其中:
- R_dynamic: 动态消耗速率 (m³/tick)
- R_base: 基准消耗速率 = 1,000 m³/tick
- f_season: 季节系数
- f_hour: 时段系数
- f_user: 用户类型系数
```

### 3.2 季节系数 (f_season)
```
       ⎧ 4.0  如果 month ∈ [11, 12, 1, 2]  (冬季)
       ⎪
f_s =  ⎨ 2.0  如果 month ∈ [3, 4, 10]    (春秋季)
       ⎪
       ⎩ 1.0  如果 month ∈ [5, 6, 7, 8, 9] (夏季)
```

### 3.3 时段系数 (f_hour)
```
       ⎧ 2.0  如果 hour ∈ [7, 8, 18, 19, 20] (早晚高峰)
f_h =  ⎨
       ⎩ 1.0  其他时段
```

### 3.4 用户类型系数 (f_user)
```
       ⎧ 1.0   residential   (居民)
       ⎪
       ⎪ 3.0   industrial    (工业)
f_u =  ⎨
       ⎪ 5.0   power_plant   (电厂)
       ⎪
       ⎩ 10.0  city_gate     (城市门站)
```

### 3.5 极端场景计算示例
```
场景: 冬季晚高峰城市门站

输入: month=1, hour=19, user_type=city_gate

计算:
  f_season = 4.0
  f_hour   = 2.0
  f_user   = 10.0
  
  R_dynamic = 1,000 × 4.0 × 2.0 × 10.0
            = 80,000 m³/tick
```

---

## 四、压力系数修正

### 4.1 压力因子公式
```
f_pressure = P_design / P_standard

其中:
- P_design: 管线设计压力 (MPa)
- P_standard: 标准压力 = 10 MPa
```

### 4.2 常见压力等级
| 设计压力 (MPa) | 压力因子 | 管存变化 |
|--------------|---------|---------|
| 6.0 | 0.60 | -40% |
| 8.0 | 0.80 | -20% |
| 10.0 | 1.00 | 基准 |
| 12.0 | 1.20 | +20% |

---

## 五、仿真传播计算

### 5.1 状态跃迁时间
```
T_depletion = T_current + T_delay

其中:
- T_depletion: 管存耗尽时间 (tick)
- T_current: 当前时间 (tick)
- T_delay: 该管线的延迟 ticks
```

### 5.2 传播队列处理
```
对于每个 tick:
  对于队列中的每个事件 (node, T_depletion, from_node):
    如果 T_depletion > T_current:
      保留在队列中 (还未耗尽)
    否则:
      标记为 outage
      将下游节点加入队列，耗尽时间 = T_current + 下游延迟
```

### 5.3 并发度计算
```
N_concurrent = max(|Q|) 对所有 tick

其中:
- |Q|: 当前 tick 队列中的事件数
- N_concurrent: 最大并发传播路径数
```

---

## 六、拓扑指标计算

### 6.1 节点度数
```
deg(v) = deg_in(v) + deg_out(v)

deg_in(v)  = |{(u,v) ∈ E}|  (流入边数)
deg_out(v) = |{(v,w) ∈ E}|  (流出边数)
```

### 6.2 平均传播速度
```
V_avg = T_total / N_affected

其中:
- T_total: 总推演 tick 数
- N_affected: 影响管线总数
- V_avg: 平均每管线传播速度 (ticks/管线)
```

---

## 七、场站平均参数

### 7.1 平均运行压力
```
P_avg = ⎧ (P_in + P_out) / 2  如果 P_in 和 P_out 存在
        ⎨
        ⎩ P_design             否则
```

### 7.2 平均运行温度
```
T_avg = ⎧ (T_in + T_out) / 2  如果 T_in 和 T_out 存在
        ⎨
        ⎩ T_default(type)      否则

其中:
  T_default(compressor) = 45°C
  T_default(valve)      = 20°C
  T_default(other)      = 25°C
```

---

## 八、公式汇总表

| 计算目标 | 公式 | 单位 |
|---------|------|------|
| 管存体积 | `V = π × (D/2)² × L × (P/10)` | m³ |
| 延迟 Ticks | `T = max(1, ⌊V/R⌋)` | ticks |
| 现实时间 | `t = T × 10` | 分钟 |
| 动态消耗 | `R = 1000 × f_s × f_h × f_u` | m³/tick |
| 压力因子 | `f_p = P / 10` | 无量纲 |

---

## 九、常量定义

```python
# 物理常量
PI = 3.14159265359

# 业务常量
P_STANDARD = 10.0          # MPa, 标准压力
R_BASE = 1000.0            # m³/tick, 基准消耗速率
TICK_MINUTES = 10          # minutes, 每tick代表的时间

# 季节系数
SEASON_WINTER = 4.0
SEASON_SPRING_AUTUMN = 2.0
SEASON_SUMMER = 1.0

# 时段系数
HOUR_PEAK = 2.0
HOUR_NORMAL = 1.0

# 用户系数
USER_RESIDENTIAL = 1.0
USER_INDUSTRIAL = 3.0
USER_POWER_PLANT = 5.0
USER_CITY_GATE = 10.0
```

---

## 十、计算流程图

```
输入: 管线参数 (diameter_mm, length_km, design_pressure_mpa)
      场景参数 (month, hour, user_type)

步骤1: 计算管存
       V = π × (D/2)² × L × (P/10)

步骤2: 计算动态消耗率
       R = 1000 × f_season(month) × f_hour(hour) × f_user(user_type)

步骤3: 计算延迟
       T = max(1, ⌊V/R⌋)

步骤4: 转换为现实时间
       t = T × 10 分钟

输出: 延迟 T ticks, 相当于 t 分钟
```

---

**文档版本**: 1.0  
**最后更新**: 2026-02-23  
**适用系统**: 天然气管网断流仿真推演引擎
