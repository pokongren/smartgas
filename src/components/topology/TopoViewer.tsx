/**
 * TopoViewer 组件
 * 
 * 管网拓扑可视化组件，展示拓扑结构、计算结果和分析指标。
 * 支持路径高亮、环显示、MST展示等交互功能。
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { useTopology, type PathResult, type TopologyAnalysis, type NodeType } from '@/hooks/useTopology'
import type { PipelineNode, PipelineLine } from '@/types'
import { getNodeRawType } from '@/utils/pipelineDomain'

// =============================================================================
// 类型定义
// =============================================================================

export interface TopoViewerProps {
    /** 管线名称 */
    pipelineName: string
    /** 节点数据 */
    nodes: PipelineNode[]
    /** 管线数据 */
    lines: PipelineLine[]
    /** 是否显示指标面板 */
    showMetrics?: boolean
    /** 是否显示控制面板 */
    showControls?: boolean
    /** 节点点击回调 */
    onNodeClick?: (nodeId: string, nodeName: string) => void
    /** 路径选择回调 */
    onPathSelect?: (path: PathResult) => void
    /** 类名 */
    className?: string
}

type ViewMode = 'default' | 'path' | 'mst' | 'cycles' | 'centrality'

interface HighlightState {
    nodes: Set<string>
    edges: Set<string>
}

// =============================================================================
// 辅助组件
// =============================================================================

const MetricCard: React.FC<{ title: string; value: string | number; unit?: string }> = ({
    title,
    value,
    unit
}) => (
    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
        <div className="text-slate-400 text-xs mb-1">{title}</div>
        <div className="text-white text-lg font-semibold">
            {value}
            {unit && <span className="text-slate-500 text-sm ml-1">{unit}</span>}
        </div>
    </div>
)

