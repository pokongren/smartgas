/**
 * 地图拓扑管理视图（独立页面）
 *
 * 在高德地图上进行拓扑编辑、验证、搜索、关键节点识别。
 * 独立于全国管网统一视图和 Canvas 拓扑视图。
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import MapView from '@/components/map-view/MapView'
import { ALL_PIPELINES, PipelinePackage } from '@/data/pipelines'
import type { PipelineData, PipelineLine, PipelineNode } from '@/types'
import {
    validateTopology,
    computeBetweennessCentrality,
    findIsolatedNodes,
} from '@/utils/topology-validator'
import type { ValidationReport, ValidationIssue } from '@/utils/topology-validator'

// ================== 类型 ==================
type PointType = 'station' | 'valve' | 'distribution' | 'compressor'
type EditMode = 'view' | 'draw-point' | 'connect'
type PanelTab = 'edit' | 'validate' | 'search' | 'centrality'

interface EditorNode {
    id: string
    type: PointType
    name: string
    position: [number, number]
    marker?: any
}

interface EditorEdge {
    id: string
    startNodeId: string
    endNodeId: string
    name?: string
    poly?: any
}

// ================== 样式 ==================
const NODE_STYLES: Record<PointType, { color: string; label: string; icon: string }> = {
    compressor: { color: '#FF9800', label: '压气站', icon: 'compress' },
    distribution: { color: '#2196F3', label: '分输站', icon: 'hub' },
    station: { color: '#F44336', label: '站场', icon: 'location_on' },
    valve: { color: '#FFEB3B', label: '阀室', icon: 'radio_button_checked' },
}

const LINE_COLOR = '#4CAF50'

/** 从 PipelineNode 类型映射到编辑器 PointType */
const TYPE_MAP: Record<string, PointType> = {
    REGULATOR: 'compressor',
    METERING: 'distribution',
    VALVE: 'valve',
    JUNCTION: 'station',
}

