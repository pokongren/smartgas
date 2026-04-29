/**
 * åœ°å›¾æ‹“æ‰‘ç®¡ç†è§†å›¾ï¼ˆç‹¬ç«‹é¡µé¢ï¼‰
 *
 * åªæ˜¾ç¤ºçº¯æ‹“æ‰‘å±‚ï¼ˆç®€æ´åœ†ç‚?+ ç›´çº¿ï¼‰ï¼Œéšè—æ‰€æœ‰ç«™åœ?é˜€å®¤çš„å¤æ‚å›¾å½¢ã€? * ç‹¬ç«‹äºŽå…¨å›½ç®¡ç½‘ç»Ÿä¸€è§†å›¾å’?Canvas æ‹“æ‰‘è§†å›¾ã€? */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import MapView from '@/components/map-view/MapView'
import ScadaHistoryChart from '@/components/scada/ScadaHistoryChart'
import { buildPipelineDataFromPackages, invalidatePipelineCache, loadAllPipelines } from '@/data/pipelines'
import type { PipelinePackage } from '@/data/pipelines/types'
import { useSimulation } from '@/hooks/useSimulation'
import {
    topologyEditorApi,
    type JunctionGroup,
    type PositionPreviewResult,
} from '@/services/topologyEditorApi'
import type { PipelineNode, PipelineLine } from '@/types'
import {
    validateTopology,
    computeBetweennessCentrality,
    findIsolatedNodes,
} from '@/utils/topology-validator'
import type { ValidationReport } from '@/utils/topology-validator'
import { buildSimulationOverlayMapping } from '@/utils/simulationOverlayMapping'
import { simulateCutoff, searchNodes, pathIdsToNames } from '@/utils/cutoff-simulator'
import type { CutoffResult } from '@/utils/cutoff-simulator'
import { MAINLINE_SCENARIOS } from '@/types/simulation'

// ================== ç±»åž‹ ==================
type PointType = 'station' | 'valve' | 'distribution' | 'compressor' | 'junction'
type EditMode = 'view' | 'draw-point' | 'connect' | 'merge'
type PanelTab = 'edit' | 'validate' | 'search' | 'centrality' | 'cutoff' | 'simulation'

interface TopoNode {
    id: string
    type: PointType
    name: string
    position: [number, number]
    sourceNodeIds?: string[]
    internalSourceEdgeIds?: string[]
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
}

const WE1_PRIMARY_PILOT_ID = 'mainline_zhongwei_jingbian'

function formatDateTimeLabel(value?: string): string {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString('zh-CN', { hour12: false })
}

function formatSignedNumber(value: number, digits = 2): string {
    const sign = value > 0 ? '+' : ''
    return `${sign}${value.toFixed(digits)}`
}

const SOLVER_STATUS_LABELS: Record<'converged' | 'max_iter' | 'error', string> = {
    converged: 'å·²æ”¶æ•?,
    max_iter: 'è¾¾åˆ°è¿­ä»£ä¸Šé™',
    error: 'æ±‚è§£å¤±è´¥',
}

const FAILURE_LAYER_LABELS: Record<'frontend-consumption' | 'mapping-source-ids' | 'overlay-contract' | 'rendering-style', string> = {
    'frontend-consumption': 'å…ˆæŸ¥å‰ç«¯æ¶ˆè´¹å±‚ï¼ˆMapTopologyView / é¢æ¿ï¼?,
    'mapping-source-ids': 'å†æŸ¥ source IDs åˆ?overlay IDs çš„æ˜ å°?,
    'overlay-contract': 'å†æŸ¥ simulation-overlay å¥‘çº¦',
    'rendering-style': 'æœ€åŽå†æŸ¥åœ°å›¾æ ·å¼å’Œæ¸²æŸ“å¯¹è±¡',
}

