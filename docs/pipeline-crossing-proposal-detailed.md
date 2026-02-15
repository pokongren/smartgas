# 智慧燃气管网节点重叠问题解决方案提案

## 一、问题背景与现状分析

### 1.1 当前问题

在智慧燃气管网可视化系统中，多条管线交汇于同一地理位置时，节点（压气站、分输站、阀室）使用相同坐标渲染，导致完全重叠。具体问题包括：

1. **视觉重叠**：相同坐标的多个节点完全覆盖，用户无法区分
2. **交互冲突**：点击事件在重叠元素上产生冲突，难以选中目标节点
3. **信息丢失**：被覆盖的节点信息无法直接查看
4. **用户体验差**：操作困难，容易产生误操作

### 1.2 现有节点渲染逻辑

基于 `src/utils/mapRenderer.ts` 分析：

| 节点类型 | 视觉样式 | 尺寸 | zIndex | 特殊行为 |
|---------|---------|------|--------|---------|
| 压气站 | 梯形标记 | 大尺寸(30x24px) | 120 | 闪烁动画 |
| 分输站 | 圆形标记 | 中等(半径8px) | 110 | 金黄色 |
| 阀室 | 圆形标记 | 小尺寸(半径5px) | 100 | 缩放<8时隐藏 |

### 1.3 数据特点

- 节点数据来源于多个管线包（PipelinePackage）
- 不同管线的交汇点使用完全相同的经纬度坐标
- 节点类型通过名称关键字判断（如"压气站"、"分输站"、"阀室"）
- 存在层级关系：压气站 > 分输站 > 阀室

---

## 二、候选方案深度分析

### 2.1 方案一：物理偏移分散（Spiral Offset）

#### 核心思路
同一坐标的多节点按螺旋线向外偏移，形成"花瓣"状分布，每个节点都有独立的视觉空间。

#### 技术实现

```typescript
// src/utils/nodeClustering.ts

/**
 * 节点组数据结构
 */
interface NodeGroup {
    coordinate: string // "lng,lat" 作为分组键
    nodes: PipelineNode[]
    centerLng: number
    centerLat: number
}

/**
 * 偏移计算配置
 */
interface OffsetConfig {
    baseRadius: number      // 基础偏移半径（像素）
    radiusStep: number      // 每增加一个节点的半径增量
    maxOffset: number       // 最大偏移限制
}

const DEFAULT_OFFSET_CONFIG: OffsetConfig = {
    baseRadius: 15,     // 15像素基础半径
    radiusStep: 8,      // 每个节点增加8像素
    maxOffset: 50       // 最大50像素
}

/**
 * 将像素偏移转换为经纬度偏移
 */
function pixelToLngLat(
    lng: number,
    lat: number,
    pixelX: number,
    pixelY: number,
    zoom: number
): { lng: number; lat: number } {
    // 在高德地图中，zoom级别与像素/经纬度转换关系
    // 粗略估算：在zoom=10时，1度经度 ≈ 100像素（随纬度变化）
    const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom)
    const lngPerPixel = metersPerPixel / 111320 // 1度经度 ≈ 111.32km
    const latPerPixel = metersPerPixel / 110540 // 1度纬度 ≈ 110.54km

    return {
        lng: lng + pixelX * lngPerPixel,
        lat: lat + pixelY * latPerPixel
    }
}

/**
 * 计算螺旋偏移位置
 */
function calculateSpiralPosition(
    baseCoord: { lng: number; lat: number },
    index: number,
    total: number,
    zoom: number,
    config: OffsetConfig = DEFAULT_OFFSET_CONFIG
): { lng: number; lat: number } {
    // 黄金角分布，避免节点过于集中
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    const angle = index * goldenAngle

    // 半径随节点数增加
    const radius = Math.min(
        config.baseRadius + index * config.radiusStep,
        config.maxOffset
    )

    const pixelX = radius * Math.cos(angle)
    const pixelY = radius * Math.sin(angle)

    return pixelToLngLat(baseCoord.lng, baseCoord.lat, pixelX, pixelY, zoom)
}

/**
 * 按坐标对节点进行分组
 */
function groupNodesByCoordinate(nodes: PipelineNode[]): NodeGroup[] {
    const groups = new Map<string, PipelineNode[]>()

    nodes.forEach(node => {
        const key = `${node.coordinate.longitude.toFixed(6)},${node.coordinate.latitude.toFixed(6)}`
        if (!groups.has(key)) {
            groups.set(key, [])
        }
        groups.get(key)!.push(node)
    })

    return Array.from(groups.entries()).map(([key, groupNodes]) => {
        const [lng, lat] = key.split(',').map(Number)
        return {
            coordinate: key,
            nodes: groupNodes,
            centerLng: lng,
            centerLat: lat
        }
    })
}

/**
 * 主处理函数：为重叠节点计算偏移位置
 */
export function processNodeOffsets(
    nodes: PipelineNode[],
    zoom: number
): Array<{ node: PipelineNode; displayCoord: { lng: number; lat: number }; isOffset: boolean }> {
    const groups = groupNodesByCoordinate(nodes)
    const result: Array<{ node: PipelineNode; displayCoord: { lng: number; lat: number }; isOffset: boolean }> = []

    groups.forEach(group => {
        if (group.nodes.length === 1) {
            // 单个节点，无需偏移
            result.push({
                node: group.nodes[0],
                displayCoord: {
                    lng: group.centerLng,
                    lat: group.centerLat
                },
                isOffset: false
            })
        } else {
            // 多个节点，计算螺旋偏移
            group.nodes.forEach((node, index) => {
                const offsetCoord = calculateSpiralPosition(
                    { lng: group.centerLng, lat: group.centerLat },
                    index,
                    group.nodes.length,
                    zoom
                )
                result.push({
                    node,
                    displayCoord: offsetCoord,
                    isOffset: true
                })
            })
        }
    })

    return result
}
```

