---
name: pipeline-crossing-solution
description: 处理天然气管网中多条管线交汇点的复杂显示问题，提供螺旋展开、蜂群布局、分层聚合等算法，支持聚合标记和详情面板交互
---

# 管线交叉解决方案

这个 Skill 专注于解决天然气管网可视化中**多条管线交汇点**的显示问题。当多条管线的节点（压气站、分输站、阀室）在地理上非常接近或重合时，会产生重叠遮挡，此方案提供智能布局和交互解决方案。

> **核心问题**: 在同一坐标点可能存在压气站、分输站、阀室等多种设施，简单叠加会导致标记重叠、信息无法查看
> 
> **解决思路**: 聚合显示 + 分层展开 + 详情面板

## 核心功能

### 1. 智能聚合 (Smart Clustering)

按坐标精度对节点进行分组，同一位置的节点聚合为一个标记。

```typescript
// 聚合分组配置
const CLUSTER_CONFIG = {
    COORDINATE_PRECISION: 6,  // 坐标分组精度（小数位数）
    VALVE_MIN_ZOOM: 8,        // 阀室最小显示缩放级别
    EXPAND_CLUSTER_ZOOM: 12,  // 分散显示阈值
}
```

**聚合标记样式**:
- 🔵 蓝色 (1-5个节点)
- 🟠 橙色 (6-15个节点)  
- 🔴 红色 (16+个节点)

标记上显示节点类型指示器：
- **压** - 压气站
- **输** - 分输站
- **阀** - 阀室

### 2. 分散布局算法 (Swarm Layout)

当用户放大地图到指定级别(默认 zoom >= 12)，聚合的节点会自动分散展开。提供四种布局算法：

#### 算法一: 同心圆轨道布局 (Orbit Layout)
适合节点数较少的情况 (<= 3个)

```typescript
import { calculateOrbitLayout } from '@/utils/swarmAnalysis'

const positions = calculateOrbitLayout(nodes, centerCoord)
// 返回: 每个节点的偏移坐标、轨道层级、角度
```

**特点**:
- 节点均匀分布在同心圆上
- 每圈最多6个节点
- 计算速度快，适合实时渲染

#### 算法二: 蜂群扫描线布局 (Swarm Layout)
适合中等数量节点 (4-15个)

```typescript
import { calculateSwarmLayout } from '@/utils/swarmAnalysis'

const positions = calculateSwarmLayout(nodes, centerCoord, zoom)
```

**算法思路**:
1. 将所有节点按角度排序
2. 逐个尝试放置节点
3. 如果与已放置节点重叠，沿径向向外移动
4. 直到找到不重叠的位置或达到最大半径

#### 算法三: 力导向布局 (Force Layout)
适合大量节点 (>15个)

```typescript
import { calculateForceLayout } from '@/utils/swarmAnalysis'

const positions = calculateForceLayout(nodes, centerCoord, iterations)
// iterations: 迭代次数（默认30）
```

**算法思路**:
- 模拟物理斥力使节点相互排斥
- 向中心的引力防止节点飞散
- 通过多次迭代达到平衡状态

#### 算法四: 最优算法选择器 (Optimal)

```typescript
import { calculateOptimalSwarmLayout } from '@/utils/swarmAnalysis'

const positions = calculateOptimalSwarmLayout(nodes, centerCoord, zoom)
// 根据节点数量自动选择最佳算法
```

| 节点数量 | 推荐算法 |
|---------|---------|
| 1-3 | 同心圆轨道布局 |
| 4-15 | 蜂群扫描线布局 |
| 16+ | 力导向布局 |

### 3. 聚合详情面板 (Cluster Detail Panel)

点击聚合标记时弹出的详情面板，按节点类型分组展示。

**面板结构**:
```
┌─────────────────────────────┐
│  节点详情 (12个)         ✕  │
├─────────────────────────────┤
│ 🗜️ 压气站 (2)              │
│ ┌─────────────────────────┐ │
│ │ 霍尔果斯压气站    [正常] │ │
│ │ 精河压气站        [正常] │ │
│ └─────────────────────────┘ │
├─────────────────────────────┤
│ 🔶 分输站 (3)              │
│ ┌─────────────────────────┐ │
│ │ 独山子分输站      [正常] │ │
│ │ ...                     │ │
│ └─────────────────────────┘ │
├─────────────────────────────┤
│ ⭕ 阀室 (7)                │
│ ┌─────────────────────────┐ │
│ │ #1阀室            [正常] │ │
│ │ ...                     │ │
│ └─────────────────────────┘ │
├─────────────────────────────┤
│                    [关闭]   │
└─────────────────────────────┘
```

