/**
 * 鍦板浘鎷撴墤绠＄悊瑙嗗浘锛堢嫭绔嬮〉闈級
 *
 * 鍙樉绀虹函鎷撴墤灞傦紙绠€娲佸渾鐐?+ 鐩寸嚎锛夛紝闅愯棌鎵€鏈夌珯鍦?闃€瀹ょ殑澶嶆潅鍥惧舰銆? * 鐙珛浜庡叏鍥界缃戠粺涓€瑙嗗浘鍜?Canvas 鎷撴墤瑙嗗浘銆? */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
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
import { clearSimulationShowcaseSyncContext, writeSimulationShowcaseSyncContext } from '@/utils/simulationShowcaseSync'
import { setAssistantRuntimeContext } from '@/components/ai-assistant/runtimeAssistantContext'
import { MAINLINE_SCENARIOS } from '@/types/simulation'

// ================== 绫诲瀷 ==================
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

function estimateTemperatureByPressure(pressureMpa: number): number {
    return Number((13 + pressureMpa * 1.7).toFixed(1))
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0
    if (value <= 0) return 0
    if (value >= 1) return 1
    return value
}

function formatSignedNumber(value: number, digits = 2): string {
    const sign = value > 0 ? '+' : ''
    return `${sign}${value.toFixed(digits)}`
}