#### 优点
- 实现简单，算法复杂度 O(n)
- 每个节点都可见，无信息隐藏
- 保持相对位置的视觉直观性
- 支持动态调整偏移参数

#### 缺点
- 偏移导致节点不在真实管线上（视觉与数据不一致）
- 密集区域可能与其他节点冲突
- 缩放级别变化时需要重新计算
- 节点过多时形成"拥挤"效果

#### 适用场景
- 节点密度较低的区域
- 需要同时查看所有节点的场景
- 对地理精度要求不高的展示场景

---

### 2.2 方案二：聚合节点+详情面板（Cluster Node）

#### 核心思路
交叉点渲染为"聚合节点"，通过视觉标识表示此处有多条管线交汇，点击后展开详情面板显示所有节点信息。

#### 技术实现

```typescript
// src/utils/nodeClustering.ts

import type { PipelineNode, PipelineLine } from '@/types'

/**
 * 聚合节点数据结构
 */
export interface ClusterNode {
    id: string
    type: 'cluster'
    coordinate: {
        longitude: number
        latitude: number
    }
    nodes: PipelineNode[]           // 聚合的节点列表
    relatedLines: PipelineLine[]    // 关联的管线列表
    count: number                   // 节点数量
    priority: number                // 优先级（用于确定聚合节点样式）
}

/**
 * 节点优先级定义
 */
const NODE_PRIORITY: Record<string, number> = {
    'compressor': 3,    // 压气站 - 最高
    'distribution': 2,  // 分输站
    'valve': 1          // 阀室
}

/**
 * 判断节点类型优先级
 */
function getNodePriority(node: PipelineNode): number {
    const name = node.name.toLowerCase()
    if (name.includes('压气站')) return NODE_PRIORITY.compressor
    if (name.includes('分输站') || name.includes('门站') || name.includes('末站')) return NODE_PRIORITY.distribution
    return NODE_PRIORITY.valve
}

/**
 * 创建聚合节点
 */
function createClusterNode(
    coordinate: { longitude: number; latitude: number },
    nodes: PipelineNode[],
    lines: PipelineLine[]
): ClusterNode {
    // 按优先级排序，最高优先级的决定聚合节点样式
    const sortedNodes = [...nodes].sort((a, b) => getNodePriority(b) - getNodePriority(a))

    return {
        id: `cluster_${coordinate.longitude.toFixed(6)}_${coordinate.latitude.toFixed(6)}`,
        type: 'cluster',
        coordinate,
        nodes: sortedNodes,
        relatedLines: lines,
        count: nodes.length,
        priority: getNodePriority(sortedNodes[0])
    }
}

/**
 * 构建聚合节点映射
 */
export function buildClusterNodes(
    nodes: PipelineNode[],
    lines: PipelineLine[]
): Map<string, ClusterNode | PipelineNode> {
    const coordinateMap = new Map<string, PipelineNode[]>()

    // 按坐标分组
    nodes.forEach(node => {
        const key = `${node.coordinate.longitude.toFixed(6)},${node.coordinate.latitude.toFixed(6)}`
        if (!coordinateMap.has(key)) {
            coordinateMap.set(key, [])
        }
        coordinateMap.get(key)!.push(node)
    })

    // 构建结果映射
    const result = new Map<string, ClusterNode | PipelineNode>()

    coordinateMap.forEach((groupNodes, key) => {
        if (groupNodes.length === 1) {
            // 单个节点，直接存储
            result.set(groupNodes[0].id, groupNodes[0])
        } else {
            // 多个节点，创建聚合节点
            // 查找关联的管线
            const nodeIds = new Set(groupNodes.map(n => n.id))
            const relatedLines = lines.filter(line =>
                nodeIds.has(line.startNodeId) || nodeIds.has(line.endNodeId)
            )

            const cluster = createClusterNode(
                groupNodes[0].coordinate,
                groupNodes,
                relatedLines
            )
            result.set(cluster.id, cluster)
        }
    })

    return result
}
```

