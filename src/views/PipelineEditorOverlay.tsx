
import React, { useEffect, useRef, useState } from 'react'

// ================== 类型定义 ==================
type EditMode = 'view' | 'draw-point' | 'draw-line' | 'connect-mode'
type PointType = 'station' | 'valve' | 'distribution' | 'compressor'

interface GraphNode {
    id: string
    type: PointType
    name: string
    position: [number, number] // [lng, lat]
    marker?: any // AMap.Marker instance
}

interface GraphEdge {
    id: string
    startNodeId: string
    endNodeId: string
    pipelineName?: string
    poly?: any // AMap.Polyline instance
}

// ================== 样式配置 ==================
const STYLES = {
    station: { color: '#F44336', radius: 6, stroke: 2 },
    valve: { color: '#FFEB3B', radius: 4, stroke: 1 },
    distribution: { color: '#2196F3', radius: 6, stroke: 2 },
    compressor: { color: '#FF9800', radius: 8, stroke: 2 },
    line: { color: '#4CAF50', weight: 4 }
}

interface PipelineEditorOverlayProps {
    mapInstance: any
    onClose: () => void
}

const PipelineEditorOverlay: React.FC<PipelineEditorOverlayProps> = ({ mapInstance, onClose }) => {
    // 数据状态
    const [nodes, setNodes] = useState<GraphNode[]>([])
    const [edges, setEdges] = useState<GraphEdge[]>([])

    // 交互状态
    const [mode, setMode] = useState<EditMode>('view')
    const [pointType, setPointType] = useState<PointType>('station')
    const [statusMsg, setStatusMsg] = useState('就绪')
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

    // 引用
    const nodesRef = useRef<GraphNode[]>([])
    const edgesRef = useRef<GraphEdge[]>([])
    const mouseToolRef = useRef<any>(null)
    const modeRef = useRef<EditMode>('view')
    const pointTypeRef = useRef<PointType>('station')

    // 同步 Ref
    useEffect(() => {
        nodesRef.current = nodes
        edgesRef.current = edges
    }, [nodes, edges])

    useEffect(() => {
        modeRef.current = mode
        pointTypeRef.current = pointType

        if (mapInstance) {
            mapInstance.setDefaultCursor(mode === 'view' ? 'grab' : 'crosshair')
        }

        if (mode === 'connect-mode') {
            setStatusMsg('请点击起点')
            setSelectedNodeId(null)
        }
    }, [mode, pointType, mapInstance])

    // 初始化工具
    useEffect(() => {
        if (!mapInstance) return

        // 初始化 MouseTool (如果需要自由绘制，目前暂未使用，保留备用)
        // 注意：AMap.MouseTool 需要确保插件已加载。GlobalView 中 MapView 应该已经加载了 MouseTool 插件吗？
        // MapView.tsx 中加载了 AMap.ToolBar 等，但 MouseTool 不一定。
        // 为了安全，我们假设 MapView 可能没加载 MouseTool，需要在 GlobalView 加载时包含它，或者在这里补救？
        // AMapLoader.load 是单例的，可以再次调用。
        // 但这里我们只用 Marker 和 Polyline API，不一定非要 MouseTool。
        // 之前的 PipelineEditor 用了 MouseTool 但其实我们主要靠 click event。
        // 我们这里不再使用 MouseTool，直接用 map click。

        const onClick = (e: any) => {
            if (modeRef.current === 'draw-point') {
                addNode(e.lnglat, pointTypeRef.current)
            }
        }

        mapInstance.on('click', onClick)

        return () => {
            mapInstance.off('click', onClick)
            // 清理所有覆盖物
            // 注意：不应该清理 MapView 渲染的基础管网，只清理编辑器添加的
            clearEditorOverlays()
        }
    }, [mapInstance])

    // 清理覆盖物
    const clearEditorOverlays = () => {
        nodesRef.current.forEach(n => n.marker?.setMap(null))
        edgesRef.current.forEach(e => e.poly?.setMap(null))
    }

    // 2. 添加节点
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
            zIndex: 100 // 确保在最上层
        })

        marker.setMap(mapInstance)

        marker.on('dragend', (e: any) => {
            updateNodePosition(id, [e.lnglat.getLng(), e.lnglat.getLat()])
        })

        marker.on('click', (e: any) => {
            handleNodeClick(id)
        })

        const newNode: GraphNode = {
            id, type, name: `${type}-${nodesRef.current.length + 1}`,
            position, marker
        }

        setNodes(prev => [...prev, newNode])
        setStatusMsg(`已添加 ${type}: ${newNode.name}`)
    }

    // 3. 更新节点位置 & 联动
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

    // 4. 处理节点点击
    const handleNodeClick = (clickedNodeId: string) => {
        if (modeRef.current === 'connect-mode') {
            if (!selectedNodeId) {
                setSelectedNodeId(clickedNodeId)
                setStatusMsg('已选中起点，请点击终点')
            } else {
                if (clickedNodeId === selectedNodeId) {
                    setStatusMsg('不能连接同一个点')
                    return
                }
                addEdge(selectedNodeId, clickedNodeId)
                setSelectedNodeId(null)
                setStatusMsg('连接成功，请继续点击起点')
            }
        }
    }

    // 5. 添加连线
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
            cursor: 'pointer' // 暂时不支持拖拽线，只能拖拽点
        })

        polyline.setMap(mapInstance)

        const newEdge: GraphEdge = {
            id, startNodeId: startId, endNodeId: endId,
            pipelineName: '新建管线', poly: polyline
        }

        setEdges(prev => [...prev, newEdge])
    }

    // 辅助: 创建 Marker 内容
    const createMarkerContent = (type: PointType) => {
        let color = '#fff'
        let className = 'w-4 h-4 border-2 border-white shadow-md'

        switch (type) {
            case 'station':
                color = STYLES.station.color; className += ' rounded-full'; break;
            case 'valve':
                color = STYLES.valve.color; className += ' rounded-none transform rotate-45'; break;
            case 'distribution':
                color = STYLES.distribution.color; className += ' rounded-sm'; break;
            case 'compressor':
                color = STYLES.compressor.color;
                return `<div style="width: 16px; height: 16px; background: ${color}; clip-path: polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%); border: 1px solid white;"></div>`
        }
        return `<div class="${className}" style="background-color: ${color};"></div>`
    }

    const exportData = () => {
        const exportObj = {
            nodes: nodes.map(n => ({ id: n.id, name: n.name, type: n.type, position: n.position })),
            edges: edges.map(e => ({ id: e.id, start: e.startNodeId, end: e.endNodeId }))
        }
        console.log(JSON.stringify(exportObj, null, 2))
        alert(`已导出 ${nodes.length} 个节点, ${edges.length} 条管线 (查看控制台)`)
    }

    const clearAll = () => {
        nodesRef.current.forEach(n => n.marker?.setMap(null))
        edgesRef.current.forEach(e => e.poly?.setMap(null))
        setNodes([])
        setEdges([])
        setStatusMsg('已清空')
    }

    // 渲染 UI (Toolbar)
    return (
        <div className="absolute top-24 right-6 z-20 flex flex-col gap-2 pointer-events-auto">
            {/* 主控面板 */}
            <div className="bg-black/80 backdrop-blur rounded-lg border border-blue-500/30 p-2 w-64 shadow-2xl">
                <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-700">
                    <span className="text-blue-400 font-bold text-sm">绘图工具</span>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                </div>

                {/* 模式切换 */}
                <div className="grid grid-cols-2 gap-2 mb-2">
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
                <div className="grid grid-cols-2 gap-2 mb-2">
                    {[
                        { id: 'station', label: '站场', icon: 'location_on', color: 'text-red-400' },
                        { id: 'compressor', label: '压气站', icon: 'compress', color: 'text-orange-400' },
                        { id: 'valve', label: '阀室', icon: 'radio_button_checked', color: 'text-yellow-400' },
                        { id: 'distribution', label: '分输', icon: 'hub', color: 'text-blue-400' },
                    ].map(type => (
                        <button
                            key={type.id}
                            onClick={() => { setMode('draw-point'); setPointType(type.id as PointType); }}
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

                {/* 状态与操作 */}
                <div className="bg-gray-900/50 p-2 rounded mb-2 text-xs text-center text-gray-400 truncate">
                    {statusMsg}
                </div>

                <div className="flex gap-2">
                    <button onClick={exportData} className="flex-1 bg-green-900/40 hover:bg-green-800 text-green-300 py-1 rounded text-xs border border-green-800 transition-colors">
                        导出
                    </button>
                    <button onClick={clearAll} className="flex-1 bg-red-900/40 hover:bg-red-800 text-red-300 py-1 rounded text-xs border border-red-800 transition-colors">
                        清空
                    </button>
                </div>
            </div>

            {/* 帮助小提示 */}
            <div className="bg-black/60 backdrop-blur rounded p-2 text-[10px] text-gray-400 max-w-[256px]">
                Tip: 拖拽点可调整位置，连线会自动跟随。
            </div>
        </div>
    )
}

export default PipelineEditorOverlay
