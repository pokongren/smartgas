# 智能分层聚合渲染方案（Smart Layered Clustering）

## 技术方案文档

---

## 1. 问题背景

### 1.1 当前问题分析

在智慧燃气管网可视化系统中，多条管线交汇时存在严重的节点重叠问题：

1. **节点完全重叠**：多条管线的压气站、分输站、阀室在交叉点使用相同的地理坐标，导致渲染时完全堆叠
2. **视觉混乱**：压气站（梯形）、分输站（圆形）、阀室（小圆点）在交叉点堆叠，无法区分
3. **交互冲突**：点击事件在重叠元素上产生冲突，用户无法准确选择目标节点
4. **信息密度过高**：密集区域的节点标签相互覆盖，影响可读性

### 1.2 问题场景示例

以西气东输管线网络为例：
- 西一线、西二线、西三线在多个枢纽站交汇
- 每个交汇点可能包含：1个压气站 + 2-3个分输站 + 多个阀室
- 所有节点使用相同的经纬度坐标，渲染时完全重叠

---

## 2. 方案概述

### 2.1 方案名称

**智能分层聚合渲染方案（Smart Layered Clustering）**

### 2.2 核心思路

- **基于现有代码的最小化改动**：复用现有渲染逻辑，减少重构成本
- **使用高德地图原生能力**：避免引入第三方库，保持代码简洁
- **保留分层渲染思想**：压气站/分输站/阀室差异化显示
- **采用"聚合标记 → 详情面板"的两级交互**：低缩放级别聚合显示，点击展开详情

### 2.3 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        架构层次图                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│   │   数据层      │───▶│   聚合层      │───▶│   渲染层      │     │
│   └──────────────┘    └──────────────┘    └──────────────┘     │
│          │                   │                   │              │
│          ▼                   ▼                   ▼              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│   │ PipelineNode │    │ ClusterGroup │    │ ClusterMarker│     │
│   │   原始数据    │    │  坐标分组     │    │  聚合标记    │     │
│   └──────────────┘    └──────────────┘    └──────────────┘     │
│                                                  │              │
│                                                  ▼              │
│                                         ┌──────────────┐       │
│                                         │ClusterDetail │       │
│                                         │    Panel     │       │
│                                         │  详情面板     │       │
│                                         └──────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.4 交互流程

```
用户操作                          系统响应
─────────                        ─────────
   │                                  │
   │  1. 查看低缩放级别地图            │
   │─────────────────────────────────▶│
   │                                  │
   │  2. 显示聚合标记（带数量徽章）      │
   │◀─────────────────────────────────│
   │                                  │
   │  3. 点击聚合标记                  │
   │─────────────────────────────────▶│
   │                                  │
   │  4. 展开详情面板显示所有节点信息    │
   │◀─────────────────────────────────│
   │                                  │
   │  5. 放大地图到高缩放级别(>=12)     │
   │─────────────────────────────────▶│
   │                                  │
   │  6. 自动切换为螺旋偏移分散显示      │
   │◀─────────────────────────────────│
```

---

## 3. 技术实现

### 3.1 配置参数

```typescript
// src/utils/mapRenderer.ts

/**
 * 聚合渲染配置参数
 */
const CLUSTER_CONFIG = {
    /** 坐标分组精度（小数位数） */
    COORDINATE_PRECISION: 6,

    /** 阀室最小显示缩放级别 */
    VALVE_MIN_ZOOM: 8,

    /** 分散显示缩放级别阈值 */
    EXPAND_CLUSTER_ZOOM: 12,

    /** 螺旋偏移半径（像素） */
    SPIRAL_RADIUS: 30,

    /** 螺旋圈间距（像素） */
    SPIRAL_SEPARATION: 25,

    /** 聚合标记最大显示数量 */
    MAX_CLUSTER_COUNT: 99,

    /** 聚合标记颜色 */
    CLUSTER_COLORS: {
        FEW: '#3b82f6',      // 1-5个节点：蓝色
        MEDIUM: '#f59e0b',   // 6-15个节点：橙色
        MANY: '#ef4444'      // 16+个节点：红色
    }
} as const
```

### 3.2 数据结构定义