```typescript
// src/components/map-view/ClusterMarker.tsx

import React, { useState } from 'react'
import type { ClusterNode, PipelineNode } from '@/types'

interface ClusterMarkerProps {
    cluster: ClusterNode
    onNodeClick?: (node: PipelineNode) => void
}

/**
 * 聚合节点标记组件
 */
export const ClusterMarker: React.FC<ClusterMarkerProps> = ({ cluster, onNodeClick }) => {
    const [showDetail, setShowDetail] = useState(false)

    // 根据优先级确定颜色
    const getColorByPriority = (priority: number): string => {
        switch (priority) {
            case 3: return '#00d4ff' // 压气站 - 青色
            case 2: return '#ffd700' // 分输站 - 金黄色
            default: return '#e0e0e0' // 阀室 - 灰白色
        }
    }

    const mainColor = getColorByPriority(cluster.priority)

    return (
        <div className="relative">
            {/* 聚合节点标记 */}
            <div
                className="cluster-marker cursor-pointer transition-transform hover:scale-110"
                onClick={() => setShowDetail(!showDetail)}
                style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: `radial-gradient(circle, ${mainColor} 0%, ${mainColor}88 100%)`,
                    border: `2px solid ${mainColor}`,
                    boxShadow: `0 0 10px ${mainColor}66`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#000',
                    fontWeight: 'bold',
                    fontSize: '12px'
                }}
            >
                {cluster.count}
            </div>

            {/* 详情面板 */}
            {showDetail && (
                <div
                    className="absolute left-full top-0 ml-2 bg-black/90 backdrop-blur-sm rounded-lg p-3 border border-blue-500/30 min-w-[200px] z-50"
                    style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
                >
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-700">
                        <span className="text-white font-semibold">交汇节点</span>
                        <span className="text-xs text-gray-400">{cluster.count} 个节点</span>
                    </div>

                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                        {cluster.nodes.map(node => (
                            <div
                                key={node.id}
                                className="p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-colors"
                                onClick={() => onNodeClick?.(node)}
                            >
                                <div className="flex items-center gap-2">
                                    <span
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: getNodeColor(node) }}
                                    />
                                    <span className="text-sm text-white">{node.name}</span>
                                </div>
                                <div className="text-xs text-gray-400 mt-1">
                                    {getNodeTypeLabel(node)}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

function getNodeColor(node: PipelineNode): string {
    if (node.name.includes('压气站')) return '#00d4ff'
    if (node.name.includes('分输站')) return '#ffd700'
    return '#e0e0e0'
}

function getNodeTypeLabel(node: PipelineNode): string {
    if (node.name.includes('压气站')) return '压气站'
    if (node.name.includes('分输站')) return '分输站'
    if (node.name.includes('阀室')) return '阀室'
    return '节点'
}
```

#### 优点
- 界面简洁，减少视觉噪音
- 适合大屏监控场景
- 扩展性好，可展示丰富信息
- 点击交互清晰明确

#### 缺点
- 需要额外点击才能看到详情
- 聚合节点的视觉设计需要精心设计
- 快速浏览时信息不够直观

#### 适用场景
- 监控大屏展示
- 节点密度较高的区域
- 需要概览而非详细信息的场景

---

### 2.3 方案三：分层渲染+动态显隐（Layered Rendering）

#### 核心思路
按重要性分层，默认只显示主要节点（压气站、分输站），阀室等次要节点根据缩放级别动态显示。对于重叠节点，优先级高的显示，优先级低的在悬停或高缩放时显示。

#### 技术实现

