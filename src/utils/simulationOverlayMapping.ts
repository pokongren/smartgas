import type { SimEdgeResult, SimNodeResult, SimulationOverlay } from '@/types/simulation'

type AlertLevel = 'normal' | 'warning' | 'critical'

interface DisplayNodeLike {
  id: string
  name: string
  sourceNodeIds?: string[]
  internalSourceEdgeIds?: string[]
}

interface DisplayEdgeLike {
  id: string
  name?: string
  sourceEdgeIds?: string[]
}

export interface DisplayNodeSimulationMatch {
  displayNodeId: string
  displayNodeName: string
  sourceNodeIds: string[]
  matchedNodeIds: string[]
  missingSourceNodeIds: string[]
  matchedNodes: SimNodeResult[]
  internalSourceEdgeIds: string[]
  matchedInternalEdgeIds: string[]
  missingInternalSourceEdgeIds: string[]
  matchedInternalEdges: SimEdgeResult[]
  highestAlertLevel: AlertLevel
  averagePressureMpa: number | null
  highestInternalEdgeAlertLevel: AlertLevel
  averageInternalUtilization: number | null
  totalInternalFlowRate: number
}

export interface DisplayEdgeSimulationMatch {
  displayEdgeId: string
  displayEdgeName: string
  sourceEdgeIds: string[]
  matchedEdgeIds: string[]
  missingSourceEdgeIds: string[]
  matchedEdges: SimEdgeResult[]
  highestAlertLevel: AlertLevel
  averageUtilization: number | null
  totalFlowRate: number
}

export interface SimulationOverlayMappingSummary {
  displayNodeCount: number
  displayEdgeCount: number
  displayNodesWithMatchedOverlay: number
  displayEdgesWithMatchedOverlay: number
  displayNodesFullyMatched: number
  displayNodesPartiallyMatched: number
  displayNodesUnmatched: number
  displayEdgesFullyMatched: number
  displayEdgesPartiallyMatched: number
  displayEdgesUnmatched: number
  displayNodesWithMatchedInternalEdges: number
  matchedOverlayNodeCount: number
  matchedOverlayEdgeCount: number
  missingSourceNodeIdCount: number
  missingSourceEdgeIdCount: number
  missingInternalSourceEdgeIdCount: number
  missingSourceNodeIdsPreview: string[]
  missingSourceEdgeIdsPreview: string[]
  missingInternalSourceEdgeIdsPreview: string[]
  failureInvestigationLayer: 'frontend-consumption' | 'mapping-source-ids' | 'overlay-contract' | 'rendering-style'
  unmatchedOverlayNodeIds: string[]
  unmatchedOverlayEdgeIds: string[]
}

export interface SimulationOverlayMappingResult {
  summary: SimulationOverlayMappingSummary
  nodeMatchesByDisplayId: Map<string, DisplayNodeSimulationMatch>
  edgeMatchesByDisplayId: Map<string, DisplayEdgeSimulationMatch>
}

function mergeAlertLevel(current: AlertLevel, next: AlertLevel): AlertLevel {
  if (current === 'critical' || next === 'critical') return 'critical'
  if (current === 'warning' || next === 'warning') return 'warning'
  return 'normal'
}

