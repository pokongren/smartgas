/**
 * 截断仿真引擎 v2 — 路径对比法
 *
 * 核心升级：
 * 1. 引入气源识别（degree=1 的 compressor = 管线起始节点）
 * 2. BFS 路径追踪（知道路径经过哪些节点）
 * 3. 精准三分类：same / rerouted / supply_lost
 * 4. 输出实际路径序列（供地图渲染路径高亮使用）
 */

import type { GraphNode, GraphEdge } from './topology-validator'
import { includesSupplyNodeKeyword } from '@/config/pipelineKeywords'

// ==================== 类型定义 ====================

export interface AffectedNode {
  id: string
  name: string
  type: string
  /** same: 路径不经过截断点，不受影响 | rerouted: 有绕行路径 | supply_lost: 完全断供 */
  status: 'same' | 'rerouted' | 'supply_lost'
  /** 截断前的路径节点 ID 序列（含源节点和目标节点） */
  pathBefore: string[]
  /** 截断后的绕行路径（supply_lost 时为空数组） */
  pathAfter: string[]
}

export interface CutoffResult {
  cutoffNodeId: string
  cutoffNodeName: string
  /** 被截断的节点/管段对应边 ID */
  cutoffEdgeIds: string[]
  /** 截断后停止流动的边 ID */
  stoppedEdgeIds: string[]
  /** 图中识别到的气源节点 */
  sourceNodes: Array<{ id: string; name: string }>
  /** 截断前可达的分输站总数 */
  totalDistributionNodes: number
  /** 受影响节点（只包含 supply_lost 和 rerouted，不包含 same） */
  affectedNodes: AffectedNode[]
  summary: {
    supplyLost: number
    rerouted: number
    same: number
  }
}

// ==================== 邻接表构建 ====================

function buildAdjacency(
  nodes: GraphNode[],
  edges: GraphEdge[],
  excludeNodeIds: Set<string> = new Set(),
  excludeEdgeIds: Set<string> = new Set(),
  directed = false
): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const n of nodes) {
    if (!excludeNodeIds.has(n.id)) adj.set(n.id, [])
  }
  for (const e of edges) {
    if (excludeEdgeIds.has(e.id)) continue
    if (excludeNodeIds.has(e.startNodeId) || excludeNodeIds.has(e.endNodeId)) continue
    if (!adj.has(e.startNodeId) || !adj.has(e.endNodeId)) continue
    adj.get(e.startNodeId)!.push(e.endNodeId)
    if (!directed) {
      adj.get(e.endNodeId)!.push(e.startNodeId)
    }
  }
  return adj
}

// ==================== 气源识别 ====================

function isLikelySupplyNode(node: GraphNode): boolean {
  const name = node.name || ''
  return (
    node.type === 'source' ||
    includesSupplyNodeKeyword(name)
  )
}

/**
 * 识别气源节点
 *
 * 策略（按优先级）：
 * 1. 显式气源 / LNG / 首站 / 接收站
 * 2. 有向图入度为 0、出度大于 0 的起点
 * 3. degree=1 的 compressor（兼容旧数据）
 * 4. 若策略1找不到节点，退化为全部 compressor
 *
 * 物理意义：截断推演要优先从拓扑录入方向识别上游，避免全网无向
 * 搜索时把下游 LNG 站或末端压气站错误当成当前管段的上游气源。
 */