```typescript
// src/utils/nodeClustering.ts

/**
 * 节点层级配置
 */
interface LayerConfig {
    priority: number        // 优先级，数字越小越重要
    minZoom: number         // 最小显示缩放级别
    maxZoom: number         // 最大显示缩放级别（Infinity表示无限制）
    alwaysShow: boolean     // 是否始终显示
    label: string           // 层级标签
}

const NODE_LAYERS: Record<string, LayerConfig> = {
    'compressor': {
        priority: 1,
        minZoom: 0,
        maxZoom: Infinity,
        alwaysShow: true,
        label: '压气站'
    },
    'distribution': {
        priority: 2,
        minZoom: 0,
        maxZoom: Infinity,
        alwaysShow: true,
        label: '分输站'
    },
    'valve': {
        priority: 3,
        minZoom: 8,
        maxZoom: Infinity,
        alwaysShow: false,
        label: '阀室'
    }
}

/**
 * 判断节点类型
 */
function getNodeLayerType(node: PipelineNode): string {
    const name = node.name.toLowerCase()
    if (name.includes('压气站')) return 'compressor'
    if (name.includes('分输站') || name.includes('门站') || name.includes('末站')) return 'distribution'
    return 'valve'
}

/**
 * 获取节点层级配置
 */
function getNodeLayerConfig(node: PipelineNode): LayerConfig {
    const type = getNodeLayerType(node)
    return NODE_LAYERS[type] || NODE_LAYERS.valve
}

/**
 * 分层渲染结果
 */
interface LayeredRenderResult {
    visibleNodes: PipelineNode[]           // 当前可见节点
    hiddenNodes: PipelineNode[]            // 当前隐藏节点
    overlappingGroups: OverlappingGroup[]  // 重叠节点组
}

interface OverlappingGroup {
    coordinate: string
    nodes: PipelineNode[]
    primaryNode: PipelineNode              // 主节点（优先级最高）
    secondaryNodes: PipelineNode[]         // 次节点
}

/**
 * 处理分层渲染
 */
export function processLayeredRendering(
    nodes: PipelineNode[],
    currentZoom: number
): LayeredRenderResult {
    // 按坐标分组
    const coordinateMap = new Map<string, PipelineNode[]>()
    nodes.forEach(node => {
        const key = `${node.coordinate.longitude.toFixed(6)},${node.coordinate.latitude.toFixed(6)}`
        if (!coordinateMap.has(key)) {
            coordinateMap.set(key, [])
        }
        coordinateMap.get(key)!.push(node)
    })

    const visibleNodes: PipelineNode[] = []
    const hiddenNodes: PipelineNode[] = []
    const overlappingGroups: OverlappingGroup[] = []

    coordinateMap.forEach((groupNodes, coordinate) => {
        // 按优先级排序
        const sortedNodes = groupNodes.sort((a, b) => {
            const configA = getNodeLayerConfig(a)
            const configB = getNodeLayerConfig(b)
            return configA.priority - configB.priority
        })

        if (groupNodes.length === 1) {
            // 单个节点，根据缩放级别决定是否显示
            const config = getNodeLayerConfig(sortedNodes[0])
            if (currentZoom >= config.minZoom && currentZoom <= config.maxZoom) {
                visibleNodes.push(sortedNodes[0])
            } else {
                hiddenNodes.push(sortedNodes[0])
            }
        } else {
            // 多个节点重叠
            const primaryNode = sortedNodes[0]
            const secondaryNodes = sortedNodes.slice(1)

            // 主节点根据缩放级别显示
            const primaryConfig = getNodeLayerConfig(primaryNode)
            if (currentZoom >= primaryConfig.minZoom) {
                visibleNodes.push(primaryNode)
            } else {
                hiddenNodes.push(primaryNode)
            }

            // 次节点在高缩放级别显示
            secondaryNodes.forEach(node => {
                const config = getNodeLayerConfig(node)
                // 重叠的次节点需要更高的缩放级别才显示
                const effectiveMinZoom = Math.max(config.minZoom, 10)

                if (currentZoom >= effectiveMinZoom) {
                    visibleNodes.push(node)
                } else {
                    hiddenNodes.push(node)
                }
            })

            overlappingGroups.push({
                coordinate,
                nodes: groupNodes,
                primaryNode,
                secondaryNodes
            })
        }
    })

    return {
        visibleNodes,
        hiddenNodes,
        overlappingGroups
    }
}
```

#### 优点
- 符合"渐进式披露"设计原则
- 不同缩放级别自动适配
- 用户认知负担小
- 性能友好，减少不必要的渲染

#### 缺点
- 需要维护复杂的状态逻辑
- 阀室等次要节点在低缩放级别被隐藏
- 层级规则需要业务确认

#### 适用场景
- 日常运维监控
- 多缩放级别的浏览场景
- 需要层次化信息展示的场景

---

### 2.4 方案四：虚拟节点+连线指示（Virtual Node + Connector）

#### 核心思路
交叉点只保留一个物理节点作为主节点，其他管线通过"虚拟节点+连线"连接到实际位置。虚拟节点显示在偏移位置，通过虚线或引导线与主节点连接。

#### 技术实现

