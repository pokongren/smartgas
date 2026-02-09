import type { PipelineNode, PipelineLine, PipelineDevice } from '@/types'
import { NodeType, PipelineStatus, PressureLevel, DeviceType } from '@/types'

/**
 * 地图渲染工具函数
 * 用于在高德地图上渲染管网数据
 */

// 压力等级颜色映射
export const PRESSURE_COLORS = {
    [PressureLevel.HIGH]: '#ef4444',           // 红色 - 高压
    [PressureLevel.MEDIUM_HIGH]: '#f97316',    // 橙色 - 次高压
    [PressureLevel.MEDIUM]: '#eab308',         // 黄色 - 中压
    [PressureLevel.LOW]: '#22c55e',            // 绿色 - 低压
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
        @keyframes flash-animation {
            0% { opacity: 1; filter: drop-shadow(0 0 5px #00d4ff); transform: scale(1); }
            50% { opacity: 0.6; filter: drop-shadow(0 0 15px #00d4ff); transform: scale(1.1); }
            100% { opacity: 1; filter: drop-shadow(0 0 5px #00d4ff); transform: scale(1); }
        }
        
        .compressor-marker {
            width: 0;
            height: 0;
            border-bottom: 24px solid #00d4ff;
            border-left: 10px solid transparent;
            border-right: 10px solid transparent;
            position: relative;
            animation: flash-animation 2s infinite ease-in-out;
            cursor: pointer;
            width: 30px; /* Width of the bottom */
            display: flex;
            justify-content: center;
        }

        .compressor-marker::after {
            content: '';
            position: absolute;
            top: 24px;
            left: -10px;
            width: 50px; /* 30 + 10 + 10 */
            height: 4px;
            background: rgba(0, 212, 255, 0.3);
            border-radius: 50%;
            filter: blur(4px);
        }
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
    '西一线': '#FF5722',      // 深橙色 - 西气东输一线
    '中缅线': '#4caf50',      // 绿色
    '中缅支线': '#8bc34a',    // 浅绿色 (支线颜色)
    '中贵线': '#00d4ff',      // 青色
    '西二线': '#ff9800',      // 橙色
    '西三线': '#9c27b0',      // 紫色
    '西四线': '#e040fb',      // 亮紫色，与西三线(#9c27b0)区分开
    '西气东输四线': '#e040fb',
    '陕二线': '#4caf50',      // 绿色
    '阿拉支干线': '#00bcd4',  // 深青色
    '闽粤支干线': '#e91e63',  // 粉红色
    '广南/广西': '#ff00ff',   // 品红色
    '广南支干线': '#ff5722',  // 深橙色
    '广深支干线': '#9c27b0',  // 紫色
    '广西管道': '#00bcd4',    // 青色
    '海南': '#00ff00',        // 亮绿色
    'LNG外输': '#ffff00',     // 黄色
    '其他': '#999999',        // 灰色
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

    // 如果有精确匹配，直接返回
    if (PIPELINE_CATEGORY_COLORS[normalizedCategory]) {
        return PIPELINE_CATEGORY_COLORS[normalizedCategory]
    }

    // 模糊匹配: 包含"支线"的统一使用中缅支线颜色
    if (normalizedCategory.includes('支线')) {
        return PIPELINE_CATEGORY_COLORS['中缅支线']
    }

    return PIPELINE_CATEGORY_COLORS['其他']
}

/**
 * 获取节点类型对应的图标
 */
export function getNodeIcon(type: NodeType, isSource: boolean = false, isCompressor: boolean = false): string {
    // 如果是气源或压气站,使用特殊图标
    if (isSource) {
        return 'diamond' // 菱形 - 气源/首站
    }
    if (isCompressor) {
        return 'rect' // 方形 - 压气站
    }

    // 根据节点类型选择图标
    switch (type) {
        case NodeType.VALVE:
            return 'triangle' // 三角形 - 阀门
        case NodeType.REGULATOR:
            return 'rect' // 方形 - 调压站
        case NodeType.METERING:
            return 'pin' // 水滴形 - 计量站
        case NodeType.JUNCTION:
            return 'circle' // 圆形 - 连接点
        default:
            return 'circle'
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

/**
 * 渲染管网管线
 */
export function renderPipelineLines(
    map: any,
    lines: PipelineLine[],
    onLineClick?: (event: { line: PipelineLine; position: { longitude: number; latitude: number } }) => void
) {
    console.log('🏁 renderPipelineLines 被调用，管线数量:', lines.length)
    const AMap = (window as any).AMap
    if (!AMap) {
        console.error('❌ AMap 对象未找到')
        return []
    }

    const polylines: any[] = []

    lines.forEach((line, index) => {
        try {
            // 根据管线类别获取颜色
            const category = line.properties?.category as string || '其他'
            const color = getPipelineCategoryColor(category)

            // 根据状态选择样式
            const strokeStyle = line.status === PipelineStatus.MAINTENANCE ? 'dashed' : 'solid'

            // 根据压力等级调整粗细
            // 特殊逻辑：如果是支线，则线条更细 (2px)
            const isBranch = category.includes('支线')
            const baseWidth = isBranch ? 2 : (line.pressureLevel === PressureLevel.HIGH ? 6 : 4)

            const path = line.path.map(p => [p.longitude, p.latitude])

            if (index === 0) {
                console.log('📝 第一条管线路径详情:', JSON.stringify(path))
            }

            const polyline = new AMap.Polyline({
                path: path,
                strokeColor: color,
                strokeWeight: baseWidth,
                strokeStyle: strokeStyle,
                strokeOpacity: 1.0, // 确保完全不透明
                zIndex: 50,
                lineJoin: 'round',
                lineCap: 'round',
            })

            // 绑定点击事件
            if (onLineClick) {
                polyline.on('click', (e: any) => {
                    onLineClick({ line, position: { longitude: e.lnglat.lng, latitude: e.lnglat.lat } })
                })
            }

            map.add(polyline)
            polylines.push(polyline)

            // 流动动效光点
            const flowMarker = createFlowAnimation(map, line, color)
            if (flowMarker) {
                polylines.push(flowMarker)
            }

        } catch (error) {
            console.error(`❌ 渲染管线 ${line.id} 失败:`, error)
        }
    })

    console.log(`✅ renderPipelineLines 完成，成功添加了 ${polylines.length} 条管线`)
    return polylines
}

/**
 * 创建管线流动动画
 */
function createFlowAnimation(map: any, line: PipelineLine, color: string): any {
    const AMap = (window as any).AMap
    if (!AMap || line.path.length < 2) return null

    // 创建流动光点 Marker
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

    // 路径数组
    const path = line.path.map(p => [p.longitude, p.latitude])

    // 计算动画速度 (基于管线长度,越长速度越快)
    const speed = Math.max(50, line.length * 0.5) // 单位: 千米/秒

    // 启动循环动画
    const startAnimation = () => {
        flowMarker.moveAlong(path, {
            duration: (line.length / speed) * 1000, // 转换为毫秒
            autoRotation: false,
        })
    }

    // 动画结束后重新开始
    flowMarker.on('movealong', startAnimation)

    // 首次启动
    startAnimation()

    return flowMarker
}

/**
 * 创建流动光点的 Base64 图像
 */
function createFlowDot(color: string): string {
    // 创建一个 8x8 的 canvas
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d')

    if (!ctx) return ''

    // 绘制发光圆点
    const gradient = ctx.createRadialGradient(4, 4, 0, 4, 4, 4)
    gradient.addColorStop(0, color)
    gradient.addColorStop(0.5, color + 'cc') // 80% 透明度
    gradient.addColorStop(1, color + '00') // 完全透明

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 8, 8)

    return canvas.toDataURL()
}


/**
 * 判断节点是否为阀室
 */
function isValveRoom(nodeName: string): boolean {
    return nodeName.includes('阀室') || nodeName.includes('阀门') || nodeName.includes('#')
}

/**
 * 判断节点是否为重要站场（压气站、分输站等）
 */
function isImportantStation(nodeName: string): boolean {
    return nodeName.includes('压气站') ||
        nodeName.includes('分输站') ||
        nodeName.includes('首站') ||
        nodeName.includes('末站') ||
        nodeName.includes('计量站')
}

/**
 * 根据缩放级别获取字体大小
 */
function getFontSizeByZoom(zoom: number, isImportant: boolean): string {
    if (zoom >= 10) {
        return isImportant ? '14px' : '11px'
    } else if (zoom >= 8) {
        return isImportant ? '13px' : '10px'
    } else if (zoom >= 6) {
        return isImportant ? '12px' : '9px'
    } else {
        return isImportant ? '11px' : '8px'
    }
}

/**
 * 根据缩放级别获取标记半径
 */
function getMarkerRadiusByZoom(zoom: number, isImportant: boolean): number {
    if (zoom >= 10) {
        return isImportant ? 12 : 8
    } else if (zoom >= 8) {
        return isImportant ? 10 : 6
    } else if (zoom >= 6) {
        return isImportant ? 8 : 5
    } else {
        return isImportant ? 6 : 4
    }
}

/**
 * 渲染管网节点（支持缩放级别智能显示）
 */
export function renderPipelineNodes(
    map: any,
    nodes: PipelineNode[],
    sourceNodes: string[] = [],
    compressorStations: string[] = [],
    onNodeClick?: (event: { node: PipelineNode; position: { longitude: number; latitude: number } }) => void
) {
    console.log('🏁 renderPipelineNodes 被调用，节点数量:', nodes.length)
    const AMap = (window as any).AMap
    if (!AMap) return []

    const overlays: any[] = []
    const nodeOverlayMap = new Map<string, { markers: any[]; isValve: boolean }>()

    // 获取当前缩放级别
    const currentZoom = map.getZoom()
    console.log('📐 当前缩放级别:', currentZoom)

    nodes.forEach(node => {
        try {
            // 判定节点类型
            const isCompressor = node.name.includes('压气站') || compressorStations.includes(node.name) || (node.type as any) === 'compressor'
            const isDistribution = node.name.includes('分输站') || node.name.includes('门站') || node.name.includes('末站') || (node.type as any) === 'distribution' || (node.type as any) === 'station'
            const isValve = isValveRoom(node.name) || (node.type as any) === 'valve'
            const isImportant = isCompressor || isDistribution

            // 1. 压气站：梯形、大尺寸、闪烁
            if (isCompressor) {
                // 获取旋转角度 (如果存在)
                const rotation = node.properties?.rotation || 0

                // 创建容器用于旋转
                const container = document.createElement('div')
                container.style.transform = `rotate(${rotation}deg)`
                container.style.transformOrigin = 'center center'

                // 创建梯形标记
                const markerContent = document.createElement('div')
                markerContent.className = 'compressor-marker'
                container.appendChild(markerContent)

                const marker = new AMap.Marker({
                    position: [node.coordinate.longitude, node.coordinate.latitude],
                    content: container,
                    // 修正 offset:
                    // 原始: offset: new AMap.Pixel(-15, -24)
                    // 旋转后: 
                    // 0度(向上): 底部中心在(0,0), visual(-25, -24)?
                    // 90度(向右): visual center becomes left center?
                    // Let's stick with center alignment for simplicity.
                    // If we rotate around center, we need offset to point to center of the icon.
                    // compressor-marker 30px w, 24px h.
                    // Center is (15, 12).
                    // offset should be (-15, -12).
                    offset: new AMap.Pixel(-15, -12),
                    zIndex: 120,
                    extData: { type: 'compressor' }
                })

                // 调整文字位置
                const text = new AMap.Text({
                    text: node.name,
                    position: [node.coordinate.longitude, node.coordinate.latitude],
                    offset: new AMap.Pixel(0, 10), // 梯形下方
                    style: {
                        'font-size': '14px',
                        'font-weight': 'bold',
                        'color': '#00d4ff',
                        'background-color': 'rgba(0,0,0,0.7)',
                        'border-radius': '4px',
                        'padding': '2px 6px',
                        'border': '1px solid #00d4ff'
                    },
                    zIndex: 121
                })

                bindClickEvents(marker, text, node, onNodeClick)
                map.add([marker, text])
                overlays.push(marker, text)
                nodeOverlayMap.set(node.id, { markers: [marker, text], isValve: false })
            }
            // 2. 分输站/输气站：中等尺寸、方形或圆形
            else if (isDistribution) {
                // 使用较大的方形或圆形
                const radius = 8 // 比阀室大
                const color = '#ffd700' // 金黄色

                const marker = new AMap.CircleMarker({
                    center: [node.coordinate.longitude, node.coordinate.latitude],
                    radius: radius,
                    fillColor: color,
                    fillOpacity: 0.9,
                    strokeColor: '#ffffff',
                    strokeWeight: 2,
                    zIndex: 110,
                })

                const text = new AMap.Text({
                    text: node.name,
                    position: [node.coordinate.longitude, node.coordinate.latitude],
                    offset: new AMap.Pixel(0, -15),
                    style: {
                        'font-size': '12px',
                        'color': color,
                        'background-color': 'rgba(0,0,0,0.6)',
                        'border-radius': '2px',
                        'padding': '2px 4px',
                        'border': 'none'
                    },
                    zIndex: 111
                })

                bindClickEvents(marker, text, node, onNodeClick)
                map.add([marker, text])
                overlays.push(marker, text)
                nodeOverlayMap.set(node.id, { markers: [marker, text], isValve: false })
            }
            // 3. 阀室：小尺寸、圆形
            else { // 默认为阀室或其他小节点
                const radius = 5 // 较小
                const color = '#e0e0e0' // 灰白色

                const marker = new AMap.CircleMarker({
                    center: [node.coordinate.longitude, node.coordinate.latitude],
                    radius: radius,
                    fillColor: color,
                    fillOpacity: 0.8,
                    strokeColor: '#666',
                    strokeWeight: 1,
                    zIndex: 100,
                })

                const text = new AMap.Text({
                    text: node.name,
                    position: [node.coordinate.longitude, node.coordinate.latitude],
                    offset: new AMap.Pixel(8, 0),
                    style: {
                        'font-size': '10px',
                        'color': '#ccc',
                        'background-color': 'transparent',
                        'border': 'none'
                    },
                    zIndex: 101
                })

                bindClickEvents(marker, text, node, onNodeClick)
                map.add([marker, text])
                overlays.push(marker, text)
                nodeOverlayMap.set(node.id, { markers: [marker, text], isValve: true })

                // 初始显示状态
                if (currentZoom < 8) {
                    marker.hide()
                    text.hide()
                }
            }

        } catch (error) {
            console.error(`❌ 渲染节点 ${node.name} 失败:`, error)
        }
    })

    // 辅助函数：绑定事件
    function bindClickEvents(marker: any, text: any, node: PipelineNode, callback?: Function) {
        const handleClick = () => {
            if (callback) callback({ node, position: node.coordinate })
        }
        marker.on('click', handleClick)
        text.on('click', handleClick)
    }

    // 监听缩放事件，动态显示/隐藏阀室
    const zoomHandler = () => {
        const zoom = map.getZoom()
        const showValves = zoom >= 8 // 缩放级别 >= 8 时显示阀室

        nodeOverlayMap.forEach(({ markers, isValve }) => {
            if (isValve) {
                markers.forEach(m => showValves ? m.show() : m.hide())
            }
        })
    }

    map.on('zoomend', zoomHandler)

    console.log(`✅ renderPipelineNodes 完成，成功添加了 ${overlays.length} 个对象`)
    return overlays
}


/**
 * 渲染管网设备
 */
export function renderPipelineDevices(
    map: any,
    devices: PipelineDevice[],
    onDeviceClick?: (event: { device: PipelineDevice; position: { longitude: number; latitude: number } }) => void
) {
    const AMap = (window as any).AMap
    if (!AMap) return []

    const markers: any[] = []

    devices.forEach(device => {
        // 根据设备在线状态选择颜色
        const color = device.online ? '#52c41a' : '#ff4d4f'

        const marker = new AMap.CircleMarker({
            center: [device.coordinate.longitude, device.coordinate.latitude],
            radius: 4,
            fillColor: color,
            fillOpacity: 0.8,
            strokeColor: '#ffffff',
            strokeWeight: 1,
            zIndex: 90,
        })

        // 绑定点击事件
        if (onDeviceClick) {
            marker.on('click', () => {
                onDeviceClick({ device, position: device.coordinate })
            })
        }

        map.add(marker)
        markers.push(marker)
    })

    return markers
}

/**
 * 清除地图上的所有覆盖物
 */
export function clearMapOverlays(map: any, overlays: any[]) {
    if (!map || !overlays || overlays.length === 0) return

    overlays.forEach(overlay => {
        if (overlay && typeof overlay.setMap === 'function') {
            overlay.setMap(null)
        }
    })

    map.clearMap()
}
