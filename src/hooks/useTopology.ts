/**
 * useTopology Hook
 * 
 * 提供管网拓扑计算能力的 React Hook。
 * 整合图构建、路径计算、拓扑分析和仿真推演功能。
 * 
 * @example
 * ```tsx
 * const {
 *   graph,
 *   nodes,
 *   edges,
 *   findPath,
 *   analyzeTopology,
 *   metrics,
 *   loading
 * } = useTopology('west_east_2')
 * ```
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { PipelineNode, PipelineLine } from '@/types'

// =============================================================================
// 类型定义
// =============================================================================

export type NodeType = 'source' | 'compressor' | 'distribution' | 'valve' | 'storage' | 'junction'
export type EdgeType = 'trunk' | 'branch' | 'interconnect'
export type PathAlgorithm = 'dijkstra' | 'astar' | 'bellman_ford'

export interface TopoNode {
    id: string
    name: string
    type: NodeType
    longitude: number
    latitude: number
    pressure_mpa: number
    capacity: number
    properties?: Record<string, any>
}

export interface TopoEdge {
    id: string
    source: string
    target: string
    name: string
    type: EdgeType
    length_km: number
    diameter_mm: number
    design_pressure_mpa: number
    linepack_volume?: number
    flow_rate?: number
    delay_ticks?: number
    properties?: Record<string, any>
}

export interface PathResult {
    found: boolean
    path: string[]
    path_names: string[]
    total_length: number
    total_delay: number
    edge_count: number
}

export interface TopologyMetrics {
    node_count: number
    edge_count: number
    density: number
    avg_degree: number
    connected_components: number
    cycle_count: number
    diameter: number
    avg_shortest_path: number
}

export interface CentralityNode {
    node_id: string
    name: string
    score: number
}

export interface CentralityResult {
    top_betweenness: CentralityNode[]
}

export interface ConnectedComponent {
    id: number
    node_count: number
    nodes: string[]
}

export interface CycleInfo {
    nodes: string[]
    length: number
}

export interface TopologyAnalysis {
    metrics: TopologyMetrics
    centrality: CentralityResult
    connected_components: ConnectedComponent[]
    cycles: {
        count: number
        examples: string[][]
    }
}

export interface MSTResult {
    edge_count: number
    edge_ids: string[]
    total_length: number
}

export interface UseTopologyOptions {
    /** 是否自动加载 */
    autoLoad?: boolean
    /** 是否启用缓存 */
    enableCache?: boolean
    /** API 基础 URL */
    apiBaseUrl?: string
}

export interface UseTopologyReturn {
    // 数据状态
    graphName: string | null
    nodes: TopoNode[]
    edges: TopoEdge[]
    metrics: TopologyMetrics | null
    analysis: TopologyAnalysis | null
    
    // 加载状态
    loading: boolean
    error: string | null
    
    // 图操作方法
    buildGraph: (name: string, nodes: TopoNode[], edges: TopoEdge[], directed?: boolean) => Promise<boolean>
    loadFromPipeline: (pipelineName: string, pipelineData: { nodes: PipelineNode[]; lines: PipelineLine[] }) => Promise<boolean>
    
    // 计算方法
    findPath: (source: string, target: string, algorithm?: PathAlgorithm, excludeNodes?: string[]) => Promise<PathResult | null>
    findAlternativePaths: (source: string, target: string, maxPaths?: number) => Promise<PathResult[]>
    analyzeTopology: () => Promise<TopologyAnalysis | null>
    detectCycles: () => Promise<CycleInfo[]>
    findMST: () => Promise<MSTResult | null>
    
    // 工具方法
    getNodeById: (id: string) => TopoNode | undefined
    getEdgeById: (id: string) => TopoEdge | undefined
    getNeighbors: (nodeId: string) => string[]
    hasPath: (source: string, target: string) => boolean
    
    // 状态管理
    clearCache: () => void
    reset: () => void
}

// =============================================================================
// 工具函数
// =============================================================================

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

/**
 * 将 PipelineNode 转换为 TopoNode
 */
function convertPipelineNode(node: PipelineNode): TopoNode {
    let type: NodeType = 'junction'
    if (node.name.includes('压气站')) type = 'compressor'
    else if (node.name.includes('分输站') || node.name.includes('门站')) type = 'distribution'
    else if (node.name.includes('阀室')) type = 'valve'
    else if (node.name.includes('首站') || node.name.includes('末站')) type = 'source'
    
    return {
        id: node.id,
        name: node.name,
        type,
        longitude: node.coordinate.longitude,
        latitude: node.coordinate.latitude,
        pressure_mpa: 10.0,
        capacity: 0,
        properties: node.properties
    }
}

/**
 * 将 PipelineLine 转换为 TopoEdge
 */