```typescript
// src/utils/nodeClustering.ts

/**
 * 虚拟节点数据结构
 */
export interface VirtualNode {
    id: string
    type: 'virtual'
    nodeId: string                    // 关联的真实节点ID
    realCoordinate: {                // 真实坐标（交叉点）
        longitude: number
        latitude: number
    }
    virtualCoordinate: {             // 虚拟显示坐标（偏移后）
        longitude: number
        latitude: number
    }
    lineId: string                    // 关联的管线ID
    lineName: string                  // 管线名称
    offsetDirection: number           // 偏移方向（角度）
}

/**
 * 连线指示器
 */
export interface ConnectorLine {
    id: string
    from: { longitude: number; latitude: number }
    to: { longitude: number; latitude: number }
    style: 'dashed' | 'dotted' | 'solid'
    color: string
}

/**
 * 虚拟节点系统配置
 */
interface VirtualNodeConfig {
    offsetRadius: number      // 偏移半径（像素）
    angleStep: number         // 角度步进（度）
    lineStyle: 'dashed' | 'dotted'
    lineColor: string
    lineWidth: number
}

const DEFAULT_VIRTUAL_CONFIG: VirtualNodeConfig = {
    offsetRadius: 30,
    angleStep: 45,
    lineStyle: 'dashed',
    lineColor: '#888888',
    lineWidth: 1
}

/**
 * 创建虚拟节点系统
 */
export function createVirtualNodeSystem(
    nodes: PipelineNode[],
    lines: PipelineLine[],
    zoom: number,
    config: VirtualNodeConfig = DEFAULT_VIRTUAL_CONFIG
): {
    primaryNodes: PipelineNode[]
    virtualNodes: VirtualNode[]
    connectors: ConnectorLine[]
} {
    // 按坐标分组
    const coordinateMap = new Map<string, PipelineNode[]>()
    nodes.forEach(node => {
        const key = `${node.coordinate.longitude.toFixed(6)},${node.coordinate.latitude.toFixed(6)}`
        if (!coordinateMap.has(key)) {
            coordinateMap.set(key, [])
        }
        coordinateMap.get(key)!.push(node)
    })

    const primaryNodes: PipelineNode[] = []
    const virtualNodes: VirtualNode[] = []
    const connectors: ConnectorLine[] = []

    coordinateMap.forEach((groupNodes, key) => {
        if (groupNodes.length === 1) {
            // 单个节点，作为主节点
            primaryNodes.push(groupNodes[0])
        } else {
            // 多个节点，选择优先级最高的作为主节点
            const sortedNodes = groupNodes.sort((a, b) => {
                const priorityA = getNodePriority(a)
                const priorityB = getNodePriority(b)
                return priorityB - priorityA
            })

            const primaryNode = sortedNodes[0]
            primaryNodes.push(primaryNode)

            // 其余节点创建虚拟节点
            const [lng, lat] = key.split(',').map(Number)
            const secondaryNodes = sortedNodes.slice(1)

            secondaryNodes.forEach((node, index) => {
                // 计算偏移角度（均匀分布）
                const angle = (index * config.angleStep * Math.PI) / 180

                // 计算虚拟坐标
                const virtualCoord = pixelToLngLat(
                    lng,
                    lat,
                    config.offsetRadius * Math.cos(angle),
                    config.offsetRadius * Math.sin(angle),
                    zoom
                )

                // 查找关联的管线
                const relatedLine = lines.find(line =>
                    line.startNodeId === node.id || line.endNodeId === node.id
                )

                const virtualNode: VirtualNode = {
                    id: `virtual_${node.id}`,
                    type: 'virtual',
                    nodeId: node.id,
                    realCoordinate: { longitude: lng, latitude: lat },
                    virtualCoordinate: virtualCoord,
                    lineId: relatedLine?.id || '',
                    lineName: relatedLine?.name || '',
                    offsetDirection: index * config.angleStep
                }

                virtualNodes.push(virtualNode)

                // 创建连线指示器
                connectors.push({
                    id: `connector_${virtualNode.id}`,
                    from: virtualCoord,
                    to: { longitude: lng, latitude: lat },
                    style: config.lineStyle,
                    color: config.lineColor
                })
            })
        }
    })

    return { primaryNodes, virtualNodes, connectors }
}

/**
 * 获取节点优先级
 */
function getNodePriority(node: PipelineNode): number {
    if (node.name.includes('压气站')) return 3
    if (node.name.includes('分输站') || node.name.includes('门站')) return 2
    return 1
}
```

#### 优点
- 保持真实坐标的单一权威
- 虚拟节点位置灵活可控
- 连线清晰表达关联关系
- 视觉层次清晰

#### 缺点
- 实现复杂度最高
- 连线过多时界面混乱
- 需要维护节点间的映射关系
- 性能开销较大

#### 适用场景
- 精确分析场景
- 需要同时展示关联关系的场景
- 节点数量适中的区域

---

## 三、推荐方案：智能自适应混合方案

### 3.1 方案概述

基于以上分析，我推荐采用**智能自适应混合方案**，结合方案二（聚合节点）、方案三（分层渲染）和方案一（物理偏移）的优点：

**核心策略**：
1. **低缩放级别（zoom < 8）**：使用聚合节点，简洁展示交汇点
2. **中缩放级别（8 <= zoom < 12）**：分层渲染，主节点显示，次节点聚合
3. **高缩放级别（zoom >= 12）**：物理偏移，所有节点分散显示
4. **交互增强**：悬停预览 + 点击详情面板

### 3.2 技术架构

