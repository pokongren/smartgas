/**
 * 地图拓扑管理视图（独立页面）
 *
 * 只显示纯拓扑层（简洁圆点 + 直线），隐藏所有站场/阀室的复杂图形。
 * 独立于全国管网统一视图和 Canvas 拓扑视图。
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import MapView from '@/components/map-view/MapView'
import ScadaHistoryChart from '@/components/scada/ScadaHistoryChart'
import { invalidatePipelineCache, loadAllPipelines } from '@/data/pipelines'
import type { PipelinePackage } from '@/data/pipelines/types'
import type { PipelineNode, PipelineLine } from '@/types'
import {
    validateTopology,
    computeBetweennessCentrality,
    findIsolatedNodes,
} from '@/utils/topology-validator'
import type { ValidationReport } from '@/utils/topology-validator'
import { simulateCutoff, searchNodes, pathIdsToNames } from '@/utils/cutoff-simulator'
import type { CutoffResult } from '@/utils/cutoff-simulator'
import type { SimulationResult } from '../services/api'

// ================== 类型 ==================
type PointType = 'station' | 'valve' | 'distribution' | 'compressor'
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

interface JunctionGroup {
    id: number
    name: string
    description?: string | null
    station_ids: string[]
}

interface PositionPreviewResult {
    updated_station_ids: string[]
    updated_valve_ids: string[]
    affected_layers: string[]
    impacted_segments: Array<{
        start_id: string
        end_id: string
        valve_ids: string[]
    }>
    errors: Array<{ id?: string | null; error: string }>
    preview_only?: boolean
}

// ================== 拓扑样式（极简圆点 + 颜色区分） ==================
const TOPO_COLORS: Record<PointType, string> = {
    compressor: '#FF9800',
    distribution: '#2196F3',
    station: '#F44336',
    valve: '#9E9E9E',
}

const TOPO_LABELS: Record<PointType, string> = {
    compressor: '压气站',
    distribution: '分输站',
    station: '站场',
    valve: '阀室',
}

const TOPO_SIZES: Record<PointType, number> = {
    compressor: 10,
    distribution: 8,
    station: 8,
    valve: 5,
}

const LINE_COLOR = '#34d399'
const LINE_WEIGHT = 2

/** 从 PipelineNode.type (NodeType 枚举值，均为小写) 映射到编辑器 PointType */
const TYPE_MAP: Record<string, PointType> = {
    regulator: 'compressor',
    metering: 'distribution',
    valve: 'valve',
    junction: 'station',
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
    const [mapInstance, setMapInstance] = useState<any>(null)
    const handleMapLoad = useCallback((map: any) => setMapInstance(map), [])
    const importedOnceRef = useRef(false)

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
    const [editMode, setEditMode] = useState<EditMode>('view')
    const [pointType, setPointType] = useState<PointType>('station')
    const [connectFrom, setConnectFrom] = useState<string | null>(null)
    const [statusMsg, setStatusMsg] = useState('点击「导入拓扑」加载已有管线')
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
    const [historyChartTarget, setHistoryChartTarget] = useState<null | {
        stationName?: string
        junctionId?: string
        displayName?: string
    }>(null)

    // 撤销栈
    type UndoAction = 
        | { type: 'add-node'; nodeId: string }
        | { type: 'add-edge'; edgeId: string }
        | { type: 'create-junction'; junctionId: number; name: string; stationIds: string[] }
        | { type: 'delete-junction'; group: JunctionGroup }
    const [undoStack, setUndoStack] = useState<UndoAction[]>([])

    // 截断仿真状态
    const [cutoffNodeId, setCutoffNodeId] = useState<string | null>(null)
    const [cutoffResult, setCutoffResult] = useState<CutoffResult | null>(null)
    const [cutoffSearch, setCutoffSearch] = useState('')

    // 保存机制：跟踪拖拽修改的坐标
    const [dirtyPositions, setDirtyPositions] = useState<Map<string, [number, number]>>(new Map())
    const [isSaving, setIsSaving] = useState(false)
    const [cascadeValves, setCascadeValves] = useState(true)
    const [positionPreview, setPositionPreview] = useState<PositionPreviewResult | null>(null)
    const [isPreviewing, setIsPreviewing] = useState(false)

    // 合建站：合并模式状态
    const [selectedMergeNodeIds, setSelectedMergeNodeIds] = useState<string[]>([])
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

    // ================== 收集全部管线原始数据（不传给 MapView，仅供导入用） ==================
    const rawPipelineData = useMemo(() => {
        const nodes: PipelineNode[] = []
        const lines: PipelineLine[] = []
        for (const pkg of pipelines) {
            for (const layer of pkg.layers) {
                for (const n of layer.nodes) nodes.push(n)
                for (const l of layer.lines) lines.push(l)
            }
        }
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
            const res = await fetch('/api/topology/junctions')
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            setJunctionGroups(Array.isArray(data.junctions) ? data.junctions : [])
            return Array.isArray(data.junctions) ? data.junctions as JunctionGroup[] : []
        } catch (error) {
            console.error('[MapTopologyView] 枢纽组加载失败:', error)
            setStatusMsg('加载枢纽组失败')
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
                type: 'station',
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
            edgesRef.current.forEach(e => e.poly?.setMap(null))
        }
    }, [mapInstance])

    useEffect(() => {
        if (!mapInstance) return
        mapInstance.setDefaultCursor(editMode === 'view' ? 'grab' : 'crosshair')
        if (editMode === 'draw-point') setStatusMsg(`绘制：点击地图添加「${TOPO_LABELS[pointType]}」`)
        else if (editMode === 'connect') { setStatusMsg('连线：点击起点节点'); setConnectFrom(null) }
        else if (editMode === 'merge') { setStatusMsg('捏合：点击节点进行多选，再点击「创建枢纽」'); setConnectFrom(null) }
        else setStatusMsg('浏览模式')
    }, [editMode, pointType, mapInstance])

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

    const extractShiftPressed = (event: any) => {
        return Boolean(
            event?.originEvent?.shiftKey ??
            event?.originEvent?.domEvent?.shiftKey ??
            event?.domEvent?.shiftKey
        )
    }

    const toggleMergeSelection = useCallback((nodeId: string) => {
        const clickedNode = nodesRef.current.find(node => node.id === nodeId)
        const targetIds = clickedNode?.isJunction && clickedNode.sourceNodeIds?.length
            ? clickedNode.sourceNodeIds
            : [nodeId]

        setSelectedMergeNodeIds(prev => {
            const shouldRemove = targetIds.every(id => prev.includes(id))
            const next = shouldRemove
                ? prev.filter(id => !targetIds.includes(id))
                : [...prev, ...targetIds.filter(id => !prev.includes(id))]
            setStatusMsg(`已选择 ${next.length} 个待捏合节点`)
            return next
        })
    }, [])

    const doNodeClick = (nodeId: string, event?: any) => {
        const shiftPressed = extractShiftPressed(event)

        if (modeRef.current === 'connect') {
            const from = cfRef.current
            if (!from) {
                setConnectFrom(nodeId)
                const nd = nodesRef.current.find(n => n.id === nodeId)
                setStatusMsg(`起点「${nd?.name}」→ 点击终点`)
            } else {
                if (nodeId === from) { setStatusMsg('不能连接自身'); return }
                doAddEdge(from, nodeId)
                setConnectFrom(null)
                setStatusMsg('连线成功，继续点击起点')
            }
            return
        }
        if (modeRef.current === 'merge' || shiftPressed) {
            toggleMergeSelection(nodeId)
            return
        }

        const clickedNode = nodesRef.current.find(n => n.id === nodeId) || null
        setSelectedNode(clickedNode)

        // 截断模式：点击节点设为截断点
        if (modeRef.current === 'view' && activeTab === 'cutoff') {
            const nd = clickedNode
            if (!nd) return
            setCutoffNodeId(nodeId)
            setCutoffResult(null)
            setStatusMsg(`截断点已选：${nd.name}`)
            return
        }

        if (clickedNode?.isJunction) {
            setStatusMsg(`已选中枢纽：${clickedNode.name}`)
        } else if (clickedNode) {
            setStatusMsg(`已选中节点：${clickedNode.name}`)
        }
    }

    const doAddEdge = (startId: string, endId: string) => {
        const s = baseTopoNodes.find(n => n.id === startId)
        const e = baseTopoNodes.find(n => n.id === endId)
        if (!s || !e) return
        const id = `te-${Date.now()}`
        setBaseTopoEdges(prev => [...prev, { id, startNodeId: startId, endNodeId: endId, name: '新建管线' }])
        setUndoStack(prev => [...prev, { type: 'add-edge', edgeId: id }])
    }

    // ================== 导入：将 ALL_PIPELINES 数据转为纯拓扑点+线（阀室链路合并） ==================

    // ================== 撤销操作 ==================
    const restoreSelectionHighlights = useCallback(() => {
        nodesRef.current.forEach(node => {
            if (!node.marker) return
            const isHighlighted = selectedMergeNodeIds.includes(node.id)
            node.marker.setContent(createTopoMarkerContent(node.type, node.name, isHighlighted, !!node.isJunction))
        })
    }, [selectedMergeNodeIds])

    useEffect(() => {
        restoreSelectionHighlights()
    }, [restoreSelectionHighlights, topoNodes])

    const handleCreateJunction = useCallback(async () => {
        if (selectedMergeNodeIds.length < 2) {
            setStatusMsg('至少选择两个节点才能捏合')
            return
        }

        const selectedNodes = baseTopoNodes.filter(node => selectedMergeNodeIds.includes(node.id))
        const defaultName = selectedNodes.map(node => node.name).slice(0, 2).join('-') || `联合枢纽-${Date.now().toString().slice(-4)}`
        const junctionName = window.prompt('请输入枢纽名称', `${defaultName}枢纽`)
        if (!junctionName?.trim()) return

        try {
            const res = await fetch('/api/topology/junctions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: junctionName.trim(),
                    station_ids: selectedMergeNodeIds,
                    description: 'MapTopologyView 创建',
                }),
            })
            if (!res.ok) throw new Error(await res.text())

            const data = await res.json()
            invalidatePipelineCache()
            await loadJunctionGroups()
            setUndoStack(prev => [...prev, {
                type: 'create-junction',
                junctionId: data.id,
                name: junctionName.trim(),
                stationIds: [...selectedMergeNodeIds],
            }])
            setSelectedMergeNodeIds([])
            setEditMode('view')
            setStatusMsg(`已捏合 ${selectedMergeNodeIds.length} 个节点为「${junctionName.trim()}」`)
        } catch (error) {
            console.error(error)
            setStatusMsg('创建枢纽失败')
        }
    }, [baseTopoNodes, loadJunctionGroups, selectedMergeNodeIds])

    const handleDeleteJunction = useCallback((group: JunctionGroup) => {
        if (!window.confirm(`确认拆分枢纽「${group.name}」，并恢复 ${group.station_ids.length} 个底层站点吗？`)) {
            return
        }
        ; (async () => {
            try {
                const res = await fetch(`/api/topology/junctions/${group.id}`, { method: 'DELETE' })
                if (!res.ok) throw new Error(await res.text())
                invalidatePipelineCache()
                await loadJunctionGroups()
                setUndoStack(prev => [...prev, { type: 'delete-junction', group }])
                setSelectedNode(null)
                setSelectedMergeNodeIds([])
                setStatusMsg(`枢纽「${group.name}」已拆分`)
            } catch (error) {
                console.error(error)
                setStatusMsg('拆分枢纽失败')
            }
        })()
    }, [loadJunctionGroups])

    const doUndo = useCallback(async () => {
        const stack = [...undoStack]
        const action = stack.pop()
        if (!action) { setStatusMsg('无可撤销的操作'); return }
        setUndoStack(stack)

        if (action.type === 'add-edge') {
            setBaseTopoEdges(prev => prev.filter(e => e.id !== action.edgeId))
            setStatusMsg('已撤销: 删除连线')
        } else if (action.type === 'add-node') {
            const node = baseTopoNodes.find(n => n.id === action.nodeId)
            setBaseTopoEdges(prev => prev.filter(e => e.startNodeId !== action.nodeId && e.endNodeId !== action.nodeId))
            setBaseTopoNodes(prev => prev.filter(n => n.id !== action.nodeId))
            setSelectedMergeNodeIds(prev => prev.filter(id => id !== action.nodeId))
            setStatusMsg(`已撤销: 删除 ${node?.name || '节点'}`)
        } else if (action.type === 'create-junction') {
            try {
                const res = await fetch(`/api/topology/junctions/${action.junctionId}`, { method: 'DELETE' })
                if (!res.ok) throw new Error(await res.text())
                invalidatePipelineCache()
                await loadJunctionGroups()
                setSelectedNode(null)
                setStatusMsg(`已撤销: 拆分枢纽「${action.name}」`)
            } catch (error) {
                console.error(error)
                setStatusMsg('撤销枢纽创建失败')
            }
        } else if (action.type === 'delete-junction') {
            try {
                const res = await fetch('/api/topology/junctions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: action.group.name,
                        station_ids: action.group.station_ids,
                        description: action.group.description,
                    }),
                })
                if (!res.ok) throw new Error(await res.text())
                invalidatePipelineCache()
                await loadJunctionGroups()
                setStatusMsg(`已撤销: 恢复枢纽「${action.group.name}」`)
            } catch (error) {
                console.error(error)
                setStatusMsg('撤销枢纽拆分失败')
            }
        }
    }, [baseTopoNodes, loadJunctionGroups, undoStack])

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
        setSelectedMergeNodeIds([])

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
            importedEdges.push({ id: edgeId, startNodeId: startId, endNodeId: endId, name: `${sNode.name} → ${eNode.name}` })
        }

        setBaseTopoNodes(imported)
        setBaseTopoEdges(importedEdges)
        setDirtyPositions(new Map())
        setPositionPreview(null)

        if (!silent) {
            setStatusMsg(`已导入 ${imported.length} 节点, ${importedEdges.length} 条连线（阀室链路已合并）`)
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

    // ================== 截断仿真 ==================
    const runCutoffSimulation = useCallback(() => {
        if (!cutoffNodeId || topoNodes.length === 0) return
        const gn = topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))
        const ge = topoEdges.map(e => ({ id: e.id, startNodeId: e.startNodeId, endNodeId: e.endNodeId }))
        const result = simulateCutoff(gn, ge, cutoffNodeId)
        setCutoffResult(result)

        // ---- 地图高亮渲染 ----
        // 先恢复所有已高亮节点
        for (const [nid, origContent] of highlightedMarkersRef.current) {
            const nd = nodesRef.current.find(n => n.id === nid)
            nd?.marker?.setContent(origContent)
        }
        highlightedMarkersRef.current.clear()

        // 截断节点：大红圆
        const cutNode = nodesRef.current.find(n => n.id === cutoffNodeId)
        if (cutNode?.marker) {
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
        setStatusMsg(`仿真完成：${lostCount} 个断供，${result.summary.rerouted} 个绕行，${result.summary.same} 个不受影响`)
    }, [cutoffNodeId, topoNodes, topoEdges])

    /** 清除截断仿真高亮，恢复原始样式 */
    const clearCutoffHighlight = useCallback(() => {
        for (const [nid, origContent] of highlightedMarkersRef.current) {
            const nd = nodesRef.current.find(n => n.id === nid)
            nd?.marker?.setContent(origContent)
        }
        highlightedMarkersRef.current.clear()
        setCutoffNodeId(null)
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

    const flyTo = useCallback((node: TopoNode) => {
        if (!mapInstance) return
        mapInstance.setZoomAndCenter(10, node.position, true, 500)
        setStatusMsg(`已定位: ${node.name}`)
    }, [mapInstance])

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
        setCutoffResult(null)
        setStatusMsg('已清空')
    }

    const handleSavePositions = useCallback(async () => {
        if (dirtyPositions.size === 0 || isSaving) return
        setIsSaving(true)
        try {
            const updates = [...dirtyPositions.entries()].map(([id, position]) => ({
                id,
                longitude: position[0],
                latitude: position[1],
            }))
            const res = await fetch('/api/topology/positions/commit', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    updates,
                    cascade_valves: cascadeValves,
                    cascade_scope: 'segment',
                }),
            })
            if (!res.ok) throw new Error(await res.text())

            const data = await res.json()
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
            setStatusMsg('保存点位失败')
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
            const res = await fetch('/api/topology/positions/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    updates,
                    cascade_valves: cascadeValves,
                    cascade_scope: 'segment',
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            const data = await res.json()
            setPositionPreview(data)
            setStatusMsg(
                `预览完成：将影响 ${data.updated_station_ids?.length ?? 0} 个主点、${data.updated_valve_ids?.length ?? 0} 个阀室`
            )
        } catch (error) {
            console.error(error)
            setStatusMsg('预览影响失败')
        } finally {
            setIsPreviewing(false)
        }
    }, [cascadeValves, dirtyPositions, isPreviewing, isSaving])

    // ================== 实时统计 ==================
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
                                    <div className="grid grid-cols-4 gap-1.5">
                                        {([
                                            { m: 'view' as EditMode, label: '浏览', icon: 'pan_tool' },
                                            { m: 'draw-point' as EditMode, label: '添点', icon: 'add_location' },
                                            { m: 'connect' as EditMode, label: '连线', icon: 'timeline' },
                                            { m: 'merge' as EditMode, label: '捏合', icon: 'hub' },
                                        ]).map(item => (
                                            <button key={item.m} onClick={() => setEditMode(item.m)}
                                                className={`py-2 rounded-lg text-[11px] transition-all flex flex-col items-center gap-0.5
                                                    ${editMode === item.m ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20' : 'bg-gray-800/60 text-gray-400 hover:bg-gray-700'}`}>
                                                <span className="material-symbols-outlined text-base">{item.icon}</span>{item.label}
                                            </button>
                                        ))}
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

                                {(editMode === 'merge' || selectedMergeNodeIds.length > 0) && (
                                    <div className="border border-purple-500/20 bg-purple-950/20 rounded-lg p-2.5 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-[10px] text-purple-300 uppercase tracking-wider">待捏合节点</p>
                                            <span className="text-[10px] text-purple-400">{selectedMergeNodeIds.length} 个</span>
                                        </div>
                                        <div className="max-h-28 overflow-y-auto space-y-1">
                                            {selectedMergeNodeIds.length === 0 && (
                                                <p className="text-[10px] text-gray-500">进入捏合模式后点击节点，或在浏览模式按住 Shift 进行多选。</p>
                                            )}
                                            {selectedMergeNodeIds.map(nodeId => {
                                                const node = baseTopoNodes.find(item => item.id === nodeId)
                                                    ?? topoNodes.find(item => item.id === nodeId)
                                                if (!node) return null
                                                return (
                                                    <div key={nodeId} className="flex items-center gap-2 text-[11px] bg-white/5 rounded px-2 py-1">
                                                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TOPO_COLORS[node.type] }} />
                                                        <span className="text-gray-200 flex-1 truncate">{node.name}</span>
                                                        <button
                                                            onClick={() => toggleMergeSelection(nodeId)}
                                                            className="text-gray-500 hover:text-red-400 transition-colors"
                                                        >
                                                            <span className="material-symbols-outlined text-sm">close</span>
                                                        </button>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                        <div className="flex gap-1.5">
                                            <button
                                                onClick={() => setSelectedMergeNodeIds([])}
                                                disabled={selectedMergeNodeIds.length === 0}
                                                className="flex-1 bg-gray-800/60 hover:bg-gray-700 text-gray-300 py-2 rounded-lg text-xs transition-colors disabled:opacity-40"
                                            >
                                                清空选择
                                            </button>
                                            <button
                                                onClick={() => void handleCreateJunction()}
                                                disabled={selectedMergeNodeIds.length < 2}
                                                className="flex-1 bg-purple-700/80 hover:bg-purple-600 text-white py-2 rounded-lg text-xs transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                                            >
                                                <span className="material-symbols-outlined text-sm">hub</span>创建枢纽
                                            </button>
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
                                    <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">选择截断节点</p>
                                    <input
                                        className="w-full bg-gray-900/60 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 outline-none focus:border-red-500/50"
                                        placeholder="搜索节点名称..."
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
                                                        setCutoffNodeId(node.id)
                                                        setCutoffResult(null)
                                                        setCutoffSearch('')
                                                        setStatusMsg(`截断点已选：${node.name}`)
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
                                {cutoffNodeId && (
                                    <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-2">
                                        <p className="text-[10px] text-red-400 mb-0.5">截断点</p>
                                        <p className="text-xs text-white font-medium truncate">
                                            {topoNodes.find(n => n.id === cutoffNodeId)?.name ?? cutoffNodeId}
                                        </p>
                                    </div>
                                )}

                                {/* 操作按钮 */}
                                <div className="flex gap-1.5">
                                    <button
                                        onClick={runCutoffSimulation}
                                        disabled={!cutoffNodeId || topoNodes.length === 0}
                                        className="flex-1 bg-red-800/50 hover:bg-red-700 text-red-300 py-2 rounded-lg text-xs border border-red-700/40 transition-colors disabled:opacity-40 flex items-center justify-center gap-1">
                                        <span className="material-symbols-outlined text-sm">play_arrow</span>运行仿真
                                    </button>
                                    <button
                                        onClick={clearCutoffHighlight}
                                        disabled={!cutoffNodeId}
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
                                    <button
                                        onClick={() => {
                                            const group = junctionGroups.find(item => item.id === selectedNode.junctionId)
                                            if (group) handleDeleteJunction(group)
                                        }}
                                        className="w-full bg-red-700/80 hover:bg-red-600 text-white py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-sm">device_hub</span>解除捏合
                                    </button>
                                    <button
                                        onClick={() => setHistoryChartTarget({
                                            junctionId: selectedNode.junctionId ? `JUNCTION-${selectedNode.junctionId}` : selectedNode.id,
                                            displayName: selectedNode.name,
                                        })}
                                        className="w-full bg-blue-700/80 hover:bg-blue-600 text-white py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-sm">show_chart</span>查看枢纽历史
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
                                        <span className="material-symbols-outlined text-sm">hub</span>加入待捏合列表
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