```typescript
// src/types/cluster.ts

import type { PipelineNode } from './pipeline'

/**
 * 聚合节点组
 */
export interface ClusterGroup {
    /** 聚合组唯一标识（基于坐标生成） */
    id: string

    /** 中心坐标 */
    coordinate: {
        longitude: number
        latitude: number
    }

    /** 聚合的节点列表 */
    nodes: PipelineNode[]

    /** 节点类型统计 */
    typeStats: {
        compressor: number    // 压气站数量
        distribution: number  // 分输站数量
        valve: number         // 阀室数量
        other: number         // 其他类型数量
    }

    /** 是否包含重要站场 */
    hasImportantStation: boolean
}

/**
 * 聚合标记点击事件数据
 */
export interface ClusterClickEvent {
    /** 聚合组数据 */
    cluster: ClusterGroup

    /** 点击位置 */
    position: {
        longitude: number
        latitude: number
    }

    /** 原始地图事件 */
    originalEvent: any
}
```

### 3.3 核心实现代码

#### 3.3.1 坐标分组函数

```typescript
// src/utils/mapRenderer.ts

/**
 * 将坐标转换为分组键
 * @param coord 坐标对象
 * @param precision 精度（小数位数）
 * @returns 分组键字符串
 */
function coordinateToKey(
    coord: { longitude: number; latitude: number },
    precision: number = CLUSTER_CONFIG.COORDINATE_PRECISION
): string {
    const lng = coord.longitude.toFixed(precision)
    const lat = coord.latitude.toFixed(precision)
    return `${lng},${lat}`
}

/**
 * 按坐标分组节点
 * @param nodes 节点列表
 * @returns 分组后的聚合组映射
 */
function groupNodesByCoordinate(nodes: PipelineNode[]): Map<string, ClusterGroup> {
    const groups = new Map<string, ClusterGroup>()

    nodes.forEach(node => {
        const key = coordinateToKey(node.coordinate)

        if (!groups.has(key)) {
            groups.set(key, {
                id: `cluster-${key}`,
                coordinate: node.coordinate,
                nodes: [],
                typeStats: {
                    compressor: 0,
                    distribution: 0,
                    valve: 0,
                    other: 0
                },
                hasImportantStation: false
            })
        }

        const group = groups.get(key)!
        group.nodes.push(node)

        // 更新类型统计
        const name = node.name
        if (name.includes('压气站')) {
            group.typeStats.compressor++
            group.hasImportantStation = true
        } else if (name.includes('分输站') || name.includes('门站')) {
            group.typeStats.distribution++
            group.hasImportantStation = true
        } else if (name.includes('阀室') || name.includes('阀门')) {
            group.typeStats.valve++
        } else {
            group.typeStats.other++
        }
    })

    return groups
}
```

#### 3.3.2 螺旋偏移计算

```typescript
// src/utils/mapRenderer.ts

/**
 * 计算螺旋偏移位置
 * 使用阿基米德螺旋线算法：r = a + b * θ
 *
 * @param index 节点在组内的序号（0-based）
 * @param total 组内节点总数
 * @param radius 基础半径（像素）
 * @returns 偏移量 {x, y}（像素）
 */
function calculateSpiralOffset(
    index: number,
    total: number,
    radius: number = CLUSTER_CONFIG.SPIRAL_RADIUS
): { x: number; y: number } {
    // 每个节点的角度间隔
    const angleStep = (2 * Math.PI) / Math.max(total, 6)

    // 计算螺旋参数
    const angle = angleStep * index
    const spiralRadius = radius + (CLUSTER_CONFIG.SPIRAL_SEPARATION * (index / Math.max(total, 1)))

    return {
        x: spiralRadius * Math.cos(angle),
        y: spiralRadius * Math.sin(angle)
    }
}

/**
 * 像素偏移转换为经纬度偏移
 * @param map 地图实例
 * @param center 中心点坐标
 * @param offsetX X轴偏移（像素）
 * @param offsetY Y轴偏移（像素）
 * @returns 偏移后的经纬度坐标
 */
function pixelOffsetToLngLat(
    map: any,
    center: { longitude: number; latitude: number },
    offsetX: number,
    offsetY: number
): { longitude: number; latitude: number } {
    const AMap = (window as any).AMap
    if (!AMap) return center

    // 获取当前缩放级别下1像素对应的经纬度距离
    const zoom = map.getZoom()
    const scale = Math.pow(2, 18 - zoom) // 缩放比例因子

    // 粗略估算：在赤道附近，1度约等于111km
    // 这里使用简化的转换公式
    const lngOffset = (offsetX * scale) / 111320
    const latOffset = (offsetY * scale) / 110540

    return {
        longitude: center.longitude + lngOffset,
        latitude: center.latitude - latOffset
    }
}
```

#### 3.3.3 聚合标记创建