```typescript
// src/utils/nodeClustering.ts - 完整实现

import type { PipelineNode, PipelineLine } from '@/types'

// ============================================
// 类型定义
// ============================================

export type DisplayMode = 'cluster' | 'layered' | 'offset'

export interface NodeDisplayState {
    node: PipelineNode
    mode: DisplayMode
    displayCoord: { longitude: number; latitude: number }
    isPrimary: boolean
    isVisible: boolean
    groupId?: string
}

export interface NodeGroup {
    id: string
    coordinate: { longitude: number; latitude: number }
    nodes: PipelineNode[]
    primaryNode: PipelineNode
    displayMode: DisplayMode
}

export interface AdaptiveRenderConfig {
    clusterThreshold: number      // 聚合模式最大缩放级别
    layeredThreshold: number      // 分层模式最大缩放级别
    offsetRadius: number          // 物理偏移半径
    minZoomForValve: number       // 阀室最小显示缩放级别
}

const DEFAULT_CONFIG: AdaptiveRenderConfig = {
    clusterThreshold: 8,
    layeredThreshold: 12,
    offsetRadius: 20,
    minZoomForValve: 8
}

// ============================================
// 核心处理类
// ============================================

export class AdaptiveNodeRenderer {
    private config: AdaptiveRenderConfig
    private nodeGroups: Map<string, NodeGroup> = new Map()
    private displayStates: Map<string, NodeDisplayState> = new Map()

    constructor(config: Partial<AdaptiveRenderConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config }
    }

    /**
     * 初始化节点分组
     */
    initialize(nodes: PipelineNode[]): void {
        const coordinateMap = new Map<string, PipelineNode[]>()

        nodes.forEach(node => {
            const key = this.getCoordinateKey(node.coordinate)
            if (!coordinateMap.has(key)) {
                coordinateMap.set(key, [])
            }
            coordinateMap.get(key)!.push(node)
        })

        this.nodeGroups.clear()
        coordinateMap.forEach((groupNodes, key) => {
            const [lng, lat] = key.split(',').map(Number)
            const primaryNode = this.selectPrimaryNode(groupNodes)

            this.nodeGroups.set(key, {
                id: `group_${key.replace(/[,.]/g, '_')}`,
                coordinate: { longitude: lng, latitude: lat },
                nodes: groupNodes,
                primaryNode,
                displayMode: 'cluster'
            })
        })
    }

    /**
     * 根据当前缩放级别更新显示状态
     */
    updateForZoom(zoom: number): Map<string, NodeDisplayState> {
        this.displayStates.clear()

        this.nodeGroups.forEach(group => {
            const mode = this.determineDisplayMode(zoom, group.nodes.length)
            group.displayMode = mode

            switch (mode) {
                case 'cluster':
                    this.processClusterMode(group, zoom)
                    break
                case 'layered':
                    this.processLayeredMode(group, zoom)
                    break
                case 'offset':
                    this.processOffsetMode(group, zoom)
                    break
            }
        })

        return this.displayStates
    }

    /**
     * 确定显示模式
     */
    private determineDisplayMode(zoom: number, nodeCount: number): DisplayMode {
        if (nodeCount === 1) {
            return 'layered' // 单个节点使用分层模式
        }

        if (zoom < this.config.clusterThreshold) {
            return 'cluster'
        } else if (zoom < this.config.layeredThreshold) {
            return 'layered'
        } else {
            return 'offset'
        }
    }

    /**
     * 聚合模式处理
     */
    private processClusterMode(group: NodeGroup, zoom: number): void {
        // 只显示主节点，标记为聚合代表
        const state: NodeDisplayState = {
            node: group.primaryNode,
            mode: 'cluster',
            displayCoord: group.coordinate,
            isPrimary: true,
            isVisible: true,
            groupId: group.id
        }
        this.displayStates.set(group.primaryNode.id, state)

        // 其他节点标记为隐藏但可展开
        group.nodes.forEach(node => {
            if (node.id !== group.primaryNode.id) {
                this.displayStates.set(node.id, {
                    node,
                    mode: 'cluster',
                    displayCoord: group.coordinate,
                    isPrimary: false,
                    isVisible: false,
                    groupId: group.id
                })
            }
        })
    }

    /**
     * 分层模式处理
     */
    private processLayeredMode(group: NodeGroup, zoom: number): void {
        const sortedNodes = this.sortNodesByPriority(group.nodes)

        sortedNodes.forEach((node, index) => {
            const isPrimary = index === 0
            const nodeType = this.getNodeType(node)

            // 判断是否可见
            let isVisible = true
            if (nodeType === 'valve' && zoom < this.config.minZoomForValve) {
                isVisible = false
            }

            // 次节点在高缩放级别才显示
            if (!isPrimary && zoom < 10) {
                isVisible = false
            }

            this.displayStates.set(node.id, {
                node,
                mode: 'layered',
                displayCoord: group.coordinate,
                isPrimary,
                isVisible,
                groupId: group.id
            })
        })
    }

    /**
     * 物理偏移模式处理
     */
    private processOffsetMode(group: NodeGroup, zoom: number): void {
        const sortedNodes = this.sortNodesByPriority(group.nodes)

        sortedNodes.forEach((node, index) => {
            const displayCoord = this.calculateOffsetPosition(
                group.coordinate,
                index,
                sortedNodes.length,
                zoom
            )

            this.displayStates.set(node.id, {
                node,
                mode: 'offset',
                displayCoord,
                isPrimary: index === 0,
                isVisible: true,
                groupId: group.id
            })
        })
    }

    /**
     * 计算偏移位置
     */
    private calculateOffsetPosition(
        base: { longitude: number; latitude: number },
        index: number,
        total: number,
        zoom: number
    ): { longitude: number; latitude: number } {
        if (total === 1) return base

        const goldenAngle = Math.PI * (3 - Math.sqrt(5))
        const angle = index * goldenAngle
        const radius = this.config.offsetRadius * (1 + index * 0.3)

        const pixelX = radius * Math.cos(angle)
        const pixelY = radius * Math.sin(angle)

        return this.pixelToLngLat(base.longitude, base.latitude, pixelX, pixelY, zoom)
    }

    /**
     * 像素转经纬度
     */
    private pixelToLngLat(
        lng: number,
        lat: number,
        pixelX: number,
        pixelY: number,
        zoom: number
    ): { longitude: number; latitude: number } {
        const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom)
        const lngPerPixel = metersPerPixel / 111320
        const latPerPixel = metersPerPixel / 110540

        return {
            longitude: lng + pixelX * lngPerPixel,
            latitude: lat + pixelY * latPerPixel
        }
    }

    /**
     * 选择主节点
     */
    private selectPrimaryNode(nodes: PipelineNode[]): PipelineNode {
        return this.sortNodesByPriority(nodes)[0]
    }

    /**
     * 按优先级排序节点
     */
    private sortNodesByPriority(nodes: PipelineNode[]): PipelineNode[] {
        return [...nodes].sort((a, b) => {
            const priorityA = this.getNodePriority(a)
            const priorityB = this.getNodePriority(b)
            return priorityB - priorityA
        })
    }

    /**
     * 获取节点优先级
     */
    private getNodePriority(node: PipelineNode): number {
        if (node.name.includes('压气站')) return 3
        if (node.name.includes('分输站') || node.name.includes('门站') || node.name.includes('末站')) return 2
        return 1
    }

    /**
     * 获取节点类型
     */
    private getNodeType(node: PipelineNode): string {
        if (node.name.includes('压气站')) return 'compressor'
        if (node.name.includes('分输站') || node.name.includes('门站')) return 'distribution'
        return 'valve'
    }

    /**
     * 获取坐标键
     */
    private getCoordinateKey(coord: { longitude: number; latitude: number }): string {
        return `${coord.longitude.toFixed(6)},${coord.latitude.toFixed(6)}`
    }

    /**
     * 获取节点组
     */
    getGroup(groupId: string): NodeGroup | undefined {
        return this.nodeGroups.get(groupId)
    }

    /**
     * 获取所有节点组
     */
    getAllGroups(): NodeGroup[] {
        return Array.from(this.nodeGroups.values())
    }
}
```

