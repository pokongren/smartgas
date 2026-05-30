import type { PipelineNode, PipelineLine, PipelineDevice } from '@/types'
import { NodeType, PipelineStatus, PressureLevel, DeviceType } from '@/types'
import type { ClusterGroup, ClusterClickEvent } from '@/types/cluster'
import type { NetworkxCutoffMapOverlay } from '@/components/map-view/types'
import type { SimulationOverlay, SimEdgeResult } from '@/types/simulation'
import { getJunctionKind, getLinePipelineKind, getNodeRawType, isCompressorNode, isDistributionNode, isHubNode, isLngSourceNode, isMajorJunctionNode, isSourceNode, isValveNode } from '@/utils/pipelineDomain'
import { getNodeImportance, getNodeLODStrategy, NODE_LOD_THRESHOLDS, NodeImportance, shouldShowNodeAtZoom } from '@/utils/hierarchyRenderer'

// ============ 流向动画全局开关 ============
/** 是否启用流动动画，默认开启；通过 setFlowAnimationEnabled() 控制 */
let _flowAnimationEnabled = true

/** 启用/禁用流动动画 */
export function setFlowAnimationEnabled(enabled: boolean): void {
    _flowAnimationEnabled = enabled
}

/** 获取当前流动动画状态 */
export function isFlowAnimationEnabled(): boolean {
    return _flowAnimationEnabled
}

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
    SMALL_GROUP_EXPAND_MAX: 4,
    SMALL_GROUP_EXPAND_ZOOM: NODE_LOD_THRESHOLDS.highZoom,
    FANOUT_RADIUS: 54,
    FANOUT_ARC_DEGREES: 110,

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
 * 压气站图标配置 - 左长右短、竖边平行梯形
 */
const COMPRESSOR_ICON_CONFIG = {
    WIDTH: 16,
    HEIGHT: 20,
    COLOR: '#00d4ff',
    DPR: Math.min(window.devicePixelRatio || 1, 2),
} as const

const HUB_MARKER_CONFIG = {
    SIZE: 18,
    COMPACT_SIZE: 16,
    CONTAINER_PADDING: 8,
    COLOR: '#FFD700',
    GLOW_COLOR: 'rgba(0, 229, 255, 0.46)',
} as const

const SOURCE_MARKER_CONFIG = {
    SIZE: 32,
    COMPACT_SIZE: 24,
    CONTAINER_PADDING: 6,
    COLOR: '#FF4500',
    GLOW_COLOR: 'rgba(255, 100, 0, 0.6)',
} as const

const LNG_MARKER_CONFIG = {
    WIDTH: 50,
    HEIGHT: 38,
    COMPACT_WIDTH: 40,
    COMPACT_HEIGHT: 30,
    CONTAINER_PADDING: 6,
    COLOR: '#0ea5e9',
    GLOW_COLOR: 'rgba(14, 165, 233, 0.62)',
} as const

interface PipelineRenderOptions {
    simulationOverlay?: SimulationOverlay | null
    cutoffEdgeIds?: string[]
    networkxCutoffOverlay?: NetworkxCutoffMapOverlay | null
}