function uniqueIds(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function resolveFailureInvestigationLayer(input: {
  displayNodeCount: number
  displayEdgeCount: number
  missingSourceNodeIds: string[]
  missingSourceEdgeIds: string[]
  missingInternalSourceEdgeIds: string[]
  unmatchedOverlayNodeIds: string[]
  unmatchedOverlayEdgeIds: string[]
}): 'frontend-consumption' | 'mapping-source-ids' | 'overlay-contract' | 'rendering-style' {
  if (input.displayNodeCount === 0 || input.displayEdgeCount === 0) {
    return 'frontend-consumption'
  }
  if (
    input.missingSourceNodeIds.length > 0
    || input.missingSourceEdgeIds.length > 0
    || input.missingInternalSourceEdgeIds.length > 0
  ) {
    return 'mapping-source-ids'
  }
  if (input.unmatchedOverlayNodeIds.length > 0 || input.unmatchedOverlayEdgeIds.length > 0) {
    return 'overlay-contract'
  }
  return 'rendering-style'
}

export function buildSimulationOverlayMapping(
  displayNodes: DisplayNodeLike[],
  displayEdges: DisplayEdgeLike[],
  overlay: SimulationOverlay | null,
): SimulationOverlayMappingResult | null {
  if (!overlay) return null

  const overlayNodeMap = new Map(overlay.nodes.map(item => [item.id, item]))
  const overlayEdgeMap = new Map(overlay.edges.map(item => [item.id, item]))
  const matchedOverlayNodeIds = new Set<string>()
  const matchedOverlayEdgeIds = new Set<string>()

  const nodeMatchesByDisplayId = new Map<string, DisplayNodeSimulationMatch>()
  for (const node of displayNodes) {
    const sourceNodeIds = uniqueIds(node.sourceNodeIds?.length ? node.sourceNodeIds : [node.id])
    const internalSourceEdgeIds = uniqueIds(node.internalSourceEdgeIds ?? [])
    const matchedNodes = sourceNodeIds
      .map(sourceId => overlayNodeMap.get(sourceId))
      .filter((item): item is SimNodeResult => Boolean(item))
    const matchedInternalEdges = internalSourceEdgeIds
      .map(sourceId => overlayEdgeMap.get(sourceId))
      .filter((item): item is SimEdgeResult => Boolean(item))
    const matchedNodeIds = matchedNodes.map(item => item.id)
    const matchedInternalEdgeIds = matchedInternalEdges.map(item => item.id)
    matchedNodeIds.forEach(id => matchedOverlayNodeIds.add(id))
    matchedInternalEdgeIds.forEach(id => matchedOverlayEdgeIds.add(id))

    const highestAlertLevel = matchedNodes.reduce<AlertLevel>(
      (level, item) => mergeAlertLevel(level, item.alert_level),
      'normal',
    )
    const averagePressureMpa = matchedNodes.length
      ? matchedNodes.reduce((sum, item) => sum + item.pressure_mpa, 0) / matchedNodes.length
      : null
    const highestInternalEdgeAlertLevel = matchedInternalEdges.reduce<AlertLevel>(
      (level, item) => mergeAlertLevel(level, item.alert_level),
      'normal',
    )
    const averageInternalUtilization = matchedInternalEdges.length
      ? matchedInternalEdges.reduce((sum, item) => sum + item.utilization, 0) / matchedInternalEdges.length
      : null
    const totalInternalFlowRate = matchedInternalEdges.reduce((sum, item) => sum + item.flow_rate, 0)

    nodeMatchesByDisplayId.set(node.id, {
      displayNodeId: node.id,
      displayNodeName: node.name,
      sourceNodeIds,
      matchedNodeIds,
      missingSourceNodeIds: sourceNodeIds.filter(sourceId => !overlayNodeMap.has(sourceId)),
      matchedNodes,
      internalSourceEdgeIds,
      matchedInternalEdgeIds,
      missingInternalSourceEdgeIds: internalSourceEdgeIds.filter(sourceId => !overlayEdgeMap.has(sourceId)),
      matchedInternalEdges,
      highestAlertLevel,
      averagePressureMpa,
      highestInternalEdgeAlertLevel,
      averageInternalUtilization,
      totalInternalFlowRate,
    })
  }

  const edgeMatchesByDisplayId = new Map<string, DisplayEdgeSimulationMatch>()
  for (const edge of displayEdges) {
    const sourceEdgeIds = uniqueIds(edge.sourceEdgeIds?.length ? edge.sourceEdgeIds : [edge.id])
    const matchedEdges = sourceEdgeIds
      .map(sourceId => overlayEdgeMap.get(sourceId))
      .filter((item): item is SimEdgeResult => Boolean(item))
    const matchedEdgeIds = matchedEdges.map(item => item.id)
    matchedEdgeIds.forEach(id => matchedOverlayEdgeIds.add(id))

    const highestAlertLevel = matchedEdges.reduce<AlertLevel>(
      (level, item) => mergeAlertLevel(level, item.alert_level),
      'normal',
    )
    const averageUtilization = matchedEdges.length
      ? matchedEdges.reduce((sum, item) => sum + item.utilization, 0) / matchedEdges.length
      : null
    const totalFlowRate = matchedEdges.reduce((sum, item) => sum + item.flow_rate, 0)

    edgeMatchesByDisplayId.set(edge.id, {
      displayEdgeId: edge.id,
      displayEdgeName: edge.name ?? edge.id,
      sourceEdgeIds,
      matchedEdgeIds,
      missingSourceEdgeIds: sourceEdgeIds.filter(sourceId => !overlayEdgeMap.has(sourceId)),
      matchedEdges,
      highestAlertLevel,
      averageUtilization,
      totalFlowRate,
    })
  }

  const nodeMatches = [...nodeMatchesByDisplayId.values()]
  const edgeMatches = [...edgeMatchesByDisplayId.values()]
  const unmatchedOverlayNodeIds = overlay.nodes
    .map(item => item.id)
    .filter(id => !matchedOverlayNodeIds.has(id))
  const unmatchedOverlayEdgeIds = overlay.edges
    .map(item => item.id)
    .filter(id => !matchedOverlayEdgeIds.has(id))
  const missingSourceNodeIds = uniqueIds(nodeMatches.flatMap(item => item.missingSourceNodeIds))
  const missingSourceEdgeIds = uniqueIds(edgeMatches.flatMap(item => item.missingSourceEdgeIds))
  const missingInternalSourceEdgeIds = uniqueIds(nodeMatches.flatMap(item => item.missingInternalSourceEdgeIds))
  const summary: SimulationOverlayMappingSummary = {
    displayNodeCount: displayNodes.length,
    displayEdgeCount: displayEdges.length,
    displayNodesWithMatchedOverlay: nodeMatches.filter(item => item.matchedNodes.length > 0).length,
    displayEdgesWithMatchedOverlay: edgeMatches.filter(item => item.matchedEdges.length > 0).length,
    displayNodesFullyMatched: nodeMatches.filter(
      item => item.sourceNodeIds.length > 0 && item.missingSourceNodeIds.length === 0 && item.matchedNodeIds.length > 0,
    ).length,
    displayNodesPartiallyMatched: nodeMatches.filter(
      item => item.matchedNodeIds.length > 0 && item.missingSourceNodeIds.length > 0,
    ).length,
    displayNodesUnmatched: nodeMatches.filter(item => item.matchedNodeIds.length === 0).length,
    displayEdgesFullyMatched: edgeMatches.filter(
      item => item.sourceEdgeIds.length > 0 && item.missingSourceEdgeIds.length === 0 && item.matchedEdgeIds.length > 0,
    ).length,
    displayEdgesPartiallyMatched: edgeMatches.filter(
      item => item.matchedEdgeIds.length > 0 && item.missingSourceEdgeIds.length > 0,
    ).length,
    displayEdgesUnmatched: edgeMatches.filter(item => item.matchedEdgeIds.length === 0).length,
    displayNodesWithMatchedInternalEdges: nodeMatches.filter(item => item.matchedInternalEdges.length > 0).length,
    matchedOverlayNodeCount: matchedOverlayNodeIds.size,
    matchedOverlayEdgeCount: matchedOverlayEdgeIds.size,
    missingSourceNodeIdCount: missingSourceNodeIds.length,
    missingSourceEdgeIdCount: missingSourceEdgeIds.length,
    missingInternalSourceEdgeIdCount: missingInternalSourceEdgeIds.length,
    missingSourceNodeIdsPreview: missingSourceNodeIds.slice(0, 8),
    missingSourceEdgeIdsPreview: missingSourceEdgeIds.slice(0, 8),
    missingInternalSourceEdgeIdsPreview: missingInternalSourceEdgeIds.slice(0, 8),
    failureInvestigationLayer: resolveFailureInvestigationLayer({
      displayNodeCount: displayNodes.length,
      displayEdgeCount: displayEdges.length,
      missingSourceNodeIds,
      missingSourceEdgeIds,
      missingInternalSourceEdgeIds,
      unmatchedOverlayNodeIds,
      unmatchedOverlayEdgeIds,
    }),
    unmatchedOverlayNodeIds,
    unmatchedOverlayEdgeIds,
  }

  return {
    summary,
    nodeMatchesByDisplayId,
    edgeMatchesByDisplayId,
  }
}
