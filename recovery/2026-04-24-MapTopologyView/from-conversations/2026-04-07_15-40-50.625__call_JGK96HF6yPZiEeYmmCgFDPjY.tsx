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
import { topologyAPI, type SimulationResult } from '@/services/api'
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
    // NOTE: sj4 绛夋柊鏁版嵁鏂囦欢鐩存帴浣跨敤 compressor/distribution 绛夊€?
    compressor: 'compressor',
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
    const [selectedMergeNodeIds, setSelectedMergeNodeIds] = useState<string[]>([])
    const [mergeJunctionName, setMergeJunctionName] = useState('')
    const [mergeJunctionDescription, setMergeJunctionDescription] = useState('')
    const [isMerging, setIsMerging] = useState(false)
    const [deletingJunctionId, setDeletingJunctionId] = useState<number | null>(null)
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
        | { type: 'create-junction'; junctionId: number; name: string }
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

    // 宸查珮浜殑 marker 鍘熷 content锛岀敤浜庢仮澶?
    const highlightedMarkersRef = useRef<Map<string, string>>(new Map())

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
        if (names.length === 1) return `${names[0]}鏋㈢航`
        const preview = names.slice(0, 2).join(' / ')
        return `${preview}${names.length > 2 ? ` 绛?${names.length} 绔檂 : ''}鏋㈢航`
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
   …17532 tokens truncated…t-lg font-bold text-green-400">{cutoffResult.summary.same}</span>
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

                        {/* 绋虫€佷豢鐪?*/}
                        {activeTab === 'simulation' && (
                            <div className="space-y-4">
                                <div className="text-center pb-2 border-b border-gray-700/50">
                                    <span className="material-symbols-outlined text-3xl text-cyan-500 mb-1">science</span>
                                    <h3 className="text-sm font-medium text-gray-300">鍚庣绋虫€佷豢鐪?/h3>
                                </div>
                                <div className="text-xs text-gray-400 leading-normal mb-3">
                                    璋冪敤鍚庣 \`/api/emergency/simulate-failure\` 鎺ュ彛璁＄畻鍏ㄥ眬鍘嬮檷涓庢柇渚涜寖鍥淬€?
                                </div>
                                <button
                                    onClick={async () => {
                                        setIsSimulating(true)
                                        try {
                                            const result = await topologyAPI.simulate({ steps: 5 })
                                            if (result && result.data) {
                                                setSimResults(result.data)
                                                setStatusMsg(`浠跨湡瀹屾垚锛屽叡 ${result.data.length} 姝)
                                            }
                                        } catch (e) {
                                            setStatusMsg('浠跨湡澶辫触锛? + (e as Error).message)
                                        } finally {
                                            setIsSimulating(false)
                                        }
                                    }}
                                    disabled={isSimulating}
                                    className="w-full bg-cyan-700/80 hover:bg-cyan-600 text-white flex items-center justify-center py-2.5 rounded-lg text-xs shadow hover:shadow-cyan-500/20 disabled:opacity-50 transition-all font-medium"
                                >
                                    <span className="material-symbols-outlined text-sm mr-1.5">{isSimulating ? 'hourglass_empty' : 'play_arrow'}</span>
                                    {isSimulating ? '姝ｅ湪杩涜缃戠粶浠跨湡...' : '杩愯绋虫€佷豢鐪?}
                                </button>

                                {simResults.length > 0 && (
                                    <div className="space-y-2 mt-4 max-h-64 overflow-y-auto pr-1">
                                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">浠跨湡姝ラ缁撴灉</p>
                                        {simResults.map((step, i) => (
                                            <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-2.5 hover:bg-white/10 transition-colors">
                                                <div className="flex justify-between items-center mb-1.5">
                                                    <span className="text-sky-300 text-xs font-medium">鉁?姝ラ {step.step}</span>
                                                    <span className={`text-[9px] px-1.5 py-0.5 rounded-sm uppercase tracking-wider ${step.is_stable ? 'bg-green-900/50 text-green-400 border border-green-800/50' : 'bg-red-900/50 text-red-400 border border-red-800/50'}`}>
                                                        {step.is_stable ? 'Stable' : 'Fluctuating'}
                                                    </span>
                                                </div>
                                                <div className="text-[10px] text-gray-400">
                                                    褰卞搷鑺傜偣: <span className="text-white ml-0.5">{step.affected_nodes?.length || 0}</span> 涓?
                                                </div>
                                            </div>
                                        ))}
                                    </div>
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
                                            褰撳墠鏋㈢航鏉ヨ嚜杩愯鏃堕噸缂栧奖瀛愯〃锛岀户缁綔涓烘嫇鎵戞灑绾藉弬涓庡睍绀哄拰璁＄畻锛屼絾杩欓噷涓嶅啀鎶婃墜宸ユ媶鍒嗗綋涓绘祦绋嬨€?
                                        </div>
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
                                        杩欓噷淇濈暀绔欑偣鏌ョ湅鍜岀偣浣嶇紪杈戙€傛灑绾藉叧绯荤敱鍚庡彴鎸変氦姹囪鍒欒繍琛屾椂鐢熸垚锛屼笉鍐嶅湪杩欎釜闈㈡澘閲屾墜宸ユ崗鍚堛€?
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