### 3.3 与现有代码集成

```typescript
// src/utils/mapRenderer.ts - 集成示例

import { AdaptiveNodeRenderer, type NodeDisplayState } from './nodeClustering'

// 渲染器实例（在组件中维护）
let adaptiveRenderer: AdaptiveNodeRenderer | null = null

/**
 * 渲染管网节点（智能自适应版本）
 */
export function renderPipelineNodesAdaptive(
    map: any,
    nodes: PipelineNode[],
    sourceNodes: string[] = [],
    compressorStations: string[] = [],
    onNodeClick?: (event: { node: PipelineNode; position: { longitude: number; latitude: number } }) => void
) {
    const AMap = (window as any).AMap
    if (!AMap) return []

    // 初始化自适应渲染器
    if (!adaptiveRenderer) {
        adaptiveRenderer = new AdaptiveNodeRenderer({
            clusterThreshold: 8,
            layeredThreshold: 12,
            offsetRadius: 20,
            minZoomForValve: 8
        })
        adaptiveRenderer.initialize(nodes)
    }

    const currentZoom = map.getZoom()
    const displayStates = adaptiveRenderer.updateForZoom(currentZoom)

    const overlays: any[] = []

    // 按显示状态渲染节点
    displayStates.forEach((state, nodeId) => {
        if (!state.isVisible) return

        const { node, displayCoord, mode } = state

        // 根据模式选择渲染方式
        switch (mode) {
            case 'cluster':
                // 渲染聚合节点标记
                overlays.push(renderClusterMarker(map, state, onNodeClick))
                break
            case 'layered':
            case 'offset':
                // 渲染普通节点，使用显示坐标
                overlays.push(renderSingleNode(map, node, displayCoord, onNodeClick))
                break
        }
    })

    // 监听缩放事件
    const zoomHandler = () => {
        const newZoom = map.getZoom()
        // 清除当前覆盖物
        overlays.forEach(o => o.setMap && o.setMap(null))
        overlays.length = 0

        // 重新渲染
        const newStates = adaptiveRenderer!.updateForZoom(newZoom)
        newStates.forEach((state, nodeId) => {
            if (!state.isVisible) return
            // ... 渲染逻辑
        })
    }

    map.on('zoomend', zoomHandler)

    return overlays
}

/**
 * 渲染聚合节点标记
 */
function renderClusterMarker(
    map: any,
    state: NodeDisplayState,
    onNodeClick?: Function
): any {
    const group = adaptiveRenderer?.getGroup(state.groupId!)
    if (!group) return null

    // 创建聚合标记（显示节点数量）
    const marker = new AMap.Marker({
        position: [state.displayCoord.longitude, state.displayCoord.latitude],
        content: createClusterContent(group.nodes.length),
        offset: new AMap.Pixel(-16, -16),
        zIndex: 150
    })

    // 点击展开详情
    marker.on('click', () => {
        // 显示聚合详情面板
        showClusterDetail(map, group, onNodeClick)
    })

    map.add(marker)
    return marker
}

/**
 * 创建聚合标记内容
 */
function createClusterContent(count: number): string {
    return `
        <div style="
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%);
            border: 2px solid #fff;
            box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-weight: bold;
            font-size: 14px;
            cursor: pointer;
        ">${count}</div>
    `
}
```

### 3.4 交互设计