function convertPipelineLine(line: PipelineLine): TopoEdge {
    // 计算路径长度（简化计算）
    let length_km = line.length / 1000  // 米转公里
    if (length_km === 0 && line.path.length >= 2) {
        // 根据坐标计算近似长度
        let totalDist = 0
        for (let i = 1; i < line.path.length; i++) {
            const p1 = line.path[i - 1]
            const p2 = line.path[i]
            const dx = p2.longitude - p1.longitude
            const dy = p2.latitude - p1.latitude
            // 粗略转换：1度 ≈ 111km
            totalDist += Math.sqrt(dx * dx + dy * dy) * 111
        }
        length_km = totalDist
    }
    
    return {
        id: line.id,
        source: line.startNodeId,
        target: line.endNodeId,
        name: line.name,
        type: 'trunk',  // 默认干线
        length_km,
        diameter_mm: line.diameter,
        design_pressure_mpa: line.designPressure || 10.0,
        properties: line.properties
    }
}

// =============================================================================
// Hook 实现
// =============================================================================

export function useTopology(options: UseTopologyOptions = {}): UseTopologyReturn {
    const {
        autoLoad = false,
        enableCache = true,
        apiBaseUrl = API_BASE_URL
    } = options
    
    // 状态
    const [graphName, setGraphName] = useState<string | null>(null)
    const [nodes, setNodes] = useState<TopoNode[]>([])
    const [edges, setEdges] = useState<TopoEdge[]>([])
    const [metrics, setMetrics] = useState<TopologyMetrics | null>(null)
    const [analysis, setAnalysis] = useState<TopologyAnalysis | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    
    // 缓存
    const cacheRef = useRef<Map<string, any>>(new Map())
    const abortControllerRef = useRef<AbortController | null>(null)
    
    // 清理函数
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort()
            }
        }
    }, [])
    
    /**
     * 发送 API 请求
     */
    const apiRequest = useCallback(async <T,>(
        endpoint: string,
        method: 'GET' | 'POST' = 'GET',
        body?: any
    ): Promise<T> => {
        const url = `${apiBaseUrl}${endpoint}`
        
        // 取消之前的请求
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
        abortControllerRef.current = new AbortController()
        
        const options: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json'
            },
            signal: abortControllerRef.current.signal
        }
        
        if (body && method === 'POST') {
            options.body = JSON.stringify(body)
        }
        
        const response = await fetch(url, options)
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.detail || `HTTP ${response.status}`)
        }
        
        return response.json()
    }, [apiBaseUrl])
    
    /**
     * 构建图
     */
    const buildGraph = useCallback(async (
        name: string,
        nodeList: TopoNode[],
        edgeList: TopoEdge[],
        directed: boolean = true
    ): Promise<boolean> => {
        setLoading(true)
        setError(null)
        
        try {
            const result = await apiRequest<{ success: boolean }>(
                '/topology/build',
                'POST',
                {
                    name,
                    directed,
                    nodes: nodeList,
                    edges: edgeList
                }
            )
            
            if (result.success) {
                setGraphName(name)
                setNodes(nodeList)
                setEdges(edgeList)
                // 清除相关缓存
                if (enableCache) {
                    cacheRef.current.delete(`analysis_${name}`)
                    cacheRef.current.delete(`metrics_${name}`)
                }
                return true
            }
            return false
        } catch (err: any) {
            setError(err.message || 'Failed to build graph')
            return false
        } finally {
            setLoading(false)
        }
    }, [apiRequest, enableCache])
    
    /**
     * 从管线数据加载
     */
    const loadFromPipeline = useCallback(async (
        pipelineName: string,
        pipelineData: { nodes: PipelineNode[]; lines: PipelineLine[] }
    ): Promise<boolean> => {
        const convertedNodes = pipelineData.nodes.map(convertPipelineNode)
        const convertedEdges = pipelineData.lines.map(convertPipelineLine)
        
        return buildGraph(pipelineName, convertedNodes, convertedEdges, true)
    }, [buildGraph])
    
    /**
     * 查找路径
     */
    const findPath = useCallback(async (
        source: string,
        target: string,
        algorithm: PathAlgorithm = 'dijkstra',
        excludeNodes?: string[]
    ): Promise<PathResult | null> => {
        if (!graphName) {
            setError('No graph loaded')
            return null
        }
        
        setLoading(true)
        setError(null)
        
        try {
            const cacheKey = `path_${graphName}_${source}_${target}_${algorithm}_${excludeNodes?.join(',')}`
            
            if (enableCache && cacheRef.current.has(cacheKey)) {
                setLoading(false)
                return cacheRef.current.get(cacheKey)
            }
            
            const result = await apiRequest<PathResult>(
                '/topology/path',
                'POST',
                {
                    graph_name: graphName,
                    source,
                    target,
                    algorithm,
                    exclude_nodes: excludeNodes
                }
            )
            
            if (enableCache) {
                cacheRef.current.set(cacheKey, result)
            }
            
            return result
        } catch (err: any) {
            setError(err.message || 'Failed to find path')
            return null
        } finally {
            setLoading(false)
        }
    }, [graphName, apiRequest, enableCache])
    
    /**
     * 查找多条备选路径
     */
    const findAlternativePaths = useCallback(async (
        source: string,
        target: string,
        maxPaths: number = 3
    ): Promise<PathResult[]> => {
        if (!graphName) {
            setError('No graph loaded')
            return []
        }
        
        setLoading(true)
        setError(null)
        
        try {
            const result = await apiRequest<{ paths: PathResult[] }>(
                '/topology/paths',
                'POST',
                {
                    graph_name: graphName,
                    source,
                    target,
                    max_paths: maxPaths
                }
            )
            
            return result.paths || []
        } catch (err: any) {
            setError(err.message || 'Failed to find paths')
            return []
        } finally {
            setLoading(false)
        }
    }, [graphName, apiRequest])
    
    /**
     * 拓扑分析
     */
    const analyzeTopology = useCallback(async (): Promise<TopologyAnalysis | null> => {
        if (!graphName) {
            setError('No graph loaded')
            return null
        }
        
        const cacheKey = `analysis_${graphName}`
        
        if (enableCache && cacheRef.current.has(cacheKey)) {
            const cached = cacheRef.current.get(cacheKey)
            setAnalysis(cached)
            return cached
        }
        
        setLoading(true)
        setError(null)
        
        try {
            const result = await apiRequest<TopologyAnalysis>(`/topology/analyze/${graphName}`)
            
            setAnalysis(result)
            setMetrics(result.metrics)
            
            if (enableCache) {
                cacheRef.current.set(cacheKey, result)
            }
            
            return result
        } catch (err: any) {
            setError(err.message || 'Failed to analyze topology')
            return null
        } finally {
            setLoading(false)
        }
    }, [graphName, apiRequest, enableCache])
    
    /**
     * 检测环
     */
    const detectCycles = useCallback(async (): Promise<CycleInfo[]> => {
        if (!graphName) {
            setError('No graph loaded')
            return []
        }
        
        setLoading(true)
        setError(null)
        
        try {
            const result = await apiRequest<{ cycles: CycleInfo[] }>(`/topology/cycles/${graphName}`)
            return result.cycles || []
        } catch (err: any) {
            setError(err.message || 'Failed to detect cycles')
            return []
        } finally {
            setLoading(false)
        }
    }, [graphName, apiRequest])
    
    /**
     * 计算最小生成树
     */
    const findMST = useCallback(async (): Promise<MSTResult | null> => {
        if (!graphName) {
            setError('No graph loaded')
            return null
        }
        
        setLoading(true)
        setError(null)
        
        try {
            const result = await apiRequest<MSTResult>(`/topology/mst/${graphName}`)
            return result
        } catch (err: any) {
            setError(err.message || 'Failed to find MST')
            return null
        } finally {
            setLoading(false)
        }
    }, [graphName, apiRequest])
    
    /**
     * 获取节点
     */
    const getNodeById = useCallback((id: string): TopoNode | undefined => {
        return nodes.find(n => n.id === id)
    }, [nodes])
    
    /**
     * 获取边
     */
    const getEdgeById = useCallback((id: string): TopoEdge | undefined => {
        return edges.find(e => e.id === id)
    }, [edges])
    
    /**
     * 获取邻居节点
     */
    const getNeighbors = useCallback((nodeId: string): string[] => {
        const neighbors: string[] = []
        edges.forEach(edge => {
            if (edge.source === nodeId) neighbors.push(edge.target)
            if (edge.target === nodeId) neighbors.push(edge.source)
        })
        return [...new Set(neighbors)]
    }, [edges])
    
    /**
     * 检查是否有路径
     */
    const hasPath = useCallback((source: string, target: string): boolean => {
        if (!nodes.find(n => n.id === source) || !nodes.find(n => n.id === target)) {
            return false
        }
        
        // 简单的 BFS
        const visited = new Set<string>()
        const queue = [source]
        visited.add(source)
        
        while (queue.length > 0) {
            const current = queue.shift()!
            if (current === target) return true
            
            const neighbors = getNeighbors(current)
            for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor)
                    queue.push(neighbor)
                }
            }
        }
        
        return false
    }, [nodes, getNeighbors])
    
    /**
     * 清除缓存
     */
    const clearCache = useCallback(() => {
        cacheRef.current.clear()
    }, [])
    
    /**
     * 重置状态
     */
    const reset = useCallback(() => {
        setGraphName(null)
        setNodes([])
        setEdges([])
        setMetrics(null)
        setAnalysis(null)
        setError(null)
        clearCache()
    }, [clearCache])
    
    return {
        // 数据状态
        graphName,
        nodes,
        edges,
        metrics,
        analysis,
        
        // 加载状态
        loading,
        error,
        
        // 图操作方法
        buildGraph,
        loadFromPipeline,
        
        // 计算方法
        findPath,
        findAlternativePaths,
        analyzeTopology,
        detectCycles,
        findMST,
        
        // 工具方法
        getNodeById,
        getEdgeById,
        getNeighbors,
        hasPath,
        
        // 状态管理
        clearCache,
        reset
    }
}

export default useTopology