function identifySources(
  nodes: GraphNode[],
  edges: GraphEdge[],
  excludeNodeIds: Set<string> = new Set(),
  excludeEdgeIds: Set<string> = new Set()
): Set<string> {
  const activeNodeIds = new Set(nodes.filter(n => !excludeNodeIds.has(n.id)).map(n => n.id))
  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  for (const nodeId of activeNodeIds) {
    inDegree.set(nodeId, 0)
    outDegree.set(nodeId, 0)
  }
  for (const edge of edges) {
    if (excludeEdgeIds.has(edge.id)) continue
    if (!activeNodeIds.has(edge.startNodeId) || !activeNodeIds.has(edge.endNodeId)) continue
    outDegree.set(edge.startNodeId, (outDegree.get(edge.startNodeId) ?? 0) + 1)
    inDegree.set(edge.endNodeId, (inDegree.get(edge.endNodeId) ?? 0) + 1)
  }

  const explicitSources = nodes.filter(n => (
    activeNodeIds.has(n.id) &&
    isLikelySupplyNode(n) &&
    (outDegree.get(n.id) ?? 0) > 0
  ))

  if (explicitSources.length > 0) {
    return new Set(explicitSources.map(n => n.id))
  }

  const directionalSources = nodes.filter(n => (
    activeNodeIds.has(n.id) &&
    (outDegree.get(n.id) ?? 0) > 0 &&
    (inDegree.get(n.id) ?? 0) === 0
  ))

  if (directionalSources.length > 0) {
    return new Set(directionalSources.map(n => n.id))
  }

  const undirectedAdj = buildAdjacency(nodes, edges, excludeNodeIds, excludeEdgeIds)
  const terminalCompressors = nodes.filter(n => (
    activeNodeIds.has(n.id) &&
    n.type === 'compressor' &&
    (undirectedAdj.get(n.id)?.length ?? 0) === 1
  ))

  if (terminalCompressors.length > 0) {
    return new Set(terminalCompressors.map(n => n.id))
  }

  // 退化策略：所有压气站
  const compressors = nodes.filter(n => activeNodeIds.has(n.id) && n.type === 'compressor')
  if (compressors.length > 0) {
    return new Set(compressors.map(n => n.id))
  }

  // 再退化：没有压气站时，用拓扑端点作为前端演示气源
  const terminalNodes = nodes.filter(n => activeNodeIds.has(n.id) && (undirectedAdj.get(n.id)?.length ?? 0) === 1)
  return new Set(terminalNodes.map(n => n.id))
}

// ==================== BFS 路径查找 ====================

/**
 * BFS 最短路径查找（返回完整路径节点数组）
 *
 * 从 source 出发，找到到达 target 的最短路径。
 * 返回路径（含 source 和 target），找不到时返回 null。
 */
function bfsPath(
  source: string,
  target: string,
  adj: Map<string, string[]>
): string[] | null {
  if (!adj.has(source) || !adj.has(target)) return null
  if (source === target) return [source]

  const parent = new Map<string, string>()
  const visited = new Set<string>([source])
  const queue: string[] = [source]

  while (queue.length > 0) {
    const curr = queue.shift()!
    for (const neighbor of adj.get(curr) || []) {
      if (visited.has(neighbor)) continue
      visited.add(neighbor)
      parent.set(neighbor, curr)
      if (neighbor === target) {
        // 回溯构造路径
        const path: string[] = []
        let node: string | undefined = target
        while (node !== undefined) {
          path.unshift(node)
          node = parent.get(node)
        }
        return path
      }
      queue.push(neighbor)
    }
  }
  return null
}

/**
 * 从多个气源出发，找到到达 target 的最短路径
 *
 * 使用多源 BFS（同时从所有源出发），效率比逐一查找高。
 * 返回：{ path: 路径节点数组, sourceId: 实际使用的气源 ID }
 */
function bfsPathFromSources(
  sources: Set<string>,
  target: string,
  adj: Map<string, string[]>
): { path: string[]; sourceId: string } | null {
  if (!adj.has(target)) return null

  // 若 target 本身是气源
  if (sources.has(target)) return { path: [target], sourceId: target }

  // 多源 BFS
  const parent = new Map<string, string>()
  // sourceOf[node] 记录该节点是从哪个气源到达的
  const sourceOf = new Map<string, string>()
  const visited = new Set<string>()
  const queue: string[] = []

  for (const src of sources) {
    if (!adj.has(src)) continue
    visited.add(src)
    sourceOf.set(src, src)
    queue.push(src)
  }

  while (queue.length > 0) {
    const curr = queue.shift()!
    for (const neighbor of adj.get(curr) || []) {
      if (visited.has(neighbor)) continue
      visited.add(neighbor)
      parent.set(neighbor, curr)
      sourceOf.set(neighbor, sourceOf.get(curr)!)

      if (neighbor === target) {
        // 回溯路径
        const path: string[] = []
        let node: string | undefined = target
        while (node !== undefined) {
          path.unshift(node)
          node = parent.get(node)
        }
        return { path, sourceId: sourceOf.get(target)! }
      }
      queue.push(neighbor)
    }
  }

  return null
}

function bfsReachableFromSources(
  sources: Set<string>,
  adj: Map<string, string[]>
): Set<string> {
  const visited = new Set<string>()
  const queue: string[] = []

  for (const src of sources) {
    if (!adj.has(src) || visited.has(src)) continue
    visited.add(src)
    queue.push(src)
  }

  while (queue.length > 0) {
    const curr = queue.shift()!
    for (const neighbor of adj.get(curr) || []) {
      if (visited.has(neighbor)) continue
      visited.add(neighbor)
      queue.push(neighbor)
    }
  }

  return visited
}

