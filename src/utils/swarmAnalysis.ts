/**
 * 蜂群分析工具 (Swarm Analysis / Beeswarm Plot)
 * 
 * 用于处理密集节点的智能分散布局，相比螺旋分布：
 * 1. 防止节点重叠
 * 2. 保持数据点的相对位置关系
 * 3. 更自然的视觉分布
 */

import type { PipelineNode } from '@/types'

/**
 * 蜂群布局配置
 */
export const SWARM_CONFIG = {
    /** 节点半径（像素） */
    NODE_RADIUS: 12,
    
    /** 节点间距（像素） */
    NODE_PADDING: 4,
    
    /** 最大分散半径（像素） */
    MAX_RADIUS: 150,
    
    /** 轨道层间距（像素） */
    ORBIT_SEPARATION: 28,
    
    /** 最小分散缩放级别 */
    MIN_ZOOM_FOR_SWARM: 10,
    
    /** 使用角度排序（true）或距离排序（false） */
    SORT_BY_ANGLE: true,
} as const

/**
 * 2D点结构
 */
interface Point2D {
    x: number
    y: number
}

/**
 * 蜂群节点位置
 */
export interface SwarmPosition {
    node: PipelineNode
    offsetX: number
    offsetY: number
    orbit: number      // 轨道层级
    angle: number      // 角度（弧度）
    distance: number   // 距离中心的距离
}

/**
 * 计算两点之间的距离
 */
function distance(p1: Point2D, p2: Point2D): number {
    const dx = p1.x - p2.x
    const dy = p1.y - p2.y
    return Math.sqrt(dx * dx + dy * dy)
}

/**
 * 将经纬度转换为像素坐标（简化版，用于相对位置计算）
 * 注意：这只是粗略估算，用于防止重叠
 */
function latLngToPixel(
    coord: { longitude: number; latitude: number },
    center: { longitude: number; latitude: number },
    zoom: number
): Point2D {
    // 在指定缩放级别下，粗略计算像素偏移
    // 在 zoom=10 时，约 1度 ≈ 256 * 2^10 / 360 ≈ 728 像素
    const scale = Math.pow(2, zoom) * 256 / 360
    return {
        x: (coord.longitude - center.longitude) * scale,
        y: (coord.latitude - center.latitude) * scale
    }
}

/**
 * 将像素偏移转换回经纬度偏移
 */
function pixelToLatLngOffset(
    pixel: Point2D,
    zoom: number
): { lng: number; lat: number } {
    const scale = Math.pow(2, zoom) * 256 / 360
    return {
        lng: pixel.x / scale,
        lat: pixel.y / scale
    }
}

/**
 * 计算蜂群布局 - 扫描线算法
 * 
 * 算法思路：
 * 1. 将所有节点按角度（或距离）排序
 * 2. 逐个尝试放置节点
 * 3. 如果与已放置节点重叠，沿径向向外移动
 * 4. 直到找到不重叠的位置或达到最大半径
 */
