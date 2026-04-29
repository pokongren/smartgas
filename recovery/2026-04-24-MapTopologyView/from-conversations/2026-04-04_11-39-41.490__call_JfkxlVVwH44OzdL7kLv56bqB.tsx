/**
 * 鍦板浘鎷撴墤绠＄悊瑙嗗浘锛堢嫭绔嬮〉闈級
 *
 * 鍙樉绀虹函鎷撴墤灞傦紙绠€娲佸渾鐐?+ 鐩寸嚎锛夛紝闅愯棌鎵€鏈夌珯鍦?闃€瀹ょ殑澶嶆潅鍥惧舰銆?
 * 鐙珛浜庡叏鍥界缃戠粺涓€瑙嗗浘鍜?Canvas 鎷撴墤瑙嗗浘銆?
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import MapView from '@/components/map-view/MapView'
import ScadaHistoryChart from '@/components/scada/ScadaHistoryChart'
import { buildPipelineDataFromPackages, invalidatePipelineCache, loadAllPipelines } from '@/data/pipelines'
import type { PipelinePackage } from '@/data/pipelines/types'
import type { SimulationResult } from '@/services/api'
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
import { simulateCutoff, searchNodes, pathIdsToNames } from '@/utils/cutoff-simulator'
import type { CutoffResult } from '@/utils/cutoff-simulator'

// ================== 绫诲瀷 ==================
type PointType = 'station' | 'valve' | 'distribution' | 'compressor' | 'junction'
type EditMode = 'view' | 'draw-point' | 'connect' | 'merge'
type PanelTab = 'edit' | 'validate' | 'search' | 'centrality' | 'cutoff'

interface TopoNode {
    id: string
    type: PointType
    name: string
    position: [number, number]
    sourceNodeIds?: string[]
    junctionId?: number
    isJunction?: boolean
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
    String(import.meta.env.VITE_TOPOLOGY_MANUAL_JUNCTION_EDIT ?? '').trim() === '1'
const JUNCTION_READONLY_HINT = '褰撳墠鏋㈢航鐢辫繍琛屾椂閲嶇紪缁撴灉缁存姢锛岀紪杈戝櫒浠呮敮鎸佸彧璇绘煡鐪嬶紝涓嶅啀浠ユ墜宸ユ崗鍚堜綔涓轰富娴佺▼銆?

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

    // 缂栬緫鍣ㄧ姸鎬?
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
    const [statusMsg, setStatusMsg] = useState('鐐瑰嚮銆屽鍏ユ嫇鎵戙€嶅姞杞藉凡鏈夌绾?)
    const [activeTab, setActiveTab] = useState<PanelTab>('edit')
    const [searchText, setSearchText] = useState('')
    const [report, setReport] = useState<ValidationReport | null>(null)
    const [centralityData, setCentralityData] = useState<Array<{ id: string; name: string; value: number }>>([])

    // 浠跨湡鐘舵€?(Sim Status)
    const [simDrawerVisible, setSimDrawerVisible] = useState(false)
    const [isSimulating, setIsSimulating] = useState(false)
    const [simResults, setSimResults] = useState<SimulationResult[]>([])
    const [currentSimStep, setCurrentSimStep] = useState(0)
    const [selectedNode, setSelectedNode] = useState<TopoNode | null>(null)
    const [historyChartTarget, setHistoryChartTarget] = useState<null | {
        stationName?: string
        junctionId?: string
        displayName?: string
    }>(null)

    // 鎾ら攢鏍?
    type UndoAction = 
        | { type: 'add-node'; nodeId: string }
        | { type: 'add-edge'; edgeId: string }
        | { type: 'create-junction'; junctionId: number; name: string; stationIds: string[] }
        | { type: 'delete-junction'; group: JunctionGroup }
    const [undoStack, setUndoStack] = useState<UndoAction[]>([])

    // 鎴柇浠跨湡鐘舵€?
    const [cutoffNodeId, setCutoffNodeId] = useState<string | null>(null)
    const [cutoffResult, setCutoffResult] = useState<CutoffResult | null>(null)
    const [cutoffSearch, setCutoffSearch] = useState('')

    // 淇濆瓨鏈哄埗锛氳窡韪嫋鎷戒慨鏀圭殑鍧愭爣
    const [dirtyPositions, setDirtyPositions] = useState<Map<string, [number, number]>>(new Map())
    const [isSaving, setIsSaving] = useState(false)
    const [cascadeValves, setCascadeValves] = useState(true)
    const [positionPreview, setPositionPreview] = useState<PositionPreviewResult | null>(null)
    const [isPreviewing, setIsPreviewing] = useState(false)

    // 鍚堝缓绔欙細鍚堝苟妯″紡鐘舵€?    const [selectedMergeNodeIds, setSelectedMergeNodeIds] = useState<string[]>([])
    // 宸查珮浜殑 marker 鍘熷 content锛岀敤浜庢仮澶?    const highlightedMarkersRef = useRef<Map<string, string>>(new Map())

    // Refs 鈥?瑙ｅ喅闂寘闄堟棫寮曠敤
    const nodesRef = useRef<TopoNode[]>([])
    const edgesRef = useRef<TopoEdge[]>([])
    const modeRef = useRef<EditMode>('view')
    const ptRef = useRef<PointType>('station')
    const cfRef = useRef<string | null>(null)

    useEffect(() => { nodesRef.current = topoNodes; edgesRef.current = topoEdges }, [topoNodes, topoEdges])
    useEffect(() => { modeRef.current = editMode; ptRef.current = pointType }, [editMode, pointType])
    useEffect(() => { cfRef.current = connectFrom }, [connectFrom])

    // ================== 鏀堕泦鍏ㄩ儴绠＄嚎鍘熷鏁版嵁锛堜笉浼犵粰 MapView锛屼粎渚涘鍏ョ敤锛?==================
    const rawPipelineData = useMemo(() => {
        const { nodes, lines } = buildPipelineDataFromPackages(pipelines)
        return { nodes, lines }
    }, [pipelines])

    const persistedTopologyNodeIds = useMemo(
        () => new Set(rawPipelineData.nodes.map(node => node.id)),
        [rawPipelineData.nodes]
    )

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
                setStatusMsg('宸叉挙閿€鏈繚瀛樼殑鐐逛綅淇敼')
            })
            .catch(error => {
                console.error(error)
                setStatusMsg('鎾ら攢鏈繚瀛樹慨鏀瑰け璐?)
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
            console.error('[MapTopologyView] 鏋㈢航缁勫姞杞藉け璐?', error)
            setStatusMsg(error instanceof Error ? `鍔犺浇鏋㈢航缁勫け璐ワ細${error.message}` : '鍔犺浇鏋㈢航缁勫け璐?)
            return []
        }
    }, [])

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

        clearRenderedTopology()

        const renderedNodes: TopoNode[] = graphNodes.map(node => {
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
            marker.on('click', (event: any) => doNodeClick(nodeId, event))

            return { ...node, marker }
        })

        const renderedNodeMap = new Map(renderedNodes.map(node => [node.id, node]))
        const renderedEdges: TopoEdge[] = graphEdges.map(edge => {
            const startNode = renderedNodeMap.get(edge.startNodeId)
            const endNode = renderedNodeMap.get(edge.endNodeId)
            if (!startNode || !endNode) return edge

            const poly = new AMap.Polyline({
                path: [startNode.position, endNode.position],
                strokeColor: LINE_COLOR,
                strokeWeight: LINE_WEIGHT,
                strokeStyle: 'solid',
                zIndex: 100,
            })
            poly.setMap(mapInstance)
            return { ...edge, poly }
        })

        setTopoNodes(renderedNodes)
        setTopoEdges(renderedEdges)
    }, [clearRenderedTopology, mapInstance])

    useEffect(() => {
        void loadJunctionGroups()
    }, [loadJunctionGroups])

    useEffect(() => {
        if (!mapInstance || baseTopoNodes.length === 0) return
        const collapsed = buildCollapsedGraph(baseTopoNodes, baseTopoEdges, junctionGroups)
        renderCollapsedGraph(collapsed.nodes, collapsed.edges)
    }, [baseTopoNodes, baseTopoEdges, buildCollapsedGraph, junctionGroups, mapInstance, renderCollapsedGraph])

    // ================== 鍦板浘鐐瑰嚮 ==================
    useEffect(() => {
        if (!mapInstance) return
        const onClick = (e: any) => {
            if (modeRef.current === 'draw-point') doAddNode(e.lnglat, ptRef.current)
        }
        mapInstance.on('click', onClick)
        return () => {
            mapInstance.off('click', onClick)
            nodesRef.current.forEach(n => n.marker?.setMap(null))
            edgesRef.current.forEach(e => e.poly?.setMap(null))
        }
    }, [mapInstance])

    useEffect(() => {
        if (!mapInstance) return
        mapInstance.setDefaultCursor(editMode === 'view' ? 'grab' : 'crosshair')
        if (editMode === 'draw-point') setStatusMsg(`缁樺埗锛氱偣鍑诲湴鍥炬坊鍔犮€?{TOPO_LABELS[pointType]}銆峘)
        else if (editMode === 'connect') { setStatusMsg('杩炵嚎锛氱偣鍑昏捣鐐硅妭鐐?); setConnectFrom(null) }
        else if (editMode === 'merge') {
            setConnectFrom(null)
            if (manualJunctionEditingEnabled) setStatusMsg('鎹忓悎锛氱偣鍑昏妭鐐硅繘琛屽閫夛紝鍐嶇偣鍑汇€屽垱寤烘灑绾姐€?)
            else setStatusMsg(JUNCTION_READONLY_HINT)
        }
        else setStatusMsg('娴忚妯″紡')
    }, [editMode, manualJunctionEditingEnabled, pointType, mapInstance])

    useEffect(() => {
        if (manualJunctionEditingEnabled) return
        if (editMode === 'merge') {
            setEditMode('view')
        }
        if (selectedMergeNodeIds.length > 0) {
            setSelectedMergeNodeIds([])
        }
    }, [editMode, manualJunctionEditingEnabled, selectedMergeNodeIds.length])

    // ================== 鑺傜偣鎿嶄綔 ==================
    const doAddNode = (lnglat: any, type: PointType) => {
        const id = `tn-${Date.now()}`
        const nodeName = `${TOPO_LABELS[type]}-${baseTopoNodes.length + 1}`
        const pos: [number, number] = [lnglat.getLng(), lnglat.getLat(…13263 tokens truncated…                              cutoffSearch
                                            ).map(node => (
                                                <button key={node.id}
                                                    onClick={() => {
                                                        setCutoffNodeId(node.id)
                                                        setCutoffResult(null)
                                                        setCutoffSearch('')
                                                        setStatusMsg(`鎴柇鐐瑰凡閫夛細${node.name}`)
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

                                {/* 褰撳墠鎴柇鐐?*/}
                                {cutoffNodeId && (
                                    <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-2">
                                        <p className="text-[10px] text-red-400 mb-0.5">鎴柇鐐?/p>
                                        <p className="text-xs text-white font-medium truncate">
                                            {topoNodes.find(n => n.id === cutoffNodeId)?.name ?? cutoffNodeId}
                                        </p>
                                    </div>
                                )}

                                {/* 鎿嶄綔鎸夐挳 */}
                                <div className="flex gap-1.5">
                                    <button
                                        onClick={runCutoffSimulation}
                                        disabled={!cutoffNodeId || topoNodes.length === 0}
                                        className="flex-1 bg-red-800/50 hover:bg-red-700 text-red-300 py-2 rounded-lg text-xs border border-red-700/40 transition-colors disabled:opacity-40 flex items-center justify-center gap-1">
                                        <span className="material-symbols-outlined text-sm">play_arrow</span>杩愯浠跨湡
                                    </button>
                                    <button
                                        onClick={clearCutoffHighlight}
                                        disabled={!cutoffNodeId}
                                        className="bg-gray-800/60 hover:bg-gray-700 text-gray-400 py-2 px-3 rounded-lg text-xs border border-gray-700/40 transition-colors disabled:opacity-40">
                                        <span className="material-symbols-outlined text-sm">undo</span>
                                    </button>
                                </div>

                                {/* 浠跨湡缁撴灉 */}
                                {cutoffResult && (
                                    <div className="space-y-2">
                                        {/* 姘旀簮绠€浠?*/}
                                        {cutoffResult.sourceNodes.length > 0 && (
                                            <div className="bg-blue-900/15 border border-blue-700/30 rounded-lg p-2 text-[10px]">
                                                <p className="text-blue-400 mb-1">璇嗗埆鍒?{cutoffResult.sourceNodes.length} 涓皵婧?/p>
                                                <div className="text-gray-400 space-y-0.5 max-h-16 overflow-y-auto">
                                                    {cutoffResult.sourceNodes.map(s => (
                                                        <div key={s.id} className="truncate">路 {s.name}</div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* 鎽樿鍗＄墖 */}
                                        <div className="bg-gray-900/60 border border-gray-700/30 rounded-lg p-2.5 text-[10px]">
                                            <p className="text-gray-400 mb-1.5">鍒嗘瀽浜?{cutoffResult.totalDistributionNodes} 涓垎杈撶珯</p>
                                            <div className="flex gap-2">
                                                <span className="flex-1 bg-red-900/30 rounded px-2 py-1 text-center">
                                                    <span className="block text-lg font-bold text-red-400">{cutoffResult.summary.supplyLost}</span>
                                                    <span className="text-gray-500">鏂緵</span>
                                                </span>
                                                <span className="flex-1 bg-orange-900/30 rounded px-2 py-1 text-center">
                                                    <span className="block text-lg font-bold text-orange-400">{cutoffResult.summary.rerouted}</span>
                                                    <span className="text-gray-500">缁曡</span>
                                                </span>
                                                <span className="flex-1 bg-green-900/30 rounded px-2 py-1 text-center">
                                                    <span className="block text-lg font-bold text-green-400">{cutoffResult.summary.same}</span>
                                                    <span className="text-gray-500">姝ｅ父</span>
                                                </span>
                                            </div>
                                        </div>

                                        {/* 鍙楀奖鍝嶈妭鐐瑰垪琛?*/}
                                        {cutoffResult.affectedNodes.length > 0 && (
                                            <div className="space-y-0.5 max-h-52 overflow-y-auto">
                                                <p className="text-[10px] text-gray-500 mb-1">鍙楀奖鍝嶈妭鐐?/p>
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
                                                                {node.status === 'supply_lost' ? '鏂緵' : '缁曡'}
                                                            </span>
                                                        </div>
                                                        {/* 璺緞棰勮 */}
                                                        {node.status === 'rerouted' && node.pathAfter.length > 0 && (
                                                            <div className="mt-1 text-[9px] text-gray-600 truncate pl-4">
                                                                猡?{pathIdsToNames(node.pathAfter, topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))).join(' 鈫?')}
                                                            </div>
                                                        )}
                                                        {node.status === 'supply_lost' && node.pathBefore.length > 0 && (
                                                            <div className="mt-1 text-[9px] text-gray-600 truncate pl-4">
                                                                鈿?鍘熻矾寰? {pathIdsToNames(node.pathBefore, topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))).join(' 鈫?')}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 鎻愮ず */}
                                {topoNodes.length === 0 && (
                                    <p className="text-center text-gray-600 text-[10px] py-4">璇峰厛鐐瑰嚮銆屽鍏ユ嫇鎵戙€?/p>
                                )}
                            </div>
                        )}

                        {/* 鍏抽敭鏋㈢航 */}
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
                                    <button
                                        onClick={() => {
                                            const group = junctionGroups.find(item => item.id === selectedNode.junctionId)
                                            if (group) handleDeleteJunction(group)
                                        }}
                                        className="w-full bg-red-700/80 hover:bg-red-600 text-white py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-sm">device_hub</span>瑙ｉ櫎鎹忓悎
                                    </button>
                                    <button
                                        onClick={() => setHistoryChartTarget({
                                            junctionId: selectedNode.junctionId ? `JUNCTION-${selectedNode.junctionId}` : selectedNode.id,
                                            displayName: selectedNode.name,
                                        })}
                                        className="w-full bg-blue-700/80 hover:bg-blue-600 text-white py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-sm">show_chart</span>鏌ョ湅鏋㈢航鍘嗗彶
                                    </button>
                                </div>
                            ) : (
                                <div className="rounded-lg border border-gray-700/40 bg-white/5 p-3">
                                    <button
                                        onClick={() => {
                                            setEditMode('merge')
                                            toggleMergeSelection(selectedNode.id)
                                        }}
                                        className="w-full bg-purple-700/80 hover:bg-purple-600 text-white py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-sm">hub</span>鍔犲叆寰呮崗鍚堝垪琛?
                                    </button>
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