function pathContainsEdge(path: string[], startNodeId: string, endNodeId: string): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const left = path[i]
    const right = path[i + 1]
    if ((left === startNodeId && right === endNodeId) || (left === endNodeId && right === startNodeId)) {
      return true
    }
  }
  return false
}

// ==================== 主仿真函数 ====================

/**
 * 截断仿真 v2 — 路径对比法
 *
 * 对每个分输站，分别求截断前/后从气源出发的路径，对比变化：
 * - 截断前路径不经过截断点 → same（不受影响）
 * - 截断前路径经过截断点 + 截断后有新路径 → rerouted（绕行）
 * - 截断前路径经过截断点 + 截断后无路径 → supply_lost（断供）
 */
export function simulateCutoff(
  nodes: GraphNode[],
  edges: GraphEdge[],
  cutoffNodeId: string
): CutoffResult {
  return simulateNodeCutoff(nodes, edges, cutoffNodeId)
}

export function simulateEdgeCutoff(
  nodes: GraphNode[],
  edges: GraphEdge[],
  cutoffEdgeId: string
): CutoffResult {
  return simulateEdgeCutoffInternal(nodes, edges, cutoffEdgeId)
}

function simulateNodeCutoff(
  nodes: GraphNode[],
  edges: GraphEdge[],
  cutoffNodeId: string
): CutoffResult {
  const cutoffNode = nodes.find(n => n.id === cutoffNodeId)
  const cutoffName = cutoffNode?.name ?? cutoffNodeId

  // 构建邻接表
  const cutoffEdgeIds = new Set<string>()
  for (const edge of edges) {
    if (edge.startNodeId === cutoffNodeId || edge.endNodeId === cutoffNodeId) {
      cutoffEdgeIds.add(edge.id)
    }
  }

  const adjBefore = buildAdjacency(nodes, edges)
  const adjAfter = buildAdjacency(nodes, edges, new Set([cutoffNodeId]), cutoffEdgeIds)

  // 识别气源（截断前全部气源；截断后若气源本身是截断点，则排除）
  const sourcesBefore = identifySources(nodes, edges)
  const sourcesAfter = new Set([...sourcesBefore].filter(id => id !== cutoffNodeId))

  // 气源节点信息（供 UI 展示）
  const sourceNodeInfos = [...sourcesBefore].map(id => ({
    id,
    name: nodes.find(n => n.id === id)?.name ?? id,
  }))

  // 需要分析的分输站
  const distributionNodes = nodes.filter(
    n => n.type === 'distribution' && n.id !== cutoffNodeId
  )

  const reachableAfter = bfsReachableFromSources(sourcesAfter, adjAfter)
  const affectedNodes: AffectedNode[] = []
  let supplyLost = 0
  let rerouted = 0
  let same = 0

  for (const distNode of distributionNodes) {
    // 1. 截断前路径
    const resultBefore = bfsPathFromSources(sourcesBefore, distNode.id, adjBefore)
    if (!resultBefore) {
      // 截断前就不可达（孤立节点），跳过
      continue
    }

    const pathBefore = resultBefore.path
    // 路径是否经过截断节点
    const passedCutoff = pathBefore.includes(cutoffNodeId)

    if (!passedCutoff) {
      // 路径不经过截断节点 → 完全不受影响
      same++
      // same 不加入 affectedNodes，保持结果简洁
      continue
    }

    // 2. 截断后路径
    const resultAfter = bfsPathFromSources(sourcesAfter, distNode.id, adjAfter)

    if (resultAfter) {
      // 有绕行路径
      rerouted++
      affectedNodes.push({
        id: distNode.id,
        name: distNode.name,
        type: distNode.type,
        status: 'rerouted',
        pathBefore,
        pathAfter: resultAfter.path,
      })
    } else {
      // 无法到达 → 断供
      supplyLost++
      affectedNodes.push({
        id: distNode.id,
        name: distNode.name,
        type: distNode.type,
        status: 'supply_lost',
        pathBefore,
        pathAfter: [],
      })
    }
  }

  const stoppedEdgeIds = edges
    .filter(edge => cutoffEdgeIds.has(edge.id) || !reachableAfter.has(edge.startNodeId) || !reachableAfter.has(edge.endNodeId))
    .map(edge => edge.id)

  // 断供排前面，绕行排后面，同名按字母排
  affectedNodes.sort((a, b) => {
    if (a.status === 'supply_lost' && b.status !== 'supply_lost') return -1
    if (a.status !== 'supply_lost' && b.status === 'supply_lost') return 1
    return a.name.localeCompare(b.name, 'zh')
  })

  return {
    cutoffNodeId,
    cutoffNodeName: cutoffName,
    cutoffEdgeIds: [...cutoffEdgeIds],
    stoppedEdgeIds,
    sourceNodes: sourceNodeInfos,
    totalDistributionNodes: distributionNodes.length,
    affectedNodes,
    summary: { supplyLost, rerouted, same },
  }
}