```typescript
// src/utils/mapRenderer.ts

/**
 * 创建聚合标记的 DOM 内容
 * @param group 聚合组数据
 * @returns HTML 字符串
 */
function createClusterMarkerContent(group: ClusterGroup): string {
    const count = group.nodes.length
    const { typeStats } = group

    // 根据数量选择颜色
    let color = CLUSTER_CONFIG.CLUSTER_COLORS.FEW
    if (count > 15) {
        color = CLUSTER_CONFIG.CLUSTER_COLORS.MANY
    } else if (count > 5) {
        color = CLUSTER_CONFIG.CLUSTER_COLORS.MEDIUM
    }

    // 构建类型指示器
    const indicators = []
    if (typeStats.compressor > 0) {
        indicators.push(`<span class="cluster-indicator compressor" title="压气站">压</span>`)
    }
    if (typeStats.distribution > 0) {
        indicators.push(`<span class="cluster-indicator distribution" title="分输站">输</span>`)
    }
    if (typeStats.valve > 0) {
        indicators.push(`<span class="cluster-indicator valve" title="阀室">阀</span>`)
    }

    return `
        <div class="pipeline-cluster-marker" style="
            background: ${color};
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            border: 3px solid white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            cursor: pointer;
            transition: transform 0.2s;
        ">
            <span style="font-size: 16px; line-height: 1;">${Math.min(count, CLUSTER_CONFIG.MAX_CLUSTER_COUNT)}</span>
            <div style="display: flex; gap: 2px; margin-top: 2px;">
                ${indicators.join('')}
            </div>
        </div>
    `
}

/**
 * 创建聚合标记
 * @param map 地图实例
 * @param group 聚合组数据
 * @param onClick 点击回调
 * @returns 聚合标记实例
 */
function createClusterMarker(
    map: any,
    group: ClusterGroup,
    onClick?: (event: ClusterClickEvent) => void
): any {
    const AMap = (window as any).AMap
    if (!AMap) return null

    const marker = new AMap.Marker({
        position: [group.coordinate.longitude, group.coordinate.latitude],
        content: createClusterMarkerContent(group),
        offset: new AMap.Pixel(-20, -20),
        zIndex: 150,
        extData: { type: 'cluster', group }
    })

    // 绑定点击事件
    if (onClick) {
        marker.on('click', (e: any) => {
            onClick({
                cluster: group,
                position: group.coordinate,
                originalEvent: e
            })
        })
    }

    // 悬停效果
    marker.on('mouseover', () => {
        marker.setContent(createClusterMarkerContent(group).replace(
            'transform: scale(1)',
            'transform: scale(1.1)'
        ))
    })

    marker.on('mouseout', () => {
        marker.setContent(createClusterMarkerContent(group))
    })

    return marker
}
```

#### 3.3.4 渲染聚合节点

