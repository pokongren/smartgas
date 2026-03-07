
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { validateTopology, computeBetweennessCentrality } from '@/utils/topology-validator'
import type { ValidationReport } from '@/utils/topology-validator'
import { ALL_PIPELINES } from '@/data/pipelines'

// ================== 类型定义 ==================
type EditMode = 'view' | 'draw-point' | 'connect-mode'
type PointType = 'station' | 'valve' | 'distribution' | 'compressor'

interface GraphNode {
    id: string
    type: PointType
    name: string
    position: [number, number] // [lng, lat]
    marker?: any // AMap.Marker 实例
}

interface GraphEdge {
    id: string
    startNodeId: string
    endNodeId: string
    pipelineName?: string
    poly?: any // AMap.Polyline 实例
}

// ================== 样式配置 ==================
const STYLES = {
    station: { color: '#F44336', radius: 6, stroke: 2 },
    valve: { color: '#FFEB3B', radius: 4, stroke: 1 },
    distribution: { color: '#2196F3', radius: 6, stroke: 2 },
    compressor: { color: '#FF9800', radius: 8, stroke: 2 },
    line: { color: '#4CAF50', weight: 4 }
}

/** 节点类型映射到编辑器 PointType */
const NODE_TYPE_MAP: Record<string, PointType> = {
    REGULATOR: 'compressor',
    METERING: 'distribution',
    VALVE: 'valve',
    JUNCTION: 'station',
}

// ================== 子面板标签页 ==================
type TabId = 'tools' | 'validate' | 'search'

interface PipelineEditorOverlayProps {
    mapInstance: any
    onClose: () => void
    /** 传入当前可见的管线节点数据，用于"导入已有数据"功能 */
    existingNodes?: Array<{ id: string; name: string; type: string; coordinate: { longitude: number; latitude: number } }>
    existingLines?: Array<{ id: string; startNodeId: string; endNodeId: string; name?: string; path?: Array<{ longitude: number; latitude: number }> }>
}

