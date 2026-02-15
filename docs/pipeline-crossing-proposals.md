# 管线交叉节点描绘技术方案

## 当前问题分析

基于 `src/utils/mapRenderer.ts` 代码分析：
- 节点渲染使用原始坐标，多管线交汇时完全重叠
- 压气站（梯形）、分输站（圆形）、阀室（小圆点）在交叉点堆叠
- 没有节点去重和分层展示机制
- 点击事件在重叠元素上产生冲突

---

## 方案一：物理偏移分散（Spiral Offset）

**核心思路**：同一坐标的多节点按螺旋线向外偏移，形成"花瓣"状分布

**技术实现**：
```typescript
// 为每个节点计算偏移位置
function calculateOffsetPosition(
  baseCoord: {lng: number, lat: number},
  index: number,      // 节点在组内的序号
  total: number,      // 组内节点总数
  radius: number = 20 // 偏移半径（像素）
): {lng: number, lat: number} {
  const angle = (2 * Math.PI * index) / total
  const offsetX = radius * Math.cos(angle) // 像素转经纬度
  const offsetY = radius * Math.sin(angle)
  return lngLatPlusPixel(baseCoord, offsetX, offsetY)
}
```

**优点**：
- 实现简单，不依赖复杂数据结构
- 视觉直观，每个节点都可见
- 保持地理坐标的相对准确性

**缺点**：
- 密集区域可能与其他节点冲突
- 偏移导致节点不在真实管线上
- 缩放级别变化时需要重新计算

---

## 方案二：聚合节点+详情面板（Cluster Node）

**核心思路**：交叉点渲染为"聚合节点"，点击后展开详情面板显示所有管线信息

**技术实现**：
```typescript
// 数据结构
interface ClusterNode {
  id: string
  coordinate: Coordinate
  nodes: PipelineNode[]  // 聚合的节点列表
  lines: PipelineLine[]  // 关联的管线列表
  type: 'cluster'
}

// 渲染时
if (nodesAtSamePosition.length > 1) {
  renderClusterMarker(coordinate, nodesAtSamePosition)
} else {
  renderNormalNode(node)
}
```

**优点**：
- 界面简洁，减少视觉噪音
- 适合大屏监控场景
- 扩展性好，可展示丰富信息

**缺点**：
- 需要额外点击才能看到详情
- 聚合节点的视觉设计挑战
- 动画切换可能影响性能

---

## 方案三：分层渲染+动态显隐（Layered Rendering）

**核心思路**：按重要性分层，默认只显示主要节点，缩放或悬停时显示全部

**技术实现**：
```typescript
const LAYER_PRIORITY = {
  compressor: 1,    // 压气站 - 始终显示
  distribution: 2,  // 分输站 - 始终显示
  valve: 3          // 阀室 - 根据条件显示
}

function renderWithLayering(nodes: PipelineNode[], zoom: number) {
  // 按坐标分组
  const groups = groupByCoordinate(nodes)

  groups.forEach(group => {
    const sorted = group.sort((a, b) =>
      LAYER_PRIORITY[a.type] - LAYER_PRIORITY[b.type]
    )

    // 只渲染优先级最高的
    if (zoom < 10) {
      renderNode(sorted[0])
    } else {
      sorted.forEach((node, index) => {
        renderNodeWithOffset(node, index) // 小偏移避免完全重叠
      })
    }
  })
}
```

**优点**：
- 符合"渐进式披露"设计原则
- 不同缩放级别自动适配
- 用户认知负担小

**缺点**：
- 需要维护复杂的状态逻辑
- 阀室等次要节点可能被隐藏
- 层级规则需要业务确认

---

## 方案四：虚拟节点+连线指示（Virtual Node + Connector）

**核心思路**：交叉点只保留一个物理节点，其他管线通过"虚拟节点+连线"连接到实际位置

**技术实现**：
```typescript
interface VirtualNode {
  id: string
  virtualCoord: Coordinate  // 显示位置（偏移后）
  realCoord: Coordinate     // 真实位置
  lineId: string
  parentNodeId: string
}

// 渲染逻辑
renderRealNode(baseCoord)  // 中心节点
virtualNodes.forEach(vn => {
  renderVirtualNode(vn.virtualCoord)  // 偏移显示的虚拟节点
  renderConnector(vn.virtualCoord, baseCoord)  // 虚线连接
})
```

**优点**：
- 保持真实坐标的单一权威
- 虚拟节点位置灵活可控
- 连线清晰表达关联关系

**缺点**：
- 实现复杂度最高
- 连线过多时界面混乱
- 需要维护节点间的映射关系

---

## 方案对比表

| 维度 | 方案一：物理偏移 | 方案二：聚合节点 | 方案三：分层渲染 | 方案四：虚拟节点 |
|------|-----------------|-----------------|-----------------|-----------------|
| 实现复杂度 | 低 | 中 | 中 | 高 |
| 视觉清晰度 | 中 | 高 | 高 | 中 |
| 交互便捷性 | 中 | 中 | 高 | 低 |
| 性能开销 | 低 | 中 | 低 | 高 |
| 维护成本 | 低 | 中 | 中 | 高 |
| 适用场景 | 节点密度低 | 监控大屏 | 日常运维 | 精确分析 |

---

## 推荐组合方案

**主方案：方案三（分层渲染）+ 方案二（聚合详情）**

- 默认状态：分层渲染，只显示重要节点
- 悬停状态：显示该位置所有节点缩略信息
- 点击状态：展开详情面板，显示完整信息
- 高缩放级别：自动切换为物理偏移模式

这样既保证了界面的简洁性，又提供了详细的交互能力。
