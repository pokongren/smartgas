---
name: pipeline-hierarchy-display
description: 天然气管网层级化显示方案，基于节点重要性LOD分层 + 偏移标记，保持地理真实性，避免强制散开破坏拓扑结构
---

# 天然气管网层级显示方案

针对天然气管网**链状/树状拓扑结构**，提供更合理的显示方案，替代蜂群散开算法。

> **核心原则**: 保持地理真实性 > 防重叠 > 美观

## 问题分析：为什么蜂群不适合

### 天然气管网的结构特点

```
气源站 ── 压气站 ── 压气站 ── 分输站 ── 阀室 ── 分输站
                │
                └──── 支线分输站 ── 阀室 ── 门站
```

1. **链状为主**: 干线像链条一样延伸，节点沿管线分布
2. **层级分明**: 压气站(关键) → 分输站(重要) → 阀室(一般)
3. **地理真实**: 节点位置对应实际地理位置，不能随意偏移

### 蜂群算法的问题

| 问题 | 说明 |
|-----|------|
| 破坏地理真实性 | 强制散开导致节点位置与实际不符 |
| 误导管线走向 | 用户看到的"散开"布局误以为管线分叉 |
| 不适用链状结构 | 蜂群适合密集点状分布，不适合线性分布 |

---

## 新方案：层级LOD + 偏移标记 (LOD-Offset)

### 核心设计

```
┌─────────────────────────────────────────────────────────────┐
│                    层级LOD + 偏移标记                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 层级LOD (Level of Detail)                               │
│     根据缩放级别显示不同重要性的节点                          │
│                                                             │
│     zoom < 6  : 只显示气源站 + 主要压气站                    │
│     zoom 6-10 : 显示所有压气站                              │
│     zoom 10-14: 显示压气站 + 分输站                         │
│     zoom > 14 : 显示所有节点(含阀室)                        │
│                                                             │
│  2. 偏移标记 (Callout/Spiderifier)                          │
│     同一位置多个设施时使用带引线的标记                        │
│     保持真实坐标，标记偏移显示                                │
│                                                             │
│  3. 迷你图模式 (Mini-Map Mode)                              │
│     极低缩放级别下显示管线缩略图                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 详细设计

### 1. 节点重要性分级

```typescript
// 节点重要性枚举
enum NodeImportance {
    CRITICAL = 1,    // 气源站、关键压气站
    HIGH = 2,        // 一般压气站
    MEDIUM = 3,      // 分输站
    LOW = 4,         // 阀室
    HIDDEN = 5       // 虚拟节点、备用设施
}

// 节点类型映射
const IMPORTANCE_MAP: Record<string, NodeImportance> = {
    'source': NodeImportance.CRITICAL,      // 气源站
    'compressor': NodeImportance.HIGH,      // 压气站
    'distribution': NodeImportance.MEDIUM,  // 分输站
    'valve': NodeImportance.LOW,            // 阀室
    'gate': NodeImportance.MEDIUM,          // 门站
}
```

### 2. LOD显示规则

```typescript
interface LODRule {
    minZoom: number;
    maxZoom: number;
    maxImportance: NodeImportance;  // 显示该重要性及更高的节点
    showPipelines: boolean;         // 是否显示管线
    pipelineStyle: 'thin' | 'normal' | 'thick';
}

const LOD_RULES: LODRule[] = [
    // 国家级视角：只看气源和主干
    { minZoom: 0, maxZoom: 6, maxImportance: NodeImportance.CRITICAL, showPipelines: true, pipelineStyle: 'thin' },
    
    // 区域级视角：显示所有压气站
    { minZoom: 6, maxZoom: 10, maxImportance: NodeImportance.HIGH, showPipelines: true, pipelineStyle: 'normal' },
    
    // 省级视角：显示压气站+分输站
    { minZoom: 10, maxZoom: 14, maxImportance: NodeImportance.MEDIUM, showPipelines: true, pipelineStyle: 'thick' },
    
    // 市级视角：显示所有设施
    { minZoom: 14, maxZoom: 20, maxImportance: NodeImportance.LOW, showPipelines: true, pipelineStyle: 'thick' },
]
```

### 3. 偏移标记 (Offset Marker)

当多个节点在**像素级别**重叠时使用：

```typescript
interface OffsetMarkerConfig {
    triggerDistance: number;    // 触发偏移的像素距离 (默认: 20px)
    offsetRadius: number;       // 偏移半径 (默认: 40px)
    maxOffsetNodes: number;     // 最大偏移节点数 (默认: 8个)
    lineColor: string;          // 引线颜色
    lineWidth: number;          // 引线宽度
}

// 偏移布局算法 (圆形均匀分布)
function calculateOffsetPositions(
    nodes: Node[], 
    center: Coordinate,
    config: OffsetMarkerConfig
): OffsetPosition[] {
    const count = Math.min(nodes.length, config.maxOffsetNodes);
    const angleStep = (2 * Math.PI) / count;
    
    return nodes.map((node, index) => {
        const angle = index * angleStep - Math.PI / 2;  // 从12点方向开始
        const x = center.lng + config.offsetRadius * Math.cos(angle) * pixelToLng;
        const y = center.lat + config.offsetRadius * Math.sin(angle) * pixelToLat;
        
        return {
            node,
            displayPosition: { lng: x, lat: y },  // 标记显示位置
            actualPosition: center,                // 真实位置(引线指向)
            angle,
            lineEnd: center
        };
    });
}
```

**视觉样式**:

```
        ┌───┐
        │ A │ ← 偏移显示的标记
        └───┘
          \
           \  引线
            \
      ┌───┐  •  ← 真实位置(中心点)
      │ B │
      └───┘
