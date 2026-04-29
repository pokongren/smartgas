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

function formatSnapshotOption(runId: string, scenarioId: string, savedAt: string): string {
    return `${scenarioId} | ${runId.slice(0, 12)} | ${savedAt.slice(11, 19)}`
}

function formatDateTimeLabel(value?: string): string {
    if (!value) return '-'

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value

    return date.toLocaleString('zh-CN', { hour12: false })
}

const ALERT_LEVEL_LABELS: Record<'normal' | 'warning' | 'critical', string> = {
    normal: '正常',
    warning: '预警',
    critical: '严重',
}

const SOLVER_STATUS_LABELS: Record<'converged' | 'max_iter' | 'error', string> = {
    converged: '已收敛',
    max_iter: '达到迭代上限',
    error: '求解失败',
}

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
    const [activeTab, setActiveTab] = useState<PanelTab>('edit')
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
        isLoading: steadySimLoading,
        error: steadySimError,
        currentScenario: steadyScenarioId,
        snapshots: steadySnapshots,
        snapshotLoading: steadySnapshotLoading,
        snapshotError: steadySnapshotError,
        selectedSnapshotRunId: steadySelectedSnapshotRunId,
        setScenario: setSteadyScenario,
        setSelectedSnapshotRunId: setSteadySelectedSnapshotRunId,
        runSimulation: runSteadySimulation,
        saveSnapshot: saveSteadySnapshot,
        refreshSnapshots: refreshSteadySnapshots,
        loadSelectedSnapshot: loadSteadySelectedSnapshot,
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
            setStatusMsg(`正式仿真已切到 WE1 主链：${steadyOverlay.scenario_id}，run_id=${steadyOverlay.run_id.slice(0, 12)}`)
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
        const displayNodeMap = new Map<string, TopoNode>()

        groups.forEach(group => {
            const memberNodes = nodes.filter(node => group.station_ids.includes(node.id))
            if (memberNodes.length === 0) return

            const centerLng = memberNodes.reduce((sum, node) => sum + node.position[0], 0) / memberNodes.length
            const centerLat = memberNodes.reduce((sum, node) => sum + node.position[1], 0) / memberNodes.length
            const junctionNodeId = `junction-${group.id}`

            group.station_ids.forEach(stationId => stationToDisplayId.set(stationId, junctionNodeId))
            const junctionNode: TopoNode = {
                id: junctionNodeId,
                name: group.name,
                type: 'junction',
                position: [centerLng, centerLat],
                sourceNodeIds: [...group.station_ids],
                internalSourceEdgeIds: [],
                junctionId: group.id,
                isJunction: true,
                junctionKind: group.junction_kind,
                sourceTable: group.source_table,
            }
            displayNodes.push(junctionNode)
            displayNodeMap.set(junctionNodeId, junctionNode)
        })

        nodes.forEach(node => {
            if (stationToDisplayId.has(node.id)) return
            const displayNode: TopoNode = {
                ...node,
                sourceNodeIds: [node.id],
                internalSourceEdgeIds: [],
                isJunction: false,
            }
            displayNodes.push(displayNode)
            displayNodeMap.set(displayNode.id, displayNode)
        })

        const collapsedEdgeMap = new Map<string, TopoEdge>()
        edges.forEach(edge => {
            const startNodeId = stationToDisplayId.get(edge.startNodeId) ?? edge.startNodeId
            const endNodeId = stationToDisplayId.get(edge.endNodeId) ?? edge.endNodeId
            const nextSourceEdgeIds = edge.sourceEdgeIds?.length ? edge.sourceEdgeIds : [edge.id]
            if (startNodeId === endNodeId) {
                const ownerNode = displayNodeMap.get(startNodeId)
                if (ownerNode) {
                    ownerNode.internalSourceEdgeIds = [
                        ...new Set([...(ownerNode.internalSourceEdgeIds ?? []), ...nextSourceEdgeIds]),
                    ]
                }
                return
            }

            const sorted = [startNodeId, endNodeId].sort()
            const key = `${sorted[0]}__${sorted[1]}`
            const existing = collapsedEdgeMap.get(key)
            if (existing) {
                existing.sourceEdgeIds = [...new Set([...(existing.sourceEdgeIds ?? []), ...nextSourceEdgeIds])]
                return
            }

            collapsedEdgeMap.set(key, {
                id: `merged-${key}`,
                startNodeId,
                endNodeId,
                name: edge.name,
                sourceEdgeIds: nextSourceEdgeIds,
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

        clearRenderedTopology()

        const renderedNodes: TopoNode[] = graphNodes.map(node => {
            const size = node.isJunction ? TOPO_SIZES.station + 4 : TOPO_SIZES[node.type]
            const marker = new AMap.Marker({
                position: new AMap.LngLat(node.position[0], node.position[1]),
                content: createTopoMarkerContent(node.type, node.name, false, !!node.isJunction),
                offset: new AMap.Pixel(-size / 2, -size / 2),…22093 tokens truncated…                      </div>
                                                <div className="rounded-lg bg-black/15 px-3 py-2 text-gray-300">
                                                    <div className="text-[10px] text-gray-500">总需求</div>
                                                    <div className="mt-1 font-semibold text-white">{steadyOverlay.summary.total_demand.toFixed(2)}</div>
                                                </div>
                                                <div className="rounded-lg bg-black/15 px-3 py-2 text-gray-300">
                                                    <div className="text-[10px] text-gray-500">平均利用率</div>
                                                    <div className="mt-1 font-semibold text-white">{steadyOverlay.summary.avg_utilization.toFixed(3)}</div>
                                                </div>
                                                <div className="rounded-lg bg-black/15 px-3 py-2 text-gray-300">
                                                    <div className="text-[10px] text-gray-500">告警数</div>
                                                    <div className="mt-1 font-semibold text-amber-300">{steadyOverlay.summary.alert_count}</div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/10 p-3 space-y-2">
                                            <div className="text-[10px] uppercase tracking-wider text-cyan-200">映射覆盖摘要</div>
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                <div className="rounded-lg bg-black/15 px-3 py-2 text-gray-300">
                                                    <div className="text-[10px] text-gray-500">显示节点命中</div>
                                                    <div className="mt-1 font-semibold text-white">{mappingSummary?.displayNodesWithMatchedOverlay ?? 0} / {mappingSummary?.displayNodeCount ?? 0}</div>
                                                </div>
                                                <div className="rounded-lg bg-black/15 px-3 py-2 text-gray-300">
                                                    <div className="text-[10px] text-gray-500">显示连线命中</div>
                                                    <div className="mt-1 font-semibold text-white">{mappingSummary?.displayEdgesWithMatchedOverlay ?? 0} / {mappingSummary?.displayEdgeCount ?? 0}</div>
                                                </div>
                                                <div className="rounded-lg bg-black/15 px-3 py-2 text-gray-300">
                                                    <div className="text-[10px] text-gray-500">枢纽内部边命中</div>
                                                    <div className="mt-1 font-semibold text-cyan-200">{mappingSummary?.displayNodesWithMatchedInternalEdges ?? 0}</div>
                                                </div>
                                                <div className="rounded-lg bg-black/15 px-3 py-2 text-gray-300">
                                                    <div className="text-[10px] text-gray-500">overlay 边命中</div>
                                                    <div className="mt-1 font-semibold text-white">{mappingSummary?.matchedOverlayEdgeCount ?? 0} / {steadyOverlay.edges.length}</div>
                                                </div>
                                                <div className="rounded-lg bg-black/15 px-3 py-2 text-gray-300">
                                                    <div className="text-[10px] text-gray-500">未命中 overlay 节点</div>
                                                    <div className="mt-1 font-semibold text-amber-300">{mappingSummary?.unmatchedOverlayNodeIds.length ?? 0}</div>
                                                </div>
                                                <div className="rounded-lg bg-black/15 px-3 py-2 text-gray-300">
                                                    <div className="text-[10px] text-gray-500">未命中 overlay 边</div>
                                                    <div className="mt-1 font-semibold text-amber-300">{mappingSummary?.unmatchedOverlayEdgeIds.length ?? 0}</div>
                                                </div>
                                            </div>
                                            <div className="rounded-lg bg-black/15 px-3 py-2 text-[11px] leading-5 text-gray-300">
                                                <div>未命中节点预览：{unmatchedNodePreview.join(', ') || '无'}</div>
                                                <div>未命中边预览：{unmatchedEdgePreview.join(', ') || '无'}</div>
                                                <div>这块只说明映射是否接住，不代表已经把结果落到地图样式上。</div>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-[11px] leading-5 text-gray-400">
                                        先选择 WE1 场景，再点击“运行仿真”。这一轮先校对拓扑映射和快照链路，不直接做地图着色。
                                    </div>
                                )}
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

                            {/* OverlayNodeMappingBlockV2 */}
                            <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3 space-y-2 text-xs">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-emerald-200 uppercase tracking-wider">????</span>
                                    <span className="text-gray-400">
                                        {selectedNodeSimulationMatch?.matchedNodeIds.length ?? 0}/{selectedNodeSimulationMatch?.sourceNodeIds.length ?? 0}
                                    </span>
                                </div>
                                {!steadyOverlay && (
                                    <div className="text-gray-400">?????????????????</div>
                                )}
                                {steadyOverlay && !selectedNodeSimulationMatch && (
                                    <div className="text-amber-300">????????????</div>
                                )}
                                {steadyOverlay && selectedNodeSimulationMatch && (
                                    <div className="space-y-1 text-gray-300">
                                        <div>?????{selectedNodeSimulationMatch.sourceNodeIds.join(', ') || '?'}</div>
                                        <div>?????{selectedNodeSimulationMatch.matchedNodeIds.join(', ') || '?'}</div>
                                        <div>??????{selectedNodeSimulationMatch.missingSourceNodeIds.join(', ') || '?'}</div>
                                        <div>?????{selectedNodeSimulationMatch.averagePressureMpa === null ? '-' : `${selectedNodeSimulationMatch.averagePressureMpa.toFixed(3)} MPa`}</div>
                                    </div>
                                )}
                                {steadyOverlay && selectedNodeRelatedEdgeMatches.length > 0 && (
                                    <div className="rounded bg-black/15 px-2 py-2 text-gray-300">
                                        <div className="text-[10px] uppercase tracking-wider text-gray-500">?????</div>
                                        <div className="mt-1 space-y-1">
                                            {selectedNodeRelatedEdgeMatches.slice(0, 4).map(({ edge, match }) => (
                                                <div key={edge.id} className="text-[11px]">
                                                    <div className="text-gray-200">{edge.name || edge.id}</div>
                                                    <div className="text-gray-400">overlay={match?.matchedEdgeIds.join(', ') || '?'} | flow={match?.totalFlowRate.toFixed(2) ?? '-'} | util={match?.averageUtilization?.toFixed(3) ?? '-'}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
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
