/**
 * 地图拓扑管理视图（独立页面）
 *
 * 只显示纯拓扑层（简洁圆点 + 直线），隐藏所有站场/阀室的复杂图形。
 * 独立于全国管网统一视图和 Canvas 拓扑视图。
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import MapView from '@/components/map-view/MapView'
import ScadaHistoryChart from '@/components/scada/ScadaHistoryChart'
import SimParamEditor from '@/components/topology/SimParamEditor'
import { buildPipelineDataFromPackages, invalidatePipelineCache, loadAllPipelines } from '@/data/pipelines'
import type { PipelinePackage } from '@/data/pipelines/types'
import type { SimulationResult, SeedNodePressure } from '@/services/api'
import {
    topologyEditorApi,
    type JunctionGroup,
    type PositionPreviewResult,
} from '@/services/topologyEditorApi'
import type { PipelineNode, PipelineLine } from '@/types'
import { useSimulation } from '@/hooks/useSimulation'
import {
    DEFAULT_WE1_PILOT_ID,
    resolveSimulationPilotConfig,
} from '@/types/simulation'
import type { SimulationInitialInput, SimulationOverlay } from '@/types/simulation'
import { buildSimulationOverlayMapping } from '@/utils/simulationOverlayMapping'
import {
    writeSimulationShowcaseSyncContext,
    readSimulationShowcaseSyncContext,
    clearSimulationShowcaseSyncContext,
} from '@/utils/simulationShowcaseSync'
import { setAssistantRuntimeContext } from '@/components/ai-assistant/runtimeAssistantContext'
import {
    validateTopology,
    computeBetweennessCentrality,
    findIsolatedNodes,
} from '@/utils/topology-validator'
import type { ValidationReport } from '@/utils/topology-validator'
import { simulateCutoff, simulateEdgeCutoff, searchNodes, pathIdsToNames } from '@/utils/cutoff-simulator'
import type { CutoffResult } from '@/utils/cutoff-simulator'

// ================== 类型 ==================
type PointType = 'station' | 'valve' | 'distribution' | 'compressor' | 'junction'
type EditMode = 'view' | 'draw-point' | 'connect' | 'merge'
type PanelTab = 'edit' | 'validate' | 'search' | 'centrality' | 'cutoff' | 'simulation'

interface TopoNode {
    id: string
    type: PointType
    name: string
    position: [number, number]
    sourceNodeIds?: string[]
    junctionId?: number
    isJunction?: boolean
    junctionKind?: string
    sourceTable?: string
    marker?: any
}

interface TopoEdge {
    id: string
    startNodeId: string
    endNodeId: string
    name?: string
    sourceEdgeIds?: string[]
    persisted?: boolean
    /** 从原始管线数据汇总的默认长度（km），未被用户覆盖时作为仿真入参 */
    defaultLengthKm?: number
    poly?: any
}

interface BaseTopoNode {
    id: string
    type: PointType
    name: string
    position: [number, number]
}

interface BaseTopoEdge {
    id: string
    startNodeId: string
    endNodeId: string
    name?: string
    sourceEdgeIds?: string[]
    persisted?: boolean
    /** 从原始管线数据汇总的默认长度（km） */
    defaultLengthKm?: number
}

const WE1_PRIMARY_PILOT_ID = DEFAULT_WE1_PILOT_ID
const TOPOLOGY_DRAFT_STORAGE_KEY = 'smartgas-map-topology-draft-v1'

function formatDateTimeLabel(value?: string): string {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString('zh-CN', { hour12: false })
}

function estimateTemperatureByPressure(pressureMpa: number): number {
    return Number((13 + pressureMpa * 1.7).toFixed(1))
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0
    if (value <= 0) return 0
    if (value >= 1) return 1
    return value
}

/** Haversine 公式计算两地理坐标间球面距离（km） */
function haversineKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatSignedNumber(value: number, digits = 2): string {
    const sign = value > 0 ? '+' : ''
    return `${sign}${value.toFixed(digits)}`
}

function buildOpsSuggestion(alertCount: number, avgUtilization: number, solverStatus: 'converged' | 'max_iter' | 'error'): string {
    if (solverStatus === 'error') return '本次求解失败，先检查场景参数和边界条件，再重跑主仿真。'
    if (solverStatus === 'max_iter') return '本次达到迭代上限，建议先缩小扰动幅度并核对基线快照。'
    if (alertCount >= 5) return '告警偏多，优先排查主干高负荷段和压气站上下游压差。'
    if (avgUtilization >= 0.82) return '利用率偏高，建议先做限流场景对比并准备调峰策略。'
    return '运行状态平稳，可将当前结果作为下一轮异常场景对比基线。'
}

function safeSetMarkerContent(marker: any, content: string): void {
    try {
        marker?.setContent?.(content)
    } catch (error) {
        console.warn('[MapTopologyView] marker.setContent failed', error)
    }
}

function safeSetPolylineOptions(polyline: any, options: Record<string, unknown>): void {
    try {
        polyline?.setOptions?.(options)
    } catch (error) {
        console.warn('[MapTopologyView] polyline.setOptions failed', error)
    }
}

function forEachEdgePolyline(edge: TopoEdge, callback: (polyline: any) => void): void {
    const polylines = Array.isArray(edge.poly)
        ? edge.poly
        : edge.poly
            ? [edge.poly]
            : []
    polylines.forEach(callback)
}

function buildParallelEdgePath(
    start: [number, number],
    end: [number, number],
    index: number,
    total: number
): [number, number][] {
    if (total <= 1) {
        return [start, end]
    }

    const centerIndex = (total - 1) / 2
    const offsetStep = total === 2 ? 0.0024 : 0.0015
    const offset = (index - centerIndex) * offsetStep
    const midLat = ((start[1] + end[1]) / 2) * Math.PI / 180
    const dx = (end[0] - start[0]) * Math.cos(midLat)
    const dy = end[1] - start[1]
    const length = Math.hypot(dx, dy) || 1
    const perpX = -dy / length
    const perpY = dx / length
    const lngScale = Math.cos(midLat) || 1

    const offsetStart: [number, number] = [
        start[0] + (perpX * offset) / lngScale,
        start[1] + perpY * offset,
    ]
    const offsetEnd: [number, number] = [
        end[0] + (perpX * offset) / lngScale,
        end[1] + perpY * offset,
    ]

    return [offsetStart, offsetEnd]
}

const SOLVER_STATUS_LABELS: Record<'converged' | 'max_iter' | 'error', string> = {
    converged: '已收敛',
    max_iter: '达到迭代上限',
    error: '求解失败',
}

const FAILURE_LAYER_LABELS: Record<'frontend-consumption' | 'mapping-source-ids' | 'overlay-contract' | 'rendering-style', string> = {
    'frontend-consumption': '先查前端消费层（MapTopologyView / 面板）',
    'mapping-source-ids': '再查 source IDs 到 overlay IDs 的映射',
    'overlay-contract': '再查 simulation-overlay 契约',
    'rendering-style': '最后再查地图样式和渲染对象',
}

const MAINLINE_SCENARIO_PLAYBOOK: Record<string, {
    focus: string
    success: string
    risk: string
    talk: string
}> = {
    steady_base: {
        focus: '先看主干压力和流量是不是平顺，确认第一张图能稳定跑通。',
        success: '总供给、总需求、平均利用率都能正常落出来，告警数不要突然升高。',
        risk: '如果常规稳态都没有结果，后面的异常场景先别讲，先把正式仿真跑通。',
        talk: '先用常规稳态把主链打通，证明拓扑、稳态求解和页面都已经连上。',
    },
    zhongwei_compressor_offline: {
        focus: '重点看中卫压气站停运后，上下游压力有没有明显掉落。',
        success: '基线对比里能看出节点压差，命中节点和告警数会比常规稳态更明显。',
        risk: '如果没选基线快照，这个场景可能看到当前值，看不出停运前后差异。',
        talk: '这一幕主要讲压气站异常后，主干压力是怎么往上下游传递的。',
    },
    zhongwei_trunk_break: {
        focus: '重点看中卫附近主干中断后，连线流量和下游供给怎么变化。',
        success: '基线对比里的连线流量变化会很突出，下游命中点线和告警会一起抬头。',
        risk: '如果映射覆盖摘要里命中不足，这个场景会看不清楚断点影响先传到哪。',
        talk: '这一幕讲主干故障传播，最适合拿来演示第一张图的核心价值。',
    },
    yanchi_jingbian_limited: {
        focus: '重点看盐池到靖边限流后，利用率和关键段负载有没有抬升。',
        success: '运行结果摘要里平均利用率会变化，连线详情里的利用率差值能看出来。',
        risk: '如果当前场景没留快照，只靠一次运行结果，不适合拿来做稳定验收。',
        talk: '这一幕讲限流，不是断辟，而是主干还能跑但运行边界开始变紧。',
    },
    zhongwei_supply_pressure_drop: {
        focus: '重点看中卫出站压力下调后，全段压力梯度和下游告警有没有抬升。',
        success: '中卫侧扰动能沿主干传到华东，节点压力和告警数有清晰变化。',
        risk: '如果边界压力变化不明显，优先核对 seed 里的中卫 source 覆盖参数。',
        talk: '这一幕讲上游边界变弱后，长距离主干是怎么把影响传到华东末端的。',
    },
    zhengzhou_compressor_offline: {
        focus: '重点看郑州压气站停运后，河南到华东段压力恢复能力。',
        success: '郑州下游节点能出现可解释的压力变化，告警集中在中下游。',
        risk: '当前 solver 是线性近似，不能把它讲成生产级水力模型。',
        talk: '这一幕讲中游压气站异常，适合说明全段仿真能看传播范围。',
    },
    east_china_peak_demand: {
        focus: '重点看苏锡常沪方向负荷上调后，主干利用率和末端压力。',
        success: '华东段流量利用率抬升，末端压力仍能给出可对比结果。',
        risk: '负荷值是二阶段演示口径，正式验收前要接 SCADA 和调度计划。',
        talk: '这一幕讲华东负荷高峰，能把仿真结果落到末端保供上。',
    },
    baihe_delivery_limited: {
        focus: '重点看白鹤前最后管段限流后，末站交付和告警变化。',
        success: '白鹤相关边的利用率和末端压力能明显区别于常规稳态。',
        risk: '单段限流只代表演示工况，不代表真实事故处置策略。',
        talk: '这一幕讲末端交付受限，适合做前后对比和风险点评。',
    },
}

const COVERAGE_RECOMMENDATION_ORDER = [
    'east_china_peak_demand',
    'baihe_delivery_limited',
    'zhengzhou_compressor_offline',
    'zhongwei_supply_pressure_drop',
    'zhongwei_trunk_break',
    'zhongwei_compressor_offline',
    'yanchi_jingbian_limited',
    'steady_base',
]

function resolveFocusTarget(nodes: TopoNode[], focusNodeId: string): TopoNode | null {
    const directNode = nodes.find(node => node.id === focusNodeId)
    if (directNode) return directNode

    const sourceNode = nodes.find(node => node.sourceNodeIds?.includes(focusNodeId))
    if (sourceNode) return sourceNode

    if (focusNodeId.startsWith('JUNCTION-')) {
        const junctionId = Number.parseInt(focusNodeId.slice('JUNCTION-'.length), 10)
        if (Number.isFinite(junctionId)) {
            return nodes.find(node => node.junctionId === junctionId) || null
        }
    }

    return null
}

// ================== 拓扑样式（极简圆点 + 颜色区分） ==================
const TOPO_COLORS: Record<PointType, string> = {
    compressor: '#FF9800',
    distribution: '#2196F3',
    junction: '#00e5ff',
    station: '#F44336',
    valve: '#9E9E9E',
}

const TOPO_LABELS: Record<PointType, string> = {
    compressor: '压气站',
    distribution: '分输站',
    junction: '交汇枢纽',
    station: '站场',
    valve: '阀室',
}

const TOPO_SIZES: Record<PointType, number> = {
    compressor: 10,
    distribution: 8,
    junction: 9,
    station: 8,
    valve: 5,
}

const MANUAL_JUNCTION_EDIT_ENABLED_BY_DEFAULT =
    String(import.meta.env.VITE_TOPOLOGY_MANUAL_JUNCTION_EDIT ?? '1').trim() !== '0'
const JUNCTION_READONLY_HINT = '当前枢纽由运行时重编结果维护，编辑器仅支持只读查看，不再以手工捏合作为主流程。'
const JUNCTION_MODE_LABELS: Record<string, string> = {
    runtime_readonly: '只读模式',
    legacy_editable: '旧流程兼容',
}

const LINE_COLOR = '#34d399'
const LINE_WEIGHT = 2
const TOPO_RENDER_BUDGET = {
    full: { maxNodes: 520, maxEdges: 760 },
    lite: { maxNodes: 260, maxEdges: 360 },
}

/** 从 PipelineNode.type (NodeType 枚举值，均为小写) 映射到编辑器 PointType */
const TYPE_MAP: Record<string, PointType> = {
    regulator: 'compressor',
    metering: 'distribution',
    valve: 'valve',
    junction: 'junction',
    // NOTE: sj4 等新数据文件直接使用 compressor/distribution 等值
    compressor: 'compressor',
    distribution: 'distribution',
}

// ================== 创建纯拓扑圆点标记 ==================
function createTopoMarkerContent(type: PointType, name: string = '', isHighlight = false, isJunction = false): string {
    const color = TOPO_COLORS[type]
    const size = isJunction ? TOPO_SIZES.station + 4 : TOPO_SIZES[type]
    const border = isHighlight ? '2px solid #fff' : '1px solid rgba(255,255,255,0.5)'
    const shadow = isHighlight ? '0 0 8px rgba(255,255,255,0.5)' : 'none'
    const shapeStyle = isJunction
        ? `width:${size}px;height:${size}px;transform: rotate(45deg);border-radius: 3px;background:${color};border:${border};box-shadow:${shadow}; pointer-events: auto;`
        : `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border};box-shadow:${shadow}; pointer-events: auto;`
    
    return `
        <div style="position: relative; display: flex; flex-direction: column; align-items: center; pointer-events: none;">
            <div style="${shapeStyle}"></div>
            ${name ? `<div style="position: absolute; top: ${size + 4}px; white-space: nowrap; font-size: 11px; color: #fff; text-shadow: 0 0 2px #000, 0 0 2px #000, 0 0 2px #000; z-index: 10;">${name}</div>` : ''}
        </div>
    `
}