**使用方式**:

```tsx
import { ClusterDetailPanel } from '@/components/ClusterDetailPanel'

<ClusterDetailPanel
    cluster={selectedCluster}
    visible={panelVisible}
    onClose={() => setPanelVisible(false)}
    onNodeSelect={(node) => {
        // 点击某个节点后的操作
        map.setZoomAndCenter(15, [node.coordinate.longitude, node.coordinate.latitude])
    }}
/>
```

## 使用场景

### 场景一: 干线与支线交汇点

中缅干线与中缅支线在同一城市交汇，共享压气站和分输站。

```typescript
// 节点数据示例
const nodes = [
    { name: '瑞丽压气站', type: 'compressor', coordinate: { lng: 97.85, lat: 24.02 } },  // 中缅干线
    { name: '瑞丽门站', type: 'distribution', coordinate: { lng: 97.85, lat: 24.02 } },   // 中缅支线
    { name: '#1阀室', type: 'valve', coordinate: { lng: 97.85, lat: 24.02 } },           // 阀室
]

// 按坐标聚合后，这三个节点会在同一聚合组中
```

### 场景二: 多条干线交汇点

多条国家级管线在同一枢纽交汇，如西气东输、中缅线、中贵线在某中转站交汇。

```typescript
// 聚合后可能包含20+个节点
// 需要使用力导向算法进行分散布局
```

### 场景三: 密集阀室区域

在城市周边，阀室分布密集，多个阀室坐标非常接近。

```typescript
// 低缩放级别(zoom < 8)时阀室自动隐藏
// 中等缩放级别(8 <= zoom < 12)时显示聚合标记
// 高缩放级别(zoom >= 12)时展开显示
```

## 快速使用

### 在地图组件中启用聚合渲染

```tsx
import { renderPipelineNodesWithClustering } from '@/utils/mapRenderer'

// 渲染节点（自动处理聚合/展开）
const overlays = await renderPipelineNodesWithClustering(
    map,           // 高德地图实例
    nodes,         // 所有节点
    sourceNodes,   // 气源站ID列表
    compressorStations, // 压气站名称列表
    onNodeClick,   // 节点点击回调
    onClusterClick // 聚合标记点击回调
)
```

### 处理聚合点击事件

```tsx
const handleClusterClick = (event: ClusterClickEvent) => {
    setSelectedCluster(event.cluster)
    setPanelVisible(true)
}
```

## 配置参数

### 蜂群布局配置

```typescript
const SWARM_CONFIG = {
    NODE_RADIUS: 12,        // 节点半径（像素）
    NODE_PADDING: 4,        // 节点间距（像素）
    MAX_RADIUS: 150,        // 最大分散半径（像素）
    ORBIT_SEPARATION: 28,   // 轨道层间距（像素）
    MIN_ZOOM_FOR_SWARM: 10, // 最小分散缩放级别
}
```

### 聚合渲染配置

```typescript
const CLUSTER_CONFIG = {
    COORDINATE_PRECISION: 6,     // 坐标分组精度
    VALVE_MIN_ZOOM: 8,           // 阀室最小显示缩放级别
    EXPAND_CLUSTER_ZOOM: 12,     // 分散显示缩放级别阈值
    SPIRAL_RADIUS: 30,           // 螺旋偏移半径（像素）
    SPIRAL_SEPARATION: 25,       // 螺旋偏移间距（像素）
    MAX_CLUSTER_COUNT: 99,       // 聚合标记最大显示数量
}
```

## 性能优化

1. **坐标聚合缓存**: 相同节点集的聚合结果会被缓存，避免重复计算
2. **分批渲染**: 使用 `requestAnimationFrame` 分批渲染，避免阻塞主线程
3. **阀室懒加载**: 低缩放级别下阀室不渲染，减少覆盖物数量
4. **缩放级别自适应**: 根据当前缩放级别自动切换显示模式

## 相关文件

- `src/utils/swarmAnalysis.ts` - 蜂群布局算法
- `src/utils/mapRenderer.ts` - 地图渲染（含聚合逻辑）
- `src/components/ClusterDetailPanel.tsx` - 聚合详情面板
- `src/types/cluster.ts` - 聚合类型定义