export function calculateSwarmLayout(
    nodes: PipelineNode[],
    centerCoord: { longitude: number; latitude: number },
    zoom: number
): SwarmPosition[] {
    if (!nodes || nodes.length === 0) return []
    if (nodes.length === 1) {
        return [{
            node: nodes[0],
            offsetX: 0,
            offsetY: 0,
            orbit: 0,
            angle: 0,
            distance: 0
        }]
    }

    const positions: SwarmPosition[] = []
    const placed: { point: Point2D; radius: number }[] = []
    const minDistance = (SWARM_CONFIG.NODE_RADIUS + SWARM_CONFIG.NODE_PADDING) * 2

    // 计算每个节点相对于中心的角度和距离
    const nodesWithMeta = nodes.map(node => {
        const dx = node.coordinate.longitude - centerCoord.longitude
        const dy = node.coordinate.latitude - centerCoord.latitude
        const angle = Math.atan2(dy, dx)
        const dist = Math.sqrt(dx * dx + dy * dy)
        return { node, angle, dist, dx, dy }
    })

    // 按角度排序（使相邻节点在视觉上也相邻）
    nodesWithMeta.sort((a, b) => a.angle - b.angle)

    // 逐个放置节点
    for (const item of nodesWithMeta) {
        let orbit = 0
        let placedSuccessfully = false
        let finalOffset: Point2D = { x: 0, y: 0 }

        // 尝试不同的轨道层级
        while (orbit * SWARM_CONFIG.ORBIT_SEPARATION < SWARM_CONFIG.MAX_RADIUS && !placedSuccessfully) {
            const baseRadius = orbit * SWARM_CONFIG.ORBIT_SEPARATION
            
            // 在该轨道上尝试多个角度偏移
            const angleOffsets = orbit === 0 
                ? [0]  // 中心位置只试一次
                : [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9]  // 尝试不同的角度偏移

            for (const angleOffset of angleOffsets) {
                const testAngle = item.angle + angleOffset
                const testX = baseRadius * Math.cos(testAngle)
                const testY = baseRadius * Math.sin(testAngle)
                const testPoint: Point2D = { x: testX, y: testY }

                // 检查是否与已放置节点重叠
                let hasOverlap = false
                for (const p of placed) {
                    if (distance(testPoint, p.point) < minDistance) {
                        hasOverlap = true
                        break
                    }
                }

                if (!hasOverlap) {
                    finalOffset = testPoint
                    placedSuccessfully = true
                    break
                }
            }

            if (placedSuccessfully) break
            orbit++
        }

        // 如果没找到位置，使用最外层轨道
        if (!placedSuccessfully) {
            const maxOrbit = Math.floor(SWARM_CONFIG.MAX_RADIUS / SWARM_CONFIG.ORBIT_SEPARATION)
            const angleIndex = positions.length % 8  // 8个方向
            const angleOffset = (angleIndex / 8) * Math.PI * 2
            const radius = maxOrbit * SWARM_CONFIG.ORBIT_SEPARATION
            finalOffset = {
                x: radius * Math.cos(item.angle + angleOffset),
                y: radius * Math.sin(item.angle + angleOffset)
            }
            orbit = maxOrbit
        }

        placed.push({ 
            point: finalOffset, 
            radius: SWARM_CONFIG.NODE_RADIUS 
        })

        positions.push({
            node: item.node,
            offsetX: finalOffset.x,
            offsetY: finalOffset.y,
            orbit,
            angle: item.angle,
            distance: Math.sqrt(finalOffset.x * finalOffset.x + finalOffset.y * finalOffset.y)
        })
    }

    return positions
}

/**
 * 简化的蜂群布局 - 同心圆算法
 * 性能更好，适合节点数较多的情况
 */
export function calculateOrbitLayout(
    nodes: PipelineNode[],
    centerCoord: { longitude: number; latitude: number }
): SwarmPosition[] {
    if (!nodes || nodes.length === 0) return []
    if (nodes.length === 1) {
        return [{
            node: nodes[0],
            offsetX: 0,
            offsetY: 0,
            orbit: 0,
            angle: 0,
            distance: 0
        }]
    }

    const positions: SwarmPosition[] = []
    const angleStep = (2 * Math.PI) / Math.min(nodes.length, 6)  // 每圈最多6个节点
    
    nodes.forEach((node, index) => {
        // 计算所在圈和在该圈中的位置
        const orbit = Math.floor(index / 6)  // 每圈6个节点
        const indexInOrbit = index % 6
        
        // 添加随机偏移，避免完全对齐
        const randomOffset = (index * 0.1) % 0.3
        const angle = angleStep * indexInOrbit + randomOffset
        
        const radius = (orbit + 1) * SWARM_CONFIG.ORBIT_SEPARATION
        
        positions.push({
            node,
            offsetX: radius * Math.cos(angle),
            offsetY: radius * Math.sin(angle),
            orbit,
            angle,
            distance: radius
        })
    })

    return positions
}

