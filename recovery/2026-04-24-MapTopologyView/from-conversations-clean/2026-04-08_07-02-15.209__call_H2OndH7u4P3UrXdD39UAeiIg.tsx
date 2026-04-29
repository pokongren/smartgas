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
        risk: '如果没选基线快照，这个场景只能看到当前值，看不出停运前后差异。',
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
        talk: '这一幕讲限流，不是断输，而是主干还能跑但运行边界开始变紧。',
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

    // 撤销栈
    type UndoAction =
        | { type: 'add-node'; nodeId: string }
        | { type: 'add-edge'; edgeId: string }
        | { type: 'create-junction'; junctionId: number; name: string }
        | { type: 'delete-junction'; group: JunctionGroup }
    const [undoStack, setUndoStack] = useState<UndoAction[]>([])

    // 截断仿真状态
    const [cutoffNodeId, setCutoffNodeId] = useState<string | null>(null)
    const [cutoffResult, setCutoffResult] = useState<CutoffResult | null>(null)
    const [cutoffSearch, setCutoffSearch] = useState('')

    // 保存机制：跟踪拖拽修改的坐标
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
    useEffect(() => {
        if (steadyOverlay) {
            setStatusMsg(`正式仿真已切到 ${steadyOverlay.scenario_id}，run_id=${steadyOverlay.run_id.slice(0, 12)}`)
        }
    }, [steadyOverlay])
    useEffect(() => {
        if (steadySimError) {
            setStatusMsg(`正式仿真失败：${steadySimError}`)
        }
    }, [steadySimError])

    // ================== 收集全部管线原始数据（不传给 MapView，仅供导入用） ==================
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

        const collapsedEdgeMap = new Map<string, To…25458 tokens truncated…t-red-300'}`}>{formatSignedNumber(steadyComparison.summary_delta.total_supply.delta, 2)}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">需求差值</div><div className={`mt-1 font-semibold ${steadyComparison.summary_delta.total_demand.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{formatSignedNumber(steadyComparison.summary_delta.total_demand.delta, 2)}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">利用率差值</div><div className={`mt-1 font-semibold ${steadyComparison.summary_delta.avg_utilization.delta > 0 ? 'text-amber-300' : 'text-cyan-200'}`}>{formatSignedNumber(steadyComparison.summary_delta.avg_utilization.delta, 3)}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">告警差值</div><div className={`mt-1 font-semibold ${steadyComparison.summary_delta.alert_count.delta > 0 ? 'text-red-300' : 'text-emerald-300'}`}>{formatSignedNumber(steadyComparison.summary_delta.alert_count.delta, 0)}</div></div></div></>}
                                </div>
                                <div className="rounded-lg border border-amber-500/20 bg-amber-950/10 p-3 space-y-3 text-[11px] text-gray-300"><div><div className="text-[10px] uppercase tracking-wider text-amber-200">试运行覆盖</div><div className="mt-1 text-gray-400">把典型场景逐个补跑并留档，方便验收时不再临场现跑。</div></div><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">已覆盖场景</div><div className="mt-1 font-semibold text-emerald-300">{trialCoverageSummary.coveredCount}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">待补跑场景</div><div className="mt-1 font-semibold text-amber-300">{trialCoverageSummary.pendingCount}</div></div></div><button onClick={async () => { try { await runSteadyMissingTrialScenarios(); setStatusMsg('已补跑所有未留档的典型场景') } catch (error) { setStatusMsg(error instanceof Error ? error.message : '批量补跑失败') } }} disabled={steadyBulkTrialRunActive || steadyTrialRunItems.length === 0 || trialCoverageSummary.pendingCount === 0} className="w-full rounded-lg bg-amber-700/80 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">{steadyBulkTrialRunActive ? '补跑中...' : '一键补跑缺失场景'}</button><div className="space-y-2">{steadyTrialRunItems.map(item => { const isRunning = steadyTrialRunScenarioId === item.scenario_id; return <div key={`trial-item-${item.scenario_id}`} className="rounded-lg bg-black/15 px-3 py-2"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-gray-100">{item.label}</div><div className="mt-1 text-[10px] text-gray-500">{item.covered ? `已留档 ${item.snapshot_count} 条` : '还没留档'}</div><div className="mt-1 text-[10px] text-gray-500">最近时间：{item.last_saved_at ? formatDateTimeLabel(item.last_saved_at) : '-'}</div></div><button onClick={async () => { try { await runSteadyTrialScenario(item.scenario_id); setStatusMsg(`已补跑场景：${item.label}`) } catch (error) { setStatusMsg(error instanceof Error ? error.message : '单场景补跑失败') } }} disabled={isRunning || steadyBulkTrialRunActive} className={`rounded-lg px-3 py-1 text-[10px] font-semibold ${item.covered ? 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-100' : 'border border-amber-400/20 bg-amber-500/10 text-amber-100'} disabled:opacity-40`}>{isRunning ? '运行中...' : item.covered ? '重跑' : '补跑'}</button></div></div> })}</div></div>
                                <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3 space-y-3 text-[11px] text-gray-300"><div className="flex items-center justify-between gap-3"><div><div className="text-[10px] uppercase tracking-wider text-emerald-200">覆盖结果清单</div><div className="mt-1 text-gray-400">这里看当前场景能不能直接讲、还缺什么、下一条建议讲哪个场景。</div></div><div className={`rounded-full px-3 py-1 text-[10px] font-semibold ${coverageResultSummary.readinessLabel === '可完整演示' ? 'border border-emerald-400/30 bg-emerald-500/15 text-emerald-100' : coverageResultSummary.readinessLabel === '可局部演示' ? 'border border-amber-400/30 bg-amber-500/15 text-amber-100' : 'border border-red-400/30 bg-red-500/15 text-red-100'}`}>{coverageResultSummary.readinessLabel}</div></div><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">当前场景留档</div><div className={`mt-1 font-semibold ${coverageResultSummary.currentScenarioCovered ? 'text-emerald-300' : 'text-amber-300'}`}>{coverageResultSummary.currentScenarioCovered ? `已留档 ${coverageResultSummary.currentScenarioSnapshotCount} 条` : '还没留档'}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">最近覆盖时间</div><div className="mt-1 font-semibold text-white">{coverageResultSummary.latestCoverageTime ? formatDateTimeLabel(coverageResultSummary.latestCoverageTime) : '暂无'}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">当前命中节点</div><div className="mt-1 font-semibold text-white">{coverageResultSummary.matchedNodeText}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">当前命中连线</div><div className="mt-1 font-semibold text-white">{coverageResultSummary.matchedEdgeText}</div></div></div><div className="rounded-lg bg-black/15 px-3 py-2 leading-5 text-gray-300"><div>建议演示：{recommendedCoverageScenario?.label ?? '暂无'}</div><div>当前判断：{coverageResultSummary.riskSummary}</div></div><div className="space-y-2">{coverageChecklistItems.map(item => <div key={`coverage-check-${item.scenario_id}`} className="rounded-lg bg-black/15 px-3 py-2"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-gray-100">{item.label}</span>{item.isCurrent && <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-100">当前场景</span>}{item.isRecommended && <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100">建议先讲</span>}</div><div className="mt-1 text-[10px] leading-5 text-gray-400">关注点：{item.focus}</div><div className="text-[10px] leading-5 text-gray-500">通过怎么看：{item.success}</div><div className="text-[10px] leading-5 text-gray-500">现场风险：{item.risk}</div></div><div className={`rounded-full px-2 py-1 text-[10px] font-semibold ${item.covered ? 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-100' : 'border border-amber-400/20 bg-amber-500/10 text-amber-100'}`}>{item.covered ? '已留档' : '待补跑'}</div></div><div className="mt-2 text-[10px] leading-5 text-gray-500">快照 {item.snapshot_count} 条，最近留档：{item.last_saved_at ? formatDateTimeLabel(item.last_saved_at) : '-'}</div></div>)}</div></div>
                                <div className="rounded-lg border border-sky-500/20 bg-sky-950/10 p-3 space-y-3 text-[11px] text-gray-300"><div><div className="text-[10px] uppercase tracking-wider text-sky-200">固定演示口径</div><div className="mt-1 text-gray-400">照着这里讲，现场就不会跳层，也不会漏掉对比和排查口径。</div></div><div className="rounded-lg bg-black/15 px-3 py-2 leading-5"><div>建议主场景：{recommendedCoverageScenario?.label ?? '暂未确定'}</div><div>讲解重点：{coverageChecklistItems.find(item => item.isRecommended)?.talk ?? '先把当前主仿真结果跑通后再定讲解口径。'}</div></div><div className="space-y-2">{demoGuideSteps.map((step, index) => <div key={`demo-step-${index}`} className="rounded-lg bg-black/15 px-3 py-2 leading-5 text-gray-300">{step}</div>)}</div><div className="grid grid-cols-1 gap-2"><div className="rounded-lg bg-black/15 px-3 py-2 leading-5">现场如果结果和地图看起来对不上，先回看“运行结果摘要”和“覆盖结果清单”，确认是不是场景没留档或映射没命中。</div><div className="rounded-lg bg-black/15 px-3 py-2 leading-5">失败先查哪层：{failureInvestigationLayerLabel}</div></div></div>
                            </div>
                        )}
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

无法设置属性。此语言模式仅支持核心类型的属性设置。
所在位置 行:1 字符: 1
+ [Console]::OutputEncoding=[System.Text.Encoding]::UTF8;
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : InvalidOperation: (:) []，RuntimeException
    + FullyQualifiedErrorId : PropertySetterNotSupportedInConstrainedLanguage
 