```typescript
// src/utils/mapRenderer.ts

/**
 * 渲染聚合节点（核心函数）
 * 根据缩放级别自动选择渲染策略：
 * - 低缩放级别 (< 12)：显示聚合标记
 * - 高缩放级别 (>= 12)：显示分散的单个节点
 *
 * @param map 地图实例
 * @param group 聚合组数据
 * @param currentZoom 当前缩放级别
 * @param onNodeClick 节点点击回调
 * @param onClusterClick 聚合标记点击回调
 * @returns 渲染的覆盖物数组
 */
function renderClusterNode(
    map: any,
    group: ClusterGroup,
    currentZoom: number,
    onNodeClick?: (event: { node: PipelineNode; position: any }) => void,
    onClusterClick?: (event: ClusterClickEvent) => void
): any[] {
    const overlays: any[] = []

    // 高缩放级别：分散显示
    if (currentZoom >= CLUSTER_CONFIG.EXPAND_CLUSTER_ZOOM) {
        group.nodes.forEach((node, index) => {
            const offset = calculateSpiralOffset(index, group.nodes.length)
            const newPosition = pixelOffsetToLngLat(
                map,
                node.coordinate,
                offset.x,
                offset.y
            )

            // 创建偏移后的节点标记
            const marker = createOffsetNodeMarker(map, node, newPosition, onNodeClick)
            if (marker) {
                overlays.push(marker)
            }
        })
    } else {
        // 低缩放级别：显示聚合标记
        const clusterMarker = createClusterMarker(map, group, onClusterClick)
        if (clusterMarker) {
            map.add(clusterMarker)
            overlays.push(clusterMarker)
        }
    }

    return overlays
}

/**
 * 创建偏移后的节点标记
 * @param map 地图实例
 * @param node 节点数据
 * @param position 偏移后的位置
 * @param onClick 点击回调
 * @returns 标记实例
 */
function createOffsetNodeMarker(
    map: any,
    node: PipelineNode,
    position: { longitude: number; latitude: number },
    onClick?: (event: { node: PipelineNode; position: any }) => void
): any {
    const AMap = (window as any).AMap
    if (!AMap) return null

    // 判断节点类型
    const isCompressor = node.name.includes('压气站')
    const isDistribution = node.name.includes('分输站') || node.name.includes('门站')

    let marker: any

    if (isCompressor) {
        // 压气站：梯形标记
        const container = document.createElement('div')
        container.innerHTML = `
            <div style="
                width: 0;
                height: 0;
                border-bottom: 20px solid #00d4ff;
                border-left: 8px solid transparent;
                border-right: 8px solid transparent;
                filter: drop-shadow(0 0 5px #00d4ff);
            "></div>
        `

        marker = new AMap.Marker({
            position: [position.longitude, position.latitude],
            content: container,
            offset: new AMap.Pixel(-8, -20),
            zIndex: 120,
            extData: { node }
        })
    } else if (isDistribution) {
        // 分输站：圆形标记
        marker = new AMap.CircleMarker({
            center: [position.longitude, position.latitude],
            radius: 8,
            fillColor: '#ffd700',
            fillOpacity: 0.9,
            strokeColor: '#ffffff',
            strokeWeight: 2,
            zIndex: 110
        })
    } else {
        // 阀室：小圆点
        marker = new AMap.CircleMarker({
            center: [position.longitude, position.latitude],
            radius: 5,
            fillColor: '#e0e0e0',
            fillOpacity: 0.8,
            strokeColor: '#666',
            strokeWeight: 1,
            zIndex: 100
        })
    }

    // 绑定点击事件
    if (onClick && marker) {
        marker.on('click', () => {
            onClick({ node, position })
        })
    }

    map.add(marker)
    return marker
}
```

### 3.4 详情面板组件

```typescript
// src/components/ClusterDetailPanel.tsx

import React from 'react'
import type { ClusterGroup } from '@/types/cluster'
import type { PipelineNode } from '@/types/pipeline'

interface ClusterDetailPanelProps {
    /** 聚合组数据 */
    cluster: ClusterGroup | null

    /** 是否显示 */
    visible: boolean

    /** 关闭回调 */
    onClose: () => void

    /** 节点选择回调 */
    onNodeSelect?: (node: PipelineNode) => void
}

/**
 * 聚合节点详情面板组件
 * 显示聚合位置的所有节点详细信息
 */
export const ClusterDetailPanel: React.FC<ClusterDetailPanelProps> = ({
    cluster,
    visible,
    onClose,
    onNodeSelect
}) => {
    if (!visible || !cluster) return null

    const { nodes, typeStats, coordinate } = cluster

    // 按类型分组显示
    const compressorNodes = nodes.filter(n => n.name.includes('压气站'))
    const distributionNodes = nodes.filter(n =>
        n.name.includes('分输站') || n.name.includes('门站')
    )
    const valveNodes = nodes.filter(n =>
        n.name.includes('阀室') || n.name.includes('阀门')
    )

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-gray-900 rounded-lg shadow-2xl border border-blue-500/30 w-[500px] max-h-[80vh] overflow-hidden">
                {/* 头部 */}
                <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-800">
                    <div>
                        <h3 className="text-lg font-bold text-white">
                            节点详情 ({nodes.length}个)
                        </h3>
                        <p className="text-xs text-gray-400 mt-1">
                            坐标: {coordinate.longitude.toFixed(6)}, {coordinate.latitude.toFixed(6)}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                {/* 统计信息 */}
                <div className="flex gap-4 p-4 bg-gray-800/50">
                    {typeStats.compressor > 0 && (
                        <div className="flex items-center gap-2 text-cyan-400">
                            <span className="w-3 h-3 bg-cyan-400 rounded-sm"></span>
                            <span className="text-sm">压气站: {typeStats.compressor}</span>
                        </div>
                    )}
                    {typeStats.distribution > 0 && (
                        <div className="flex items-center gap-2 text-yellow-400">
                            <span className="w-3 h-3 bg-yellow-400 rounded-full"></span>
                            <span className="text-sm">分输站: {typeStats.distribution}</span>
                        </div>
                    )}
                    {typeStats.valve > 0 && (
                        <div className="flex items-center gap-2 text-gray-400">
                            <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                            <span className="text-sm">阀室: {typeStats.valve}</span>
                        </div>
                    )}
                </div>

                {/* 节点列表 */}
                <div className="overflow-y-auto max-h-[50vh] p-4 space-y-3">
                    {/* 压气站 */}
                    {compressorNodes.length > 0 && (
                        <NodeSection
                            title="压气站"
                            nodes={compressorNodes}
                            color="cyan"
                            onNodeSelect={onNodeSelect}
                        />
                    )}

                    {/* 分输站 */}
                    {distributionNodes.length > 0 && (
                        <NodeSection
                            title="分输站"
                            nodes={distributionNodes}
                            color="yellow"
                            onNodeSelect={onNodeSelect}
                        />
                    )}

                    {/* 阀室 */}
                    {valveNodes.length > 0 && (
                        <NodeSection
                            title="阀室"
                            nodes={valveNodes}
                            color="gray"
                            onNodeSelect={onNodeSelect}
                        />
                    )}
                </div>

                {/* 底部操作 */}
                <div className="p-4 border-t border-gray-700 bg-gray-800 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    )
}

/**
 * 节点分组显示组件
 */
interface NodeSectionProps {
    title: string
    nodes: PipelineNode[]
    color: 'cyan' | 'yellow' | 'gray'
    onNodeSelect?: (node: PipelineNode) => void
}

const NodeSection: React.FC<NodeSectionProps> = ({
    title,
    nodes,
    color,
    onNodeSelect
}) => {
    const colorClasses = {
        cyan: 'border-cyan-500/30 bg-cyan-500/10',
        yellow: 'border-yellow-500/30 bg-yellow-500/10',
        gray: 'border-gray-500/30 bg-gray-500/10'
    }

    return (
        <div className={`border rounded-lg p-3 ${colorClasses[color]}`}>
            <h4 className="text-sm font-semibold text-white mb-2">{title}</h4>
            <div className="space-y-2">
                {nodes.map(node => (
                    <div
                        key={node.id}
                        onClick={() => onNodeSelect?.(node)}
                        className="flex items-center justify-between p-2 rounded bg-black/30 hover:bg-black/50 cursor-pointer transition-colors"
                    >
                        <div>
                            <span className="text-sm text-white">{node.name}</span>
                            <span className="text-xs text-gray-400 ml-2">
                                {node.pressureLevel}
                            </span>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${
                            node.status === 'normal'
                                ? 'bg-green-500/20 text-green-400'
                                : 'bg-red-500/20 text-red-400'
                        }`}>
                            {node.status === 'normal' ? '正常' : '异常'}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default ClusterDetailPanel