const MAINLINE_SCENARIO_PLAYBOOK: Record<string, {
    focus: string
    success: string
    risk: string
    talk: string
}> = {
    steady_base: {
        focus: 'å…ˆçœ‹ä¸»å¹²åŽ‹åŠ›å’Œæµé‡æ˜¯ä¸æ˜¯å¹³é¡ºï¼Œç¡®è®¤ç¬¬ä¸€å¼ å›¾èƒ½ç¨³å®šè·‘é€šã€?,
        success: 'æ€»ä¾›ç»™ã€æ€»éœ€æ±‚ã€å¹³å‡åˆ©ç”¨çŽ‡éƒ½èƒ½æ­£å¸¸è½å‡ºæ¥ï¼Œå‘Šè­¦æ•°ä¸è¦çªç„¶å‡é«˜ã€?,
        risk: 'å¦‚æžœå¸¸è§„ç¨³æ€éƒ½æ²¡æœ‰ç»“æžœï¼ŒåŽé¢çš„å¼‚å¸¸åœºæ™¯å…ˆåˆ«è®²ï¼Œå…ˆæŠŠæ­£å¼ä»¿çœŸè·‘é€šã€?,
        talk: 'å…ˆç”¨å¸¸è§„ç¨³æ€æŠŠä¸»é“¾æ‰“é€šï¼Œè¯æ˜Žæ‹“æ‰‘ã€ç¨³æ€æ±‚è§£å’Œé¡µé¢éƒ½å·²ç»è¿žä¸Šã€?,
    },
    zhongwei_compressor_offline: {
        focus: 'é‡ç‚¹çœ‹ä¸­å«åŽ‹æ°”ç«™åœè¿åŽï¼Œä¸Šä¸‹æ¸¸åŽ‹åŠ›æœ‰æ²¡æœ‰æ˜Žæ˜¾æŽ‰è½ã€?,
        success: 'åŸºçº¿å¯¹æ¯”é‡Œèƒ½çœ‹å‡ºèŠ‚ç‚¹åŽ‹å·®ï¼Œå‘½ä¸­èŠ‚ç‚¹å’Œå‘Šè­¦æ•°ä¼šæ¯”å¸¸è§„ç¨³æ€æ›´æ˜Žæ˜¾ã€?,
        risk: 'å¦‚æžœæ²¡é€‰åŸºçº¿å¿«ç…§ï¼Œè¿™ä¸ªåœºæ™¯åªèƒ½çœ‹åˆ°å½“å‰å€¼ï¼Œçœ‹ä¸å‡ºåœè¿å‰åŽå·®å¼‚ã€?,
        talk: 'è¿™ä¸€å¹•ä¸»è¦è®²åŽ‹æ°”ç«™å¼‚å¸¸åŽï¼Œä¸»å¹²åŽ‹åŠ›æ˜¯æ€Žä¹ˆå¾€ä¸Šä¸‹æ¸¸ä¼ é€’çš„ã€?,
    },
    zhongwei_trunk_break: {
        focus: 'é‡ç‚¹çœ‹ä¸­å«é™„è¿‘ä¸»å¹²ä¸­æ–­åŽï¼Œè¿žçº¿æµé‡å’Œä¸‹æ¸¸ä¾›ç»™æ€Žä¹ˆå˜åŒ–ã€?,
        success: 'åŸºçº¿å¯¹æ¯”é‡Œçš„è¿žçº¿æµé‡å˜åŒ–ä¼šå¾ˆçªå‡ºï¼Œä¸‹æ¸¸å‘½ä¸­ç‚¹çº¿å’Œå‘Šè­¦ä¼šä¸€èµ·æŠ¬å¤´ã€?,
        risk: 'å¦‚æžœæ˜ å°„è¦†ç›–æ‘˜è¦é‡Œå‘½ä¸­ä¸è¶³ï¼Œè¿™ä¸ªåœºæ™¯ä¼šçœ‹ä¸æ¸…æ¥šæ–­ç‚¹å½±å“å…ˆä¼ åˆ°å“ªã€?,
        talk: 'è¿™ä¸€å¹•è®²ä¸»å¹²æ•…éšœä¼ æ’­ï¼Œæœ€é€‚åˆæ‹¿æ¥æ¼”ç¤ºç¬¬ä¸€å¼ å›¾çš„æ ¸å¿ƒä»·å€¼ã€?,
    },
    yanchi_jingbian_limited: {
        focus: 'é‡ç‚¹çœ‹ç›æ± åˆ°é–è¾¹é™æµåŽï¼Œåˆ©ç”¨çŽ‡å’Œå…³é”®æ®µè´Ÿè½½æœ‰æ²¡æœ‰æŠ¬å‡ã€?,
        success: 'è¿è¡Œç»“æžœæ‘˜è¦é‡Œå¹³å‡åˆ©ç”¨çŽ‡ä¼šå˜åŒ–ï¼Œè¿žçº¿è¯¦æƒ…é‡Œçš„åˆ©ç”¨çŽ‡å·®å€¼èƒ½çœ‹å‡ºæ¥ã€?,
        risk: 'å¦‚æžœå½“å‰åœºæ™¯æ²¡ç•™å¿«ç…§ï¼Œåªé ä¸€æ¬¡è¿è¡Œç»“æžœï¼Œä¸é€‚åˆæ‹¿æ¥åšç¨³å®šéªŒæ”¶ã€?,
        talk: 'è¿™ä¸€å¹•è®²é™æµï¼Œä¸æ˜¯æ–­è¾“ï¼Œè€Œæ˜¯ä¸»å¹²è¿˜èƒ½è·‘ä½†è¿è¡Œè¾¹ç•Œå¼€å§‹å˜ç´§ã€?,
    },
}

