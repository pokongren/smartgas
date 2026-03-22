# SmartGas 管线数据结构文档

## 数据流向

```
SQLite 数据库 ──→ 后端 API ──→ 前端数据层 ──→ 视图组件 ──→ 地图/拓扑渲染
(3 张核心表)    (2 套 API)   (index.ts)     (4 个视图)
```

---

## 一、数据库层

### 1.1 `pipeline_systems` — 管线系统表

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `id` | VARCHAR PK | 系统标识 | `we1` |
| `name` | VARCHAR | 显示名称 | `西气东输一线` |
| `color` | VARCHAR | 主题色 | `#FF5722` |
| `layers_config` | JSON | 图层配置 | 见下方 |
| `sort_order` | INT | 排序 | `1` |

**`layers_config` 示例：**
```json
[
  { "id_prefix": "WE1",    "name": "西一线干线", "type": "trunk",  "visible": true },
  { "id_prefix": "WE1-B1", "name": "煤化工支线", "type": "branch", "visible": false }
]
```

### 1.2 `stations` — 站场表

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `id` | VARCHAR PK | 站场 ID | `WE1-1` |
| `name` | VARCHAR | 站场名称 | `轮南压气站` |
| `type` | VARCHAR | 类型 | `compressor / distribution / valve / other` |
| `longitude` | FLOAT | 经度 | `84.25` |
| `latitude` | FLOAT | 纬度 | `41.78` |
| `design_pressure` | FLOAT | 设计压力 | `10.0` |
| `operating_pressure_in/out` | FLOAT | 运行压力 | |
| `operating_temp_in/out` | FLOAT | 运行温度 | |
| `capacity` | FLOAT | 容量 | |

**站场 ID 命名规则：**
- 干线：`{系统}-{序号}`，如 `WE1-1`, `WE1-2`
- 支线：`{系统}-B{支线号}-{序号}`，如 `WE1-B1-182`

### 1.3 `pipelines` — 管段表

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `id` | VARCHAR PK | 管段 ID | `WE1-T-1` |
| `name` | VARCHAR | 名称 | `西一线干线-段1` |
| `start_station_id` | VARCHAR FK | 起点站场 | `WE1-1` |
| `end_station_id` | VARCHAR FK | 终点站场 | `WE1-2` |
| `diameter` / `diameter_mm` | FLOAT | 管径 (mm) | `1016` |
| `length` / `length_km` | FLOAT | 长度 | |
| `category` | VARCHAR | 所属管线 | `西一线` |

### 1.4 数据量统计

| 指标 | 数量 |
|------|------|
| 管线系统 | **9** 个 |
| 站场总数 | **1122** 个 |
| 管段总数 | **1124** 条 |

---

## 二、后端 API 层

### 2.1 管线数据包 API — `GET /api/pipeline-packages`

**用途：** 地图视图（GIS 渲染），按管线系统 → 图层分组

```typescript
// 返回类型: PipelinePackage[]
[
  {
    id: "we1",                        // 管线系统 ID
    name: "西气东输一线",               // 显示名称
    color: "#FF5722",                 // 主题色
    layers: [                         // 图层列表
      {
        name: "西一线干线",
        type: "trunk",                // trunk | branch
        visible: true,
        nodes: [                      // ← 来自 stations 表
          {
            id: "WE1-1",
            name: "轮南压气站",
            type: "regulator",        // 映射后的前端 NodeType
            coordinate: {             // ⚠️ 嵌套坐标对象
              longitude: 84.25,
              latitude: 41.78
            },
            pressureLevel: "high",
            status: "normal",
            properties: { pipeline: "西一线干线", rawType: "compressor" }
          }
        ],
        lines: [                      // ← 来自 pipelines 表
          {
            id: "WE1-T-1",
            name: "西一线干线-段1",
            startNodeId: "WE1-1",     // ⚠️ 字段名: startNodeId
            endNodeId: "WE1-2",
            path: [                   // 路径坐标（两点直线）
              { longitude: 84.25, latitude: 41.78 },
              { longitude: 85.21, latitude: 41.75 }
            ],
            diameter: 1016,
            length: 96700,
            pressureLevel: "high",
            status: "normal"
          }
        ]
      }
    ]
  }
]
```

**后端类型映射：**

