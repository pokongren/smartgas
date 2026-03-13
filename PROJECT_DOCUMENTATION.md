# 智脉平台 (SmartGas-Grid) - 完整项目说明

> **基于大模型的复杂天然气管网智能调度与决策辅助系统**

---

## 📋 目录

1. [项目概述](#一项目概述)
2. [系统架构](#二系统架构)
3. [核心功能模块](#三核心功能模块)
4. [技术栈详解](#四技术栈详解)
5. [数据模型](#五数据模型)
6. [物理仿真引擎](#六物理仿真引擎)
7. [AI 智能助手](#七ai-智能助手)
8. [项目结构](#八项目结构)
9. [部署与启动](#九部署与启动)
10. [API 接口](#十api-接口)

---

## 一、项目概述

### 1.1 项目背景

**智脉平台**是一套面向省级/国家级天然气管网运营的新一代智能化指挥辅助系统。项目直击工业调度中**"看不全、查得慢、编得累、算不透"**四大核心痛点，深度融合了**拓扑图数据计算、物理管网仿真、RAG 领域知识库检索**与**多智能体（Agent）工作流**能力。

### 1.2 核心解决痛点

| 痛点 | 传统方案 | 智脉平台方案 |
|------|---------|-------------|
| **看不全** | 调度管辖范围极大，视图切换割裂，易形成监控盲区 | AI 智能驾驶舱，动态组建监控卡片与分屏视图，高风险站场主动聚合推优显示 |
| **查得慢** | 海量应急预案与设备台账查询极慢，延误黄金抢险时间 | 自然语言领域检索引擎（NL2SQL + RAG），复杂自然语言一秒穿透查询 |
| **编得累** | 停气保供排产依赖老专家经验，方案手写耗时长、易违规 | 专家级管网调度智能体，内置拓扑规则引擎，一键生成安全操作指导 |
| **算不透** | 数万点位 SCADA 时序数据沦为"死表"，仅作事后诸葛亮 | 多维运行数据洞察与预测，AI 静默监听高频状态偏差，一键成表出图 |

### 1.3 业务价值

- 将传统"被动监控操作型 SCADA 系统"升级为"主动预测与智能辅助决策平台"
- 大幅度降低一线操作认知负荷
- 构筑管网本质安全防线

---

## 二、系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           前端呈现层 (React + TypeScript)                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │   政企视图    │ │   科技视图    │ │  拓扑管理视图 │ │  AI 工作流   │   │
│  │  (数据大屏)   │ │  (监控中心)   │ │ (Canvas编辑) │ │  (智能助手)  │   │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│                           API 服务层 (FastAPI)                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │   基础数据    │ │   应急管理    │ │   拓扑分析    │ │   AI 服务    │   │
│  │   /api       │ │ /api/emergency│ │ /api/topology│ │ /api/assistant│  │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│                        核心算法与 Agent 层 (Python)                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │  物理仿真计算器 │ │  NetworkX   │ │  RAG知识库   │ │  多智能体调度 │   │
│  │ 管存/时延预测  │ │  图算法引擎  │ │ (ChromaDB)  │ │ (LangChain) │   │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│                           数据存储层 (SQLite)                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                    │
│  │   站场表      │ │   管线表      │ │   事件表      │                    │
│  │  stations    │ │  pipelines   │ │  emergency   │                    │
│  └──────────────┘ └──────────────┘ └──────────────┘                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流转图

```
用户/调度员
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. 数据录入流                                                    │
│  用户上传/指令 → UI层 → API Gateway → 数据处理 → 数据库存储        │
├─────────────────────────────────────────────────────────────────┤
│  2. 管道生成流 (Pipeline Master Workflow)                        │
│  数据库 → 拓扑提取器 → 数据转换器 → 智能排序 → 前端管线数据        │
├─────────────────────────────────────────────────────────────────┤
│  3. 可视化渲染流                                                  │
│  管线数据 + 站场数据 → 智能分层聚合算法 → 可视化层 → 地图组件      │
├─────────────────────────────────────────────────────────────────┤
│  4. 用户交互流                                                    │
│  地图查看/点击 ← 聚合详情面板 ← 用户操作反馈                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、核心功能模块

### 3.1 数据管理中心

#### 功能列表

| 功能 | 说明 | 状态 |
|------|------|------|
| **站场管理** | 压气站、分输站、阀室等设施的增删改查 | ✅ 已完成 |
| **管线管理** | 干线、支线管线的属性维护与拓扑关联 | ✅ 已完成 |
| **数据导入** | Excel 批量导入，自动校验与去重 | ✅ 已完成 |
| **数据质检** | 孤立节点检测、坐标异常检查、重复连接识别 | ✅ 已完成 |

#### 数据模型

```python
# 站场模型
Station:  
  - id: int                    # 唯一标识
  - name: str                  # 站场名称
  - type: str                  # 类型 (compressor/valve/distribution)
  - longitude: float           # 经度
  - latitude: float            # 纬度
  - design_pressure: float     # 设计压力 (MPa)
  - capacity: float            # 处理能力

# 管线模型
Pipeline:
  - id: int                    # 唯一标识
  - name: str                  # 管线名称
  - start_station_id: int      # 起点站场ID
  - end_station_id: int        # 终点站场ID
  - length_km: float           # 长度 (公里)
  - diameter_mm: float         # 管径 (毫米)
  - category: str              # 分类 (trunk/branch)
```

---

### 3.2 拓扑管理系统

#### 核心能力

| 能力 | 说明 |
|------|------|
| **可视化编辑** | Canvas 力导向图，拖拽式节点布局 |
| **智能验证** | 自动发现孤立节点、错误连接、重复连接 |
| **分层过滤** | 按管线分组、按类型筛选、孤立节点开关 |
| **关键节点识别** | 介数中心性算法找出核心枢纽 |

#### 技术亮点

```
✅ 纯 Canvas 实现，零第三方依赖
✅ 力导向布局自动排列（排斥力 + 弹簧力 + 中心引力）
✅ 3000+ 节点流畅渲染
✅ 缩放/平移/搜索定位
✅ 智能分层聚合解决节点重叠问题
```

#### 拓扑验证类型

| 问题类型 | 说明 | 可视化标识 |
|---------|------|-----------|
| 孤立节点 | 无管线连接的站场 | 红色虚线圈 |
| 错误连接 | 端点不存在的管线 | 红色连线 |
| 重复连接 | 同一对站场多条管线 | 金色高亮 |
| 自环连接 | 起点=终点的管线 | 警告标记 |

---

### 3.3 物理仿真引擎

#### 计算类型一览

| 计算类型 | 公式/方法 | 用途 |
|---------|----------|------|
| **管存计算** | Papay 压缩因子 + 真实气体状态方程 | 计算管道储气量 |
| **流量计算** | Panhandle B 公式 | 评估输送能力 |
| **延迟推演** | 管存 ÷ 流量 = 断供延迟时间 | 应急响应决策 |
| **影响分析** | 图遍历算法 | 故障影响范围 |

#### 核心计算公式

```python
# 1. 管存计算 (Linepack Volume)
V = π × (D/2)² × L × (P_design / P_standard)

其中:
- V: 管存体积 (m³)
- D: 管内径 (m) = diameter_mm / 1000
- L: 管长 (m) = length_km × 1000
- P_design: 设计压力 (MPa)
- P_standard: 标准压力 = 10 MPa

# 2. 延迟计算 (Delay Ticks)
T_delay = max(1, ⌊V / R⌋)

其中:
- T_delay: 延迟 Tick 数
- V: 管存体积 (m³)
- R: 消耗速率 (m³/tick)
- 1 tick = 10 分钟

# 3. 动态消耗率
R_dynamic = R_base × f_season × f_hour × f_user

系数表:
- f_season: 冬季=4.0, 春秋季=2.0, 夏季=1.0
- f_hour: 高峰=2.0, 平时=1.0
- f_user: 居民=1.0, 工业=3.0, 电厂=5.0, 城市门站=10.0
```

#### 仿真场景示例

```
场景: 冬季晚高峰城市门站断流

输入:
  - 管线: 直径 1016mm, 长度 100km, 设计压力 10MPa
  - 时间: 1月(冬季) 19:00(晚高峰)
  - 用户: 城市门站

计算:
  1. 管存 V = π × (0.508)² × 100,000 × (10/10) ≈ 81,073 m³
  2. 消耗率 R = 1000 × 4.0 × 2.0 × 10.0 = 80,000 m³/tick
  3. 延迟 T = max(1, ⌊81,073 / 80,000⌋) = 1 tick = 10 分钟

结论: 该管线约可支撑 10 分钟后断气
```

---

### 3.4 AI 应急助手

#### RAG 知识库

| 组件 | 技术 | 说明 |
|------|------|------|
| 向量数据库 | ChromaDB | 存储应急预案、操作规程的向量表示 |
| 嵌入模型 | MiniMax API | 文本向量化 |
| 检索策略 | 相似度搜索 + 重排序 | 精准定位相关文档 |
| 生成模型 | MiniMax LLM | 基于检索结果生成回答 |

#### 智能工作流

```
故障上报 → 影响分析 → 方案生成 → 处置跟踪
    │          │          │          │
    ▼          ▼          ▼          ▼
  自然语言   拓扑计算    AI生成     状态监控
  输入解析   传播推演    操作步骤    闭环反馈
```

#### MCP 工具集成

| 工具类型 | 功能 |
|---------|------|
| GIS 查询 | 地理位置、周边环境 |
| SCADA 接入 | 实时运行数据 |
| 气象服务 | 天气预警、极端天气 |
| 外部系统 | 应急资源、通讯录 |

---

### 3.5 可视化视图系统

#### 视图列表

| 视图 | 用途 | 特点 |
|------|------|------|
| **政企视图 (CorpView)** | 领导驾驶舱、数据大屏 | 宏观指标、关键数据卡片 |
| **科技视图 (TechView)** | 调度监控中心 | 实时数据、告警列表、趋势图 |
| **全国管网视图 (GlobalPipelineView)** | 全网拓扑总览 | 地图叠加、管线分布、流向指示 |
| **拓扑管理视图 (TopologyView)** | Canvas 拓扑编辑 | 力导向图、节点拖拽、连接编辑 |
| **地图拓扑视图 (MapTopologyView)** | 地理拓扑管理 | 地图 + 拓扑双模式 |
| **AI 工作流视图 (WorkflowView)** | 智能助手交互 | 流程编排、对话界面 |

---

## 四、技术栈详解

### 4.1 前端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| React | ^19.2.3 | UI 框架 |
| TypeScript | ~5.8.2 | 类型安全 |
| Vite | ^6.2.0 | 构建工具 |
| Tailwind CSS | ^4.0.0 | 原子化样式 |
| React Router | ^7.12.0 | 路由管理 |
| Axios | ^1.13.2 | HTTP 请求 |
| AMap JSAPI | ^1.0.1 | 高德地图集成 |

### 4.2 后端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Python | 3.12 | 编程语言 |
| FastAPI | - | Web 框架 |
| SQLModel | - | ORM 数据模型 |
| SQLite | - | 数据存储 |
| NetworkX | - | 图算法库 |
| ChromaDB | 1.5.2 | 向量数据库 |
| LangChain | - | AI 工作流框架 |
| MiniMax API | - | 大模型服务 |

### 4.3 选型理由

| 层级 | 选型 | 优势 |
|------|------|------|
| **前端应用** | React 18 + TypeScript + Vite | 极致热更新与严格的工业级前端工程化基础 |
| **视觉呈现** | Tailwind CSS + Vanilla Canvas | 规避臃肿的三方图表库，实现 3000+ 拓扑节点毫秒级流畅渲染 |
| **后端核心** | Python 3.12 + FastAPI | 高性能异步处理，原生适配各类深度学习与大模型库生态调用 |
| **持久层存储** | SQLite + SQLModel | 轻量化部署极简集成，ORM 保证严格数据类型映射 |
| **AI 驱动层** | LangChain + MiniMax API + ChromaDB | 基于内网级 API 高稳定调用的 RAG 大模型集成 |
| **物理引擎层** | NetworkX | 高效处理复杂多支路干网流向、断裂影响及高管存计算等拓扑运算 |

---

## 五、数据模型

### 5.1 数据库 ER 图

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│    stations     │         │   pipelines     │         │   emergency     │
│   (站场表)       │◄───────►│   (管线表)       │         │   (事件表)       │
├─────────────────┤         ├─────────────────┤         ├─────────────────┤
│ PK id           │         │ PK id           │         │ PK id           │
│    name         │         │ FK start_station│◄────────┤    type         │
│    type         │◄────────┤ FK end_station  │         │    location     │
│    longitude    │         │    name         │         │    severity     │
│    latitude     │         │    length_km    │         │    status       │
│    design_press │         │    diameter_mm  │         │    created_at   │
│    capacity     │         │    category     │         │    resolved_at  │
└─────────────────┘         │    delay_ticks  │         └─────────────────┘
                            └─────────────────┘
```

### 5.2 核心数据类型

```typescript
// 站场类型
enum StationType {
  COMPRESSOR = 'compressor',      // 压气站
  VALVE = 'valve',                // 阀室
  DISTRIBUTION = 'distribution',  // 分输站
  GATE = 'gate'                   // 门站
}

// 管线类型
enum PipelineCategory {
  TRUNK = 'trunk',      // 干线
  BRANCH = 'branch'     // 支线
}

// 节点状态
enum NodeStatus {
  NORMAL = 'normal',      // 正常
  WARNING = 'warning',    // 警告
  CRITICAL = 'critical',  // 严重
  ISOLATED = 'isolated'   // 孤立
}
```

---

## 六、物理仿真引擎

### 6.1 仿真计算流程

```
输入: 管线参数 (diameter_mm, length_km, design_pressure_mpa)
      场景参数 (month, hour, user_type)
      故障参数 (failure_node, failure_type)

步骤1: 计算管存
       V = π × (D/2)² × L × (P/10)

步骤2: 计算动态消耗率
       R = 1000 × f_season(month) × f_hour(hour) × f_user(user_type)

步骤3: 计算延迟
       T = max(1, ⌊V/R⌋)

步骤4: 图遍历传播
       从故障节点开始，沿拓扑传播
       每节点延迟 = 管存 / 下游流量

步骤5: 生成影响报告
       - 受影响管线列表
       - 断气时间预测
       - 备用路径建议

输出: 仿真结果报告
```

### 6.2 核心算法实现

```python
class PipelineSimulator:
    """管线物理仿真器"""
    
    def calculate_linepack(self, pipeline) -> float:
        """计算管存"""
        D = pipeline.diameter_mm / 1000  # 转换为米
        L = pipeline.length_km * 1000    # 转换为米
        V_geom = math.pi * (D/2) ** 2 * L
        return V_geom * (pipeline.design_pressure / 10.0)
    
    def calculate_delay(self, linepack: float, consumption_rate: float) -> int:
        """计算延迟 ticks"""
        return max(1, int(linepack / consumption_rate))
    
    def simulate_failure(self, failure_node: int, max_ticks: int = 1000):
        """故障传播仿真"""
        # BFS 遍历传播
        queue = [(failure_node, 0)]  # (节点, 当前tick)
        affected = {}
        
        while queue:
            node, tick = queue.pop(0)
            if tick > max_ticks:
                continue
                
            for downstream in self.get_downstream(node):
                delay = self.calculate_delay(
                    self.calculate_linepack(downstream),
                    self.get_consumption_rate(downstream)
                )
                outage_tick = tick + delay
                
                if downstream.id not in affected:
                    affected[downstream.id] = outage_tick
                    queue.append((downstream.id, outage_tick))
        
        return affected
```

---

## 七、AI 智能助手

### 7.1 RAG 检索流程

```
用户提问
    │
    ▼
┌─────────────────┐
│  1. 意图识别     │ ← NLP 解析用户意图
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  2. 向量化查询   │ ← MiniMax Embedding API
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  3. 向量检索     │ ← ChromaDB 相似度搜索
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  4. 重排序       │ ← 相关性评分
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  5. 上下文生成   │ ← 组装相关文档片段
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  6. LLM 生成回答 │ ← MiniMax LLM
└────────┬────────┘
         │
         ▼
    返回回答
```

### 7.2 工作流引擎

```python
class WorkflowEngine:
    """工作流执行引擎"""
    
    def execute(self, workflow_def: WorkflowDefinition, context: Context):
        """执行工作流"""
        for step in workflow_def.steps:
            # 执行步骤
            result = self.execute_step(step, context)
            
            # 更新上下文
            context.set(step.output_key, result)
            
            # 条件判断
            if step.condition and not self.evaluate(step.condition, context):
                break
                
        return context
    
    def execute_step(self, step: Step, context: Context):
        """执行单个步骤"""
        if step.type == 'llm':
            return self.llm_call(step.prompt_template, context)
        elif step.type == 'tool':
            return self.tool_call(step.tool_name, step.parameters, context)
        elif step.type == 'api':
            return self.api_call(step.endpoint, step.method, context)
```

---

## 八、项目结构

```
smartgas-grid/
├── backend/                          # FastAPI 后端
│   ├── app/
│   │   ├── main.py                  # 应用入口
│   │   ├── models.py                # SQLModel 数据模型
│   │   ├── schemas.py               # Pydantic 请求/响应模型
│   │   ├── database.py              # 数据库连接
│   │   ├── mcp_server.py            # MCP 服务器配置
│   │   ├── routers/                 # API 路由
│   │   │   ├── basic.py             # 基础数据 CRUD
│   │   │   ├── topology_editor.py   # 拓扑管理 API
│   │   │   ├── topology_computation.py  # 拓扑计算 API
│   │   │   ├── emergency.py         # 应急指挥
│   │   │   ├── workflow.py          # AI 工作流
│   │   │   ├── ai_assistant.py      # AI 助手
│   │   │   └── data_import.py       # 数据导入
│   │   └── services/                # 业务逻辑
│   │       ├── topology.py          # 图算法服务
│   │       ├── topology_computation.py  # 拓扑计算
│   │       ├── simulation_service.py    # 仿真服务
│   │       ├── rag_enhanced.py      # RAG 引擎
│   │       ├── ai_client.py         # AI 客户端
│   │       ├── workflow_service.py  # 工作流服务
│   │       └── execution_engine.py  # 执行引擎
│   ├── data/
│   │   └── smartgas.db              # SQLite 数据库
│   └── requirements.txt             # Python 依赖
│
├── src/                             # React 前端
│   ├── App.tsx                      # 应用主组件
│   ├── main.tsx                     # 入口文件
│   ├── views/                       # 页面视图
│   │   ├── CorpView.tsx             # 政企数据大屏
│   │   ├── TechView.tsx             # 科技监控中心
│   │   ├── GlobalPipelineView.tsx   # 全国管网视图
│   │   ├── TopologyView.tsx         # Canvas 拓扑管理
│   │   ├── MapTopologyView.tsx      # 地图拓扑视图
│   │   ├── WorkflowView.tsx         # AI 工作流视图
│   │   └── MapDemo.tsx              # 地图演示
│   ├── components/                  # 组件
│   │   ├── ai-assistant/            # AI 助手组件
│   │   ├── map-view/                # 地图视图组件
│   │   ├── topology/                # 拓扑组件
│   │   ├── workflow/                # 工作流组件
│   │   ├── ClusterDetailPanel.tsx   # 聚合详情面板
│   │   ├── HubDetailPanel.tsx       # 枢纽详情面板
│   │   └── EmergencyPanel.tsx       # 应急面板
│   ├── services/                    # API 服务
│   │   ├── api.ts                   # 基础 API
│   │   └── workflow-api.ts          # 工作流 API
│   ├── utils/                       # 工具函数
│   │   ├── dataLoader.ts            # 数据加载
│   │   ├── mapRenderer.ts           # 地图渲染
│   │   ├── hubRenderer.ts           # 枢纽渲染
│   │   ├── geoOffset.ts             # 地理偏移
│   │   └── topology-validator.ts    # 拓扑验证
│   ├── data/                        # 静态数据
│   │   ├── pipelines/               # 管线数据
│   │   └── *_structure.json         # 结构定义
│   ├── types/                       # TypeScript 类型
│   └── hooks/                       # React Hooks
│
├── docs/                            # 文档
│   ├── architecture.md              # 架构设计
│   └── assets/                      # 图片资源
│
├── .claude/skills/                  # Claude Skills
│   ├── pipeline-master-system/      # 管道全生命周期管理
│   ├── pipeline-extraction/         # 管道数据提取
│   ├── pipeline-visualization/      # 管道可视化
│   ├── pipeline-hierarchy-display/  # 层级化显示
│   └── pipeline-crossing-solution/  # 交汇点处理
│
├── package.json                     # Node.js 依赖
├── vite.config.ts                   # Vite 配置
├── tailwind.config.js               # Tailwind 配置
└── tsconfig.json                    # TypeScript 配置
```

---

## 九、部署与启动

### 9.1 环境要求

| 组件 | 版本要求 |
|------|---------|
| Node.js | >= 18.0 |
| Python | >= 3.12 |
| npm | >= 9.0 |

### 9.2 后端启动

```bash
# 1. 进入后端目录
cd backend

# 2. 创建虚拟环境（推荐）
python -m venv .venv
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # Linux/Mac

# 3. 安装依赖
pip install -r requirements.txt

# 4. 配置环境变量
# 创建 .env 文件，添加：
# MINIMAX_API_KEY=your_api_key_here

# 5. 启动服务
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 服务运行在 http://localhost:8000
# API 文档 http://localhost:8000/docs
```

### 9.3 前端启动

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器
npm run dev

# 服务运行在 http://localhost:5173

# 3. 生产构建
npm run build

# 4. 预览生产构建
npm run preview
```

### 9.4 快速启动脚本

```bash
# Windows 批处理
start_dev.bat

# 拓扑演示
start_topology_demo.bat
```

---

## 十、API 接口

### 10.1 基础数据 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stations` | 获取所有站场 |
| POST | `/api/stations` | 创建站场 |
| GET | `/api/stations/{id}` | 获取站场详情 |
| PUT | `/api/stations/{id}` | 更新站场 |
| DELETE | `/api/stations/{id}` | 删除站场 |
| GET | `/api/pipelines` | 获取所有管线 |
| POST | `/api/pipelines` | 创建管线 |
| GET | `/api/pipelines/{id}` | 获取管线详情 |

### 10.2 拓扑管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/topology/graph` | 获取拓扑全景数据 |
| GET | `/api/topology/editor-data` | 获取编辑器数据 |
| POST | `/api/topology/connection` | 创建连接 |
| DELETE | `/api/topology/connection/{id}` | 删除连接 |
| GET | `/api/topology/validate` | 验证拓扑合法性 |
| GET | `/api/topology/suggestions/{id}` | 获取连接建议 |
| POST | `/api/topology/compute-centrality` | 计算中心性 |
| POST | `/api/topology/analyze-hubs` | 分析枢纽节点 |

### 10.3 应急指挥 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/emergency/simulate` | 断流仿真推演 |
| GET | `/api/emergency/impact/{pipeline_id}` | 影响范围分析 |
| GET | `/api/emergency/alternative-routes` | 备用路径查询 |
| POST | `/api/emergency/calculate-linepack` | 计算管存 |

### 10.4 AI 助手 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/assistant/chat` | 对话接口 |
| POST | `/api/assistant/query` | 知识库查询 |
| GET | `/api/assistant/history` | 获取历史记录 |

### 10.5 工作流 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/workflows` | 获取工作流列表 |
| POST | `/api/workflows` | 创建工作流 |
| GET | `/api/workflows/{id}` | 获取工作流详情 |
| POST | `/api/workflows/{id}/execute` | 执行工作流 |
| GET | `/api/workflows/{id}/executions` | 获取执行历史 |

---

## 十一、核心亮点

### 11.1 技术创新

| 亮点 | 说明 |
|------|------|
| **物理准确性** | 基于 Papay 压缩因子和真实气体状态方程，非简化模型 |
| **性能优化** | 3000+ 节点流畅渲染，智能分层过滤避免视觉混乱 |
| **零依赖可视化** | 纯 Canvas 实现拓扑图，无第三方图表库负担 |
| **AI 深度融合** | RAG 知识库 + 工作流编排 + 多智能体协作 |
| **模块化设计** | 各层解耦，易于扩展和维护 |

### 11.2 业务价值

| 价值点 | 效果 |
|--------|------|
| **响应速度** | 应急预案查询从分钟级降至秒级 |
| **决策效率** | 排产方案编制从小时级降至分钟级 |
| **风险预警** | 从被动响应转向主动预测 |
| **知识传承** | 专家经验数字化，降低人员依赖 |

---

## 十二、开发路线图

| 阶段 | 功能 | 状态 |
|------|------|------|
| **Phase 1** | 基础数据管理 + 拓扑可视化 | ✅ 已完成 |
| **Phase 2** | 物理仿真引擎 + 拓扑验证 | ✅ 已完成 |
| **Phase 3** | AI 助手 + RAG 知识库 | 🔄 进行中 |
| **Phase 4** | 工作流引擎 + 智能编排 | 🔄 进行中 |
| **Phase 5** | 实时数据接入 + 预测分析 | 📋 规划中 |

---

## 十三、相关文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 数学公式 | `MATHEMATICAL_FORMULAS.md` | 物理仿真公式详解 |
| 架构设计 | `architecture.md` | 系统架构详细设计 |
| 项目介绍 | `项目介绍.md` | 中文项目说明 |
| README | `README.md` | 快速开始指南 |
| Phase1 报告 | `PHASE1_REPORT.md` | 第一阶段优化报告 |
| Phase2 报告 | `PHASE2_DEEP_ANALYSIS_REPORT.md` | 第二阶段深度分析报告 |

---

**项目路径**: `f:\smartgas-grid`  
**后端入口**: `backend\app\main.py`  
**前端入口**: `src\App.tsx`  
**数据库**: `backend\data\smartgas.db`

---

> _构建人机协同的智能管网时代_ ⛽
