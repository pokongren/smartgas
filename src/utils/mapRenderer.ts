import type { PipelineNode, PipelineLine, PipelineDevice } from '@/types'
import { NodeType, PipelineStatus, PressureLevel, DeviceType } from '@/types'
import type { ClusterGroup, ClusterClickEvent } from '@/types/cluster'

/**
 * 地图渲染工具函数 - 性能优化版
 * 用于在高德地图上渲染管网数据
 * 
 * 优化点：
 * 1. 分批渲染，避免阻塞主线程
 * 2. 缓存聚合计算结果
 * 3. 使用 requestAnimationFrame
 */

/**
 * 聚合渲染配置参数
 */
const CLUSTER_CONFIG = {
    /** 坐标分组精度（小数位数） */
    COORDINATE_PRECISION: 6,

    /** 阀室最小显示缩放级别（zoom < 此值时隐藏所有阀室节点） */
    VALVE_MIN_ZOOM: 11,

    /** 分散显示缩放级别阈值 */
    EXPAND_CLUSTER_ZOOM: 12,

    /** 螺旋偏移半径（像素） */
    SPIRAL_RADIUS: 40,

    /** 螺旋偏移间距（像素） */
    SPIRAL_SEPARATION: 30,

    /** 聚合标记最大显示数量 */
    MAX_CLUSTER_COUNT: 99,

    /** 聚合标记颜色 */
    CLUSTER_COLORS: {
        FEW: '#3b82f6',      // 1-5个节点：蓝色
        MEDIUM: '#f59e0b',   // 6-15个节点：橙色
        MANY: '#ef4444'      // 16+个节点：红色
    },

    /** 蜂群布局算法 */
    SWARM_ALGORITHM: 'optimal' as 'spiral' | 'swarm' | 'orbit' | 'force' | 'optimal'
} as const

// 压力等级颜色映射
export const PRESSURE_COLORS = {
    [PressureLevel.HIGH]: '#ef4444',           // 红色 - 高压
    [PressureLevel.MEDIUM_HIGH]: '#f97316',    // 橙色 - 次高压
    [PressureLevel.MEDIUM]: '#eab308',         // 黄色 - 中压
    [PressureLevel.LOW]: '#22c55e',            // 绿色 - 低压
} as const

/**
 * 压气站图标配置 - 右小左宽梯形
 */
const COMPRESSOR_ICON_CONFIG = {
    WIDTH: 22,
    HEIGHT: 16,
    COLOR: '#00d4ff',
    DPR: Math.min(window.devicePixelRatio || 1, 2),
} as const

/**
 * 注入地图标记样式
 */