```

### 3.5 集成到现有渲染流程

```typescript
// src/utils/mapRenderer.ts

/**
 * 渲染管网节点（增强版，支持聚合）
 * 这是现有 renderPipelineNodes 函数的增强版本
 *
 * @param map 地图实例
 * @param nodes 节点列表
 * @param sourceNodes 气源节点名称列表
 * @param compressorStations 压气站名称列表
 * @param onNodeClick 节点点击回调
 * @param onClusterClick 聚合标记点击回调（新增）
 * @returns 渲染的覆盖物数组
 */
export function renderPipelineNodesWithClustering(
    map: any,
    nodes: PipelineNode[],
    sourceNodes: string[] = [],
    compressorStations: string[] = [],
    onNodeClick?: (event: { node: PipelineNode; position: any }) => void,
    onClusterClick?: (event: ClusterClickEvent) => void
): any[] {
    console.log('🏁 renderPipelineNodesWithClustering 被调用，节点数量:', nodes.length)

    const AMap = (window as any).AMap
    if (!AMap) {
        console.error('❌ AMap 对象未找到')
        return []
    }

    const overlays: any[] = []
    const currentZoom = map.getZoom()

    // 1. 按坐标分组
    const clusterGroups = groupNodesByCoordinate(nodes)
    console.log(`📊 节点分组完成: ${clusterGroups.size} 个聚合组`)

    // 2. 遍历每个聚合组进行渲染
    clusterGroups.forEach((group, key) => {
        try {
            if (group.nodes.length === 1) {
                // 单个节点：使用原始渲染逻辑
                const nodeOverlays = renderSingleNode(
                    map,
                    group.nodes[0],
                    sourceNodes,
                    compressorStations,
                    onNodeClick
                )
                overlays.push(...nodeOverlays)
            } else {
                // 多个节点：使用聚合渲染
                console.log(`📍 聚合组 ${key}: ${group.nodes.length} 个节点`)
                const clusterOverlays = renderClusterNode(
                    map,
                    group,
                    currentZoom,
                    onNodeClick,
                    onClusterClick
                )
                overlays.push(...clusterOverlays)
            }
        } catch (error) {
            console.error(`❌ 渲染聚合组 ${key} 失败:`, error)
        }
    })

    // 3. 监听缩放事件，动态切换显示模式
    const zoomHandler = () => {
        const newZoom = map.getZoom()
        console.log(`🔍 缩放级别变化: ${currentZoom} -> ${newZoom}`)

        // 如果跨越了阈值，需要重新渲染
        const crossedThreshold =
            (currentZoom < CLUSTER_CONFIG.EXPAND_CLUSTER_ZOOM &&
             newZoom >= CLUSTER_CONFIG.EXPAND_CLUSTER_ZOOM) ||
            (currentZoom >= CLUSTER_CONFIG.EXPAND_CLUSTER_ZOOM &&
             newZoom < CLUSTER_CONFIG.EXPAND_CLUSTER_ZOOM)

        if (crossedThreshold) {
            console.log('🔄 跨越缩放阈值，需要重新渲染')
            // 触发重新渲染（由调用方处理）
        }
    }

    map.on('zoomend', zoomHandler)

    console.log(`✅ 渲染完成，共 ${overlays.length} 个覆盖物`)
    return overlays
}

