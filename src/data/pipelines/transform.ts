import {
    NodeType,
    PipelineStatus,
    PressureLevel,
    type PipelineData,
    type PipelineKind,
    type PipelineLine,
    type PipelineNode,
    type RawStationType,
} from '@/types'
import type { PipelineLayer, PipelinePackage } from './types'

export function getPipelineLayerId(
    pkg: Pick<PipelinePackage, 'id'>,
    layer: Pick<PipelineLayer, 'id' | 'name' | 'type'>,
    index: number
): string {
    if (layer.id && layer.id.trim()) {
        return layer.id
    }
    const safeName = layer.name.trim().replace(/\s+/g, '-')
    return `${pkg.id}:${layer.type}:${safeName || index}`
}

function toNodeType(value: unknown): NodeType {
    switch (value) {
        case NodeType.VALVE:
        case NodeType.INTERFACE:
        case NodeType.JUNCTION:
        case NodeType.REGULATOR:
        case NodeType.METERING:
            return value
        default:
            return NodeType.JUNCTION
    }
}

function toPipelineStatus(value: unknown): PipelineStatus {
    switch (value) {
        case PipelineStatus.NORMAL:
        case PipelineStatus.MAINTENANCE:
        case PipelineStatus.FAULT:
        case PipelineStatus.DISABLED:
            return value
        default:
            return PipelineStatus.NORMAL
    }
}

function toPressureLevel(value: unknown): PressureLevel {
    switch (value) {
        case PressureLevel.HIGH:
        case PressureLevel.MEDIUM_HIGH:
        case PressureLevel.MEDIUM:
        case PressureLevel.LOW:
            return value
        default:
            return PressureLevel.HIGH
    }
}

function toRawStationType(value: unknown): RawStationType | undefined {
    switch (value) {
        case 'source':
        case 'compressor':
        case 'distribution':
        case 'valve':
        case 'storage':
        case 'junction':
        case 'other':
        case 'shared':
            return value
        default:
            return undefined
    }
}

function toPipelineKind(value: unknown): PipelineKind | undefined {
    switch (value) {
        case 'trunk':
        case 'branch':
        case 'interconnect':
            return value
        default:
            return undefined
    }
}

function toFiniteNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function collectLayerStartNodeIds(lines: PipelineLine[]): Set<string> {
    const startNodeIds = new Set<string>()
    lines.forEach((line) => {
        if (line.startNodeId != null) {
            startNodeIds.add(String(line.startNodeId))
        }
    })
    return startNodeIds
}

function normalizeNode(
    pkg: PipelinePackage,
    layer: PipelineLayer,
    node: PipelineNode,
    layerStartNodeIds: ReadonlySet<string>
): PipelineNode {
    const normalizedNodeId = String(node.id)

    return {
        ...node,
        id: normalizedNodeId,
        name: String(node.name ?? ''),
        type: toNodeType(node.type),
        rawType: toRawStationType(node.rawType) ?? toRawStationType(node.properties?.rawType),
        coordinate: {
            longitude: toFiniteNumber(node.coordinate?.longitude),
            latitude: toFiniteNumber(node.coordinate?.latitude),
        },
        pressureLevel: toPressureLevel(node.pressureLevel),
        status: toPipelineStatus(node.status),
        properties: {
            ...node.properties,
            systemId: node.properties?.systemId ?? pkg.id,
            layerName: node.properties?.layerName ?? layer.name,
            isLayerStartNode: node.properties?.isLayerStartNode ?? layerStartNodeIds.has(normalizedNodeId),
        },
    }
}

function normalizeLine(pkg: PipelinePackage, layer: PipelineLayer, line: PipelineLine): PipelineLine {
    const pipelineKind = toPipelineKind(line.pipelineKind)
        ?? toPipelineKind(line.properties?.pipelineKind)
        ?? toPipelineKind(layer.type)

    return {
        ...line,
        id: String(line.id),
        name: String(line.name ?? ''),
        startNodeId: String(line.startNodeId),
        endNodeId: String(line.endNodeId),
        path: Array.isArray(line.path)
            ? line.path.map((point) => ({
                longitude: toFiniteNumber(point?.longitude),
                latitude: toFiniteNumber(point?.latitude),
            }))
            : [],
        pipelineKind,
        diameter: toFiniteNumber(line.diameter, 1016),
        material: String(line.material ?? 'Steel'),
        pressureLevel: toPressureLevel(line.pressureLevel),
        length: toFiniteNumber(line.length),
        status: toPipelineStatus(line.status),
        systemId: line.systemId ?? pkg.id,
        layerName: line.layerName ?? layer.name,
        properties: {
            ...line.properties,
            pipelineKind: line.properties?.pipelineKind ?? pipelineKind,
            systemId: line.properties?.systemId ?? pkg.id,
            layerName: line.properties?.layerName ?? layer.name,
        },
    }
}

export function normalizePipelinePackages(packages: PipelinePackage[]): PipelinePackage[] {
    return packages.map((pkg) => ({
        ...pkg,
        layers: pkg.layers.map((layer, index) => {
            const normalizedLines = layer.lines.map((line) => normalizeLine(pkg, layer, line))
            const layerStartNodeIds = collectLayerStartNodeIds(normalizedLines)

            return {
                ...layer,
                id: getPipelineLayerId(pkg, layer, index),
                visible: layer.visible ?? true,
                nodes: layer.nodes.map((node) => normalizeNode(pkg, layer, node, layerStartNodeIds)),
                lines: normalizedLines,
            }
        }),
    }))
}

export function buildInitialLayerVisibility(packages: PipelinePackage[]): Record<string, boolean> {
    const visibility: Record<string, boolean> = {}

    packages.forEach((pkg) => {
        pkg.layers.forEach((layer, index) => {
            visibility[getPipelineLayerId(pkg, layer, index)] = layer.visible ?? true
        })
    })

    return visibility
}

export function buildPipelineDataFromPackages(
    packages: PipelinePackage[],
    visibleLayerIds?: Record<string, boolean>
): PipelineData {
    const nodes: PipelineNode[] = []
    const lines: PipelineLine[] = []

    packages.forEach((pkg) => {
        pkg.layers.forEach((layer, index) => {
            const layerId = getPipelineLayerId(pkg, layer, index)
            if (visibleLayerIds && !visibleLayerIds[layerId]) {
                return
            }

            nodes.push(...layer.nodes)
            lines.push(...layer.lines)
        })
    })

    return { nodes, lines, devices: [] }
}