/**
 * 力导向布局 - 模拟物理力使节点分散
 * 效果最自然，但计算量较大
 */
export function calculateForceLayout(
    nodes: PipelineNode[],
    centerCoord: { longitude: number; latitude: number },
    iterations: number = 30
): SwarmPosition[] {
    if (!nodes || nodes.length === 0) return []
    if (nodes.length === 1) {
        return [{
            node: nodes[0],
            offsetX: 0,
            offsetY: 0,
            orbit: 0,
            angle: 0,
            distance: 0
        }]
    }

    // 初始化位置（随机分布在中心周围）
    const positions = nodes.map((node, i) => {
        const angle = (i / nodes.length) * Math.PI * 2
        const radius = 20 + Math.random() * 20
        return {
            node,
            x: radius * Math.cos(angle),
            y: radius * Math.sin(angle),
            vx: 0,
            vy: 0
        }
    })

    const repulsionForce = 500  // 斥力强度
    const springLength = SWARM_CONFIG.NODE_RADIUS * 2 + SWARM_CONFIG.NODE_PADDING
    const damping = 0.8  // 阻尼系数

    // 迭代计算力
    for (let iter = 0; iter < iterations; iter++) {
        // 计算斥力（节点间相互排斥）
        for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
                const p1 = positions[i]
                const p2 = positions[j]
                const dx = p1.x - p2.x
                const dy = p1.y - p2.y
                const dist = Math.sqrt(dx * dx + dy * dy) || 1

                if (dist < springLength * 2) {
                    const force = repulsionForce / (dist * dist)
                    const fx = (dx / dist) * force
                    const fy = (dy / dist) * force

                    p1.vx += fx
                    p1.vy += fy
                    p2.vx -= fx
                    p2.vy -= fy
                }
            }
        }

        // 计算向中心的引力（防止节点飞太远）
        for (const p of positions) {
            const dist = Math.sqrt(p.x * p.x + p.y * p.y)
            if (dist > 0) {
                const force = 0.5  // 引力强度
                p.vx -= (p.x / dist) * force
                p.vy -= (p.y / dist) * force
            }
        }

        // 更新位置和速度
        for (const p of positions) {
            p.vx *= damping
            p.vy *= damping
            p.x += p.vx
            p.y += p.vy

            // 限制最大距离
            const maxDist = SWARM_CONFIG.MAX_RADIUS
            const dist = Math.sqrt(p.x * p.x + p.y * p.y)
            if (dist > maxDist) {
                p.x = (p.x / dist) * maxDist
                p.y = (p.y / dist) * maxDist
            }
        }
    }

    // 转换为输出格式
    return positions.map(p => {
        const angle = Math.atan2(p.y, p.x)
        const distance = Math.sqrt(p.x * p.x + p.y * p.y)
        const orbit = Math.floor(distance / SWARM_CONFIG.ORBIT_SEPARATION)
        
        return {
            node: p.node,
            offsetX: p.x,
            offsetY: p.y,
            orbit,
            angle,
            distance
        }
    })
}

/**
 * 像素偏移转换为经纬度
 */
export function swarmOffsetToLatLng(
    offsetX: number,
    offsetY: number,
    zoom: number
): { longitude: number; latitude: number } {
    const scale = Math.pow(2, zoom) * 256 / 360
    return {
        longitude: offsetX / scale,
        latitude: -offsetY / scale  // Y轴向下为正，纬度向上为正
    }
}

/**
 * 根据节点数量选择最佳算法
 */