```

### 4. 聚合与偏移的决策逻辑

```typescript
function decideDisplayStrategy(nodes: Node[]): DisplayStrategy {
    const uniqueCoords = countUniqueCoordinates(nodes);
    
    // 情况1: 所有节点都在不同位置 → 直接显示
    if (uniqueCoords === nodes.length) {
        return { type: 'DIRECT' };
    }
    
    // 情况2: 多个节点共享坐标，但总数较少 → 偏移标记
    if (nodes.length <= 8) {
        return { 
            type: 'OFFSET', 
            groups: groupByCoordinate(nodes) 
        };
    }
    
    // 情况3: 大量节点密集 → 聚合标记 + 点击展开
    return { 
        type: 'CLUSTER', 
        count: nodes.length,
        onClick: 'EXPAND_PANEL'
    };
}
```

---

## 使用示例

### 示例1: 干线压气站（正常情况）

```
压气站A ────── 压气站B ────── 压气站C
  ↓               ↓               ↓
直接显示        直接显示        直接显示
（位置不同，无需偏移）
```

### 示例2: 干线与支线交汇（中卫压气站场景）

```
              ┌─ 中卫压气站 (干线)
              │
中卫门站 ─────┼─ 中卫分输站 (支线入口)
              │
              └─ #1阀室

实际坐标: 都在 (105.18, 37.51) 附近

显示方案:
1. zoom < 10: 只显示聚合标记 "3"
2. zoom >= 10: 偏移标记模式
        
        ┌─压气站┐
           \    
            \   
             ●  ← 真实位置
            /   
           /    
    ┌─分输站┐  ┌─阀室┐
```

### 示例3: 多阀室密集区域

```
#1阀室 ── 10km ── #2阀室 ── 10km ── #3阀室

zoom < 14: 不显示阀室
zoom >= 14: 显示阀室标记

如果 #2阀室 和 某分输站 坐标重合:
→ 使用偏移标记，引线指向真实位置
```

---

## 配置参数

```typescript
const HIERARCHY_CONFIG = {
    // LOD 层级配置
    lod: {
        criticalZoom: 6,    // 关键节点显示级别
        highZoom: 10,       // 重要节点显示级别
        mediumZoom: 14,     // 一般节点显示级别
        allZoom: 16,        // 全部显示级别
    },
    
    // 偏移标记配置
    offset: {
        triggerDistance: 20,    // 像素
        offsetRadius: 40,       // 像素
        maxNodes: 8,
        lineColor: '#666',
        lineWidth: 1,
        animate: true,          // 展开动画
    },
    
    // 聚合配置
    cluster: {
        minNodes: 9,            // 超过此数量才聚合
        maxZoom: 14,            // 超过此级别不聚合
        showCount: true,
    }
};
```

---

## 与蜂群方案的对比

| 特性 | 蜂群方案 | 层级LOD+偏移 |
|-----|---------|-------------|
| 地理真实性 | ❌ 破坏 | ✅ 保持 |
| 拓扑保持 | ❌ 不保持 | ✅ 保持 |
| 性能 | ⚠️ 需实时计算 | ✅ 简单规则判断 |
| 用户理解 | ⚠️ 需学习 | ✅ 直观 |
| 适合链状结构 | ❌ 不适合 | ✅ 适合 |
| 适合密集点 | ✅ 适合 | ⚠️ 需聚合辅助 |

---

## 实现清单

### 前端组件

```typescript
// 1. 层级渲染器
src/utils/hierarchyRenderer.ts
- filterNodesByZoom(nodes, zoom): 根据缩放级别过滤节点
- calculateOffsetPositions(nodes, center): 计算偏移位置
- renderWithOffset(map, offsetGroups): 渲染偏移标记

// 2. 偏移标记组件
src/components/OffsetMarker.tsx
- 带引线的标记
- 点击展开详情
- 悬停高亮

// 3. LOD控制器
src/hooks/useLOD.ts
- 监听地图缩放
- 返回当前应显示的节点
```

### 使用方式

```tsx
import { renderHierarchyNodes } from '@/utils/hierarchyRenderer'

// 在地图组件中
const overlays = renderHierarchyNodes({
    map,
    nodes: allStations,
    zoom: currentZoom,
    config: HIERARCHY_CONFIG,
    onNodeClick: handleNodeClick,
    onClusterClick: handleClusterClick
})
```

---

## 适用场景

### ✅ 适合使用此方案

- 长输天然气管网（干线+支线）
- 节点沿管线线性分布
- 需要保持地理真实性
- 节点重要性分层明显

### ❌ 不适合（仍用蜂群）

- 城市燃气管网（密集网状）
- 储气库群（密集点状分布）
- LNG接收站集群