// ================== 主组件 ==================
const MapTopologyView: React.FC = () => {
    const location = useLocation()
    const [mapInstance, setMapInstance] = useState<any>(null)
    const handleMapLoad = useCallback((map: any) => setMapInstance(map), [])
    const importedOnceRef = useRef(false)
    const appliedFocusNodeRef = useRef<string | null>(null)

    // 管线数据异步加载
    const [pipelines, setPipelines] = useState<PipelinePackage[]>([])
    useEffect(() => {
        loadAllPipelines()
            .then(data => setPipelines(data))
            .catch(err => console.error('[MapTopologyView] 管线数据加载失败:', err))
    }, [])

    // 编辑器状态
    const [baseTopoNodes, setBaseTopoNodes] = useState<BaseTopoNode[]>([])
    const [baseTopoEdges, setBaseTopoEdges] = useState<BaseTopoEdge[]>([])
    const [topoNodes, setTopoNodes] = useState<TopoNode[]>([])
    const [topoEdges, setTopoEdges] = useState<TopoEdge[]>([])
    const [junctionGroups, setJunctionGroups] = useState<JunctionGroup[]>([])
    const [manualJunctionEditingEnabled, setManualJunctionEditingEnabled] = useState(
        MANUAL_JUNCTION_EDIT_ENABLED_BY_DEFAULT
    )
    const [junctionMode, setJunctionMode] = useState<string>('runtime_readonly')
    const [editMode, setEditMode] = useState<EditMode>('view')
    const [pointType, setPointType] = useState<PointType>('station')
    const [connectFrom, setConnectFrom] = useState<string | null>(null)
    const [statusMsg, setStatusMsg] = useState('点击「导入拓扑」加载已有管线')
    const [selectedMergeNodeIds, setSelectedMergeNodeIds] = useState<string[]>([])
    const [mergeJunctionName, setMergeJunctionName] = useState('')
    const [mergeJunctionDescription, setMergeJunctionDescription] = useState('')
    const [isMerging, setIsMerging] = useState(false)
    const [deletingJunctionId, setDeletingJunctionId] = useState<number | null>(null)
    const [activeTab, setActiveTab] = useState<PanelTab>('edit')
    const [searchText, setSearchText] = useState('')
    const [report, setReport] = useState<ValidationReport | null>(null)
    const [centralityData, setCentralityData] = useState<Array<{ id: string; name: string; value: number }>>([])

    // 仿真状态 (Sim Status)
    const [simDrawerVisible, setSimDrawerVisible] = useState(false)
    const [isSimulating, setIsSimulating] = useState(false)
    const [simResults, setSimResults] = useState<SimulationResult[]>([])
    const [currentSimStep, setCurrentSimStep] = useState(0)
    const [selectedNode, setSelectedNode] = useState<TopoNode | null>(null)
    const [seedNodePressures, setSeedNodePressures] = useState<Map<string, SeedNodePressure>>(new Map())
    const [nodeParamOverrides, setNodeParamOverrides] = useState<Record<string, { target_pressure_mpa?: number; min_pressure_mpa?: number; temperature_c?: number }>>({})
    const [showSimParamEditor, setShowSimParamEditor] = useState(false)
    const [showSnapshotPressureOverlay, setShowSnapshotPressureOverlay] = useState(false)
    const [globalParamDefaults, setGlobalParamDefaults] = useState<{
        default_pressure_mpa?: number
        default_temperature_c?: number
        default_flow_rate?: number
        apply_to_sources?: boolean
    }>({})
    const [historyChartTarget, setHistoryChartTarget] = useState<null | {
        stationName?: string
        junctionId?: string
        displayName?: string
    }>(null)
    const [pressurePopupOverlay, setPressurePopupOverlay] = useState<SimulationOverlay | null>(null)
    const [pressurePopupVisible, setPressurePopupVisible] = useState(false)
    const pressurePopupPendingRef = useRef(false)
    const lastPressurePopupRunIdRef = useRef('')

    // Tooltip 悬浮框状态
    const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
    const [tooltipPos, setTooltipPos] = useState<{ x: number, y: number } | null>(null)
    const activeTabRef = useRef<PanelTab>(activeTab)

    // ================== 稳态仿真 (useSimulation) ==================
    const queryPilotId = useMemo(() => {
        return new URLSearchParams(location.search).get('pilotId') || WE1_PRIMARY_PILOT_ID
    }, [location.search])
    const activePilot = useMemo(() => resolveSimulationPilotConfig(queryPilotId), [queryPilotId])
    const PILOT_ID = activePilot.id
    const scenarioOptions = activePilot.scenarios
    const sim = useSimulation({ pilotId: PILOT_ID, scenarios: scenarioOptions })

    const simulationSourceInfo = useMemo(() => {
        if (!sim.overlay) return null
        const sourceNode = sim.overlay.nodes.find(node => node.supply_actual > 0) || sim.overlay.nodes[0]
        if (!sourceNode) return null
        const matchedTopoNode = topoNodes.find(node => node.id === sourceNode.id || node.sourceNodeIds?.includes(sourceNode.id))
        const firstFlowEdge = sim.overlay.edges.find(edge => edge.flow_rate > 0)
        return {
            id: sourceNode.id,
            name: matchedTopoNode?.name || sourceNode.id,
            pressureIn: sourceNode.pressure_in_mpa ?? sourceNode.pressure_mpa,
            pressureOut: sourceNode.pressure_mpa,
            supplyActual: sourceNode.supply_actual,
            firstFlowRate: firstFlowEdge?.flow_rate ?? 0,
        }
    }, [sim.overlay, topoNodes])

    const pressurePopupRows = useMemo(() => {
        if (!pressurePopupOverlay) return []

        const findName = (nodeId: string): string => {
            const matchedTopoNode = topoNodes.find(node => node.id === nodeId || node.sourceNodeIds?.includes(nodeId))
            return matchedTopoNode?.name || nodeId
        }

        const rows = pressurePopupOverlay.nodes.map(node => ({
            id: node.id,
            name: findName(node.id),
            pressureIn: node.pressure_in_mpa ?? node.pressure_mpa,
            pressureOut: node.pressure_mpa,
            delta: node.pressure_mpa - (node.pressure_in_mpa ?? node.pressure_mpa),
            supplyActual: node.supply_actual,
            demandServed: node.demand_served,
            alertLevel: node.alert_level,
        }))

        const keyIds = ['WE1-76', 'WE1-86', 'WE1-92', 'WE1-127', 'WE1-152', 'WE1-176', 'WE1-180', 'WE1-181']
        const keyRows = keyIds
            .map(id => rows.find(row => row.id === id))
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
        const keySet = new Set(keyRows.map(row => row.id))
        const alertRows = rows
            .filter(row => !keySet.has(row.id) && row.alertLevel !== 'normal')
            .slice(0, 6)

        return [...keyRows, ...alertRows]
    }, [pressurePopupOverlay, topoNodes])

    // SimParamEditor 状态
    const [nodeOverrides, setNodeOverrides] = useState<Record<string, { target_pressure_mpa?: number; min_pressure_mpa?: number }>>({})
    const [edgeLengthOverrides, setEdgeLengthOverrides] = useState<Record<string, number>>({})
    const [globalDefaults, setGlobalDefaults] = useState<{ default_pressure_mpa?: number; default_flow_rate?: number; apply_to_sources?: boolean }>({})
    const [paramValidationError, setParamValidationError] = useState<string | null>(null)

    // 流动动画与渲染安全
    const [lineFlowPhase, setLineFlowPhase] = useState(0)
    const [damageFlashVisible, setDamageFlashVisible] = useState(false)
    const [isMapInteracting, setIsMapInteracting] = useState(false)
    const [renderSafetyMode, setRenderSafetyMode] = useState<'full' | 'lite'>('full')
    const isLargeGraphMode = renderSafetyMode === 'lite' || topoNodes.length > 320 || topoEdges.length > 480

    // 撤销栈
    type UndoAction =
        | { type: 'add-node'; nodeId: string }
        | { type: 'add-edge'; edgeId: string }
        | { type: 'create-junction'; junctionId: number; name: string }
        | { type: 'delete-junction'; group: JunctionGroup }
    const [undoStack, setUndoStack] = useState<UndoAction[]>([])

    // 截断仿真状态
    const [cutoffNodeId, setCutoffNodeId] = useState<string | null>(null)
    const [cutoffEdgeId, setCutoffEdgeId] = useState<string | null>(null)
    const [cutoffClosedEdgeIds, setCutoffClosedEdgeIds] = useState<string[]>([])
    const [cutoffStoppedEdgeIds, setCutoffStoppedEdgeIds] = useState<string[]>([])
    const [cutoffResult, setCutoffResult] = useState<CutoffResult | null>(null)
    const [cutoffSearch, setCutoffSearch] = useState('')

    // 保存机制：跟踪拖拽修改的坐标
    const [dirtyPositions, setDirtyPositions] = useState<Map<string, [number, number]>>(new Map())
    const [isSaving, setIsSaving] = useState(false)
    const [cascadeValves, setCascadeValves] = useState(true)
    const [positionPreview, setPositionPreview] = useState<PositionPreviewResult | null>(null)
    const [isPreviewing, setIsPreviewing] = useState(false)

    // 已高亮的 marker 原始 content，用于恢复
    const highlightedMarkersRef = useRef<Map<string, string>>(new Map())

    // Refs — 解决闭包陈旧引用
    const nodesRef = useRef<TopoNode[]>([])
    const edgesRef = useRef<TopoEdge[]>([])
    const modeRef = useRef<EditMode>('view')
    const ptRef = useRef<PointType>('station')
    const cfRef = useRef<string | null>(null)

    useEffect(() => { nodesRef.current = topoNodes; edgesRef.current = topoEdges }, [topoNodes, topoEdges])
    useEffect(() => { modeRef.current = editMode; ptRef.current = pointType }, [editMode, pointType])
    useEffect(() => { cfRef.current = connectFrom }, [connectFrom])
    useEffect(() => { activeTabRef.current = activeTab }, [activeTab])

    // ================== 收集全部管线原始数据（不传给 MapView，仅供导入用） ==================
    const rawPipelineData = useMemo(() => {
        const { nodes, lines } = buildPipelineDataFromPackages(pipelines)
        return { nodes, lines }
    }, [pipelines])

    const clearRenderedTopology = useCallback(() => {
        nodesRef.current.forEach(node => node.marker?.setMap(null))
        edgesRef.current.forEach(edge => forEachEdgePolyline(edge, polyline => polyline?.setMap(null)))
        highlightedMarkersRef.current.clear()
    }, [])

    useEffect(() => {
        setPositionPreview(null)
    }, [cascadeValves, dirtyPositions])

    const resetUnsavedPositions = useCallback(() => {
        if (dirtyPositions.size === 0) return
        void loadAllPipelines()
            .then(data => {
                setPipelines(data)
                const coordMap = new Map<string, [number, number]>()
                for (const pkg of data) {
                    for (const layer of pkg.layers) {
                        for (const node of layer.nodes) {
                            coordMap.set(node.id, [node.coordinate.longitude, node.coordinate.latitude])
                        }
                    }
                }
                setBaseTopoNodes(prev => prev.map(node => {
                    const next = coordMap.get(node.id)
                    return next ? { ...node, position: next } : node
                }))
                setDirtyPositions(new Map())
                setPositionPreview(null)
                setStatusMsg('已撤销未保存的点位修改')
            })
            .catch(error => {
                console.error(error)
                setStatusMsg('撤销未保存修改失败')
            })
    }, [dirtyPositions.size])

    const loadJunctionGroups = useCallback(async () => {
        try {
            const result = await topologyEditorApi.getJunctionGroups()
            setJunctionGroups(result.junctions)
            setManualJunctionEditingEnabled(result.manual_editing_enabled)
            setJunctionMode(result.mode)
            return result.junctions
        } catch (error) {
            console.error('[MapTopologyView] 枢纽组加载失败:', error)
            setStatusMsg(error instanceof Error ? `加载枢纽组失败：${error.message}` : '加载枢纽组失败')
            return []
        }
    }, [])

    const isRuntimeReadonlyGroup = useCallback((group: JunctionGroup) => {
        return group.source_table === 'junction_groups_rebuilt'
    }, [])

    const manualEditableJunctionGroups = useMemo(() => {
        return junctionGroups.filter(group => !isRuntimeReadonlyGroup(group))
    }, [junctionGroups, isRuntimeReadonlyGroup])

    const selectedMergeNodeSet = useMemo(() => new Set(selectedMergeNodeIds), [selectedMergeNodeIds])
    const selectedMergeNodes = useMemo(() => {
        return topoNodes.filter(node => !node.isJunction && selectedMergeNodeSet.has(node.id))
    }, [selectedMergeNodeSet, topoNodes])
    const selectedMergeAutoName = useMemo(() => {
        const names = selectedMergeNodes.map(node => node.name).filter(Boolean)
        if (names.length === 0) return ''
        if (names.length === 1) return `${names[0]}枢纽`
        const preview = names.slice(0, 2).join(' / ')
        return `${preview}${names.length > 2 ? ` 等 ${names.length} 站` : ''}枢纽`
    }, [selectedMergeNodes])
    const selectedJunctionGroup = useMemo(() => {
        if (!selectedNode?.isJunction || !selectedNode.junctionId) return null
        return junctionGroups.find(group => group.id === selectedNode.junctionId) ?? null
    }, [junctionGroups, selectedNode])
    const canDeleteSelectedJunction = !!(
        selectedJunctionGroup && !isRuntimeReadonlyGroup(selectedJunctionGroup)
    )

    const selectCutoffNode = useCallback((nodeId: string, nodeName?: string) => {
        setCutoffNodeId(nodeId)
        setCutoffEdgeId(null)
        setCutoffClosedEdgeIds([])
        setCutoffStoppedEdgeIds([])
        setCutoffResult(null)
        setStatusMsg(`截断点已选：${nodeName || nodeId}`)
    }, [])

    const selectCutoffEdge = useCallback((edge: TopoEdge) => {
        if (activeTabRef.current !== 'cutoff') {
            setStatusMsg(`已选中连线：${edge.name || edge.id}`)
            return
        }
        setCutoffNodeId(null)
        setCutoffEdgeId(edge.id)
        setCutoffClosedEdgeIds([])
        setCutoffStoppedEdgeIds([])
        setCutoffResult(null)
        setStatusMsg(`截断管段已选：${edge.name || edge.id}`)
    }, [])

    const buildClosedEdgeOverrides = useCallback((edgeIds: string[]) => {
        const idSet = new Set(edgeIds)
        const sourceIds = topoEdges
            .filter(edge => idSet.has(edge.id))
            .flatMap(edge => edge.sourceEdgeIds?.length ? edge.sourceEdgeIds : [edge.id])

        return [...new Set(sourceIds)].map(edgeId => ({
            edge_id: edgeId,
            flow_rate: 0,
            status: 'closed' as const,
        }))
    }, [topoEdges])

    const buildCollapsedGraph = useCallback((
        nodes: BaseTopoNode[],
        edges: BaseTopoEdge[],
        groups: JunctionGroup[]
    ) => {
        const stationToDisplayId = new Map<string, string>()
        const displayNodes: TopoNode[] = []

        groups.forEach(group => {
            const memberNodes = nodes.filter(node => group.station_ids.includes(node.id))
            if (memberNodes.length === 0) return

            const centerLng = memberNodes.reduce((sum, node) => sum + node.position[0], 0) / memberNodes.length
            const centerLat = memberNodes.reduce((sum, node) => sum + node.position[1], 0) / memberNodes.length
            const junctionNodeId = `junction-${group.id}`

            group.station_ids.forEach(stationId => stationToDisplayId.set(stationId, junctionNodeId))
            displayNodes.push({
                id: junctionNodeId,
                name: group.name,
                type: 'junction',
                position: [centerLng, centerLat],
                sourceNodeIds: [...group.station_ids],
                junctionId: group.id,
                isJunction: true,
                junctionKind: group.junction_kind,
                sourceTable: group.source_table,
            })
        })

        nodes.forEach(node => {
            if (stationToDisplayId.has(node.id)) return
            displayNodes.push({
                ...node,
                sourceNodeIds: [node.id],
                isJunction: false,
            })
        })

        const collapsedEdgeMap = new Map<string, TopoEdge>()
        edges.forEach(edge => {
            const startNodeId = stationToDisplayId.get(edge.startNodeId) ?? edge.startNodeId
            const endNodeId = stationToDisplayId.get(edge.endNodeId) ?? edge.endNodeId
            if (startNodeId === endNodeId) return

            const sorted = [startNodeId, endNodeId].sort()
            const key = `${sorted[0]}__${sorted[1]}`
            const existing = collapsedEdgeMap.get(key)
            if (existing) {
                existing.sourceEdgeIds = [...(existing.sourceEdgeIds ?? []), edge.id]
                return
            }

            collapsedEdgeMap.set(key, {
                id: `merged-${key}`,
                startNodeId,
                endNodeId,
                name: edge.name,
                sourceEdgeIds: [edge.id],
            })
        })

        return {
            nodes: displayNodes,
            edges: [...collapsedEdgeMap.values()],
        }
    }, [])

    const renderCollapsedGraph = useCallback((graphNodes: TopoNode[], graphEdges: TopoEdge[]) => {
        if (!mapInstance) return
        const AMap = (window as any).AMap
        if (!AMap) return

        try {
            clearRenderedTopology()

            const renderedNodes: TopoNode[] = graphNodes.map(node => {
                try {
                    const size = node.isJunction ? TOPO_SIZES.station + 4 : TOPO_SIZES[node.type]
                    const marker = new AMap.Marker({
                        position: new AMap.LngLat(node.position[0], node.position[1]),
                        content: createTopoMarkerContent(node.type, node.name, false, !!node.isJunction),
                        offset: new AMap.Pixel(-size / 2, -size / 2),
                        draggable: !node.isJunction,
                        cursor: node.isJunction ? 'pointer' : 'move',
                        zIndex: node.isJunction ? 260 : 200,
                    })
                    marker.setMap(mapInstance)

                    const nodeId = node.id
                    if (!node.isJunction) {
                        marker.on('dragend', (event: any) => {
                            const nextPosition: [number, number] = [event.lnglat.getLng(), event.lnglat.getLat()]
                            setBaseTopoNodes(prev => prev.map(item => item.id === nodeId ? { ...item, position: nextPosition } : item))
                            setDirtyPositions(prev => new Map(prev).set(nodeId, nextPosition))
                        })
                    }
                    marker.on('click', () => doNodeClick(nodeId))

                    return { ...node, marker }
                } catch (error) {
                    console.warn('[MapTopologyView] render node failed', node.id, error)
                    return node
                }
            })

            const renderedNodeMap = new Map(renderedNodes.map(node => [node.id, node]))
            const renderedEdges: TopoEdge[] = graphEdges.map(edge => {
                try {
                    const startNode = renderedNodeMap.get(edge.startNodeId)
                    const endNode = renderedNodeMap.get(edge.endNodeId)
                    if (!startNode || !endNode) return edge

                    const parallelCount = Math.max(1, edge.sourceEdgeIds?.length ?? 1)
                    const polylines = Array.from({ length: parallelCount }, (_, index) => {
                        const path = buildParallelEdgePath(startNode.position, endNode.position, index, parallelCount)
                        const polyline = new AMap.Polyline({
                            path,
                            strokeColor: parallelCount > 1 && index % 2 === 1 ? '#22d3ee' : LINE_COLOR,
                            strokeWeight: parallelCount > 1 ? LINE_WEIGHT + 1 : LINE_WEIGHT,
                            strokeStyle: 'solid',
                            zIndex: 100 + index,
                        })
                        polyline.setMap(mapInstance)
                        polyline.on('click', () => selectCutoffEdge(edge))
                        return polyline
                    })
                    return { ...edge, poly: parallelCount === 1 ? polylines[0] : polylines }
                } catch (error) {
                    console.warn('[MapTopologyView] render edge failed', edge.id, error)
                    return edge
                }
            })

            setTopoNodes(renderedNodes)
            setTopoEdges(renderedEdges)
        } catch (error) {
            console.warn('[MapTopologyView] renderCollapsedGraph failed', error)
        }
    }, [clearRenderedTopology, mapInstance, selectCutoffEdge])

    useEffect(() => {
        void loadJunctionGroups()
    }, [loadJunctionGroups])

    useEffect(() => {
        if (!mapInstance || baseTopoNodes.length === 0) return
        const collapsed = buildCollapsedGraph(baseTopoNodes, baseTopoEdges, junctionGroups)
        renderCollapsedGraph(collapsed.nodes, collapsed.edges)
    }, [baseTopoNodes, baseTopoEdges, buildCollapsedGraph, junctionGroups, mapInstance, renderCollapsedGraph])

    // ================== 地图点击 ==================
    useEffect(() => {
        if (!mapInstance) return
        const onClick = (e: any) => {
            if (modeRef.current === 'draw-point') doAddNode(e.lnglat, ptRef.current)
        }
        mapInstance.on('click', onClick)
        return () => {
            mapInstance.off('click', onClick)
            nodesRef.current.forEach(n => n.marker?.setMap(null))
            edgesRef.current.forEach(e => forEachEdgePolyline(e, polyline => polyline?.setMap(null)))
        }
    }, [mapInstance])

    useEffect(() => {
        if (!mapInstance) return
        mapInstance.setDefaultCursor(editMode === 'view' ? 'grab' : 'crosshair')
        if (editMode === 'draw-point') setStatusMsg(`绘制：点击地图添加「${TOPO_LABELS[pointType]}」`)
        else if (editMode === 'connect') { setStatusMsg('连线：点击起点节点'); setConnectFrom(null) }
        else setStatusMsg('浏览模式')
    }, [editMode, pointType, mapInstance])

    useEffect(() => {
        if (editMode !== 'merge') return
        setConnectFrom(null)
        setStatusMsg('手工捏合：点击底层站点加入/移除，再在左侧创建枢纽')
    }, [editMode])

    const paintMergeSelection = useCallback((selectedIds: Set<string>) => {
        for (const node of nodesRef.current) {
            if (!node.marker) continue
            const isSelected = !node.isJunction && selectedIds.has(node.id)
            node.marker.setContent(createTopoMarkerContent(node.type, node.name, isSelected, !!node.isJunction))
        }
    }, [])

    useEffect(() => {
        if (editMode !== 'merge') {
            if (selectedMergeNodeIds.length > 0) {
                setSelectedMergeNodeIds([])
            }
            if (mergeJunctionName) {
                setMergeJunctionName('')
            }
            if (mergeJunctionDescription) {
                setMergeJunctionDescription('')
            }
            paintMergeSelection(new Set())
            return
        }
        paintMergeSelection(selectedMergeNodeSet)
    }, [
        editMode,
        mergeJunctionDescription,
        mergeJunctionName,
        paintMergeSelection,
        selectedMergeNodeIds.length,
        selectedMergeNodeSet,
        topoNodes,
    ])

    // ================== 节点操作 ==================
    const doAddNode = (lnglat: any, type: PointType) => {
        const id = `tn-${Date.now()}`
        const nodeName = `${TOPO_LABELS[type]}-${baseTopoNodes.length + 1}`
        const pos: [number, number] = [lnglat.getLng(), lnglat.getLat()]
        const node: BaseTopoNode = { id, type, name: nodeName, position: pos }
        setBaseTopoNodes(prev => [...prev, node])
        setUndoStack(prev => [...prev, { type: 'add-node', nodeId: id }])
        setStatusMsg(`已添加: ${node.name}`)
    }

    /** 拖拽后同步关联管线 */
    const syncEdges = (_nodeId: string, _newPos: [number, number]) => {}

    const doNodeClick = (nodeId: string) => {
        if (modeRef.current === 'connect') {
            const from = cfRef.current
            if (!from) {
                setConnectFrom(nodeId)
                const nd = nodesRef.current.find(n => n.id === nodeId)
                setStatusMsg(`起点「${nd?.name}」→ 点击终点`)
            } else {
                if (nodeId === from) { setStatusMsg('不能连接自身'); return }
                void doAddEdge(from, nodeId)
                setConnectFrom(null)
            }
            return
        }

        const clickedNode = nodesRef.current.find(n => n.id === nodeId) || null

        if (modeRef.current === 'merge') {
            if (!clickedNode) return
            if (clickedNode.isJunction) {
                setStatusMsg('手工捏合请选底层站点，枢纽节点不能直接捏合')
                setSelectedNode(clickedNode)
                return
            }

            setSelectedNode(clickedNode)
            setSelectedMergeNodeIds(prev => {
                const next = prev.includes(nodeId)
                    ? prev.filter(id => id !== nodeId)
                    : [...prev, nodeId]
                setStatusMsg(`已选择 ${next.length} 个站点用于手工捏合`)
                return next
            })
            return
        }

        setSelectedNode(clickedNode)

        // 截断模式：点击节点设为截断点
        if (modeRef.current === 'view' && activeTab === 'cutoff') {
            const nd = clickedNode
            if (!nd) return
            selectCutoffNode(nodeId, nd.name)
            return
        }

        if (clickedNode?.isJunction) {
            setStatusMsg(`已选中枢纽：${clickedNode.name}`)
        } else if (clickedNode) {
            setStatusMsg(`已选中节点：${clickedNode.name}`)
        }
    }

    const resolvePersistStationId = (nodeId: string): string | null => {
        const node = nodesRef.current.find(item => item.id === nodeId)
        if (!node || node.isJunction) return null
        if (node.id.startsWith('tn-')) return null
        const source = node.sourceNodeIds?.[0] || node.id
        if (!source || source.startsWith('tn-') || source.startsWith('junction-')) return null
        return source
    }

    const doAddEdge = async (startId: string, endId: string) => {
        const s = baseTopoNodes.find(n => n.id === startId)
        const e = baseTopoNodes.find(n => n.id === endId)
        if (!s || !e) return

        const startStationId = resolvePersistStationId(startId)
        const endStationId = resolvePersistStationId(endId)

        if (!startStationId || !endStationId) {
            const id = `te-${Date.now()}`
            setBaseTopoEdges(prev => [...prev, {
                id,
                startNodeId: startId,
                endNodeId: endId,
                name: '新建临时连线',
                persisted: false,
            }])
            setUndoStack(prev => [...prev, { type: 'add-edge', edgeId: id }])
            setStatusMsg('连线已添加（临时），当前节点不在数据库主站点中，无法持久化保存。')
            return
        }

        try {
            const created = await topologyEditorApi.createConnection({
                start_station_id: startStationId,
                end_station_id: endStationId,
                name: `${s.name} → ${e.name}`,
                category: 'branch',
            })
            setBaseTopoEdges(prev => [...prev, {
                id: created.id,
                startNodeId: startId,
                endNodeId: endId,
                name: created.name || `${s.name} → ${e.name}`,
                persisted: true,
            }])
            setUndoStack(prev => [...prev, { type: 'add-edge', edgeId: created.id }])
            invalidatePipelineCache()
            setStatusMsg('连线已保存到数据库，刷新后仍可见。')
        } catch (error) {
            console.error(error)
            setStatusMsg(error instanceof Error ? `连线保存失败：${error.message}` : '连线保存失败')
        }
    }

    // ================== 导入：将 ALL_PIPELINES 数据转为纯拓扑点+线（阀室链路合并） ==================

    // ================== 撤销操作 ==================
    const doUndo = useCallback(async () => {
        const stack = [...undoStack]
        const action = stack.pop()
        if (!action) { setStatusMsg('无可撤销的操作'); return }
        setUndoStack(stack)

        if (action.type === 'add-edge') {
            const target = baseTopoEdges.find(e => e.id === action.edgeId)
            if (target?.persisted) {
                try {
                    await topologyEditorApi.deleteConnection(action.edgeId)
                    invalidatePipelineCache()
                } catch (error) {
                    console.error(error)
                    setStatusMsg(error instanceof Error ? `撤销连线失败：${error.message}` : '撤销连线失败')
                    return
                }
            }
            setBaseTopoEdges(prev => prev.filter(e => e.id !== action.edgeId))
            setStatusMsg(target?.persisted ? '已撤销并删除已保存连线' : '已撤销: 删除临时连线')
        } else if (action.type === 'add-node') {
            const node = baseTopoNodes.find(n => n.id === action.nodeId)
            setBaseTopoEdges(prev => prev.filter(e => e.startNodeId !== action.nodeId && e.endNodeId !== action.nodeId))
            setBaseTopoNodes(prev => prev.filter(n => n.id !== action.nodeId))
            setSelectedMergeNodeIds(prev => prev.filter(id => id !== action.nodeId))
            setStatusMsg(`已撤销: 删除 ${node?.name || '节点'}`)
        } else if (action.type === 'create-junction') {
            try {
                await topologyEditorApi.deleteJunctionGroup(action.junctionId)
                invalidatePipelineCache()
                await loadJunctionGroups()
                setSelectedNode(null)
                setStatusMsg(`已撤销: 拆分枢纽「${action.name}」`)
            } catch (error) {
                console.error(error)
                setStatusMsg(error instanceof Error ? `撤销枢纽创建失败：${error.message}` : '撤销枢纽创建失败')
            }
        } else if (action.type === 'delete-junction') {
            try {
                await topologyEditorApi.createJunctionGroup({
                    name: action.group.name,
                    station_ids: action.group.station_ids,
                    description: action.group.description ?? undefined,
                })
                invalidatePipelineCache()
                await loadJunctionGroups()
                setStatusMsg(`已撤销: 恢复枢纽「${action.group.name}」`)
            } catch (error) {
                console.error(error)
                setStatusMsg(error instanceof Error ? `撤销枢纽拆分失败：${error.message}` : '撤销枢纽拆分失败')
            }
        }
    }, [baseTopoEdges, baseTopoNodes, loadJunctionGroups, undoStack])

    // Ctrl+Z 快捷键
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault()
                void doUndo()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [doUndo])
    const importTopology = useCallback((silent = false) => {
        try {
            if (!mapInstance) return
            const { nodes: srcN, lines: srcL } = rawPipelineData
            if (srcN.length === 0) {
                if (!silent) setStatusMsg('无可导入的管线数据')
                return
            }

            clearRenderedTopology()
            setTopoNodes([])
            setTopoEdges([])
            setSelectedNode(null)

            // ------- 阀室链路合并算法 -------
            // 1. 归类：哪些是阀室、哪些是站场
            const nodeTypeMap = new Map<string, PointType>()
            const valveIds = new Set<string>()
            for (const sn of srcN) {
                const mt: PointType = TYPE_MAP[sn.type] || 'station'
                nodeTypeMap.set(sn.id, mt)
                if (mt === 'valve') valveIds.add(sn.id)
            }

            // 2. 构建全量邻接表（包含阀室）
            const adj = new Map<string, Set<string>>()
            for (const sn of srcN) {
                adj.set(sn.id, new Set())
            }
            for (const sl of srcL) {
                if (adj.has(sl.startNodeId) && adj.has(sl.endNodeId)) {
                    adj.get(sl.startNodeId)!.add(sl.endNodeId)
                    adj.get(sl.endNodeId)!.add(sl.startNodeId)
                }
            }

            // 3. BFS：从每个非阀室节点出发，穿越阀室链，找到所有可达的非阀室邻居
            //    A → V1 → V2 → B  合并为  A → B
            const collapsedEdges = new Set<string>()  // "minId_maxId" 去重
            const edgePairs: Array<[string, string]> = []

            for (const sn of srcN) {
                if (valveIds.has(sn.id)) continue  // 起点必须是非阀室

                const queue = [...(adj.get(sn.id) || [])]
                const visited = new Set<string>([sn.id])

                while (queue.length > 0) {
                    const curr = queue.shift()!
                    if (visited.has(curr)) continue
                    visited.add(curr)

                    if (valveIds.has(curr)) {
                        // 当前是阀室 → 继续穿越
                        for (const next of adj.get(curr) || []) {
                            if (!visited.has(next)) queue.push(next)
                        }
                    } else {
                        // 找到了另一个非阀室节点 → 生成合并边
                        const ids = [sn.id, curr].sort()
                        const key = `${ids[0]}_${ids[1]}`
                        if (!collapsedEdges.has(key)) {
                            collapsedEdges.add(key)
                            edgePairs.push([sn.id, curr])
                        }
                    }
                }
            }

            // 4. 构造非阀室基础节点
            const imported: BaseTopoNode[] = []
            for (const sn of srcN) {
                if (valveIds.has(sn.id)) continue

                const pos: [number, number] = [sn.coordinate.longitude, sn.coordinate.latitude]
                const type = nodeTypeMap.get(sn.id) || 'station'
                imported.push({ id: sn.id, type, name: sn.name, position: pos })
            }

            // 5. 构造基础连线
            const importedEdges: BaseTopoEdge[] = []
            const importedMap = new Map(imported.map(node => [node.id, node]))

            for (const [startId, endId] of edgePairs) {
                const sNode = importedMap.get(startId)
                const eNode = importedMap.get(endId)
                if (!sNode || !eNode) continue
                const edgeId = `ce-${startId.slice(-4)}-${endId.slice(-4)}`
                importedEdges.push({
                    id: edgeId,
                    startNodeId: startId,
                    endNodeId: endId,
                    name: `${sNode.name} → ${eNode.name}`,
                    persisted: true,
                })
            }

            setBaseTopoNodes(imported)
            setBaseTopoEdges(importedEdges)
            setDirtyPositions(new Map())
            setPositionPreview(null)

            if (!silent) {
                setStatusMsg(`已导入 ${imported.length} 节点, ${importedEdges.length} 条连线（阀室链路已合并）`)
            }
        } catch (error) {
            console.warn('[MapTopologyView] importTopology failed', error)
            if (!silent) {
                setStatusMsg(error instanceof Error ? `拓扑导入失败：${error.message}` : '拓扑导入失败')
            }
        }
    }, [clearRenderedTopology, mapInstance, rawPipelineData])

    useEffect(() => {
        if (!mapInstance || rawPipelineData.nodes.length === 0 || importedOnceRef.current) return
        importedOnceRef.current = true
        importTopology(true)
    }, [importTopology, mapInstance, rawPipelineData.nodes.length])

    useEffect(() => {
        if (!selectedNode) return
        const nextSelected = topoNodes.find(node => node.id === selectedNode.id) || null
        setSelectedNode(nextSelected)
    }, [selectedNode?.id, topoNodes])

    useEffect(() => {
        if (!selectedNode) return
        const sourceNodeIds = selectedNode.sourceNodeIds?.length ? selectedNode.sourceNodeIds : [selectedNode.id]
        const connectedEdges = topoEdges
            .filter(edge => edge.startNodeId === selectedNode.id || edge.endNodeId === selectedNode.id)
            .map(edge => ({
                id: edge.id,
                name: edge.name,
                startNodeId: edge.startNodeId,
                endNodeId: edge.endNodeId,
                sourceEdgeIds: edge.sourceEdgeIds || [],
                defaultLengthKm: edge.defaultLengthKm,
            }))
        const simulationNodes = sim.overlay?.nodes
            ?.filter(node => sourceNodeIds.includes(node.id))
            .map(node => ({
                id: node.id,
                pressure_mpa: node.pressure_mpa,
                pressure_in_mpa: node.pressure_in_mpa,
                alert_level: node.alert_level,
            })) || []

        setAssistantRuntimeContext({
            selection: {
                selectedTopologyNode: {
                    id: selectedNode.id,
                    name: selectedNode.name,
                    type: selectedNode.type,
                    isJunction: !!selectedNode.isJunction,
                    sourceNodeIds,
                },
                selectedTopologyConnectedEdges: connectedEdges,
                selectedSimulationNodes: simulationNodes,
            },
        })
    }, [selectedNode, topoEdges, sim.overlay])

    const flyTo = useCallback((node: TopoNode) => {
        if (!mapInstance) return
        mapInstance.setZoomAndCenter(10, node.position, true, 500)
        setStatusMsg(`已定位: ${node.name}`)
    }, [mapInstance])

    useEffect(() => {
        const params = new URLSearchParams(location.search)
        const focusNodeId = params.get('focusNode')
        if (!focusNodeId || topoNodes.length === 0) return
        if (appliedFocusNodeRef.current === focusNodeId) return

        const targetNode = resolveFocusTarget(topoNodes, focusNodeId)
        if (!targetNode) return

        appliedFocusNodeRef.current = focusNodeId
        flyTo(targetNode)
        setSelectedNode(targetNode)
        setStatusMsg(`已从地图联动定位到拓扑节点：${targetNode.name}`)
    }, [flyTo, location.search, topoNodes])

    // ================== 截断仿真 ==================
    const runCutoffSimulation = useCallback(() => {
        if ((!cutoffNodeId && !cutoffEdgeId) || topoNodes.length === 0) return
        const gn = topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))
        const ge = topoEdges.map(e => ({ id: e.id, startNodeId: e.startNodeId, endNodeId: e.endNodeId }))
        const result = cutoffEdgeId
            ? simulateEdgeCutoff(gn, ge, cutoffEdgeId)
            : simulateCutoff(gn, ge, cutoffNodeId!)
        setCutoffResult(result)
        setCutoffClosedEdgeIds(result.cutoffEdgeIds)
        setCutoffStoppedEdgeIds(result.stoppedEdgeIds)

        // ---- 地图高亮渲染 ----
        // 先恢复所有已高亮节点
        for (const [nid, origContent] of highlightedMarkersRef.current) {
            const nd = nodesRef.current.find(n => n.id === nid)
            nd?.marker?.setContent(origContent)
        }
        highlightedMarkersRef.current.clear()

        // 截断节点：大红圆
        const cutNode = cutoffNodeId ? nodesRef.current.find(n => n.id === cutoffNodeId) : null
        if (cutoffNodeId && cutNode?.marker) {
            const orig = cutNode.marker.getContent()
            highlightedMarkersRef.current.set(cutoffNodeId, orig)
            cutNode.marker.setContent(
                `<div style="position: relative; display: flex; flex-direction: column; align-items: center; pointer-events: none;">
                    <div style="width:18px;height:18px;border-radius:50%;background:#ef4444;border:2px solid #fff;box-shadow:0 0 10px #ef4444; pointer-events: auto;"></div>
                    <div style="position: absolute; top: 22px; white-space: nowrap; font-size: 11px; color: #ef4444; font-weight: bold; text-shadow: 0 0 2px #fff, 0 0 2px #fff; z-index: 10;">${cutNode.name}</div>
                </div>`
            )
        }

        // 断供节点：深红
        for (const aNode of result.affectedNodes) {
            const nd = nodesRef.current.find(n => n.id === aNode.id)
            if (!nd?.marker) continue
            const orig = nd.marker.getContent()
            if (!highlightedMarkersRef.current.has(aNode.id)) {
                highlightedMarkersRef.current.set(aNode.id, orig)
            }
            const color = aNode.status === 'supply_lost' ? '#991b1b' : '#f97316'
            const size = aNode.status === 'supply_lost' ? 12 : 10
            nd.marker.setContent(
                `<div style="position: relative; display: flex; flex-direction: column; align-items: center; pointer-events: none;">
                    <div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:1.5px solid #fff; pointer-events: auto;"></div>
                    <div style="position: absolute; top: ${size + 4}px; white-space: nowrap; font-size: 11px; color: ${color}; font-weight: bold; text-shadow: 0 0 2px #fff, 0 0 2px #fff; z-index: 10;">${nd.name}</div>
                </div>`
            )
        }

        const lostCount = result.summary.supplyLost
        const closedEdgeOverrides = buildClosedEdgeOverrides(result.cutoffEdgeIds)
        if (closedEdgeOverrides.length > 0) {
            void sim.runSimulation({
                scenarioId: sim.currentScenario || 'steady_base',
                initialInput: { edge_overrides: closedEdgeOverrides },
            })
        }
        setStatusMsg(`仿真完成：${lostCount} 个断供，${result.summary.rerouted} 个绕行，${result.stoppedEdgeIds.length} 条管段停流`)
    }, [buildClosedEdgeOverrides, cutoffEdgeId, cutoffNodeId, sim, topoNodes, topoEdges])

    /** 清除截断仿真高亮，恢复原始样式 */
    const clearCutoffHighlight = useCallback(() => {
        for (const [nid, origContent] of highlightedMarkersRef.current) {
            const nd = nodesRef.current.find(n => n.id === nid)
            nd?.marker?.setContent(origContent)
        }
        highlightedMarkersRef.current.clear()
        setCutoffNodeId(null)
        setCutoffEdgeId(null)
        setCutoffClosedEdgeIds([])
        setCutoffStoppedEdgeIds([])
        setCutoffResult(null)
        setStatusMsg('截断仿真已清除')
    }, [])

    // ================== 验证 ==================
    const runValidation = useCallback(() => {
        const gn = topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))
        const ge = topoEdges.map(e => ({ id: e.id, startNodeId: e.startNodeId, endNodeId: e.endNodeId, name: e.name }))
        const r = validateTopology(gn, ge)
        setReport(r)
        setStatusMsg(`验证完成: ${r.issues.length} 条告警`)
        setActiveTab('validate')
    }, [topoNodes, topoEdges])

    // ================== 介数中心性 ==================
    const runCentrality = useCallback(() => {
        const gn = topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))
        const ge = topoEdges.map(e => ({ id: e.id, startNodeId: e.startNodeId, endNodeId: e.endNodeId }))
        const c = computeBetweennessCentrality(gn, ge)
        const top = [...c.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([id, val]) => ({ id, name: topoNodes.find(n => n.id === id)?.name || id, value: Math.round(val * 100) }))
        setCentralityData(top)
        setStatusMsg(`介数中心性 Top ${top.length}`)
        setActiveTab('centrality')
    }, [topoNodes, topoEdges])

    // ================== 搜索 ==================
    const searchResults = useMemo(() => {
        if (!searchText.trim()) return []
        const kw = searchText.trim().toLowerCase()
        return topoNodes.filter(n => n.name.toLowerCase().includes(kw))
    }, [searchText, topoNodes])

    // ================== 导出 ==================
    const exportJSON = () => {
        const obj = {
            nodes: topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type, lng: n.position[0], lat: n.position[1] })),
            edges: topoEdges.map(e => ({ id: e.id, from: e.startNodeId, to: e.endNodeId, name: e.name })),
        }
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `topology_${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
        setStatusMsg(`已导出 ${topoNodes.length} 节点`)
    }

    const clearAll = () => {
        clearRenderedTopology()
        setBaseTopoNodes([])
        setBaseTopoEdges([])
        setTopoNodes([])
        setTopoEdges([])
        setDirtyPositions(new Map())
        setPositionPreview(null)
        setReport(null)
        setCentralityData([])
        setSelectedNode(null)
        setSelectedMergeNodeIds([])
        setCutoffNodeId(null)
        setCutoffEdgeId(null)
        setCutoffClosedEdgeIds([])
        setCutoffStoppedEdgeIds([])
        setCutoffResult(null)
        setStatusMsg('已清空')
    }

    const handleCreateManualJunction = useCallback(async () => {
        if (!manualJunctionEditingEnabled) {
            setStatusMsg('当前环境未开放手工捏合写入')
            return
        }
        if (selectedMergeNodeIds.length < 2 || isMerging) return

        const name = mergeJunctionName.trim() || selectedMergeAutoName
        if (!name) {
            setStatusMsg('请先选择至少两个站点，再创建捏合枢纽')
            return
        }

        setIsMerging(true)
        try {
            const result = await topologyEditorApi.createJunctionGroup({
                name,
                description: mergeJunctionDescription.trim() || undefined,
                station_ids: selectedMergeNodeIds,
            })
            invalidatePipelineCache()
            await loadJunctionGroups()
            setUndoStack(prev => [...prev, { type: 'create-junction', junctionId: result.id, name }])
            setEditMode('view')
            setSelectedMergeNodeIds([])
            setMergeJunctionName('')
            setMergeJunctionDescription('')
            setStatusMsg(`已创建手工捏合枢纽：${name}`)
        } catch (error) {
            console.error(error)
            setStatusMsg(error instanceof Error ? `创建手工捏合失败：${error.message}` : '创建手工捏合失败')
        } finally {
            setIsMerging(false)
        }
    }, [
        isMerging,
        loadJunctionGroups,
        manualJunctionEditingEnabled,
        mergeJunctionDescription,
        mergeJunctionName,
        selectedMergeAutoName,
        selectedMergeNodeIds,
    ])

    const handleDeleteManualJunction = useCallback(async (group: JunctionGroup) => {
        if (isRuntimeReadonlyGroup(group) || deletingJunctionId === group.id) {
            return
        }

        setDeletingJunctionId(group.id)
        try {
            await topologyEditorApi.deleteJunctionGroup(group.id)
            invalidatePipelineCache()
            await loadJunctionGroups()
            setUndoStack(prev => [...prev, { type: 'delete-junction', group }])
            setSelectedNode(current => (
                current?.junctionId === group.id ? null : current
            ))
            setStatusMsg(`已拆分手工捏合枢纽：${group.name}`)
        } catch (error) {
            console.error(error)
            setStatusMsg(error instanceof Error ? `拆分手工捏合失败：${error.message}` : '拆分手工捏合失败')
        } finally {
            setDeletingJunctionId(null)
        }
    }, [deletingJunctionId, isRuntimeReadonlyGroup, loadJunctionGroups])

    const handleSavePositions = useCallback(async () => {
        if (dirtyPositions.size === 0 || isSaving) return
        setIsSaving(true)
        try {
            const updates = [...dirtyPositions.entries()].map(([id, position]) => ({
                id,
                longitude: position[0],
                latitude: position[1],
            }))
            const data = await topologyEditorApi.commitPositions({
                updates,
                cascade_valves: cascadeValves,
                cascade_scope: 'segment',
            })
            invalidatePipelineCache()
            const packages = await loadAllPipelines()
            setPipelines(packages)
            setDirtyPositions(new Map())
            setPositionPreview(null)
            setStatusMsg(
                `已保存 ${data.updated_station_ids?.length ?? 0} 个主点，联动 ${data.updated_valve_ids?.length ?? 0} 个阀室`
            )
        } catch (error) {
            console.error(error)
            setStatusMsg(error instanceof Error ? `保存点位失败：${error.message}` : '保存点位失败')
        } finally {
            setIsSaving(false)
        }
    }, [cascadeValves, dirtyPositions, isSaving])

    const handlePreviewPositions = useCallback(async () => {
        if (dirtyPositions.size === 0 || isPreviewing || isSaving) return
        setIsPreviewing(true)
        try {
            const updates = [...dirtyPositions.entries()].map(([id, position]) => ({
                id,
                longitude: position[0],
                latitude: position[1],
            }))
            const data = await topologyEditorApi.previewPositions({
                updates,
                cascade_valves: cascadeValves,
                cascade_scope: 'segment',
            })
            setPositionPreview(data)
            setStatusMsg(
                `预览完成：将影响 ${data.updated_station_ids?.length ?? 0} 个主点、${data.updated_valve_ids?.length ?? 0} 个阀室`
            )
        } catch (error) {
            console.error(error)
            setStatusMsg(error instanceof Error ? `预览影响失败：${error.message}` : '预览影响失败')
        } finally {
            setIsPreviewing(false)
        }
    }, [cascadeValves, dirtyPositions, isPreviewing, isSaving])

    // ================== 实时统计 ==================
    const createManualJunction = useCallback(async () => {
        if (!manualJunctionEditingEnabled) {
            setStatusMsg('当前后端处于只读模式，不能创建手工捏合')
            return
        }
        if (selectedMergeNodeIds.length < 2) {
            setStatusMsg('至少选择 2 个底层站点才能创建手工捏合')
            return
        }
        if (isMerging) return

        const fallbackName = `手工枢纽-${new Date().toISOString().slice(0, 10)}`
        const payloadName = mergeJunctionName.trim() || fallbackName

        setIsMerging(true)
        try {
            const result = await topologyEditorApi.createJunctionGroup({
                name: payloadName,
                description: mergeJunctionDescription.trim() || undefined,
                station_ids: selectedMergeNodeIds,
            })
            setUndoStack(prev => [...prev, { type: 'create-junction', junctionId: result.id, name: payloadName }])
            setSelectedMergeNodeIds([])
            setMergeJunctionName('')
            setMergeJunctionDescription('')
            invalidatePipelineCache()
            await loadJunctionGroups()
            setStatusMsg(`手工捏合已创建：${payloadName}`)
        } catch (error) {
            console.error(error)
            setStatusMsg(error instanceof Error ? `创建手工捏合失败：${error.message}` : '创建手工捏合失败')
        } finally {
            setIsMerging(false)
        }
    }, [
        isMerging,
        loadJunctionGroups,
        manualJunctionEditingEnabled,
        mergeJunctionDescription,
        mergeJunctionName,
        selectedMergeNodeIds,
    ])

    const removeManualJunction = useCallback(async (group: JunctionGroup) => {
        if (!manualJunctionEditingEnabled) {
            setStatusMsg('当前后端处于只读模式，不能删除手工捏合')
            return
        }
        if (isRuntimeReadonlyGroup(group)) {
            setStatusMsg('这是运行时重编枢纽，不能在这里删除')
            return
        }
        if (deletingJunctionId === group.id) return

        setDeletingJunctionId(group.id)
        try {
            await topologyEditorApi.deleteJunctionGroup(group.id)
            setUndoStack(prev => [...prev, { type: 'delete-junction', group }])
            invalidatePipelineCache()
            await loadJunctionGroups()
            if (selectedNode?.junctionId === group.id) {
                setSelectedNode(null)
            }
            setStatusMsg(`已拆分手工捏合：${group.name}`)
        } catch (error) {
            console.error(error)
            setStatusMsg(error instanceof Error ? `拆分手工捏合失败：${error.message}` : '拆分手工捏合失败')
        } finally {
            setDeletingJunctionId(null)
        }
    }, [
        deletingJunctionId,
        isRuntimeReadonlyGroup,
        loadJunctionGroups,
        manualJunctionEditingEnabled,
        selectedNode?.junctionId,
    ])

    const stats = useMemo(() => ({
        nodes: topoNodes.length,
        edges: topoEdges.length,
        isolated: topoNodes.length > 0
            ? findIsolatedNodes(
                topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type })),
                topoEdges.map(e => ({ id: e.id, startNodeId: e.startNodeId, endNodeId: e.endNodeId }))
            ).length
            : 0,
    }), [topoNodes, topoEdges])

    // ================== 仿真覆盖层映射 ==================
    const overlayMapping = useMemo(() => {
        if (!sim.overlay || topoNodes.length === 0) return null
        const displayNodes = topoNodes.map(n => ({
            id: n.id,
            name: n.name,
            sourceNodeIds: n.sourceNodeIds,
        }))
        const displayEdges = topoEdges.map(e => ({
            id: e.id,
            name: e.name,
            sourceEdgeIds: e.sourceEdgeIds,
        }))
        return buildSimulationOverlayMapping(displayNodes, displayEdges, sim.overlay)
    }, [sim.overlay, topoNodes, topoEdges])

    useEffect(() => {
        if (!sim.overlay) {
            setLineFlowPhase(0)
            setDamageFlashVisible(false)
            return
        }

        const isFailureScenario = /offline|break/.test(sim.currentScenario)
        const flowTimer = window.setInterval(() => {
            setLineFlowPhase(prev => (prev + 1) % 6)
        }, 240)

        let flashTimer: number | null = null
        if (isFailureScenario) {
            setDamageFlashVisible(true)
            flashTimer = window.setTimeout(() => {
                setDamageFlashVisible(false)
            }, 900)
        } else {
            setDamageFlashVisible(false)
        }

        return () => {
            window.clearInterval(flowTimer)
            if (flashTimer != null) {
                window.clearTimeout(flashTimer)
            }
        }
    }, [sim.overlay, sim.currentScenario])

    // 仿真覆盖层渲染到地图标记上
    useEffect(() => {
        if (!overlayMapping || topoNodes.length === 0) return
        for (const node of topoNodes) {
            try {
                const match = overlayMapping.nodeMatchesByDisplayId.get(node.id)
                if (!match || !node.marker || match.matchedNodes.length === 0) continue
                const pressureOut = match.averagePressureMpa
                const pressureIn = match.averagePressureInMpa
                const alert = match.highestAlertLevel
                if (pressureOut == null) continue

                // Animation logic
                let displayPressure = pressureOut
                let displayDeltaHtml = ''
                const isAnimating = sim.animatingState?.active
                const prevOverlay = sim.animatingState?.prevOverlay
                if (isAnimating && prevOverlay) {
                    const prevNode = prevOverlay.nodes.find(n => match.matchedNodes.some(mn => mn.id === n.id))
                    if (prevNode) {
                        const pPrev = prevNode.pressure_mpa
                        const ratio = sim.animatingState.iteration / sim.animatingState.total
                        displayPressure = pPrev + (pressureOut - pPrev) * ratio

                        const diffTime = pressureOut - pPrev
                        if (Math.abs(diffTime) > 0.05) {
                            const sign = diffTime > 0 ? '+' : ''
                            const colorClass = diffTime > 0 ? '#4ade80' : '#f87171'
                            const translateY = -20 * ratio
                            const opacity = ratio < 0.8 ? 1 : (1 - ratio) * 5
                            displayDeltaHtml = `<div style="position:absolute;bottom:calc(100% + 5px);font-weight:bold;color:${colorClass};font-size:13px;text-shadow:0 0 4px rgba(0,0,0,0.8); transform: translateY(${translateY}px); opacity: ${opacity}; white-space:nowrap; z-index:20;">${sign}${diffTime.toFixed(2)}</div>`
                        }
                    }
                }

                const color = alert === 'critical' ? '#ef4444' : alert === 'warning' ? '#f97316' : TOPO_COLORS[node.type]
                const size = node.isJunction ? TOPO_SIZES.station + 4 : TOPO_SIZES[node.type]
                const flashGlow = damageFlashVisible && (alert === 'critical' || alert === 'warning')

                const isCompressor = node.name.includes('压气')
                const showInOut = pressureIn != null && (isCompressor || Math.abs(pressureIn - pressureOut) > 0.01)
                const labelHtml = showInOut
                    ? `${node.name} <span style="color:#94a3b8;margin-right:2px;">进${pressureIn.toFixed(2)}</span><span style="color:#475569;margin-right:2px;">|</span><span style="color:#38bdf8;font-weight:600;">出${displayPressure.toFixed(2)}</span> <span style="color:#cbd5e1;font-size:9px;">MPa</span>`
                    : `<span style="font-weight:500;">${node.name}</span> <span style="color:#38bdf8;font-weight:600;">${displayPressure.toFixed(2)}</span> <span style="color:#cbd5e1;font-size:9px;">MPa</span>`

                const baseShapeCss = `width:${size}px;height:${size}px;background:radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9) 0%, ${color} 40%, rgba(0,0,0,0.6) 100%);border:1px solid rgba(255,255,255,0.6);box-shadow:${flashGlow ? `0 0 18px rgba(248,113,113,0.85), 0 0 36px rgba(248,113,113,0.35),` : ''}0 4px 8px rgba(0,0,0,0.5), inset 0 -2px 4px rgba(0,0,0,0.4), 0 0 10px ${color};pointer-events:auto;transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1);`

                const shapeStyle = node.isJunction
                    ? `${baseShapeCss}transform:rotate(45deg);border-radius:4px;`
                    : `${baseShapeCss}border-radius:50%;`

                const labelContainerStyle = `position:absolute;top:${size + 8}px;white-space:nowrap;font-size:11px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.8);z-index:10;background:linear-gradient(135deg, rgba(15,23,42,0.85) 0%, rgba(30,41,59,0.9) 100%);padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);box-shadow:${flashGlow ? '0 0 12px rgba(248,113,113,0.5),' : ''}0 4px 12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1);backdrop-filter:blur(4px);transition:all 0.3s ease;`

                node.marker.setContent(`
                    <div style="position:relative;display:flex;flex-direction:column;align-items:center;pointer-events:none;">
                        ${displayDeltaHtml}
                        <div style="${shapeStyle}"></div>
                        <div style="${labelContainerStyle}">${flashGlow ? '<span style="color:#fca5a5;font-size:9px;margin-right:4px;">故障演示</span>' : ''}${labelHtml}</div>
                    </div>
                `)
            } catch (error) {
                console.warn('[MapTopologyView] update node label failed', node.id, error)
            }
        }
    }, [overlayMapping, topoNodes, sim.animatingState, lineFlowPhase, damageFlashVisible, sim.currentScenario])

    const cutoffClosedEdgeSet = useMemo(() => new Set(cutoffClosedEdgeIds), [cutoffClosedEdgeIds])
    const cutoffStoppedEdgeSet = useMemo(() => new Set(cutoffStoppedEdgeIds), [cutoffStoppedEdgeIds])

    // 仿真管段利用率着色 + 前端截断停流
    useEffect(() => {
        if (topoEdges.length === 0) return
        for (const edge of topoEdges) {
            try {
                const isCutoffClosed = cutoffClosedEdgeSet.has(edge.id)
                const isStoppedByCutoff = cutoffStoppedEdgeSet.has(edge.id)
                if (isCutoffClosed || isStoppedByCutoff) {
                    forEachEdgePolyline(edge, polyline => {
                        polyline?.setOptions({
                            strokeColor: isCutoffClosed ? '#ef4444' : '#475569',
                            strokeWeight: isCutoffClosed ? LINE_WEIGHT + 3 : LINE_WEIGHT + 1,
                            strokeOpacity: isCutoffClosed ? 0.95 : 0.38,
                            strokeStyle: 'dashed',
                            strokeDasharray: isCutoffClosed ? [10, 8] : [4, 8],
                            zIndex: isCutoffClosed ? 170 : 104,
                        })
                    })
                    continue
                }

                const match = overlayMapping?.edgeMatchesByDisplayId.get(edge.id)
                if (!match || match.matchedEdges.length === 0) {
                    forEachEdgePolyline(edge, polyline => {
                        polyline?.setOptions({
                            strokeColor: LINE_COLOR,
                            strokeWeight: LINE_WEIGHT,
                            strokeOpacity: 0.98,
                            strokeStyle: 'solid',
                            strokeDasharray: undefined,
                            zIndex: 100,
                        })
                    })
                    continue
                }

                const util = match.averageUtilization ?? 0
                const color = util < 0.7 ? '#22c55e' : util < 0.85 ? '#eab308' : util < 0.95 ? '#f97316' : '#ef4444'
                const weight = Math.max(2, Math.min(6, 2 + util * 4))
                const dashArray = lineFlowPhase % 2 === 0 ? [14, 8] : [8, 14]
                forEachEdgePolyline(edge, polyline => {
                    polyline?.setOptions({
                        strokeColor: damageFlashVisible && util >= 0.95 ? '#f43f5e' : color,
                        strokeWeight: damageFlashVisible && util >= 0.95 ? weight + 1 : weight,
                        strokeDasharray: util > 0 ? dashArray : [4, 8],
                    })
                })
            } catch (error) {
                console.warn('[MapTopologyView] update edge style failed', edge.id, error)
            }
        }
    }, [cutoffClosedEdgeSet, cutoffStoppedEdgeSet, overlayMapping, topoEdges, lineFlowPhase, damageFlashVisible])

    // 仿真状态同步到展示页 & AI 助手上下文
    useEffect(() => {
        if (!sim.overlay) return
        writeSimulationShowcaseSyncContext({
            source: 'map-topology',
            pilotId: PILOT_ID,
            scenarioId: sim.currentScenario,
            selectedSnapshotRunId: sim.selectedSnapshotRunId,
            baselineSnapshotRunId: sim.baselineSnapshotRunId,
            overlay: sim.overlay,
            updatedAt: new Date().toISOString(),
        })
        setAssistantRuntimeContext({
            selection: {
                simulationScenario: sim.currentScenario,
                simulationRunId: sim.overlay.run_id,
                selectedSnapshotRunId: sim.selectedSnapshotRunId,
                baselineSnapshotRunId: sim.baselineSnapshotRunId,
                solverStatus: sim.overlay.solver_status,
                simulationSummary: sim.overlay.summary,
                alertCount: sim.overlay.summary.alert_count,
            },
        })
    }, [sim.overlay, sim.currentScenario, sim.selectedSnapshotRunId, sim.baselineSnapshotRunId])

    useEffect(() => {
        if (sim.error) {
            pressurePopupPendingRef.current = false
            return
        }
        if (!pressurePopupPendingRef.current || !sim.overlay) return
        if (sim.isLoading || sim.animatingState?.active) return
        if (lastPressurePopupRunIdRef.current === sim.overlay.run_id) return

        pressurePopupPendingRef.current = false
        lastPressurePopupRunIdRef.current = sim.overlay.run_id
        setPressurePopupOverlay(sim.overlay)
        setPressurePopupVisible(true)
    }, [sim.animatingState, sim.error, sim.isLoading, sim.overlay])

    // 带参数运行仿真
    const handleRunSimulation = useCallback(() => {
        const initialInput: SimulationInitialInput = {}
        const nodeOvr = Object.entries(nodeOverrides)
            .filter(([, v]) => (v as { target_pressure_mpa?: number }).target_pressure_mpa != null)
            .map(([nodeId, v]) => ({ node_id: nodeId, target_pressure_mpa: (v as { target_pressure_mpa?: number }).target_pressure_mpa }))
        if (nodeOvr.length > 0) initialInput.node_overrides = nodeOvr
        if (globalDefaults.default_pressure_mpa != null) initialInput.default_pressure_mpa = globalDefaults.default_pressure_mpa
        if (globalDefaults.default_flow_rate != null) initialInput.default_flow_rate = globalDefaults.default_flow_rate
        if (globalDefaults.apply_to_sources) initialInput.apply_to_sources = true
        pressurePopupPendingRef.current = true
        void sim.runSimulation({ initialInput: Object.keys(initialInput).length > 0 ? initialInput : undefined })
    }, [globalDefaults, nodeOverrides, sim])

    // 种子节点数据（供 SimParamEditor 使用）
    const seedNodesForEditor = useMemo(() => {
        if (!sim.overlay) return []
        return sim.overlay.nodes.map(n => ({
            id: n.id,
            name: topoNodes.find(tn => tn.sourceNodeIds?.includes(n.id))?.name ?? n.id,
            operating_pressure_in: n.pressure_in_mpa ?? n.pressure_mpa,
            target_pressure_mpa: n.pressure_mpa,
            min_pressure_mpa: undefined as number | undefined,
        }))
    }, [sim.overlay, topoNodes])

    const edgesForEditor = useMemo(() => {
        if (!sim.overlay) return []
        return sim.overlay.edges.map(e => ({
            id: e.id,
            name: topoEdges.find(te => te.sourceEdgeIds?.includes(e.id))?.name ?? e.id,
        }))
    }, [sim.overlay, topoEdges])

    // ================== 渲染 ==================
    // NOTE: 不传 pipelineData 给 MapView，这样地图上只有底图，没有任何站场/管线渲染
    return (
        <div className="h-screen w-screen overflow-hidden relative bg-[#101922]">
            {/* 标题栏 */}
            <div className="absolute top-0 left-0 right-0 z-30 bg-[#0c1218]/90 backdrop-blur-md border-b border-cyan-500/30">
                <div className="px-6 py-3 flex justify-between items-center">
                    <div>
                        <h1 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-xl text-cyan-400">conversion_path</span>
                            智脉平台 · 地图拓扑管理
                        </h1>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                            节点 <b className="text-cyan-400">{stats.nodes}</b> · 连线 <b className="text-green-400">{stats.edges}</b> · 孤立 <b className="text-red-400">{stats.isolated}</b>
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={importTopology} className="px-3 py-1.5 bg-purple-600/80 hover:bg-purple-500 text-white text-xs rounded-lg transition-colors flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">download</span>导入拓扑
                        </button>
                        <button onClick={runValidation} disabled={topoNodes.length === 0} className="px-3 py-1.5 bg-cyan-600/80 hover:bg-cyan-500 text-white text-xs rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40">
                            <span className="material-symbols-outlined text-sm">verified</span>验证
                        </button>
                        <button onClick={runCentrality} disabled={topoNodes.length < 3} className="px-3 py-1.5 bg-amber-600/80 hover:bg-amber-500 text-white text-xs rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40">
                            <span className="material-symbols-outlined text-sm">stars</span>关键节点
                        </button>
                    </div>
                </div>
            </div>

            {/* 纯底图 —— 不传 pipelineData，不渲染任何站场/阀室 */}
            <MapView onLoad={handleMapLoad} />

            {(sim.isLoading || sim.animatingState?.active) && (
                <div className="absolute top-[82px] right-4 z-40 w-80 rounded-xl border border-cyan-400/30 bg-slate-950/90 backdrop-blur-md shadow-2xl shadow-cyan-950/40 p-3">
                    <div className="flex items-center gap-2 text-cyan-100 font-bold text-sm">
                        <span className="material-symbols-outlined text-lg text-cyan-300 animate-spin">progress_activity</span>
                        正在仿真
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                        <div className="rounded-lg bg-white/5 border border-white/10 px-2 py-1.5">
                            <div className="text-slate-500">起始压力</div>
                            <div className="text-cyan-300 font-mono font-bold">
                                {simulationSourceInfo ? `${simulationSourceInfo.pressureOut.toFixed(2)} MPa` : '读取中'}
                            </div>
                        </div>
                        <div className="rounded-lg bg-white/5 border border-white/10 px-2 py-1.5">
                            <div className="text-slate-500">真实迭代</div>
                            <div className="text-indigo-300 font-mono font-bold">
                                {sim.animatingState?.solverIterations ?? sim.overlay?.iterations ?? '--'} 次
                            </div>
                        </div>
                    </div>
                    <div className="mt-3">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                            <span>{sim.isLoading ? '求解器装配中' : '压力场演化中'}</span>
                            <span>{sim.animatingState ? `${sim.animatingState.iteration}/${sim.animatingState.total}` : '--'}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-blue-400 to-emerald-400 transition-all duration-200"
                                style={{ width: sim.animatingState ? `${Math.min(100, (sim.animatingState.iteration / sim.animatingState.total) * 100)}%` : '18%' }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {pressurePopupVisible && pressurePopupOverlay && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm px-4">
                    <div className="w-full max-w-3xl rounded-2xl border border-cyan-400/25 bg-slate-950/95 shadow-2xl shadow-cyan-950/50 overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-gradient-to-r from-cyan-950/70 to-indigo-950/50">
                            <div>
                                <div className="flex items-center gap-2 text-white font-bold">
                                    <span className="material-symbols-outlined text-cyan-300">monitor_heart</span>
                                    仿真完成 · 压力结果
                                </div>
                                <div className="text-[11px] text-slate-400 mt-1">
                                    {SOLVER_STATUS_LABELS[pressurePopupOverlay.solver_status] || pressurePopupOverlay.solver_status}
                                    <span className="mx-2">|</span>
                                    真实迭代 {pressurePopupOverlay.iterations} 次
                                    <span className="mx-2">|</span>
                                    run_id {pressurePopupOverlay.run_id}
                                </div>
                            </div>
                            <button
                                onClick={() => setPressurePopupVisible(false)}
                                className="w-8 h-8 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center"
                                title="关闭"
                            >
                                <span className="material-symbols-outlined text-lg">close</span>
                            </button>
                        </div>

                        <div className="p-5">
                            <div className="grid grid-cols-4 gap-3 text-[11px] mb-4">
                                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                                    <div className="text-slate-500">起始压力</div>
                                    <div className="text-cyan-300 text-lg font-mono font-bold">
                                        {simulationSourceInfo ? simulationSourceInfo.pressureOut.toFixed(2) : '--'}
                                        <span className="text-[10px] text-slate-500 ml-1">MPa</span>
                                    </div>
                                </div>
                                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                                    <div className="text-slate-500">入口流量</div>
                                    <div className="text-emerald-300 text-lg font-mono font-bold">
                                        {simulationSourceInfo ? simulationSourceInfo.firstFlowRate.toFixed(0) : '--'}
                                        <span className="text-[10px] text-slate-500 ml-1">万标方/天</span>
                                    </div>
                                </div>
                                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                                    <div className="text-slate-500">总需求</div>
                                    <div className="text-blue-300 text-lg font-mono font-bold">
                                        {pressurePopupOverlay.summary.total_demand.toFixed(0)}
                                        <span className="text-[10px] text-slate-500 ml-1">万标方/天</span>
                                    </div>
                                </div>
                                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                                    <div className="text-slate-500">告警数</div>
                                    <div className={`text-lg font-mono font-bold ${pressurePopupOverlay.summary.alert_count > 0 ? 'text-amber-300' : 'text-slate-300'}`}>
                                        {pressurePopupOverlay.summary.alert_count}
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl border border-white/10 overflow-hidden">
                                <div className="grid grid-cols-[1.3fr_0.8fr_0.8fr_0.7fr_0.8fr] bg-slate-900/90 text-[10px] text-slate-400 px-3 py-2 uppercase tracking-wider">
                                    <span>站场</span>
                                    <span className="text-right">进站 MPa</span>
                                    <span className="text-right">出站 MPa</span>
                                    <span className="text-right">压差</span>
                                    <span className="text-right">状态</span>
                                </div>
                                <div className="max-h-80 overflow-y-auto divide-y divide-white/5">
                                    {pressurePopupRows.map(row => (
                                        <div key={row.id} className="grid grid-cols-[1.3fr_0.8fr_0.8fr_0.7fr_0.8fr] px-3 py-2 text-[11px] items-center hover:bg-white/[0.03]">
                                            <span className="text-slate-100 truncate">{row.name}</span>
                                            <span className="text-right text-slate-300 font-mono">{row.pressureIn.toFixed(2)}</span>
                                            <span className="text-right text-cyan-300 font-mono font-bold">{row.pressureOut.toFixed(2)}</span>
                                            <span className={`text-right font-mono ${Math.abs(row.delta) > 0.005 ? row.delta > 0 ? 'text-emerald-300' : 'text-red-300' : 'text-slate-500'}`}>
                                                {Math.abs(row.delta) > 0.005 ? `${row.delta > 0 ? '+' : ''}${row.delta.toFixed(2)}` : '-'}
                                            </span>
                                            <span className={`text-right font-semibold ${row.alertLevel === 'critical' ? 'text-red-300' : row.alertLevel === 'warning' ? 'text-amber-300' : 'text-emerald-300'}`}>
                                                {row.alertLevel === 'critical' ? '严重' : row.alertLevel === 'warning' ? '预警' : '正常'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 左侧面板 */}
            <div className="absolute top-[68px] left-4 bottom-4 z-20 w-72 flex flex-col">
                <div className="bg-[#0c1218]/95 backdrop-blur-md rounded-xl border border-cyan-500/20 shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 90px)' }}>
                    {/* 标签页头 */}
                    <div className="flex border-b border-gray-700/40 shrink-0">
                        {([
                            { id: 'edit' as PanelTab, label: '编辑', icon: 'edit' },
                            { id: 'validate' as PanelTab, label: '验证', icon: 'verified' },
                            { id: 'search' as PanelTab, label: '搜索', icon: 'search' },
                            { id: 'centrality' as PanelTab, label: '枢纽', icon: 'stars' },
                            { id: 'cutoff' as PanelTab, label: '截断', icon: 'cut' },
                            { id: 'simulation' as PanelTab, label: '仿真', icon: 'science' },
                        ]).map(tab => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 py-2.5 text-[11px] flex items-center justify-center gap-1 transition-all border-b-2
                                    ${activeTab === tab.id ? 'text-cyan-400 border-cyan-500 bg-cyan-500/5' : 'text-gray-500 border-transparent hover:text-gray-300'}`}>
                                <span className="material-symbols-outlined text-sm">{tab.icon}</span>{tab.label}
                            </button>
                        ))}
                    </div>

                    {/* 面板内容 */}
                    <div className="flex-1 overflow-y-auto p-3">
                        {/* 编辑 */}
                        {activeTab === 'edit' && (
                            <div className="space-y-3">
                                <div>
                                    <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wider">操作模式</p>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {([
                                            { m: 'view' as EditMode, label: '浏览', icon: 'pan_tool' },
                                            { m: 'draw-point' as EditMode, label: '添点', icon: 'add_location' },
                                            { m: 'connect' as EditMode, label: '连线', icon: 'timeline' },
                                        ]).map(item => (
                                            <button key={item.m} onClick={() => setEditMode(item.m)}
                                                className={`py-2 rounded-lg text-[11px] transition-all flex flex-col items-center gap-0.5
                                                    ${editMode === item.m ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20' : 'bg-gray-800/60 text-gray-400 hover:bg-gray-700'}`}>
                                                <span className="material-symbols-outlined text-base">{item.icon}</span>{item.label}
                                            </button>
                                        ))}
                                    </div>
                                    {manualJunctionEditingEnabled && (
                                        <button
                                            onClick={() => setEditMode('merge')}
                                            className={`mt-2 w-full py-2 rounded-lg text-[11px] transition-all flex items-center justify-center gap-1.5
                                                ${editMode === 'merge' ? 'bg-purple-700/80 text-white' : 'bg-purple-900/40 text-purple-200 hover:bg-purple-800/50'}`}
                                        >
                                            <span className="material-symbols-outlined text-sm">hub</span>
                                            兼容手工捏合（旧流程）
                                        </button>
                                    )}
                                </div>

                                <div className="border border-sky-500/20 bg-sky-950/20 rounded-lg p-2.5 space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="text-[10px] text-sky-300 uppercase tracking-wider">运行时枢纽</p>
                                        <span className="text-[10px] text-sky-400">
                                            {JUNCTION_MODE_LABELS[junctionMode] || junctionMode}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-300 leading-5">{JUNCTION_READONLY_HINT}</p>
                                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                                        <div className="rounded bg-white/5 px-2 py-2">
                                            <div className="text-gray-500">枢纽数</div>
                                            <div className="mt-1 text-white font-medium">{junctionGroups.length}</div>
                                        </div>
                                        <div className="rounded bg-white/5 px-2 py-2">
                                            <div className="text-gray-500">大枢纽</div>
                                            <div className="mt-1 text-white font-medium">
                                                {junctionGroups.filter(group => group.junction_kind === 'major_junction').length}
                                            </div>
                                        </div>
                                        <div className="rounded bg-white/5 px-2 py-2">
                                            <div className="text-gray-500">覆盖站点</div>
                                            <div className="mt-1 text-white font-medium">
                                                {junctionGroups.reduce((sum, group) => sum + (group.member_count ?? group.station_ids.length ?? 0), 0)}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {editMode === 'draw-point' && (
                                    <div>
                                        <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wider">节点类型</p>
                                        <div className="grid grid-cols-2 gap-1.5">
                                            {(Object.keys(TOPO_LABELS) as PointType[]).map(key => (
                                                <button key={key} onClick={() => setPointType(key)}
                                                    className={`py-2 px-2 rounded-lg text-xs flex items-center gap-1.5 transition-all
                                                        ${pointType === key ? 'ring-1 ring-cyan-500 bg-gray-700 text-white' : 'bg-gray-800/40 text-gray-400 hover:bg-gray-700/60'}`}>
                                                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: TOPO_COLORS[key] }} />
                                                    {TOPO_LABELS[key]}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {editMode === 'merge' && (
                                    <div className="border border-purple-500/20 bg-purple-950/20 rounded-lg p-2.5 space-y-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-[10px] text-purple-300 uppercase tracking-wider">手工捏合</p>
                                            <span className="text-[10px] text-purple-400">已选 {selectedMergeNodeIds.length} 站</span>
                                        </div>
                                        <p className="text-xs text-gray-300 leading-5">
                                            这块是修正入口。点地图上的底层站点，把需要归成同一个枢纽的站选出来，再创建覆盖层。
                                            运行时重编结果继续作为底座，手工捏合只覆盖你明确选中的站点。
                                        </p>
                                        <input
                                            value={mergeJunctionName}
                                            onChange={e => setMergeJunctionName(e.target.value)}
                                            placeholder={selectedMergeAutoName || '给这次手工捏合起个名字'}
                                            className="w-full rounded-lg border border-purple-500/20 bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-purple-400"
                                        />
                                        <textarea
                                            value={mergeJunctionDescription}
                                            onChange={e => setMergeJunctionDescription(e.target.value)}
                                            placeholder="可选：写下修正原因，后面复盘更容易看懂"
                                            rows={3}
                                            className="w-full resize-none rounded-lg border border-purple-500/20 bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-purple-400"
                                        />
                                        <div className="rounded-lg bg-black/20 p-2">
                                            <div className="flex items-center justify-between text-[10px] text-gray-400">
                                                <span>本次选中的站点</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedMergeNodeIds([])}
                                                    disabled={selectedMergeNodeIds.length === 0}
                                                    className="text-gray-400 hover:text-white disabled:opacity-40"
                                                >
                                                    清空
                                                </button>
                                            </div>
                                            <div className="mt-2 max-h-28 space-y-1 overflow-y-auto">
                                                {selectedMergeNodes.length > 0 ? selectedMergeNodes.map(node => (
                                                    <div key={node.id} className="flex items-center gap-2 rounded bg-white/5 px-2 py-1 text-xs text-gray-200">
                                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: TOPO_COLORS[node.type] }} />
                                                        <span className="flex-1 truncate">{node.name}</span>
                                                        <span className="text-[10px] text-gray-500">{node.id}</span>
                                                    </div>
                                                )) : (
                                                    <div className="rounded bg-white/5 px-2 py-2 text-xs text-gray-500">
                                                        还没选站点。先去地图上点两个及以上底层站点。
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => void handleCreateManualJunction()}
                                            disabled={selectedMergeNodeIds.length < 2 || isMerging}
                                            className="w-full bg-purple-700/80 hover:bg-purple-600 text-white py-2 rounded-lg text-xs transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                                        >
                                            <span className="material-symbols-outlined text-sm">hub</span>
                                            {isMerging ? '创建中...' : '创建手工捏合枢纽'}
                                        </button>
                                        <div className="rounded-lg border border-white/10 bg-black/10 p-2">
                                            <div className="flex items-center justify-between text-[10px] text-gray-400">
                                                <span>当前可拆分的手工捏合</span>
                                                <span>{manualEditableJunctionGroups.length} 个</span>
                                            </div>
                                            <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                                                {manualEditableJunctionGroups.length > 0 ? manualEditableJunctionGroups.map(group => (
                                                    <div key={group.id} className="rounded bg-white/5 px-2 py-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="flex-1 truncate text-xs text-gray-200">{group.name}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => void handleDeleteManualJunction(group)}
                                                                disabled={deletingJunctionId === group.id}
                                                                className="text-[10px] text-red-300 hover:text-red-200 disabled:opacity-40"
                                                            >
                                                                {deletingJunctionId === group.id ? '拆分中...' : '拆分'}
                                                            </button>
                                                        </div>
                                                        <div className="mt-1 text-[10px] text-gray-500">
                                                            覆盖 {group.member_count ?? group.station_ids.length} 个站点
                                                        </div>
                                                    </div>
                                                )) : (
                                                    <div className="rounded bg-white/5 px-2 py-2 text-xs text-gray-500">
                                                        现在没有手工捏合覆盖层。
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}


                                <div className="border border-cyan-500/20 bg-cyan-950/20 rounded-lg p-2.5 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-[10px] text-cyan-300 uppercase tracking-wider">点位保存</p>
                                        <span className="text-[10px] text-cyan-400">{dirtyPositions.size} 个待保存</span>
                                    </div>
                                    <label className="flex items-center justify-between gap-3 text-xs text-gray-300">
                                        <span>保存时联动阀室</span>
                                        <button
                                            type="button"
                                            onClick={() => setCascadeValves(prev => !prev)}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${cascadeValves ? 'bg-cyan-600' : 'bg-gray-700'}`}
                                        >
                                            <span
                                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${cascadeValves ? 'translate-x-6' : 'translate-x-1'}`}
                                            />
                                        </button>
                                    </label>
                                    <p className="text-[10px] text-gray-500 leading-4">
                                        保存后会把当前拖动过的主点写入数据库，并按区段自动重算受影响阀室的位置。
                                    </p>
                                    {positionPreview && (
                                        <div className="rounded-lg border border-cyan-500/20 bg-black/20 p-2 space-y-1.5">
                                            <div className="grid grid-cols-3 gap-1 text-[10px]">
                                                <span className="rounded bg-white/5 px-2 py-1 text-center text-gray-300">
                                                    主点 {positionPreview.updated_station_ids.length}
                                                </span>
                                                <span className="rounded bg-white/5 px-2 py-1 text-center text-gray-300">
                                                    阀室 {positionPreview.updated_valve_ids.length}
                                                </span>
                                                <span className="rounded bg-white/5 px-2 py-1 text-center text-gray-300">
                                                    区段 {positionPreview.impacted_segments.length}
                                                </span>
                                            </div>
                                            {positionPreview.impacted_segments.length > 0 && (
                                                <div className="max-h-24 overflow-y-auto space-y-1">
                                                    {positionPreview.impacted_segments.slice(0, 4).map(segment => (
                                                        <div key={`${segment.start_id}-${segment.end_id}`} className="text-[10px] text-gray-400 bg-white/5 rounded px-2 py-1">
                                                            {segment.start_id} → {segment.end_id} · 阀室 {segment.valve_ids.length}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {positionPreview.errors.length > 0 && (
                                                <p className="text-[10px] text-red-400">
                                                    预览包含 {positionPreview.errors.length} 条异常，请先检查待保存点位。
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    <div className="flex gap-1.5">
                                        <button
                                            onClick={() => void handlePreviewPositions()}
                                            disabled={dirtyPositions.size === 0 || isSaving || isPreviewing}
                                            className="flex-1 bg-sky-900/60 hover:bg-sky-800 text-sky-300 py-2 rounded-lg text-xs transition-colors disabled:opacity-40"
                                        >
                                            {isPreviewing ? '预览中...' : '预览影响'}
                                        </button>
                                        <button
                                            onClick={() => void resetUnsavedPositions()}
                                            disabled={dirtyPositions.size === 0 || isSaving}
                                            className="flex-1 bg-gray-800/60 hover:bg-gray-700 text-gray-300 py-2 rounded-lg text-xs transition-colors disabled:opacity-40"
                                        >
                                            撤销未保存
                                        </button>
                                        <button
                                            onClick={() => void handleSavePositions()}
                                            disabled={dirtyPositions.size === 0 || isSaving}
                                            className="flex-1 bg-cyan-700/80 hover:bg-cyan-600 text-white py-2 rounded-lg text-xs transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                                        >
                                            <span className="material-symbols-outlined text-sm">save</span>
                                            {isSaving ? '保存中...' : '保存坐标'}
                                        </button>
                                    </div>
                                </div>

                                {/* 图例 */}
                                <div className="border-t border-gray-800/50 pt-2">
                                    <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wider">图例</p>
                                    <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-400">
                                        {(Object.keys(TOPO_LABELS) as PointType[]).map(key => (
                                            <span key={key} className="flex items-center gap-1">
                                                <span className="rounded-full shrink-0" style={{ width: TOPO_SIZES[key], height: TOPO_SIZES[key], backgroundColor: TOPO_COLORS[key] }} />
                                                {TOPO_LABELS[key]}
                                            </span>
                                        ))}
                                        <span className="flex items-center gap-1 col-span-2 mt-0.5">
                                            <span className="w-6 h-[2px] shrink-0" style={{ backgroundColor: LINE_COLOR }} />
                                            管线连接
                                        </span>
                                    </div>
                                </div>

                                <div className="flex gap-1.5 pt-1">
                                    <button onClick={() => void doUndo()} disabled={undoStack.length === 0} className="flex-1 bg-blue-900/40 hover:bg-blue-800 text-blue-400 py-2 rounded-lg text-xs border border-blue-800/40 transition-colors disabled:opacity-40 flex items-center justify-center gap-1">
                                        <span className="material-symbols-outlined text-sm">undo</span>撤销{undoStack.length > 0 ? `(${undoStack.length})` : ''}
                                    </button>
                                    <button onClick={exportJSON} disabled={topoNodes.length === 0} className="flex-1 bg-green-900/40 hover:bg-green-800 text-green-400 py-2 rounded-lg text-xs border border-green-800/40 transition-colors disabled:opacity-40">导出</button>
                                    <button onClick={clearAll} disabled={topoNodes.length === 0} className="flex-1 bg-red-900/40 hover:bg-red-800 text-red-400 py-2 rounded-lg text-xs border border-red-800/40 transition-colors disabled:opacity-40">清空</button>
                                </div>
                            </div>
                        )}

                        {/* 仿真控台 */}
                        {activeTab === 'simulation' && (
                            <div className="space-y-3">
                                {/* 标题栏 */}
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-[0_0_12px_rgba(99,102,241,0.5)] border border-indigo-300/30">
                                            <span className="material-symbols-outlined text-[16px] text-white">tune</span>
                                        </div>
                                        <span className="font-bold text-sm text-white tracking-wide">仿真控台</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className={`w-2 h-2 rounded-full ${sim.overlay ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : sim.isLoading ? 'bg-amber-400 animate-pulse' : 'bg-gray-500'}`} />
                                        <span className="text-[10px] text-gray-400">
                                            {sim.isLoading ? '运行中' : sim.overlay ? '已完成' : '待命'}
                                        </span>
                                    </div>
                                </div>

                                {/* INPUT DATA */}
                                <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-b from-cyan-950/40 to-transparent p-3 space-y-3 shadow-inner shadow-cyan-500/5">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <div className="w-1 h-3 rounded-full bg-cyan-400"></div>
                                        <div className="text-[10px] uppercase tracking-widest text-cyan-300 font-bold">INPUT DATA</div>
                                    </div>
                                    {/* 场景选择 */}
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-7 h-7 rounded-md bg-cyan-900/40 border border-cyan-500/30 flex items-center justify-center shrink-0 shadow-[0_0_8px_rgba(6,182,212,0.15)]">
                                            <span className="material-symbols-outlined text-[15px] text-cyan-300">schema</span>
                                        </div>
                                        <select
                                            value={sim.currentScenario}
                                            onChange={e => sim.setScenario(e.target.value)}
                                            className="flex-1 bg-slate-800/80 border border-indigo-500/25 rounded-lg text-[11px] text-slate-200 px-2.5 py-1.5 outline-none hover:border-cyan-500/50 transition-colors"
                                        >
                                            {scenarioOptions.map(s => (
                                                <option key={s.id} value={s.id}>{s.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    {/* 历史快照 */}
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-7 h-7 rounded-md bg-cyan-900/40 border border-cyan-500/30 flex items-center justify-center shrink-0 shadow-[0_0_8px_rgba(6,182,212,0.15)]">
                                            <span className="material-symbols-outlined text-[15px] text-cyan-300">history</span>
                                        </div>
                                        <select
                                            value={sim.selectedSnapshotRunId}
                                            onChange={e => sim.setSelectedSnapshotRunId(e.target.value)}
                                            className="flex-1 bg-slate-800/80 border border-indigo-500/25 rounded-lg text-[11px] text-slate-200 px-2.5 py-1.5 outline-none hover:border-cyan-500/50 transition-colors"
                                        >
                                            <option value="">← 选择历史快照</option>
                                            {sim.snapshots.map(s => (
                                                <option key={s.run_id} value={s.run_id}>{s.scenario_id} | {s.run_id.slice(0, 12)}</option>
                                            ))}
                                        </select>
                                    </div>
                                    {/* 精细化参数 */}
                                    <button
                                        onClick={() => setShowSimParamEditor(!showSimParamEditor)}
                                        className="w-full flex items-center gap-2.5 text-left py-1 hover:opacity-80 transition-opacity"
                                    >
                                        <div className="w-7 h-7 rounded-md bg-emerald-900/40 border border-emerald-500/30 flex items-center justify-center shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.15)]">
                                            <span className="material-symbols-outlined text-[15px] text-emerald-400">code</span>
                                        </div>
                                        <span className="text-[11px] text-emerald-300 font-medium">编辑精细化参数 (压力/流量)</span>
                                        <span className="text-cyan-400 ml-auto">{showSimParamEditor ? '▴' : '▾'}</span>
                                    </button>
                                    {showSimParamEditor && (
                                        <SimParamEditor
                                            seedNodes={seedNodesForEditor}
                                            edges={edgesForEditor}
                                            nodeOverrides={nodeOverrides}
                                            edgeLengthOverrides={edgeLengthOverrides}
                                            edgeFlowOverrides={edgeFlowOverrides}
                                            globalDefaults={globalDefaults}
                                            validationError={paramValidationError}
                                            onNodeOverridesChange={setNodeOverrides}
                                            onEdgeLengthOverridesChange={setEdgeLengthOverrides}
                                            onEdgeFlowOverridesChange={setEdgeFlowOverrides}
                                            onGlobalDefaultsChange={setGlobalDefaults}
                                        />
                                    )}
                                </div>

                                {/* SOLVER ENGINE */}
                                <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/40 to-transparent p-3 space-y-3 shadow-inner shadow-emerald-500/5">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <div className="w-1 h-3 rounded-full bg-emerald-400"></div>
                                        <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-bold">SOLVER ENGINE</div>
                                    </div>
                                    <div className="flex gap-2.5">
                                        <button
                                            onClick={() => { if (sim.selectedSnapshotRunId) sim.loadSelectedSnapshot() }}
                                            disabled={sim.snapshotLoading || !sim.selectedSnapshotRunId}
                                            className="group flex-1 py-3 rounded-xl border border-emerald-500/30 bg-emerald-900/20 text-emerald-200 text-[11px] font-bold flex flex-col items-center gap-1.5 transition-all hover:bg-emerald-800/40 hover:border-emerald-400/50 hover:shadow-[0_0_15px_rgba(16,185,129,0.2)] disabled:opacity-30 disabled:hover:shadow-none"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors shadow-inner">
                                                <span className="material-symbols-outlined text-[20px] text-emerald-400">edit_note</span>
                                            </div>
                                            按压力快照运行
                                        </button>
                                        <button
                                            onClick={handleRunSimulation}
                                            disabled={sim.isLoading || !!sim.animatingState?.active}
                                            className="group flex-1 py-3 rounded-xl border border-cyan-500/30 bg-cyan-900/20 text-cyan-200 text-[11px] font-bold flex flex-col items-center gap-1.5 transition-all hover:bg-cyan-800/40 hover:border-cyan-400/50 hover:shadow-[0_0_15px_rgba(6,182,212,0.2)] disabled:opacity-30 disabled:hover:shadow-none"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors shadow-inner">
                                                <span className="material-symbols-outlined text-[20px] text-cyan-400">{sim.isLoading || sim.animatingState?.active ? 'hourglass_top' : 'play_circle'}</span>
                                            </div>
                                            {sim.isLoading ? '求解中...' : sim.animatingState?.active ? `迭代动画 ${sim.animatingState.iteration}/${sim.animatingState.total}` : '场景参数仿真'}
                                        </button>
                                    </div>
                                    {/* 运行状态 */}
                                    <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                                        <span className="material-symbols-outlined text-sm">terminal</span>
                                        {sim.isLoading ? '正在求解...' : sim.animatingState?.active ? `正在渲染演化过程，真实求解迭代 ${sim.animatingState.solverIterations} 次` : sim.overlay ? `已完成 (${SOLVER_STATUS_LABELS[sim.overlay.solver_status] || sim.overlay.solver_status})` : '未运行'}
                                    </div>
                                    {(sim.isLoading || sim.animatingState?.active || sim.overlay) && (
                                        <div className="rounded-lg border border-cyan-500/15 bg-slate-900/50 p-2.5 space-y-2">
                                            <div className="grid grid-cols-2 gap-2 text-[10px]">
                                                <div className="rounded-md bg-black/20 px-2 py-1.5">
                                                    <div className="text-gray-500">起始站</div>
                                                    <div className="text-slate-100 font-semibold truncate">{simulationSourceInfo?.name || '中卫入口读取中'}</div>
                                                </div>
                                                <div className="rounded-md bg-black/20 px-2 py-1.5">
                                                    <div className="text-gray-500">起始压力</div>
                                                    <div className="text-cyan-300 font-mono font-bold">
                                                        {simulationSourceInfo ? `${simulationSourceInfo.pressureOut.toFixed(2)} MPa` : '--'}
                                                    </div>
                                                </div>
                                                <div className="rounded-md bg-black/20 px-2 py-1.5">
                                                    <div className="text-gray-500">入口流量</div>
                                                    <div className="text-emerald-300 font-mono font-bold">
                                                        {simulationSourceInfo ? `${simulationSourceInfo.firstFlowRate.toFixed(0)} 万标方/天` : '--'}
                                                    </div>
                                                </div>
                                                <div className="rounded-md bg-black/20 px-2 py-1.5">
                                                    <div className="text-gray-500">求解迭代</div>
                                                    <div className="text-indigo-300 font-mono font-bold">
                                                        {sim.animatingState?.solverIterations ?? sim.overlay?.iterations ?? '--'} 次
                                                    </div>
                                                </div>
                                            </div>
                                            {sim.animatingState?.active && (
                                                <div>
                                                    <div className="flex items-center justify-between text-[9px] text-gray-500 mb-1">
                                                        <span>动画演化</span>
                                                        <span>{sim.animatingState.iteration}/{sim.animatingState.total}</span>
                                                    </div>
                                                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                                                        <div
                                                            className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-indigo-400 to-emerald-400 transition-all duration-200"
                                                            style={{ width: `${Math.min(100, (sim.animatingState.iteration / sim.animatingState.total) * 100)}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* OUTPUT VIEW */}
                                <div className="rounded-xl border border-indigo-500/20 bg-gradient-to-b from-indigo-950/40 to-transparent p-3 space-y-3 shadow-inner shadow-indigo-500/5">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <div className="w-1 h-3 rounded-full bg-indigo-400"></div>
                                        <div className="text-[10px] uppercase tracking-widest text-indigo-300 font-bold">OUTPUT VIEW</div>
                                    </div>
                                    {sim.overlay ? (
                                        <>
                                            <div className="grid grid-cols-2 gap-2 text-[10px]">
                                                <div className="bg-slate-800/40 border border-white/5 rounded-lg px-2.5 py-2">
                                                    <div className="text-gray-500 mb-0.5">总供气</div>
                                                    <div className="text-emerald-300 font-bold text-sm">{sim.overlay.summary.total_supply.toFixed(1)} <span className="text-[9px] text-gray-500 font-normal">万方/天</span></div>
                                                </div>
                                                <div className="bg-slate-800/40 border border-white/5 rounded-lg px-2.5 py-2">
                                                    <div className="text-gray-500 mb-0.5">未满足</div>
                                                    <div className={`font-bold text-sm ${sim.overlay.summary.unserved_demand > 0 ? 'text-red-400' : 'text-green-400'}`}>{sim.overlay.summary.unserved_demand.toFixed(1)} <span className="text-[9px] text-gray-500 font-normal">万方/天</span></div>
                                                </div>
                                                <div className="bg-slate-800/40 border border-white/5 rounded-lg px-2.5 py-2">
                                                    <div className="text-gray-500 mb-0.5">利用率</div>
                                                    <div className="text-cyan-300 font-bold text-sm">{(sim.overlay.summary.avg_utilization * 100).toFixed(1)}%</div>
                                                </div>
                                                <div className="bg-slate-800/40 border border-white/5 rounded-lg px-2.5 py-2">
                                                    <div className="text-gray-500 mb-0.5">告警</div>
                                                    <div className={`font-bold text-sm ${sim.overlay.summary.alert_count > 0 ? 'text-amber-400' : 'text-gray-400'}`}>{sim.overlay.summary.alert_count}</div>
                                                </div>
                                            </div>
                                            {/* 逐站压力对比 */}
                                            <div className="space-y-1.5 mt-2">
                                                <div className="flex items-center text-[9px] text-indigo-300/70 uppercase tracking-widest px-1">
                                                    <span className="flex-1">站场名称</span>
                                                    <span className="w-12 text-right">进站</span>
                                                    <span className="w-12 text-right">出站</span>
                                                    <span className="w-11 text-right">压差</span>
                                                </div>
                                                <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                                                {sim.overlay.nodes.map(n => {
                                                    const pIn = n.pressure_in_mpa ?? n.pressure_mpa
                                                    const pOut = n.pressure_mpa
                                                    const delta = pOut - pIn
                                                    const name = topoNodes.find(tn => tn.sourceNodeIds?.includes(n.id))?.name ?? n.id
                                                    return (
                                                        <div key={n.id} className="flex items-center gap-1.5 text-[10px] bg-slate-800/40 hover:bg-slate-700/60 transition-colors rounded-lg px-2 py-1.5 border border-white/5">
                                                            <span className="flex-1 text-gray-200 truncate font-medium">{name}</span>
                                                            <span className="text-gray-400 tabular-nums w-12 text-right font-mono bg-black/20 rounded px-1">{pIn.toFixed(2)}</span>
                                                            <span className="text-cyan-400 tabular-nums w-12 text-right font-mono bg-cyan-950/30 rounded px-1 border border-cyan-500/10">{pOut.toFixed(2)}</span>
                                                            <span className={`text-[10px] tabular-nums w-11 text-right font-mono font-bold ${Math.abs(delta) > 0.005 ? (delta > 0 ? 'text-emerald-400' : 'text-red-400') : 'text-gray-600'}`}>
                                                                {Math.abs(delta) > 0.005 ? (delta > 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2)) : '—'}
                                                            </span>
                                                        </div>
                                                    )
                                                })}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setShowSnapshotPressureOverlay(!showSnapshotPressureOverlay)}
                                                className="w-full py-2 rounded-lg border border-indigo-500/25 bg-indigo-900/20 text-indigo-200 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all hover:bg-indigo-900/40"
                                            >
                                                <span className="material-symbols-outlined text-sm">visibility</span>
                                                全网稳态结果落图展示
                                            </button>
                                        </>
                                    ) : (
                                        <div className="text-center py-3 text-[10px] text-gray-500">运行仿真后查看结果</div>
                                    )}
                                </div>

                                {/* 底部操作栏 */}
                                <div className="flex gap-2 text-[10px]">
                                    <button onClick={() => sim.saveSnapshot()} disabled={!sim.overlay || sim.snapshotLoading}
                                        className="flex-1 py-1.5 rounded-lg border border-gray-600/30 bg-slate-800/50 text-gray-300 flex items-center justify-center gap-1 hover:bg-slate-700/50 disabled:opacity-30">
                                        <span className="material-symbols-outlined text-sm">save</span>归档
                                    </button>
                                    <button onClick={() => sim.refreshSnapshots()} disabled={sim.snapshotLoading}
                                        className="flex-1 py-1.5 rounded-lg border border-gray-600/30 bg-slate-800/50 text-gray-300 flex items-center justify-center gap-1 hover:bg-slate-700/50 disabled:opacity-30">
                                        <span className="material-symbols-outlined text-sm">refresh</span>刷新
                                    </button>
                                    <button onClick={() => sim.clearOverlay()} disabled={!sim.overlay}
                                        className="flex-1 py-1.5 rounded-lg border border-gray-600/30 bg-slate-800/50 text-gray-300 flex items-center justify-center gap-1 hover:bg-slate-700/50 disabled:opacity-30">
                                        <span className="material-symbols-outlined text-sm">restart_alt</span>重置
                                    </button>
                                </div>

                                {/* 错误显示 */}
                                {(sim.error || sim.snapshotError) && (
                                    <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-2.5 text-[10px] text-red-300">
                                        {sim.error || sim.snapshotError}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 验证 */}
                        {activeTab === 'validate' && (
                            <div className="space-y-2">
                                {!report ? (
                                    <div className="text-center py-6">
                                        <span className="material-symbols-outlined text-4xl text-gray-600">verified</span>
                                        <p className="text-gray-500 text-xs mt-2">点击顶栏「验证」开始</p>
                                    </div>
                                ) : (
                                    <>
                                        <div className={`p-3 rounded-lg text-xs border ${report.passed ? 'bg-green-900/20 border-green-700/40 text-green-400' : 'bg-red-900/20 border-red-700/40 text-red-400'}`}>
                                            <div className="flex items-center gap-1.5 font-bold text-sm mb-1">
                                                <span className="material-symbols-outlined text-base">{report.passed ? 'check_circle' : 'error'}</span>
                                                {report.passed ? '拓扑合法' : `${report.issues.length} 条问题`}
                                            </div>
                                            <div className="grid grid-cols-2 gap-y-0.5 text-[10px] text-gray-400 mt-1">
                                                <span>节点 {report.stats.nodeCount}</span>
                                                <span>连线 {report.stats.edgeCount}</span>
                                                <span>孤立 {report.stats.isolatedCount}</span>
                                                <span>连通分量 {report.stats.componentCount}</span>
                                            </div>
                                        </div>
                                        <div className="space-y-1 max-h-60 overflow-y-auto">
                                            {report.issues.map((issue, i) => (
                                                <div key={i} className={`p-2 rounded text-[10px] border ${issue.level === 'error' ? 'border-red-800/40 text-red-400 bg-red-900/10' : 'border-yellow-800/40 text-yellow-400 bg-yellow-900/10'}`}>
                                                    <span className="material-symbols-outlined text-[10px] mr-1 align-middle">{issue.level === 'error' ? 'error' : 'warning'}</span>{issue.message}
                                                </div>
                                            ))}
                                            {report.issues.length === 0 && <p className="text-center text-gray-500 text-[10px] py-3">无问题 🎉</p>}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* 搜索 */}
                        {activeTab === 'search' && (
                            <div className="space-y-2">
                                <input className="w-full bg-gray-900/60 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 outline-none focus:border-cyan-500/50"
                                    placeholder="输入站场名称..." value={searchText} onChange={e => setSearchText(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && searchResults.length > 0) flyTo(searchResults[0]) }} />
                                <div className="max-h-72 overflow-y-auto space-y-1">
                                    {searchText.trim() && searchResults.length === 0 && <p className="text-center text-gray-500 text-[10px] py-3">无匹配</p>}
                                    {searchResults.map(node => (
                                        <button key={node.id} onClick={() => flyTo(node)} className="w-full flex items-center gap-2 p-2 rounded-lg text-xs hover:bg-white/5 transition-colors text-left">
                                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: TOPO_COLORS[node.type] }} />
                                            <span className="text-gray-300 flex-1 truncate">{node.name}</span>
                                            <span className="material-symbols-outlined text-gray-500 text-sm">my_location</span>
                                        </button>
                                    ))}
                                    {!searchText.trim() && <p className="text-center text-gray-500 text-[10px] py-3">{topoNodes.length > 0 ? `${topoNodes.length} 个节点` : '请先导入拓扑'}</p>}
                                </div>
                            </div>
                        )}

                        {/* 截断仿真 */}
                        {activeTab === 'cutoff' && (
                            <div className="space-y-2">
                                {/* 搜索截断点 */}
                                <div>
                                    <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">选择截断位置</p>
                                    <input
                                        className="w-full bg-gray-900/60 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 outline-none focus:border-red-500/50"
                                        placeholder="搜索节点名称，或直接点击地图管段..."
                                        value={cutoffSearch}
                                        onChange={e => setCutoffSearch(e.target.value)}
                                    />
                                    {/* 搜索结果列表 */}
                                    {cutoffSearch.trim() && (
                                        <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                                            {searchNodes(
                                                topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type })),
                                                cutoffSearch
                                            ).map(node => (
                                                <button key={node.id}
                                                    onClick={() => {
                                                        selectCutoffNode(node.id, node.name)
                                                        setCutoffSearch('')
                                                    }}
                                                    className="w-full flex items-center gap-2 p-1.5 rounded text-xs hover:bg-white/5 text-left">
                                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: TOPO_COLORS[node.type as keyof typeof TOPO_COLORS] || '#888' }} />
                                                    <span className="text-gray-300 flex-1 truncate">{node.name}</span>
                                                    <span className="text-gray-600 text-[10px]">{node.type}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* 当前截断点 */}
                                {(cutoffNodeId || cutoffEdgeId) && (
                                    <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-2">
                                        <p className="text-[10px] text-red-400 mb-0.5">{cutoffEdgeId ? '截断管段' : '截断点'}</p>
                                        <p className="text-xs text-white font-medium truncate">
                                            {cutoffEdgeId
                                                ? (topoEdges.find(edge => edge.id === cutoffEdgeId)?.name || cutoffEdgeId)
                                                : (topoNodes.find(n => n.id === cutoffNodeId)?.name ?? cutoffNodeId)}
                                        </p>
                                    </div>
                                )}

                                {/* 操作按钮 */}
                                <div className="flex gap-1.5">
                                    <button
                                        onClick={runCutoffSimulation}
                                        disabled={(!cutoffNodeId && !cutoffEdgeId) || topoNodes.length === 0}
                                        className="flex-1 bg-red-800/50 hover:bg-red-700 text-red-300 py-2 rounded-lg text-xs border border-red-700/40 transition-colors disabled:opacity-40 flex items-center justify-center gap-1">
                                        <span className="material-symbols-outlined text-sm">play_arrow</span>运行仿真
                                    </button>
                                    <button
                                        onClick={clearCutoffHighlight}
                                        disabled={!cutoffNodeId && !cutoffEdgeId}
                                        className="bg-gray-800/60 hover:bg-gray-700 text-gray-400 py-2 px-3 rounded-lg text-xs border border-gray-700/40 transition-colors disabled:opacity-40">
                                        <span className="material-symbols-outlined text-sm">undo</span>
                                    </button>
                                </div>

                                {/* 仿真结果 */}
                                {cutoffResult && (
                                    <div className="space-y-2">
                                        {/* 气源简介 */}
                                        {cutoffResult.sourceNodes.length > 0 && (
                                            <div className="bg-blue-900/15 border border-blue-700/30 rounded-lg p-2 text-[10px]">
                                                <p className="text-blue-400 mb-1">识别到 {cutoffResult.sourceNodes.length} 个气源</p>
                                                <div className="text-gray-400 space-y-0.5 max-h-16 overflow-y-auto">
                                                    {cutoffResult.sourceNodes.map(s => (
                                                        <div key={s.id} className="truncate">· {s.name}</div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* 摘要卡片 */}
                                        <div className="bg-gray-900/60 border border-gray-700/30 rounded-lg p-2.5 text-[10px]">
                                            <p className="text-gray-400 mb-1.5">分析了 {cutoffResult.totalDistributionNodes} 个分输站</p>
                                            <div className="flex gap-2">
                                                <span className="flex-1 bg-red-900/30 rounded px-2 py-1 text-center">
                                                    <span className="block text-lg font-bold text-red-400">{cutoffResult.summary.supplyLost}</span>
                                                    <span className="text-gray-500">断供</span>
                                                </span>
                                                <span className="flex-1 bg-orange-900/30 rounded px-2 py-1 text-center">
                                                    <span className="block text-lg font-bold text-orange-400">{cutoffResult.summary.rerouted}</span>
                                                    <span className="text-gray-500">绕行</span>
                                                </span>
                                                <span className="flex-1 bg-green-900/30 rounded px-2 py-1 text-center">
                                                    <span className="block text-lg font-bold text-green-400">{cutoffResult.summary.same}</span>
                                                    <span className="text-gray-500">正常</span>
                                                </span>
                                            </div>
                                            <div className="mt-2 flex items-center justify-between rounded bg-red-950/25 px-2 py-1 text-[10px] text-red-200">
                                                <span>停流管段</span>
                                                <b>{cutoffResult.stoppedEdgeIds.length}</b>
                                            </div>
                                        </div>

                                        {/* 受影响节点列表 */}
                                        {cutoffResult.affectedNodes.length > 0 && (
                                            <div className="space-y-0.5 max-h-52 overflow-y-auto">
                                                <p className="text-[10px] text-gray-500 mb-1">受影响节点</p>
                                                {cutoffResult.affectedNodes.map(node => (
                                                    <div key={node.id}
                                                        className={`px-2 py-1.5 rounded text-[10px] border ${
                                                            node.status === 'supply_lost'
                                                                ? 'border-red-800/40 bg-red-900/10'
                                                                : 'border-orange-800/40 bg-orange-900/10'
                                                        }`}>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="material-symbols-outlined text-[10px]" style={{
                                                                color: node.status === 'supply_lost' ? '#f87171' : '#fb923c'
                                                            }}>
                                                                {node.status === 'supply_lost' ? 'cancel' : 'alt_route'}
                                                            </span>
                                                            <span className="flex-1 truncate text-gray-300">{node.name}</span>
                                                            <span className={node.status === 'supply_lost' ? 'text-red-400' : 'text-orange-400'}>
                                                                {node.status === 'supply_lost' ? '断供' : '绕行'}
                                                            </span>
                                                        </div>
                                                        {/* 路径预览 */}
                                                        {node.status === 'rerouted' && node.pathAfter.length > 0 && (
                                                            <div className="mt-1 text-[9px] text-gray-600 truncate pl-4">
                                                                ⤷ {pathIdsToNames(node.pathAfter, topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))).join(' → ')}
                                                            </div>
                                                        )}
                                                        {node.status === 'supply_lost' && node.pathBefore.length > 0 && (
                                                            <div className="mt-1 text-[9px] text-gray-600 truncate pl-4">
                                                                ⚠ 原路径: {pathIdsToNames(node.pathBefore, topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))).join(' → ')}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 提示 */}
                                {topoNodes.length === 0 && (
                                    <p className="text-center text-gray-600 text-[10px] py-4">请先点击「导入拓扑」</p>
                                )}
                                {topoNodes.length > 0 && !cutoffNodeId && !cutoffEdgeId && (
                                    <p className="text-[10px] text-gray-500 leading-relaxed">
                                        进入截断页后，可搜索节点截断，也可以直接点地图上的管段；运行后红色为关闭位置，灰色虚线为前端停流段。
                                    </p>
                                )}
                            </div>
                        )}

                        {/* 关键枢纽 */}
                        {activeTab === 'centrality' && (
                            <div className="space-y-2">
                                {centralityData.length === 0 ? (
                                    <div className="text-center py-6">
                                        <span className="material-symbols-outlined text-4xl text-gray-600">stars</span>
                                        <p className="text-gray-500 text-xs mt-2">点击顶栏「关键节点」计算</p>
                                        <p className="text-gray-600 text-[10px] mt-1">基于介数中心性算法</p>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-[10px] text-gray-500">介数中心性 Top {centralityData.length}</p>
                                        {centralityData.map((node, i) => (
                                            <button key={node.id} onClick={() => { const n = topoNodes.find(x => x.id === node.id); if (n) flyTo(n) }}
                                                className="w-full flex items-center gap-2 p-2 rounded-lg text-xs hover:bg-white/5 transition-colors text-left">
                                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${i < 3 ? 'bg-amber-500 text-black' : 'bg-gray-700 text-gray-300'}`}>{i + 1}</span>
                                                <span className="text-gray-200 flex-1 truncate">{node.name}</span>
                                                <div className="w-16 h-1.5 bg-gray-800 rounded overflow-hidden shrink-0">
                                                    <div className="h-full bg-gradient-to-r from-amber-500 to-cyan-400 rounded" style={{ width: `${node.value}%` }} />
                                                </div>
                                                <span className="text-gray-500 w-8 text-right shrink-0">{node.value}%</span>
                                            </button>
                                        ))}
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 状态栏 */}
                    <div className="px-3 py-2 bg-[#080d12] border-t border-gray-800/60 text-[10px] text-gray-500 truncate shrink-0 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[10px]">info</span>{statusMsg}
                    </div>
                </div>
            </div>

            {selectedNode && (
                <div className="absolute top-[84px] right-4 bottom-4 z-20 w-[360px]">
                    <div className="h-full bg-[#0c1218]/95 backdrop-blur-md rounded-xl border border-cyan-500/20 shadow-2xl overflow-hidden flex flex-col">
                        <div className="px-4 py-3 border-b border-cyan-500/20 flex items-center justify-between bg-[#0f1722]">
                            <div>
                                <h3 className="text-sm font-semibold text-white">{selectedNode.name}</h3>
                                <p className="text-[11px] text-gray-400 mt-0.5">节点详情</p>
                            </div>
                            <button
                                onClick={() => setSelectedNode(null)}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
                            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                                <div className="flex items-center gap-2">
                                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: TOPO_COLORS[selectedNode.type] }} />
                                    <span className="text-white font-medium">{selectedNode.name}</span>
                                </div>
                                <p className="text-xs text-gray-400 mt-2">类型：{selectedNode.isJunction ? '枢纽' : TOPO_LABELS[selectedNode.type]}</p>
                                <p className="text-xs text-gray-400 mt-1">
                                    坐标：{selectedNode.position[0].toFixed(4)}, {selectedNode.position[1].toFixed(4)}
                                </p>
                                <p className="text-xs text-gray-400 mt-1">
                                    关联连线：{topoEdges.filter(edge => edge.startNodeId === selectedNode.id || edge.endNodeId === selectedNode.id).length}
                                </p>
                            </div>

                            {selectedNode.isJunction ? (
                                <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 space-y-3">
                                    <div>
                                        <p className="text-xs text-purple-300 uppercase tracking-wider">底层站点</p>
                                        <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                                            {selectedNode.sourceNodeIds?.map(stationId => {
                                                const rawNode = baseTopoNodes.find(node => node.id === stationId)
                                                return (
                                                    <div key={stationId} className="text-xs text-gray-300 bg-white/5 rounded px-2 py-1">
                                                        {rawNode?.name || stationId}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-black/15 px-3 py-2 text-xs text-gray-300 space-y-1">
                                        <div className="flex items-center justify-between gap-3">
                                            <span>来源</span>
                                            <span className="text-[10px] text-gray-400">
                                                {selectedJunctionGroup && isRuntimeReadonlyGroup(selectedJunctionGroup)
                                                    ? '运行时重编'
                                                    : '手工捏合覆盖'}
                                            </span>
                                        </div>
                                        {selectedNode.junctionKind && (
                                            <div className="flex items-center justify-between gap-3">
                                                <span>枢纽类型</span>
                                                <span className="text-[10px] text-gray-400">{selectedNode.junctionKind}</span>
                                            </div>
                                        )}
                                    </div>
                                    {!manualJunctionEditingEnabled && (
                                        <div className="rounded-lg border border-sky-500/20 bg-sky-950/20 px-3 py-2.5 text-xs text-gray-300 leading-5">
                                            当前枢纽来自运行时重编影子表，继续作为拓扑枢纽参与展示和计算，但这里不再把手工拆分当主流程。
                                        </div>
                                    )}
                                    <button
                                        onClick={() => setHistoryChartTarget({
                                            junctionId: selectedNode.junctionId ? `JUNCTION-${selectedNode.junctionId}` : selectedNode.id,
                                            displayName: selectedNode.name,
                                        })}
                                        className="w-full bg-blue-700/80 hover:bg-blue-600 text-white py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-sm">show_chart</span>查看枢纽历史
                                    </button>
                                    {canDeleteSelectedJunction && selectedJunctionGroup && (
                                        <button
                                            onClick={() => void handleDeleteManualJunction(selectedJunctionGroup)}
                                            disabled={deletingJunctionId === selectedJunctionGroup.id}
                                            className="w-full bg-red-900/60 hover:bg-red-800 text-red-200 py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1 disabled:opacity-40"
                                        >
                                            <span className="material-symbols-outlined text-sm">account_tree_off</span>
                                            {deletingJunctionId === selectedJunctionGroup.id ? '拆分中...' : '拆分这个手工捏合'}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="rounded-lg border border-gray-700/40 bg-white/5 p-3">
                                    <p className="text-xs text-gray-300 leading-5">
                                        这里保留站点查看和点位编辑。枢纽关系由后台按交汇规则运行时生成，不再在这个面板里手工捏合。
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {historyChartTarget && (
                <div className="absolute inset-0 z-30 bg-black/30 backdrop-blur-[1px] flex items-center justify-center">
                    <ScadaHistoryChart
                        stationName={historyChartTarget.stationName}
                        junctionId={historyChartTarget.junctionId}
                        displayName={historyChartTarget.displayName}
                        onClose={() => setHistoryChartTarget(null)}
                    />
                </div>
            )}
        </div>
    )
}

export default MapTopologyView
