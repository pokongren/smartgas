---
name: pipeline-master-system
description: 天然气管网全生命周期管理系统，整合数据提取、拓扑分析、坐标映射、可视化渲染的完整工作流，提供一站式管线管理解决方案
---

# 管道全生命周期管理系统 (Pipeline Master System)

这是 SmartGas 系统的**核心处理大脑**，负责将散乱的数据库记录转化为可视化的地图数据。整合数据提取、拓扑分析、坐标映射、可视化渲染的完整工作流。

> **设计理念**: 数据 → 提取 → 转换 → 渲染 → 可视化的完整闭环

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Pipeline Master System                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   提取层    │ →  │   转换层    │ →  │   渲染层    │     │
│  │ Extraction │    │Transformation│    │  Rendering  │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                  │                  │             │
│         ▼                  ▼                  ▼             │
│  • 拓扑提取器         • 地理坐标映射      • 智能聚合算法      │
│  • 干支线分离         • 节点排序算法      • 分层展开渲染      │
│  • 数据清洗           • 格式标准化        • 性能优化          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   前端可视化     │
                    │  React + 高德地图 │
                    └─────────────────┘
```

## 核心阶段

### 阶段一: 提取层 (Extraction Layer)

**目标**: 从原始数据库中提取结构化的管线拓扑

**核心问题**:
- 干线和支线数据混在同一 `trunk_name` 下
- 里程可能重置（每条支线从0开始）
- 简单按里程排序会导致错误（支线节点插入干线中间）

**解决方案**:

```python
# 使用 branch_name 字段区分干支线
if "干线" in branch_name:
    归类为干线
else:
    归类为支线（按 branch_name 分组）
```

**执行脚本**:
```bash
python backend/scripts/extract_trunk_and_branches.py "中缅线" --out backend/data/zhongmian_structure.json
```

**输出格式**:
```json
{
  "pipeline_name": "中缅线",
  "trunk": [
    { "id": 1, "name": "起点", "mileage": 0.0, "type": "compressor", "branch_name": "中缅干线" }
  ],
  "branches": [
    [
      { "id": 100, "name": "支线起点", "mileage": 0.0, "type": "distribution", "branch_name": "丽江支线" }
    ]
  ],
  "branch_names": ["丽江支线", "玉溪支线", "禄丰支线", "腾冲支线", "芒市支线", "临沧支线", "大理支线"]
}
```

### 阶段二: 转换层 (Transformation Layer)

**目标**: 将提取的拓扑数据转换为前端可用的地图数据

**核心任务**:
1. **地理坐标映射**: 为主要站场（压气站、分输站）查找经纬度
2. **节点排序**: 确保节点按正确地理顺序排列
3. **格式标准化**: 生成 TypeScript 数据文件

#### 任务 2.1: 查找并录入主要设施坐标

使用 WebSearch 或百度地图查找站场坐标：

| 设施类型 | 查找关键词 | 示例结果 |
|---------|-----------|---------|
| 压气站 | "{站名} 经纬度" | 霍尔果斯压气站: 80.41, 44.21 |
| 分输站 | "{站名所在城市} 坐标" | 独山子: 84.89, 44.32 |

坐标录入:
```typescript
const COORDS: Record<string, { lng: number; lat: number }> = {
    '霍尔果斯压气站': { lng: 80.41, lat: 44.21 },
    '精河压气站': { lng: 82.89, lat: 44.60 },
    // ... 所有主要站场
}
```

#### 任务 2.2: 创建 TypeScript 数据文件

生成 `src/data/{pipeline}Data.ts`:

```typescript
/**
 * 中缅线可视化数据
 * 包含: 1条干线 + 7条支线
 */

// 坐标数据
const COORDS: Record<string, { lng: number; lat: number }> = {
    '瑞丽首站': { lng: 97.85, lat: 24.02 },
    '保山分输站': { lng: 99.18, lat: 25.12 },
    // ...
}

// 干线节点数据
const TRUNK_NODES = [
    { name: '瑞丽首站', mileage: 0.0, type: 'compressor' },
    { name: '保山分输站', mileage: 167.54, type: 'distribution' },
    // ...
] as const

// 支线节点数据
const BRANCH_1_NODES = [
    { name: '丽江分输站', mileage: 0.0, type: 'distribution' },
    { name: '丽江门站', mileage: 15.14, type: 'distribution' },
] as const

// 生成站点（含均匀分布的虚拟阀室）
export const trunkStations = generateStations(TRUNK_NODES, '干线', 'TRUNK', 40)
export const trunkPipelines = generatePipelines(trunkStations, '干线', 'TRUNK', '#4caf50')

// 合并导出
export const allStations = [...trunkStations, ...branch1Stations, ...]
export const allPipelines = [...trunkPipelines, ...branch1Pipelines, ...]
```

### 阶段三: 渲染层 (Rendering Layer)

**目标**: 在高德地图上高效渲染管线数据

**核心组件**:

#### 3.1 智能分层聚合算法

解决高密度站点的重叠显示问题：

```typescript
// 低缩放级别 (zoom < 12): 显示聚合标记
const clusterMarker = createClusterMarker(map, group, onClusterClick)