const PipelineEditorOverlay: React.FC<PipelineEditorOverlayProps> = ({
    mapInstance,
    onClose,
    existingNodes,
    existingLines,
}) => {
    // 数据状态
    const [nodes, setNodes] = useState<GraphNode[]>([])
    const [edges, setEdges] = useState<GraphEdge[]>([])

    // 交互状态
    const [mode, setMode] = useState<EditMode>('view')
    const [pointType, setPointType] = useState<PointType>('station')
    const [statusMsg, setStatusMsg] = useState('就绪')
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<TabId>('tools')

    // 搜索状态
    const [searchText, setSearchText] = useState('')

    // 验证状态
    const [validationReport, setValidationReport] = useState<ValidationReport | null>(null)
    const [centralityMap, setCentralityMap] = useState<Map<string, number>>(new Map())

    // 引用
    const nodesRef = useRef<GraphNode[]>([])
    const edgesRef = useRef<GraphEdge[]>([])
    const modeRef = useRef<EditMode>('view')
    const pointTypeRef = useRef<PointType>('station')
    const selectedNodeIdRef = useRef<string | null>(null)

    // 同步 Ref
    useEffect(() => {
        nodesRef.current = nodes
        edgesRef.current = edges
    }, [nodes, edges])

    useEffect(() => {
        selectedNodeIdRef.current = selectedNodeId
    }, [selectedNodeId])

    useEffect(() => {
        modeRef.current = mode
        pointTypeRef.current = pointType

        if (mapInstance) {
            mapInstance.setDefaultCursor(mode === 'view' ? 'grab' : 'crosshair')
        }

        if (mode === 'connect-mode') {
            setStatusMsg('连线模式：请点击起点节点')
            setSelectedNodeId(null)
        } else if (mode === 'draw-point') {
            setStatusMsg(`绘制模式：点击地图添加 ${pointType}`)
        } else {
            setStatusMsg('浏览模式')
        }
    }, [mode, pointType, mapInstance])

    // ================== 初始化 ==================
    useEffect(() => {
        if (!mapInstance) return

        const onClick = (e: any) => {
            if (modeRef.current === 'draw-point') {
                addNode(e.lnglat, pointTypeRef.current)
            }
        }

        mapInstance.on('click', onClick)

        return () => {
            mapInstance.off('click', onClick)
            clearEditorOverlays()
        }
    }, [mapInstance])

    // ================== 搜索逻辑 ==================
    const searchResults = useMemo(() => {
        if (!searchText.trim()) return []
        const kw = searchText.trim().toLowerCase()
        return nodes.filter(n => n.name.toLowerCase().includes(kw))
    }, [searchText, nodes])

    /**
     * 搜索定位 —— 飞行到目标节点
     */
    const flyToNode = useCallback((node: GraphNode) => {
        if (!mapInstance) return
        mapInstance.setZoomAndCenter(10, node.position, true, 500)
        setStatusMsg(`已定位: ${node.name}`)
    }, [mapInstance])

    // ================== 验证逻辑 ==================
    const runValidation = useCallback(() => {
        const graphNodes = nodes.map(n => ({ id: n.id, name: n.name, type: n.type }))
        const graphEdges = edges.map(e => ({ id: e.id, startNodeId: e.startNodeId, endNodeId: e.endNodeId, name: e.pipelineName }))
        const report = validateTopology(graphNodes, graphEdges)
        setValidationReport(report)

        // 同步计算介数中心性
        if (graphNodes.length >= 3) {
            const centrality = computeBetweennessCentrality(graphNodes, graphEdges)
            setCentralityMap(centrality)
        }

        setStatusMsg(`验证完成: ${report.issues.length} 条告警`)
        setActiveTab('validate')
    }, [nodes, edges])

    // ================== 导入已有管线数据 ==================
    const importExistingData = useCallback(() => {
        if (!mapInstance) return
        const AMap = (window as any).AMap

        // 收集所有可见管线的完整节点和线段数据
        const sourceNodes = existingNodes || []
        const sourceLines = existingLines || []

        if (sourceNodes.length === 0) {
            setStatusMsg('当前视图中没有可导入的管线数据')
            return
        }

        const importedNodes: GraphNode[] = []
        const importedEdges: GraphEdge[] = []

        // NOTE: 批量导入时不在地图上创建新的 marker/polyline
        // 只导入数据模型，让用户后续在编辑器内操作
        for (const sn of sourceNodes) {
            const position: [number, number] = [sn.coordinate.longitude, sn.coordinate.latitude]
            const type: PointType = NODE_TYPE_MAP[sn.type] || 'station'

            const markerContent = createMarkerContent(type)
            const marker = new AMap.Marker({
                position: new AMap.LngLat(position[0], position[1]),
                content: markerContent,
                offset: new AMap.Pixel(-8, -8),
                draggable: true,
                cursor: 'move',
                extData: { id: sn.id },
                zIndex: 100,
            })
            marker.setMap(mapInstance)

            // 绑定拖拽和点击事件
            const nodeId = sn.id
            marker.on('dragend', (e: any) => {
                updateNodePosition(nodeId, [e.lnglat.getLng(), e.lnglat.getLat()])
            })
            marker.on('click', () => {
                handleNodeClick(nodeId)
            })

            importedNodes.push({
                id: sn.id,
                type,
                name: sn.name,
                position,
                marker,
            })
        }

        // 导入连线
        for (const sl of sourceLines) {
            const startNode = importedNodes.find(n => n.id === sl.startNodeId)
            const endNode = importedNodes.find(n => n.id === sl.endNodeId)
            if (!startNode || !endNode) continue

            const polyline = new AMap.Polyline({
                path: [startNode.position, endNode.position],
                strokeColor: STYLES.line.color,
                strokeWeight: STYLES.line.weight,
                strokeStyle: 'solid',
                lineJoin: 'round',
                lineCap: 'round',
                zIndex: 90,
            })
            polyline.setMap(mapInstance)

            importedEdges.push({
                id: sl.id,
                startNodeId: sl.startNodeId,
                endNodeId: sl.endNodeId,
                pipelineName: sl.name,
                poly: polyline,
            })
        }

        setNodes(prev => [...prev, ...importedNodes])
        setEdges(prev => [...prev, ...importedEdges])
        setStatusMsg(`已导入 ${importedNodes.length} 节点, ${importedEdges.length} 条管线`)
    }, [mapInstance, existingNodes, existingLines])

    // ================== 节点操作 ==================
    const clearEditorOverlays = () => {
        nodesRef.current.forEach(n => n.marker?.setMap(null))
        edgesRef.current.forEach(e => e.poly?.setMap(null))
    }

    const addNode = (lnglat: any, type: PointType) => {
        const AMap = (window as any).AMap

        const id = `node-${Date.now()}`
        const position: [number, number] = [lnglat.getLng(), lnglat.getLat()]

        const markerContent = createMarkerContent(type)
        const marker = new AMap.Marker({
            position: new AMap.LngLat(position[0], position[1]),
            content: markerContent,
            offset: new AMap.Pixel(-8, -8),
            draggable: true,
            cursor: 'move',
            extData: { id },
            zIndex: 100,
        })

        marker.setMap(mapInstance)

        marker.on('dragend', (e: any) => {
            updateNodePosition(id, [e.lnglat.getLng(), e.lnglat.getLat()])
        })

        marker.on('click', () => {
            handleNodeClick(id)
        })

        const newNode: GraphNode = {
            id, type, name: `${type}-${nodesRef.current.length + 1}`,
            position, marker
        }

        setNodes(prev => [...prev, newNode])
        setStatusMsg(`已添加 ${type}: ${newNode.name}`)
    }

    const updateNodePosition = (nodeId: string, newPos: [number, number]) => {
        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, position: newPos } : n))

        const connectedEdges = edgesRef.current.filter(e => e.startNodeId === nodeId || e.endNodeId === nodeId)
        connectedEdges.forEach(edge => {
            const isStart = edge.startNodeId === nodeId
            const otherNodeId = isStart ? edge.endNodeId : edge.startNodeId
            const otherNode = nodesRef.current.find(n => n.id === otherNodeId)

            if (otherNode && edge.poly) {
                const path = isStart ? [newPos, otherNode.position] : [otherNode.position, newPos]
                edge.poly.setPath(path)
            }
        })
    }

    const handleNodeClick = (clickedNodeId: string) => {
        if (modeRef.current === 'connect-mode') {
            const currentSelected = selectedNodeIdRef.current
            if (!currentSelected) {
                setSelectedNodeId(clickedNodeId)
                setStatusMsg('已选中起点，请点击终点')
            } else {
                if (clickedNodeId === currentSelected) {
                    setStatusMsg('不能连接同一个点')
                    return
                }
                addEdge(currentSelected, clickedNodeId)
                setSelectedNodeId(null)
                setStatusMsg('连接成功，请继续点击起点')
            }
        }
    }

    const addEdge = (startId: string, endId: string) => {
        const startNode = nodesRef.current.find(n => n.id === startId)
        const endNode = nodesRef.current.find(n => n.id === endId)
        if (!startNode || !endNode) return

        const AMap = (window as any).AMap
        const id = `edge-${Date.now()}`

        const polyline = new AMap.Polyline({
            path: [startNode.position, endNode.position],
            strokeColor: STYLES.line.color,
            strokeWeight: STYLES.line.weight,
            strokeStyle: 'solid',
            lineJoin: 'round',
            lineCap: 'round',
            zIndex: 90,
            cursor: 'pointer',
        })

        polyline.setMap(mapInstance)

        const newEdge: GraphEdge = {
            id, startNodeId: startId, endNodeId: endId,
            pipelineName: '新建管线', poly: polyline
        }

        setEdges(prev => [...prev, newEdge])
    }

    const createMarkerContent = (type: PointType) => {
        let color = '#fff'
        let className = 'w-4 h-4 border-2 border-white shadow-md'

        switch (type) {
            case 'station':
                color = STYLES.station.color; className += ' rounded-full'; break
            case 'valve':
                color = STYLES.valve.color; className += ' rounded-none transform rotate-45'; break
            case 'distribution':
                color = STYLES.distribution.color; className += ' rounded-sm'; break
            case 'compressor':
                color = STYLES.compressor.color
                return `<div style="width: 16px; height: 16px; background: ${color}; clip-path: polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%); border: 1px solid white;"></div>`
        }
        return `<div class="${className}" style="background-color: ${color};"></div>`
    }

    const exportData = () => {
        const exportObj = {
            nodes: nodes.map(n => ({ id: n.id, name: n.name, type: n.type, position: n.position })),
            edges: edges.map(e => ({ id: e.id, start: e.startNodeId, end: e.endNodeId, name: e.pipelineName })),
        }
        const jsonStr = JSON.stringify(exportObj, null, 2)
        // 下载为文件
        const blob = new Blob([jsonStr], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `topology_export_${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
        setStatusMsg(`已导出 ${nodes.length} 节点, ${edges.length} 条管线`)
    }

    const clearAll = () => {
        clearEditorOverlays()
        setNodes([])
        setEdges([])
        setValidationReport(null)
        setCentralityMap(new Map())
        setStatusMsg('已清空')
    }

    // 介数中心性 Top5
    const topCentralityNodes = useMemo(() => {
        if (centralityMap.size === 0) return []
        return [...centralityMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([id, value]) => {
                const node = nodes.find(n => n.id === id)
                return { id, name: node?.name || id, value: Math.round(value * 100) }
            })
    }, [centralityMap, nodes])

    // ================== 渲染 ==================
    return (
        <div className="absolute top-24 right-6 z-20 flex flex-col gap-2 pointer-events-auto">
            {/* 主控面板 */}
            <div className="bg-[#0c1218]/95 backdrop-blur-md rounded-lg border border-blue-500/30 w-72 shadow-2xl overflow-hidden">
                {/* 标题栏 */}
                <div className="flex justify-between items-center px-3 py-2.5 border-b border-gray-700/60 bg-[#0c1218]">
                    <span className="text-blue-400 font-bold text-sm flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-base">hub</span>
                        拓扑编辑器
                    </span>
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-[10px]">
                            {nodes.length}节点 {edges.length}边
                        </span>
                        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                            <span className="material-symbols-outlined text-base">close</span>
                        </button>
                    </div>
                </div>

                {/* 标签页 */}
                <div className="flex border-b border-gray-700/40">
                    {([
                        { id: 'tools' as TabId, label: '绘制', icon: 'edit' },
                        { id: 'validate' as TabId, label: '验证', icon: 'verified' },
                        { id: 'search' as TabId, label: '搜索', icon: 'search' },
                    ]).map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex-1 py-2 text-xs flex items-center justify-center gap-1 transition-all border-b-2
                                ${activeTab === tab.id
                                    ? 'text-blue-400 border-blue-500 bg-blue-500/5'
                                    : 'text-gray-500 border-transparent hover:text-gray-300'
                                }`}
                        >
                            <span className="material-symbols-outlined text-sm">{tab.icon}</span>
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* 面板内容 */}
                <div className="p-3">
                    {/* === 绘制工具 === */}
                    {activeTab === 'tools' && (
                        <div className="space-y-2">
                            {/* 模式切换 */}
                            <div className="grid grid-cols-2 gap-1.5">
                                <button
                                    onClick={() => setMode('view')}
                                    className={`px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-center gap-1 ${mode === 'view' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                                >
                                    <span className="material-symbols-outlined text-sm">pan_tool</span>浏览
                                </button>
                                <button
                                    onClick={() => setMode('connect-mode')}
                                    className={`px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-center gap-1 ${mode === 'connect-mode' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                                >
                                    <span className="material-symbols-outlined text-sm">timeline</span>连线
                                </button>
                            </div>

                            {/* 绘制点类型 */}
                            <div className="grid grid-cols-2 gap-1.5">
                                {[
                                    { id: 'station', label: '站场', icon: 'location_on', color: 'text-red-400' },
                                    { id: 'compressor', label: '压气站', icon: 'compress', color: 'text-orange-400' },
                                    { id: 'valve', label: '阀室', icon: 'radio_button_checked', color: 'text-yellow-400' },
                                    { id: 'distribution', label: '分输', icon: 'hub', color: 'text-blue-400' },
                                ].map(type => (
                                    <button
                                        key={type.id}
                                        onClick={() => { setMode('draw-point'); setPointType(type.id as PointType) }}
                                        className={`px-2 py-1.5 rounded text-xs transition-all flex items-center gap-1
                                            ${mode === 'draw-point' && pointType === type.id
                                                ? 'bg-gray-700 text-white ring-1 ring-blue-500'
                                                : 'text-gray-300 hover:bg-gray-800'
                                            }
                                        `}
                                    >
                                        <span className={`material-symbols-outlined text-sm ${type.color}`}>{type.icon}</span>
                                        {type.label}
                                    </button>
                                ))}
                            </div>

                            {/* 导入 + 操作按钮 */}
                            <div className="flex gap-1.5">
                                <button
                                    onClick={importExistingData}
                                    className="flex-1 bg-purple-900/40 hover:bg-purple-800 text-purple-300 py-1.5 rounded text-xs border border-purple-800/50 transition-colors flex items-center justify-center gap-1"
                                >
                                    <span className="material-symbols-outlined text-sm">download</span>
                                    导入管线
                                </button>
                                <button
                                    onClick={runValidation}
                                    className="flex-1 bg-cyan-900/40 hover:bg-cyan-800 text-cyan-300 py-1.5 rounded text-xs border border-cyan-800/50 transition-colors flex items-center justify-center gap-1"
                                >
                                    <span className="material-symbols-outlined text-sm">verified</span>
                                    运行验证
                                </button>
                            </div>

                            <div className="flex gap-1.5">
                                <button onClick={exportData} className="flex-1 bg-green-900/40 hover:bg-green-800 text-green-300 py-1.5 rounded text-xs border border-green-800/50 transition-colors">
                                    导出 JSON
                                </button>
                                <button onClick={clearAll} className="flex-1 bg-red-900/40 hover:bg-red-800 text-red-300 py-1.5 rounded text-xs border border-red-800/50 transition-colors">
                                    清空
                                </button>
                            </div>
                        </div>
                    )}

                    {/* === 验证结果 === */}
                    {activeTab === 'validate' && (
                        <div className="space-y-2">
                            {!validationReport ? (
                                <div className="text-center py-4">
                                    <p className="text-gray-500 text-xs mb-2">尚未运行验证</p>
                                    <button
                                        onClick={runValidation}
                                        className="bg-cyan-900/40 hover:bg-cyan-800 text-cyan-300 px-4 py-1.5 rounded text-xs border border-cyan-800/50 transition-colors"
                                    >
                                        运行验证
                                    </button>
                                </div>
                            ) : (
                                <>
                                    {/* 统计概览 */}
                                    <div className={`p-2 rounded text-xs border ${validationReport.passed ? 'bg-green-900/20 border-green-800/50 text-green-400' : 'bg-red-900/20 border-red-800/50 text-red-400'}`}>
                                        <div className="flex items-center gap-1 font-bold mb-1">
                                            <span className="material-symbols-outlined text-sm">
                                                {validationReport.passed ? 'check_circle' : 'error'}
                                            </span>
                                            {validationReport.passed ? '验证通过' : `发现 ${validationReport.issues.length} 条问题`}
                                        </div>
                                        <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-400">
                                            <span>节点: {validationReport.stats.nodeCount}</span>
                                            <span>连线: {validationReport.stats.edgeCount}</span>
                                            <span>孤立: {validationReport.stats.isolatedCount}</span>
                                            <span>连通分量: {validationReport.stats.componentCount}</span>
                                        </div>
                                    </div>

                                    {/* 告警列表 */}
                                    <div className="max-h-36 overflow-y-auto space-y-1">
                                        {validationReport.issues.map((issue, i) => (
                                            <div
                                                key={i}
                                                className={`p-1.5 rounded text-[10px] border ${issue.level === 'error'
                                                    ? 'border-red-800/40 bg-red-900/10 text-red-400'
                                                    : issue.level === 'warning'
                                                        ? 'border-yellow-800/40 bg-yellow-900/10 text-yellow-400'
                                                        : 'border-gray-700/40 bg-gray-900/10 text-gray-400'
                                                    }`}
                                            >
                                                <span className="material-symbols-outlined text-[10px] mr-1 align-middle">
                                                    {issue.level === 'error' ? 'error' : issue.level === 'warning' ? 'warning' : 'info'}
                                                </span>
                                                {issue.message}
                                            </div>
                                        ))}
                                        {validationReport.issues.length === 0 && (
                                            <p className="text-center text-gray-500 text-[10px] py-2">没有发现问题 🎉</p>
                                        )}
                                    </div>

                                    {/* 介数中心性 Top5 */}
                                    {topCentralityNodes.length > 0 && (
                                        <div className="border-t border-gray-700/40 pt-2">
                                            <p className="text-[10px] text-gray-500 mb-1 flex items-center gap-1">
                                                <span className="material-symbols-outlined text-[10px]">stars</span>
                                                关键枢纽节点 (介数中心性 Top5)
                                            </p>
                                            {topCentralityNodes.map(node => (
                                                <div key={node.id} className="flex items-center gap-2 text-[10px] py-0.5">
                                                    <span className="text-blue-400 flex-1 truncate">{node.name}</span>
                                                    <div className="w-16 h-1.5 bg-gray-800 rounded overflow-hidden">
                                                        <div
                                                            className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded"
                                                            style={{ width: `${node.value}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-gray-500 w-8 text-right">{node.value}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* === 搜索定位 === */}
                    {activeTab === 'search' && (
                        <div className="space-y-2">
                            <div className="flex gap-1.5">
                                <input
                                    className="flex-1 bg-gray-900/60 border border-gray-700/60 rounded px-2 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-blue-500/50"
                                    type="text"
                                    placeholder="输入站场名称..."
                                    value={searchText}
                                    onChange={e => setSearchText(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && searchResults.length > 0) {
                                            flyToNode(searchResults[0])
                                        }
                                    }}
                                />
                            </div>
                            <div className="max-h-48 overflow-y-auto space-y-1">
                                {searchText.trim() && searchResults.length === 0 && (
                                    <p className="text-center text-gray-500 text-[10px] py-2">无匹配结果</p>
                                )}
                                {searchResults.map(node => (
                                    <button
                                        key={node.id}
                                        onClick={() => flyToNode(node)}
                                        className="w-full flex items-center gap-2 p-1.5 rounded text-xs hover:bg-white/5 transition-colors text-left"
                                    >
                                        <span
                                            className="w-2 h-2 rounded-full shrink-0"
                                            style={{ backgroundColor: STYLES[node.type]?.color || '#999' }}
                                        />
                                        <span className="text-gray-300 flex-1 truncate">{node.name}</span>
                                        <span className="material-symbols-outlined text-gray-500 text-sm">my_location</span>
                                    </button>
                                ))}
                                {!searchText.trim() && nodes.length > 0 && (
                                    <p className="text-center text-gray-500 text-[10px] py-2">
                                        共 {nodes.length} 个节点可搜索
                                    </p>
                                )}
                                {nodes.length === 0 && (
                                    <p className="text-center text-gray-500 text-[10px] py-2">
                                        请先添加或导入节点
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* 底部状态栏 */}
                <div className="px-3 py-2 bg-gray-900/50 border-t border-gray-700/40 text-[10px] text-gray-500 truncate flex items-center gap-1">
                    <span className="material-symbols-outlined text-[10px]">info</span>
                    {statusMsg}
                </div>
            </div>

            {/* 快捷帮助 */}
            <div className="bg-black/60 backdrop-blur rounded p-2 text-[10px] text-gray-500 max-w-[288px] leading-relaxed">
                拖拽节点可调整位置，管线自动跟随 · 点击「导入管线」可加载已有数据进行编辑
            </div>
        </div>
    )
}

export default PipelineEditorOverlay