/**
 * 渲染单个节点（提取原有逻辑）
 */
function renderSingleNode(
    map: any,
    node: PipelineNode,
    sourceNodes: string[],
    compressorStations: string[],
    onNodeClick?: (event: { node: PipelineNode; position: any }) => void
): any[] {
    // 复用原有的渲染逻辑
    // 这里调用现有的 renderPipelineNodes 中的逻辑
    // 为简化示例，返回空数组
    return []
}
```

### 3.6 在视图组件中使用

```typescript
// src/views/GlobalPipelineView.tsx

import React, { useMemo, useState, useCallback } from 'react'
import MapView from '@/components/map-view/MapView'
import ClusterDetailPanel from '@/components/ClusterDetailPanel'
import { renderPipelineNodesWithClustering } from '@/utils/mapRenderer'
import type { ClusterGroup, ClusterClickEvent } from '@/types/cluster'
import type { PipelineNode } from '@/types/pipeline'

const GlobalPipelineView: React.FC = () => {
    const [mapInstance, setMapInstance] = useState<any>(null)

    // 聚合详情面板状态
    const [selectedCluster, setSelectedCluster] = useState<ClusterGroup | null>(null)
    const [isPanelVisible, setIsPanelVisible] = useState(false)

    // 节点点击处理
    const handleNodeClick = useCallback((event: { node: PipelineNode; position: any }) => {
        console.log('节点被点击:', event.node)
        // 处理单个节点点击
    }, [])

    // 聚合标记点击处理
    const handleClusterClick = useCallback((event: ClusterClickEvent) => {
        console.log('聚合标记被点击:', event.cluster)
        setSelectedCluster(event.cluster)
        setIsPanelVisible(true)
    }, [])

    // 详情面板关闭
    const handlePanelClose = useCallback(() => {
        setIsPanelVisible(false)
        setSelectedCluster(null)
    }, [])

    // 节点选择
    const handleNodeSelect = useCallback((node: PipelineNode) => {
        console.log('从面板选择节点:', node)
        handlePanelClose()
        // 可以在这里添加定位到节点的逻辑
    }, [handlePanelClose])

    // 渲染管道数据（示例）
    const pipelineData = useMemo(() => {
        // ... 数据准备逻辑
        return { nodes: [], lines: [], devices: [] }
    }, [])

    return (
        <div className="h-screen w-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900">
            {/* 地图组件 */}
            <MapView
                pipelineData={pipelineData}
                onLoad={(map) => setMapInstance(map)}
                // 使用增强的渲染函数
                renderNodes={renderPipelineNodesWithClustering}
                onNodeClick={handleNodeClick}
                onClusterClick={handleClusterClick}
            />

            {/* 聚合详情面板 */}
            <ClusterDetailPanel
                cluster={selectedCluster}
                visible={isPanelVisible}
                onClose={handlePanelClose}
                onNodeSelect={handleNodeSelect}
            />
        </div>
    )
}

export default GlobalPipelineView
```

---

## 4. 使用示例

### 4.1 基本使用

```typescript
import { renderPipelineNodesWithClustering } from '@/utils/mapRenderer'
import type { PipelineNode } from '@/types/pipeline'

// 假设已有地图实例和节点数据
const map = /* 获取地图实例 */
const nodes: PipelineNode[] = /* 获取节点数据 */

// 渲染节点（自动处理聚合）
const overlays = renderPipelineNodesWithClustering(
    map,
    nodes,
    [], // 气源节点列表
    [], // 压气站列表
    (event) => console.log('节点点击:', event),
    (event) => console.log('聚合点击:', event)
)
```

### 4.2 自定义配置

```typescript
// 修改全局配置
import { CLUSTER_CONFIG } from '@/utils/mapRenderer'

