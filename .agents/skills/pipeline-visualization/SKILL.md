---
name: pipeline-visualization
description: 从数据库提取管线数据并生成前端可视化,包含压气站、分输站和均匀分布的阀室,支持梯形图标、流向指示和分层显示,支持干线与支线同时绘制
---

# 管道可视化生成器

这个 skill 用于从 SmartGas 数据库中提取管线数据,生成包含所有设施的前端可视化。

> **数据源**: `backend/data/smartgas.db` 数据库中的 `node_relation_details` 表

## 设计说明

### 为什么需要先提取拓扑？

原始数据库中的管线数据存在以下问题：
1. **干线和支线混在同一 `trunk_name` 下** - 如"中缅线"包含1条干线+7条支线
2. **里程可能重置** - 每条支线的里程都从0开始
3. **简单按里程排序会导致错误** - 支线节点会插入到干线中间

**解决方案**：使用 `branch_name` 字段区分：
- `branch_name` 包含 **"干线"** → 归类为 **干线**
- 其他 → 归类为 **支线**

### 阀室生成策略

1. 主要站场（压气站、分输站）使用**真实坐标**
2. 阀室使用**均匀分布生成**策略（虚拟阀室）
3. 阀室坐标通过主要站场间的**线性插值**计算得出

---

## 快速开始清单

使用此 skill 为新管线创建可视化时,按顺序执行:

- [ ] **Step 0 (必须)**: 运行拓扑提取,分离干线和支线
- [ ] **Step 1**: 为主要站场查找百度地图坐标
- [ ] **Step 2**: 创建 `src/data/{pipeline}Data.ts` 数据文件
- [ ] **Step 3**: 创建 `src/views/{Pipeline}View.tsx` 视图组件
- [ ] **Step 4**: 在 `src/App.tsx` 添加路由和导航按钮
- [ ] **Step 5**: 在 `src/utils/mapRenderer.ts` 添加管线颜色

---

## Step 0: 提取拓扑结构 (干线+支线分离)

这是**关键的第一步**。必须先分离干线和支线，才能正确生成可视化。

### 使用命令

```bash
# 方式 1: Slash Command (推荐)
/extract-branches

# 方式 2: 直接运行脚本
python backend/scripts/extract_trunk_and_branches.py "西气东输二线" --out "backend/data/pipeline_structure.json"
```

### 输出结果

脚本会生成 JSON 文件，结构如下：

```json
{
  "pipeline_name": "西气东输二线",
  "trunk": [
    { "id": 392, "name": "霍尔果斯压气站", "mileage": 0.0, "type": "compressor", "branch_name": "西二线干线新疆段" }
  ],
  "branches": [
    [
      { "id": 601, "name": "嘉峪关压气站", "mileage": 0.0, "type": "compressor", "branch_name": "嘉峪关支线" }
    ]
  ],
  "branch_names": ["独石化支线", "嘉峪关支线", ...]
}
```

---

## Step 1: 查找并录入主要设施坐标

为 Step 0 提取出的每个主要站场（压气站、分输站）查找经纬度。

### 查找方法
使用 WebSearch 工具或百度地图搜索：
- 搜索词: "{站名} 经纬度" 或 "{站名所在城市} 坐标"
- 示例: "霍尔果斯压气站 经纬度" → 经度 80.41, 纬度 44.21

### 坐标录入位置

```typescript
const COORDS: Record<string, { lng: number; lat: number }> = {
    '霍尔果斯压气站': { lng: 80.41, lat: 44.21 },
    '精河压气站': { lng: 82.89, lat: 44.60 },
    // ... 所有压气站和分输站
}
```

---

## Step 2: 创建数据文件 (干线+支线)

创建 `src/data/{pipeline}Data.ts`，包含干线和所有支线的数据定义。

### 关键代码结构

```typescript
/**
 * {管线名称}可视化数据
 * 包含: 干线 + N条支线
 */

// 坐标数据
const COORDS: Record<string, { lng: number; lat: number }> = { /* Step 1 的坐标 */ }

// 干线节点数据 (从 Step 0 的 JSON 提取)
const TRUNK_NODES = [
    { name: '霍尔果斯压气站', mileage: 0.0, type: 'compressor' },
    // ...
] as const

// 支线1节点数据
const BRANCH_1_NODES = [
    { name: '嘉峪关压气站', mileage: 0.0, type: 'compressor' },
    { name: '嘉峪关门站', mileage: 15.14, type: 'distribution' },
] as const

// 生成站点和管道段
export const trunkStations = generateStations(TRUNK_NODES, '干线', 'TRUNK', 40)
export const trunkPipelines = generatePipelines(trunkStations, '干线', 'TRUNK', '#2196f3')

export const branch1Stations = generateStations(BRANCH_1_NODES, '支线1', 'BRANCH1', 20)
export const branch1Pipelines = generatePipelines(branch1Stations, '支线1', 'BRANCH1', '#64b5f6')

// 合并导出
export const allStations = [...trunkStations, ...branch1Stations]
export const allPipelines = [...trunkPipelines, ...branch1Pipelines]
```

### 颜色配置

干线和支线使用不同颜色区分：

```typescript
'西二线干线': '#2196f3',  // 蓝色 (干线)
'西二线支线': '#64b5f6',  // 浅蓝色 (支线)
```

---

## Step 3-5: 视图与路由

创建视图组件、添加路由和颜色配置，参考现有的 `MultiLineView.tsx` 和 `multiPipelineData.ts`。

---

## 完整工作流示例

以"西气东输二线"为例：

```bash
# 1. 提取拓扑
python backend/scripts/extract_trunk_and_branches.py "西气东输二线" --out backend/data/we2_structure.json

# 2. 生成 TypeScript 数据 (使用现有脚本)
python backend/scripts/generate_we2_data.py

# 3. 查看结果
# 文件: src/data/westEast2Data.ts
```

---

## 阀室配置

通过 `valveInterval` 参数控制阀室密度：

| 管线类型 | 阀室间隔 |
|---------|---------|
| 干线 | 35-40 km |
| 支线 | 15-20 km |

---

## 渲染样式

在 `mapRenderer.ts` 中：
- **干线**: 蓝色, 线宽 3px
- **支线**: 浅蓝色, 线宽 2px
- **阀室**: 小圆形, 灰色, 在低缩放级别下自动隐藏