export function calculateOptimalSwarmLayout(
    nodes: PipelineNode[],
    centerCoord: { longitude: number; latitude: number },
    zoom: number
): SwarmPosition[] {
    const count = nodes.length
    
    if (count <= 3) {
        // 少量节点：简单同心圆
        return calculateOrbitLayout(nodes, centerCoord)
    } else if (count <= 15) {
        // 中等数量：蜂群扫描线算法
        return calculateSwarmLayout(nodes, centerCoord, zoom)
    } else {
        // 大量节点：力导向算法
        return calculateForceLayout(nodes, centerCoord, 20)
    }
}

// -----------------------------------------------------------------------------
// 蜂群分析统计
// -----------------------------------------------------------------------------

/**
 * 蜂群分析统计结果
 */
export interface SwarmAnalysisStats {
    totalNodes: number
    maxOrbit: number
    avgDistance: number
    density: number  // 节点密度（节点数/面积）
    overlapCount: number  // 估计的重叠数
    distributionQuality: 'excellent' | 'good' | 'fair' | 'poor'
}

/**
 * 分析蜂群布局质量
 */
export function analyzeSwarmQuality(positions: SwarmPosition[]): SwarmAnalysisStats {
    if (!positions || positions.length === 0) {
        return {
            totalNodes: 0,
            maxOrbit: 0,
            avgDistance: 0,
            density: 0,
            overlapCount: 0,
            distributionQuality: 'excellent'
        }
    }

    const totalNodes = positions.length
    const maxOrbit = Math.max(...positions.map(p => p.orbit))
    const avgDistance = positions.reduce((sum, p) => sum + p.distance, 0) / totalNodes
    
    // 计算估计的覆盖面积（圆形）
    const maxRadius = Math.max(...positions.map(p => p.distance)) + SWARM_CONFIG.NODE_RADIUS
    const area = Math.PI * maxRadius * maxRadius
    const density = area > 0 ? totalNodes / area : 0

    // 估计重叠数（简化计算）
    const minRequiredArea = totalNodes * Math.PI * SWARM_CONFIG.NODE_RADIUS * SWARM_CONFIG.NODE_RADIUS
    const overlapCount = area < minRequiredArea ? Math.ceil((minRequiredArea - area) / (Math.PI * SWARM_CONFIG.NODE_RADIUS * SWARM_CONFIG.NODE_RADIUS)) : 0

    // 评估分布质量
    let distributionQuality: 'excellent' | 'good' | 'fair' | 'poor' = 'good'
    if (overlapCount === 0 && maxOrbit <= 2) {
        distributionQuality = 'excellent'
    } else if (overlapCount === 0 && maxOrbit <= 4) {
        distributionQuality = 'good'
    } else if (overlapCount <= totalNodes * 0.1) {
        distributionQuality = 'fair'
    } else {
        distributionQuality = 'poor'
    }

    return {
        totalNodes,
        maxOrbit,
        avgDistance,
        density,
        overlapCount,
        distributionQuality
    }
}

/**
 * 按类型统计节点分布
 */
export function analyzeNodesByType(
    positions: SwarmPosition[]
): Record<string, { count: number; avgOrbit: number }> {
    const stats: Record<string, { count: number; totalOrbit: number; avgOrbit: number }> = {}

    for (const pos of positions) {
        const nodeName = pos.node.name
        let type = '其他'
        
        if (nodeName.includes('压气站')) type = '压气站'
        else if (nodeName.includes('分输站') || nodeName.includes('门站')) type = '分输站'
        else if (nodeName.includes('阀室') || nodeName.includes('阀门')) type = '阀室'
        else if (nodeName.includes('首站') || nodeName.includes('末站')) type = '站场'

        if (!stats[type]) {
            stats[type] = { count: 0, totalOrbit: 0, avgOrbit: 0 }
        }
        stats[type].count++
        stats[type].totalOrbit += pos.orbit
    }

    // 计算平均值
    for (const type in stats) {
        stats[type].avgOrbit = stats[type].count > 0 
            ? stats[type].totalOrbit / stats[type].count 
            : 0
    }

    return stats
}
