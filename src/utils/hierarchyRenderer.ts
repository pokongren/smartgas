import type { PipelineNode } from '@/types'
import { getJunctionKind, isMajorJunctionNode } from '@/utils/pipelineDomain'

export enum NodeImportance {
    CRITICAL = 1,
    HIGH = 2,
    MEDIUM = 3,
    LOW = 4,
    HIDDEN = 5,
}

export type ClusterDisplayMode = 'cluster' | 'expanded'

export const NODE_LOD_THRESHOLDS = {
    criticalZoom: 6,
    highZoom: 10,
    mediumZoom: 14,
    valveMinZoom: 11,
    expandClusterZoom: 12,
} as const

export interface NodeLODStrategy {
    maxVisibleImportance: NodeImportance
    showValveRooms: boolean
    clusterDisplayMode: ClusterDisplayMode
}

const SOURCE_KEYWORDS = [
    'LNG',
    '\u6c14\u7530',
    '\u50a8\u6c14\u5e93',
    '\u9996\u7ad9',
    '\u53e3\u5cb8',
    '\u56fd\u754c',
]
const CRITICAL_KEYWORDS = ['\u67a2\u7ebd']
const HIGH_KEYWORDS = ['\u538b\u6c14\u7ad9']
const MEDIUM_KEYWORDS = ['\u5206\u8f93\u7ad9', '\u95e8\u7ad9', '\u6e05\u7ba1\u7ad9']
const LOW_KEYWORDS = ['\u9600\u5ba4', '\u9600\u95e8']

function includesAnyKeyword(text: string, keywords: string[]): boolean {
    return keywords.some(keyword => text.includes(keyword))
}

function readRawType(node: PipelineNode): string | undefined {
    if (typeof node.rawType === 'string') {
        return node.rawType
    }

    const properties = node.properties
    if (!properties || typeof properties !== 'object') {
        return undefined
    }

    const rawType = (properties as Record<string, unknown>).rawType
    if (typeof rawType === 'string') {
        return rawType
    }

    return undefined
}

function isCriticalJunctionNode(node: PipelineNode, rawType: string | undefined): boolean {
    if (rawType !== 'junction') return false
    return isMajorJunctionNode(node)
}

function isValveLikeNode(node: PipelineNode, rawType: string | undefined): boolean {
    if (rawType === 'valve' || node.type === 'valve') return true
    const name = node.name || ''
    return includesAnyKeyword(name, LOW_KEYWORDS) || name.includes('#')
}

function isLayerStartNode(node: PipelineNode): boolean {
    return node.properties?.isLayerStartNode === true
}

export function getNodeImportance(node: PipelineNode): NodeImportance {
    const rawType = readRawType(node)
    if (rawType === 'source') return NodeImportance.CRITICAL
    if (isLayerStartNode(node)) return NodeImportance.CRITICAL
    if (isCriticalJunctionNode(node, rawType)) return NodeImportance.CRITICAL
    if (rawType === 'junction') {
        return getJunctionKind(node) === 'junction' ? NodeImportance.HIGH : NodeImportance.MEDIUM
    }
    if (rawType === 'compressor') return NodeImportance.HIGH
    if (rawType === 'storage') return NodeImportance.HIGH
    if (rawType === 'distribution') return NodeImportance.MEDIUM
    if (rawType === 'valve') return NodeImportance.LOW

    const name = (node.name || '').trim()
    if (!name) return NodeImportance.MEDIUM

    if (includesAnyKeyword(name, SOURCE_KEYWORDS)) return NodeImportance.CRITICAL
    if (includesAnyKeyword(name, CRITICAL_KEYWORDS)) return NodeImportance.CRITICAL
    if (includesAnyKeyword(name, HIGH_KEYWORDS)) return NodeImportance.HIGH
    if (includesAnyKeyword(name, MEDIUM_KEYWORDS)) return NodeImportance.MEDIUM
    if (includesAnyKeyword(name, LOW_KEYWORDS) || name.includes('#')) return NodeImportance.LOW

    return NodeImportance.MEDIUM
}

export function getMaxVisibleImportanceForZoom(zoom: number): NodeImportance {
    if (zoom < NODE_LOD_THRESHOLDS.criticalZoom) return NodeImportance.CRITICAL
    if (zoom < NODE_LOD_THRESHOLDS.highZoom) return NodeImportance.HIGH
    if (zoom < NODE_LOD_THRESHOLDS.mediumZoom) return NodeImportance.MEDIUM
    return NodeImportance.LOW
}

export function getClusterDisplayModeForZoom(zoom: number): ClusterDisplayMode {
    return zoom >= NODE_LOD_THRESHOLDS.expandClusterZoom ? 'expanded' : 'cluster'
}

export function getNodeLODStrategy(zoom: number): NodeLODStrategy {
    return {
        maxVisibleImportance: getMaxVisibleImportanceForZoom(zoom),
        showValveRooms: zoom >= NODE_LOD_THRESHOLDS.valveMinZoom,
        clusterDisplayMode: getClusterDisplayModeForZoom(zoom),
    }
}

export function shouldShowNodeAtZoom(
    node: PipelineNode,
    zoom: number,
    strategy: NodeLODStrategy = getNodeLODStrategy(zoom)
): boolean {
    const rawType = readRawType(node)
    if (getNodeImportance(node) > strategy.maxVisibleImportance) return false
    if (!strategy.showValveRooms && isValveLikeNode(node, rawType)) return false
    return true
}