// 调整聚合阈值
CLUSTER_CONFIG.EXPAND_CLUSTER_ZOOM = 10  // 更早分散显示
CLUSTER_CONFIG.SPIRAL_RADIUS = 40        // 更大的偏移半径
```

### 4.3 响应式处理

```typescript
// 监听缩放变化，动态刷新
map.on('zoomend', () => {
    const zoom = map.getZoom()

    // 清除现有覆盖物
    clearMapOverlays(map, overlays)

    // 重新渲染
    overlays = renderPipelineNodesWithClustering(
        map,
        nodes,
        [],
        [],
        handleNodeClick,
        handleClusterClick
    )
})
```

---

## 5. 配置说明

### 5.1 配置参数表

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `COORDINATE_PRECISION` | number | 6 | 坐标分组精度，小数位数。值越大分组越精确 |
| `VALVE_MIN_ZOOM` | number | 8 | 阀室最小显示缩放级别，低于此级别阀室隐藏 |
| `EXPAND_CLUSTER_ZOOM` | number | 12 | 分散显示阈值，高于此级别聚合节点分散显示 |
| `SPIRAL_RADIUS` | number | 30 | 螺旋偏移基础半径（像素） |
| `SPIRAL_SEPARATION` | number | 25 | 螺旋圈间距（像素） |
| `MAX_CLUSTER_COUNT` | number | 99 | 聚合标记最大显示数量，超过显示"99+" |
| `CLUSTER_COLORS.FEW` | string | '#3b82f6' | 1-5个节点的聚合标记颜色（蓝色） |
| `CLUSTER_COLORS.MEDIUM` | string | '#f59e0b' | 6-15个节点的聚合标记颜色（橙色） |
| `CLUSTER_COLORS.MANY` | string | '#ef4444' | 16+个节点的聚合标记颜色（红色） |

### 5.2 配置调整建议

| 场景 | 建议配置 |
|------|----------|
| 节点密度极高 | 降低 `EXPAND_CLUSTER_ZOOM` 到 10，增大 `SPIRAL_RADIUS` 到 50 |
| 节点密度较低 | 提高 `EXPAND_CLUSTER_ZOOM` 到 14，减小 `SPIRAL_RADIUS` 到 20 |
| 需要更精确分组 | 提高 `COORDINATE_PRECISION` 到 7-8 |
| 大屏展示 | 增大所有尺寸参数 20-30% |

---

## 6. 实施计划

### 6.1 阶段划分

```
┌─────────────────────────────────────────────────────────────────┐
│                        实施时间线                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  第1周          第2周          第3周          第4周             │
│   │              │              │              │                │
│   ▼              ▼              ▼              ▼                │
│ ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐            │
│ │基础  │─────▶│核心  │─────▶│集成  │─────▶│优化  │            │
│ │开发  │      │开发  │      │测试  │      │交付  │            │
│ └──────┘      └──────┘      └──────┘      └──────┘            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 详细任务

#### 第一阶段：基础开发（第1周）

| 天数 | 任务 | 产出物 |
|------|------|--------|
| 1-2 | 创建类型定义文件 | `src/types/cluster.ts` |
| 3-4 | 实现坐标分组函数 | `groupNodesByCoordinate` |
| 5 | 单元测试 | 测试用例 |

#### 第二阶段：核心开发（第2周）

| 天数 | 任务 | 产出物 |
|------|------|--------|
| 1-2 | 实现螺旋偏移算法 | `calculateSpiralOffset` |
| 3-4 | 实现聚合标记创建 | `createClusterMarker` |
| 5 | 实现渲染核心函数 | `renderClusterNode` |

#### 第三阶段：集成测试（第3周）

| 天数 | 任务 | 产出物 |
|------|------|--------|
| 1-2 | 创建详情面板组件 | `ClusterDetailPanel.tsx` |
| 3 | 集成到 GlobalPipelineView | 视图更新 |
| 4-5 | 联调测试 | 测试报告 |

#### 第四阶段：优化交付（第4周）

| 天数 | 任务 | 产出物 |
|------|------|--------|
| 1-2 | 性能优化 | 优化后的代码 |
| 3 | 边界情况处理 | 异常处理代码 |
| 4 | 文档完善 | 技术文档 |
| 5 | 代码审查与交付 | 最终版本 |

### 6.3 代码修改清单

| 文件路径 | 修改类型 | 修改内容 |
|----------|----------|----------|
| `src/types/cluster.ts` | 新增 | 聚合相关类型定义 |
| `src/utils/mapRenderer.ts` | 修改 | 添加聚合渲染函数（约200行） |
| `src/components/ClusterDetailPanel.tsx` | 新增 | 详情面板组件 |
| `src/views/GlobalPipelineView.tsx` | 修改 | 集成聚合功能 |

