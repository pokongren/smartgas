/**
 * 拓扑验证引擎
 *
 * 提供孤立节点检测、重复连接检测、介数中心性计算等图论分析工具，
 * 供地图编辑器和 Canvas 拓扑视图共用。
 */

// ============ 类型定义 ============

/** 通用图节点 —— 仅包含拓扑验证所需的最小字段 */
export interface GraphNode {
    id: string
    name: string
    type: string
}

/** 通用图边 */
export interface GraphEdge {
    id: string
    startNodeId: string
    endNodeId: string
    name?: string
}

/** 单条验证告警 */
export interface ValidationIssue {
    /** 告警等级：error=必须修复 | warning=建议修复 | info=仅供参考 */
    level: 'error' | 'warning' | 'info'
    /** 告警类型标识 */
    type: 'isolated_node' | 'duplicate_edge' | 'self_loop' | 'invalid_connection'
    /** 人类可读描述 */
    message: string
    /** 关联的节点/边 ID */
    relatedIds: string[]
}

/** 完整验证报告 */
export interface ValidationReport {
    /** 是否通过（无 error 级别告警） */
    passed: boolean
    issues: ValidationIssue[]
    stats: {
        nodeCount: number
        edgeCount: number
        isolatedCount: number
        componentCount: number
    }
}

// ============ 核心验证函数 ============

/**
 * 检测孤立节点（入度+出度=0）
 *
 * 孤立节点意味着该站场没有任何管线连接，在真实管网中
 * 通常是数据录入遗漏或连线被误删。
 */
export function findIsolatedNodes(nodes: GraphNode[], edges: GraphEdge[]): string[] {
    const connectedIds = new Set<string>()
    for (const edge of edges) {
        connectedIds.add(edge.startNodeId)
        connectedIds.add(edge.endNodeId)
    }
    return nodes.filter(n => !connectedIds.has(n.id)).map(n => n.id)
}

/**
 * 检测重复连接
 *
 * 使用哈希集合判断：同一对节点之间是否存在多条边。
 * 返回值为分组后的重复边数组。
 */
export function findDuplicateEdges(edges: GraphEdge[]): GraphEdge[][] {
    const pairMap = new Map<string, GraphEdge[]>()

    for (const edge of edges) {
        // NOTE: 无向图语义 —— A→B 和 B→A 视为同一对
        const ids = [edge.startNodeId, edge.endNodeId].sort()
        const key = `${ids[0]}_${ids[1]}`
        if (!pairMap.has(key)) {
            pairMap.set(key, [])
        }
        pairMap.get(key)!.push(edge)
    }

    const duplicates: GraphEdge[][] = []
    for (const group of pairMap.values()) {
        if (group.length > 1) {
            duplicates.push(group)
        }
    }
    return duplicates
}

/**
 * 检测自环边（起点=终点）
 */
export function findSelfLoops(edges: GraphEdge[]): GraphEdge[] {
    return edges.filter(e => e.startNodeId === e.endNodeId)
}

/**
 * 计算连通分量数量（使用 Union-Find / 并查集）
 *
 * 连通分量数>1说明拓扑不是一个整体，存在断裂的子网络。
 */
export function countComponents(nodes: GraphNode[], edges: GraphEdge[]): number {
    if (nodes.length === 0) return 0

    const parent = new Map<string, string>()
    const rank = new Map<string, number>()

    for (const n of nodes) {
        parent.set(n.id, n.id)
        rank.set(n.id, 0)
    }

    function find(x: string): string {
        let root = x
        while (parent.get(root) !== root) {
            root = parent.get(root)!
        }
        // 路径压缩
        let curr = x
        while (curr !== root) {
            const next = parent.get(curr)!
            parent.set(curr, root)
            curr = next
        }
        return root
    }

    function union(a: string, b: string): void {
        const rootA = find(a)
        const rootB = find(b)
        if (rootA === rootB) return
        const rankA = rank.get(rootA)!
        const rankB = rank.get(rootB)!
        if (rankA < rankB) {
            parent.set(rootA, rootB)
        } else if (rankA > rankB) {
            parent.set(rootB, rootA)
        } else {
            parent.set(rootB, rootA)
            rank.set(rootA, rankA + 1)
        }
    }

    for (const edge of edges) {
        if (parent.has(edge.startNodeId) && parent.has(edge.endNodeId)) {
            union(edge.startNodeId, edge.endNodeId)
        }
    }

    const roots = new Set<string>()
    for (const n of nodes) {
        roots.add(find(n.id))
    }
    return roots.size
}