interface MergedFlowPath {
    path: number[][]
    color: string
    totalLength: number
    flowIntensity: number
    flowDirection: 'forward' | 'reverse' | 'zero'
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

function buildSimulationEdgeMap(overlay?: SimulationOverlay | null): Map<string, SimEdgeResult> {
    const edgeMap = new Map<string, SimEdgeResult>()
    overlay?.edges.forEach(edge => edgeMap.set(edge.id, edge))
    return edgeMap
}

function resolveSimulationEdge(line: PipelineLine, edgeMap?: Map<string, SimEdgeResult>): SimEdgeResult | undefined {
    if (!edgeMap || edgeMap.size === 0) return undefined

    for (const id of getLineSimulationCandidateIds(line)) {
        const edge = edgeMap.get(id)
        if (edge) return edge
    }

    return undefined
}

function getLineSimulationCandidateIds(line: PipelineLine): string[] {
    const properties = line.properties as Record<string, unknown> | undefined
    const ids = [
        line.id,
        properties?.simulationEdgeId,
        properties?.solverEdgeId,
        properties?.sourceEdgeId,
        properties?.edgeId,
    ].filter((id): id is string => typeof id === 'string' && id.length > 0)

    const sourceEdgeIds = properties?.sourceEdgeIds
    if (Array.isArray(sourceEdgeIds)) {
        sourceEdgeIds.forEach(id => {
            if (typeof id === 'string' && id.length > 0) ids.push(id)
        })
    }

    return ids
}

function lineMatchesEdgeIds(line: PipelineLine, edgeIds?: Set<string>): boolean {
    if (!edgeIds || edgeIds.size === 0) return false
    return getLineSimulationCandidateIds(line).some(id => edgeIds.has(id))
}

function lineTouchesNodeIds(line: PipelineLine, nodeIds?: Set<string>): boolean {
    if (!nodeIds || nodeIds.size === 0) return false
    return Boolean(
        (line.startNodeId && nodeIds.has(line.startNodeId))
        || (line.endNodeId && nodeIds.has(line.endNodeId))
    )
}

function isSimulationEdgeClosed(edge?: SimEdgeResult): boolean {
    if (!edge) return false
    return edge.direction === 'zero' || edge.flow_rate <= 0.001
}

function hasSimulationEdgeMap(edgeMap?: Map<string, SimEdgeResult>): boolean {
    return Boolean(edgeMap && edgeMap.size > 0)
}

function shouldRenderFlowForLine(
    line: PipelineLine,
    edgeMap?: Map<string, SimEdgeResult>,
    blockedFlowEdgeIds?: Set<string>,
    blockedFlowNodeIds?: Set<string>,
): boolean {
    if (lineMatchesEdgeIds(line, blockedFlowEdgeIds)) return false
    if (lineTouchesNodeIds(line, blockedFlowNodeIds)) return false
    if (!hasSimulationEdgeMap(edgeMap)) return true
    const edge = resolveSimulationEdge(line, edgeMap)
    return Boolean(edge && !isSimulationEdgeClosed(edge))
}

function getSimulationFlowIntensity(line: PipelineLine, edgeMap?: Map<string, SimEdgeResult>): number {
    const edge = resolveSimulationEdge(line, edgeMap)
    if (!edge) return hasSimulationEdgeMap(edgeMap) ? 0 : 1
    if (isSimulationEdgeClosed(edge)) return 0
    return clampNumber(edge.utilization > 0 ? edge.utilization : edge.flow_rate / 3000, 0.18, 1.25)
}

function getChainFlowIntensity(lines: PipelineLine[], edgeMap?: Map<string, SimEdgeResult>): number {
    if (!edgeMap || edgeMap.size === 0) return 1
    const values = lines
        .map(line => getSimulationFlowIntensity(line, edgeMap))
        .filter(value => value > 0)

    if (values.length === 0) return 0
    return clampNumber(values.reduce((sum, value) => sum + value, 0) / values.length, 0.18, 1.25)
}

function getChainFlowDirection(lines: PipelineLine[], edgeMap?: Map<string, SimEdgeResult>): 'forward' | 'reverse' | 'zero' {
    if (!edgeMap || edgeMap.size === 0) return 'forward'

    let forwardCount = 0
    let reverseCount = 0
    let zeroCount = 0

    for (const line of lines) {
        const direction = resolveSimulationEdge(line, edgeMap)?.direction
        if (direction === 'reverse') reverseCount++
        else if (direction === 'zero') zeroCount++
        else forwardCount++
    }

    if (forwardCount === 0 && reverseCount === 0) return zeroCount > 0 ? 'zero' : 'forward'
    return reverseCount > forwardCount ? 'reverse' : 'forward'
}

function createCutoffMarker(map: any, path: number[][], line: PipelineLine): any | null {
    const AMap = (window as any).AMap
    const position = path[Math.floor(path.length / 2)]
    if (!AMap || !position) return null

    const marker = new AMap.Text({
        text: '× 截断',
        position,
        offset: new AMap.Pixel(-24, -12),
        zIndex: 180,
        zooms: [2, 30],
        style: {
            'height': '24px',
            'line-height': '22px',
            'padding': '0 8px',
            'border-radius': '999px',
            'background': 'rgba(127,29,29,0.92)',
            'border': '1px solid rgba(248,113,113,0.9)',
            'color': '#fee2e2',
            'font-size': '11px',
            'font-weight': '700',
            'box-shadow': '0 0 16px rgba(239,68,68,0.7)',
        },
        extData: { line, isCutoffMarker: true },
    })

    map.add(marker)
    return marker
}

function createNetworkxCutoffNodeMarker(map: any, node: PipelineNode): any | null {
    const AMap = (window as any).AMap
    if (!AMap || !node?.coordinate) return null

    const marker = new AMap.Text({
        text: `✕ ${node.name || '截断点'}`,
        position: [node.coordinate.longitude, node.coordinate.latitude],
        offset: new AMap.Pixel(-38, -34),
        zIndex: 118,
        zooms: [2, 30],
        clickable: false,
        bubble: true,
        style: {
            'height': '28px',
            'line-height': '26px',
            'padding': '0 10px',
            'border-radius': '999px',
            'background': 'rgba(127, 29, 29, 0.96)',
            'border': '1px solid rgba(252, 165, 165, 0.95)',
            'color': '#fff1f2',
            'font-size': '12px',
            'font-weight': '800',
            'box-shadow': '0 0 18px rgba(248,113,113,0.72)',
            'pointer-events': 'none',
        },
        extData: { node, isNetworkxCutoffNode: true },
    })

    map.add(marker)
    return marker
}

/**
 * 注入地图标记样式
 */
function injectMarkerStyles() {
    const styleId = 'pipeline-marker-styles'
    const existingStyle = document.getElementById(styleId) as HTMLStyleElement | null

    const style = existingStyle || document.createElement('style')
    style.id = styleId
    style.textContent = `
        /* 压气站标记容器 - 带呼吸灯动效 */
        .compressor-marker-container {
            position: relative;
            width: ${COMPRESSOR_ICON_CONFIG.WIDTH}px;
            height: ${COMPRESSOR_ICON_CONFIG.HEIGHT}px;
            display: flex;
            justify-content: center;
            align-items: center;
            cursor: pointer;
            filter: drop-shadow(0 0 4px rgba(0, 212, 255, 0.6));
            transform-origin: center center;
            transition: transform 0.22s ease, filter 0.22s ease;
        }
        .compressor-marker-container:hover {
            transform: scale(1.45) !important;
            filter: drop-shadow(0 0 12px rgba(0, 212, 255, 0.95));
            z-index: 999;
        }

        /* 呼吸灯发光层 */
        .compressor-marker-glow {
            position: absolute;
            width: 100%;
            height: 100%;
            background: radial-gradient(circle, rgba(0, 229, 255, 0.4) 0%, rgba(0, 229, 255, 0) 70%);
            border-radius: 50%;
            animation: marker-pulse 2s ease-in-out infinite;
            pointer-events: none;
            z-index: -1;
        }

        @keyframes marker-pulse {
            0%, 100% { transform: scale(0.8); opacity: 0.3; }
            50% { transform: scale(1.5); opacity: 0.7; }
        }

        /* 压气站图标 */
        .compressor-marker-icon {
            width: ${COMPRESSOR_ICON_CONFIG.WIDTH}px;
            height: ${COMPRESSOR_ICON_CONFIG.HEIGHT}px;
            object-fit: contain;
            pointer-events: none;
            filter: brightness(1.1);
        }

        /* 聚合标记样式 - 玻璃拟态版 */
        .pipeline-cluster-marker {
            backdrop-filter: blur(8px);
            box-shadow: 0 4px 15px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.1);
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            background-image: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.1), transparent);
        }
        .pipeline-cluster-marker:hover {
            transform: scale(1.15);
            box-shadow: 0 8px 25px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.3);
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
            box-shadow: 0 0 4px rgba(0,0,0,0.5);
        }
        .cluster-indicator.compressor { background: #0ea5e9; }
        .cluster-indicator.distribution { background: #f59e0b; }
        .cluster-indicator.valve { background: #64748b; }

        /* 枢纽节点样式 - 黄色菱形 */
        .hub-marker-container {
            width: ${HUB_MARKER_CONFIG.SIZE + HUB_MARKER_CONFIG.CONTAINER_PADDING}px;
            height: ${HUB_MARKER_CONFIG.SIZE + HUB_MARKER_CONFIG.CONTAINER_PADDING}px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            position: relative;
            overflow: visible;
            perspective: 140px;
            filter: drop-shadow(0 5px 4px rgba(0,0,0,0.38)) drop-shadow(0 0 6px ${HUB_MARKER_CONFIG.GLOW_COLOR});
            transform-origin: center center;
            transition: transform 0.18s ease, filter 0.18s ease;
        }
        .hub-marker-container:hover {
            transform: scale(1.22) translateY(-1px);
            filter: drop-shadow(0 8px 6px rgba(0,0,0,0.46)) drop-shadow(0 0 10px rgba(0,229,255,0.82));
        }
        .hub-marker-glow {
            width: ${HUB_MARKER_CONFIG.SIZE}px;
            height: ${HUB_MARKER_CONFIG.SIZE}px;
            position: relative;
            background: linear-gradient(135deg, #fffbe8 0%, #ffe84f 34%, ${HUB_MARKER_CONFIG.COLOR} 58%, #d97706 100%);
            transform: rotate(45deg) rotateX(16deg);
            border: 1px solid rgba(255,255,255,0.76);
            border-radius: 3px;
            box-shadow:
                0 0 5px ${HUB_MARKER_CONFIG.GLOW_COLOR},
                0 0 10px ${HUB_MARKER_CONFIG.GLOW_COLOR},
                3px 4px 0 rgba(120,53,15,0.42),
                inset 2px 2px 3px rgba(255,255,255,0.68),
                inset -3px -3px 4px rgba(146,64,14,0.44);
            overflow: hidden;
        }
        .hub-marker-glow::before {
            content: '';
            position: absolute;
            inset: 2px 5px 9px 2px;
            background: linear-gradient(135deg, rgba(255,255,255,0.82), rgba(255,255,255,0.04));
            opacity: 0.78;
            pointer-events: none;
        }
        .hub-marker-glow::after {
            content: '';
            position: absolute;
            right: 1px;
            bottom: 1px;
            width: 46%;
            height: 46%;
            background: linear-gradient(135deg, rgba(245,158,11,0), rgba(120,53,15,0.36));
            pointer-events: none;
        }
        .hub-marker-glow.compact {
            width: ${HUB_MARKER_CONFIG.COMPACT_SIZE}px;
            height: ${HUB_MARKER_CONFIG.COMPACT_SIZE}px;
        }

        /* 气源节点样式 - 钻井塔剪影 */
        .source-marker-container {
            width: ${SOURCE_MARKER_CONFIG.SIZE + 4}px;
            height: ${SOURCE_MARKER_CONFIG.SIZE + 10}px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            position: relative;
            filter: drop-shadow(0 0 8px ${SOURCE_MARKER_CONFIG.GLOW_COLOR});
            transition: transform 0.2s ease, filter 0.2s ease;
        }
        .source-marker-container:hover {
            transform: scale(1.18);
            filter: drop-shadow(0 0 14px rgba(255, 120, 0, 0.9));
        }
        .source-marker-container.compact {
            width: ${SOURCE_MARKER_CONFIG.COMPACT_SIZE + 4}px;
            height: ${SOURCE_MARKER_CONFIG.COMPACT_SIZE + 8}px;
        }
        /* 火焰跳动动画 */
        .source-flame {
            animation: flame-flicker 1.2s ease-in-out infinite;
            transform-origin: 16px 10px;
        }
        @keyframes flame-flicker {
            0%, 100% { opacity: 1; }
            25% { opacity: 0.8; }
            50% { opacity: 1; }
            75% { opacity: 0.9; }
        }
        .cluster-indicator.source { background: #FF4500; }
        .lng-ship-marker-container {
            width: ${LNG_MARKER_CONFIG.WIDTH + LNG_MARKER_CONFIG.CONTAINER_PADDING}px;
            height: ${LNG_MARKER_CONFIG.HEIGHT + LNG_MARKER_CONFIG.CONTAINER_PADDING}px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            position: relative;
            overflow: visible;
            filter: drop-shadow(0 0 7px ${LNG_MARKER_CONFIG.GLOW_COLOR});
            transition: transform 0.2s ease, filter 0.2s ease;
        }
        .lng-ship-marker-container:hover {
            transform: scale(1.14);
            filter: drop-shadow(0 0 13px rgba(56, 189, 248, 0.9));
        }
        .lng-ship-marker-container.compact {
            width: ${LNG_MARKER_CONFIG.COMPACT_WIDTH + LNG_MARKER_CONFIG.CONTAINER_PADDING}px;
            height: ${LNG_MARKER_CONFIG.COMPACT_HEIGHT + LNG_MARKER_CONFIG.CONTAINER_PADDING}px;
        }
        .lng-ship-wave {
            animation: lng-wave 1.8s ease-in-out infinite;
        }
        @keyframes lng-wave {
            0%, 100% { opacity: 0.55; transform: translateY(0); }
            50% { opacity: 0.95; transform: translateY(1px); }
        }
        .cluster-indicator.lng { background: #0ea5e9; }
    `
    if (!existingStyle) {
        document.head.appendChild(style)
    }
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

// 管线类别颜色映射(数字孪生色系)
export const PIPELINE_CATEGORY_COLORS: Record<string, string> = {
    '西一线': '#f97316',       // 温暖橙
    '中缅线': '#10b981',       // 翡翠绿
    '中缅支线': '#34d399',     // 薄荷绿
    '中贵线': '#0ea5e9',       // 天空蓝
    '西二线': '#fbbf24',       // 琥珀黄
    '西三线': '#a855f7',       // 罗兰紫
    '西四线': '#d946ef',       // 霓虹粉
    '西气东输四线': '#d946ef',
    '陕二线': '#059669',       // 深绿
    '阿拉支干线': '#06b6d4',   // 青色
    '闽粤支干线': '#f43f5e',   // 珊瑚红
    '广南/广西': '#ec4899',    // 粉红
    '广南支干线': '#f97316',
    '广深支干线': '#8b5cf6',   // 紫罗兰
    '广西管道': '#0891b2',
    '海南': '#22c55e',
    'LNG外输': '#fb923c',
    '中俄东线': '#ef4444',     // 正红
    '平泰支干线': '#f43f5e',
    '陕京四线': '#3b82f6',     // 宝蓝
    '陕京四线支线': '#60a5fa',
    '其他': '#94a3b8',         // 板岩灰
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
                    source: 0,
                    compressor: 0,
                    distribution: 0,
                    valve: 0,
                    junction: 0,
                    majorJunction: 0,
                    other: 0
                },
                hasImportantStation: false
            })
        }

        const group = groups.get(key)!
        group.nodes.push(node)

        // 更新类型统计
        const rawType = getNodeRawType(node)
        const importance = getNodeImportance(node)
        if (isSourceNode(node)) {
            group.typeStats.source++
        } else if (rawType === 'compressor') {
            group.typeStats.compressor++
        } else if (rawType === 'distribution') {
            group.typeStats.distribution++
        } else if (rawType === 'valve') {
            group.typeStats.valve++
        } else if (rawType === 'junction') {
            group.typeStats.junction++
            if (isMajorJunctionNode(node)) {
                group.typeStats.majorJunction++
            }
        } else {
            group.typeStats.other++
        }
        if (importance <= NodeImportance.HIGH) {
            group.hasImportantStation = true
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

/**
 * 获取所有节点的 Marker 实例映射表
 * 暴露给外部用于基于操作 DOM 的实时状态更新（绕过 React 渲染周期避免卡顿）
 */
export function getNodeMarkerMap(): Map<string, any> {
    return nodeMarkerMap
}

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
 * 使用 Canvas 绘制压气站梯形图标 - 左长右短、竖边平行
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

    // 左侧长边、右侧短边，两条竖边平行；贴近地图上的压气站梯形标识
    const rightTop = h * 0.22
    const rightBottom = h * 0.78

    ctx.beginPath()
    ctx.moveTo(0, 0)                 // 左上
    ctx.lineTo(0, h)                 // 左下
    ctx.lineTo(w, rightBottom)       // 右下（短边下端）
    ctx.lineTo(w, rightTop)          // 右上（短边上端）
    ctx.closePath()

    // 渐变填充（从左到右）
    const gradient = ctx.createLinearGradient(0, 0, w, 0)
    gradient.addColorStop(0, '#35f2ff')   // 左侧亮色
    gradient.addColorStop(0.5, COLOR)      // 中间
    gradient.addColorStop(1, '#008fc2')   // 右侧深色
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
    const rightTop = HEIGHT * 0.22
    const rightBottom = HEIGHT * 0.78

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
    const hasJunctionNode = group.nodes.some(isHubNode) || typeStats.majorJunction > 0 || typeStats.junction > 0
    const hasSourceNode = typeStats.source > 0
    const hasLngSourceNode = group.nodes.some(isLngSourceNode)

    if (hasLngSourceNode) {
        return createLngShipMarkerContent(true)
    }

    if (hasSourceNode) {
        return createSourceMarkerContent(true)
    }

    if (hasJunctionNode) {
        return createHubMarkerContent(true)
    }

    let color: string = CLUSTER_CONFIG.CLUSTER_COLORS.FEW
    if (count > 15) {
        color = CLUSTER_CONFIG.CLUSTER_COLORS.MANY
    } else if (count > 5) {
        color = CLUSTER_CONFIG.CLUSTER_COLORS.MEDIUM
    }

    const indicators = []
    if (typeStats.source > 0) {
        indicators.push(`<span class="cluster-indicator source" title="气源/首末站">源</span>`)
    }
    if (typeStats.compressor > 0) {
        indicators.push(`<span class="cluster-indicator compressor" title="压气站">压</span>`)
    }
    if (typeStats.distribution > 0) {
        indicators.push(`<span class="cluster-indicator distribution" title="分输站">输</span>`)
    }
    if (typeStats.valve > 0) {
        indicators.push(`<span class="cluster-indicator valve" title="阀室">阀</span>`)
    }
    if (typeStats.majorJunction > 0) {
        indicators.push(`<span class="cluster-indicator compressor" title="大枢纽">大</span>`)
    } else if (typeStats.junction > 0) {
        indicators.push(`<span class="cluster-indicator distribution" title="枢纽/交汇点">枢</span>`)
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
        offset: group.nodes.some(isHubNode) || group.typeStats.majorJunction > 0 || group.typeStats.junction > 0
            ? new AMap.Pixel(-(HUB_MARKER_CONFIG.SIZE + HUB_MARKER_CONFIG.CONTAINER_PADDING) / 2, -(HUB_MARKER_CONFIG.SIZE + HUB_MARKER_CONFIG.CONTAINER_PADDING) / 2)
            : group.nodes.some(isLngSourceNode)
            ? new AMap.Pixel(-(LNG_MARKER_CONFIG.COMPACT_WIDTH + LNG_MARKER_CONFIG.CONTAINER_PADDING) / 2, -(LNG_MARKER_CONFIG.COMPACT_HEIGHT + LNG_MARKER_CONFIG.CONTAINER_PADDING) / 2)
            : group.typeStats.source > 0
            ? new AMap.Pixel(-(SOURCE_MARKER_CONFIG.SIZE + SOURCE_MARKER_CONFIG.CONTAINER_PADDING) / 2, -(SOURCE_MARKER_CONFIG.SIZE + SOURCE_MARKER_CONFIG.CONTAINER_PADDING) / 2)
            : new AMap.Pixel(-20, -20),
        zIndex: 150,
        extData: { type: 'cluster', group },
        zooms: [2, 30]
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

    group.nodes.forEach(node => {
        nodeMarkerMap.set(node.id, marker)
    })

    return marker
}

function shouldUseClusterMarker(group: ClusterGroup): boolean {
    return group.nodes.some(isLngSourceNode)
        || group.typeStats.source > 0
        || group.nodes.some(isHubNode)
        || group.typeStats.majorJunction > 0
        || group.typeStats.junction > 0
}

function shouldPreferCompactFanout(group: ClusterGroup, zoom: number): boolean {
    return (
        group.nodes.length > 1
        && group.nodes.length <= CLUSTER_CONFIG.SMALL_GROUP_EXPAND_MAX
        && group.hasImportantStation
        && zoom >= CLUSTER_CONFIG.SMALL_GROUP_EXPAND_ZOOM
    )
}

function calculateCompactFanoutPositions(
    map: any,
    group: ClusterGroup
): Array<{ node: PipelineNode; position: { longitude: number; latitude: number } }> {
    const prioritizedNodes = [...group.nodes].sort((left, right) => {
        const importanceDiff = getNodeImportance(left) - getNodeImportance(right)
        if (importanceDiff !== 0) return importanceDiff
        return left.name.localeCompare(right.name, 'zh-CN')
    })

    const count = prioritizedNodes.length
    if (count === 0) return []

    const arcDegrees = count === 2 ? 76 : CLUSTER_CONFIG.FANOUT_ARC_DEGREES
    const startDegrees = -90 - (arcDegrees / 2)
    const stepDegrees = count === 1 ? 0 : arcDegrees / (count - 1)

    return prioritizedNodes.map((node, index) => {
        const angle = (startDegrees + (stepDegrees * index)) * (Math.PI / 180)
        const radius = CLUSTER_CONFIG.FANOUT_RADIUS + (index % 2 === 1 ? 8 : 0)
        const offsetX = Math.cos(angle) * radius
        const offsetY = Math.sin(angle) * radius

        return {
            node,
            position: pixelOffsetToLngLat(map, group.coordinate, offsetX, offsetY),
        }
    })
}

function createLeaderLine(
    origin: { longitude: number; latitude: number },
    target: { longitude: number; latitude: number }
): any | null {
    const AMap = (window as any).AMap
    if (!AMap) return null

    return new AMap.Polyline({
        path: [
            [origin.longitude, origin.latitude],
            [target.longitude, target.latitude],
        ],
        strokeColor: 'rgba(191, 219, 254, 0.75)',
        strokeWeight: 2,
        strokeOpacity: 0.95,
        strokeStyle: 'dashed',
        strokeDasharray: [6, 4],
        lineJoin: 'round',
        lineCap: 'round',
        zIndex: 101,
    })
}

function buildVisualLinePath(line: PipelineLine): number[][] {
    return line.path.map(p => [p.longitude, p.latitude])
}

/**
 * 创建压气站标记内容（Canvas/SVG 高清晰度版）
 */
function createCompressorMarkerContent(): HTMLElement {
    // 创建容器
    const container = document.createElement('div')
    container.className = 'compressor-marker-container'

    // 呼吸灯发光层
    const glow = document.createElement('div')
    glow.className = 'compressor-marker-glow'
    container.appendChild(glow)

    // 图标
    const icon = document.createElement('img')
    icon.className = 'compressor-marker-icon'
    icon.src = getCompressorIcon()
    icon.alt = '压气站'
    container.appendChild(icon)

    return container
}

export function createHubMarkerContent(isCompact = false, label = ''): string {
    const compactClass = isCompact ? ' compact' : ''
    const labelHtml = label
        ? `<div style="position:absolute;top:${HUB_MARKER_CONFIG.SIZE + 8}px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:11px;font-weight:700;color:#fff;text-shadow:0 0 2px #000,0 0 4px #000;background:rgba(15,23,42,0.72);border:1px solid rgba(255,255,255,0.14);border-radius:4px;padding:1px 5px;">${label}</div>`
        : ''
    return `
        <div class="hub-marker-container" title="枢纽">
            <div class="hub-marker-glow${compactClass}"></div>
            ${labelHtml}
        </div>
    `
}

function createSourceMarkerContent(isCompact = false): string {
    const w = isCompact ? 26 : 32
    const h = isCompact ? 34 : 42
    const legW = isCompact ? 2 : 2.5
    const braceW = isCompact ? 0.8 : 1
    const flameScale = isCompact ? 1.15 : 1.35
    return `
        <div class="source-marker-container${isCompact ? ' compact' : ''}" title="气源">
            <svg width="${w}" height="${h}" viewBox="0 0 32 42" style="overflow:visible;" xmlns="http://www.w3.org/2000/svg">
                <!-- 外发光 -->
                <circle cx="16" cy="30" r="15" fill="none" stroke="rgba(255,140,0,0.18)" stroke-width="1"/>
                <!-- 地面 -->
                <ellipse cx="16" cy="40.5" rx="12" ry="1.5" fill="rgba(255,140,0,0.22)"/>

                <!-- 火焰（放大 + 动态） -->
                <g transform="translate(16, 11) scale(${flameScale}) translate(-16, -11)">
                    <path class="source-flame" fill-rule="evenodd" fill="#FF4500" stroke="#FF8C00" stroke-width="0.5"
                      d="M16,0 C14,2.5 13.3,4.5 14.2,7 C13.2,6 12.3,8 13.3,9.3 C14.3,10.2 15.3,9.3 16,8 C16.7,9.3 17.7,10.2 18.7,9.3 C19.7,8 18.8,6 17.8,7 C18.7,4.5 18,2.5 16,0Z
                         M16,3.2 C15.5,4 15.4,4.8 15.7,5.5 C15.4,5.2 15.1,5.9 15.4,6.3 C15.7,6.7 16,6.3 16,5.9 C16,6.3 16.3,6.7 16.6,6.3 C16.9,5.9 16.6,5.2 16.3,5.5 C16.6,4.8 16.5,4 16,3.2Z"
                    />
                </g>

                <!-- 顶部平台 -->
                <rect x="10" y="12" width="12" height="3" rx="0.5" fill="#e2e8f0"/>

                <!-- 塔身实心背景（遮挡后面管道） -->
                <polygon points="10,15 22,15 28,40 4,40" fill="#1e293b" stroke="#334155" stroke-width="0.5"/>

                <!-- 塔腿 -->
                <line x1="10" y1="15" x2="4" y2="40" stroke="#e2e8f0" stroke-width="${legW}" stroke-linecap="round"/>
                <line x1="22" y1="15" x2="28" y2="40" stroke="#e2e8f0" stroke-width="${legW}" stroke-linecap="round"/>

                <!-- 交叉支撑 X1（上） -->
                <line x1="7" y1="18" x2="25" y2="23" stroke="#64748b" stroke-width="${braceW}"/>
                <line x1="7" y1="23" x2="25" y2="18" stroke="#64748b" stroke-width="${braceW}"/>
                <!-- 交叉支撑 X2（中） -->
                <line x1="6" y1="24" x2="26" y2="29" stroke="#64748b" stroke-width="${braceW}"/>
                <line x1="6" y1="29" x2="26" y2="24" stroke="#64748b" stroke-width="${braceW}"/>
                <!-- 交叉支撑 X3（下） -->
                <line x1="5" y1="30" x2="27" y2="35" stroke="#64748b" stroke-width="${braceW}"/>
                <line x1="5" y1="35" x2="27" y2="30" stroke="#64748b" stroke-width="${braceW}"/>
            </svg>
        </div>
    `
}

function createLngShipMarkerContent(isCompact = false): string {
    const w = isCompact ? LNG_MARKER_CONFIG.COMPACT_WIDTH : LNG_MARKER_CONFIG.WIDTH
    const h = isCompact ? LNG_MARKER_CONFIG.COMPACT_HEIGHT : LNG_MARKER_CONFIG.HEIGHT
    return `
        <div class="lng-ship-marker-container${isCompact ? ' compact' : ''}" title="LNG接收站">
            <svg width="${w}" height="${h}" viewBox="0 0 84 64" style="overflow:visible;" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="42" cy="54" rx="32" ry="6" fill="rgba(14,165,233,0.18)"/>
                <path class="lng-ship-wave" d="M12 52 C20 47 28 57 36 52 C44 47 52 57 60 52 C66 48 72 51 76 54"
                    fill="none" stroke="rgba(125,211,252,0.9)" stroke-width="3" stroke-linecap="round"/>
                <path d="M7 38 L58 38 L76 27 L66 49 L20 49 C14 49 9 44 7 38Z"
                    fill="#062f4f" stroke="#38bdf8" stroke-width="4" stroke-linejoin="round"/>
                <path d="M18 32 H33 L33 20 H47 L47 32 H60"
                    fill="none" stroke="#38bdf8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M34 20 L42 10 L50 20"
                    fill="none" stroke="#38bdf8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M19 39 H54 L68 31" fill="none" stroke="#bae6fd" stroke-width="2.5" stroke-linecap="round"/>
                <circle cx="25" cy="43" r="2" fill="#e0f2fe"/>
                <circle cx="36" cy="43" r="2" fill="#e0f2fe"/>
                <circle cx="47" cy="43" r="2" fill="#e0f2fe"/>
            </svg>
        </div>
    `
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
        box-shadow: 0 0 12px ${color}, 0 0 2px rgba(255,255,255,0.8);
        transition: all 0.2s ease;
        filter: brightness(1.1);
    " onmouseover="this.style.transform='scale(1.3)'; this.style.boxShadow='0 0 20px ${color}'" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 0 12px ${color}'"></div>`
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

    const rawType = getNodeRawType(node)
    const isSource = isSourceNode(node)
    const isLngSource = isLngSourceNode(node)
    const isCompressor = isCompressorNode(node)
    const isDistribution = isDistributionNode(node)
    const isHub = isHubNode(node)

    let marker: any
    let markerSize: number  // 用于计算 offset 居中

    if (isLngSource) {
        const markerWidth = LNG_MARKER_CONFIG.WIDTH + LNG_MARKER_CONFIG.CONTAINER_PADDING
        const markerHeight = LNG_MARKER_CONFIG.HEIGHT + LNG_MARKER_CONFIG.CONTAINER_PADDING
        markerSize = markerWidth
        marker = new AMap.Marker({
            position: [position.longitude, position.latitude],
            content: createLngShipMarkerContent(false),
            offset: new AMap.Pixel(-markerWidth / 2, -markerHeight / 2),
            draggable: true,
            cursor: 'move',
            zIndex: 152,
            extData: { node },
        zooms: [2, 30]
    })
    } else if (isSource) {
        markerSize = SOURCE_MARKER_CONFIG.SIZE + SOURCE_MARKER_CONFIG.CONTAINER_PADDING
        marker = new AMap.Marker({
            position: [position.longitude, position.latitude],
            content: createSourceMarkerContent(false),
            offset: new AMap.Pixel(-markerSize / 2, -markerSize / 2),
            draggable: true,
            cursor: 'move',
            zIndex: 151,
            extData: { node },
        zooms: [2, 30]
    })
    } else if (isHub) {
        markerSize = HUB_MARKER_CONFIG.SIZE + HUB_MARKER_CONFIG.CONTAINER_PADDING
        marker = new AMap.Marker({
            position: [position.longitude, position.latitude],
            content: createHubMarkerContent(false),
            offset: new AMap.Pixel(-markerSize / 2, -markerSize / 2),
            draggable: true,
            cursor: 'move',
            zIndex: 150,
            extData: { node },
        zooms: [2, 30]
    })
    } else if (isCompressor) {
        const content = createCompressorMarkerContent()
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
            extData: { node },
        zooms: [2, 30]
    })
    } else if (isDistribution) {
        markerSize = 12
        marker = new AMap.Marker({
            position: [position.longitude, position.latitude],
            content: createCircleNodeContent('#ffd700', 6, '#ffffff', 2),
            offset: new AMap.Pixel(-markerSize / 2, -markerSize / 2),
            draggable: true,
            cursor: 'move',
            zIndex: 130,
            extData: { node },
        zooms: [2, 30]
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
            extData: { node },
        zooms: [2, 30]
    })
    }

    // 注册到映射表，方便管线查找对应 marker
    nodeMarkerMap.set(node.id, marker)

    // 标签（也跟随拖拽移动）
    const baseLabelStyle = {
        'font-size': '10px',
        'font-weight': '500',
        'color': '#ccc',
        'background-color': 'rgba(0,0,0,0.5)',
        'border-radius': '2px',
        'padding': '1px 3px',
        'border': 'none',
        'transition': 'font-size 180ms ease, padding 180ms ease, background-color 180ms ease, color 180ms ease, box-shadow 180ms ease',
    }
    const hoverLabelStyle = {
        ...baseLabelStyle,
        'font-size': '14px',
        'font-weight': '800',
        'color': '#fff',
        'background-color': 'rgba(0,0,0,0.82)',
        'border-radius': '5px',
        'padding': '2px 7px',
        'box-shadow': '0 0 10px rgba(56,189,248,0.45)',
    }
    const text = new AMap.Text({
        text: node.name,
        position: [position.longitude, position.latitude],
        offset: isLngSource
            ? new AMap.Pixel(0, LNG_MARKER_CONFIG.HEIGHT / 2 + 5)
            : isSource
            ? new AMap.Pixel(0, SOURCE_MARKER_CONFIG.SIZE / 2 + 6)
            : isHub
            ? new AMap.Pixel(0, HUB_MARKER_CONFIG.SIZE / 2 + 6)
            : isCompressor
            ? new AMap.Pixel(0, COMPRESSOR_ICON_CONFIG.HEIGHT / 2 + 5)
            : new AMap.Pixel(0, -15),
        style: baseLabelStyle,
        zIndex: 121,
        zooms: [2, 30]
    })

    const enlargeNodeLabel = () => {
        text.setStyle?.(hoverLabelStyle)
        text.setzIndex?.(240)
    }
    const restoreNodeLabel = () => {
        text.setStyle?.(baseLabelStyle)
        text.setzIndex?.(121)
    }

    marker.on('mouseover', enlargeNodeLabel)
    marker.on('mouseout', restoreNodeLabel)

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
    nodes: PipelineNode[] = [],
    onLineClick?: (event: { line: PipelineLine; position: { longitude: number; latitude: number } }) => void,
    signal?: AbortSignal,
    options: PipelineRenderOptions = {}
): Promise<any[]> {
    return new Promise((resolve) => {
        const AMap = (window as any).AMap
        if (!AMap || !lines || lines.length === 0) {
            resolve([])
            return
        }

        const polylines: any[] = []
        const simulationEdgeMap = buildSimulationEdgeMap(options.simulationOverlay)
        const cutoffEdgeIds = new Set(options.cutoffEdgeIds || [])
        const networkxBeforePathEdgeIds = new Set(options.networkxCutoffOverlay?.beforePathEdgeIds || [])
        const networkxCutoffEdgeIds = new Set(options.networkxCutoffOverlay?.cutoffEdgeIds || [])
        const networkxAffectedEdgeIds = new Set(options.networkxCutoffOverlay?.affectedEdgeIds || [])
        const networkxRerouteEdgeIds = new Set(options.networkxCutoffOverlay?.rerouteEdgeIds || [])
        const networkxBlockedFlowEdgeIds = new Set(options.networkxCutoffOverlay?.blockedFlowEdgeIds || [])
        const networkxCutoffNodeIds = new Set(options.networkxCutoffOverlay?.cutoffNodeIds || [])
        const hasNetworkxCutoffOverlay = Boolean(options.networkxCutoffOverlay)
        const renderedBlockedFlowLineIds = new Set<string>()
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
                    const simEdge = resolveSimulationEdge(line, simulationEdgeMap)
                    const isNoFlow = isSimulationEdgeClosed(simEdge)
                    const isNetworkxCutoff = lineMatchesEdgeIds(line, networkxCutoffEdgeIds)
                    const isNetworkxAffected = lineMatchesEdgeIds(line, networkxAffectedEdgeIds)
                    const isNetworkxReroute = lineMatchesEdgeIds(line, networkxRerouteEdgeIds)
                    const isNetworkxBeforePath = lineMatchesEdgeIds(line, networkxBeforePathEdgeIds)
                    const isNetworkxBlockedFlow = lineMatchesEdgeIds(line, networkxBlockedFlowEdgeIds)
                    const isCutoff = lineMatchesEdgeIds(line, cutoffEdgeIds) || isNetworkxCutoff
                    if (
                        isCutoff
                        || isNetworkxBlockedFlow
                        || ((isNetworkxAffected || isNetworkxBeforePath) && !isNetworkxReroute)
                    ) {
                        renderedBlockedFlowLineIds.add(line.id)
                    }
                    const lineColor = isCutoff
                        ? '#ef4444'
                        : isNetworkxReroute
                            ? '#22c55e'
                            : isNetworkxAffected || isNetworkxBeforePath
                                ? '#f59e0b'
                                : isNetworkxBlockedFlow
                                    ? '#64748b'
                                : (isNoFlow && simEdge ? '#475569' : (simEdge?.color || color))
                    const haloColor = isCutoff
                        ? 'rgba(127, 29, 29, 0.92)'
                        : isNetworkxReroute
                            ? 'rgba(20, 83, 45, 0.92)'
                            : isNetworkxAffected || isNetworkxBeforePath
                                ? 'rgba(120, 53, 15, 0.9)'
                                : isNetworkxBlockedFlow
                                    ? 'rgba(15, 23, 42, 0.92)'
                                : 'rgba(8, 15, 23, 0.95)'
                    const strokeStyle = line.status === PipelineStatus.MAINTENANCE || isCutoff || isNetworkxAffected || isNetworkxBeforePath || isNetworkxBlockedFlow ? 'dashed' : 'solid'
                    const isBranch = getLinePipelineKind(line) === 'branch'
                    const baseWidth = isBranch ? 3 : (line.pressureLevel === PressureLevel.HIGH ? 7 : 5)
                    const simWidth = simEdge
                        ? Math.max(2, Math.min(9, Math.round(3 + simEdge.width_factor * 4)))
                        : baseWidth
                    const visualWidth = isCutoff || isNetworkxReroute || isNetworkxAffected || isNetworkxBeforePath ? Math.max(baseWidth, simWidth) : simWidth
                    const activeOpacity = hasNetworkxCutoffOverlay && !isCutoff && !isNetworkxReroute && !isNetworkxAffected && !isNetworkxBeforePath && !isNetworkxBlockedFlow
                        ? 0.28
                        : 0.98
                    const path = buildVisualLinePath(line)

                    const haloPolyline = new AMap.Polyline({
                        path,
                        strokeColor: haloColor,
                        strokeWeight: visualWidth + 4,
                        strokeOpacity: isCutoff || isNetworkxReroute || isNetworkxAffected || isNetworkxBeforePath || isNetworkxBlockedFlow ? 0.9 : (isNoFlow && simEdge ? 0.32 : activeOpacity * 0.75),
                        zIndex: isCutoff || isNetworkxReroute || isNetworkxAffected || isNetworkxBeforePath ? 66 : 46,
                        lineJoin: 'round',
                        lineCap: 'round',
                        zooms: [2, 30],
                        extData: { line, isHalo: true, simEdge, isCutoff },
                        showDir: true,    // 开启方向箭头显示流向
                        dirColor: '#ffffff',  // 箭头白色
                    })

                    const polyline = new AMap.Polyline({
                        path,
                        strokeColor: lineColor,
                        strokeWeight: visualWidth,
                        strokeStyle: strokeStyle,
                        strokeDasharray: isCutoff ? [10, 8] : (isNetworkxAffected || isNetworkxBeforePath || isNetworkxBlockedFlow) ? [7, 7] : undefined,
                        strokeOpacity: isCutoff || isNetworkxReroute || isNetworkxAffected || isNetworkxBeforePath ? 0.96 : (isNetworkxBlockedFlow ? 0.48 : (isNoFlow && simEdge ? 0.42 : activeOpacity)),
                        zIndex: isCutoff ? 78 : isNetworkxReroute ? 76 : isNetworkxAffected || isNetworkxBeforePath ? 70 : isNetworkxBlockedFlow ? 58 : 52,
                        lineJoin: 'round',
                        lineCap: 'round',
                        zooms: [2, 30],
                        extData: { line, isHalo: false, simEdge, isCutoff },
                    })

                    map.add(haloPolyline)
                    polylines.push(haloPolyline)

                    if (onLineClick) {
                        polyline.on('click', (e: any) => {
                            onLineClick({ line, position: { longitude: e.lnglat.lng, latitude: e.lnglat.lat } })
                        })
                    }

                    // NOTE: 注册到拖拽映射表，使节点拖动时能联动更新此管线
                    registerPolylineMapping(line, polyline)

                    map.add(polyline)
                    polylines.push(polyline)

                    if (isCutoff) {
                        const cutoffMarker = createCutoffMarker(map, path, line)
                        if (cutoffMarker) polylines.push(cutoffMarker)
                    }

                    // 不再在这里为单根极短管段创建光效，改在全部渲染完后基于合并长路径创建
                } catch (error) {
                    // 渲染失败，继续下一条
                }
            }

            index = batchEnd

            if (index < lines.length) {
                // 还有未渲染的，下一帧继续
                requestAnimationFrame(renderBatch)
            } else {
                if (networkxCutoffNodeIds.size > 0) {
                    nodes
                        .filter(node => networkxCutoffNodeIds.has(node.id))
                        .forEach(node => {
                            const marker = createNetworkxCutoffNodeMarker(map, node)
                            if (marker) polylines.push(marker)
                        })
                }

                // 1. 基础管线全部渲染完成，现在执行路径缝合算法，提取出贯穿全国的超长干线！
                const blockedFlowEdgeIds = new Set<string>([
                    ...cutoffEdgeIds,
                    ...networkxCutoffEdgeIds,
                    ...networkxBlockedFlowEdgeIds,
                    ...renderedBlockedFlowLineIds,
                    ...[...networkxAffectedEdgeIds].filter(id => !networkxRerouteEdgeIds.has(id)),
                ])

                const mergedPaths = mergeLinesIntoContinuousPaths(lines, nodes, simulationEdgeMap, {
                    blockedFlowEdgeIds,
                    blockedFlowNodeIds: networkxCutoffNodeIds,
                    rerouteEdgeIds: networkxRerouteEdgeIds,
                })

                // 2. 在这些超长干线上施加流动光效
                mergedPaths.forEach(({ path, color, totalLength, flowIntensity, flowDirection }) => {
                    if (totalLength > 20000) { // 只在大于20km的连续干线上运行动画
                        const flowMarkers = createLongFlowAnimation(map, path, color, totalLength, {
                            flowIntensity,
                            reverse: flowDirection === 'reverse',
                        })
                        if (flowMarkers && flowMarkers.length > 0) {
                            polylines.push(...flowMarkers)
                        }
                    }
                })

                resolve(polylines)
            }
        }

        // 开始渲染
        requestAnimationFrame(renderBatch)
    })
}

// ==========================================
// 连续长路径光流动画系统
// ==========================================

/**
 * 核心算法：将原本被阀室/站点打断的零散管段，根据连通性（拓扑）无缝缝合成一条条完整的干线路径
 */
function mergeLinesIntoContinuousPaths(
    lines: PipelineLine[],
    nodes: PipelineNode[],
    simulationEdgeMap?: Map<string, SimEdgeResult>,
    options: {
        blockedFlowEdgeIds?: Set<string>
        blockedFlowNodeIds?: Set<string>
        rerouteEdgeIds?: Set<string>
    } = {},
): MergedFlowPath[] {
    const paths: MergedFlowPath[] = []
    const { blockedFlowEdgeIds, blockedFlowNodeIds, rerouteEdgeIds } = options

    // 找出所有具备“打断/发射”资格的重点站点
    const hubNodeIds = new Set<string>()
    if (nodes && nodes.length > 0) {
        nodes.forEach(node => {
            const rawType = getNodeRawType(node)
            // 压气站、分输站、首末站、明确标注为枢纽的点，强制作为打断和发射的起点
            if (rawType === 'compressor' || rawType === 'distribution' || isSourceNode(node) || rawType === 'junction' || isMajorJunctionNode(node)) {
                hubNodeIds.add(node.id)
            }
        })
    }

    // 1. 统计每个节点的连接数，识别自然拓扑上的分支点 (度数 >= 3)
    const nodeDegree = new Map<string, number>()
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!shouldRenderFlowForLine(line, simulationEdgeMap, blockedFlowEdgeIds, blockedFlowNodeIds)) continue
        if (line.startNodeId) nodeDegree.set(line.startNodeId, (nodeDegree.get(line.startNodeId) || 0) + 1)
        if (line.endNodeId) nodeDegree.set(line.endNodeId, (nodeDegree.get(line.endNodeId) || 0) + 1)
    }

    // 按颜色/类别分组，确保我们只连接属于同一系统的管线
    const linesByColor = new Map<string, PipelineLine[]>()
    for (const line of lines) {
        if (!line.path || line.path.length < 2) continue
        if (!shouldRenderFlowForLine(line, simulationEdgeMap, blockedFlowEdgeIds, blockedFlowNodeIds)) continue
        const simEdge = resolveSimulationEdge(line, simulationEdgeMap)
        const isReroute = lineMatchesEdgeIds(line, rerouteEdgeIds)
        const color = isReroute ? '#22c55e' : (simEdge?.color || line.properties?.color || '#00e5ff') // default fallback

        if (!linesByColor.has(color)) linesByColor.set(color, [])
        linesByColor.get(color)!.push(line)
    }

    // 贪心拼接连续路径
    for (const [color, groupLines] of linesByColor.entries()) {
        const remaining = [...groupLines]
        while (remaining.length > 0) {
            const currentChain = [remaining.pop()!]
            let changed = true

            while (changed) {
                changed = false
                const headNode = currentChain[0].startNodeId
                const tailNode = currentChain[currentChain.length - 1].endNodeId

                // 枢纽点打断逻辑：如果头部或尾部节点连接数大于2（分支），
                // 或者它是明确的重要站点（压气站等），停止在该方向缝合。
                // 这保证了激光动画会在这些站点截止，并从这里重新向外发射。
                const headDegree = headNode ? (nodeDegree.get(headNode) || 0) : 0;
                const tailDegree = tailNode ? (nodeDegree.get(tailNode) || 0) : 0;

                const headIsHub = headDegree > 2 || (headNode && hubNodeIds.has(headNode));
                const tailIsHub = tailDegree > 2 || (tailNode && hubNodeIds.has(tailNode));
                const headIsBlocked = Boolean(headNode && blockedFlowNodeIds?.has(headNode));
                const tailIsBlocked = Boolean(tailNode && blockedFlowNodeIds?.has(tailNode));

                const canExtendHead = headNode && !headIsHub && !headIsBlocked;
                const canExtendTail = tailNode && !tailIsHub && !tailIsBlocked;

                if (!canExtendHead && !canExtendTail) {
                    break;
                }

                for (let i = 0; i < remaining.length; i++) {
                    const candidate = remaining[i]

                    if (canExtendHead && candidate.endNodeId === headNode) {
                        currentChain.unshift(candidate)
                        remaining.splice(i, 1)
                        changed = true
                        break
                    } else if (canExtendTail && candidate.startNodeId === tailNode) {
                        currentChain.push(candidate)
                        remaining.splice(i, 1)
                        changed = true
                        break
                    } else if (canExtendHead && candidate.startNodeId === headNode) {
                        // 倒排加入头部
                        const revPath = [...candidate.path].reverse()
                        currentChain.unshift({ ...candidate, path: revPath, startNodeId: candidate.endNodeId, endNodeId: candidate.startNodeId } as PipelineLine)
                        remaining.splice(i, 1)
                        changed = true
                        break
                    } else if (canExtendTail && candidate.endNodeId === tailNode) {
                        // 倒排加入尾部
                        const revPath = [...candidate.path].reverse()
                        currentChain.push({ ...candidate, path: revPath, startNodeId: candidate.endNodeId, endNodeId: candidate.startNodeId } as PipelineLine)
                        remaining.splice(i, 1)
                        changed = true
                        break
                    }
                }
            }

            // 将链条转换为连续点阵
            const mergedPath: number[][] = []
            let length = 0
            for (let i = 0; i < currentChain.length; i++) {
                const line = currentChain[i]
                length += line.length || 10000
                const pts = buildVisualLinePath(line)
                if (i > 0 && pts.length > 0) {
                    pts.shift() // 去除连接点重复坐标
                }
                mergedPath.push(...pts)
            }

            paths.push({
                path: mergedPath,
                color,
                totalLength: length,
                flowIntensity: getChainFlowIntensity(currentChain, simulationEdgeMap),
                flowDirection: getChainFlowDirection(currentChain, simulationEdgeMap),
            })
        }
    }

    return paths
}

function createLongFlowAnimation(
    map: any,
    points: number[][],
    color: string,
    fallbackLength: number,
    options: { flowIntensity?: number; reverse?: boolean } = {}
): any[] {
    const AMap = (window as any).AMap
    if (!AMap || points.length < 2) return []

    const flowPoints = options.reverse ? [...points].reverse() : points
    const flowIntensity = clampNumber(options.flowIntensity ?? 1, 0, 1.25)
    if (flowIntensity <= 0.01) return []

    // 1. 计算长距离
    const distances = [0]
    let totalLength = 0

    for (let i = 1; i < flowPoints.length; i++) {
        let d = 0
        try {
            d = AMap.GeometryUtil.distance(flowPoints[i - 1], flowPoints[i])
        } catch (e) {
            const dx = flowPoints[i][0] - flowPoints[i - 1][0]
            const dy = flowPoints[i][1] - flowPoints[i - 1][1]
            d = Math.sqrt(dx * dx + dy * dy) * 111000
        }
        totalLength += d
        distances.push(totalLength)
    }

    if (totalLength <= 0) totalLength = fallbackLength
    if (totalLength <= 0) return []

    // 3. 恢复之前的样式尺寸（更大气）
    const flowLength = Math.max(5000, Math.min(50000, totalLength * (0.07 + flowIntensity * 0.04)))

    // 全局统一速度：例如 100 km/s (100,000 m/s -> 100 m/ms)
    // 保证长短管线上的光束跑得一样快
    const SPEED_M_PER_MS = 45 + flowIntensity * 55;

    // 跑完这根管线需要的时间
    const durationMs = totalLength / SPEED_M_PER_MS;

    // 全局统一发射周期（按您的要求，2秒一发）
    // 这保证了只要是从同一个枢纽出发的管线，必定在同一绝对时间点同时发射光束
    const GLOBAL_CYCLE_MS = 2600 - flowIntensity * 600;

    // 只要起点坐标相同，globalOffset 就完全一致！
    const startX = Math.round(flowPoints[0][0] * 1000)
    const startY = Math.round(flowPoints[0][1] * 1000)
    const globalOffset = Math.floor((startX * 12345 + startY * 67890) % GLOBAL_CYCLE_MS)

    // 根据管线总耗时和发射周期，计算这根管线上同时会存在几条光束
    const numBeams = Math.max(1, Math.ceil(durationMs / GLOBAL_CYCLE_MS))
    const localCycleMs = numBeams * GLOBAL_CYCLE_MS;

    const polylines: any[] = []

    for (let i = 0; i < numBeams; i++) {
        // 2. 创建叠加折线
        const flowPolyline = new AMap.Polyline({
            path: [],
            strokeColor: '#ffffff', // 核心高亮白
            strokeWeight: flowIntensity < 0.4 ? 1 : 2,
            isOutline: true,
            outlineColor: color,
            borderWeight: flowIntensity < 0.4 ? 2 : 3,
            strokeOpacity: clampNumber(0.35 + flowIntensity * 0.65, 0.35, 1),
            zIndex: 100,
            lineJoin: 'round',
            lineCap: 'round',
        })

        map.add(flowPolyline)
        polylines.push(flowPolyline)

        // 错开多条光束。这里保证第一条光束（i=0）必然在 time=0 发射
        const startTime = Date.now() - globalOffset - (i * GLOBAL_CYCLE_MS)

        // 4. 动画循环
        const animate = () => {
            if (!flowPolyline.getMap()) return

            try {
                const now = Date.now()
                const delta = now - startTime
                // 计算当前光束在自身的大周期中的时间
                const timeInCycle = ((delta % localCycleMs) + localCycleMs) % localCycleMs

                // 如果当前时间已经超过了跑完管线所需的时间，就隐藏（直到下一个周期再出现）
                if (timeInCycle > durationMs) {
                    flowPolyline.hide()
                } else {
                    const progress = timeInCycle / durationMs

                    const headDist = progress * (totalLength + flowLength)
                    const tailDist = headDist - flowLength

                    const subPath = getSubPath(flowPoints, distances, tailDist, headDist)

                    if (subPath.length < 2) {
                        flowPolyline.hide()
                    } else {
                        flowPolyline.show()
                        flowPolyline.setPath(subPath)
                    }
                }
            } catch (err) {
                // 静默失败
            }

            requestAnimationFrame(animate)
        }

        requestAnimationFrame(animate)
    }

    return polylines
}


function getSubPath(points: number[][], distances: number[], startDist: number, endDist: number) {
    if (endDist <= 0 || startDist >= distances[distances.length - 1]) return []

    const subPoints = []

    for (let i = 0; i < points.length - 1; i++) {
        const d1 = distances[i]
        const d2 = distances[i+1]

        if (d2 <= startDist) continue
        if (d1 >= endDist) break

        const p1 = points[i]
        const p2 = points[i+1]
        const segLen = d2 - d1

        if (startDist > d1 && startDist < d2) {
            const ratio = (startDist - d1) / segLen
            const lng = p1[0] + (p2[0] - p1[0]) * ratio
            const lat = p1[1] + (p2[1] - p1[1]) * ratio
            subPoints.push([lng, lat])
        } else if (d1 >= startDist && subPoints.length === 0) {
            subPoints.push(p1)
        }

        if (endDist > d1 && endDist < d2) {
            const ratio = (endDist - d1) / segLen
            const lng = p1[0] + (p2[0] - p1[0]) * ratio
            const lat = p1[1] + (p2[1] - p1[1]) * ratio
            subPoints.push([lng, lat])
            break
        } else if (d2 <= endDist) {
            subPoints.push(p2)
        }
    }

    return subPoints
}



function isValveRoom(node: PipelineNode): boolean {
    if (node.type === NodeType.VALVE || isValveNode(node)) return true
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
        const lodStrategy = getNodeLODStrategy(currentZoom)

        // 阀室全局过滤：在分组前就移除阀室节点，防止它们出现在任何渲染分支中
        const filteredNodes = nodes.filter(node => shouldShowNodeAtZoom(node, currentZoom, lodStrategy))

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
                        if (!shouldShowNodeAtZoom(node, currentZoom, lodStrategy)) {
                            continue
                        }

                        const markers = createOffsetNodeMarker(map, node, node.coordinate, onNodeClick)
                        if (markers && markers.length > 0) {
                            map.add(markers)
                            overlays.push(...markers)
                        }
                    }
                    else if (lodStrategy.clusterDisplayMode === 'expanded' || shouldPreferCompactFanout(group, currentZoom)) {
                        // 高缩放级别：站点仍按真实坐标绘制，避免标记脱离管线造成拓扑误读。
                        const nodeCount = group.nodes.length

                        for (let idx = 0; idx < nodeCount; idx++) {
                            const node = group.nodes[idx]

                            // 阀室隐藏机制：低缩放级别下阀室节点跳过创建
                            if (!shouldShowNodeAtZoom(node, currentZoom, lodStrategy)) {
                                continue
                            }

                            const markers = createOffsetNodeMarker(map, node, node.coordinate, onNodeClick)
                            if (markers && markers.length > 0) {
                                map.add(markers)
                                overlays.push(...markers)
                            }
                        }
                    }
                    else if (shouldUseClusterMarker(group)) {
                        // 气源/LNG/枢纽保留专用聚合图标，普通站场/阀室不再使用数字气泡。
                        const clusterMarker = createClusterMarker(map, group, onClusterClick)
                        if (clusterMarker) {
                            map.add(clusterMarker)
                            overlays.push(clusterMarker)
                        }
                    }
                    else {
                        for (const node of group.nodes) {
                            if (!shouldShowNodeAtZoom(node, currentZoom, lodStrategy)) {
                                continue
                            }

                            const markers = createOffsetNodeMarker(map, node, node.coordinate, onNodeClick)
                            if (markers && markers.length > 0) {
                                map.add(markers)
                                overlays.push(...markers)
                            }
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
                        zIndex: 110,
        zooms: [2, 30]
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