// ================== 主组件 ==================
const MapTopologyView: React.FC = () => {
    // 地图
    const [mapInstance, setMapInstance] = useState<any>(null)
    const handleMapLoad = useCallback((map: any) => setMapInstance(map), [])

    // 图层可见性（与全局视图相同的机制）
    const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {}
        for (const pkg of ALL_PIPELINES) {
            for (const layer of pkg.layers) {
                initial[layer.name] = layer.visible ?? true
            }
        }
        return initial
    })

    const pipelineData = useMemo<PipelineData>(() => {
        const allNodes: PipelineNode[] = []
        const allLines: PipelineLine[] = []
        for (const pkg of ALL_PIPELINES) {
            for (const layer of pkg.layers) {
                if (visibleLayers[layer.name]) {
                    for (const n of layer.nodes) allNodes.push(n)
                    for (const l of layer.lines) allLines.push(l)
                }
            }
        }
        return { nodes: allNodes, lines: allLines, devices: [] }
    }, [visibleLayers])

    // 编辑器状态
    const [editorNodes, setEditorNodes] = useState<EditorNode[]>([])
    const [editorEdges, setEditorEdges] = useState<EditorEdge[]>([])
    const [editMode, setEditMode] = useState<EditMode>('view')
    const [pointType, setPointType] = useState<PointType>('station')
    const [connectFrom, setConnectFrom] = useState<string | null>(null)
    const [statusMsg, setStatusMsg] = useState('就绪 · 点击「导入管线」加载已有拓扑')
    const [activeTab, setActiveTab] = useState<PanelTab>('edit')

    // 搜索
    const [searchText, setSearchText] = useState('')

    // 验证
    const [report, setReport] = useState<ValidationReport | null>(null)
    const [centralityData, setCentralityData] = useState<Array<{ id: string; name: string; value: number }>>([])

    // Refs
    const nodesRef = useRef<EditorNode[]>([])
    const edgesRef = useRef<EditorEdge[]>([])
    const modeRef = useRef<EditMode>('view')
    const pointTypeRef = useRef<PointType>('station')
    const connectFromRef = useRef<string | null>(null)

    useEffect(() => { nodesRef.current = editorNodes; edgesRef.current = editorEdges }, [editorNodes, editorEdges])
    useEffect(() => { modeRef.current = editMode; pointTypeRef.current = pointType }, [editMode, pointType])
    useEffect(() => { connectFromRef.current = connectFrom }, [connectFrom])

    // ================== 地图交互 ==================
    useEffect(() => {
        if (!mapInstance) return
        const handleClick = (e: any) => {
            if (modeRef.current === 'draw-point') {
                addNode(e.lnglat, pointTypeRef.current)
            }
        }
        mapInstance.on('click', handleClick)
        return () => {
            mapInstance.off('click', handleClick)
            // 清理编辑器覆盖物
            nodesRef.current.forEach(n => n.marker?.setMap(null))
            edgesRef.current.forEach(e => e.poly?.setMap(null))
        }
    }, [mapInstance])

    // 同步光标
    useEffect(() => {
        if (!mapInstance) return
        mapInstance.setDefaultCursor(editMode === 'view' ? 'grab' : 'crosshair')
        if (editMode === 'draw-point') setStatusMsg(`绘制模式：点击地图添加「${NODE_STYLES[pointType].label}」`)
        else if (editMode === 'connect') { setStatusMsg('连线模式：点击起点节点'); setConnectFrom(null) }
        else setStatusMsg('浏览模式')
    }, [editMode, pointType, mapInstance])

    // ================== 节点操作 ==================
    const createMarkerHTML = (type: PointType): string => {
        const color = NODE_STYLES[type].color
        if (type === 'compressor') {
            return `<div style="width:18px;height:18px;background:${color};clip-path:polygon(20% 0%,80% 0%,100% 100%,0% 100%);border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5);"></div>`
        }
        const shape = type === 'valve' ? 'transform:rotate(45deg);border-radius:2px;' : type === 'distribution' ? 'border-radius:3px;' : 'border-radius:50%;'
        return `<div style="width:16px;height:16px;background:${color};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5);${shape}"></div>`
    }

    const addNode = (lnglat: any, type: PointType) => {
        const AMap = (window as any).AMap
        const id = `ed-${Date.now()}`
        const position: [number, number] = [lnglat.getLng(), lnglat.getLat()]

        const marker = new AMap.Marker({
            position: new AMap.LngLat(position[0], position[1]),
            content: createMarkerHTML(type),
            offset: new AMap.Pixel(-9, -9),
            draggable: true,
            cursor: 'move',
            zIndex: 200,
        })
        marker.setMap(mapInstance)

        marker.on('dragend', (e: any) => {
            const np: [number, number] = [e.lnglat.getLng(), e.lnglat.getLat()]
            setEditorNodes(prev => prev.map(n => n.id === id ? { ...n, position: np } : n))
            // 联动管线
            for (const edge of edgesRef.current) {
                if (edge.startNodeId === id || edge.endNodeId === id) {
                    const isStart = edge.startNodeId === id
                    const other = nodesRef.current.find(n => n.id === (isStart ? edge.endNodeId : edge.startNodeId))
                    if (other && edge.poly) edge.poly.setPath(isStart ? [np, other.position] : [other.position, np])
                }
            }
        })
        marker.on('click', () => handleNodeClick(id))

        const node: EditorNode = { id, type, name: `${NODE_STYLES[type].label}-${nodesRef.current.length + 1}`, position, marker }
        setEditorNodes(prev => [...prev, node])
        setStatusMsg(`已添加: ${node.name}`)
    }

    const handleNodeClick = (nodeId: string) => {
        if (modeRef.current !== 'connect') return
        const from = connectFromRef.current
        if (!from) {
            setConnectFrom(nodeId)
            const nd = nodesRef.current.find(n => n.id === nodeId)
            setStatusMsg(`已选起点「${nd?.name}」→ 请点击终点`)
        } else {
            if (nodeId === from) { setStatusMsg('不能连接自身'); return }
            addEdge(from, nodeId)
            setConnectFrom(null)
            setStatusMsg('连线成功，继续点击起点')
        }
    }

    const addEdge = (startId: string, endId: string) => {
        const start = nodesRef.current.find(n => n.id === startId)
        const end = nodesRef.current.find(n => n.id === endId)
        if (!start || !end) return
        const AMap = (window as any).AMap
        const id = `el-${Date.now()}`
        const poly = new AMap.Polyline({
            path: [start.position, end.position],
            strokeColor: LINE_COLOR,
            strokeWeight: 4,
            strokeStyle: 'solid',
            lineJoin: 'round',
            lineCap: 'round',
            zIndex: 150,
        })
        poly.setMap(mapInstance)
        setEditorEdges(prev => [...prev, { id, startNodeId: startId, endNodeId: endId, name: '新建管线', poly }])
    }

    // ================== 导入 ==================
    const importPipelines = useCallback(() => {
        if (!mapInstance) return
        const AMap = (window as any).AMap
        const srcNodes = pipelineData.nodes
        const srcLines = pipelineData.lines
        if (srcNodes.length === 0) { setStatusMsg('当前无可见管线数据'); return }

        const imported: EditorNode[] = []
        for (const sn of srcNodes) {
            const pos: [number, number] = [sn.coordinate.longitude, sn.coordinate.latitude]
            const type: PointType = TYPE_MAP[sn.type] || 'station'
            const marker = new AMap.Marker({
                position: new AMap.LngLat(pos[0], pos[1]),
                content: createMarkerHTML(type),
                offset: new AMap.Pixel(-9, -9),
                draggable: true,
                cursor: 'move',
                zIndex: 200,
            })
            marker.setMap(mapInstance)
            const nodeId = sn.id
            marker.on('dragend', (e: any) => {
                const np: [number, number] = [e.lnglat.getLng(), e.lnglat.getLat()]
                setEditorNodes(prev => prev.map(n => n.id === nodeId ? { ...n, position: np } : n))
                for (const edge of edgesRef.current) {
                    if (edge.startNodeId === nodeId || edge.endNodeId === nodeId) {
                        const isStart = edge.startNodeId === nodeId
                        const other = nodesRef.current.find(n => n.id === (isStart ? edge.endNodeId : edge.startNodeId))
                        if (other && edge.poly) edge.poly.setPath(isStart ? [np, other.position] : [other.position, np])
                    }
                }
            })
            marker.on('click', () => handleNodeClick(nodeId))
            imported.push({ id: sn.id, type, name: sn.name, position: pos, marker })
        }

        const importedEdges: EditorEdge[] = []
        for (const sl of srcLines) {
            const s = imported.find(n => n.id === sl.startNodeId)
            const e = imported.find(n => n.id === sl.endNodeId)
            if (!s || !e) continue
            const poly = new AMap.Polyline({
                path: [s.position, e.position],
                strokeColor: LINE_COLOR,
                strokeWeight: 3,
                strokeStyle: 'solid',
                zIndex: 150,
            })
            poly.setMap(mapInstance)
            importedEdges.push({ id: sl.id, startNodeId: sl.startNodeId, endNodeId: sl.endNodeId, name: sl.name, poly })
        }

        setEditorNodes(prev => [...prev, ...imported])
        setEditorEdges(prev => [...prev, ...importedEdges])
        setStatusMsg(`导入完成: ${imported.length} 节点, ${importedEdges.length} 条管线`)
    }, [mapInstance, pipelineData])

    // ================== 验证 ==================
    const runValidation = useCallback(() => {
        const gn = editorNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))
        const ge = editorEdges.map(e => ({ id: e.id, startNodeId: e.startNodeId, endNodeId: e.endNodeId, name: e.name }))
        const r = validateTopology(gn, ge)
        setReport(r)
        setStatusMsg(`验证完成: ${r.issues.length} 条告警`)
        setActiveTab('validate')
    }, [editorNodes, editorEdges])

    // ================== 介数中心性 ==================
    const runCentrality = useCallback(() => {
        const gn = editorNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))
        const ge = editorEdges.map(e => ({ id: e.id, startNodeId: e.startNodeId, endNodeId: e.endNodeId }))
        const c = computeBetweennessCentrality(gn, ge)
        const top = [...c.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([id, val]) => ({ id, name: editorNodes.find(n => n.id === id)?.name || id, value: Math.round(val * 100) }))
        setCentralityData(top)
        setStatusMsg(`已计算介数中心性, Top ${top.length} 节点`)
        setActiveTab('centrality')
    }, [editorNodes, editorEdges])

    // ================== 搜索 ==================
    const searchResults = useMemo(() => {
        if (!searchText.trim()) return []
        const kw = searchText.trim().toLowerCase()
        return editorNodes.filter(n => n.name.toLowerCase().includes(kw))
    }, [searchText, editorNodes])

    const flyTo = useCallback((node: EditorNode) => {
        if (!mapInstance) return
        mapInstance.setZoomAndCenter(10, node.position, true, 500)
        setStatusMsg(`已定位: ${node.name}`)
    }, [mapInstance])

    // ================== 导出 ==================
    const exportJSON = () => {
        const obj = {
            nodes: editorNodes.map(n => ({ id: n.id, name: n.name, type: n.type, position: n.position })),
            edges: editorEdges.map(e => ({ id: e.id, start: e.startNodeId, end: e.endNodeId, name: e.name })),
        }
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `topology_${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
        setStatusMsg(`已导出 ${editorNodes.length} 节点`)
    }

    const clearAll = () => {
        nodesRef.current.forEach(n => n.marker?.setMap(null))
        edgesRef.current.forEach(e => e.poly?.setMap(null))
        setEditorNodes([])
        setEditorEdges([])
        setReport(null)
        setCentralityData([])
        setStatusMsg('已清空')
    }

    // ================== 统计 ==================
    const stats = useMemo(() => ({
        nodes: editorNodes.length,
        edges: editorEdges.length,
        isolated: editorNodes.length > 0
            ? findIsolatedNodes(
                editorNodes.map(n => ({ id: n.id, name: n.name, type: n.type })),
                editorEdges.map(e => ({ id: e.id, startNodeId: e.startNodeId, endNodeId: e.endNodeId }))
            ).length
            : 0,
    }), [editorNodes, editorEdges])

    // ================== 渲染 ==================
    return (
        <div className="h-screen w-screen overflow-hidden relative bg-[#101922]">
            {/* 标题栏 */}
            <div className="absolute top-0 left-0 right-0 z-30 bg-[#0c1218]/90 backdrop-blur-md border-b border-cyan-500/30">
                <div className="px-6 py-3 flex justify-between items-center">
                    <div>
                        <h1 className="text-xl font-bold text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-2xl text-cyan-400">hub</span>
                            智脉平台 · 地图拓扑管理
                        </h1>
                        <p className="text-xs text-gray-400 mt-0.5">
                            节点 {stats.nodes} · 连线 {stats.edges} · 孤立 {stats.isolated}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={importPipelines}
                            className="px-3 py-1.5 bg-purple-600/80 hover:bg-purple-500 text-white text-xs rounded-lg transition-colors flex items-center gap-1"
                        >
                            <span className="material-symbols-outlined text-sm">download</span>
                            导入管线
                        </button>
                        <button
                            onClick={runValidation}
                            disabled={editorNodes.length === 0}
                            className="px-3 py-1.5 bg-cyan-600/80 hover:bg-cyan-500 text-white text-xs rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40"
                        >
                            <span className="material-symbols-outlined text-sm">verified</span>
                            验证拓扑
                        </button>
                        <button
                            onClick={runCentrality}
                            disabled={editorNodes.length < 3}
                            className="px-3 py-1.5 bg-amber-600/80 hover:bg-amber-500 text-white text-xs rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40"
                        >
                            <span className="material-symbols-outlined text-sm">stars</span>
                            关键节点
                        </button>
                    </div>
                </div>
            </div>

            {/* 地图（底层渲染已有管线） */}
            <MapView pipelineData={pipelineData} onLoad={handleMapLoad} />

            {/* 左侧编辑面板 */}
            <div className="absolute top-[68px] left-4 bottom-4 z-20 w-72 flex flex-col gap-2">
                {/* 标签页 */}
                <div className="bg-[#0c1218]/95 backdrop-blur-md rounded-xl border border-cyan-500/20 shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 90px)' }}>
                    <div className="flex border-b border-gray-700/40 shrink-0">
                        {([
                            { id: 'edit' as PanelTab, label: '编辑', icon: 'edit' },
                            { id: 'validate' as PanelTab, label: '验证', icon: 'verified' },
                            { id: 'search' as PanelTab, label: '搜索', icon: 'search' },
                            { id: 'centrality' as PanelTab, label: '枢纽', icon: 'stars' },
                        ]).map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 py-2.5 text-[11px] flex items-center justify-center gap-1 transition-all border-b-2
                                    ${activeTab === tab.id
                                        ? 'text-cyan-400 border-cyan-500 bg-cyan-500/5'
                                        : 'text-gray-500 border-transparent hover:text-gray-300'
                                    }`}
                            >
                                <span className="material-symbols-outlined text-sm">{tab.icon}</span>
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex-1 overflow-y-auto p-3">
                        {/* === 编辑 Tab === */}
                        {activeTab === 'edit' && (
                            <div className="space-y-3">
                                {/* 模式 */}
                                <div>
                                    <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wider">操作模式</p>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {([
                                            { m: 'view' as EditMode, label: '浏览', icon: 'pan_tool' },
                                            { m: 'draw-point' as EditMode, label: '添点', icon: 'add_location' },
                                            { m: 'connect' as EditMode, label: '连线', icon: 'timeline' },
                                        ]).map(item => (
                                            <button
                                                key={item.m}
                                                onClick={() => setEditMode(item.m)}
                                                className={`py-2 rounded-lg text-[11px] transition-all flex flex-col items-center gap-0.5
                                                    ${editMode === item.m ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20' : 'bg-gray-800/60 text-gray-400 hover:bg-gray-700'}`}
                                            >
                                                <span className="material-symbols-outlined text-base">{item.icon}</span>
                                                {item.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* 节点类型 */}
                                {editMode === 'draw-point' && (
                                    <div>
                                        <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wider">节点类型</p>
                                        <div className="grid grid-cols-2 gap-1.5">
                                            {(Object.entries(NODE_STYLES) as [PointType, typeof NODE_STYLES[PointType]][]).map(([key, style]) => (
                                                <button
                                                    key={key}
                                                    onClick={() => setPointType(key)}
                                                    className={`py-2 px-2 rounded-lg text-xs flex items-center gap-1.5 transition-all
                                                        ${pointType === key ? 'ring-1 ring-cyan-500 bg-gray-700 text-white' : 'bg-gray-800/40 text-gray-400 hover:bg-gray-700/60'}`}
                                                >
                                                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: style.color }} />
                                                    {style.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* 操作按钮 */}
                                <div className="flex gap-1.5 pt-1">
                                    <button onClick={exportJSON} disabled={editorNodes.length === 0} className="flex-1 bg-green-900/40 hover:bg-green-800 text-green-400 py-2 rounded-lg text-xs border border-green-800/40 transition-colors disabled:opacity-40">
                                        导出
                                    </button>
                                    <button onClick={clearAll} disabled={editorNodes.length === 0} className="flex-1 bg-red-900/40 hover:bg-red-800 text-red-400 py-2 rounded-lg text-xs border border-red-800/40 transition-colors disabled:opacity-40">
                                        清空
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* === 验证 Tab === */}
                        {activeTab === 'validate' && (
                            <div className="space-y-2">
                                {!report ? (
                                    <div className="text-center py-6">
                                        <span className="material-symbols-outlined text-4xl text-gray-600">verified</span>
                                        <p className="text-gray-500 text-xs mt-2">点击顶栏「验证拓扑」开始</p>
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
                                                    <span className="material-symbols-outlined text-[10px] mr-1 align-middle">{issue.level === 'error' ? 'error' : 'warning'}</span>
                                                    {issue.message}
                                                </div>
                                            ))}
                                            {report.issues.length === 0 && <p className="text-center text-gray-500 text-[10px] py-3">无问题 🎉</p>}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* === 搜索 Tab === */}
                        {activeTab === 'search' && (
                            <div className="space-y-2">
                                <input
                                    className="w-full bg-gray-900/60 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 outline-none focus:border-cyan-500/50"
                                    placeholder="输入站场名称..."
                                    value={searchText}
                                    onChange={e => setSearchText(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && searchResults.length > 0) flyTo(searchResults[0]) }}
                                />
                                <div className="max-h-72 overflow-y-auto space-y-1">
                                    {searchText.trim() && searchResults.length === 0 && <p className="text-center text-gray-500 text-[10px] py-3">无匹配</p>}
                                    {searchResults.map(node => (
                                        <button key={node.id} onClick={() => flyTo(node)} className="w-full flex items-center gap-2 p-2 rounded-lg text-xs hover:bg-white/5 transition-colors text-left">
                                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: NODE_STYLES[node.type]?.color || '#999' }} />
                                            <span className="text-gray-300 flex-1 truncate">{node.name}</span>
                                            <span className="material-symbols-outlined text-gray-500 text-sm">my_location</span>
                                        </button>
                                    ))}
                                    {!searchText.trim() && <p className="text-center text-gray-500 text-[10px] py-3">{editorNodes.length > 0 ? `${editorNodes.length} 个节点可搜索` : '请先导入数据'}</p>}
                                </div>
                            </div>
                        )}

                        {/* === 关键枢纽 Tab === */}
                        {activeTab === 'centrality' && (
                            <div className="space-y-2">
                                {centralityData.length === 0 ? (
                                    <div className="text-center py-6">
                                        <span className="material-symbols-outlined text-4xl text-gray-600">stars</span>
                                        <p className="text-gray-500 text-xs mt-2">点击顶栏「关键节点」开始计算</p>
                                        <p className="text-gray-600 text-[10px] mt-1">基于介数中心性算法</p>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-[10px] text-gray-500">介数中心性 Top {centralityData.length}（值越高=越关键）</p>
                                        {centralityData.map((node, i) => (
                                            <button key={node.id} onClick={() => { const n = editorNodes.find(x => x.id === node.id); if (n) flyTo(n) }}
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

                    {/* 底部状态 */}
                    <div className="px-3 py-2 bg-[#080d12] border-t border-gray-800/60 text-[10px] text-gray-500 truncate shrink-0 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[10px]">info</span>
                        {statusMsg}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default MapTopologyView