/**
 * 介数中心性计算（Brandes 算法简化版）
 *
 * 介数中心性衡量了一个节点在所有最短路径中出现的比例。
 * 在天然气管网中，高介数意味着该站场是关键"咽喉要道"，
 * 一旦停运将影响大量下游用户。
 *
 * @returns Map<nodeId, centrality> 归一化后的中心性值 (0~1)
 */
export function computeBetweennessCentrality(
    nodes: GraphNode[],
    edges: GraphEdge[]
): Map<string, number> {
    const centrality = new Map<string, number>()
    for (const n of nodes) {
        centrality.set(n.id, 0)
    }

    if (nodes.length < 3) return centrality

    // 构建邻接表
    const adj = new Map<string, string[]>()
    for (const n of nodes) {
        adj.set(n.id, [])
    }
    for (const edge of edges) {
        if (adj.has(edge.startNodeId) && adj.has(edge.endNodeId)) {
            adj.get(edge.startNodeId)!.push(edge.endNodeId)
            adj.get(edge.endNodeId)!.push(edge.startNodeId)
        }
    }

    // Brandes 算法核心：对每个节点做 BFS
    for (const s of nodes) {
        const stack: string[] = []
        const pred = new Map<string, string[]>()
        const sigma = new Map<string, number>()
        const dist = new Map<string, number>()
        const delta = new Map<string, number>()

        for (const n of nodes) {
            pred.set(n.id, [])
            sigma.set(n.id, 0)
            dist.set(n.id, -1)
            delta.set(n.id, 0)
        }

        sigma.set(s.id, 1)
        dist.set(s.id, 0)
        const queue: string[] = [s.id]

        while (queue.length > 0) {
            const v = queue.shift()!
            stack.push(v)
            const neighbors = adj.get(v) || []
            for (const w of neighbors) {
                // 第一次发现 w
                if (dist.get(w)! < 0) {
                    queue.push(w)
                    dist.set(w, dist.get(v)! + 1)
                }
                // w 在最短路径上
                if (dist.get(w) === dist.get(v)! + 1) {
                    sigma.set(w, sigma.get(w)! + sigma.get(v)!)
                    pred.get(w)!.push(v)
                }
            }
        }

        // 反向累积
        while (stack.length > 0) {
            const w = stack.pop()!
            for (const v of pred.get(w)!) {
                const contribution = (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!)
                delta.set(v, delta.get(v)! + contribution)
            }
            if (w !== s.id) {
                centrality.set(w, centrality.get(w)! + delta.get(w)!)
            }
        }
    }

    // 归一化
    const n = nodes.length
    const normalizer = n > 2 ? 2 / ((n - 1) * (n - 2)) : 1
    let maxVal = 0
    for (const [id, val] of centrality) {
        const normalized = val * normalizer
        centrality.set(id, normalized)
        maxVal = Math.max(maxVal, normalized)
    }

    // 二次归一化到 0~1
    if (maxVal > 0) {
        for (const [id, val] of centrality) {
            centrality.set(id, val / maxVal)
        }
    }

    return centrality
}

/**
 * 一站式拓扑验证
 *
 * 综合运行所有检测函数，返回统一的 ValidationReport。
 */
export function validateTopology(
    nodes: GraphNode[],
    edges: GraphEdge[]
): ValidationReport {
    const issues: ValidationIssue[] = []

    // 1. 孤立节点
    const isolated = findIsolatedNodes(nodes, edges)
    for (const nodeId of isolated) {
        const node = nodes.find(n => n.id === nodeId)
        issues.push({
            level: 'warning',
            type: 'isolated_node',
            message: `"${node?.name || nodeId}" 没有任何管线连接`,
            relatedIds: [nodeId],
        })
    }

    // 2. 重复连接
    const duplicates = findDuplicateEdges(edges)
    for (const group of duplicates) {
        issues.push({
            level: 'error',
            type: 'duplicate_edge',
            message: `发现 ${group.length} 条重复连接`,
            relatedIds: group.map(e => e.id),
        })
    }

    // 3. 自环
    const selfLoops = findSelfLoops(edges)
    for (const edge of selfLoops) {
        issues.push({
            level: 'error',
            type: 'self_loop',
            message: `管线 "${edge.name || edge.id}" 起终点为同一节点`,
            relatedIds: [edge.id],
        })
    }

    // 4. 统计
    const componentCount = countComponents(nodes, edges)

    return {
        passed: !issues.some(i => i.level === 'error'),
        issues,
        stats: {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            isolatedCount: isolated.length,
            componentCount,
        },
    }
}
