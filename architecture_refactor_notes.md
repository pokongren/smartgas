# 管线可视化系统架构重构说明 (Refactoring Overview)

## 1. 重构背景与痛点

在重构之前，系统存在以下主要问题：

- **数据源混乱**：西二线、中缅线、西四线的数据分散在不同文件，格式各异（有的含坐标插值、有的纯 ID 列表）。
- **逻辑硬编码**：`GlobalPipelineView` 必须针对每一种管线写特定的 `if-else` 处理逻辑，导致代码难以维护。
- **扩展性差**：每当需要新增一条管线，必须修改核心视图组件，容易破坏现有功能。

## 2. 新架构设计：标准化插件模式

本次重构采用了 **"标准化插件" (Standardized Plugin)** 模式。

### 核心目录结构

```text
src/data/pipelines/          <-- [新增] 统一的数据层
├── types.ts                 <-- [标准] 定义唯一的接口规范
├── index.ts                 <-- [注册表] 统一对外导出
├── we2.ts                   <-- [插件] 西二线数据适配器
├── zhongmian.ts             <-- [插件] 中缅线数据适配器
└── others.ts                <-- [插件] 其他管线适配器
```

### 核心接口 (PipelinePackage)

所有管线现在都必须实现同一个接口 `PipelinePackage`：

```typescript
export interface PipelinePackage {
    id: string              // 唯一标识 (如 'we2')
    name: string            // 显示名称 (如 "西气东输二线")
    color: string           // 主题色
    layers: PipelineLayer[] // 包含的图层 (干线 + N条支线)
}
```

## 3. Before vs After 代码对比

### 视图组件逻辑 (`GlobalPipelineView.tsx`)

**🔴 重构前 (硬编码)**：
```typescript
//以此类推，需要手动合并各种不同来源的数据
const we2Stations = allWE2Stations.filter(...)
const multiStations = allMultiStations.filter(...)
// 特殊处理西四线逻辑
const line4Stations = showWe4 ? line4Stations : []

// 需要分别为每种数据写转换逻辑
const nodes = [
    ...we2Stations.map(s => ({ ... })),       // 逻辑 A
    ...multiStations.map(s => ({ ... })),     // 逻辑 B
    ...line4Stations.map(s => ({ ... })),     // 逻辑 C
]
```

**🟢 重构后 (通用化)**：
```typescript
// 只需要一行遍历，无论有多少条管线逻辑都一样
ALL_PIPELINES.forEach(pkg => {
    pkg.layers.forEach(layer => {
        if (visibleLayers[layer.name]) {
            allNodes.push(...layer.nodes)  // 直接使用标准节点
            allLines.push(...layer.lines)  // 直接使用标准线路
        }
    })
})
```

## 4. 如何扩展：添加新管线指南

有了新架构，添加一条新管线（例如“川气东送”）不再需要修改视图代码，只需三步：

1.  **准备数据**：在 `src/data/pipelines/` 下创建 `chuanqi.ts`，按照 `PipelinePackage` 接口格式化数据。
2.  **注册管线**：打开 `src/data/pipelines/index.ts`，引入并将新包加入 `ALL_PIPELINES` 数组。
3.  **完成**：刷新页面，新管线会自动出现在目录和地图中，无需编写任何 React 代码。

## 5. 总结

本次重构将**业务逻辑（数据）**与**展示逻辑（视图）**完全解耦。

*   **视图层** (`GlobalPipelineView`) 变成了通用的播放器。
*   **数据层** (`pipelines/*.ts`) 变成了标准的媒体文件。

这种结构极大地提升了系统的可维护性和可扩展性，为未来集成更多管线打下了坚实基础。