const COVERAGE_RECOMMENDATION_ORDER = [
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

// ================== æ‹“æ‰‘æ ·å¼ï¼ˆæžç®€åœ†ç‚¹ + é¢œè‰²åŒºåˆ†ï¼?==================
const TOPO_COLORS: Record<PointType, string> = {
    compressor: '#FF9800',
    distribution: '#2196F3',
    junction: '#00e5ff',
    station: '#F44336',
    valve: '#9E9E9E',
}

const TOPO_LABELS: Record<PointType, string> = {
    compressor: 'åŽ‹æ°”ç«?,
    distribution: 'åˆ†è¾“ç«?,
    junction: 'äº¤æ±‡æž¢çº½',
    station: 'ç«™åœº',
    valve: 'é˜€å®?,
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
const JUNCTION_READONLY_HINT = 'å½“å‰æž¢çº½ç”±è¿è¡Œæ—¶é‡ç¼–ç»“æžœç»´æŠ¤ï¼Œç¼–è¾‘å™¨ä»…æ”¯æŒåªè¯»æŸ¥çœ‹ï¼Œä¸å†ä»¥æ‰‹å·¥æåˆä½œä¸ºä¸»æµç¨‹ã€?
const JUNCTION_MODE_LABELS: Record<string, string> = {
    runtime_readonly: 'åªè¯»æ¨¡å¼',
    legacy_editable: 'æ—§æµç¨‹å…¼å®?,
}

const LINE_COLOR = '#34d399'
const LINE_WEIGHT = 2

/** ä»?PipelineNode.type (NodeType æžšä¸¾å€¼ï¼Œå‡ä¸ºå°å†™) æ˜ å°„åˆ°ç¼–è¾‘å™¨ PointType */
const TYPE_MAP: Record<string, PointType> = {
    regulator: 'compressor',
    metering: 'distribution',
    valve: 'valve',
    junction: 'junction',
    // NOTE: sj4 ç­‰æ–°æ•°æ®æ–‡ä»¶ç›´æŽ¥ä½¿ç”¨ compressor/distribution ç­‰å€?    compressor: 'compressor',
    distribution: 'distribution',
}

// ================== åˆ›å»ºçº¯æ‹“æ‰‘åœ†ç‚¹æ ‡è®?==================
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

// ================== ä¸»ç»„ä»?==================
const MapTopologyView: React.FC = () => {
    const location = useLocation()
    const [mapInstance, setMapInstance] = useState<any>(null)
    const handleMapLoad = useCallback((map: any) => setMapInstance(map), [])
    const importedOnceRef = useRef(false)
    const appliedFocusNodeRef = useRef<string | null>(null)

    // ç®¡çº¿æ•°æ®å¼‚æ­¥åŠ è½½
    const [pipelines, setPipelines] = useState<PipelinePackage[]>([])
    useEffect(() => {
        loadAllPipelines()
            .then(data => setPipelines(data))
            .catch(err => console.error('[MapTopologyView] ç®¡çº¿æ•°æ®åŠ è½½å¤±è´¥:', err))
    }, [])

    // ç¼–è¾‘å™¨çŠ¶æ€?    const [baseTopoNodes, setBaseTopoNodes] = useState<BaseTopoNode[]>([])
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
    const [statusMsg, setStatusMsg] = useState('ç‚¹å‡»ã€Œå¯¼å…¥æ‹“æ‰‘ã€åŠ è½½å·²æœ‰ç®¡çº?)
    const [selectedMergeNodeIds, setSelectedMergeNodeIds] = useState<string[]>([])
    const [mergeJunctionName, setMergeJunctionName] = useState('')
    const [mergeJunctionDescription, setMergeJunctionDescription] = useState('')
    const [isMerging, setIsMerging] = useState(false)
    const [deletingJunctionId, setDeletingJunctionId] = useState<number | null>(null)
    const [activeTab, setActiveTab] = useState<PanelTab>('simulation')
    const [searchText, setSearchText] = useState('')
    const [report, setReport] = useState<ValidationReport | null>(null)
    const [centralityData, setCentralityData] = useState<Array<{ id: string; name: string; value: number }>>([])

    const [selectedNode, setSelectedNode] = useState<TopoNode | null>(null)
    const [historyChartTarget, setHistoryChartTarget] = useState<null | {
        stationName?: string
        junctionId?: string
        displayName?: string
    }>(null)

    // æ’¤é”€æ ?    type UndoAction =
        | { type: 'add-node'; nodeId: string }
        | { type: 'add-edge'; edgeId: string }
        | { type: 'create-junction'; junctionId: number; name: string }
        | { type: 'delete-junction'; group: JunctionGroup }
    const [undoStack, setUndoStack] = useState<UndoAction[]>([])

    // æˆªæ–­ä»¿çœŸçŠ¶æ€?    const [cutoffNodeId, setCutoffNodeId] = useState<string | null>(null)
    const [cutoffResult, setCutoffResult] = useState<CutoffResult | null>(null)
    const [cutoffSearch, setCutoffSearch] = useState('')

    // ä¿å­˜æœºåˆ¶ï¼šè·Ÿè¸ªæ‹–æ‹½ä¿®æ”¹çš„åæ ‡
    const [dirtyPositions, setDirtyPositions] = useState<Map<string, [number, number]>>(new Map())
    const [isSaving, setIsSaving] = useState(false)
    const {
        overlay: steadyOverlay,
        baselineOverlay: steadyBaselineOverlay,
        isLoading: steadySimLoading,
        error: steadySimError,
        currentScenario: steadyScenarioId,
        snapshots: steadySnapshots,
        snapshotLoading: steadySnapshotLoading,
        baselineSnapshotLoading: steadyBaselineSnapshotLoading,
        snapshotError: steadySnapshotError,
        selectedSnapshotRunId: steadySelectedSnapshotRunId,
        baselineSnapshotRunId: steadyBaselineSnapshotRunId,
        trialRunScenarioId: steadyTrialRunScenarioId,
        bulkTrialRunActive: steadyBulkTrialRunActive,
        comparison: steadyComparison,
        trialRunItems: steadyTrialRunItems,
        setScenario: setSteadyScenario,
        setSelectedSnapshotRunId: setSteadySelectedSnapshotRunId,
        setBaselineSnapshotRunId: setSteadyBaselineSnapshotRunId,
        runSimulation: runSteadySimulation,
        saveSnapshot: saveSteadySnapshot,
        refreshSnapshots: refreshSteadySnapshots,
        loadSelectedSnapshot: loadSteadySelectedSnapshot,
        runTrialScenario: runSteadyTrialScenario,
        runMissingTrialScenarios: runSteadyMissingTrialScenarios,
        clearOverlay: clearSteadyOverlay,
    } = useSimulation({
        pilotId: WE1_PRIMARY_PILOT_ID,
        scenarios: MAINLINE_SCENARIOS,
    })
    const [cascadeValves, setCascadeValves] = useState(true)
    const [positionPreview, setPositionPreview] = useState<PositionPreviewResult | null>(null)
    const [isPreviewing, setIsPreviewing] = useState(false)

    // å·²é«˜äº®çš„ marker åŽŸå§‹ contentï¼Œç”¨äºŽæ¢å¤?    const highlightedMarkersRef = useRef<Map<string, string>>(new Map())

    // Refs â€?è§£å†³é—­åŒ…é™ˆæ—§å¼•ç”¨
    const nodesRef = useRef<TopoNode[]>([])
    const edgesRef = useRef<TopoEdge[]>([])
    const modeRef = useRef<EditMode>('view')
    const ptRef = useRef<PointType>('station')
    const cfRef = useRef<string | null>(null)

    useEffect(() => { nodesRef.current = topoNodes; edgesRef.current = topoEdges }, [topoNodes, topoEdges])
    useEffect(() => { modeRef.current = editMode; ptRef.current = pointType }, [editMode, pointType])
    useEffect(() => { cfRef.current = connectFrom }, [connectFrom])

    // ================== æ”¶é›†å…¨éƒ¨ç®¡çº¿åŽŸå§‹æ•°æ®ï¼ˆä¸ä¼ ç»™ MapViewï¼Œä»…ä¾›å¯¼å…¥ç”¨ï¼?==================
    const rawPipelineData = useMemo(() => {
        const { nodes, lines } = buildPipelineDataFromPackages(pipelines)
        return { nodes, lines }
    }, [pipelines])

    const clearRenderedTopology = useCallback(() => {
        nodesRef.current.forEach(node => node.marker?.setMap(null))
        edgesRef.current.forEach(edge => edge.poly?.setMap(null))
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
                setStatusMsg('å·²æ’¤é”€æœªä¿å­˜çš„ç‚¹ä½ä¿®æ”¹')
            })
            .catch(error => {
                console.error(error)
                setStatusMsg('æ’¤é”€æœªä¿å­˜ä¿®æ”¹å¤±è´?)
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
            console.error('[MapTopologyView] æž¢çº½ç»„åŠ è½½å¤±è´?', error)
            setStatusMsg(error instanceof Error ? `åŠ è½½æž¢çº½ç»„å¤±è´¥ï¼š${error.message}` : 'åŠ è½½æž¢çº½ç»„å¤±è´?)
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
    const selectedMergeNodes = useM…25653 tokens truncated… font-semibold ${steadyComparison.summary_delta.total_supply.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{formatSignedNumber(steadyComparison.summary_delta.total_supply.delta, 2)}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">????</div><div className={`mt-1 font-semibold ${steadyComparison.summary_delta.total_demand.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{formatSignedNumber(steadyComparison.summary_delta.total_demand.delta, 2)}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">?????</div><div className={`mt-1 font-semibold ${steadyComparison.summary_delta.avg_utilization.delta > 0 ? 'text-amber-300' : 'text-cyan-200'}`}>{formatSignedNumber(steadyComparison.summary_delta.avg_utilization.delta, 3)}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">????</div><div className={`mt-1 font-semibold ${steadyComparison.summary_delta.alert_count.delta > 0 ? 'text-red-300' : 'text-emerald-300'}`}>{formatSignedNumber(steadyComparison.summary_delta.alert_count.delta, 0)}</div></div></div></>}
                                </div>
                                <div className="rounded-lg border border-amber-500/20 bg-amber-950/10 p-3 space-y-3 text-[11px] text-gray-300"><div><div className="text-[10px] uppercase tracking-wider text-amber-200">?????</div><div className="mt-1 text-gray-400">??????????????????????????????????</div></div><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">?????</div><div className="mt-1 font-semibold text-emerald-300">{trialCoverageSummary.coveredCount}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">?????</div><div className="mt-1 font-semibold text-amber-300">{trialCoverageSummary.pendingCount}</div></div></div><button onClick={async () => { try { await runSteadyMissingTrialScenarios(); setStatusMsg('???????????????????????????') } catch (error) { setStatusMsg(error instanceof Error ? error.message : '??????') } }} disabled={steadyBulkTrialRunActive || steadyTrialRunItems.length === 0 || trialCoverageSummary.pendingCount === 0} className="w-full rounded-lg bg-amber-700/80 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">{steadyBulkTrialRunActive ? '?????...' : '???????'}</button><div className="space-y-2">{steadyTrialRunItems.map(item => { const isRunning = steadyTrialRunScenarioId === item.scenario_id; return <div key={`trial-item-${item.scenario_id}`} className="rounded-lg bg-black/15 px-3 py-2"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-gray-100">{item.label}</div><div className="mt-1 text-[10px] text-gray-500">{item.covered ? `?????? ${item.snapshot_count} ?` : '????'}</div><div className="mt-1 text-[10px] text-gray-500">?????{item.last_saved_at ? formatDateTimeLabel(item.last_saved_at) : '?'}</div></div><button onClick={async () => { try { await runSteadyTrialScenario(item.scenario_id); setStatusMsg(`???????${item.label}`) } catch (error) { setStatusMsg(error instanceof Error ? error.message : '???????') } }} disabled={isRunning || steadyBulkTrialRunActive} className={`rounded-lg px-3 py-1 text-[10px] font-semibold ${item.covered ? 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-100' : 'border border-amber-400/20 bg-amber-500/10 text-amber-100'} disabled:opacity-40`}>{isRunning ? '???...' : item.covered ? '??' : '??'}</button></div></div> })}</div></div>
                                <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3 space-y-3 text-[11px] text-gray-300"><div className="flex items-center justify-between gap-3"><div><div className="text-[10px] uppercase tracking-wider text-emerald-200">??????</div><div className="mt-1 text-gray-400">????????????????????????????????</div></div><div className={`rounded-full px-3 py-1 text-[10px] font-semibold ${coverageResultSummary.readinessLabel === '?????' ? 'border border-emerald-400/30 bg-emerald-500/15 text-emerald-100' : coverageResultSummary.readinessLabel === '?????' ? 'border border-amber-400/30 bg-amber-500/15 text-amber-100' : 'border border-red-400/30 bg-red-500/15 text-red-100'}`}>{coverageResultSummary.readinessLabel}</div></div><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">??????</div><div className={`mt-1 font-semibold ${coverageResultSummary.currentScenarioCovered ? 'text-emerald-300' : 'text-amber-300'}`}>{coverageResultSummary.currentScenarioCovered ? `??? ${coverageResultSummary.currentScenarioSnapshotCount} ?` : '????'}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">??????</div><div className="mt-1 font-semibold text-white">{coverageResultSummary.latestCoverageTime ? formatDateTimeLabel(coverageResultSummary.latestCoverageTime) : '??'}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">??????</div><div className="mt-1 font-semibold text-white">{coverageResultSummary.matchedNodeText}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">??????</div><div className="mt-1 font-semibold text-white">{coverageResultSummary.matchedEdgeText}</div></div></div><div className="rounded-lg bg-black/15 px-3 py-2 leading-5 text-gray-300"><div>?????{recommendedCoverageScenario?.label ?? '??'}</div><div>?????{coverageResultSummary.riskSummary}</div></div><div className="space-y-2">{coverageChecklistItems.map(item => <div key={`coverage-check-${item.scenario_id}`} className="rounded-lg bg-black/15 px-3 py-2"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-gray-100">{item.label}</span>{item.isCurrent && <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-100">????</span>}{item.isRecommended && <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100">????</span>}</div><div className="mt-1 text-[10px] leading-5 text-gray-400">????{item.focus}</div><div className="text-[10px] leading-5 text-gray-500">??????{item.success}</div><div className="text-[10px] leading-5 text-gray-500">?????{item.risk}</div></div><div className={`rounded-full px-2 py-1 text-[10px] font-semibold ${item.covered ? 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-100' : 'border border-amber-400/20 bg-amber-500/10 text-amber-100'}`}>{item.covered ? '???' : '???'}</div></div><div className="mt-2 text-[10px] leading-5 text-gray-500">?? {item.snapshot_count} ???????{item.last_saved_at ? formatDateTimeLabel(item.last_saved_at) : '?'}</div></div>)}</div></div>
                                <div className="rounded-lg border border-sky-500/20 bg-sky-950/10 p-3 space-y-3 text-[11px] text-gray-300"><div><div className="text-[10px] uppercase tracking-wider text-sky-200">??????</div><div className="mt-1 text-gray-400">???????????????????????</div></div><div className="rounded-lg bg-black/15 px-3 py-2 leading-5"><div>?????{recommendedCoverageScenario?.label ?? '????'}</div><div>?????{coverageChecklistItems.find(item => item.isRecommended)?.talk ?? '???????????????'}</div></div><div className="space-y-2">{demoGuideSteps.map((step, index) => <div key={`demo-step-${index}`} className="rounded-lg bg-black/15 px-3 py-2 leading-5 text-gray-300">{step}</div>)}</div><div className="grid grid-cols-1 gap-2"><div className="rounded-lg bg-black/15 px-3 py-2 leading-5">???????????????????????????????????????</div><div className="rounded-lg bg-black/15 px-3 py-2 leading-5">???????{failureInvestigationLayerLabel}</div></div></div>
                            </div>
                        )}
                        {activeTab === 'centrality' && (
                            <div className="space-y-2">
                                {centralityData.length === 0 ? (
                                    <div className="text-center py-6">
                                        <span className="material-symbols-outlined text-4xl text-gray-600">stars</span>
                                        <p className="text-gray-500 text-xs mt-2">ç‚¹å‡»é¡¶æ ã€Œå…³é”®èŠ‚ç‚¹ã€è®¡ç®?/p>
                                        <p className="text-gray-600 text-[10px] mt-1">åŸºäºŽä»‹æ•°ä¸­å¿ƒæ€§ç®—æ³?/p>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-[10px] text-gray-500">ä»‹æ•°ä¸­å¿ƒæ€?Top {centralityData.length}</p>
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

                    {/* çŠ¶æ€æ  */}
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
                                <p className="text-[11px] text-gray-400 mt-0.5">èŠ‚ç‚¹è¯¦æƒ…</p>
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
                                <p className="text-xs text-gray-400 mt-2">ç±»åž‹ï¼š{selectedNode.isJunction ? 'æž¢çº½' : TOPO_LABELS[selectedNode.type]}</p>
                                <p className="text-xs text-gray-400 mt-1">
                                    åæ ‡ï¼š{selectedNode.position[0].toFixed(4)}, {selectedNode.position[1].toFixed(4)}
                                </p>
                                <p className="text-xs text-gray-400 mt-1">
                                    å…³è”è¿žçº¿ï¼š{topoEdges.filter(edge => edge.startNodeId === selectedNode.id || edge.endNodeId === selectedNode.id).length}
                                </p>
                            </div>

                            {selectedNode.isJunction ? (
                                <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 space-y-3">
                                    <div>
                                        <p className="text-xs text-purple-300 uppercase tracking-wider">åº•å±‚ç«™ç‚¹</p>
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
                                            <span>æ¥æº</span>
                                            <span className="text-[10px] text-gray-400">
                                                {selectedJunctionGroup && isRuntimeReadonlyGroup(selectedJunctionGroup)
                                                    ? 'è¿è¡Œæ—¶é‡ç¼?
                                                    : 'æ‰‹å·¥æåˆè¦†ç›–'}
                                            </span>
                                        </div>
                                        {selectedNode.junctionKind && (
                                            <div className="flex items-center justify-between gap-3">
                                                <span>æž¢çº½ç±»åž‹</span>
                                                <span className="text-[10px] text-gray-400">{selectedNode.junctionKind}</span>
                                            </div>
                                        )}
                                    </div>
                                    {!manualJunctionEditingEnabled && (
                                        <div className="rounded-lg border border-sky-500/20 bg-sky-950/20 px-3 py-2.5 text-xs text-gray-300 leading-5">
                                            å½“å‰æž¢çº½æ¥è‡ªè¿è¡Œæ—¶é‡ç¼–å½±å­è¡¨ï¼Œç»§ç»­ä½œä¸ºæ‹“æ‰‘æž¢çº½å‚ä¸Žå±•ç¤ºå’Œè®¡ç®—ï¼Œä½†è¿™é‡Œä¸å†æŠŠæ‰‹å·¥æ‹†åˆ†å½“ä¸»æµç¨‹ã€?                                        </div>
                                    )}
                                    <button
                                        onClick={() => setHistoryChartTarget({
                                            junctionId: selectedNode.junctionId ? `JUNCTION-${selectedNode.junctionId}` : selectedNode.id,
                                            displayName: selectedNode.name,
                                        })}
                                        className="w-full bg-blue-700/80 hover:bg-blue-600 text-white py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-sm">show_chart</span>æŸ¥çœ‹æž¢çº½åŽ†å²
                                    </button>
                                    {canDeleteSelectedJunction && selectedJunctionGroup && (
                                        <button
                                            onClick={() => void handleDeleteManualJunction(selectedJunctionGroup)}
                                            disabled={deletingJunctionId === selectedJunctionGroup.id}
                                            className="w-full bg-red-900/60 hover:bg-red-800 text-red-200 py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1 disabled:opacity-40"
                                        >
                                            <span className="material-symbols-outlined text-sm">account_tree_off</span>
                                            {deletingJunctionId === selectedJunctionGroup.id ? 'æ‹†åˆ†ä¸?..' : 'æ‹†åˆ†è¿™ä¸ªæ‰‹å·¥æåˆ'}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="rounded-lg border border-gray-700/40 bg-white/5 p-3">
                                    <p className="text-xs text-gray-300 leading-5">
                                        è¿™é‡Œä¿ç•™ç«™ç‚¹æŸ¥çœ‹å’Œç‚¹ä½ç¼–è¾‘ã€‚æž¢çº½å…³ç³»ç”±åŽå°æŒ‰äº¤æ±‡è§„åˆ™è¿è¡Œæ—¶ç”Ÿæˆï¼Œä¸å†åœ¨è¿™ä¸ªé¢æ¿é‡Œæ‰‹å·¥æåˆã€?                                    </p>
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

ÎÞ·¨ÉèÖÃÊôÐÔ¡£´ËÓïÑÔÄ£Ê½½öÖ§³ÖºËÐÄÀàÐÍµÄÊôÐÔÉèÖÃ¡£
ËùÔÚÎ»ÖÃ ÐÐ:1 ×Ö·û: 1
+ [Console]::OutputEncoding=[System.Text.Encoding]::UTF8;
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : InvalidOperation: (:) []£¬RuntimeException
    + FullyQualifiedErrorId : PropertySetterNotSupportedInConstrainedLanguage
 