function injectMarkerStyles() {
    const styleId = 'pipeline-marker-styles'
    if (document.getElementById(styleId)) return

    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
        /* 压气站标记容器 - 无动画 */
        .compressor-marker-container {
            position: relative;
            width: ${COMPRESSOR_ICON_CONFIG.WIDTH}px;
            height: ${COMPRESSOR_ICON_CONFIG.HEIGHT}px;
            display: flex;
            justify-content: center;
            align-items: center;
            cursor: pointer;
        }
        
        /* 压气站图标 */
        .compressor-marker-icon {
            width: ${COMPRESSOR_ICON_CONFIG.WIDTH}px;
            height: ${COMPRESSOR_ICON_CONFIG.HEIGHT}px;
            object-fit: contain;
            pointer-events: none;
        }

        /* 聚合标记样式 */
        .pipeline-cluster-marker {
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .pipeline-cluster-marker:hover {
            transform: scale(1.1);
            z-index: 200;
        }
        .cluster-indicator {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            font-size: 10px;
            color: white;
            font-weight: bold;
            border: 1px solid rgba(255,255,255,0.8);
        }
        .cluster-indicator.compressor { background: #06b6d4; }
        .cluster-indicator.distribution { background: #eab308; }
        .cluster-indicator.valve { background: #6b7280; }
    `
    document.head.appendChild(style)
}

// 立即注入样式
injectMarkerStyles()

// 状态颜色映射
export const STATUS_COLORS = {
    [PipelineStatus.NORMAL]: '#22c55e',        // 绿色 - 正常
    [PipelineStatus.MAINTENANCE]: '#eab308',   // 黄色 - 维护中
    [PipelineStatus.FAULT]: '#ef4444',         // 红色 - 故障
    [PipelineStatus.DISABLED]: '#6b7280',      // 灰色 - 已停用
} as const

// 管线类别颜色映射(深色主题优化)
export const PIPELINE_CATEGORY_COLORS: Record<string, string> = {
    '西一线': '#FF5722',
    '中缅线': '#4caf50',
    '中缅支线': '#8bc34a',
    '中贵线': '#00d4ff',
    '西二线': '#ff9800',
    '西三线': '#9c27b0',
    '西四线': '#e040fb',
    '西气东输四线': '#e040fb',
    '陕二线': '#4caf50',
    '阿拉支干线': '#00bcd4',
    '闽粤支干线': '#e91e63',
    '广南/广西': '#ff00ff',
    '广南支干线': '#ff5722',
    '广深支干线': '#9c27b0',
    '广西管道': '#00bcd4',
    '海南': '#00ff00',
    'LNG外输': '#ffff00',
    '中俄东线': '#e91e63',
    '平泰支干线': '#E91E63',
    '陕京四线': '#00d4ff',
    '陕京四线支线': '#8bc34a',
    '其他': '#999999',
}

/**
 * 获取压力等级对应的颜色
 */
export function getPressureLevelColor(level: PressureLevel): string {
    return PRESSURE_COLORS[level] || '#ffffff'
}

/**
 * 获取状态对应的颜色
 */
export function getStatusColor(status: PipelineStatus): string {
    return STATUS_COLORS[status] || '#ffffff'
}

/**
 * 获取管线类别对应的颜色
 */
export function getPipelineCategoryColor(category: string): string {
    const normalizedCategory = category.trim()
    if (PIPELINE_CATEGORY_COLORS[normalizedCategory]) {
        return PIPELINE_CATEGORY_COLORS[normalizedCategory]
    }
    if (normalizedCategory.includes('支线')) {
        return PIPELINE_CATEGORY_COLORS['中缅支线']
    }
    return PIPELINE_CATEGORY_COLORS['其他']
}

/**
 * 获取节点类型对应的图标
 */
export function getNodeIcon(type: NodeType, isSource: boolean = false, isCompressor: boolean = false): string {
    if (isSource) return 'diamond'
    if (isCompressor) return 'rect'

    switch (type) {
        case NodeType.VALVE: return 'triangle'
        case NodeType.REGULATOR: return 'rect'
        case NodeType.METERING: return 'pin'
        case NodeType.JUNCTION: return 'circle'
        default: return 'circle'
    }
}

/**
 * 获取节点类型名称
 */
export function getNodeTypeName(type: NodeType): string {
    const names = {
        [NodeType.VALVE]: '阀门',
        [NodeType.REGULATOR]: '调压站',
        [NodeType.METERING]: '计量站',
        [NodeType.JUNCTION]: '连接点',
        [NodeType.INTERFACE]: '接口',
    }
    return names[type] || '未知'
}

/**
 * 获取状态名称
 */
export function getStatusName(status: PipelineStatus): string {
    const names = {
        [PipelineStatus.NORMAL]: '正常',
        [PipelineStatus.MAINTENANCE]: '维护中',
        [PipelineStatus.FAULT]: '故障',
        [PipelineStatus.DISABLED]: '已停用',
    }
    return names[status] || '未知'
}

/**
 * 获取压力等级名称
 */
export function getPressureLevelName(level: PressureLevel): string {
    const names = {
        [PressureLevel.HIGH]: '高压',
        [PressureLevel.MEDIUM_HIGH]: '次高压',
        [PressureLevel.MEDIUM]: '中压',
        [PressureLevel.LOW]: '低压',
    }
    return names[level] || '未知'
}

// -----------------------------------------------------------------------------
// 聚合与螺旋分布逻辑 - 带缓存优化
// -----------------------------------------------------------------------------

// 缓存：坐标分组结果
let cachedClusterGroups: Map<string, ClusterGroup> | null = null
let cachedNodesKey: string = ''

/**
 * 将坐标转换为分组键
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
 * 生成节点缓存键
 */
function generateNodesKey(nodes: PipelineNode[]): string {
    return `${nodes.length}-${nodes[0]?.id || ''}-${nodes[nodes.length - 1]?.id || ''}`
}

/**
 * 按坐标分组节点 - 带缓存
 */
function groupNodesByCoordinate(nodes: PipelineNode[]): Map<string, ClusterGroup> {
    // 检查缓存
    const nodesKey = generateNodesKey(nodes)
    if (cachedClusterGroups && cachedNodesKey === nodesKey) {
        return cachedClusterGroups
    }

    const groups = new Map<string, ClusterGroup>()

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
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
    }

    // 更新缓存
    cachedClusterGroups = groups
    cachedNodesKey = nodesKey

    return groups
}

/**
 * 清除聚合缓存
 */
export function clearClusterCache(): void {
    cachedClusterGroups = null
    cachedNodesKey = ''
}

// -----------------------------------------------------------------------------
// 节点拖拽映射管理器
// NOTE: 维护 nodeId → marker 和 nodeId → polylines 的映射关系
//       拖拽节点时通过映射表查找关联管线并实时更新路径
// -----------------------------------------------------------------------------

/** nodeId → AMap.Marker 实例 */
const nodeMarkerMap = new Map<string, any>()

/** nodeId → 关联的 polyline 及其角色（start=管线起点 / end=管线终点） */
const nodePolylinesMap = new Map<string, { polyline: any; role: 'start' | 'end'; line: PipelineLine }[]>()

/**
 * 将管线注册到节点拖拽映射表
 * 渲染管线时调用，建立 nodeId → polylines 的关联
 */
function registerPolylineMapping(line: PipelineLine, polyline: any): void {
    // 注册起点
    if (line.startNodeId) {
        if (!nodePolylinesMap.has(line.startNodeId)) {
            nodePolylinesMap.set(line.startNodeId, [])
        }
        nodePolylinesMap.get(line.startNodeId)!.push({ polyline, role: 'start', line })
    }
    // 注册终点
    if (line.endNodeId) {
        if (!nodePolylinesMap.has(line.endNodeId)) {
            nodePolylinesMap.set(line.endNodeId, [])
        }
        nodePolylinesMap.get(line.endNodeId)!.push({ polyline, role: 'end', line })
    }
}

/**
 * 节点拖拽时更新所有关联管线的端点
 * @param nodeId 被拖拽的节点 ID
 * @param newLng 新的经度
 * @param newLat 新的纬度
 */
function updateConnectedPolylines(nodeId: string, newLng: number, newLat: number): void {
    const connections = nodePolylinesMap.get(nodeId)
    if (!connections) return

    for (let i = 0; i < connections.length; i++) {
        const { polyline, role } = connections[i]
        try {
            const currentPath = polyline.getPath()
            if (!currentPath || currentPath.length < 2) continue

            // 将 AMap.LngLat 数组转为普通数组
            const pathArr = currentPath.map((p: any) => [p.lng || p.getLng(), p.lat || p.getLat()])

            if (role === 'start') {
                // 更新管线起点
                pathArr[0] = [newLng, newLat]
            } else {
                // 更新管线终点
                pathArr[pathArr.length - 1] = [newLng, newLat]
            }

            polyline.setPath(pathArr)
        } catch (e) {
            // 更新失败时静默忽略
        }
    }
}

/**
 * 清除拖拽映射表
 * 在重新渲染或销毁时调用
 */
export function clearDragMappings(): void {
    nodeMarkerMap.clear()
    nodePolylinesMap.clear()
}

/**
 * 使用 Canvas 绘制压气站梯形图标 - 右小左宽
 * @returns DataURL 格式的图片
 */
export function createCompressorIcon(): string {
    const { WIDTH, HEIGHT, COLOR, DPR } = COMPRESSOR_ICON_CONFIG
    const canvas = document.createElement('canvas')

    canvas.width = WIDTH * DPR
    canvas.height = HEIGHT * DPR
    canvas.style.width = `${WIDTH}px`
    canvas.style.height = `${HEIGHT}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return ''

    ctx.scale(DPR, DPR)

    const w = WIDTH
    const h = HEIGHT

    // 等腰梯形：上底短，下底长，两腰等长对称
    const topWidth = w * 0.5      // 上底宽度 50%
    const bottomWidth = w         // 下底宽度 100%
    const topLeft = (w - topWidth) / 2   // 上底居中
    const topRight = topLeft + topWidth
    const bottomLeft = 0
    const bottomRight = w

    // 绘制等腰梯形
    ctx.beginPath()
    ctx.moveTo(topLeft, 0)           // 左上
    ctx.lineTo(topRight, 0)          // 右上
    ctx.lineTo(bottomRight, h)       // 右下
    ctx.lineTo(bottomLeft, h)        // 左下
    ctx.closePath()

    // 渐变填充（从上到下）
    const gradient = ctx.createLinearGradient(0, 0, 0, h)
    gradient.addColorStop(0, '#00e5ff')   // 顶部亮色
    gradient.addColorStop(0.5, COLOR)      // 中间
    gradient.addColorStop(1, '#0099cc')   // 底部深色
    ctx.fillStyle = gradient
    ctx.fill()

    // 边框
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.stroke()

    return canvas.toDataURL('image/png')
}

/**
 * 使用 SVG 绘制矢量压气站图标 - 短边在右侧
 * @returns SVG DataURL
 */
export function createCompressorIconSVG(): string {
    const { WIDTH, HEIGHT, COLOR } = COMPRESSOR_ICON_CONFIG
    const rightTop = HEIGHT * 0.3
    const rightBottom = HEIGHT * 0.7

    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
        <defs>
            <linearGradient id="trapezoidGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#00e5ff;stop-opacity:1" />
                <stop offset="50%" style="stop-color:${COLOR};stop-opacity:1" />
                <stop offset="100%" style="stop-color:#0099cc;stop-opacity:1" />
            </linearGradient>
        </defs>
        <polygon points="0,0 0,${HEIGHT} ${WIDTH},${rightBottom} ${WIDTH},${rightTop}" 
                 fill="url(#trapezoidGrad)" 
                 stroke="rgba(255,255,255,0.5)" 
                 stroke-width="1"/>
    </svg>`

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// 缓存图标 DataURL，避免重复绘制
let cachedCompressorIcon: string | null = null

/**
 * 获取压气站图标（带缓存）
 */
function getCompressorIcon(): string {
    if (!cachedCompressorIcon) {
        // 优先使用 Canvas，兼容性更好；如需最高清晰度可改用 SVG
        cachedCompressorIcon = createCompressorIcon()
    }
    return cachedCompressorIcon
}

/**
 * 计算螺旋偏移位置
 * 使用阿基米德螺旋线算法：r = a + b * θ
 */
function calculateSpiralOffset(
    index: number,
    total: number,
    radius: number = CLUSTER_CONFIG.SPIRAL_RADIUS
): { x: number; y: number } {
    const angleStep = (2 * Math.PI) / Math.max(total, 6)
    const angle = angleStep * index
    const spiralRadius = radius + (CLUSTER_CONFIG.SPIRAL_SEPARATION * (index / Math.max(total, 1)))

    return {
        x: spiralRadius * Math.cos(angle),
        y: spiralRadius * Math.sin(angle)
    }
}

/**
 * 像素偏移转换为经纬度偏移
 */
function pixelOffsetToLngLat(
    map: any,
    center: { longitude: number; latitude: number },
    offsetX: number,
    offsetY: number
): { longitude: number; latitude: number } {
    const AMap = (window as any).AMap
    if (!AMap) return center

    const zoom = map.getZoom()
    const scale = Math.pow(2, 18 - zoom)
    const lngOffset = (offsetX * scale * 0.00001)
    const latOffset = (offsetY * scale * 0.00001)

    return {
        longitude: center.longitude + lngOffset,
        latitude: center.latitude - latOffset
    }
}

/**
 * 创建聚合标记内容
 */
function createClusterMarkerContent(group: ClusterGroup): string {
    const count = group.nodes.length
    const { typeStats } = group

    let color: string = CLUSTER_CONFIG.CLUSTER_COLORS.FEW
    if (count > 15) {
        color = CLUSTER_CONFIG.CLUSTER_COLORS.MANY
    } else if (count > 5) {
        color = CLUSTER_CONFIG.CLUSTER_COLORS.MEDIUM
    }

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
            cursor: pointer;
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

    if (onClick) {
        marker.on('click', (e: any) => {
            onClick({
                cluster: group,
                position: group.coordinate,
                originalEvent: e
            })
        })
    }

    return marker
}

/**
 * 创建压气站标记内容（Canvas/SVG 高清晰度版）
 */
function createCompressorMarkerContent(rotation: number = 0): HTMLElement {
    // 创建容器
    const container = document.createElement('div')
    container.className = 'compressor-marker-container'
    container.style.transform = `rotate(${rotation}deg)`

    // 图标（无动画、无发光层、无阴影）
    const icon = document.createElement('img')
    icon.className = 'compressor-marker-icon'
    icon.src = getCompressorIcon()
    icon.alt = '压气站'
    container.appendChild(icon)

    return container
}

/**
 * 创建圆形节点的 HTML 内容
 * NOTE: 由于 AMap.CircleMarker 不支持 draggable，统一使用 AMap.Marker + HTML 模拟
 */
function createCircleNodeContent(color: string, size: number, strokeColor: string, strokeWidth: number): string {
    return `<div style="
        width: ${size * 2}px;
        height: ${size * 2}px;
        border-radius: 50%;
        background: ${color};
        border: ${strokeWidth}px solid ${strokeColor};
        cursor: move;
        box-shadow: 0 0 6px rgba(0,0,0,0.4);
    "></div>`
}

/**
 * 创建偏移后的节点标记 — 可拖拽版
 * 所有节点统一使用 AMap.Marker（支持 draggable），拖拽时关联管线自动跟随
 */
function createOffsetNodeMarker(
    map: any,
    node: PipelineNode,
    position: { longitude: number; latitude: number },
    onClick?: (event: { node: PipelineNode; position: any }) => void
): any[] {
    const AMap = (window as any).AMap
    if (!AMap) return []

    const isCompressor = node.name.includes('压气站')
    const isDistribution = node.name.includes('分输站') || node.name.includes('门站')

    let marker: any
    let markerSize: number  // 用于计算 offset 居中

    if (isCompressor) {
        const rotation = node.properties?.rotation || 0
        const content = createCompressorMarkerContent(rotation)
        markerSize = COMPRESSOR_ICON_CONFIG.WIDTH

        marker = new AMap.Marker({
            position: [position.longitude, position.latitude],
            content: content,
            offset: new AMap.Pixel(
                -COMPRESSOR_ICON_CONFIG.WIDTH / 2,
                -COMPRESSOR_ICON_CONFIG.HEIGHT / 2
            ),
            draggable: true,
            cursor: 'move',
            zIndex: 140,
            extData: { node }
        })
    } else if (isDistribution) {
        markerSize = 16
        marker = new AMap.Marker({
            position: [position.longitude, position.latitude],
            content: createCircleNodeContent('#ffd700', 8, '#ffffff', 2),
            offset: new AMap.Pixel(-markerSize / 2, -markerSize / 2),
            draggable: true,
            cursor: 'move',
            zIndex: 130,
            extData: { node }
        })
    } else {
        markerSize = 10
        marker = new AMap.Marker({
            position: [position.longitude, position.latitude],
            content: createCircleNodeContent('#e0e0e0', 5, '#666', 1),
            offset: new AMap.Pixel(-markerSize / 2, -markerSize / 2),
            draggable: true,
            cursor: 'move',
            zIndex: 120,
            extData: { node }
        })
    }

    // 注册到映射表，方便管线查找对应 marker
    nodeMarkerMap.set(node.id, marker)

    // 标签（也跟随拖拽移动）
    const text = new AMap.Text({
        text: node.name,
        position: [position.longitude, position.latitude],
        offset: isCompressor
            ? new AMap.Pixel(0, COMPRESSOR_ICON_CONFIG.HEIGHT / 2 + 5)
            : new AMap.Pixel(0, -15),
        style: {
            'font-size': '10px',
            'color': '#ccc',
            'background-color': 'rgba(0,0,0,0.5)',
            'border-radius': '2px',
            'padding': '1px 3px',
            'border': 'none'
        },
        zIndex: 121
    })

    // NOTE: dragging 事件实时触发，拖拽过程中管线跟随移动
    marker.on('dragging', (e: any) => {
        const lng = e.lnglat.getLng()
        const lat = e.lnglat.getLat()
        // 更新关联管线端点
        updateConnectedPolylines(node.id, lng, lat)
        // 标签跟随移动
        text.setPosition([lng, lat])
    })

    if (onClick && marker) {
        marker.on('click', () => {
            const pos = marker.getPosition()
            onClick({ node, position: { longitude: pos.getLng(), latitude: pos.getLat() } })
        })
    }

    return [marker, text]
}

// -----------------------------------------------------------------------------
// 分批渲染管线 - 性能优化核心
// -----------------------------------------------------------------------------

/**
 * 分批渲染管线
 * 使用 requestAnimationFrame 避免阻塞主线程
 */
export function renderPipelineLines(
    map: any,
    lines: PipelineLine[],
    onLineClick?: (event: { line: PipelineLine; position: { longitude: number; latitude: number } }) => void,
    signal?: AbortSignal
): Promise<any[]> {
    return new Promise((resolve) => {
        const AMap = (window as any).AMap
        if (!AMap || !lines || lines.length === 0) {
            resolve([])
            return
        }

        const polylines: any[] = []
        const BATCH_SIZE = 50 // 每批渲染50条管线
        let index = 0

        function renderBatch() {
            // NOTE: 检查是否已取消，防止旧渲染继续往地图加覆盖物
            if (signal?.aborted) {
                resolve(polylines)
                return
            }
            const batchEnd = Math.min(index + BATCH_SIZE, lines.length)

            for (let i = index; i < batchEnd; i++) {
                const line = lines[i]
                try {
                    const category = line.properties?.category as string || '其他'
                    const color = line.properties?.color || getPipelineCategoryColor(category)
                    const strokeStyle = line.status === PipelineStatus.MAINTENANCE ? 'dashed' : 'solid'
                    const isBranch = category.includes('支线')
                    const baseWidth = isBranch ? 2 : (line.pressureLevel === PressureLevel.HIGH ? 6 : 4)
                    const path = line.path.map(p => [p.longitude, p.latitude])

                    const polyline = new AMap.Polyline({
                        path: path,
                        strokeColor: color,
                        strokeWeight: baseWidth,
                        strokeStyle: strokeStyle,
                        strokeOpacity: 1.0,
                        zIndex: 50,
                        lineJoin: 'round',
                        lineCap: 'round',
                    })

                    if (onLineClick) {
                        polyline.on('click', (e: any) => {
                            onLineClick({ line, position: { longitude: e.lnglat.lng, latitude: e.lnglat.lat } })
                        })
                    }

                    // NOTE: 注册到拖拽映射表，使节点拖动时能联动更新此管线
                    registerPolylineMapping(line, polyline)

                    map.add(polyline)
                    polylines.push(polyline)

                    // 仅为主要管段创建流动动画
                    if (line.length > 30000) {
                        const flowMarker = createFlowAnimation(map, line, color)
                        if (flowMarker) {
                            polylines.push(flowMarker)
                        }
                    }
                } catch (error) {
                    // 渲染失败，继续下一条
                }
            }

            index = batchEnd

            if (index < lines.length) {
                // 还有未渲染的，下一帧继续
                requestAnimationFrame(renderBatch)
            } else {
                // 全部渲染完成
                resolve(polylines)
            }
        }

        // 开始渲染
        requestAnimationFrame(renderBatch)
    })
}

function createFlowAnimation(map: any, line: PipelineLine, color: string): any {
    const AMap = (window as any).AMap
    if (!AMap || line.path.length < 2) return null

    const flowMarker = new AMap.Marker({
        position: [line.path[0].longitude, line.path[0].latitude],
        icon: new AMap.Icon({
            size: new AMap.Size(8, 8),
            image: createFlowDot(color),
            imageSize: new AMap.Size(8, 8),
        }),
        offset: new AMap.Pixel(-4, -4),
        zIndex: 100,
    })

    map.add(flowMarker)

    const path = line.path.map(p => [p.longitude, p.latitude])
    const speed = Math.max(50, line.length * 0.5)

    const startAnimation = () => {
        flowMarker.moveAlong(path, {
            duration: (line.length / speed) * 1000,
            autoRotation: false,
        })
    }

    flowMarker.on('movealong', startAnimation)
    startAnimation()

    return flowMarker
}

function createFlowDot(color: string): string {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d')

    if (!ctx) return ''

    const gradient = ctx.createRadialGradient(4, 4, 0, 4, 4, 4)
    gradient.addColorStop(0, color)
    gradient.addColorStop(0.5, color + 'cc')
    gradient.addColorStop(1, color + '00')

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 8, 8)

    return canvas.toDataURL()
}

function isValveRoom(node: PipelineNode): boolean {
    if (node.type === NodeType.VALVE) return true
    const nodeName = node.name || ''
    return nodeName.includes('阀室') || nodeName.includes('阀门') || nodeName.includes('#')
}

// -----------------------------------------------------------------------------
// 分批渲染节点 - 性能优化核心
// -----------------------------------------------------------------------------

/**
 * 渲染管网节点（新版，支持智能聚合）- 分批渲染
 */
export function renderPipelineNodesWithClustering(
    map: any,
    nodes: PipelineNode[],
    sourceNodes: string[] = [],
    compressorStations: string[] = [],
    onNodeClick?: (event: { node: PipelineNode; position: any }) => void,
    onClusterClick?: (event: ClusterClickEvent) => void,
    signal?: AbortSignal
): Promise<any[]> {
    return new Promise((resolve) => {
        const AMap = (window as any).AMap
        if (!AMap || !nodes || nodes.length === 0) {
            resolve([])
            return
        }

        const overlays: any[] = []
        const currentZoom = map.getZoom()

        // 阀室全局过滤：在分组前就移除阀室节点，防止它们出现在任何渲染分支中
        const filteredNodes = currentZoom < CLUSTER_CONFIG.VALVE_MIN_ZOOM
            ? nodes.filter(n => !isValveRoom(n))
            : nodes

        // 1. 按坐标分组（带缓存）
        const clusterGroups = groupNodesByCoordinate(filteredNodes)

        // 2. 分批渲染聚合组
        const groups = Array.from(clusterGroups.values())
        const BATCH_SIZE = 10 // 每批处理10个聚合组
        let index = 0

        function renderBatch() {
            // NOTE: 检查是否已取消，防止旧渲染继续往地图加覆盖物
            if (signal?.aborted) {
                resolve(overlays)
                return
            }
            const batchEnd = Math.min(index + BATCH_SIZE, groups.length)

            for (let i = index; i < batchEnd; i++) {
                const group = groups[i]

                try {
                    if (group.nodes.length === 1) {
                        const node = group.nodes[0]

                        // 阀室隐藏机制：低缩放级别下阀室节点跳过创建
                        if (isValveRoom(node) && currentZoom < CLUSTER_CONFIG.VALVE_MIN_ZOOM) {
                            continue
                        }

                        const markers = createOffsetNodeMarker(map, node, node.coordinate, onNodeClick)
                        if (markers && markers.length > 0) {
                            map.add(markers)
                            overlays.push(...markers)
                        }
                    }
                    else if (currentZoom >= CLUSTER_CONFIG.EXPAND_CLUSTER_ZOOM) {
                        // 高缩放级别：使用轻量化极简黄金螺旋展开（极简高效，自适应任意多的密度）
                        const nodeCount = group.nodes.length
                        const scale = Math.pow(2, currentZoom) * 256 / 360

                        // 黄金角（约 137.5 度），用于生成向日葵式均匀螺旋布局
                        const goldenAngle = Math.PI * (3 - Math.sqrt(5))

                        for (let idx = 0; idx < nodeCount; idx++) {
                            const node = group.nodes[idx]

                            // 阀室隐藏机制：低缩放级别下阀室节点跳过创建
                            if (isValveRoom(node) && currentZoom < CLUSTER_CONFIG.VALVE_MIN_ZOOM) {
                                continue
                            }

                            // 轻量级自适应不重叠算法：角度步进黄金角，距离按索引平方根递增
                            const angle = idx * goldenAngle
                            const offsetDistance = nodeCount <= 1 ? 0 : 28 + Math.sqrt(idx) * 20

                            // 计算偏移位置
                            const offsetX = Math.cos(angle) * offsetDistance
                            const offsetY = Math.sin(angle) * offsetDistance

                            const newPosition = {
                                longitude: node.coordinate.longitude + offsetX / scale,
                                latitude: node.coordinate.latitude - offsetY / scale
                            }

                            const markers = createOffsetNodeMarker(map, node, newPosition, onNodeClick)
                            if (markers && markers.length > 0) {
                                // 简化的连接线
                                const line = new AMap.Polyline({
                                    path: [
                                        [node.coordinate.longitude, node.coordinate.latitude],
                                        [newPosition.longitude, newPosition.latitude]
                                    ],
                                    strokeColor: 'rgba(255,255,255,0.3)',
                                    strokeWeight: 1,
                                    zIndex: 100
                                })
                                map.add(line)
                                overlays.push(line)

                                map.add(markers)
                                overlays.push(...markers)
                            }
                        }
                    }
                    else {
                        // 低缩放级别：显示聚合标记
                        const clusterMarker = createClusterMarker(map, group, onClusterClick)
                        if (clusterMarker) {
                            map.add(clusterMarker)
                            overlays.push(clusterMarker)
                        }
                    }
                } catch (error) {
                    // 渲染失败，继续下一个
                }
            }

            index = batchEnd

            if (index < groups.length) {
                // 还有未渲染的，下一帧继续
                requestAnimationFrame(renderBatch)
            } else {
                // 全部渲染完成
                resolve(overlays)
            }
        }

        // 开始渲染
        requestAnimationFrame(renderBatch)
    })
}

// -----------------------------------------------------------------------------
// 渲染设备
// -----------------------------------------------------------------------------

/**
 * 渲染管线设备 - 分批渲染
 */
export function renderPipelineDevices(
    map: any,
    devices: PipelineDevice[],
    onDeviceClick?: (event: { device: PipelineDevice; position: { longitude: number; latitude: number } }) => void
): Promise<any[]> {
    return new Promise((resolve) => {
        const AMap = (window as any).AMap
        if (!AMap || !devices || devices.length === 0) {
            resolve([])
            return
        }

        const overlays: any[] = []
        const BATCH_SIZE = 20
        let index = 0

        function renderBatch() {
            const batchEnd = Math.min(index + BATCH_SIZE, devices.length)

            for (let i = index; i < batchEnd; i++) {
                const device = devices[i]
                try {
                    const color = device.status === 'normal' ? '#22c55e' : '#ef4444'

                    const circle = new AMap.CircleMarker({
                        center: [device.coordinate.longitude, device.coordinate.latitude],
                        radius: 6,
                        fillColor: color,
                        fillOpacity: 0.8,
                        strokeColor: '#ffffff',
                        strokeWeight: 2,
                        zIndex: 110
                    })

                    if (onDeviceClick) {
                        circle.on('click', (e: any) => {
                            onDeviceClick({
                                device,
                                position: { longitude: e.lnglat.lng, latitude: e.lnglat.lat }
                            })
                        })
                    }

                    map.add(circle)
                    overlays.push(circle)
                } catch (error) {
                    // 渲染失败，继续下一个
                }
            }

            index = batchEnd

            if (index < devices.length) {
                requestAnimationFrame(renderBatch)
            } else {
                resolve(overlays)
            }
        }

        requestAnimationFrame(renderBatch)
    })
}

// -----------------------------------------------------------------------------
// 工具函数
// -----------------------------------------------------------------------------

/**
 * 清除地图覆盖物
 */
export function clearMapOverlays(map: any, overlays: any[]): void {
    if (!map || !overlays || overlays.length === 0) return

    // 过滤掉无效覆盖物，批量移除更高效
    const validOverlays = overlays.filter(o => o != null)
    if (validOverlays.length === 0) return

    try {
        map.remove(validOverlays)
    } catch (e) {
        // 如果批量移除失败，尝试逐个移除
        for (let i = 0; i < validOverlays.length; i++) {
            try {
                map.remove(validOverlays[i])
            } catch (e) {
                // 忽略移除错误
            }
        }
    }
}
