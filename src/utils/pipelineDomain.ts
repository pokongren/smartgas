import type { JunctionKind, PipelineLine, PipelineNode, PipelineKind, RawStationType } from '@/types'

const COMPRESSOR_KEYWORDS = ['\u538b\u6c14\u7ad9']
const DISTRIBUTION_KEYWORDS = ['\u5206\u8f93\u7ad9', '\u95e8\u7ad9', '\u6e05\u7ba1\u7ad9']
const VALVE_KEYWORDS = ['\u9600\u5ba4', '\u9600\u95e8']
const SOURCE_KEYWORDS = [
    '\u9996\u7ad9',
    '\u672b\u7ad9',
    'LNG',
    '\u50a8\u6c14\u5e93',
    '\u6c14\u7530',
    '\u67a2\u7ebd',
    '\u8054\u7edc\u7ad9',
]
const BRANCH_KEYWORDS = ['\u652f\u7ebf']
const INTERCONNECT_KEYWORDS = ['\u8054\u7edc', '\u4e92\u8054']
const CORE_SOURCE_STATION_KEYWORDS = ['霍尔果斯', '轮南', '瑞丽', '黑河']
const SPECIAL_STYLE_EXCLUDED_STATION_KEYWORDS = ['哈密']

function toRawStationType(value: unknown): RawStationType | undefined {
    if (typeof value !== 'string') return undefined
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
    if (typeof value !== 'string') return undefined
    switch (value) {
        case 'trunk':
        case 'branch':
        case 'interconnect':
            return value
        default:
            return undefined
    }
}

function includesAnyKeyword(text: string, keywords: string[]): boolean {
    return keywords.some(keyword => text.includes(keyword))
}

function isCoreSourceStationName(name: string): boolean {
    return includesAnyKeyword(name || '', CORE_SOURCE_STATION_KEYWORDS)
}

function isSpecialStyleExcludedStationName(name: string): boolean {
    return includesAnyKeyword(name || '', SPECIAL_STYLE_EXCLUDED_STATION_KEYWORDS)
}

function readNodeRawType(node: PipelineNode): RawStationType | undefined {
    const directRawType = toRawStationType(node.rawType)
    if (directRawType) return directRawType

    const properties = node.properties
    if (!properties || typeof properties !== 'object') return undefined

    return toRawStationType((properties as Record<string, unknown>).rawType)
}

function readLinePipelineKind(line: PipelineLine): PipelineKind | undefined {
    const directKind = toPipelineKind(line.pipelineKind)
    if (directKind) return directKind

    const properties = line.properties
    if (!properties || typeof properties !== 'object') return undefined

    const props = properties as Record<string, unknown>
    const pipelineKind = toPipelineKind(props.pipelineKind)
    if (pipelineKind) return pipelineKind

    return toPipelineKind(props.type)
}

export function getNodeRawType(node: PipelineNode): RawStationType {
    if (isSpecialStyleExcludedStationName(node.name)) return inferNodeRawTypeFromName(node.name)
    if (isCoreSourceStationName(node.name)) return 'source'
    return readNodeRawType(node) || inferNodeRawTypeFromName(node.name)
}

export function getLinePipelineKind(line: PipelineLine): PipelineKind {
    const detectedKind = readLinePipelineKind(line)
    if (detectedKind) return detectedKind

    let category: unknown
    if (line.properties && typeof line.properties === 'object') {
        category = (line.properties as Record<string, unknown>).category
    }

    return inferPipelineKindFromText(line.name, category)
}

export function getJunctionKind(node: PipelineNode): JunctionKind | undefined {
    if (isSpecialStyleExcludedStationName(node.name)) return undefined

    const hubInfo = node.hubInfo
    if (hubInfo?.junctionKind === 'major_junction' || hubInfo?.junctionKind === 'junction') {
        return hubInfo.junctionKind
    }

    const properties = node.properties
    if (properties && typeof properties === 'object') {
        const rawKind = (properties as Record<string, unknown>).junctionKind
        if (rawKind === 'major_junction' || rawKind === 'junction') {
            return rawKind
        }
    }

    const rawType = getNodeRawType(node)
    if (rawType === 'junction' && (node.hubInfo?.isJunction || node.isHub)) {
        return 'junction'
    }

    return undefined
}

export function isMajorJunctionNode(node: PipelineNode): boolean {
    if (node.hubInfo?.isMajorJunction === true) {
        return true
    }
    return getJunctionKind(node) === 'major_junction'
}

export function isHubNode(node: PipelineNode): boolean {
    if (isSpecialStyleExcludedStationName(node.name)) return false
    if (isCoreSourceStationName(node.name)) return false
    if (node.isHub === true) return true
    if (node.hubInfo?.isJunction === true || node.hubInfo?.isMajorJunction === true) return true
    if (getJunctionKind(node)) return true

    const properties = node.properties
    if (!properties || typeof properties !== 'object') return false

    const props = properties as Record<string, unknown>
    return props.isHub === true
        || props.isJunction === true
        || props.rawType === 'junction'
        || props.junctionKind === 'junction'
        || props.junctionKind === 'major_junction'
}

export function isValveNode(node: PipelineNode): boolean {
    return getNodeRawType(node) === 'valve'
}

export function isCompressorNode(node: PipelineNode): boolean {
    if (isCoreSourceStationName(node.name)) return false
    return getNodeRawType(node) === 'compressor'
}

export function isDistributionNode(node: PipelineNode): boolean {
    if (isCoreSourceStationName(node.name)) return false
    return getNodeRawType(node) === 'distribution'
}

export function isSourceNode(node: PipelineNode): boolean {
    if (isSpecialStyleExcludedStationName(node.name)) return false
    return isCoreSourceStationName(node.name) || getNodeRawType(node) === 'source'
}

export function isLngSourceNode(node: PipelineNode): boolean {
    if (!isSourceNode(node)) return false

    const props = node.properties
    const gasSource = props && typeof props === 'object'
        ? (props as Record<string, any>).gasSource
        : undefined
    const sourceType = gasSource && typeof gasSource === 'object'
        ? String((gasSource as Record<string, unknown>).sourceType || '').toLowerCase()
        : ''

    return sourceType === 'lng' || /lng/i.test(node.name)
}

export function inferNodeRawTypeFromName(name: string): RawStationType {
    if (isSpecialStyleExcludedStationName(name)) {
        if (includesAnyKeyword(name, COMPRESSOR_KEYWORDS)) return 'compressor'
        if (includesAnyKeyword(name, DISTRIBUTION_KEYWORDS)) return 'distribution'
        return 'other'
    }
    if (includesAnyKeyword(name, COMPRESSOR_KEYWORDS)) return 'compressor'
    if (includesAnyKeyword(name, DISTRIBUTION_KEYWORDS)) return 'distribution'
    if (includesAnyKeyword(name, VALVE_KEYWORDS) || name.includes('#')) return 'valve'
    if (includesAnyKeyword(name, SOURCE_KEYWORDS)) return 'source'
    return 'junction'
}

export function inferPipelineKindFromText(...texts: Array<unknown>): PipelineKind {
    for (const text of texts) {
        if (typeof text !== 'string') continue
        if (includesAnyKeyword(text, BRANCH_KEYWORDS)) return 'branch'
        if (includesAnyKeyword(text, INTERCONNECT_KEYWORDS)) return 'interconnect'
    }
    return 'trunk'
}