function simulateEdgeCutoffInternal(
  nodes: GraphNode[],
  edges: GraphEdge[],
  cutoffEdgeId: string
): CutoffResult {
  const cutoffEdge = edges.find(edge => edge.id === cutoffEdgeId)
  const cutoffNodeId = cutoffEdge?.startNodeId ?? cutoffEdgeId
  const cutoffName = cutoffEdge?.name ?? cutoffEdgeId

  const adjBefore = buildAdjacency(nodes, edges)
  const adjAfter = buildAdjacency(nodes, edges, new Set(), new Set([cutoffEdgeId]))

  const sourcesBefore = identifySources(nodes, edges)
  const sourcesAfter = new Set(sourcesBefore)
  const sourceNodeInfos = [...sourcesBefore].map(id => ({
    id,
    name: nodes.find(n => n.id === id)?.name ?? id,
  }))

  const distributionNodes = nodes.filter(
    n => n.type === 'distribution' && n.id !== cutoffNodeId
  )

  const reachableAfter = bfsReachableFromSources(sourcesAfter, adjAfter)
  const affectedNodes: AffectedNode[] = []
  let supplyLost = 0
  let rerouted = 0
  let same = 0

  for (const distNode of distributionNodes) {
    const resultBefore = bfsPathFromSources(sourcesBefore, distNode.id, adjBefore)
    if (!resultBefore) continue

    const pathBefore = resultBefore.path
    const passedCutoff = cutoffEdge ? pathContainsEdge(pathBefore, cutoffEdge.startNodeId, cutoffEdge.endNodeId) : false
    if (!passedCutoff) {
      same++
      continue
    }

    const resultAfter = bfsPathFromSources(sourcesAfter, distNode.id, adjAfter)
    if (resultAfter) {
      rerouted++
      affectedNodes.push({
        id: distNode.id,
        name: distNode.name,
        type: distNode.type,
        status: 'rerouted',
        pathBefore,
        pathAfter: resultAfter.path,
      })
    } else {
      supplyLost++
      affectedNodes.push({
        id: distNode.id,
        name: distNode.name,
        type: distNode.type,
        status: 'supply_lost',
        pathBefore,
        pathAfter: [],
      })
    }
  }

  affectedNodes.sort((a, b) => {
    if (a.status === 'supply_lost' && b.status !== 'supply_lost') return -1
    if (a.status !== 'supply_lost' && b.status === 'supply_lost') return 1
    return a.name.localeCompare(b.name, 'zh')
  })

  const stoppedEdgeIds = edges
    .filter(edge => edge.id === cutoffEdgeId || !reachableAfter.has(edge.startNodeId) || !reachableAfter.has(edge.endNodeId))
    .map(edge => edge.id)

  return {
    cutoffNodeId,
    cutoffNodeName: cutoffName,
    cutoffEdgeIds: [cutoffEdgeId],
    stoppedEdgeIds,
    sourceNodes: sourceNodeInfos,
    totalDistributionNodes: distributionNodes.length,
    affectedNodes,
    summary: { supplyLost, rerouted, same },
  }
}

/**
 * 节点名称搜索（供截断 Tab 搜索框使用）
 */
export function searchNodes(
  nodes: GraphNode[],
  keyword: string,
  typeFilter?: string
): GraphNode[] {
  const kw = keyword.trim().toLowerCase()
  return nodes
    .filter(n => {
      const nameMatch = n.name.toLowerCase().includes(kw)
      const typeMatch = typeFilter ? n.type === typeFilter : true
      return nameMatch && typeMatch
    })
    .slice(0, 20)
}

/**
 * 将路径 ID 数组转换为节点名称数组（用于 UI 展示）
 */
export function pathIdsToNames(pathIds: string[], nodes: GraphNode[]): string[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n.name]))
  return pathIds.map(id => nodeMap.get(id) ?? id)
}