// 高缩放级别 (zoom >= 12): 自动展开分散布局
const positions = calculateOptimalSwarmLayout(nodes, centerCoord, zoom)
```

算法选择策略:
| 节点数 | 算法 | 说明 |
|-------|------|------|
| 1-3 | 同心圆布局 | 简单快速 |
| 4-15 | 蜂群扫描线 | 防重叠效果好 |
| 16+ | 力导向布局 | 处理复杂密集场景 |

#### 3.2 性能优化渲染

```typescript
// 分批渲染，避免阻塞主线程
const BATCH_SIZE = 50
function renderBatch() {
    for (let i = index; i < batchEnd; i++) {
        // 渲染一条管线
    }
    if (index < lines.length) {
        requestAnimationFrame(renderBatch)
    }
}
```

#### 3.3 阀室动态显示

```typescript
// 根据缩放级别控制阀室显示
if (isValveRoom(node.name) && currentZoom < CLUSTER_CONFIG.VALVE_MIN_ZOOM) {
    continue // 跳过渲染
}
```

## 完整工作流

为一条新管线创建可视化的完整步骤：

```bash
# Step 0: 提取拓扑结构（必须）
python backend/scripts/extract_trunk_and_branches.py "西气东输二线" --out backend/data/we2_structure.json

# Step 1: 查找主要站场坐标（人工+WebSearch）
# 使用 WebSearch 搜索每个压气站、分输站的经纬度

# Step 2: 创建数据文件
# 创建 src/data/westEast2Data.ts，录入坐标和节点数据

# Step 3: 创建视图组件
# 创建 src/views/WestEast2View.tsx

# Step 4: 添加路由和导航
# 在 src/App.tsx 添加路由和按钮

# Step 5: 配置管线颜色
# 在 src/utils/mapRenderer.ts 添加颜色映射
```

## 一站式设计指南

### 新管线接入流程

```
数据库原始数据
      ↓
[提取层] extract_trunk_and_branches.py
      ↓
拓扑结构 JSON
      ↓
[转换层] 人工录入坐标 + 生成 TypeScript
      ↓
前端数据文件 (Data.ts)
      ↓
[渲染层] MapView + 聚合算法
      ↓
可视化地图
```

### 快速接入模板

对于一条新管线，按此清单执行：

- [ ] **提取拓扑**
  ```bash
  python backend/scripts/extract_trunk_and_branches.py "管线名称"
  ```

- [ ] **录入坐标**
  - [ ] 列出所有压气站
  - [ ] 列出所有分输站
  - [ ] 搜索每个站场的经纬度
  - [ ] 录入 COORDS 对象

- [ ] **创建数据文件**
  - [ ] 复制模板文件
  - [ ] 修改 TRUNK_NODES
  - [ ] 修改 BRANCH_X_NODES
  - [ ] 调整阀室间隔参数

- [ ] **创建视图**
  - [ ] 复制现有视图组件
  - [ ] 修改导入的数据文件
  - [ ] 调整地图中心点和初始缩放

- [ ] **集成到系统**
  - [ ] 添加路由
  - [ ] 添加导航按钮
  - [ ] 配置颜色映射

## 扩展功能

### 1. 数据导入支持

支持通过 Excel/CSV 导入新的管线数据：

```typescript
// Excel 格式要求
{
  "管线名称": "中缅线",
  "节点名称": "瑞丽首站",
  "节点类型": "compressor",
  "经度": 97.85,
  "纬度": 24.02,
  "里程": 0.0,
  "干支线标识": "干线"
}
```

### 2. 自然语言查询

用户可以通过自然语言查询管线信息：

```
用户: "显示中缅线的所有压气站"
系统: 解析意图 → 查询数据 → 高亮显示
```

### 3. 动态数据更新

支持实时数据接入（压力、流量、状态）：

```typescript
// WebSocket 实时更新
ws.on('pressure-update', (data) => {
    updateNodePressure(data.nodeId, data.pressure)
})
```

## 相关文件

| 阶段 | 文件路径 | 说明 |
|-----|---------|------|
| 提取层 | `backend/scripts/extract_trunk_and_branches.py` | 拓扑提取脚本 |
| 提取层 | `backend/data/*.json` | 提取的拓扑数据 |
| 转换层 | `src/data/*Data.ts` | 前端数据定义 |
| 渲染层 | `src/utils/mapRenderer.ts` | 地图渲染工具 |
| 渲染层 | `src/utils/swarmAnalysis.ts` | 聚合布局算法 |
| 渲染层 | `src/components/ClusterDetailPanel.tsx` | 聚合详情面板 |
| 渲染层 | `src/components/map-view/MapView.tsx` | 地图主视图 |

## 架构设计原则

1. **数据驱动**: 所有可视化都基于结构化的数据文件
2. **分层解耦**: 提取、转换、渲染三层独立，便于维护扩展
3. **性能优先**: 分批渲染、缓存机制、懒加载
4. **交互友好**: 聚合展开、详情面板、动态查询
