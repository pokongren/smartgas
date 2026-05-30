export const CORE_SOURCE_STATION_NAMES = [
    '霍尔果斯',
    '轮南',
    '瑞丽',
    '黑河',
] as const

export const SUPPLY_NODE_NAME_KEYWORDS = [
    'LNG',
    '接收站',
    '首站',
    '气源',
    '交气点',
    ...CORE_SOURCE_STATION_NAMES,
] as const

export function includesSupplyNodeKeyword(name: string): boolean {
    return SUPPLY_NODE_NAME_KEYWORDS.some(keyword => name.includes(keyword))
}
