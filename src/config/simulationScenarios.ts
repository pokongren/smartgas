import type { SimulationInitialInput } from '@/types/simulation'

export type SimulationShowcaseCase = {
    id: string
    label: string
    flowText: string
    description: string
    scenarioId: string
    initialInput?: SimulationInitialInput
}

export const ZHONGWEI_SOURCE_NODE_ID = 'WE1-76'
export const ZHONGWEI_FIRST_TRUNK_EDGE_ID = 'WE1-T-76'

export const ZHONGWEI_MULTI_SCENARIO_CASES: SimulationShowcaseCase[] = [
    {
        id: 'zhongwei-3000',
        label: '中卫 3000 万标方/天',
        flowText: '3000',
        description: '基准供气工况，验证常规稳态能跑通。',
        scenarioId: 'steady_base',
        initialInput: {
            node_overrides: [{
                node_id: ZHONGWEI_SOURCE_NODE_ID,
                supply_max: 3000,
                nominal_flow: 3000,
                supply_nominal: 3000,
                target_pressure_mpa: 9.8,
            }],
        },
    },
    {
        id: 'zhongwei-2000',
        label: '中卫 2000 万标方/天',
        flowText: '2000',
        description: '上游供气下降工况，观察压力、流量和缺口变化。',
        scenarioId: 'steady_base',
        initialInput: {
            node_overrides: [{
                node_id: ZHONGWEI_SOURCE_NODE_ID,
                supply_max: 2000,
                nominal_flow: 2000,
                supply_nominal: 2000,
                target_pressure_mpa: 9.8,
            }],
        },
    },
    {
        id: 'zhongwei-cutoff',
        label: '中卫截断',
        flowText: '0',
        description: '上游首段关闭工况，演示故障传播和供气缺口。',
        scenarioId: 'steady_base',
        initialInput: {
            node_overrides: [{
                node_id: ZHONGWEI_SOURCE_NODE_ID,
                supply_max: 0,
                nominal_flow: 0,
                supply_nominal: 0,
                target_pressure_mpa: 0,
            }],
            edge_overrides: [{
                edge_id: ZHONGWEI_FIRST_TRUNK_EDGE_ID,
                flow_rate: 0,
                status: 'closed',
            }],
        },
    },
]

export const DEFAULT_ZHONGWEI_MULTI_SCENARIO_IDS = ZHONGWEI_MULTI_SCENARIO_CASES.map(item => item.id)

export function isZhongweiCutoffScenario(caseId: string): boolean {
    return caseId === 'zhongwei-cutoff'
}