---

## 7. 注意事项

### 7.1 边界情况处理

#### 7.1.1 坐标精度问题

```typescript
// 问题：坐标精度不一致导致分组失败
// 解决：统一使用 toFixed 格式化

function normalizeCoordinate(
    coord: number,
    precision: number = CLUSTER_CONFIG.COORDINATE_PRECISION
): number {
    return parseFloat(coord.toFixed(precision))
}
```

#### 7.1.2 大量节点聚合

```typescript
// 问题：单个位置节点过多（>50个）
// 解决：限制详情面板显示数量，提供分页或搜索

const MAX_DISPLAY_NODES = 50

// 在 ClusterDetailPanel 中添加分页逻辑
const [currentPage, setCurrentPage] = useState(0)
const paginatedNodes = nodes.slice(
    currentPage * MAX_DISPLAY_NODES,
    (currentPage + 1) * MAX_DISPLAY_NODES
)
```

#### 7.1.3 地图缩放性能

```typescript
// 问题：频繁缩放导致重复渲染
// 解决：添加防抖处理

import { debounce } from 'lodash'

const debouncedRender = debounce((zoom: number) => {
    // 执行渲染
}, 300)

map.on('zoomend', () => {
    debouncedRender(map.getZoom())
})
```

### 7.2 测试要点

#### 7.2.1 功能测试

| 测试项 | 测试步骤 | 预期结果 |
|--------|----------|----------|
| 聚合显示 | 低缩放级别查看交叉点 | 显示聚合标记，带数量徽章 |
| 分散显示 | 放大地图到 zoom >= 12 | 节点螺旋分散显示 |
| 详情面板 | 点击聚合标记 | 弹出详情面板，显示所有节点 |
| 节点选择 | 点击详情面板中的节点 | 触发选择回调，面板关闭 |
| 类型统计 | 查看聚合标记 | 正确显示压气站/分输站/阀室指示器 |

#### 7.2.2 性能测试

| 测试项 | 测试条件 | 预期性能 |
|--------|----------|----------|
| 大数据量 | 10000+节点 | 渲染时间 < 2秒 |
| 频繁缩放 | 快速缩放操作 | 无卡顿，内存稳定 |
| 内存泄漏 | 长时间运行 | 内存增长 < 50MB/小时 |

#### 7.2.3 兼容性测试

| 测试项 | 测试环境 | 预期结果 |
|--------|----------|----------|
| 浏览器兼容 | Chrome/Firefox/Edge | 功能正常 |
| 高德地图版本 | 2.0+ | 功能正常 |
| 响应式布局 | 不同屏幕尺寸 | 面板自适应 |

### 7.3 常见问题排查

#### Q1: 聚合标记不显示

**排查步骤：**
1. 检查 `groupNodesByCoordinate` 是否正确分组
2. 检查坐标精度设置是否合适
3. 检查当前缩放级别是否满足显示条件

#### Q2: 分散显示时节点重叠

**排查步骤：**
1. 调整 `SPIRAL_RADIUS` 增大偏移距离
2. 检查 `calculateSpiralOffset` 计算是否正确
3. 确认 `pixelOffsetToLngLat` 转换精度

#### Q3: 详情面板位置异常

**排查步骤：**
1. 检查 `ClusterDetailPanel` 的定位样式
2. 确认 `fixed` 定位与地图容器的层级关系
3. 检查是否有其他元素的 `z-index` 冲突

---

## 8. 附录

### 8.1 相关文件索引

| 文件路径 | 说明 |
|----------|------|
| `src/utils/mapRenderer.ts` | 地图渲染工具函数 |
| `src/types/pipeline.ts` | 管网数据类型定义 |
| `src/types/cluster.ts` | 聚合功能类型定义（新增） |
| `src/components/ClusterDetailPanel.tsx` | 详情面板组件（新增） |
| `src/views/GlobalPipelineView.tsx` | 全局管线视图 |
| `docs/pipeline-crossing-proposals.md` | 原始方案提案文档 |

### 8.2 参考资料

1. 高德地图 JavaScript API 文档：https://lbs.amap.com/api/jsapi-v2/summary
2. 阿基米德螺旋线算法：https://en.wikipedia.org/wiki/Archimedean_spiral
3. 地图聚合算法最佳实践

### 8.3 版本历史

| 版本 | 日期 | 修改内容 | 作者 |
|------|------|----------|------|
| 1.0 | 2026-02-13 | 初始版本 | 总结记录者 |

---

**文档结束**
