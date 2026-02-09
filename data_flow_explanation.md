# 管线数据流向解析 (Data Flow)

本文档解释了数据如何从后端数据库一步步转化为前端地图上的可视化图形。

## 整体流程图 (Process Overview)

```mermaid
graph TD
    %% 阶段 1: 数据源
    subgraph Stage1_Backend [阶段 1: 后端数据处理]
        DB[(SmartGas DB)] -->|SQL 查询| Script[提取脚本]
        Script -->|生成| JSON[结构化 JSON]
        style DB fill:#e1f5fe,stroke:#01579b
        style Script fill:#fff9c4,stroke:#fbc02d
        style JSON fill:#e1f5fe,stroke:#0277bd
    end

    %% 阶段 2: 前端数据层
    subgraph Stage2_Frontend_Data [阶段 2: 前端数据层]
        JSON -->|导入| TS_Raw[原始数据定义]
        TS_Raw -->|补充| Coords[坐标/颜色配置]
        Coords -->|生成| Standard_Adapter[数据适配器]
        
        style TS_Raw fill:#e8f5e9,stroke:#2e7d32
        style Coords fill:#f3e5f5,stroke:#7b1fa2
        style Standard_Adapter fill:#fff3e0,stroke:#e65100
    end

    %% 阶段 3: 视图渲染
    subgraph Stage3_Rendering [阶段 3: 视图渲染]
        Standard_Adapter -->|聚合| All_Pipelines[数据总索引]
        All_Pipelines -->|读取| View[GlobalPipelineView]
        View -->|转换| MapData[地图数据结构]
        MapData -->|绘制| Map_Engine[Mapbox/地图引擎]
        
        style All_Pipelines fill:#fff3e0,stroke:#ef6c00
        style View fill:#ffebee,stroke:#c62828
        style MapEngine fill:#e0f7fa,stroke:#006064
    end

    Script -.->|extract_trunk_and_branches.py| JSON
    TS_Raw -.->|src/data/*.ts| TS_Raw
    Standard_Adapter -.->|src/data/pipelines/*.ts| Standard_Adapter
    View -.->|src/views/GlobalPipelineView.tsx| View
```

---

## 详细步骤解析

### 1. 数据库 (Database)
- **来源**: `backend/data/smartgas.db`
- **内容**: 存储了所有管线节点、连接关系、里程值等原始数据。
- **表**: `node_relation_details`

### 2. 提取脚本 (Extraction Script)
- **工具**: `backend/scripts/extract_trunk_and_branches.py`
- **作用**: 
    1. 从数据库读取节点。
    2. 根据 `branch_name` 智能识别干线和支线。
    3. 按里程排序，构建拓扑结构。
- **输出**: `backend/data/we2_structure.json` (JSON 文件)

### 3. 数据定义 (.ts)
- **文件**: `src/data/westEast2Data.ts`
- **作用**: 
    1. 将 JSON 数据硬编码或导入为 TypeScript 数组。
    2. **关键步骤**: 手动补充缺失的经纬度坐标 (因为数据库里通常只有里程，没有坐标)。
    3. 定义管线颜色、粗细等样式。

### 4. 数据适配器 (Pipeline Adapter)
- **文件**: `src/data/pipelines/we2.ts` (标准化重构后的核心)
- **作用**: 将上述原始数据转换为系统统一的 `PipelinePackage` 格式。
    - 无论原始数据长什么样（数组、对象、图形），在这里都被“清洗”成标准格式。

### 5. 视图组件 (View Component)
- **文件**: `src/views/GlobalPipelineView.tsx`
- **作用**: 
    1. 从 `src/data/pipelines/index.ts`读取所有已注册的管线包。
    2. 根据用户的交互（勾选/折叠），动态筛选出需要显示的数据。
    3. 将筛选后的数据传递给地图组件。

### 6. 地图渲染 (Map Rendering)
- **组件**: `MapView` -> `SimpleMap`
- **作用**: 
    - 接收点 (Nodes) 和线 (Lines) 数据。
    - 调用底层地图库（如 Mapbox GL JS 或类似的 Canvas 绘图引擎）在屏幕上画出图形。
    - 处理缩放、平移等交互。