const NodeBadge: React.FC<{ type: NodeType }> = ({ type }) => {
    const colors: Record<NodeType, string> = {
        source: 'bg-blue-500',
        compressor: 'bg-cyan-500',
        distribution: 'bg-amber-500',
        valve: 'bg-slate-500',
        storage: 'bg-purple-500',
        junction: 'bg-gray-500'
    }
    
    const labels: Record<NodeType, string> = {
        source: '气源',
        compressor: '压气站',
        distribution: '分输站',
        valve: '阀室',
        storage: '储气库',
        junction: '连接点'
    }
    
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs text-white ${colors[type]}`}>
            {labels[type]}
        </span>
    )
}

// =============================================================================
// 主组件
// =============================================================================

export const TopoViewer: React.FC<TopoViewerProps> = ({
    pipelineName,
    nodes: pipelineNodes,
    lines: pipelineLines,
    showMetrics = true,
    showControls = true,
    onNodeClick,
    onPathSelect,
    className = ''
}) => {
    // 使用 topology hook
    const {
        loadFromPipeline,
        analyzeTopology,
        findPath,
        findAlternativePaths,
        findMST,
        detectCycles,
        metrics,
        analysis,
        loading,
        error
    } = useTopology({ enableCache: true })
    
    // 本地状态
    const [viewMode, setViewMode] = useState<ViewMode>('default')
    const [selectedSource, setSelectedSource] = useState<string>('')
    const [selectedTarget, setSelectedTarget] = useState<string>('')
    const [highlight, setHighlight] = useState<HighlightState>({ nodes: new Set(), edges: new Set() })
    const [paths, setPaths] = useState<PathResult[]>([])
    const [selectedPathIndex, setSelectedPathIndex] = useState<number>(0)
    const [cycles, setCycles] = useState<string[][]>([])
    const [mstEdges, setMstEdges] = useState<string[]>([])
    
    // 初始化加载
    useEffect(() => {
        if (pipelineNodes.length > 0 && pipelineLines.length > 0) {
            loadFromPipeline(pipelineName, { nodes: pipelineNodes, lines: pipelineLines })
                .then(() => {
                    analyzeTopology()
                })
        }
    }, [pipelineName, pipelineNodes, pipelineLines, loadFromPipeline, analyzeTopology])
    
    // 节点选项（用于路径选择）
    const nodeOptions = useMemo(() => {
        return pipelineNodes.map(n => ({
            id: n.id,
            name: n.name,
            type: getNodeRawType(n) === 'source'
                ? 'source'
                : getNodeRawType(n) === 'compressor'
                    ? 'compressor'
                    : getNodeRawType(n) === 'distribution'
                        ? 'distribution'
                        : getNodeRawType(n) === 'valve'
                            ? 'valve'
                            : 'junction'
        }))
    }, [pipelineNodes])
    
    // 处理路径计算
    const handleFindPath = useCallback(async () => {
        if (!selectedSource || !selectedTarget) return
        
        const result = await findPath(selectedSource, selectedTarget)
        if (result && result.found) {
            setPaths([result])
            setSelectedPathIndex(0)
            setHighlight({
                nodes: new Set(result.path),
                edges: new Set(result.path.slice(0, -1).map((_, i) => `${result.path[i]}-${result.path[i + 1]}`))
            })
            setViewMode('path')
            onPathSelect?.(result)
        }
    }, [selectedSource, selectedTarget, findPath, onPathSelect])
    
    // 处理查找备选路径
    const handleFindAlternativePaths = useCallback(async () => {
        if (!selectedSource || !selectedTarget) return
        
        const results = await findAlternativePaths(selectedSource, selectedTarget, 3)
        if (results.length > 0) {
            setPaths(results)
            setSelectedPathIndex(0)
            // 高亮第一条路径
            const firstPath = results[0]
            setHighlight({
                nodes: new Set(firstPath.path),
                edges: new Set()
            })
            setViewMode('path')
        }
    }, [selectedSource, selectedTarget, findAlternativePaths])
    
    // 处理显示 MST
    const handleShowMST = useCallback(async () => {
        const result = await findMST()
        if (result) {
            setMstEdges(result.edge_ids)
            setHighlight({
                nodes: new Set(),
                edges: new Set(result.edge_ids)
            })
            setViewMode('mst')
        }
    }, [findMST])
    
    // 处理显示环
    const handleShowCycles = useCallback(async () => {
        const cycleList = await detectCycles()
        if (cycleList.length > 0) {
            const cycleNodes = cycleList.flatMap(c => c.nodes)
            setCycles(cycleList.map(c => c.nodes))
            setHighlight({
                nodes: new Set(cycleNodes),
                edges: new Set()
            })
            setViewMode('cycles')
        }
    }, [detectCycles])
    
    // 清除高亮
    const clearHighlight = useCallback(() => {
        setHighlight({ nodes: new Set(), edges: new Set() })
        setPaths([])
        setViewMode('default')
    }, [])
    
    // 切换路径显示
    const selectPath = useCallback((index: number) => {
        if (paths[index]) {
            setSelectedPathIndex(index)
            const path = paths[index]
            setHighlight({
                nodes: new Set(path.path),
                edges: new Set()
            })
        }
    }, [paths])
    
    // 渲染拓扑图（简化版 SVG 表示）
    const renderTopologyGraph = () => {
        if (pipelineNodes.length === 0) return null
        
        // 计算边界框
        const lons = pipelineNodes.map(n => n.coordinate.longitude)
        const lats = pipelineNodes.map(n => n.coordinate.latitude)
        const minLon = Math.min(...lons)
        const maxLon = Math.max(...lons)
        const minLat = Math.min(...lats)
        const maxLat = Math.max(...lats)
        
        // 坐标转换函数
        const width = 600
        const height = 400
        const padding = 40
        
        const scaleX = (lon: number) => padding + (lon - minLon) / (maxLon - minLon) * (width - 2 * padding)
        const scaleY = (lat: number) => height - (padding + (lat - minLat) / (maxLat - minLat) * (height - 2 * padding))
        
        return (
            <svg width={width} height={height} className="bg-slate-900 rounded-lg border border-slate-700">
                {/* 渲染边 */}
                {pipelineLines.map(line => {
                    const startNode = pipelineNodes.find(n => n.id === line.startNodeId)
                    const endNode = pipelineNodes.find(n => n.id === line.endNodeId)
                    if (!startNode || !endNode) return null
                    
                    const isHighlighted = highlight.edges.has(line.id) || 
                                        highlight.edges.has(`${line.startNodeId}-${line.endNodeId}`) ||
                                        highlight.edges.has(`${line.endNodeId}-${line.startNodeId}`)
                    const isMST = viewMode === 'mst' && mstEdges.includes(line.id)
                    
                    return (
                        <line
                            key={line.id}
                            x1={scaleX(startNode.coordinate.longitude)}
                            y1={scaleY(startNode.coordinate.latitude)}
                            x2={scaleX(endNode.coordinate.longitude)}
                            y2={scaleY(endNode.coordinate.latitude)}
                            stroke={isMST ? '#22c55e' : isHighlighted ? '#3b82f6' : '#475569'}
                            strokeWidth={isHighlighted || isMST ? 3 : 1}
                            opacity={viewMode === 'default' || isHighlighted || isMST ? 1 : 0.3}
                        />
                    )
                })}
                
                {/* 渲染节点 */}
                {pipelineNodes.map(node => {
                    const isHighlighted = highlight.nodes.has(node.id)
                    const isSource = node.id === selectedSource
                    const isTarget = node.id === selectedTarget
                    
                    const rawType = getNodeRawType(node)
                    let fill = '#64748b'
                    if (rawType === 'source') fill = '#2563eb'
                    else if (rawType === 'compressor') fill = '#06b6d4'
                    else if (rawType === 'distribution') fill = '#f59e0b'
                    else if (rawType === 'valve') fill = '#6b7280'
                    
                    if (isSource) fill = '#22c55e'
                    if (isTarget) fill = '#ef4444'
                    if (isHighlighted) fill = '#3b82f6'
                    
                    return (
                        <g key={node.id}>
                            <circle
                                cx={scaleX(node.coordinate.longitude)}
                                cy={scaleY(node.coordinate.latitude)}
                                r={isHighlighted || isSource || isTarget ? 8 : 5}
                                fill={fill}
                                stroke={isHighlighted ? '#60a5fa' : '#1e293b'}
                                strokeWidth={2}
                                className="cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => onNodeClick?.(node.id, node.name)}
                            />
                            {(isHighlighted || rawType === 'compressor' || rawType === 'distribution') && (
                                <text
                                    x={scaleX(node.coordinate.longitude)}
                                    y={scaleY(node.coordinate.latitude) - 12}
                                    textAnchor="middle"
                                    fill="#94a3b8"
                                    fontSize="10"
                                >
                                    {node.name}
                                </text>
                            )}
                        </g>
                    )
                })}
            </svg>
        )
    }
    
    return (
        <div className={`flex flex-col gap-4 ${className}`}>
            {/* 错误提示 */}
            {error && (
                <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-2 rounded-lg">
                    {error}
                </div>
            )}
            
            {/* 控制面板 */}
            {showControls && (
                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <h3 className="text-white font-medium mb-3">拓扑分析控制</h3>
                    
                    {/* 路径计算 */}
                    <div className="flex flex-wrap gap-2 mb-4">
                        <select
                            value={selectedSource}
                            onChange={e => setSelectedSource(e.target.value)}
                            className="bg-slate-700 text-white text-sm rounded px-3 py-2 border border-slate-600 focus:border-blue-500 outline-none"
                        >
                            <option value="">选择起点</option>
                            {nodeOptions.map(n => (
                                <option key={n.id} value={n.id}>{n.name}</option>
                            ))}
                        </select>
                        
                        <span className="text-slate-400 self-center">→</span>
                        
                        <select
                            value={selectedTarget}
                            onChange={e => setSelectedTarget(e.target.value)}
                            className="bg-slate-700 text-white text-sm rounded px-3 py-2 border border-slate-600 focus:border-blue-500 outline-none"
                        >
                            <option value="">选择终点</option>
                            {nodeOptions.map(n => (
                                <option key={n.id} value={n.id}>{n.name}</option>
                            ))}
                        </select>
                        
                        <button
                            onClick={handleFindPath}
                            disabled={!selectedSource || !selectedTarget || loading}
                            className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 text-white text-sm px-4 py-2 rounded transition-colors"
                        >
                            查找路径
                        </button>
                        
                        <button
                            onClick={handleFindAlternativePaths}
                            disabled={!selectedSource || !selectedTarget || loading}
                            className="bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 text-white text-sm px-4 py-2 rounded transition-colors"
                        >
                            备选路径
                        </button>
                    </div>
                    
                    {/* 分析按钮 */}
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={handleShowMST}
                            disabled={loading}
                            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 text-white text-sm px-4 py-2 rounded transition-colors"
                        >
                            最小生成树
                        </button>
                        
                        <button
                            onClick={handleShowCycles}
                            disabled={loading}
                            className="bg-purple-600 hover:bg-purple-500 disabled:bg-slate-600 text-white text-sm px-4 py-2 rounded transition-colors"
                        >
                            检测环路
                        </button>
                        
                        <button
                            onClick={clearHighlight}
                            className="bg-slate-600 hover:bg-slate-500 text-white text-sm px-4 py-2 rounded transition-colors"
                        >
                            清除高亮
                        </button>
                    </div>
                    
                    {/* 路径列表 */}
                    {paths.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-slate-700">
                            <h4 className="text-slate-300 text-sm mb-2">
                                找到 {paths.length} 条路径
                            </h4>
                            <div className="space-y-2 max-h-40 overflow-y-auto">
                                {paths.map((path, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => selectPath(idx)}
                                        className={`w-full text-left text-sm p-2 rounded transition-colors ${
                                            selectedPathIndex === idx
                                                ? 'bg-blue-600/30 border border-blue-500'
                                                : 'bg-slate-700/50 hover:bg-slate-700'
                                        }`}
                                    >
                                        <div className="text-white font-medium">
                                            路径 {idx + 1}: {path.total_length.toFixed(1)} km
                                        </div>
                                        <div className="text-slate-400 text-xs truncate">
                                            {path.path_names.join(' → ')}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
            
            {/* 拓扑图可视化 */}
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-white font-medium">拓扑结构图</h3>
                    <div className="flex gap-2 text-xs">
                        <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded-full bg-cyan-500"></span>
                            压气站
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                            分输站
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded-full bg-slate-500"></span>
                            阀室
                        </span>
                    </div>
                </div>
                
                <div className="overflow-x-auto">
                    {renderTopologyGraph()}
                </div>
                
                {/* 图例说明 */}
                {viewMode !== 'default' && (
                    <div className="mt-3 flex gap-4 text-xs">
                        {viewMode === 'path' && (
                            <>
                                <span className="flex items-center gap-1 text-blue-400">
                                    <span className="w-4 h-0.5 bg-blue-500"></span>
                                    选中路径
                                </span>
                                <span className="flex items-center gap-1 text-green-400">
                                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                    起点
                                </span>
                                <span className="flex items-center gap-1 text-red-400">
                                    <span className="w-2 h-2 rounded-full bg-red-500"></span>
                                    终点
                                </span>
                            </>
                        )}
                        {viewMode === 'mst' && (
                            <span className="flex items-center gap-1 text-emerald-400">
                                <span className="w-4 h-0.5 bg-emerald-500"></span>
                                最小生成树边
                            </span>
                        )}
                    </div>
                )}
            </div>
            
            {/* 指标面板 */}
            {showMetrics && metrics && (
                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <h3 className="text-white font-medium mb-3">拓扑指标</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <MetricCard title="节点数" value={metrics.node_count} />
                        <MetricCard title="边数" value={metrics.edge_count} />
                        <MetricCard title="连通分量" value={metrics.connected_components} />
                        <MetricCard title="环数" value={metrics.cycle_count} />
                        <MetricCard title="图密度" value={metrics.density.toFixed(4)} />
                        <MetricCard title="平均度" value={metrics.avg_degree.toFixed(2)} />
                        <MetricCard title="直径" value={metrics.diameter === -1 ? 'N/A' : metrics.diameter} />
                        <MetricCard 
                            title="平均最短路径" 
                            value={metrics.avg_shortest_path === -1 ? 'N/A' : metrics.avg_shortest_path.toFixed(2)} 
                        />
                    </div>
                </div>
            )}
            
            {/* 关键节点 */}
            {analysis?.centrality.top_betweenness && analysis.centrality.top_betweenness.length > 0 && (
                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <h3 className="text-white font-medium mb-3">关键节点（介数中心性）</h3>
                    <div className="space-y-2">
                        {analysis.centrality.top_betweenness.slice(0, 5).map((node, idx) => (
                            <div 
                                key={node.node_id}
                                className="flex items-center justify-between bg-slate-700/50 rounded px-3 py-2"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="text-slate-500 text-sm">#{idx + 1}</span>
                                    <span className="text-white">{node.name}</span>
                                </div>
                                <span className="text-blue-400 font-mono text-sm">
                                    {node.score.toFixed(4)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            
            {/* 加载状态 */}
            {loading && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                        <div className="flex items-center gap-3">
                            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-white">计算中...</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default TopoViewer
