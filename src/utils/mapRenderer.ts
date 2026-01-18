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

// 状态颜色映射
export const STATUS_COLORS = {
    [PipelineStatus.NORMAL]: '#22c55e',        // 绿色 - 正常
    [PipelineStatus.MAINTENANCE]: '#eab308',   // 黄色 - 维护中
    [PipelineStatus.FAULT]: '#ef4444',         // 红色 - 故障
    [PipelineStatus.DISABLED]: '#6b7280',      // 灰色 - 已停用
} as const

// 管线类别颜色映射(深色主题优化)
export const PIPELINE_CATEGORY_COLORS: Record<string, string> = {
    '中缅线': '#ff4444',      // 鲜红色
    '中贵线': '#00d4ff',      // 青色
    '西二线': '#ff9800',      // 橙色
    '西三线': '#9c27b0',      // 紫色
    '西四线': '#e040fb',      // 亮紫色，与西三线(#9c27b0)区分开
    '西气东输四线': '#e040fb',
    '陕二线': '#4caf50',      // 绿色
    '阿拉支干线': '#00bcd4',  // 深青色
    '闽粤支干线': '#e91e63',  // 粉红色
    '广南/广西': '#ff00ff',   // 品红色
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
    return PIPELINE_CATEGORY_COLORS[normalizedCategory] || PIPELINE_CATEGORY_COLORS['其他']
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
            const baseWidth = line.pressureLevel === PressureLevel.HIGH ? 6 : 4

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
    const nodeOverlayMap = new Map<string, { marker: any; text: any; isValve: boolean }>()

    // 获取当前缩放级别
    const currentZoom = map.getZoom()
    console.log('📐 当前缩放级别:', currentZoom)

    nodes.forEach(node => {
        try {
            const isSource = sourceNodes.includes(node.name)
            const isCompressor = compressorStations.includes(node.name) || node.name.includes('压气站')
            const isValve = isValveRoom(node.name)
            const isImportant = isSource || isCompressor || isImportantStation(node.name)

            // 根据类型选择颜色
            let color = '#00ff88' // 默认亮绿色
            if (isSource) {
                color = '#ffd700' // 金黄色 - 气源
            } else if (isCompressor) {
                color = '#00d4ff' // 青色 - 压气站
            } else if (isValve) {
                color = '#ff9800' // 橙色 - 阀室
            }

            // 根据缩放级别计算大小
            const radius = getMarkerRadiusByZoom(currentZoom, isImportant)
            const fontSize = getFontSizeByZoom(currentZoom, isImportant)

            // 创建标记
            const marker = new AMap.CircleMarker({
                center: [node.coordinate.longitude, node.coordinate.latitude],
                radius: radius,
                fillColor: color,
                fillOpacity: 0.9,
                strokeColor: '#ffffff',
                strokeWeight: isImportant ? 2 : 1,
                zIndex: isImportant ? 110 : 100,
            })

            // 创建文字标签
            const text = new AMap.Text({
                text: node.name,
                position: [node.coordinate.longitude, node.coordinate.latitude],
                offset: new AMap.Pixel(radius + 4, -5),
                style: {
                    'font-size': fontSize,
                    'font-weight': isImportant ? '600' : '400',
                    'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                    'color': color,
                    'background-color': 'rgba(17, 20, 24, 0.85)',
                    'border': isImportant ? '1px solid rgba(255, 255, 255, 0.2)' : 'none',
                    'padding': isImportant ? '4px 8px' : '2px 5px',
                    'border-radius': '4px',
                    'white-space': 'nowrap',
                },
                zIndex: isImportant ? 111 : 101,
            })

            // 绑定点击事件
            const handleClick = () => {
                if (onNodeClick) onNodeClick({ node, position: node.coordinate })
            }
            marker.on('click', handleClick)
            text.on('click', handleClick)

            // 添加到地图
            map.add([marker, text])
            overlays.push(marker, text)

            // 存储映射关系，用于缩放时更新显示
            nodeOverlayMap.set(node.id, { marker, text, isValve })

            // 初始状态：如果缩放级别低于8且是阀室，则隐藏
            if (currentZoom < 8 && isValve) {
                marker.hide()
                text.hide()
            }
        } catch (error) {
            console.error(`❌ 渲染节点 ${node.name} 失败:`, error)
        }
    })

    // 监听缩放事件，动态显示/隐藏阀室
    const zoomHandler = () => {
        const zoom = map.getZoom()
        const showValves = zoom >= 8 // 缩放级别 >= 8 时显示阀室

        nodeOverlayMap.forEach(({ marker, text, isValve }) => {
            if (isValve) {
                if (showValves) {
                    marker.show()
                    text.show()
                } else {
                    marker.hide()
                    text.hide()
                }
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