```typescript
// src/components/map-view/ClusterDetailPanel.tsx

import React from 'react'
import type { PipelineNode } from '@/types'

interface ClusterDetailPanelProps {
    nodes: PipelineNode[]
    coordinate: { longitude: number; latitude: number }
    onNodeClick?: (node: PipelineNode) => void
    onClose?: () => void
}

/**
 * 聚合节点详情面板
 */
export const ClusterDetailPanel: React.FC<ClusterDetailPanelProps> = ({
    nodes,
    coordinate,
    onNodeClick,
    onClose
}) => {
    // 按类型分组
    const groupedNodes = nodes.reduce((acc, node) => {
        const type = getNodeType(node)
        if (!acc[type]) acc[type] = []
        acc[type].push(node)
        return acc
    }, {} as Record<string, PipelineNode[]>)

    return (
        <div className="cluster-detail-panel bg-black/90 backdrop-blur-sm rounded-lg p-4 border border-blue-500/30 min-w-[280px] shadow-2xl">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-700">
                <div>
                    <h3 className="text-white font-semibold">管线交汇点</h3>
                    <p className="text-xs text-gray-400">
                        {coordinate.longitude.toFixed(4)}, {coordinate.latitude.toFixed(4)}
                    </p>
                </div>
                <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-white transition-colors"
                >
                    <span className="material-symbols-outlined">close</span>
                </button>
            </div>

            <div className="space-y-3 max-h-[300px] overflow-y-auto">
                {groupedNodes.compressor && (
                    <NodeGroupSection
                        title="压气站"
                        nodes={groupedNodes.compressor}
                        color="#00d4ff"
                        onNodeClick={onNodeClick}
                    />
                )}
                {groupedNodes.distribution && (
                    <NodeGroupSection
                        title="分输站"
                        nodes={groupedNodes.distribution}
                        color="#ffd700"
                        onNodeClick={onNodeClick}
                    />
                )}
                {groupedNodes.valve && (
                    <NodeGroupSection
                        title="阀室"
                        nodes={groupedNodes.valve}
                        color="#e0e0e0"
                        onNodeClick={onNodeClick}
                    />
                )}
            </div>
        </div>
    )
}

interface NodeGroupSectionProps {
    title: string
    nodes: PipelineNode[]
    color: string
    onNodeClick?: (node: PipelineNode) => void
}

const NodeGroupSection: React.FC<NodeGroupSectionProps> = ({
    title,
    nodes,
    color,
    onNodeClick
}) => (
    <div className="node-group-section">
        <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-sm text-gray-300">{title}</span>
            <span className="text-xs text-gray-500">({nodes.length})</span>
        </div>
        <div className="space-y-1 ml-4">
            {nodes.map(node => (
                <div
                    key={node.id}
                    className="p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-colors"
                    onClick={() => onNodeClick?.(node)}
                >
                    <span className="text-sm text-white">{node.name}</span>
                </div>
            ))}
        </div>
    </div>
)

function getNodeType(node: PipelineNode): string {
    if (node.name.includes('压气站')) return 'compressor'
    if (node.name.includes('分输站') || node.name.includes('门站')) return 'distribution'
    return 'valve'
}
```

### 3.5 方案优势

| 维度 | 评估 |
|------|------|
| **用户体验** | 自适应不同场景，低缩放级别简洁，高缩放级别详细 |
| **实现复杂度** | 中等，复用现有渲染逻辑，增量开发 |
| **性能表现** | 根据缩放级别动态控制渲染数量，避免性能瓶颈 |
| **可维护性** | 模块化设计，各模式独立，便于后续扩展 |
| **业务契合** | 符合燃气管网监控的业务场景需求 |

### 3.6 可能的风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| 缩放切换时的闪烁 | 中 | 添加过渡动画，使用双缓冲渲染 |
| 节点偏移后的连线错位 | 中 | 在偏移模式下使用虚拟连线连接实际坐标 |
| 大数据量性能问题 | 高 | 实现节点懒加载，视口外节点不渲染 |
| 用户学习成本 | 低 | 添加图例说明和操作引导 |

---

## 四、实施计划

### 4.1 开发阶段

1. **第一阶段**：基础架构
   - 创建 `nodeClustering.ts` 核心模块
   - 实现节点分组和优先级排序
   - 集成到现有 `mapRenderer.ts`

2. **第二阶段**：模式实现
   - 实现聚合模式（cluster）
   - 实现分层模式（layered）
   - 实现物理偏移模式（offset）

3. **第三阶段**：交互优化
   - 实现详情面板组件
   - 添加悬停预览功能
   - 优化缩放切换动画

4. **第四阶段**：测试调优
   - 性能测试与优化
   - 用户体验测试
   - 参数调优（阈值、半径等）

### 4.2 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/utils/nodeClustering.ts` | 新增 | 核心算法模块 |
| `src/utils/mapRenderer.ts` | 修改 | 集成自适应渲染 |
| `src/components/map-view/ClusterDetailPanel.tsx` | 新增 | 聚合详情面板 |
| `src/components/map-view/ClusterMarker.tsx` | 新增 | 聚合标记组件 |
| `src/types/pipeline.ts` | 修改 | 添加相关类型定义 |

---

## 五、总结

本提案提出的**智能自适应混合方案**结合了聚合节点、分层渲染和物理偏移三种策略的优点，能够根据用户的缩放级别和当前场景自动选择最合适的展示方式：

- **低缩放级别**：聚合展示，界面简洁
- **中缩放级别**：分层展示，主次分明
- **高缩放级别**：物理偏移，细节完整

该方案既解决了节点重叠的核心问题，又兼顾了不同使用场景的需求，是适合智慧燃气管网可视化系统的综合性解决方案。