| 数据库 `type` | 前端 `NodeType` |
|--------------|-----------------|
| `compressor` | `regulator` |
| `distribution` | `metering` |
| `valve` | `valve` |
| 其他 | `junction` |

---

### 2.2 拓扑图 API — `GET /api/topology/graph`

**用途：** Canvas 力导向图（网络分析），扁平节点+边结构

```typescript
// 返回类型
{
  nodes: [                            // 全量站场（扁平）
    {
      id: "WE1-1",
      name: "轮南压气站",
      type: "compressor",            // ⚠️ 原始类型（未映射）
      longitude: 84.25,              // ⚠️ 直接字段（非嵌套）
      latitude: 41.78,
      designPressure: 10.0,
      capacity: null,
      hasConnection: true             // 是否有管段连接
    }
  ],

  edges: [                            // 全量管段（图论"边"）
    {
      id: "WE1-T-1",
      name: "西一线干线-段1",
      source: "WE1-1",               // ⚠️ 字段名: source/target
      target: "WE1-2",
      category: "西一线",
      diameterMm: 1016.0,
      lengthKm: 96.7
    }
  ],

  isolatedNodes: ["XX-123"],          // 孤立站场 ID 列表
  criticalNodes: ["WE1-1", "..."],    // 介数中心性 Top 5

  stats: {
    nodeCount: 1122,
    edgeCount: 1124,
    isolatedCount: 0,
    componentCount: 9                 // 连通分量数
  }
}
```

---

## 三、两套 API 对比

| | 管线数据 (`pipeline-packages`) | 拓扑数据 (`topology/graph`) |
|---|---|---|
| **用途** | 地图 GIS 渲染 | 力导向图 + 网络分析 |
| **结构** | 分组分层（Package → Layer） | 扁平（nodes + edges） |
| **坐标字段** | `node.coordinate.longitude` | `node.longitude` |
| **连接字段** | `line.startNodeId / endNodeId` | `edge.source / target` |
| **路径信息** | ✅ `line.path: Coordinate[]` | ❌ 无 |
| **类型映射** | ✅ 映射为前端枚举 | ❌ 返回原始后端类型 |
| **分析数据** | ❌ 无 | ✅ 关键节点/孤立节点/连通分量 |
| **前端视图** | `GlobalPipelineView`, `MapTopologyView` | `TopologyView` |

---

## 四、前端数据层

### 4.1 类型定义

```
src/components/map-view/types.ts
  └─ Coordinate { longitude, latitude }

src/types/pipeline.ts
  ├─ PipelineNode  { id, name, type, coordinate, pressureLevel, status, ... }
  ├─ PipelineLine  { id, startNodeId, endNodeId, path: Coordinate[], ... }
  └─ PipelineData  { nodes, lines, devices }

src/data/pipelines/types.ts
  ├─ PipelineLayer   { name, type, nodes, lines, visible? }
  └─ PipelinePackage { id, name, color, layers }
```

### 4.2 数据加载流程 (`src/data/pipelines/index.ts`)

```
loadAllPipelines()        ← 异步函数，带缓存
    │
    ├─ pipelinePackageAPI.getAll()     从后端 API 获取
    ├─ filterLayers()                  过滤图层（保留干线 + 白名单支线）
    ├─ deduplicateNodes()              跨管线共享站点去重
    ├─ _cachedPackages                 内存缓存（后续调用直接返回）
    └─ ALL_PIPELINES[]                 同步引用（向后兼容）
```

### 4.3 视图消费方式

| 视图组件 | 数据来源 | 说明 |
|---------|---------|------|
| `GlobalPipelineView` | `loadAllPipelines()` | 按 `visibleLayers` 过滤后传给 `MapView` |
| `TopologyView` | `/api/topology/graph` + `loadAllPipelines()` | 主数据走拓扑 API；`nodePackagesMap` 走管线 API |
| `MapTopologyView` | `loadAllPipelines()` | 用于地图拓扑编辑器 |
| `PipelineEditorOverlay` | 通过 props 接收 | 不直接加载数据 |

---

## 五、坐标系统

- **坐标系：** WGS84（高德地图 API 使用 GCJ-02，但存储时保持 WGS84）
- **坐标格式：** `{ longitude: number, latitude: number }`
- **阀室坐标：** 通过里程线性插值生成（非实测），目前已回填至数据库
- **有效范围：** 经度 70°~140°，纬度 15°~55°（中国境内）