function buildOpsSuggestion(alertCount: number, avgUtilization: number, solverStatus: 'converged' | 'max_iter' | 'error'): string {
    if (solverStatus === 'error') return '鏈姹傝В澶辫触锛屽厛妫€鏌ュ満鏅弬鏁板拰杈圭晫鏉′欢锛屽啀閲嶈窇涓讳豢鐪熴€?
    if (solverStatus === 'max_iter') return '鏈杈惧埌杩唬涓婇檺锛屽缓璁厛缂╁皬鎵板姩骞呭害骞舵牳瀵瑰熀绾垮揩鐓с€?
    if (alertCount >= 5) return '鍛婅鍋忓锛屼紭鍏堟帓鏌ヤ富骞查珮璐熻嵎娈靛拰鍘嬫皵绔欎笂涓嬫父鍘嬪樊銆?
    if (avgUtilization >= 0.82) return '鍒╃敤鐜囧亸楂橈紝寤鸿鍏堝仛闄愭祦鍦烘櫙瀵规瘮骞跺噯澶囪皟宄扮瓥鐣ャ€?
    return '杩愯鐘舵€佸钩绋筹紝鍙皢褰撳墠缁撴灉浣滀负涓嬩竴杞紓甯稿満鏅姣斿熀绾裤€?
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

const SOLVER_STATUS_LABELS: Record<'converged' | 'max_iter' | 'error', string> = {
    converged: '宸叉敹鏁?,
    max_iter: '杈惧埌杩唬涓婇檺',
    error: '姹傝В澶辫触',
}

const FAILURE_LAYER_LABELS: Record<'frontend-consumption' | 'mapping-source-ids' | 'overlay-contract' | 'rendering-style', string> = {
    'frontend-consumption': '鍏堟煡鍓嶇娑堣垂灞傦紙MapTopologyView / 闈㈡澘锛?,
    'mapping-source-ids': '鍐嶆煡 source IDs 鍒?overlay IDs 鐨勬槧灏?,
    'overlay-contract': '鍐嶆煡 simulation-overlay 濂戠害',
    'rendering-style': '鏈€鍚庡啀鏌ュ湴鍥炬牱寮忓拰娓叉煋瀵硅薄',
}

const MAINLINE_SCENARIO_PLAYBOOK: Record<string, {
    focus: string
    success: string
    risk: string
    talk: string
}> = {
    steady_base: {
        focus: '鍏堢湅涓诲共鍘嬪姏鍜屾祦閲忔槸涓嶆槸骞抽『锛岀‘璁ょ涓€寮犲浘鑳界ǔ瀹氳窇閫氥€?,
        success: '鎬讳緵缁欍€佹€婚渶姹傘€佸钩鍧囧埄鐢ㄧ巼閮借兘姝ｅ父钀藉嚭鏉ワ紝鍛婅鏁颁笉瑕佺獊鐒跺崌楂樸€?,
        risk: '濡傛灉甯歌绋虫€侀兘娌℃湁缁撴灉锛屽悗闈㈢殑寮傚父鍦烘櫙鍏堝埆璁诧紝鍏堟妸姝ｅ紡浠跨湡璺戦€氥€?,
        talk: '鍏堢敤甯歌绋虫€佹妸涓婚摼鎵撻€氾紝璇佹槑鎷撴墤銆佺ǔ鎬佹眰瑙ｅ拰椤甸潰閮藉凡缁忚繛涓娿€?,
    },
    zhongwei_compressor_offline: {
        focus: '閲嶇偣鐪嬩腑鍗帇姘旂珯鍋滆繍鍚庯紝涓婁笅娓稿帇鍔涙湁娌℃湁鏄庢樉鎺夎惤銆?,
        success: '鍩虹嚎瀵规瘮閲岃兘鐪嬪嚭鑺傜偣鍘嬪樊锛屽懡涓妭鐐瑰拰鍛婅鏁颁細姣斿父瑙勭ǔ鎬佹洿鏄庢樉銆?,
        risk: '濡傛灉娌￠€夊熀绾垮揩鐓э紝杩欎釜鍦烘櫙鍙兘鐪嬪埌褰撳墠鍊硷紝鐪嬩笉鍑哄仠杩愬墠鍚庡樊寮傘€?,
        talk: '杩欎竴骞曚富瑕佽鍘嬫皵绔欏紓甯稿悗锛屼富骞插帇鍔涙槸鎬庝箞寰€涓婁笅娓镐紶閫掔殑銆?,
    },
    zhongwei_trunk_break: {
        focus: '閲嶇偣鐪嬩腑鍗檮杩戜富骞蹭腑鏂悗锛岃繛绾挎祦閲忓拰涓嬫父渚涚粰鎬庝箞鍙樺寲銆?,
        success: '鍩虹嚎瀵规瘮閲岀殑杩炵嚎娴侀噺鍙樺寲浼氬緢绐佸嚭锛屼笅娓稿懡涓偣绾垮拰鍛婅浼氫竴璧锋姮澶淬€?,
        risk: '濡傛灉鏄犲皠瑕嗙洊鎽樿閲屽懡涓笉瓒筹紝杩欎釜鍦烘櫙浼氱湅涓嶆竻妤氭柇鐐瑰奖鍝嶅厛浼犲埌鍝€?,
        talk: '杩欎竴骞曡涓诲共鏁呴殰浼犳挱锛屾渶閫傚悎鎷挎潵婕旂ず绗竴寮犲浘鐨勬牳蹇冧环鍊笺€?,
    },
    yanchi_jingbian_limited: {
        focus: '閲嶇偣鐪嬬洂姹犲埌闈栬竟闄愭祦鍚庯紝鍒╃敤鐜囧拰鍏抽敭娈佃礋杞芥湁娌℃湁鎶崌銆?,
        success: '杩愯缁撴灉鎽樿閲屽钩鍧囧埄鐢ㄧ巼浼氬彉鍖栵紝杩炵嚎璇︽儏閲岀殑鍒╃敤鐜囧樊鍊艰兘鐪嬪嚭鏉ャ€?,
        risk: '濡傛灉褰撳墠鍦烘櫙娌＄暀蹇収锛屽彧闈犱竴娆¤繍琛岀粨鏋滐紝涓嶉€傚悎鎷挎潵鍋氱ǔ瀹氶獙鏀躲€?,
        talk: '杩欎竴骞曡闄愭祦锛屼笉鏄柇杈擄紝鑰屾槸涓诲共杩樿兘璺戜絾杩愯杈圭晫寮€濮嬪彉绱с€?,
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

// ================== 鎷撴墤鏍峰紡锛堟瀬绠€鍦嗙偣 + 棰滆壊鍖哄垎锛?==================
const TOPO_COLORS: Record<PointType, string> = {
    compressor: '#FF9800',
    distribution: '#2196F3',
    junction: '#00e5ff',
    station: '#F44336',
    valve: '#9E9E9E',
}

const TOPO_LABELS: Record<PointType, string> = {
    compressor: '鍘嬫皵绔?,
    distribution: '鍒嗚緭绔?,
    junction: '浜ゆ眹鏋㈢航',
    station: '绔欏満',
    valve: '闃€瀹?,
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
const JUNCTION_READONLY_HINT = '褰撳墠鏋㈢航鐢辫繍琛屾椂閲嶇紪缁撴灉缁存姢锛岀紪杈戝櫒浠呮敮鎸佸彧璇绘煡鐪嬶紝涓嶅啀浠ユ墜宸ユ崗鍚堜綔涓轰富娴佺▼銆?
const JUNCTION_MODE_LABELS: Record<string, string> = {
    runtime_readonly: '鍙妯″紡',
    legacy_editable: '鏃ф祦绋嬪吋瀹?,
}

const LINE_COLOR = '#34d399'
const LINE_WEIGHT = 2

/** 浠?PipelineNode.type (NodeType 鏋氫妇鍊硷紝鍧囦负灏忓啓) 鏄犲皠鍒扮紪杈戝櫒 PointType */
const TYPE_MAP: Record<string, PointType> = {
    regulator: 'compressor',
    metering: 'distribution',
    valve: 'valve',
    junction: 'junction',
    // NOTE: sj4 绛夋柊鏁版嵁鏂囦欢鐩存帴浣跨敤 compressor/distribution 绛夊€?    compressor: 'compressor',
    distribution: 'distribution',
}

// ================== 鍒涘缓绾嫇鎵戝渾鐐规爣璁?==================
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

// ================== 涓荤粍浠?==================
const MapTopologyView: React.FC = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const [mapInstance, setMapInstance] = useState<any>(null)
    const handleMapLoad = useCallback((map: any) => setMapInstance(map), [])
    const importedOnceRef = useRef(false)
    const appliedFocusNodeRef = useRef<string | null>(null)

    // 绠＄嚎鏁版嵁寮傛鍔犺浇
    const [pipelines, setPipelines] = useState<PipelinePackage[]>([])
    useEffect(() => {
        loadAllPipelines()
            .then(data => setPipelines(data))
            .catch(err => console.error('[MapTopologyView] 绠＄嚎鏁版嵁鍔犺浇澶辫触:', err))
    }, [])

    // 缂栬緫鍣ㄧ姸鎬?    const [baseTopoNodes, setBaseTopoNodes] = useState<BaseTopoNode[]>([])
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
    const [statusMsg, setStatusMsg] = useState('鐐瑰嚮銆屽鍏ユ嫇鎵戙€嶅姞杞藉凡鏈夌绾?)
    const [selectedMergeNodeIds, setSelectedMergeNodeIds] = useState<string[]>([])
    const [mergeJunctionName, setMergeJunctionName] = useState('')
    const [mergeJunctionDescription, setMergeJunctionDescription] = useState('')
    const [isMerging, setIsMerging] = useState(false)
    const [deletingJunctionId, setDeletingJunctionId] = useState<number | null>(null)
    const [activeTab, setActiveTab] = useState<PanelTab>('simulation')
    const activeTabRef = useRef<PanelTab>(activeTab)

    // Tooltip 鎮诞妗嗙姸鎬?    const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
    const [tooltipPos, setTooltipPos] = useState<{ x: number, y: number } | null>(null)
    const hoveredRawEdge = useMemo(() => {
        if (!hoveredEdgeId) return null;
        const e = topoEdges.find(edge => edge.id === hoveredEdgeId);
        if (!e) return null;
        for (const p of pipelines) {
            const l = p.lines.find(x => x.startNodeId === e.startNodeId || e.sourceEdgeIds?.includes(x.id));
            if (l) {
                return {
                    name: e.name || l.name,
                    flowRate: l.flowRate,
                    currentPressure: l.currentPressure,
                    pressureLevel: l.pressureLevel,
                    startNodeId: e.startNodeId
                }
            }
        }
        return e;
    }, [hoveredEdgeId, topoEdges, pipelines])

    useEffect(() => {
        activeTabRef.current = activeTab
        if (activeTab !== 'edit') {
            setEditMode('view')
            setConnectFrom(null)
        }
    }, [activeTab])
    const [searchText, setSearchText] = useState('')
    const [report, setReport] = useState<ValidationReport | null>(null)
    const [centralityData, setCentralityData] = useState<Array<{ id: string; name: string; value: number }>>([])

    const [selectedNode, setSelectedNode] = useState<TopoNode | null>(null)
    const [historyChartTarget, setHistoryChartTarget] = useState<null | {
        stationName?: string
        junctionId?: string
        displayName?: string
    }>(null)

    // 鎾ら攢鏍?    type UndoAction =
        | { type: 'add-node'; nodeId: string }
        | { type: 'add-edge'; edgeId: string }
        | { type: 'create-junction'; junctionId: number; name: string }
        | { type: 'delete-junction'; group: JunctionGroup }
    const [undoStack, setUndoStack] = useState<UndoAction[]>([])

    // 鎴柇浠跨湡鐘舵€?    const [cutoffNodeId, setCutoffNodeId] = useState<string | null>(null)
    const [cutoffResult, setCutoffResult] = useState<CutoffResult | null>(null)
    const [cutoffSearch, setCutoffSearch] = useState('')

    // 淇濆瓨鏈哄埗锛氳窡韪嫋鎷戒慨鏀圭殑鍧愭爣
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
    const [lineFlowPhase, setLineFlowPhase] = useState(0)
    const [damageFlashVisible, setDamageFlashVisible] = useState(false)
    const [isMapInteracting, setIsMapInteracting] = useState(false)
    const [renderSafetyMode, setRenderSafetyMode] = useState<'full' | 'lite'>('full')

    // 宸查珮浜殑 marker 鍘熷 content锛岀敤浜庢仮澶?    const highlightedMarkersRef = useRef<Map<string, string>>(new Map())
    const lastNodeContentRef = useRef<Map<string, string>>(new Map())
    const lastEdgeOptionsRef = useRef<Map<string, string>>(new Map())

    // Refs 鈥?瑙ｅ喅闂寘闄堟棫寮曠敤
    const nodesRef = useRef<TopoNode[]>([])
    const edgesRef = useRef<TopoEdge[]>([])
    const modeRef = useRef<EditMode>('view')
    const ptRef = useRef<PointType>('station')
    const cfRef = useRef<string | null>(null)

    useEffect(() => { nodesRef.current = topoNodes; edgesRef.current = topoEdges }, [topoNodes, topoEdges])
    useEffect(() => { modeRef.current = editMode; ptRef.current = pointType }, [editMode, pointType])
    useEffect(() => { cfRef.current = connectFrom }, [connectFrom])
    useEffect(() => {
        if (steadyOverlay) {
            setStatusMsg(`姝ｅ紡浠跨湡宸插垏鍒?${steadyOverlay.scenario_id}锛宺un_id=${steadyOverlay.run_id.slice(0, 12)}`)
        }
    }, [steadyOverlay])
    useEffect(() => {
        if (steadySimError) {
            setStatusMsg(`姝ｅ紡浠跨湡澶辫触锛?{steadySimError}`)
        }
    }, [steadySimError])

    // ================== 鏀堕泦鍏ㄩ儴绠＄嚎鍘熷鏁版嵁锛堜笉浼犵粰 MapView锛屼粎渚涘鍏ョ敤锛?==================
    useEffect(() => {
        if (!steadyOverlay && !steadySelectedSnapshotRunId) {
            clearSimulationShowcaseSyncContext()
            return
        }

        writeSimulationShowcaseSyncContext({
            source: 'map-topology',
            pilotId: WE1_PRIMARY_PILOT_ID,
            scenarioId: steadyOverlay?.scenario_id ?? steadyScenarioId,
            selectedSnapshotRunId: steadySelectedSnapshotRunId,
            baselineSnapshotRunId: steadyBaselineSnapshotRunId,
            overlay: steadyOv…34842 tokens truncated…                                <button onClick={applyRecommendedScenarioQuickSwitch} disabled={!recommendedCoverageScenario} className="rounded-lg border border-emerald-500/30 bg-emerald-900/10 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40">
                                                涓€閿垏鍒版帹鑽愬満鏅細{recommendedCoverageScenario?.label ?? '鏆傛棤'}
                                            </button>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button onClick={applySelectedSnapshotAsBaseline} disabled={!steadySelectedSnapshotRunId} className="rounded-lg border border-violet-500/30 bg-violet-900/10 px-3 py-2 text-xs text-violet-100 disabled:opacity-40">褰撳墠蹇収璁惧熀绾?/button>
                                                <button onClick={applyLatestCoveredSnapshotAsBaseline} disabled={!latestCoveredSnapshotSummary} className="rounded-lg border border-sky-500/30 bg-sky-900/10 px-3 py-2 text-xs text-sky-100 disabled:opacity-40">鏈€杩戠暀妗ｈ鍩虹嚎</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button onClick={async () => { try { await runSteadySimulation(); setStatusMsg(`WE1 涓讳豢鐪熷凡杩愯锛?{steadyScenarioOption?.label ?? steadyScenarioId}`) } catch (error) { setStatusMsg(error instanceof Error ? error.message : 'WE1 涓讳豢鐪熻繍琛屽け璐?) } }} disabled={steadySimLoading} className="rounded-lg bg-cyan-700/80 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">{steadySimLoading ? '杩愯涓?..' : '杩愯涓讳豢鐪?}</button>
                                        <button onClick={async () => { try { await saveSteadySnapshot(); setStatusMsg(`宸蹭繚瀛樺揩鐓э細${steadyScenarioOption?.label ?? steadyScenarioId}`) } catch (error) { setStatusMsg(error instanceof Error ? error.message : '淇濆瓨蹇収澶辫触') } }} disabled={!steadyOverlay || steadySnapshotLoading} className="rounded-lg border border-sky-500/30 bg-sky-900/20 px-3 py-2 text-xs font-medium text-sky-100 disabled:opacity-40">{steadySnapshotLoading ? '淇濆瓨涓?..' : '淇濆瓨蹇収'}</button>
                                        <button onClick={async () => { try { await refreshSteadySnapshots(); setStatusMsg('蹇収鍒楄〃宸插埛鏂?) } catch (error) { setStatusMsg(error instanceof Error ? error.message : '鍒锋柊蹇収澶辫触') } }} disabled={steadySnapshotLoading || steadyBaselineSnapshotLoading} className="rounded-lg border border-slate-600 bg-slate-800/70 px-3 py-2 text-xs font-medium text-slate-200 disabled:opacity-40">鍒锋柊蹇収</button>
                                        <button onClick={() => { clearSteadyOverlay(); clearSimulationShowcaseSyncContext(); setStatusMsg('宸叉竻绌哄綋鍓嶄富浠跨湡缁撴灉') }} className="rounded-lg border border-slate-600 bg-slate-800/70 px-3 py-2 text-xs font-medium text-slate-200">娓呯┖涓讳豢鐪?/button>
                                        <button onClick={copySimulationNarrative} className="col-span-2 rounded-lg border border-cyan-400/30 bg-cyan-950/30 px-3 py-2 text-xs font-medium text-cyan-100">澶嶅埗浠跨湡鏂囧瓧绠€鎶ワ紙绗?娆¤凯浠ｏ級</button>
                                        <button onClick={copySimulationStructuredBrief} className="col-span-2 rounded-lg border border-violet-400/30 bg-violet-950/30 px-3 py-2 text-xs font-medium text-violet-100">澶嶅埗缁撴瀯鍖栫畝鎶ワ紙缁橝I锛?/button>
                                        <button onClick={exportSimulationReport} className="col-span-2 rounded-lg border border-emerald-500/30 bg-emerald-900/20 px-3 py-2 text-xs font-medium text-emerald-100">瀵煎嚭婕旂ず娓呭崟</button>
                                    </div>
                                    <div className="rounded-lg border border-cyan-500/20 bg-black/10 px-3 py-2">
                                        <div className="text-[10px] uppercase tracking-wider text-cyan-200">浠跨湡鑷姩瑙ｈ锛堝彲缁?AI锛?/div>
                                        <div className="mt-1 text-[11px] text-slate-300 whitespace-pre-line leading-5">{simulationNarrative}</div>
                                    </div>
                                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 px-3 py-2">
                                        <div className="text-[10px] uppercase tracking-wider text-emerald-200">浜鸿瘽瑙ｉ噴锛堝€肩彮鍙锛?/div>
                                        <div className="mt-1 text-[11px] text-slate-300 whitespace-pre-line leading-5">{simulationNarrativePlain}</div>
                                    </div>
                                </div>
                                {(steadySimError || steadySnapshotError) && <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-[11px] text-red-200">{steadySimError || steadySnapshotError}</div>}
                            </div>
                        )}
                        {activeTab === 'centrality' && (
                            <div className="space-y-2">
                                {centralityData.length === 0 ? (
                                    <div className="text-center py-6">
                                        <span className="material-symbols-outlined text-4xl text-gray-600">stars</span>
                                        <p className="text-gray-500 text-xs mt-2">鐐瑰嚮椤舵爮銆屽叧閿妭鐐广€嶈绠?/p>
                                        <p className="text-gray-600 text-[10px] mt-1">鍩轰簬浠嬫暟涓績鎬х畻娉?/p>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-[10px] text-gray-500">浠嬫暟涓績鎬?Top {centralityData.length}</p>
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

                    {/* 鐘舵€佹爮 */}
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
                                <p className="text-[11px] text-gray-400 mt-0.5">鑺傜偣璇︽儏</p>
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
                                <p className="text-xs text-gray-400 mt-2">绫诲瀷锛歿selectedNode.isJunction ? '鏋㈢航' : TOPO_LABELS[selectedNode.type]}</p>
                                <p className="text-xs text-gray-400 mt-1">
                                    鍧愭爣锛歿selectedNode.position[0].toFixed(4)}, {selectedNode.position[1].toFixed(4)}
                                </p>
                                <p className="text-xs text-gray-400 mt-1">
                                    鍏宠仈杩炵嚎锛歿topoEdges.filter(edge => edge.startNodeId === selectedNode.id || edge.endNodeId === selectedNode.id).length}
                                </p>
                            </div>
                            <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-3 space-y-2">
                                <p className="text-xs text-emerald-300 uppercase tracking-wider">浠跨湡鐘舵€?/p>
                                <div className="flex items-center justify-between gap-3 text-xs">
                                    <span className="text-gray-400">褰撳墠鍘嬪姏</span>
                                    <span className="text-emerald-100 font-medium">
                                        {selectedNodeSimulationMetrics?.pressure != null
                                            ? `${selectedNodeSimulationMetrics.pressure.toFixed(2)} MPa`
                                            : '鏈繍琛屼豢鐪?}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-3 text-xs">
                                    <span className="text-gray-400">褰撳墠娓╁害</span>
                                    <span className="text-emerald-100 font-medium">
                                        {selectedNodeSimulationMetrics?.temperatureC != null
                                            ? `${selectedNodeSimulationMetrics.temperatureC.toFixed(1)}掳C${selectedNodeSimulationMetrics.estimated ? '锛堜及绠楋級' : ''}`
                                            : '鏈繍琛屼豢鐪?}
                                    </span>
                                </div>
                            </div>

                            {selectedNode.isJunction ? (
                                <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 space-y-3">
                                    <div>
                                        <p className="text-xs text-purple-300 uppercase tracking-wider">搴曞眰绔欑偣</p>
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
                                            <span>鏉ユ簮</span>
                                            <span className="text-[10px] text-gray-400">
                                                {selectedJunctionGroup && isRuntimeReadonlyGroup(selectedJunctionGroup)
                                                    ? '杩愯鏃堕噸缂?
                                                    : '鎵嬪伐鎹忓悎瑕嗙洊'}
                                            </span>
                                        </div>
                                        {selectedNode.junctionKind && (
                                            <div className="flex items-center justify-between gap-3">
                                                <span>鏋㈢航绫诲瀷</span>
                                                <span className="text-[10px] text-gray-400">{selectedNode.junctionKind}</span>
                                            </div>
                                        )}
                                    </div>
                                    {!manualJunctionEditingEnabled && (
                                        <div className="rounded-lg border border-sky-500/20 bg-sky-950/20 px-3 py-2.5 text-xs text-gray-300 leading-5">
                                            褰撳墠鏋㈢航鏉ヨ嚜杩愯鏃堕噸缂栧奖瀛愯〃锛岀户缁綔涓烘嫇鎵戞灑绾藉弬涓庡睍绀哄拰璁＄畻锛屼絾杩欓噷涓嶅啀鎶婃墜宸ユ媶鍒嗗綋涓绘祦绋嬨€?                                        </div>
                                    )}
                                    <button
                                        onClick={() => setHistoryChartTarget({
                                            junctionId: selectedNode.junctionId ? `JUNCTION-${selectedNode.junctionId}` : selectedNode.id,
                                            displayName: selectedNode.name,
                                        })}
                                        className="w-full bg-blue-700/80 hover:bg-blue-600 text-white py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-sm">show_chart</span>鏌ョ湅鏋㈢航鍘嗗彶
                                    </button>
                                    {canDeleteSelectedJunction && selectedJunctionGroup && (
                                        <button
                                            onClick={() => void handleDeleteManualJunction(selectedJunctionGroup)}
                                            disabled={deletingJunctionId === selectedJunctionGroup.id}
                                            className="w-full bg-red-900/60 hover:bg-red-800 text-red-200 py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1 disabled:opacity-40"
                                        >
                                            <span className="material-symbols-outlined text-sm">account_tree_off</span>
                                            {deletingJunctionId === selectedJunctionGroup.id ? '鎷嗗垎涓?..' : '鎷嗗垎杩欎釜鎵嬪伐鎹忓悎'}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="rounded-lg border border-gray-700/40 bg-white/5 p-3">
                                    <p className="text-xs text-gray-300 leading-5">
                                        杩欓噷淇濈暀绔欑偣鏌ョ湅鍜岀偣浣嶇紪杈戙€傛灑绾藉叧绯荤敱鍚庡彴鎸変氦姹囪鍒欒繍琛屾椂鐢熸垚锛屼笉鍐嶅湪杩欎釜闈㈡澘閲屾墜宸ユ崗鍚堛€?                                    </p>
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

            {/* 绠＄嚎 Hover Tooltip */}
            {hoveredEdgeId && tooltipPos && hoveredRawEdge && (
                <div
                    className="fixed z-50 pointer-events-none bg-[#0f1722]/95 border border-cyan-500/30 rounded-lg p-3 shadow-2xl backdrop-blur-md min-w-[200px]"
                    style={{ left: tooltipPos.x + 15, top: tooltipPos.y + 15 }}
                >
                    <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                        <span className="text-white font-medium text-sm">{hoveredRawEdge.name}</span>
                    </div>
                    {hoveredRawEdge.flowRate !== undefined && (
                        <div className="flex items-center justify-between gap-4 mt-2">
                            <span className="text-gray-400 text-xs">杩愯娴侀噺浼拌</span>
                            <span className="text-cyan-300 font-mono text-sm">{hoveredRawEdge.flowRate} <span className="text-[10px] text-gray-500">涓囨柟/澶?/span></span>
                        </div>
                    )}
                    {hoveredRawEdge.currentPressure !== undefined && (
                        <div className="flex items-center justify-between gap-4 mt-1">
                            <span className="text-gray-400 text-xs">鍧囧帇鎺ㄦ紨</span>
                            <span className="text-emerald-300 font-mono text-sm">{hoveredRawEdge.currentPressure} <span className="text-[10px] text-gray-500">MPa</span></span>
                        </div>
                    )}
                    {hoveredRawEdge.flowRate === undefined && (
                        <p className="text-[10px] text-gray-500 mt-2 italic">鏆傛棤娴佷綋鍔ㄥ姏瀛﹁瀹?/p>
                    )}
                </div>
            )}
        </div>
    )
}

export default MapTopologyView

