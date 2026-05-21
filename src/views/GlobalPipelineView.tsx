import React, { useMemo, useState, useCallback, lazy, Suspense, useEffect, useRef } from 'react'
import MapView from '@/components/map-view/MapView'
import {
    buildInitialLayerVisibility,
    buildPipelineDataFromPackages,
    getPipelineLayerId,
    loadAllPipelines,
    PipelinePackage,
    PipelineLayer
} from '@/data/pipelines'
import type { PipelineData, PipelineLine, PipelineNode } from '@/types'
import ScadaHistoryChart from '@/components/scada/ScadaHistoryChartCompat'
import StationHistoryPanel from '@/components/scada/StationHistoryPanel'
import {
    CRED_SCADA_DATA,
    EXTRA_SCADA_PANELS,
    PT_SCADA_DATA,
    REAL_SCADA_DATA,
    SCADA_DATA_MAP,
    WE1_FULL_STATIONS,
    WE1_WEST_SCADA_DATA,
    WE2_SCADA_DATA,
} from '@/views/global-pipeline/scadaConfig'
import { EmptyScadaState, ScadaFloatingPanel } from '@/views/global-pipeline/ScadaFloatingPanel'
import type { ScadaRecord } from '@/views/global-pipeline/scadaConfig'
import { setAssistantRuntimeContext } from '@/components/ai-assistant/runtimeAssistantContext'
import { useSimulation } from '@/hooks/useSimulation'
import {
    DEFAULT_WE1_PILOT_ID,
    resolveSimulationPilotConfig,
} from '@/types/simulation'
import type { SimulationInitialInput, SimulationOverlay } from '@/types/simulation'

import { getNodeMarkerMap } from '@/utils/mapRenderer'
import { useNewWindow, usePopoutSync } from '@/hooks/useNewWindow'
import { getNodeRawType } from '@/utils/pipelineDomain'
import { getJunctionKind } from '@/utils/pipelineDomain'

const noop = () => {}

type HubNodeType = 'source' | 'compressor' | 'junction' | 'distribution'

const CORE_SOURCE_STATION_NAMES = [
    '霍尔果斯',
    '轮南',
    '瑞丽',
    '黑河',
]

const CORE_HUB_STATION_NAMES = [
    '中卫',
    '靖边',
    '安平',
    '永清',
    '贵阳',
    '广州',
    '贵港',
    '南昌',
    '平顶山',
    '薛店',
    '泰安',
    '甪直',
    '嘉兴',
]

type TrendChartStation = {
    name: string
    inP: number
    outP: number
    type: string
    mileage: number
}

type TrendChartConfig = {
    pipelineId: string
    title: string
    color: string
    stations: TrendChartStation[]
    mileageMode: 'estimated' | 'sequence'
}

type DirectoryLayoutState = {
    position?: { x: number; y: number }
    size?: { width: number; height: number }
    orderIds?: string[]
    visibleLayers?: Record<string, boolean>
    expandedGroups?: Record<string, boolean>
    scadaPanels?: {
        we1?: boolean
        we1West?: boolean
        we2?: boolean
        cred?: boolean
        pt?: boolean
        extra?: Record<string, boolean>
    }
    activeTrendPipelineId?: string | null
    activePressureOverlayIds?: Record<string, boolean>
    trendWidth?: number
}

type MultiScenarioAiCase = {
    id: string
    label: string
    flowText: string
    description: string
    scenarioId: string
    initialInput?: SimulationInitialInput
}

type MultiScenarioAiResult = {
    caseId: string
    label: string
    flowText: string
    description: string
    overlay: SimulationOverlay
    sourceFlow: number
    unservedDemand: number
    alertCount: number
    avgUtilization: number
    minPressure: number
    minPressureNodeName: string
    iterations: number
    runId: string
}

type MultiScenarioAiStartEventDetail = {
    skillName?: string
    message?: string
    selectedScenarioIds?: string[]
}

type SimulationPressureChartLayout = {
    x: number
    y: number
    width: number
    height: number
}

type SimulationPressureChartEntry = {
    id: string
    label: string
    overlay: SimulationOverlay
    color: string
}

const DIRECTORY_LAYOUT_STORAGE_KEY = 'smartgas.globalPipeline.directoryLayout.v1'
const AI_ASSISTANT_SYNC_CHANNEL = 'ai-assistant-sync'
const MULTI_SCENARIO_AI_SKILL_NAME = 'multi-scenario-ai'
const ZHONGWEI_SOURCE_NODE_ID = 'WE1-76'
const ZHONGWEI_FIRST_TRUNK_EDGE_ID = 'WE1-T-76'

const WE1_PILOT_NODE_NAMES: Record<string, string> = {
    'WE1-76': '中卫压气站',
    'WE1-86': '西一盐池压气站',
    'WE1-92': '西一靖边压气站',
    'WE1-98': '子长分输站',
    'WE1-100': '延川压气站',
    'WE1-102': '延川西分输站',
    'WE1-108': '蒲县压气站',
    'WE1-111': '临汾分输站',
    'WE1-117': '沁水压气站',
    'WE1-123': '博爱分输站',
    'WE1-127': '郑州压气站',
    'WE1-129': '薛店分输站',
    'WE1-136': '淮阳压气站',
    'WE1-140': '太和分输站',
    'WE1-143': '利辛分输站',
    'WE1-150': '刘巷子分输站',
    'WE1-152': '定远压气站',
    'WE1-155': '滁州分输站',
    'WE1-157': '龙池分输站',
    'WE1-159': '青山分输站',
    'WE1-160': '龙潭分输站',
    'WE1-164': '镇江分输站',
    'WE1-165': '丹阳分输站',
    'WE1-168': '常州分输站',
    'WE1-169': '芙蓉分输站',
    'WE1-172': '无锡分输站',
    'WE1-173': '东桥分输站',
    'WE1-176': '苏州分输站',
    'WE1-179': '甪直分输站',
    'WE1-180': '昆山分输站',
    'WE1-181': '白鹤末站',
}

const WE1_PILOT_START_MILEAGE_KM = 2008.2399
const WE1_PILOT_MILEAGE_ANCHORS: Array<[number, number]> = [
    [76, 2008.2399],
    [86, 2190.506],
    [92, 2343.806],
    [98, 2454.488],
    [100, 2494.007],
    [102, 2513.3548],
    [108, 2635.207],
    [111, 2697.907],
    [117, 2787.5069],
    [123, 2891.4069],
    [127, 2953.6399],
    [129, 2997.3459],
    [136, 3141.3191],
    [140, 3218.119],
    [143, 3293.097],
    [150, 3391.285],
    [152, 3446.211],
    [155, 3512.141],
    [157, 3559.341],
    [159, 3586.664],
    [160, 3593.95],
    [164, 3633.125],
    [165, 3655.288],
    [168, 3700.402],
    [169, 3717.33],
    [172, 3754.483],
    [173, 3773.533],
    [176, 3797.6201],
    [179, 3819.2541],
    [180, 3832.3461],
    [181, 3846.1981],
]

const MULTI_SCENARIO_AI_CASES: MultiScenarioAiCase[] = [
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

function readDirectoryLayoutState(): DirectoryLayoutState {
    if (typeof window === 'undefined') return {}

    try {
        const raw = window.localStorage.getItem(DIRECTORY_LAYOUT_STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw) as DirectoryLayoutState
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
        console.warn('[GlobalPipelineView] 读取管线目录布局失败:', error)
        return {}
    }
}

function clampNumber(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
}

function normalizeStationMatchKey(name: string): string {
    return name
        .replace(/[（(][^()（）]*[)）]/g, '')
        .replace(/\s+/g, '')
        .replace(/分输压气站|分输联络站|分输清管站|压气站|分输站|清管站|末站/g, '')
}

function resolvePilotNodeName(nodeId: string): string {
    return WE1_PILOT_NODE_NAMES[nodeId] || nodeId
}

function resolvePilotNodeIndex(nodeId: string): number | null {
    const match = /^WE1-(\d+)$/.exec(nodeId)
    if (!match) return null
    const value = Number(match[1])
    return Number.isFinite(value) ? value : null
}

function resolvePilotMileageKm(nodeId: string): number | null {
    const nodeIndex = resolvePilotNodeIndex(nodeId)
    if (nodeIndex == null) return null

    const exactAnchor = WE1_PILOT_MILEAGE_ANCHORS.find(([index]) => index === nodeIndex)
    if (exactAnchor) {
        return Number((exactAnchor[1] - WE1_PILOT_START_MILEAGE_KM).toFixed(1))
    }

    let previousAnchor: [number, number] | null = null
    let nextAnchor: [number, number] | null = null

    for (const anchor of WE1_PILOT_MILEAGE_ANCHORS) {
        if (anchor[0] < nodeIndex) previousAnchor = anchor
        if (anchor[0] > nodeIndex) {
            nextAnchor = anchor
            break
        }
    }

    if (!previousAnchor || !nextAnchor || nextAnchor[0] === previousAnchor[0]) return null

    const ratio = (nodeIndex - previousAnchor[0]) / (nextAnchor[0] - previousAnchor[0])
    const mileage = previousAnchor[1] + (nextAnchor[1] - previousAnchor[1]) * ratio
    return Number((mileage - WE1_PILOT_START_MILEAGE_KM).toFixed(1))
}

function inferSimulationStationType(nodeId: string, name: string): string {
    if (name.includes('压气站')) return 'compressor'
    if (name.includes('阀室') || !WE1_PILOT_NODE_NAMES[nodeId]) return 'valve'
    return 'distribution'
}

function getSimulationPressureChartColor(caseId: string): string {
    if (caseId.includes('2000')) return '#38bdf8'
    if (caseId.includes('cutoff')) return '#f97316'
    return '#10b981'
}

function buildDefaultSimulationPressureChartLayout(index: number, viewportWidth: number, viewportHeight: number): SimulationPressureChartLayout {
    const availableWidth = Math.max(760, viewportWidth - 420)
    const baseWidth = clampNumber(Math.floor(availableWidth / 2), 560, 760)
    const baseHeight = clampNumber(Math.floor((viewportHeight - 130) / 2), 270, 340)
    const columnGap = 18
    const rowGap = 18
    const startX = 24
    const startY = 86
    const col = index % 2
    const row = Math.floor(index / 2)

    return {
        x: clampNumber(startX + col * (baseWidth + columnGap), 0, Math.max(0, viewportWidth - baseWidth - 12)),
        y: clampNumber(startY + row * (baseHeight + rowGap), 64, Math.max(64, viewportHeight - baseHeight - 12)),
        width: baseWidth,
        height: baseHeight,
    }
}

function buildSimulationPressureTrendConfig(
    overlay: SimulationOverlay | null,
    label?: string,
    color = '#10b981',
): TrendChartConfig | null {
    if (!overlay) return null

    const stations = overlay.nodes
        .map((node): TrendChartStation | null => {
            const mileage = resolvePilotMileageKm(node.id)
            if (mileage == null) return null

            const pressureIn = typeof node.pressure_in_mpa === 'number' ? node.pressure_in_mpa : node.pressure_mpa
            const pressureOut = node.pressure_mpa
            if (!Number.isFinite(pressureIn) || !Number.isFinite(pressureOut)) return null

            const name = resolvePilotNodeName(node.id)
            return {
                name: WE1_PILOT_NODE_NAMES[node.id] ? name : `${node.id}阀室`,
                inP: pressureIn,
                outP: pressureOut,
                type: inferSimulationStationType(node.id, name),
                mileage,
            }
        })
        .filter((station): station is TrendChartStation => Boolean(station))
        .sort((left, right) => left.mileage - right.mileage)

    if (stations.length === 0) return null

    const safeRunId = overlay.run_id.replace(/[^a-zA-Z0-9_-]/g, '-')
    return {
        pipelineId: `sim-we1-${safeRunId}`,
        title: label ? `西气东输一线·中卫-上海白鹤仿真 · ${label}` : '西气东输一线·中卫-上海白鹤仿真',
        color,
        stations,
        mileageMode: 'estimated',
    }
}

function findPipelineNodeByPilotNodeId(nodeId: string, pipelineData: PipelineData): PipelineNode | null {
    const pilotName = resolvePilotNodeName(nodeId)
    const pilotKey = normalizeStationMatchKey(pilotName)
    return pipelineData.nodes.find(node => {
        return node.id === nodeId
            || node.name === pilotName
            || normalizeStationMatchKey(node.name) === pilotKey
    }) || null
}

function buildMultiScenarioRiskScore(result: MultiScenarioAiResult): number {
    return result.unservedDemand * 1000
        + result.alertCount * 10
        + Math.max(0, 8 - result.minPressure) * 100
}

function formatScenarioDelta(current: number, reference: number, unit = '', digits = 0): string {
    const delta = current - reference
    if (Math.abs(delta) < 0.0001) return `持平${unit ? `（${current.toFixed(digits)}${unit}）` : ''}`
    return `${delta > 0 ? '增加' : '减少'} ${Math.abs(delta).toFixed(digits)}${unit}`
}

function classifyScenarioIntent(result: MultiScenarioAiResult, reference: MultiScenarioAiResult): string {
    const label = result.label.toLowerCase()
    if (/(截断|中断|关闭|关断|停运|停输|故障|破裂|泄漏|offline|break|close|cut)/i.test(label)) {
        return '故障隔离类工况'
    }
    if (/(高峰|负荷|需求|上调|增供|提升|扩供|peak|demand)/i.test(label)) {
        return '负荷或增供扰动工况'
    }
    if (/(限供|受限|限流|下调|减供|下降|低供|limited|drop)/i.test(label) || result.sourceFlow < reference.sourceFlow - 1) {
        return '供气受限类工况'
    }
    if (Math.abs(result.sourceFlow - reference.sourceFlow) <= 1) {
        return '同入口边界扰动工况'
    }
    return result.sourceFlow > reference.sourceFlow ? '增供边界工况' : '边界扰动工况'
}

function buildMultiScenarioAiConclusion(results: MultiScenarioAiResult[]): string {
    if (results.length === 0) return '等待已选工况运行完成后生成比对结论。'

    const ranked = [...results].sort((left, right) => buildMultiScenarioRiskScore(right) - buildMultiScenarioRiskScore(left))
    const worst = ranked[0]
    const reference = results[0]
    const intent = classifyScenarioIntent(worst, reference)
    const supplyDeltaText = reference ? formatScenarioDelta(worst.sourceFlow, reference.sourceFlow, ' 万标方/天') : '暂无对照'
    const unservedDeltaText = reference ? formatScenarioDelta(worst.unservedDemand, reference.unservedDemand, ' 万标方/天') : '暂无对照'
    const pressureDeltaText = reference ? formatScenarioDelta(worst.minPressure, reference.minPressure, ' MPa', 2) : '暂无对照'

    return `AI比对结论：本轮 ${results.length} 个已选工况中，“${worst.label}”综合风险最高，属于${intent}。相对首个已选工况，入口供气${supplyDeltaText}，未满足需求${unservedDeltaText}，最低进站压力${pressureDeltaText}，落在 ${worst.minPressureNodeName}（${worst.minPressure.toFixed(2)} MPa）。本演示只验证 AI 能否先选工况、再调用简化稳态模型并自动解释结果，不等同工业级水力精算。`
}

function buildDetailedMultiScenarioAnalysis(results: MultiScenarioAiResult[]): string {
    if (results.length === 0) return '等待已选工况运行完成后生成详细参数对比。'

    const reference = results[0]
    const ranked = [...results].sort((left, right) => buildMultiScenarioRiskScore(right) - buildMultiScenarioRiskScore(left))
    const worst = ranked[0]
    const formatUtil = (value: number) => `${(value * 100).toFixed(1)}%`
    const lowerFlowCase = results.find(result => result.caseId !== reference.caseId && result.sourceFlow < reference.sourceFlow - 1)
    const lowerFlowNote = lowerFlowCase
        ? `像“${lowerFlowCase.label}”这类降量工况，流量下降后沿程压降会变小，所以最低压力不一定更低；`
        : '如果出现降量工况，流量下降后沿程压降可能变小，所以最低压力不一定更低；'
    const detailLines = results.slice(1).map((result, index) => {
        const intent = classifyScenarioIntent(result, reference)
        const pressureDelta = formatScenarioDelta(result.minPressure, reference.minPressure, ' MPa', 2)
        const riskRank = ranked.findIndex(item => item.caseId === result.caseId) + 1
        return `${index + 2}. ${result.label} 属于${intent}：入口供气 ${result.sourceFlow.toFixed(0)} 万标方/天，较对照${formatScenarioDelta(result.sourceFlow, reference.sourceFlow, ' 万标方/天')}；未满足需求 ${result.unservedDemand.toFixed(0)} 万标方/天，较对照${formatScenarioDelta(result.unservedDemand, reference.unservedDemand, ' 万标方/天')}；最低进站压力 ${result.minPressure.toFixed(2)} MPa，位置在 ${result.minPressureNodeName}，较对照${pressureDelta}；告警 ${result.alertCount.toFixed(0)} 个，平均利用率 ${formatUtil(result.avgUtilization)}，求解迭代 ${result.iterations} 次；按当前风险评分排第 ${riskRank}。`
    })

    return [
        `详细参数对比：本次 AI 先把所选工况转成结构化边界条件，再依次调用简化稳态模型运行 ${results.length} 个工况，统一比较入口供气量、未满足需求、最低进站压力、告警数、平均管段利用率和求解迭代次数。`,
        `1. ${reference.label} 作为对照工况：入口供气 ${reference.sourceFlow.toFixed(0)} 万标方/天，未满足需求 ${reference.unservedDemand.toFixed(0)} 万标方/天，最低进站压力 ${reference.minPressure.toFixed(2)} MPa，位置在 ${reference.minPressureNodeName}，平均利用率 ${formatUtil(reference.avgUtilization)}，告警 ${reference.alertCount.toFixed(0)} 个，迭代 ${reference.iterations} 次。`,
        ...detailLines,
        `读数解释：${worst.label} 的风险最高，主要是供气缺口、低压水平和告警数量叠加更强。${lowerFlowNote}这正好说明仿真读数要结合工况类型一起看，而不是只盯一个数。中卫-上海白鹤压力曲线已同步生成，可横向对比压力坡降、局部抬升和末端压力变化。以上结果仍是概念级稳态推演，重点验证 AI 是否能自动编排工况、调用现有参数并生成可读结论，不替代专业水力精算。`,
    ].filter(Boolean).join('\n\n')
}

function formatMultiScenarioAiMessage(results: MultiScenarioAiResult[]): string {
    const lines = [
        'multi-scenario-ai skill 已完成。',
        '',
        buildMultiScenarioAiConclusion(results),
        '',
        '关键指标对比：',
        '',
        '| 工况 | 入口量(万方/天) | 未满足(万方/天) | 最低进站(MPa/位置) | 告警 | 利用率 | 迭代 |',
        '|---|---:|---:|---:|---:|---:|---:|',
    ]
    results.forEach(result => {
        lines.push(
            `| ${result.label} | ${result.sourceFlow.toFixed(0)} | ${result.unservedDemand.toFixed(0)} | ${result.minPressure.toFixed(2)} ${result.minPressureNodeName} | ${result.alertCount.toFixed(0)} | ${(result.avgUtilization * 100).toFixed(1)}% | ${result.iterations} |`,
        )
    })
    lines.push('')
    lines.push(buildDetailedMultiScenarioAnalysis(results))
    return lines.join('\n')
}

function emitMultiScenarioAiAssistantEvent(type: 'progress' | 'result', detail: Record<string, unknown>): void {
    const eventType = type === 'progress'
        ? 'assistant-multi-scenario-ai-progress'
        : 'assistant-multi-scenario-ai-result'
    const payload = {
        type: eventType,
        detail: {
            skillName: MULTI_SCENARIO_AI_SKILL_NAME,
            ...detail,
        },
    }

    window.dispatchEvent(new CustomEvent(eventType, { detail: payload.detail }))
    try {
        const channel = new BroadcastChannel(AI_ASSISTANT_SYNC_CHANNEL)
        channel.postMessage(payload)
        channel.close()
    } catch {
        // 同窗口事件已经足够，BroadcastChannel 只是给弹出 AI 窗口同步。
    }
}

function hexToRgba(hex: string, alpha: number): string {
    const normalized = hex.replace('#', '')
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return `rgba(59,130,246,${alpha})`
    }

    const r = Number.parseInt(normalized.slice(0, 2), 16)
    const g = Number.parseInt(normalized.slice(2, 4), 16)
    const b = Number.parseInt(normalized.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${alpha})`
}

type LngLatTuple = [number, number]

function collectLayerCoordinates(layer: PipelineLayer): LngLatTuple[] {
    const coordinates: LngLatTuple[] = []
    const seen = new Set<string>()

    const pushCoordinate = (longitude: unknown, latitude: unknown) => {
        if (typeof longitude !== 'number' || typeof latitude !== 'number') return
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return

        const key = `${longitude.toFixed(6)},${latitude.toFixed(6)}`
        if (seen.has(key)) return
        seen.add(key)
        coordinates.push([longitude, latitude])
    }

    layer.lines.forEach((line) => {
        line.path.forEach((point) => pushCoordinate(point.longitude, point.latitude))
    })
    layer.nodes.forEach((node) => {
        pushCoordinate(node.coordinate?.longitude, node.coordinate?.latitude)
    })

    return coordinates
}

function collectPackageCoordinates(pkg: PipelinePackage): LngLatTuple[] {
    const coordinates: LngLatTuple[] = []
    const seen = new Set<string>()

    pkg.layers.forEach((layer) => {
        collectLayerCoordinates(layer).forEach(([longitude, latitude]) => {
            const key = `${longitude.toFixed(6)},${latitude.toFixed(6)}`
            if (seen.has(key)) return
            seen.add(key)
            coordinates.push([longitude, latitude])
        })
    })

    return coordinates
}

function buildGraphDistanceIndex(layer: PipelineLayer | undefined) {
    const exactNameToNodeId = new Map<string, string>()
    const normalizedNameToNodeId = new Map<string, string>()
    const adjacency = new Map<string, Array<{ to: string; lengthKm: number }>>()

    if (!layer) {
        return { exactNameToNodeId, normalizedNameToNodeId, adjacency }
    }

    layer.nodes.forEach((node) => {
        exactNameToNodeId.set(node.name, node.id)

        const normalizedKey = normalizeStationMatchKey(node.name)
        if (normalizedKey && !normalizedNameToNodeId.has(normalizedKey)) {
            normalizedNameToNodeId.set(normalizedKey, node.id)
        }
    })

    layer.lines.forEach((line) => {
        const startId = String(line.startNodeId)
        const endId = String(line.endNodeId)
        const lengthKm = typeof line.length === 'number' && Number.isFinite(line.length) && line.length > 0
            ? line.length / 1000
            : 0

        if (!adjacency.has(startId)) adjacency.set(startId, [])
        if (!adjacency.has(endId)) adjacency.set(endId, [])

        adjacency.get(startId)?.push({ to: endId, lengthKm })
        adjacency.get(endId)?.push({ to: startId, lengthKm })
    })

    return { exactNameToNodeId, normalizedNameToNodeId, adjacency }
}

function resolveNodeIdByStationName(
    stationName: string,
    exactNameToNodeId: Map<string, string>,
    normalizedNameToNodeId: Map<string, string>,
): string | undefined {
    const exactMatch = exactNameToNodeId.get(stationName)
    if (exactMatch) return exactMatch

    return normalizedNameToNodeId.get(normalizeStationMatchKey(stationName))
}

function findShortestDistanceKm(
    adjacency: Map<string, Array<{ to: string; lengthKm: number }>>,
    startId: string,
    endId: string,
): number | null {
    if (startId === endId) return 0
    if (!adjacency.has(startId) || !adjacency.has(endId)) return null

    const distances = new Map<string, number>([[startId, 0]])
    const visited = new Set<string>()
    const queue: Array<{ id: string; distance: number }> = [{ id: startId, distance: 0 }]

    while (queue.length > 0) {
        queue.sort((a, b) => a.distance - b.distance)
        const current = queue.shift()
        if (!current) break
        if (visited.has(current.id)) continue
        visited.add(current.id)

        if (current.id === endId) {
            return current.distance
        }

        const neighbors = adjacency.get(current.id) || []
        neighbors.forEach((neighbor) => {
            if (visited.has(neighbor.to)) return

            const nextDistance = current.distance + Math.max(neighbor.lengthKm, 0.1)
            const knownDistance = distances.get(neighbor.to)
            if (knownDistance == null || nextDistance < knownDistance) {
                distances.set(neighbor.to, nextDistance)
                queue.push({ id: neighbor.to, distance: nextDistance })
            }
        })
    }

    return null
}

function getTrendSource(pipelineId: string): { title: string; color: string; entries: Array<[string, ScadaRecord]> } | null {
    if (pipelineId === 'we1') {
        return {
            title: '西气东输一线',
            color: '#10b981',
            entries: WE1_FULL_STATIONS.map((station) => [
                station.name,
                {
                    inP: station.inP,
                    outP: station.outP,
                    type: station.type as ScadaRecord['type'],
                },
            ]),
        }
    }

    const scadaEntry = SCADA_DATA_MAP[pipelineId]
    if (!scadaEntry) return null

    return {
        title: scadaEntry.label,
        color: scadaEntry.color,
        entries: Object.entries(scadaEntry.data),
    }
}

function buildTrendChartConfig(pkg: PipelinePackage | undefined, pipelineId: string): TrendChartConfig | null {
    const source = getTrendSource(pipelineId)
    if (!source) return null

    const trunkLayer = pkg?.layers.find((layer) => layer.type === 'trunk') ?? pkg?.layers[0]
    const { exactNameToNodeId, normalizedNameToNodeId, adjacency } = buildGraphDistanceIndex(trunkLayer)

    let cumulativeMileage = 0
    let previousNodeId: string | undefined
    let usedEstimatedMileage = false

    const stations = source.entries
        .filter(([, record]) => Number.isFinite(record.inP) && Number.isFinite(record.outP))
        .map(([name, record], index) => {
            const currentNodeId = resolveNodeIdByStationName(name, exactNameToNodeId, normalizedNameToNodeId)
            if (index > 0) {
                const distanceKm = previousNodeId && currentNodeId
                    ? findShortestDistanceKm(adjacency, previousNodeId, currentNodeId)
                    : null

                if (distanceKm != null) {
                    cumulativeMileage += distanceKm
                    usedEstimatedMileage = true
                } else {
                    cumulativeMileage += 1
                }
            }

            previousNodeId = currentNodeId

            return {
                name,
                inP: record.inP,
                outP: record.outP,
                type: record.type || 'distribution',
                mileage: Number(cumulativeMileage.toFixed(1)),
            }
        })
        .filter((station) => station.inP > 0.1 || station.outP > 0.1)

    return {
        pipelineId,
        title: source.title,
        color: source.color,
        stations,
        mileageMode: usedEstimatedMileage ? 'estimated' : 'sequence',
    }
}

/**
 * 西气东输一线 · 水力坡降线（SVG）
 *
 * 绘制逻辑：
 *   - 压气站：显示 inP 和 outP 两个点，竖线跃变（增压）
 *   - 其余站场：只显示 inP
 *   - 用一条连续线串起来：上一站 outP → 下一站 inP → (如果是压气站) outP → ...
 *   - 形成经典的 SCADA 水力坡降锯齿形
 */
const LegacyPressureTrendChart: React.FC<{
    title: string
    accentColor: string
    stations: TrendChartStation[]
    mileageMode: 'estimated' | 'sequence'
    onClose: () => void
    onMouseDown?: (e: React.MouseEvent) => void
    isDragging?: boolean
}> = ({ title, accentColor, stations, mileageMode, onClose, onMouseDown, isDragging }) => {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
    const hasStations = stations.length > 0

    const W = 860, H = 320
    const padL = 50, padR = 25, padT = 25, padB = 70
    const chartW = W - padL - padR
    const chartH = H - padT - padB

    const allP = hasStations
        ? stations.flatMap((station) => station.type === 'compressor' ? [station.inP, station.outP] : [station.inP])
        : [0, 1]
    const minP = Math.floor(Math.min(...allP) * 2) / 2
    const maxP = Math.ceil(Math.max(...allP) * 2) / 2 + 0.5
    const rangeP = maxP - minP || 1
    const maxMileage = hasStations ? Math.max(...stations.map((station) => station.mileage), 1) : 1
    const xAxisLabel = mileageMode === 'estimated' ? '估算里程 km' : '站序'

    const borderColor = hexToRgba(accentColor, 0.2)
    const headerBorderColor = hexToRgba(accentColor, 0.1)
    const areaTopColor = hexToRgba(accentColor, 0.15)
    const areaMidColor = hexToRgba(accentColor, 0.05)
    const areaBottomColor = hexToRgba(accentColor, 0.01)

    const xScale = (station: TrendChartStation, index: number) => {
        if (mileageMode === 'estimated' && maxMileage > 0) {
            return padL + (station.mileage / maxMileage) * chartW
        }
        return padL + ((stations.length <= 1 ? 0 : index / (stations.length - 1)) * chartW)
    }
    const yScale = (p: number) => padT + chartH - ((p - minP) / rangeP) * chartH

    const buildHydraulicPath = () => {
        let path = ''
        stations.forEach((station, index) => {
            const x = xScale(station, index)
            const yIn = yScale(station.inP)
            const isCompressor = station.type === 'compressor'

            if (index === 0) {
                path += `M ${x} ${yIn}`
                if (isCompressor) path += ` L ${x} ${yScale(station.outP)}`
                return
            }

            path += ` L ${x} ${yIn}`
            if (isCompressor) path += ` L ${x} ${yScale(station.outP)}`
        })
        return path
    }

    const hydraulicPath = hasStations ? buildHydraulicPath() : ''
    const lastStation = hasStations ? stations[stations.length - 1] : null
    const areaPath = hasStations && lastStation
        ? `${hydraulicPath} L ${xScale(lastStation, stations.length - 1)} ${padT + chartH} L ${padL} ${padT + chartH} Z`
        : ''

    const gridLines: number[] = []
    for (let p = Math.ceil(minP); p <= Math.floor(maxP); p++) {
        gridLines.push(p)
    }

    return (
        <div
            className={`absolute z-20 flex flex-col select-none overflow-hidden ${isDragging ? 'cursor-grabbing' : ''}`}
            style={{
                width: '920px',
                height: '420px',
                background: 'linear-gradient(180deg, rgba(5,10,18,0.97) 0%, rgba(8,15,12,0.97) 100%)',
                backdropFilter: 'blur(16px)',
                borderRadius: '12px',
                border: `1px solid ${borderColor}`,
                boxShadow: '0 16px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
        >
            <div style={{ height: '3px', background: `linear-gradient(90deg, ${accentColor}, ${hexToRgba(accentColor, 0.75)}, ${accentColor})`, borderRadius: '12px 12px 0 0' }} />
            <div
                className="px-5 py-2.5 flex justify-between items-center shrink-0 cursor-grab active:cursor-grabbing"
                style={{ borderBottom: `1px solid ${headerBorderColor}` }}
                onMouseDown={onMouseDown}
            >
                <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: '#e2e8f0' }}>
                    <span className="material-symbols-outlined text-lg" style={{ color: accentColor }}>show_chart</span>
                    <span>{title} · 里程进出站压力图</span>
                    <span style={{ color: '#64748b', fontSize: '10px', fontWeight: 'normal' }}>{xAxisLabel}</span>
                </h3>
                <div className="flex items-center gap-3" onMouseDown={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-4 mr-2" style={{ fontSize: '11px' }}>
                        <span className="flex items-center gap-1.5">
                            <span style={{ display: 'inline-block', width: 8, height: 8, background: accentColor, borderRadius: '50%' }} />
                            <span style={{ color: '#94a3b8' }}>压气站 (进/出)</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span style={{ display: 'inline-block', width: 6, height: 6, background: '#f59e0b', borderRadius: '50%' }} />
                            <span style={{ color: '#94a3b8' }}>分输/阀室 (进)</span>
                        </span>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                        <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 px-4 py-2 overflow-hidden">
                {!hasStations ? (
                    <div className="h-full flex items-center justify-center text-gray-500">
                        <div className="text-center">
                            <span className="material-symbols-outlined text-5xl block mb-3" style={{ color: `${accentColor}66` }}>show_chart</span>
                            <p className="text-lg">暂无压力图数据</p>
                            <p className="text-sm text-gray-600 mt-2">当前管线还没有可用的进出站压力数据</p>
                        </div>
                    </div>
                ) : (
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
                        <defs>
                            <linearGradient id="hydraulicGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={areaTopColor} />
                                <stop offset="60%" stopColor={areaMidColor} />
                                <stop offset="100%" stopColor={areaBottomColor} />
                            </linearGradient>
                        </defs>

                        {gridLines.map((pressure) => (
                            <g key={pressure}>
                                <line x1={padL} y1={yScale(pressure)} x2={padL + chartW} y2={yScale(pressure)} stroke="rgba(100,116,139,0.12)" strokeWidth={1} />
                                <text x={padL - 8} y={yScale(pressure) + 4} textAnchor="end" fill="#475569" fontSize="10" fontFamily="monospace">{pressure}</text>
                            </g>
                        ))}

                        <path d={areaPath} fill="url(#hydraulicGrad)" />
                        <path d={hydraulicPath} fill="none" stroke={accentColor} strokeWidth={2} strokeLinejoin="round" />

                        {stations.map((station, index) => {
                            const x = xScale(station, index)
                            const yIn = yScale(station.inP)
                            const isCompressor = station.type === 'compressor'
                            const yOut = isCompressor ? yScale(station.outP) : yIn
                            const isHovered = hoveredIdx === index
                            const showLabel = isCompressor || isHovered || index === 0 || index === stations.length - 1

                            return (
                                <g
                                    key={`${station.name}-${index}`}
                                    onMouseEnter={() => setHoveredIdx(index)}
                                    onMouseLeave={() => setHoveredIdx(null)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <rect x={x - 10} y={padT} width={20} height={chartH} fill="transparent" />
                                    {isHovered && <line x1={x} y1={padT} x2={x} y2={padT + chartH} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />}

                                    {isCompressor ? (
                                        <>
                                            <line
                                                x1={x}
                                                y1={yIn}
                                                x2={x}
                                                y2={yOut}
                                                stroke={isHovered ? '#e2e8f0' : accentColor}
                                                strokeWidth={isHovered ? 2.5 : 1.5}
                                                opacity={isHovered ? 1 : 0.6}
                                            />
                                            <circle cx={x} cy={yIn} r={isHovered ? 4.5 : 3} fill={accentColor} stroke={isHovered ? '#e2e8f0' : hexToRgba(accentColor, 0.35)} strokeWidth={1.5} />
                                            <circle cx={x} cy={yOut} r={isHovered ? 5 : 3.5} fill="#f8fafc" stroke={isHovered ? '#ffffff' : hexToRgba(accentColor, 0.45)} strokeWidth={1.5} />
                                            {isHovered && (
                                                <>
                                                    <text x={x + 8} y={yIn + 3} fill="#f59e0b" fontSize="9" fontFamily="monospace">
                                                        {station.inP.toFixed(2)}
                                                    </text>
                                                    <text x={x + 8} y={yOut + 3} fill={accentColor} fontSize="9" fontFamily="monospace">
                                                        {station.outP.toFixed(2)}
                                                    </text>
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <circle
                                            cx={x}
                                            cy={yIn}
                                            r={isHovered ? 4 : 2}
                                            fill="#f59e0b"
                                            stroke={isHovered ? '#fde68a' : 'none'}
                                            strokeWidth={1.5}
                                            opacity={isHovered ? 1 : 0.7}
                                        />
                                    )}

                                    {showLabel && (
                                        <text
                                            x={x}
                                            y={padT + chartH + 14}
                                            textAnchor="end"
                                            fill={isHovered ? '#e2e8f0' : '#4b5563'}
                                            fontSize={isHovered ? '10' : '8'}
                                            fontWeight={isHovered ? 600 : 400}
                                            transform={`rotate(-50, ${x}, ${padT + chartH + 14})`}
                                        >
                                            {station.name.replace(/压气站|分输压气站|分输站|清管站|分输联络站|分输清管站|末站/, '')}
                                        </text>
                                    )}

                                    {isHovered && (
                                        <g>
                                            <rect
                                                x={Math.min(x - 76, W - padR - 153)}
                                                y={Math.max(padT, Math.min(yIn, yOut) - 56)}
                                                width={152}
                                                height={isCompressor ? 64 : 50}
                                                rx={6}
                                                fill="rgba(15,23,42,0.95)"
                                                stroke={hexToRgba(accentColor, 0.25)}
                                                strokeWidth={1}
                                            />
                                            <text
                                                x={Math.min(x, W - padR - 77)}
                                                y={Math.max(padT + 14, Math.min(yIn, yOut) - 38)}
                                                textAnchor="middle"
                                                fill="#e2e8f0"
                                                fontSize="11"
                                                fontWeight={600}
                                            >
                                                {station.name}
                                            </text>
                                            <text
                                                x={Math.min(x, W - padR - 77)}
                                                y={Math.max(padT + 27, Math.min(yIn, yOut) - 24)}
                                                textAnchor="middle"
                                                fill="#94a3b8"
                                                fontSize="9"
                                                fontFamily="monospace"
                                            >
                                                {mileageMode === 'estimated' ? `${station.mileage.toFixed(1)} km` : `站序 ${index + 1}`}
                                            </text>
                                            {isCompressor ? (
                                                <>
                                                    <text
                                                        x={Math.min(x - 64, W - padR - 141)}
                                                        y={Math.max(padT + 42, Math.min(yIn, yOut) - 7)}
                                                        fill="#f59e0b"
                                                        fontSize="10"
                                                        fontFamily="monospace"
                                                    >
                                                        进 {station.inP.toFixed(3)}
                                                    </text>
                                                    <text
                                                        x={Math.min(x + 8, W - padR - 69)}
                                                        y={Math.max(padT + 42, Math.min(yIn, yOut) - 7)}
                                                        fill={accentColor}
                                                        fontSize="10"
                                                        fontFamily="monospace"
                                                    >
                                                        出 {station.outP.toFixed(3)}
                                                    </text>
                                                    <text
                                                        x={Math.min(x, W - padR - 77)}
                                                        y={Math.max(padT + 56, Math.min(yIn, yOut) + 7)}
                                                        textAnchor="middle"
                                                        fill="#94a3b8"
                                                        fontSize="9"
                                                    >
                                                        增压 +{(station.outP - station.inP).toFixed(3)} MPa
                                                    </text>
                                                </>
                                            ) : (
                                                <text
                                                    x={Math.min(x, W - padR - 77)}
                                                    y={Math.max(padT + 42, Math.min(yIn, yOut) - 7)}
                                                    textAnchor="middle"
                                                    fill="#f59e0b"
                                                    fontSize="10"
                                                    fontFamily="monospace"
                                                >
                                                    进站 {station.inP.toFixed(3)} MPa
                                                </text>
                                            )}
                                        </g>
                                    )}
                                </g>
                            )
                        })}
                    </svg>
                )}
            </div>
        </div>
    )
}

const PressureTrendChart: React.FC<{
    config: TrendChartConfig
    onClose: () => void
    onMouseDown?: (e: React.MouseEvent) => void
    isDragging?: boolean
    standalone?: boolean
    width?: number
    height?: number
    resizeMode?: 'width' | 'both'
    revealProgress?: number
    onResizeMouseDown?: (e: React.MouseEvent) => void
}> = ({ config, onClose, onMouseDown, isDragging, standalone = false, width = 920, height = 420, resizeMode = 'width', revealProgress = 1, onResizeMouseDown }) => {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

    const stations = config.stations
    const accentColor = config.color
    const hasData = stations.length > 0
    const jumpThreshold = 0.001

    const W = 860
    const H = 340
    const padL = 50
    const padR = 25
    const padT = 25
    const padB = 92
    const chartW = W - padL - padR
    const chartH = H - padT - padB

    const allP = hasData
        ? stations.flatMap((s) => [s.inP, s.outP])
        : [0, 1]
    const minP = Math.floor(Math.min(...allP) * 2) / 2
    const maxP = Math.ceil(Math.max(...allP) * 2) / 2 + 0.5
    const rangeP = Math.max(maxP - minP, 1)
    const maxMileage = hasData ? Math.max(stations[stations.length - 1]?.mileage ?? 0, 1) : 1
    const safeRevealProgress = clampNumber(revealProgress, 0, 1)
    const revealWidth = chartW * safeRevealProgress
    const chartClipId = `hydraulicClip-${config.pipelineId}`

    const xScale = (mileage: number) => padL + (mileage / maxMileage) * chartW
    const yScale = (p: number) => padT + chartH - ((p - minP) / rangeP) * chartH

    const buildHydraulicPath = () => {
        let path = ''
        stations.forEach((s, i) => {
            const x = xScale(s.mileage)
            const yIn = yScale(s.inP)
            const yOut = yScale(s.outP)
            const hasJump = Math.abs(s.outP - s.inP) > jumpThreshold

            if (i === 0) {
                path += `M ${x} ${yIn}`
                if (hasJump) path += ` L ${x} ${yOut}`
                return
            }

            path += ` L ${x} ${yIn}`
            if (hasJump) path += ` L ${x} ${yOut}`
        })
        return path
    }

    const hydraulicPath = hasData ? buildHydraulicPath() : ''
    const areaPath = hasData
        ? `${hydraulicPath} L ${xScale(maxMileage)} ${padT + chartH} L ${padL} ${padT + chartH} Z`
        : ''

    const gridLines: number[] = []
    for (let p = Math.ceil(minP); p <= Math.floor(maxP); p++) {
        gridLines.push(p)
    }

    const mileageTicks = Array.from({ length: 6 }, (_, idx) => Number(((maxMileage / 5) * idx).toFixed(1)))

    return (
        <div
            className={`${standalone ? 'h-full w-full' : `absolute z-20 ${isDragging ? 'cursor-grabbing' : ''}`} flex flex-col select-none overflow-hidden`}
            style={{
                width: standalone ? '100%' : `${width}px`,
                height: standalone ? '100%' : `${height}px`,
                background: 'linear-gradient(180deg, rgba(5,10,18,0.97) 0%, rgba(8,15,12,0.97) 100%)',
                backdropFilter: 'blur(16px)',
                borderRadius: standalone ? '0' : '12px',
                border: `1px solid ${hexToRgba(accentColor, 0.2)}`,
                boxShadow: standalone ? 'none' : '0 16px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
        >
            <div style={{ height: '3px', background: `linear-gradient(90deg, ${accentColor}, ${hexToRgba(accentColor, 0.65)}, ${accentColor})`, borderRadius: standalone ? '0' : '12px 12px 0 0' }} />
            <div
                className={`px-5 py-2.5 flex justify-between items-center shrink-0 ${standalone ? '' : 'cursor-grab active:cursor-grabbing'}`}
                style={{ borderBottom: `1px solid ${hexToRgba(accentColor, 0.12)}` }}
                onMouseDown={onMouseDown}
            >
                <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: '#e2e8f0' }}>
                    <span className="material-symbols-outlined text-lg" style={{ color: accentColor }}>show_chart</span>
                    <span>{config.title} · 里程进出站压力图</span>
                    <span style={{ color: '#64748b', fontSize: '10px', fontWeight: 'normal' }}>单位: MPa / km</span>
                    {config.mileageMode === 'estimated' && (
                        <span style={{ color: '#94a3b8', fontSize: '10px', fontWeight: 'normal' }}>主干线累计长度推算</span>
                    )}
                    {safeRevealProgress < 1 && (
                        <span style={{ color: accentColor, fontSize: '10px', fontWeight: 600 }}>
                            曲线生成 {Math.round(safeRevealProgress * 100)}%
                        </span>
                    )}
                </h3>
                <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                    <span className="material-symbols-outlined text-sm">close</span>
                </button>
            </div>

            {!hasData ? (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                        <span className="material-symbols-outlined text-5xl block mb-3" style={{ color: `${accentColor}66` }}>show_chart</span>
                        <p className="text-lg">暂无里程进出站压力图数据</p>
                        <p className="text-sm text-gray-600 mt-2">
                            {(SCADA_DATA_MAP[config.pipelineId]?.data && Object.keys(SCADA_DATA_MAP[config.pipelineId].data).length > 0)
                                ? '当前主干线站序没有和 SCADA 站名匹配上'
                                : '当前管线还没有导入可用的 SCADA 压力数据'}
                        </p>
                    </div>
                </div>
            ) : (
                <div className="flex-1 px-4 py-2 overflow-hidden">
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
                        <defs>
                            <linearGradient id={`hydraulicGrad-${config.pipelineId}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={accentColor} stopOpacity="0.15" />
                                <stop offset="60%" stopColor={accentColor} stopOpacity="0.05" />
                                <stop offset="100%" stopColor={accentColor} stopOpacity="0.01" />
                            </linearGradient>
                            <clipPath id={chartClipId}>
                                <rect x={padL} y={padT - 4} width={revealWidth} height={chartH + padB + 8} />
                            </clipPath>
                        </defs>

                        {gridLines.map(p => (
                            <g key={`${config.pipelineId}-grid-${p}`}>
                                <line x1={padL} y1={yScale(p)} x2={padL + chartW} y2={yScale(p)} stroke="rgba(100,116,139,0.12)" strokeWidth={1} />
                                <text x={padL - 8} y={yScale(p) + 4} textAnchor="end" fill="#475569" fontSize="10" fontFamily="monospace">{p}</text>
                            </g>
                        ))}

                        <g clipPath={`url(#${chartClipId})`}>
                            <path d={areaPath} fill={`url(#hydraulicGrad-${config.pipelineId})`} />
                            <path d={hydraulicPath} fill="none" stroke={accentColor} strokeWidth={2} strokeLinejoin="round" />
                        </g>

                        <g clipPath={`url(#${chartClipId})`}>
                            {stations.map((s, i) => {
                            const x = xScale(s.mileage)
                            const yIn = yScale(s.inP)
                            const yOut = yScale(s.outP)
                            const hasJump = Math.abs(s.outP - s.inP) > jumpThreshold
                            const isHovered = hoveredIdx === i
                            const isStationLabel = s.type !== 'valve' && !/^WE1-\d+阀室$/.test(s.name)
                            const showLabel = isHovered || i === 0 || i === stations.length - 1 || isStationLabel

                                return (
                                    <g
                                        key={`${config.pipelineId}-${s.name}-${s.mileage}`}
                                        onMouseEnter={() => setHoveredIdx(i)}
                                        onMouseLeave={() => setHoveredIdx(null)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <rect x={x - 10} y={padT} width={20} height={chartH} fill="transparent" />
                                        {isHovered && <line x1={x} y1={padT} x2={x} y2={padT + chartH} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />}

                                        {isHovered && (
                                            <>
                                                {hasJump && (
                                                    <line x1={x} y1={yIn} x2={x} y2={yOut} stroke="#ffffff" strokeWidth={2} opacity={0.9} />
                                                )}
                                                <circle cx={x} cy={yIn} r={4.5} fill="#f59e0b" stroke="#fde68a" strokeWidth={1.5} />
                                                <circle cx={x} cy={yOut} r={4.5} fill={accentColor} stroke="#ffffff" strokeWidth={1.5} />
                                            </>
                                        )}

                                        {showLabel && (
                                            <text
                                                x={x}
                                                y={padT + chartH + 14}
                                                textAnchor="end"
                                                fill={isHovered ? '#e2e8f0' : '#4b5563'}
                                                fontSize={isHovered ? '10' : '8'}
                                                fontWeight={isHovered ? 600 : 400}
                                                transform={`rotate(-50, ${x}, ${padT + chartH + 14})`}
                                            >
                                                {s.name.replace(/压气站|分输压气站|分输站|清管站|分输联络站|分输清管站|末站/g, '')}
                                            </text>
                                        )}

                                        {isHovered && (
                                            <g>
                                                <rect
                                                    x={Math.min(x - 84, W - padR - 168)}
                                                    y={Math.max(padT, Math.min(yIn, yOut) - 68)}
                                                    width={168}
                                                    height={60}
                                                    rx={6}
                                                    fill="rgba(15,23,42,0.95)"
                                                    stroke={hexToRgba(accentColor, 0.35)}
                                                    strokeWidth={1}
                                                />
                                                <text x={Math.min(x, W - padR - 84)} y={Math.max(padT + 14, Math.min(yIn, yOut) - 50)} textAnchor="middle" fill="#e2e8f0" fontSize="11" fontWeight={600}>
                                                    {s.name}
                                                </text>
                                                <text x={Math.min(x, W - padR - 84)} y={Math.max(padT + 28, Math.min(yIn, yOut) - 36)} textAnchor="middle" fill="#94a3b8" fontSize="9">
                                                    里程 {s.mileage.toFixed(1)} km
                                                </text>
                                                <text x={Math.min(x - 42, W - padR - 126)} y={Math.max(padT + 44, Math.min(yIn, yOut) - 20)} textAnchor="middle" fill="#f59e0b" fontSize="10" fontFamily="monospace">
                                                    进 {s.inP.toFixed(3)}
                                                </text>
                                                <text x={Math.min(x + 42, W - padR - 42)} y={Math.max(padT + 44, Math.min(yIn, yOut) - 20)} textAnchor="middle" fill={accentColor} fontSize="10" fontFamily="monospace">
                                                    出 {s.outP.toFixed(3)}
                                                </text>
                                            </g>
                                        )}
                                    </g>
                                )
                            })}
                        </g>

                        <line x1={padL} y1={padT + chartH} x2={padL + chartW} y2={padT + chartH} stroke="rgba(100,116,139,0.2)" strokeWidth={1} />
                        {mileageTicks.map((tick) => {
                            const x = xScale(tick)
                            return (
                                <g key={`${config.pipelineId}-tick-${tick}`}>
                                    <line x1={x} y1={padT + chartH} x2={x} y2={padT + chartH + 4} stroke="rgba(100,116,139,0.35)" strokeWidth={1} />
                                    <text x={x} y={padT + chartH + 18} textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="monospace">
                                        {tick.toFixed(0)}
                                    </text>
                                </g>
                            )
                        })}
                        <text x={padL + chartW} y={padT + chartH + 32} textAnchor="end" fill="#475569" fontSize="10">
                            里程 / km
                        </text>
                    </svg>
                </div>
            )}
            {!standalone && resizeMode === 'width' && (
                <div
                    className="absolute right-0 top-0 h-full w-3 cursor-ew-resize bg-white/[0.02] hover:bg-cyan-400/10"
                    onMouseDown={onResizeMouseDown}
                    title="拖动调整压力图宽度"
                />
            )}
            {!standalone && resizeMode === 'both' && (
                <div
                    className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize rounded-tl-md border-l border-t border-white/10 bg-white/[0.06] hover:bg-cyan-400/20"
                    onMouseDown={onResizeMouseDown}
                    title="拖动扩大或缩小压力图"
                >
                    <span className="material-symbols-outlined absolute -right-0.5 -bottom-0.5 text-[16px] text-slate-400">open_in_full</span>
                </div>
            )}
        </div>
    )
}

function hasValidPressureData(pipelineId: string): boolean {
    const source = getTrendSource(pipelineId)
    if (!source) return false

    return source.entries.some(([, record]) => (
        Number.isFinite(record.inP)
        && Number.isFinite(record.outP)
        && (record.inP > 0.1 || record.outP > 0.1)
    ))
}

/**
 * 全管线统一视图 (性能优化版)
 * 使用标准化的 PipelinePackage 数据源
 * 
 * 优化点：
 * 1. 使用 for 循环替代 forEach + 展开运算符，减少内存分配
 * 2. useMemo 缓存计算结果
 * 3. 减少不必要的重新渲染
 */
const GlobalPipelineView: React.FC = () => {
    // 管线数据异步加载
    const [pipelines, setPipelines] = useState<PipelinePackage[]>([])
    const [pipelinesLoaded, setPipelinesLoaded] = useState(false)
    useEffect(() => {
        loadAllPipelines()
            .then(data => { setPipelines(data); setPipelinesLoaded(true) })
            .catch(err => { console.error('[GlobalPipelineView] 加载管线数据失败:', err); setPipelinesLoaded(true) })
    }, [])

    const [mapInstance, setMapInstance] = useState<any>(null)
    const [selectedMapNode, setSelectedMapNode] = useState<PipelineNode | null>(null)
    const [mapTheme, setMapTheme] = useState<'light' | 'dark'>('dark')
    const [nodeDisplayMode, setNodeDisplayMode] = useState<'full' | 'hub'>('hub')
    const [hubNodeTypes, setHubNodeTypes] = useState<HubNodeType[]>(['source', 'compressor', 'junction', 'distribution'])
    const [showValveRooms, setShowValveRooms] = useState(false)
    const [isHubMenuOpen, setIsHubMenuOpen] = useState(false)
    const hubMenuRef = useRef<HTMLDivElement>(null)
    const activeSimulationPilot = useMemo(() => resolveSimulationPilotConfig(DEFAULT_WE1_PILOT_ID), [])
    const globalSimulation = useSimulation({
        pilotId: activeSimulationPilot.id,
        scenarios: activeSimulationPilot.scenarios,
    })
    const [multiScenarioActive, setMultiScenarioActive] = useState(false)
    const [multiScenarioStepId, setMultiScenarioStepId] = useState('')
    const [multiScenarioResults, setMultiScenarioResults] = useState<MultiScenarioAiResult[]>([])
    const [multiScenarioPanelOpen, setMultiScenarioPanelOpen] = useState(false)
    const [multiScenarioError, setMultiScenarioError] = useState<string | null>(null)
    const [multiScenarioSelectedCaseIds, setMultiScenarioSelectedCaseIds] = useState<string[]>(() => MULTI_SCENARIO_AI_CASES.map(item => item.id))
    const [simulationCutoffEdgeIds, setSimulationCutoffEdgeIds] = useState<string[]>([])
    const multiScenarioActiveRef = useRef(false)
    const [simulationPressureChartOpen, setSimulationPressureChartOpen] = useState(false)
    const [simulationPressureChartOverlay, setSimulationPressureChartOverlay] = useState<SimulationOverlay | null>(null)
    const [hiddenSimulationPressureChartIds, setHiddenSimulationPressureChartIds] = useState<Record<string, boolean>>({})
    const [simulationPressureChartRevealProgress, setSimulationPressureChartRevealProgress] = useState<Record<string, number>>({})
    const lastSimulationPressureChartRunIdRef = useRef('')

    const [showScada, setShowScada] = useState(false)
    const [showWe2Scada, setShowWe2Scada] = useState(false)
    // 三条新管线 SCADA 面板显示状态
    const [showWe1WestScada, setShowWe1WestScada] = useState(false)
    const [showCredScada, setShowCredScada] = useState(false)
    const [showPtScada, setShowPtScada] = useState(false)
    // 新增 7 条管线的 SCADA 面板显示状态（默认隐藏）
    const [extraScadaVisible, setExtraScadaVisible] = useState<Record<string, boolean>>({})
    const toggleExtraScada = (id: string) => setExtraScadaVisible(prev => ({ ...prev, [id]: !prev[id] }))
    // 通用压力趋势图面板
    const [activeTrendPipelineId, setActiveTrendPipelineId] = useState<string | null>(null)
    const [activePressureOverlayIds, setActivePressureOverlayIds] = useState<Record<string, boolean>>({})
    // SCADA 历史曲线面板状态，支持指定指标类型和基准值
    const [historyTarget, setHistoryTarget] = useState<{
        stationName: string
        metricType: 'pressure' | 'temperature' | 'dewpoint'
        baseValue?: number
        hours?: number
    } | null>(null)
    const [stationHistoryTarget, setStationHistoryTarget] = useState<{
        stationName: string
        displayName?: string
        initialViewMode?: 'pressure' | 'temperature' | 'dewpoint' | 'overview'
        initialHours?: 0 | 6 | 12
        focusHint?: string
    } | null>(null)
    const [historyChartPos, setHistoryChartPos] = useState({ x: Math.round((typeof window !== 'undefined' ? window.innerWidth : 1280) / 2) - 300, y: 120 })
    const [isDraggingHistory, setIsDraggingHistory] = useState(false)
    const historyOffsetRef = React.useRef({ x: 0, y: 0 })
    const handleHistoryMouseDown = (e: React.MouseEvent) => {
        setIsDraggingHistory(true)
        historyOffsetRef.current = { x: e.clientX - historyChartPos.x, y: e.clientY - historyChartPos.y }
    }

    useEffect(() => {
        const onDocumentMouseDown = (event: MouseEvent) => {
            if (!hubMenuRef.current) return
            if (!hubMenuRef.current.contains(event.target as Node)) {
                setIsHubMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', onDocumentMouseDown)
        return () => document.removeEventListener('mousedown', onDocumentMouseDown)
    }, [])

    const toggleHubNodeType = useCallback((type: HubNodeType) => {
        setHubNodeTypes(prev => prev.includes(type) ? prev.filter(item => item !== type) : [...prev, type])
    }, [])

    const isPresentationNodeMode = nodeDisplayMode === 'hub'
        && hubNodeTypes.length === 2
        && hubNodeTypes.includes('source')
        && hubNodeTypes.includes('junction')
        && !showValveRooms

    const activatePresentationNodeMode = useCallback(() => {
        if (isPresentationNodeMode) {
            setNodeDisplayMode('full')
            setHubNodeTypes(['source', 'compressor', 'junction', 'distribution'])
            setShowValveRooms(false)
            setIsHubMenuOpen(false)
            return
        }

        setNodeDisplayMode('hub')
        setHubNodeTypes(['source', 'junction'])
        setShowValveRooms(false)
        setIsHubMenuOpen(false)
    }, [isPresentationNodeMode])

    // 统一的指标点击处理函数
    const handleMetricClick = useCallback((stationName: string, metricType: 'pressure' | 'temperature' | 'dewpoint', baseValue: number) => {
        setHistoryTarget({ stationName, metricType, baseValue })
    }, [])

    const openStationHistoryPanel = useCallback((
        stationName: string,
        options?: {
            displayName?: string
            initialViewMode?: 'pressure' | 'temperature' | 'dewpoint' | 'overview'
            initialHours?: 0 | 6 | 12
            focusHint?: string
        },
    ) => {
        setStationHistoryTarget({
            stationName,
            displayName: options?.displayName || stationName,
            initialViewMode: options?.initialViewMode || 'pressure',
            initialHours: options?.initialHours ?? 0,
            focusHint: options?.focusHint,
        })
    }, [])

    const toggleStationHistoryPanel = useCallback((stationName: string) => {
        if (stationHistoryTarget?.stationName === stationName) {
            setStationHistoryTarget(null)
            return
        }

        openStationHistoryPanel(stationName, {
            displayName: stationName,
            initialViewMode: 'overview',
            initialHours: 0,
        })
    }, [openStationHistoryPanel, stationHistoryTarget?.stationName])

    const getEmbeddedHistoryStationName = useCallback((stationName?: string): '中卫压气站' | '甪直分输站' | null => {
        if (!stationName) return null
        const key = normalizeStationMatchKey(stationName)
        if (key.includes('中卫')) return '中卫压气站'
        if (key.includes('甪直')) return '甪直分输站'
        return null
    }, [])

    useEffect(() => {
        const handleAssistantHistoryOpen = (event: Event) => {
            const detail = (event as CustomEvent).detail as {
                station?: string
                view?: string
                hours?: number
                metric?: string
            } | undefined
            const stationName = detail?.station?.trim()
            if (!stationName) return
            const view = String(detail?.view || '').toLowerCase()
            const hoursRaw = Number(detail?.hours)
            const initialHours = hoursRaw === 6 || hoursRaw === 12 ? hoursRaw : 0
            openStationHistoryPanel(stationName, {
                initialViewMode: view === 'temperature'
                    ? 'temperature'
                    : view === 'dewpoint'
                        ? 'dewpoint'
                        : view === 'overview'
                            ? 'overview'
                            : 'pressure',
                initialHours,
                focusHint: detail?.metric?.trim() || undefined,
            })
            setHistoryTarget(null)
        }
        const handleAssistantHistoryMessage = (event: MessageEvent) => {
            const payload = event.data as {
                type?: string
                detail?: {
                    station?: string
                    view?: string
                    hours?: number
                    metric?: string
                }
            } | undefined
            if (!payload) return
            if (payload.type !== 'assistant-open-history' && payload.type !== 'assistant-open-luzhi-history') {
                return
            }
            handleAssistantHistoryOpen({ detail: payload.detail } as CustomEvent)
        }

        window.addEventListener('assistant-open-history', handleAssistantHistoryOpen as EventListener)
        window.addEventListener('assistant-open-luzhi-history', handleAssistantHistoryOpen as EventListener)
        window.addEventListener('message', handleAssistantHistoryMessage)
        return () => {
            window.removeEventListener('assistant-open-history', handleAssistantHistoryOpen as EventListener)
            window.removeEventListener('assistant-open-luzhi-history', handleAssistantHistoryOpen as EventListener)
            window.removeEventListener('message', handleAssistantHistoryMessage)
        }
    }, [openStationHistoryPanel])

    // 西二线 SCADA 面板拖拽状态
    useEffect(() => {
        setAssistantRuntimeContext({
            selection: {
                history_target_station: stationHistoryTarget?.stationName || historyTarget?.stationName || '',
                simulationRunId: globalSimulation.overlay?.run_id || '',
                simulationScenario: globalSimulation.overlay?.scenario_id || '',
                simulationSummary: globalSimulation.overlay?.summary || null,
                multiScenarioSkillActive: multiScenarioActive,
                multiScenarioResultCount: multiScenarioResults.length,
            },
        })
    }, [
        globalSimulation.overlay?.run_id,
        globalSimulation.overlay?.scenario_id,
        globalSimulation.overlay?.summary,
        historyTarget?.stationName,
        multiScenarioActive,
        multiScenarioResults.length,
        stationHistoryTarget?.stationName,
    ])

    const [we2ScadaPos, setWe2ScadaPos] = useState({
        x: typeof window !== 'undefined' ? Math.max(10, window.innerWidth - 450) : 800,
        y: typeof window !== 'undefined' ? window.innerHeight - 340 : 500
    })
    const [isDraggingWe2Scada, setIsDraggingWe2Scada] = useState(false)
    const we2DragOffsetRef = React.useRef({ x: 0, y: 0 })

    const handleWe2ScadaMouseDown = (e: React.MouseEvent) => {
        setIsDraggingWe2Scada(true)
        we2DragOffsetRef.current = {
            x: e.clientX - we2ScadaPos.x,
            y: e.clientY - we2ScadaPos.y
        }
    }

    // 通用拖拽面板处理
    // 将每个新面板的拖拽状态打包起来
    // 获取屏幕尺寸计算安全位置
    const W = typeof window !== 'undefined' ? window.innerWidth : 1280
    const H = typeof window !== 'undefined' ? window.innerHeight : 800
    const initialDirectoryLayoutRef = React.useRef<DirectoryLayoutState>(readDirectoryLayoutState())
    const [directoryPos, setDirectoryPos] = useState(() => {
        const saved = initialDirectoryLayoutRef.current.position
        return saved
            ? { x: clampNumber(saved.x, 0, Math.max(0, W - 260)), y: clampNumber(saved.y, 60, Math.max(60, H - 180)) }
            : { x: 24, y: 96 }
    })
    const [directorySize, setDirectorySize] = useState(() => {
        const saved = initialDirectoryLayoutRef.current.size
        return saved
            ? { width: clampNumber(saved.width, 260, Math.min(560, W - 20)), height: clampNumber(saved.height, 320, Math.max(320, H - 110)) }
            : { width: 288, height: Math.min(620, Math.max(420, H - 140)) }
    })
    const [isDraggingDirectory, setIsDraggingDirectory] = useState(false)
    const [isResizingDirectory, setIsResizingDirectory] = useState(false)
    const directoryDragOffsetRef = React.useRef({ x: 0, y: 0 })
    const directoryResizeStartRef = React.useRef({ x: 0, y: 0, width: 288, height: 520 })
    const [pipelineOrderIds, setPipelineOrderIds] = useState<string[]>(() => initialDirectoryLayoutRef.current.orderIds || [])
    const [pipelineDragId, setPipelineDragId] = useState<string | null>(null)
    const [pipelineDropIndex, setPipelineDropIndex] = useState<number | null>(null)
    const [trendWidth, setTrendWidth] = useState(() => clampNumber(initialDirectoryLayoutRef.current.trendWidth || 920, 720, 1280))
    const [isResizingTrend, setIsResizingTrend] = useState(false)
    const trendResizeStartRef = React.useRef({ x: 0, width: 920 })
    const [simulationPressureChartLayouts, setSimulationPressureChartLayouts] = useState<Record<string, SimulationPressureChartLayout>>({})
    const [draggingSimulationPressureChartId, setDraggingSimulationPressureChartId] = useState<string | null>(null)
    const [resizingSimulationPressureChartId, setResizingSimulationPressureChartId] = useState<string | null>(null)
    const simulationPressureChartDragOffsetRef = React.useRef({ x: 0, y: 0 })
    const simulationPressureChartResizeStartRef = React.useRef({ x: 0, y: 0, width: 700, height: 320 })

    // 西一线西段 SCADA 面板（放在西一线东段面板右侧）
    const [we1WestPos, setWe1WestPos] = useState({ x: 330, y: H - 340 })
    const [isDraggingWe1West, setIsDraggingWe1West] = useState(false)
    const we1WestOffsetRef = React.useRef({ x: 0, y: 0 })
    const handleWe1WestMouseDown = (e: React.MouseEvent) => {
        setIsDraggingWe1West(true)
        we1WestOffsetRef.current = { x: e.clientX - we1WestPos.x, y: e.clientY - we1WestPos.y }
    }

    // 中俄东线 SCADA 面板（居中偏下）
    const [credPos, setCredPos] = useState({ x: Math.round(W / 2) - 240, y: H - 340 })
    const [isDraggingCred, setIsDraggingCred] = useState(false)
    const credOffsetRef = React.useRef({ x: 0, y: 0 })
    const handleCredMouseDown = (e: React.MouseEvent) => {
        setIsDraggingCred(true)
        credOffsetRef.current = { x: e.clientX - credPos.x, y: e.clientY - credPos.y }
    }

    // 平泰支干线 SCADA 面板（右下）
    const [ptPos, setPtPos] = useState({ x: Math.max(10, W - 510), y: H - 340 })
    const [isDraggingPt, setIsDraggingPt] = useState(false)
    const ptOffsetRef = React.useRef({ x: 0, y: 0 })
    const handlePtMouseDown = (e: React.MouseEvent) => {
        setIsDraggingPt(true)
        ptOffsetRef.current = { x: e.clientX - ptPos.x, y: e.clientY - ptPos.y }
    }

    // 压力趋势图面板（默认屏幕居中上部）
    const [trendPos, setTrendPos] = useState({ x: Math.round(W / 2) - 440, y: 100 })
    const [isDraggingTrend, setIsDraggingTrend] = useState(false)
    const trendOffsetRef = React.useRef({ x: 0, y: 0 })
    const handleTrendMouseDown = (e: React.MouseEvent) => {
        setIsDraggingTrend(true)
        trendOffsetRef.current = { x: e.clientX - trendPos.x, y: e.clientY - trendPos.y }
    }
    const handleTrendResizeMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation()
        setIsResizingTrend(true)
        trendResizeStartRef.current = { x: e.clientX, width: trendWidth }
    }
    const handleSimulationPressureChartMouseDown = useCallback((chartId: string, e: React.MouseEvent) => {
        const layout = simulationPressureChartLayouts[chartId]
        if (!layout) return

        setDraggingSimulationPressureChartId(chartId)
        simulationPressureChartDragOffsetRef.current = {
            x: e.clientX - layout.x,
            y: e.clientY - layout.y,
        }
    }, [simulationPressureChartLayouts])
    const handleSimulationPressureChartResizeMouseDown = useCallback((chartId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        const layout = simulationPressureChartLayouts[chartId]
        if (!layout) return

        setResizingSimulationPressureChartId(chartId)
        simulationPressureChartResizeStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            width: layout.width,
            height: layout.height,
        }
    }, [simulationPressureChartLayouts])
    const animateSimulationPressureChartReveal = useCallback(async (chartId: string, durationMs = 1700) => {
        setSimulationPressureChartRevealProgress(prev => ({ ...prev, [chartId]: 0 }))

        const startedAt = performance.now()
        await new Promise<void>((resolve) => {
            const tick = (now: number) => {
                const linear = Math.min(1, (now - startedAt) / durationMs)
                const eased = 1 - Math.pow(1 - linear, 3)
                setSimulationPressureChartRevealProgress(prev => ({ ...prev, [chartId]: eased }))

                if (linear >= 1) {
                    resolve()
                    return
                }
                requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
        })

        setSimulationPressureChartRevealProgress(prev => ({ ...prev, [chartId]: 1 }))
    }, [])

    // 使用 useCallback 稳定回调引用，避免触发 MapView 无限循环
    const handleMapLoad = useCallback((map: any) => {
        setMapInstance(map)
    }, [])

    const focusMapCoordinates = useCallback((coordinates: LngLatTuple[], maxZoom = 11) => {
        if (!mapInstance || coordinates.length === 0) return

        let minLng = coordinates[0][0]
        let maxLng = coordinates[0][0]
        let minLat = coordinates[0][1]
        let maxLat = coordinates[0][1]

        coordinates.forEach(([longitude, latitude]) => {
            minLng = Math.min(minLng, longitude)
            maxLng = Math.max(maxLng, longitude)
            minLat = Math.min(minLat, latitude)
            maxLat = Math.max(maxLat, latitude)
        })

        const center: LngLatTuple = [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
        const span = Math.max(maxLng - minLng, maxLat - minLat)
        const leftPadding = Math.min(Math.max(directorySize.width + 56, 120), 420)
        const padding = [88, 96, 88, leftPadding]

        try {
            const AMap = (window as any).AMap
            if (AMap?.Bounds && AMap?.LngLat && typeof mapInstance.setBounds === 'function' && span > 0.0001) {
                const bounds = new AMap.Bounds(
                    new AMap.LngLat(minLng, minLat),
                    new AMap.LngLat(maxLng, maxLat),
                )
                mapInstance.setBounds(bounds, false, padding, maxZoom)
                return
            }
        } catch (error) {
            console.warn('[GlobalPipelineView] 管线视野聚焦失败，使用中心点兜底:', error)
        }

        const fallbackZoom = span < 0.12 ? 11 : span < 0.45 ? 9 : span < 1.6 ? 7 : span < 5 ? 5 : 4
        mapInstance.setZoomAndCenter?.(Math.min(fallbackZoom, maxZoom), center)
        mapInstance.setCenter?.(center)
    }, [directorySize.width, mapInstance])

    const focusPipelinePackage = useCallback((pkg: PipelinePackage) => {
        requestAnimationFrame(() => {
            focusMapCoordinates(collectPackageCoordinates(pkg), pkg.layers.length > 1 ? 9 : 11)
        })
    }, [focusMapCoordinates])

    const focusPipelineLayer = useCallback((layer: PipelineLayer) => {
        requestAnimationFrame(() => {
            focusMapCoordinates(collectLayerCoordinates(layer), layer.type === 'trunk' ? 9 : 11)
        })
    }, [focusMapCoordinates])

    const locateStationOnMap = useCallback((stationName: string) => {
        const query = stationName.trim()
        if (!query || !mapInstance) return false

        const queryKey = normalizeStationMatchKey(query)
        let bestMatch: {
            node: PipelineNode
            pkg: PipelinePackage
            layerIndex: number
            score: number
        } | null = null

        pipelines.forEach((pkg) => {
            pkg.layers.forEach((layer, layerIndex) => {
                layer.nodes.forEach((node) => {
                    const names = [
                        node.name,
                        node.id,
                        node.hubInfo?.junctionName,
                        typeof node.properties?.displayName === 'string' ? node.properties.displayName : '',
                        typeof node.properties?.rawName === 'string' ? node.properties.rawName : '',
                        typeof node.properties?.stationName === 'string' ? node.properties.stationName : '',
                    ].filter(Boolean) as string[]

                    let score = 0
                    for (const name of names) {
                        const nameKey = normalizeStationMatchKey(name)
                        if (name === query) {
                            score = Math.max(score, 100)
                        } else if (nameKey && nameKey === queryKey) {
                            score = Math.max(score, 90)
                        } else if (queryKey && nameKey && (nameKey.includes(queryKey) || queryKey.includes(nameKey))) {
                            score = Math.max(score, 70 - Math.abs(nameKey.length - queryKey.length))
                        } else if (name.includes(query) || query.includes(name)) {
                            score = Math.max(score, 55)
                        }
                    }

                    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
                        bestMatch = { node, pkg, layerIndex, score }
                    }
                })
            })
        })

        if (!bestMatch) {
            console.warn(`[GlobalPipelineView] AI 请求定位站点失败，地图中未找到：${query}`)
            return false
        }

        const { node, pkg } = bestMatch
        setVisibleLayers((prev) => {
            const next = { ...prev }
            pkg.layers.forEach((layer, index) => {
                next[getPipelineLayerId(pkg, layer, index)] = true
            })
            return next
        })
        setExpandedGroups((prev) => ({ ...prev, [pkg.id]: true }))
        setSelectedMapNode(node)

        const center: LngLatTuple = [node.coordinate.longitude, node.coordinate.latitude]
        requestAnimationFrame(() => {
            mapInstance.setZoomAndCenter?.(11, center, true, 600)
            mapInstance.setCenter?.(center)
        })
        return true
    }, [mapInstance, pipelines])

    useEffect(() => {
        const handleAssistantLocateStation = (event: Event) => {
            const detail = (event as CustomEvent).detail as { station?: string } | undefined
            const stationName = detail?.station?.trim()
            if (!stationName) return
            locateStationOnMap(stationName)
        }
        const handleAssistantLocateMessage = (event: MessageEvent) => {
            const payload = event.data as {
                type?: string
                detail?: {
                    station?: string
                }
            } | undefined
            if (!payload || payload.type !== 'assistant-locate-station') return
            handleAssistantLocateStation({ detail: payload.detail } as CustomEvent)
        }

        window.addEventListener('assistant-locate-station', handleAssistantLocateStation as EventListener)
        window.addEventListener('message', handleAssistantLocateMessage)
        return () => {
            window.removeEventListener('assistant-locate-station', handleAssistantLocateStation as EventListener)
            window.removeEventListener('message', handleAssistantLocateMessage)
        }
    }, [locateStationOnMap])

    const activeTrendChart = useMemo(() => {
        if (!activeTrendPipelineId) return null
        const targetPackage = pipelines.find((pkg) => pkg.id === activeTrendPipelineId)
        return buildTrendChartConfig(targetPackage, activeTrendPipelineId)
    }, [activeTrendPipelineId, pipelines])

    // SCADA 面板拖拽状态
    const { isPoppedOut: isScadaPoppedOut, popOut: popOutScada, closePopOut: closeScadaPopOut } = useNewWindow('scada-sync', '/popout/scada');
    const [scadaPos, setScadaPos] = useState({
        x: 330,
        y: typeof window !== 'undefined' ? window.innerHeight - 340 : 500
    })
    const [isDraggingScada, setIsDraggingScada] = useState(false)
    const dragOffsetRef = React.useRef({ x: 0, y: 0 })

    const handleScadaMouseDown = (e: React.MouseEvent) => {
        setIsDraggingScada(true)
        dragOffsetRef.current = {
            x: e.clientX - scadaPos.x,
            y: e.clientY - scadaPos.y
        }
    }

    const handleGlobalMouseMove = (e: React.MouseEvent) => {
        if (isDraggingScada) {
            setScadaPos({
                x: e.clientX - dragOffsetRef.current.x,
                y: e.clientY - dragOffsetRef.current.y
            })
        }
        if (isDraggingWe2Scada) {
            setWe2ScadaPos({
                x: e.clientX - we2DragOffsetRef.current.x,
                y: e.clientY - we2DragOffsetRef.current.y
            })
        }
        // 其余三个面板拖拽处理
        if (isDraggingWe1West) setWe1WestPos({ x: e.clientX - we1WestOffsetRef.current.x, y: e.clientY - we1WestOffsetRef.current.y })
        if (isDraggingCred)    setCredPos({    x: e.clientX - credOffsetRef.current.x,    y: e.clientY - credOffsetRef.current.y    })
        if (isDraggingPt)      setPtPos({      x: e.clientX - ptOffsetRef.current.x,      y: e.clientY - ptOffsetRef.current.y      })
        if (isDraggingTrend)   setTrendPos({   x: e.clientX - trendOffsetRef.current.x,   y: e.clientY - trendOffsetRef.current.y   })
        if (draggingSimulationPressureChartId) {
            const chartId = draggingSimulationPressureChartId
            setSimulationPressureChartLayouts(prev => {
                const layout = prev[chartId]
                if (!layout) return prev
                return {
                    ...prev,
                    [chartId]: {
                        ...layout,
                        x: clampNumber(e.clientX - simulationPressureChartDragOffsetRef.current.x, 0, Math.max(0, W - layout.width - 12)),
                        y: clampNumber(e.clientY - simulationPressureChartDragOffsetRef.current.y, 60, Math.max(60, H - layout.height - 12)),
                    },
                }
            })
        }
        if (isDraggingHistory) setHistoryChartPos({ x: e.clientX - historyOffsetRef.current.x, y: e.clientY - historyOffsetRef.current.y })
        if (isDraggingStationHistory) setStationHistoryPos({ x: e.clientX - stationHistoryOffsetRef.current.x, y: e.clientY - stationHistoryOffsetRef.current.y })
        if (isDraggingDirectory) {
            setDirectoryPos({
                x: clampNumber(e.clientX - directoryDragOffsetRef.current.x, 0, Math.max(0, W - directorySize.width)),
                y: clampNumber(e.clientY - directoryDragOffsetRef.current.y, 60, Math.max(60, H - 120)),
            })
        }
        if (isResizingDirectory) {
            const nextWidth = directoryResizeStartRef.current.width + e.clientX - directoryResizeStartRef.current.x
            const nextHeight = directoryResizeStartRef.current.height + e.clientY - directoryResizeStartRef.current.y
            setDirectorySize({
                width: clampNumber(nextWidth, 260, Math.min(560, W - directoryPos.x - 10)),
                height: clampNumber(nextHeight, 320, Math.max(320, H - directoryPos.y - 10)),
            })
        }
        if (isResizingTrend) {
            setTrendWidth(clampNumber(trendResizeStartRef.current.width + e.clientX - trendResizeStartRef.current.x, 720, 1280))
        }
        if (resizingSimulationPressureChartId) {
            const chartId = resizingSimulationPressureChartId
            setSimulationPressureChartLayouts(prev => {
                const layout = prev[chartId]
                if (!layout) return prev
                const nextWidth = clampNumber(
                    simulationPressureChartResizeStartRef.current.width + e.clientX - simulationPressureChartResizeStartRef.current.x,
                    520,
                    Math.min(1180, W - layout.x - 12),
                )
                const nextHeight = clampNumber(
                    simulationPressureChartResizeStartRef.current.height + e.clientY - simulationPressureChartResizeStartRef.current.y,
                    260,
                    Math.min(620, H - layout.y - 12),
                )
                return {
                    ...prev,
                    [chartId]: {
                        ...layout,
                        width: nextWidth,
                        height: nextHeight,
                    },
                }
            })
        }
    }

    const handleGlobalMouseUp = () => {
        if (isDraggingScada)    setIsDraggingScada(false)
        if (isDraggingWe2Scada) setIsDraggingWe2Scada(false)
        if (isDraggingWe1West)  setIsDraggingWe1West(false)
        if (isDraggingCred)     setIsDraggingCred(false)
        if (isDraggingPt)       setIsDraggingPt(false)
        if (isDraggingTrend)    setIsDraggingTrend(false)
        if (isDraggingHistory)  setIsDraggingHistory(false)
        if (isDraggingStationHistory) setIsDraggingStationHistory(false)
        if (isDraggingDirectory) setIsDraggingDirectory(false)
        if (draggingSimulationPressureChartId) setDraggingSimulationPressureChartId(null)
        if (isResizingDirectory) setIsResizingDirectory(false)
        if (isResizingTrend) setIsResizingTrend(false)
        if (resizingSimulationPressureChartId) setResizingSimulationPressureChartId(null)
        if (pipelineDragId) {
            setPipelineDragId(null)
            setPipelineDropIndex(null)
        }
    }

    const hasScadaStandalone = useCallback((pipelineId: string) => {
        return Boolean(SCADA_DATA_MAP[pipelineId])
    }, [])

    const findExtraScadaPanel = useCallback((pkg: PipelinePackage) => {
        return EXTRA_SCADA_PANELS.find(p =>
            pkg.name.includes(p.label)
            || (p.id === 'zg' && pkg.name === '中贵线')
            || (p.id === 'zm' && pkg.name === '中缅线')
            || (p.id === 'gn' && pkg.name === '广南支干线')
            || (p.id === 'gs' && pkg.name === '广深支干线')
            || (p.id === 'sj4' && pkg.name === '陕京四线')
            || (p.id === 'sj3' && pkg.name === '陕京三线')
            || (p.id === 'ncsh' && pkg.name.includes('南昌'))
            || (p.id === 'jxlz' && pkg.name.includes('嘉兴'))
            || (p.id === 'sj2' && pkg.name === '陕京二线')
            || (p.id === 'we3' && pkg.name.includes('三线'))
        )
    }, [])

    const openScadaStandalone = useCallback((pipelineId: string) => {
        if (!hasScadaStandalone(pipelineId)) return

        if (pipelineId === 'we1') {
            popOutScada(400, 500)
            setShowScada(false)
            return
        }

        const w = 520
        const h = 500
        const left = window.screenX + (window.outerWidth - w) / 2
        const top = window.screenY + (window.outerHeight - h) / 2
        window.open(
            `/#/popout/scada?id=${pipelineId}`,
            `scada-${pipelineId}`,
            `width=${w},height=${h},left=${left},top=${top}`
        )
    }, [hasScadaStandalone, popOutScada])

    const toggleTrendChart = useCallback((pipelineId: string) => {
        setActiveTrendPipelineId((prev) => prev === pipelineId ? null : pipelineId)
    }, [])

    const directoryActionButtonClass = 'transition-all duration-150 flex items-center justify-center size-7 rounded-md border border-transparent bg-white/[0.03] hover:bg-white/10 hover:border-white/10'
    const directoryActionPlaceholderClass = 'size-7 rounded-md opacity-0 pointer-events-none'

    const renderPipelineActions = (pkg: PipelinePackage) => {
        const extraPanel = findExtraScadaPanel(pkg)
        let visibilityButton: React.ReactNode = <span className={directoryActionPlaceholderClass} aria-hidden="true" />
        let popoutButton: React.ReactNode = <span className={directoryActionPlaceholderClass} aria-hidden="true" />
        let trendButton: React.ReactNode = <span className={directoryActionPlaceholderClass} aria-hidden="true" />
        let pressureButton: React.ReactNode = <span className={directoryActionPlaceholderClass} aria-hidden="true" />
        const trendSource = getTrendSource(pkg.id)
        const hasPressureData = hasValidPressureData(pkg.id)
        const isTrendActive = activeTrendPipelineId === pkg.id
        const isPressureActive = Boolean(activePressureOverlayIds[pkg.id])

        if (pkg.name === '西气东输一线' && !isScadaPoppedOut) {
            visibilityButton = (
                <button
                    onClick={(e) => { e.stopPropagation(); setShowScada(!showScada); setShowWe1WestScada(!showWe1WestScada); }}
                    className={`${directoryActionButtonClass} ${showScada ? 'text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border-emerald-400/20' : 'text-gray-500 hover:text-gray-300'}`}
                    title={showScada ? '隐藏西一线面板' : '显示西一线面板'}
                >
                    <span className="material-symbols-outlined text-sm">{showScada ? 'visibility' : 'visibility_off'}</span>
                </button>
            )
            popoutButton = (
                <button
                    onClick={(e) => { e.stopPropagation(); popOutScada(400, 500); setShowScada(false); }}
                    className={`${directoryActionButtonClass} text-gray-400 hover:text-white`}
                    title="弹出独立窗口"
                >
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                </button>
            )
        } else {
            if (pkg.name === '西气东输二线') {
                visibilityButton = (
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowWe2Scada(!showWe2Scada); }}
                        className={`${directoryActionButtonClass} ${showWe2Scada ? 'text-blue-400 hover:text-blue-300 bg-blue-500/10 border-blue-400/20' : 'text-gray-500 hover:text-gray-300'}`}
                        title={showWe2Scada ? '隐藏西二线参数表' : '显示西二线参数表'}
                    >
                        <span className="material-symbols-outlined text-sm">{showWe2Scada ? 'visibility' : 'visibility_off'}</span>
                    </button>
                )
            } else if (pkg.name === '中俄东线') {
                visibilityButton = (
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowCredScada(!showCredScada); }}
                        className={`${directoryActionButtonClass} ${showCredScada ? 'text-pink-400 hover:text-pink-300 bg-pink-500/10 border-pink-400/20' : 'text-gray-500 hover:text-gray-300'}`}
                        title={showCredScada ? '隐藏中俄东线参数表' : '显示中俄东线参数表'}
                    >
                        <span className="material-symbols-outlined text-sm">{showCredScada ? 'visibility' : 'visibility_off'}</span>
                    </button>
                )
            } else if (pkg.name === '平泰支干线') {
                visibilityButton = (
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowPtScada(!showPtScada); }}
                        className={`${directoryActionButtonClass} ${showPtScada ? 'text-purple-400 hover:text-purple-300 bg-purple-500/10 border-purple-400/20' : 'text-gray-500 hover:text-gray-300'}`}
                        title={showPtScada ? '隐藏平泰参数表' : '显示平泰参数表'}
                    >
                        <span className="material-symbols-outlined text-sm">{showPtScada ? 'visibility' : 'visibility_off'}</span>
                    </button>
                )
            } else if (extraPanel) {
                visibilityButton = (
                    <button
                        onClick={(e) => { e.stopPropagation(); toggleExtraScada(extraPanel.id); }}
                        className={`${directoryActionButtonClass} ${extraScadaVisible[extraPanel.id] ? 'bg-white/10 border-white/10 hover:opacity-80' : 'text-gray-500 hover:text-gray-300'}`}
                        style={extraScadaVisible[extraPanel.id] ? { color: extraPanel.color } : undefined}
                        title={`${extraScadaVisible[extraPanel.id] ? '隐藏' : '显示'}${extraPanel.label}参数表`}
                    >
                        <span className="material-symbols-outlined text-sm">{extraScadaVisible[extraPanel.id] ? 'visibility' : 'visibility_off'}</span>
                    </button>
                )
            }

            if (hasScadaStandalone(pkg.id)) {
                popoutButton = (
                    <button
                        onClick={(e) => { e.stopPropagation(); openScadaStandalone(pkg.id); }}
                        className={`${directoryActionButtonClass} text-gray-400 hover:text-white`}
                        title="弹出独立窗口"
                    >
                        <span className="material-symbols-outlined text-sm">open_in_new</span>
                    </button>
                )
            }
        }

        if (trendSource && hasPressureData) {
            trendButton = (
                <button
                    onClick={(e) => { e.stopPropagation(); toggleTrendChart(pkg.id) }}
                    className={`${directoryActionButtonClass} ${isTrendActive ? 'bg-white/10 border-white/10 hover:opacity-90' : 'text-gray-500 hover:text-gray-300'}`}
                    style={isTrendActive ? { color: trendSource.color } : undefined}
                    title={`弹出${trendSource.title}里程进出站压力图`}
                >
                    <span className="material-symbols-outlined text-sm">show_chart</span>
                </button>
            )
            pressureButton = (
                <button
                    onClick={(e) => { e.stopPropagation(); togglePressureOverlay(pkg.id) }}
                    className={`${directoryActionButtonClass} ${isPressureActive ? 'bg-white/10 border-white/10 hover:opacity-90' : 'text-gray-500 hover:text-gray-300'}`}
                    style={isPressureActive ? { color: trendSource.color } : undefined}
                    title={`${isPressureActive ? '隐藏' : '显示'}${trendSource.title}管道压力标签`}
                >
                    <span className="material-symbols-outlined text-sm">speed</span>
                </button>
            )
        }

        return (
            <div className="ml-3 shrink-0 grid w-[140px] grid-cols-4 justify-items-center gap-1 rounded-lg border border-white/5 bg-black/20 px-1.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                {visibilityButton}
                {popoutButton}
                {trendButton}
                {pressureButton}
            </div>
        )
    }

    // 甪直历史面板状态
    const [stationHistoryPos, setStationHistoryPos] = useState({ x: Math.round(W / 2) - 390, y: Math.round(H / 2) - 240 })
    const [isDraggingStationHistory, setIsDraggingStationHistory] = useState(false)
    const stationHistoryOffsetRef = React.useRef({ x: 0, y: 0 })
    const handleStationHistoryMouseDown = (e: React.MouseEvent) => {
        setIsDraggingStationHistory(true)
        stationHistoryOffsetRef.current = { x: e.clientX - stationHistoryPos.x, y: e.clientY - stationHistoryPos.y }
    }

    // 展开状态
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ 'we1': true })

    // 可见性状态 - 当管线数据加载完成后初始化
    const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>({})
    const hasHydratedDirectoryRef = React.useRef(false)
    useEffect(() => {
        if (!pipelinesLoaded || pipelines.length === 0) return
        const saved = initialDirectoryLayoutRef.current
        const defaults = buildInitialLayerVisibility(pipelines)
        setVisibleLayers({ ...defaults, ...(saved.visibleLayers || {}) })
        setExpandedGroups({ we1: true, ...(saved.expandedGroups || {}) })
        setPipelineOrderIds((saved.orderIds || []).filter(id => pipelines.some(pkg => pkg.id === id)))
        setShowScada(Boolean(saved.scadaPanels?.we1))
        setShowWe1WestScada(Boolean(saved.scadaPanels?.we1West))
        setShowWe2Scada(Boolean(saved.scadaPanels?.we2))
        setShowCredScada(Boolean(saved.scadaPanels?.cred))
        setShowPtScada(Boolean(saved.scadaPanels?.pt))
        setExtraScadaVisible(saved.scadaPanels?.extra || {})
        setActiveTrendPipelineId(saved.activeTrendPipelineId || null)
        setActivePressureOverlayIds(saved.activePressureOverlayIds || {})
        hasHydratedDirectoryRef.current = true
    }, [pipelinesLoaded, pipelines])

    const orderedPipelines = useMemo(() => {
        if (pipelineOrderIds.length === 0) return pipelines
        const packageMap = new Map(pipelines.map(pkg => [pkg.id, pkg]))
        const ordered = pipelineOrderIds
            .map(id => packageMap.get(id))
            .filter((pkg): pkg is PipelinePackage => Boolean(pkg))
        const missing = pipelines.filter(pkg => !pipelineOrderIds.includes(pkg.id))
        return [...ordered, ...missing]
    }, [pipelineOrderIds, pipelines])

    useEffect(() => {
        if (!pipelinesLoaded || !hasHydratedDirectoryRef.current) return

        const state: DirectoryLayoutState = {
            position: directoryPos,
            size: directorySize,
            orderIds: orderedPipelines.map(pkg => pkg.id),
            visibleLayers,
            expandedGroups,
            scadaPanels: {
                we1: showScada,
                we1West: showWe1WestScada,
                we2: showWe2Scada,
                cred: showCredScada,
                pt: showPtScada,
                extra: extraScadaVisible,
            },
            activeTrendPipelineId,
            activePressureOverlayIds,
            trendWidth,
        }

        try {
            window.localStorage.setItem(DIRECTORY_LAYOUT_STORAGE_KEY, JSON.stringify(state))
        } catch (error) {
            console.warn('[GlobalPipelineView] 保存管线目录布局失败:', error)
        }
    }, [
        activePressureOverlayIds,
        activeTrendPipelineId,
        directoryPos,
        directorySize,
        expandedGroups,
        extraScadaVisible,
        orderedPipelines,
        pipelinesLoaded,
        showCredScada,
        showPtScada,
        showScada,
        showWe1WestScada,
        showWe2Scada,
        trendWidth,
        visibleLayers,
    ])

    const resetDirectoryLayout = useCallback(() => {
        if (typeof window !== 'undefined') {
            window.localStorage.removeItem(DIRECTORY_LAYOUT_STORAGE_KEY)
        }
        setDirectoryPos({ x: 24, y: 96 })
        setDirectorySize({ width: 288, height: Math.min(620, Math.max(420, H - 140)) })
        setPipelineOrderIds(pipelines.map(pkg => pkg.id))
        setExpandedGroups({ we1: true })
        setVisibleLayers(buildInitialLayerVisibility(pipelines))
        setShowScada(false)
        setShowWe1WestScada(false)
        setShowWe2Scada(false)
        setShowCredScada(false)
        setShowPtScada(false)
        setExtraScadaVisible({})
        setActiveTrendPipelineId(null)
        setActivePressureOverlayIds({})
        setTrendWidth(920)
    }, [H, pipelines])

    const handleDirectoryMouseDown = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement
        if (target.closest('button') || target.closest('[data-pipeline-row]') || target.closest('[data-directory-resize]')) return
        setIsDraggingDirectory(true)
        directoryDragOffsetRef.current = { x: e.clientX - directoryPos.x, y: e.clientY - directoryPos.y }
    }

    const handleDirectoryResizeMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation()
        setIsResizingDirectory(true)
        directoryResizeStartRef.current = { x: e.clientX, y: e.clientY, width: directorySize.width, height: directorySize.height }
    }

    const handlePipelineDragStart = (e: React.DragEvent, pipelineId: string) => {
        setPipelineDragId(pipelineId)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', pipelineId)
    }

    const handlePipelineDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault()
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const nextIndex = e.clientY > rect.top + rect.height / 2 ? index + 1 : index
        setPipelineDropIndex(nextIndex)
    }

    const handlePipelineListDragOver = (e: React.DragEvent) => {
        if (!pipelineDragId) return
        e.preventDefault()

        const container = e.currentTarget as HTMLElement
        const rect = container.getBoundingClientRect()
        const pointerY = e.clientY
        const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-pipeline-row]'))

        if (rows.length === 0) {
            setPipelineDropIndex(0)
            return
        }

        if (pointerY <= rect.top + 20) {
            setPipelineDropIndex(0)
            return
        }

        if (pointerY >= rect.bottom - 20) {
            setPipelineDropIndex(rows.length)
            return
        }

        let matchedIndex = rows.length
        for (let i = 0; i < rows.length; i++) {
            const rowRect = rows[i].getBoundingClientRect()
            if (pointerY < rowRect.top + rowRect.height / 2) {
                matchedIndex = i
                break
            }
        }
        setPipelineDropIndex(matchedIndex)
    }

    const handlePipelineDrop = (e: React.DragEvent) => {
        e.preventDefault()
        const dragId = pipelineDragId || e.dataTransfer.getData('text/plain')
        if (!dragId || pipelineDropIndex == null) return

        const currentIds = orderedPipelines.map(pkg => pkg.id)
        const fromIndex = currentIds.indexOf(dragId)
        if (fromIndex < 0) return

        const nextIds = currentIds.filter(id => id !== dragId)
        const adjustedIndex = fromIndex < pipelineDropIndex ? pipelineDropIndex - 1 : pipelineDropIndex
        nextIds.splice(clampNumber(adjustedIndex, 0, nextIds.length), 0, dragId)
        setPipelineOrderIds(nextIds)
        setPipelineDragId(null)
        setPipelineDropIndex(null)
    }

    const togglePressureOverlay = useCallback((pipelineId: string) => {
        setActivePressureOverlayIds(prev => ({ ...prev, [pipelineId]: !prev[pipelineId] }))
    }, [])

    // 切换分组展开
    const toggleGroupExpand = (pipelineId: string) => {
        setExpandedGroups(prev => ({ ...prev, [pipelineId]: !prev[pipelineId] }))
    }

    // 切换单个图层可见性
    const toggleLayer = (layerId: string) => {
        setVisibleLayers(prev => ({ ...prev, [layerId]: !prev[layerId] }))
    }

    // 切换整个管线包可见性
    const togglePackageVisibility = (pkg: PipelinePackage) => {
        const layerIds = pkg.layers.map((layer, index) => getPipelineLayerId(pkg, layer, index))
        const allVisible = layerIds.every(id => visibleLayers[id])

        const newState = { ...visibleLayers }
        for (let i = 0; i < layerIds.length; i++) {
            newState[layerIds[i]] = !allVisible
        }
        setVisibleLayers(newState)
        if (!allVisible) {
            focusPipelinePackage(pkg)
        }
    }

    // 全选 / 全部取消功能
    const toggleAllLayers = (visible: boolean) => {
        const newState: Record<string, boolean> = {}
        for (let i = 0; i < pipelines.length; i++) {
            const pkg = pipelines[i]
            for (let j = 0; j < pkg.layers.length; j++) {
                newState[getPipelineLayerId(pkg, pkg.layers[j], j)] = visible
            }
        }
        setVisibleLayers(newState)
    }

    // 计算当前显示的管道数据 - 性能优化版
    const pipelineData = useMemo<PipelineData>(() => {
        return buildPipelineDataFromPackages(pipelines, visibleLayers)
    }, [visibleLayers, pipelines])

    useEffect(() => {
        if (!selectedMapNode) return

        const stillVisible = pipelineData.nodes.some(node => node.id === selectedMapNode.id)
        if (!stillVisible) {
            setSelectedMapNode(null)
        }
    }, [pipelineData.nodes, selectedMapNode])

    // 统计信息
    const stats = useMemo(() => ({
        stations: pipelineData.nodes.length,
        pipelines: pipelineData.lines.length,
        groups: pipelines.length
    }), [pipelineData, pipelines])

    const currentMultiScenarioCase = useMemo(() => {
        return MULTI_SCENARIO_AI_CASES.find(item => item.id === multiScenarioStepId) || null
    }, [multiScenarioStepId])

    const multiScenarioDisplayCases = useMemo(() => {
        const selectedSet = new Set(multiScenarioSelectedCaseIds)
        const selectedCases = MULTI_SCENARIO_AI_CASES.filter(item => selectedSet.has(item.id))
        return selectedCases.length > 0 ? selectedCases : MULTI_SCENARIO_AI_CASES
    }, [multiScenarioSelectedCaseIds])

    const multiScenarioConclusion = useMemo(() => {
        return buildMultiScenarioAiConclusion(multiScenarioResults)
    }, [multiScenarioResults])

    const simulationPressureChartEntries = useMemo<SimulationPressureChartEntry[]>(() => {
        if (multiScenarioResults.length > 0) {
            return multiScenarioResults.map(result => ({
                id: result.caseId,
                label: result.label,
                overlay: result.overlay,
                color: getSimulationPressureChartColor(result.caseId),
            }))
        }

        const overlay = simulationPressureChartOverlay ?? globalSimulation.overlay
        if (!overlay) return []
        return [{
            id: 'latest',
            label: currentMultiScenarioCase?.label || '当前工况',
            overlay,
            color: '#10b981',
        }]
    }, [currentMultiScenarioCase?.label, globalSimulation.overlay, multiScenarioResults, simulationPressureChartOverlay])

    const visibleSimulationPressureChartEntries = useMemo(() => {
        return simulationPressureChartEntries.filter(entry => !hiddenSimulationPressureChartIds[entry.id])
    }, [hiddenSimulationPressureChartIds, simulationPressureChartEntries])

    const simulationPressureChartConfigs = useMemo(() => {
        return visibleSimulationPressureChartEntries
            .map(entry => ({
                ...entry,
                config: buildSimulationPressureTrendConfig(entry.overlay, entry.label, entry.color),
            }))
            .filter((entry): entry is SimulationPressureChartEntry & { config: TrendChartConfig } => Boolean(entry.config))
    }, [visibleSimulationPressureChartEntries])

    const simulationPressureTrendChart = simulationPressureChartConfigs[0]?.config ?? null

    useEffect(() => {
        if (simulationPressureChartEntries.length === 0) return

        setSimulationPressureChartLayouts(prev => {
            let changed = false
            const next = { ...prev }
            simulationPressureChartEntries.forEach((entry, index) => {
                if (next[entry.id]) return
                next[entry.id] = buildDefaultSimulationPressureChartLayout(index, W, H)
                changed = true
            })
            return changed ? next : prev
        })
    }, [H, W, simulationPressureChartEntries])

    useEffect(() => {
        if (multiScenarioActiveRef.current) return

        const overlay = globalSimulation.overlay
        const runId = overlay?.run_id
        if (!runId || lastSimulationPressureChartRunIdRef.current === runId) return

        lastSimulationPressureChartRunIdRef.current = runId
        setSimulationPressureChartOverlay(overlay)
        setHiddenSimulationPressureChartIds({})
        setSimulationPressureChartRevealProgress(prev => ({ ...prev, latest: 1 }))
        setSimulationPressureChartOpen(true)
    }, [globalSimulation.overlay])

    const buildGlobalMultiScenarioResult = useCallback((demoCase: MultiScenarioAiCase, overlay: SimulationOverlay): MultiScenarioAiResult => {
        const minPressureNode = overlay.nodes.reduce((currentMin, node) => {
            const currentPressure = currentMin.pressure_in_mpa ?? currentMin.pressure_mpa
            const nextPressure = node.pressure_in_mpa ?? node.pressure_mpa
            return nextPressure < currentPressure ? node : currentMin
        }, overlay.nodes[0])
        const sourceNode = overlay.nodes.find(node => node.id === ZHONGWEI_SOURCE_NODE_ID)
        const minPressurePipelineNode = minPressureNode ? findPipelineNodeByPilotNodeId(minPressureNode.id, pipelineData) : null

        return {
            caseId: demoCase.id,
            label: demoCase.label,
            flowText: demoCase.flowText,
            description: demoCase.description,
            overlay,
            sourceFlow: sourceNode?.supply_actual ?? overlay.summary.total_supply,
            unservedDemand: overlay.summary.unserved_demand,
            alertCount: overlay.summary.alert_count,
            avgUtilization: overlay.summary.avg_utilization,
            minPressure: minPressureNode ? (minPressureNode.pressure_in_mpa ?? minPressureNode.pressure_mpa) : 0,
            minPressureNodeName: minPressurePipelineNode?.name || (minPressureNode ? resolvePilotNodeName(minPressureNode.id) : '-'),
            iterations: overlay.iterations,
            runId: overlay.run_id,
        }
    }, [pipelineData])

    const runGlobalMultiScenarioAi = useCallback(async (selectedScenarioIds?: string[]) => {
        if (multiScenarioActiveRef.current) return

        const selectedSet = selectedScenarioIds?.length
            ? new Set(selectedScenarioIds)
            : null
        const selectedCases = selectedSet
            ? MULTI_SCENARIO_AI_CASES.filter(item => selectedSet.has(item.id))
            : MULTI_SCENARIO_AI_CASES
        const casesToRun = selectedCases.length > 0 ? selectedCases : MULTI_SCENARIO_AI_CASES

        multiScenarioActiveRef.current = true
        setMultiScenarioActive(true)
        setMultiScenarioSelectedCaseIds(casesToRun.map(item => item.id))
        setMultiScenarioError(null)
        setMultiScenarioResults([])
        setMultiScenarioPanelOpen(false)
        setHiddenSimulationPressureChartIds({})
        setSimulationPressureChartLayouts({})
        setSimulationPressureChartOverlay(null)
        setSimulationPressureChartRevealProgress({})
        setSimulationPressureChartOpen(false)
        setSimulationCutoffEdgeIds([])
        setNodeDisplayMode('hub')
        setHubNodeTypes(['source', 'compressor', 'junction', 'distribution'])
        setExpandedGroups(prev => ({ ...prev, we1: true }))
        setVisibleLayers(prev => {
            const next = { ...prev }
            pipelines.forEach(pkg => {
                if (pkg.id !== 'we1') return
                pkg.layers.forEach((layer, index) => {
                    next[getPipelineLayerId(pkg, layer, index)] = true
                })
            })
            return next
        })

        const collected: MultiScenarioAiResult[] = []
        try {
            emitMultiScenarioAiAssistantEvent('progress', {
                message: `已调用 multi-scenario-ai skill，已确认 ${casesToRun.length} 个工况，准备在全国一张网依次运行。`,
            })

            for (const demoCase of casesToRun) {
                setMultiScenarioStepId(demoCase.id)
                setSimulationCutoffEdgeIds(demoCase.id === 'zhongwei-cutoff' ? [ZHONGWEI_FIRST_TRUNK_EDGE_ID] : [])
                emitMultiScenarioAiAssistantEvent('progress', {
                    message: `正在运行 ${demoCase.label}：${demoCase.description}`,
                })

                const overlay = await globalSimulation.runSimulation({
                    scenarioId: demoCase.scenarioId,
                    initialInput: demoCase.initialInput,
                    waitForAnimation: true,
                })

                if (!overlay) {
                    throw new Error(`${demoCase.label} 仿真没有返回结果`)
                }

                const result = buildGlobalMultiScenarioResult(demoCase, overlay)
                collected.push(result)
                setMultiScenarioResults([...collected])
                setHiddenSimulationPressureChartIds(prev => ({ ...prev, [result.caseId]: false }))
                setSimulationPressureChartRevealProgress(prev => ({ ...prev, [result.caseId]: 0 }))
                setSimulationPressureChartOpen(true)
                emitMultiScenarioAiAssistantEvent('progress', {
                    message: `${demoCase.label} 已完成，run_id=${result.runId}，正在生成中卫-上海白鹤压力曲线。`,
                })
                await new Promise(resolve => setTimeout(resolve, 80))
                await animateSimulationPressureChartReveal(result.caseId)
                emitMultiScenarioAiAssistantEvent('progress', {
                    message: `${demoCase.label} 压力曲线已生成，未满足需求 ${result.unservedDemand.toFixed(0)} 万方/天，准备进入下一组工况。`,
                })
                await new Promise(resolve => setTimeout(resolve, 320))
            }

            setMultiScenarioPanelOpen(true)
            emitMultiScenarioAiAssistantEvent('result', {
                message: formatMultiScenarioAiMessage(collected),
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : '多工况 AI 仿真失败'
            setMultiScenarioError(message)
            emitMultiScenarioAiAssistantEvent('result', { error: message })
        } finally {
            setMultiScenarioStepId('')
            multiScenarioActiveRef.current = false
            setMultiScenarioActive(false)
        }
    }, [animateSimulationPressureChartReveal, buildGlobalMultiScenarioResult, globalSimulation, pipelines])

    useEffect(() => {
        const handleStart = (event: Event) => {
            const detail = (event as CustomEvent<MultiScenarioAiStartEventDetail>).detail
            void runGlobalMultiScenarioAi(detail?.selectedScenarioIds)
        }
        const handleMessage = (event: MessageEvent) => {
            const payload = event.data as { type?: string; detail?: MultiScenarioAiStartEventDetail } | undefined
            if (payload?.type === 'assistant-start-multi-scenario-ai') {
                void runGlobalMultiScenarioAi(payload.detail?.selectedScenarioIds)
            }
        }

        let channel: BroadcastChannel | null = null
        try {
            channel = new BroadcastChannel(AI_ASSISTANT_SYNC_CHANNEL)
            channel.onmessage = (event) => {
                const payload = event.data as { type?: string; detail?: MultiScenarioAiStartEventDetail } | undefined
                if (payload?.type === 'assistant-start-multi-scenario-ai') {
                    void runGlobalMultiScenarioAi(payload.detail?.selectedScenarioIds)
                }
            }
        } catch {
            channel = null
        }

        window.addEventListener('assistant-start-multi-scenario-ai', handleStart)
        window.addEventListener('message', handleMessage)
        return () => {
            window.removeEventListener('assistant-start-multi-scenario-ai', handleStart)
            window.removeEventListener('message', handleMessage)
            channel?.close()
        }
    }, [runGlobalMultiScenarioAi])

    const selectedMapNodeMeta = useMemo(() => {
        if (!selectedMapNode) return null

        const rawType = getNodeRawType(selectedMapNode)
        const rawTypeLabelMap: Record<string, string> = {
            source: '气源/首末站',
            compressor: '压气站',
            distribution: '分输站',
            valve: '阀室',
            junction: '交汇点',
            storage: '储气设施',
            shared: '共享站点',
            other: '其他节点',
        }

        const junctionKind = getJunctionKind(selectedMapNode)
        const rawTypeLabel = rawType === 'junction'
            ? junctionKind === 'major_junction'
                ? '大枢纽'
                : '枢纽/交汇点'
            : rawTypeLabelMap[rawType] || '其他节点'

        return {
            rawTypeLabel,
            layerName: typeof selectedMapNode.properties?.layerName === 'string'
                ? selectedMapNode.properties.layerName
                : '未标记图层',
            systemId: typeof selectedMapNode.properties?.systemId === 'string'
                ? selectedMapNode.properties.systemId
                : '未标记系统',
            junctionKindLabel: junctionKind === 'major_junction' ? '大枢纽' : junctionKind === 'junction' ? '普通枢纽' : null,
        }
    }, [selectedMapNode])

    const handleMapNodeClick = useCallback((event: { data: PipelineNode }) => {
        setSelectedMapNode(event.data)
    }, [])

    // ==========================================
    // 将 SCADA 数据直接渲染在对应管网节点上 (无动画/单纯显示)
    // ==========================================
    useEffect(() => {
        if (!mapInstance) return

        let timer: any
        const activeEntries = Object.entries(activePressureOverlayIds).filter(([, active]) => active)
        const activeStationData = new Map<string, { inP: number; outP: number; inT?: number; outT?: number; color: string }>()
        activeEntries.forEach(([pipelineId]) => {
            const source = getTrendSource(pipelineId)
            if (!source) return

            source.entries.forEach(([name, record]) => {
                if (!Number.isFinite(record.inP) || !Number.isFinite(record.outP)) return
                const value = {
                    inP: record.inP,
                    outP: record.outP,
                    inT: record.inT,
                    outT: record.outT,
                    color: source.color,
                }
                activeStationData.set(name, value)
                activeStationData.set(normalizeStationMatchKey(name), value)
            })
        })

        // 使用 timer 定期重新挂载属性（考虑用户缩放或平移时地图重新生成 marker）
        timer = setInterval(() => {
            const markerMap = getNodeMarkerMap()
            if (markerMap.size === 0) return

            markerMap.forEach((marker) => {
                if (!marker || !marker.getContent) return

                const node = marker.getExtData()?.node as PipelineNode
                if (!node) return

                let originalContent = typeof marker.getContent === 'function' ? marker.getContent() : marker.getContent?.() || ''
                if (typeof originalContent !== 'string') return

                const hasRealtime = originalContent.includes('<!--scada-label-->')
                if (hasRealtime) {
                    originalContent = originalContent.split('<!--scada-label-->')[0]
                }

                const scadaData = activeStationData.get(node.name) || activeStationData.get(normalizeStationMatchKey(node.name))
                if (!scadaData) {
                    if (hasRealtime) marker.setContent(originalContent)
                    return
                }

                const inTLabel = scadaData.inT ? ` T: ${scadaData.inT}` : ''
                const outTLabel = scadaData.outT ? ` T: ${scadaData.outT}` : ''
                const shadow = '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000'

                const scadaHTML = `
                    <!--scada-label-->
                    <div class="absolute left-1/2 -top-1 -translate-x-1/2 -translate-y-full flex flex-col items-center pointer-events-none whitespace-nowrap z-50 overflow-visible" 
                         style="line-height: 1.1; display:flex;">
                        <span style="font-size:10px; font-weight:bold; color:#f59e0b; text-shadow: ${shadow};">
                            入 P: ${scadaData.inP.toFixed(2)}${inTLabel}
                        </span>
                        <span style="font-size:10px; font-weight:bold; color:${scadaData.color}; text-shadow: ${shadow};">
                            出 P: ${scadaData.outP.toFixed(2)}${outTLabel}
                        </span>
                    </div>
                `

                if (originalContent.includes('class="compressor-marker-container"')) {
                    originalContent = originalContent.replace('class="compressor-marker-container"', 'class="compressor-marker-container" style="position:relative; overflow:visible;"')
                    marker.setContent(originalContent + scadaHTML)
                } else if (originalContent.startsWith('<div')) {
                    originalContent = originalContent.replace('<div', '<div style="position:relative; overflow:visible;"')
                    marker.setContent(originalContent + scadaHTML)
                }
            })
        }, 800)

        return () => clearInterval(timer)
    }, [activePressureOverlayIds, mapInstance])

    useEffect(() => {
        if (!mapInstance) return

        const activeOverlay = globalSimulation.overlay
        const simByStationKey = new Map<string, SimulationOverlay['nodes'][number]>()
        activeOverlay?.nodes.forEach(node => {
            simByStationKey.set(normalizeStationMatchKey(resolvePilotNodeName(node.id)), node)
        })

        const timer = setInterval(() => {
            const markerMap = getNodeMarkerMap()
            if (markerMap.size === 0) return

            markerMap.forEach((marker) => {
                if (!marker || !marker.getContent) return

                const node = marker.getExtData()?.node as PipelineNode
                if (!node) return

                let originalContent = typeof marker.getContent === 'function' ? marker.getContent() : marker.getContent?.() || ''
                if (typeof originalContent !== 'string') return

                const hasSimLabel = originalContent.includes('<!--sim-label-->')
                if (hasSimLabel) {
                    originalContent = originalContent.split('<!--sim-label-->')[0]
                }

                const simNode = simByStationKey.get(normalizeStationMatchKey(node.name))
                if (!simNode) {
                    if (hasSimLabel) marker.setContent(originalContent)
                    return
                }

                const pressureIn = simNode.pressure_in_mpa ?? simNode.pressure_mpa
                const pressureOut = simNode.pressure_mpa
                const alertColor = simNode.alert_level === 'critical'
                    ? '#f87171'
                    : simNode.alert_level === 'warning'
                        ? '#fbbf24'
                        : '#67e8f9'
                const shadow = '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000'
                const simHTML = `
                    <!--sim-label-->
                    <div class="absolute left-1/2 -top-7 -translate-x-1/2 -translate-y-full flex flex-col items-center pointer-events-none whitespace-nowrap z-50 overflow-visible"
                         style="line-height:1.08; display:flex;">
                        <span style="font-size:10px; font-weight:bold; color:${alertColor}; text-shadow:${shadow};">
                            仿真 入:${pressureIn.toFixed(2)} 出:${pressureOut.toFixed(2)}
                        </span>
                        <span style="font-size:9px; color:#a5f3fc; text-shadow:${shadow};">
                            ${currentMultiScenarioCase?.label || activeOverlay?.scenario_id || ''}
                        </span>
                    </div>
                `

                if (originalContent.includes('style="position:relative; overflow:visible;"')) {
                    marker.setContent(originalContent + simHTML)
                } else if (originalContent.startsWith('<div')) {
                    marker.setContent(originalContent.replace('<div', '<div style="position:relative; overflow:visible;"') + simHTML)
                }
            })
        }, 500)

        return () => clearInterval(timer)
    }, [currentMultiScenarioCase?.label, globalSimulation.overlay, mapInstance])

    const fixedScadaPanels = [
        {
            id: 'we1',
            visible: showScada && !isScadaPoppedOut,
            label: '西气东输一线',
            accentColor: '#10b981',
            titleColor: '#a7f3d0',
            style: { left: `${scadaPos.x}px`, top: `${scadaPos.y}px` },
            topBarGradient: 'linear-gradient(90deg, #10b981, #059669, #10b981)',
            borderColor: 'rgba(16,185,129,0.3)',
            headerBorderColor: 'rgba(16,185,129,0.15)',
            background: 'linear-gradient(135deg, rgba(10,20,30,0.92) 0%, rgba(15,30,20,0.92) 100%)',
            isDragging: isDraggingScada,
            onMouseDown: handleScadaMouseDown,
            onClose: () => setShowScada(false),
            data: REAL_SCADA_DATA,
            closePopOut: closeScadaPopOut,
            popOut: popOutScada,
        },
        {
            id: 'we2',
            visible: showWe2Scada,
            label: '西气东输二线',
            accentColor: '#3b82f6',
            titleColor: '#bfdbfe',
            style: { left: `${we2ScadaPos.x}px`, top: `${we2ScadaPos.y}px` },
            topBarGradient: 'linear-gradient(90deg, #3b82f6, #2563eb, #3b82f6)',
            borderColor: 'rgba(59,130,246,0.3)',
            headerBorderColor: 'rgba(59,130,246,0.15)',
            background: 'linear-gradient(135deg, rgba(10,15,30,0.92) 0%, rgba(10,20,35,0.92) 100%)',
            isDragging: isDraggingWe2Scada,
            onMouseDown: handleWe2ScadaMouseDown,
            onClose: () => setShowWe2Scada(false),
            data: WE2_SCADA_DATA,
            closePopOut: noop,
            popOut: noop,
        },
        {
            id: 'we1-west',
            visible: showWe1WestScada,
            label: '西气东输一线（西段）',
            accentColor: '#f59e0b',
            titleColor: '#fde68a',
            style: { left: `${we1WestPos.x}px`, top: `${we1WestPos.y}px` },
            topBarGradient: 'linear-gradient(90deg,#f59e0b,#d97706,#f59e0b)',
            borderColor: 'rgba(245,158,11,0.3)',
            headerBorderColor: 'rgba(245,158,11,0.15)',
            background: 'linear-gradient(135deg, rgba(20,15,5,0.93) 0%, rgba(30,20,5,0.93) 100%)',
            isDragging: isDraggingWe1West,
            onMouseDown: handleWe1WestMouseDown,
            onClose: () => setShowWe1WestScada(false),
            data: WE1_WEST_SCADA_DATA,
            closePopOut: noop,
            popOut: noop,
        },
        {
            id: 'cred',
            visible: showCredScada,
            label: '中俄东线',
            accentColor: '#ec4899',
            titleColor: '#fbcfe8',
            style: { left: `${credPos.x}px`, top: `${credPos.y}px` },
            topBarGradient: 'linear-gradient(90deg,#ec4899,#be185d,#ec4899)',
            borderColor: 'rgba(236,72,153,0.3)',
            headerBorderColor: 'rgba(236,72,153,0.15)',
            background: 'linear-gradient(135deg, rgba(25,5,15,0.93) 0%, rgba(35,5,20,0.93) 100%)',
            isDragging: isDraggingCred,
            onMouseDown: handleCredMouseDown,
            onClose: () => setShowCredScada(false),
            data: CRED_SCADA_DATA,
            closePopOut: noop,
            popOut: noop,
        },
        {
            id: 'pt',
            visible: showPtScada,
            label: '平泰支干线',
            accentColor: '#a855f7',
            titleColor: '#e9d5ff',
            style: { left: `${ptPos.x}px`, top: `${ptPos.y}px` },
            topBarGradient: 'linear-gradient(90deg,#a855f7,#7c3aed,#a855f7)',
            borderColor: 'rgba(168,85,247,0.3)',
            headerBorderColor: 'rgba(168,85,247,0.15)',
            background: 'linear-gradient(135deg, rgba(15,5,25,0.93) 0%, rgba(20,5,35,0.93) 100%)',
            isDragging: isDraggingPt,
            onMouseDown: handlePtMouseDown,
            onClose: () => setShowPtScada(false),
            data: PT_SCADA_DATA,
            closePopOut: noop,
            popOut: noop,
        },
    ]

    return (
        <div
            className="h-screen w-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 overflow-hidden relative"
            onMouseMove={handleGlobalMouseMove}
            onMouseUp={handleGlobalMouseUp}
            onMouseLeave={handleGlobalMouseUp}
        >
            {/* 标题栏 */}
            <div className="absolute top-0 left-0 right-0 z-30 bg-black/50 backdrop-blur-sm border-b border-blue-500/30">
                <div className="container mx-auto px-6 py-4 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                            <span className="material-symbols-outlined text-3xl text-blue-400">public</span>
                            智脉平台-全国管网统一视图
                        </h1>
                        <p className="text-sm text-gray-300 mt-1">
                            站场: {stats.stations} | 管道段: {stats.pipelines} | 管线组: {stats.groups}
                        </p>
                    </div>
                    {/* 右侧工具栏 */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={activatePresentationNodeMode}
                            className={`flex min-w-[68px] items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all border ${isPresentationNodeMode ? 'bg-amber-500/22 border-amber-300/55 text-amber-50' : 'bg-amber-500/15 border-amber-300/35 text-amber-100 hover:bg-amber-500/22 hover:border-amber-300/55'}`}
                            title={isPresentationNodeMode ? '恢复全量站场和压气站显示' : '展示模式：只保留气源站和枢纽站，并隐藏阀室'}
                        >
                            <span className="material-symbols-outlined text-base">filter_alt</span>
                            <span>展示</span>
                        </button>
                        <button
                            onClick={() => setMapTheme(prev => prev === 'dark' ? 'light' : 'dark')}
                            className={`flex min-w-[68px] items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all border ${mapTheme === 'dark' ? 'bg-slate-800/75 border-cyan-300/35 text-cyan-100 hover:bg-slate-700/80' : 'bg-white/80 border-amber-300/60 text-amber-800 hover:bg-amber-50'}`}
                            title={mapTheme === 'dark' ? '当前深色底图，点击切换浅色' : '当前浅色底图，点击切换深色'}
                        >
                            <span className="material-symbols-outlined text-base">
                                {mapTheme === 'dark' ? 'dark_mode' : 'light_mode'}
                            </span>
                            <span>{mapTheme === 'dark' ? '深色' : '浅色'}</span>
                        </button>
                        <div className="relative" ref={hubMenuRef}>
                            <button
                                onClick={() => {
                                    if (nodeDisplayMode === 'hub') {
                                        setIsHubMenuOpen(prev => !prev)
                                    } else {
                                        setNodeDisplayMode('hub')
                                    }
                                }}
                                className={`flex min-w-[132px] items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all border ${nodeDisplayMode === 'hub' ? 'bg-cyan-500/15 border-cyan-400/40 text-cyan-200' : 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200'}`}
                                title={nodeDisplayMode === 'hub' ? '点击展开枢纽筛选菜单' : '当前显示全量节点，点击切回枢纽精简'}
                            >
                                <span className="material-symbols-outlined text-base">hub</span>
                                <span>枢纽精简</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/80">
                                    {hubNodeTypes.length}
                                </span>
                                <span className="material-symbols-outlined text-sm">expand_more</span>
                            </button>
                            {isHubMenuOpen && nodeDisplayMode === 'hub' && (
                                <div className="absolute right-0 top-[42px] z-50 w-72 rounded-xl border border-cyan-500/25 bg-[#0c1218]/95 backdrop-blur-md shadow-2xl p-2">
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <span className="text-[11px] text-cyan-200 font-semibold">保留哪些节点</span>
                                        <button
                                            onClick={() => setNodeDisplayMode('full')}
                                            className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-200 border border-emerald-400/30"
                                        >
                                            全量
                                        </button>
                                    </div>
                                    <div className="space-y-1">
                                        {[
                                            { type: 'source' as HubNodeType, label: '气源站', color: '#34d399' },
                                            { type: 'compressor' as HubNodeType, label: '压气站', color: '#f59e0b' },
                                            { type: 'junction' as HubNodeType, label: '枢纽站', color: '#00e5ff' },
                                            { type: 'distribution' as HubNodeType, label: '分输站', color: '#22c55e' },
                                        ].map(item => {
                                            const checked = hubNodeTypes.includes(item.type)
                                            return (
                                                <button
                                                    key={item.type}
                                                    onClick={() => toggleHubNodeType(item.type)}
                                                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition-all border ${checked ? 'bg-cyan-500/10 border-cyan-400/30 text-white' : 'bg-white/5 border-white/10 text-gray-400 hover:text-gray-200'}`}
                                                >
                                                    <span className="flex items-center gap-2">
                                                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                                                        {item.label}
                                                    </span>
                                                    <span className="material-symbols-outlined text-sm">{checked ? 'check_circle' : 'radio_button_unchecked'}</span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                    <div className="flex gap-2 mt-2">
                                        <button
                                            onClick={() => setHubNodeTypes(['source', 'compressor', 'junction', 'distribution'])}
                                            className="flex-1 px-2 py-1.5 rounded-lg text-[10px] bg-slate-800/80 text-slate-200 border border-white/10"
                                        >
                                            全选
                                        </button>
                                        <button
                                            onClick={() => setHubNodeTypes([])}
                                            className="flex-1 px-2 py-1.5 rounded-lg text-[10px] bg-slate-800/80 text-slate-200 border border-white/10"
                                        >
                                            全不选
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => setShowValveRooms(prev => !prev)}
                                        className={`mt-2 w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs transition-all border ${showValveRooms ? 'bg-yellow-500/12 border-yellow-300/35 text-yellow-100' : 'bg-white/5 border-white/10 text-gray-400 hover:text-gray-200'}`}
                                        title={showValveRooms ? '当前显示阀室，点击隐藏' : '当前隐藏阀室，点击显示'}
                                    >
                                        <span className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-sm">
                                                {showValveRooms ? 'visibility' : 'visibility_off'}
                                            </span>
                                            {showValveRooms ? '隐藏阀室' : '显示阀室'}
                                        </span>
                                        <span className="material-symbols-outlined text-sm">{showValveRooms ? 'toggle_on' : 'toggle_off'}</span>
                                    </button>
                                    <div className="mt-2 rounded-lg border border-emerald-400/15 bg-emerald-500/5 p-2">
                                        <div className="flex items-center justify-between gap-2 mb-1.5">
                                            <span className="text-[11px] text-emerald-200 font-semibold">气源站名单</span>
                                            <span className="text-[10px] text-emerald-100/70">{CORE_SOURCE_STATION_NAMES.length} 个</span>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {CORE_SOURCE_STATION_NAMES.map(name => (
                                                <span
                                                    key={name}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] border ${hubNodeTypes.includes('source') ? 'bg-emerald-400/12 border-emerald-300/25 text-emerald-100' : 'bg-slate-800/60 border-white/10 text-slate-500'}`}
                                                >
                                                    {name}
                                                </span>
                                            ))}
                                        </div>
                                        <div className="mt-1.5 text-[10px] text-slate-400 leading-relaxed">
                                            勾选“气源站”时，这些供气入口保留为绿色气滴。
                                        </div>
                                    </div>
                                    <div className="mt-2 rounded-lg border border-cyan-400/15 bg-cyan-500/5 p-2">
                                        <div className="flex items-center justify-between gap-2 mb-1.5">
                                            <span className="text-[11px] text-cyan-200 font-semibold">枢纽站名单</span>
                                            <span className="text-[10px] text-cyan-100/70">{CORE_HUB_STATION_NAMES.length} 个</span>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {CORE_HUB_STATION_NAMES.map(name => (
                                                <span
                                                    key={name}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] border ${hubNodeTypes.includes('junction') ? 'bg-yellow-400/12 border-yellow-300/25 text-yellow-100' : 'bg-slate-800/60 border-white/10 text-slate-500'}`}
                                                >
                                                    {name}
                                                </span>
                                            ))}
                                        </div>
                                        <div className="mt-1.5 text-[10px] text-slate-400 leading-relaxed">
                                            勾选“枢纽站”时，这些核心枢纽保留为黄菱形；不勾选时，只看管线流动，不单独显示枢纽点。
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 地图 */}
            <MapView
                config={{ theme: mapTheme }}
                pipelineData={pipelineData}
                nodeDisplayMode={nodeDisplayMode}
                hubNodeTypes={hubNodeTypes}
                showValveRooms={showValveRooms}
                simulationOverlay={globalSimulation.overlay}
                simulationCutoffEdgeIds={simulationCutoffEdgeIds}
                onLoad={handleMapLoad}
                onNodeClick={handleMapNodeClick}
            />

            {(multiScenarioActive || globalSimulation.isLoading || globalSimulation.animatingState?.active || multiScenarioResults.length > 0 || multiScenarioError) && (
                <div className="absolute top-[92px] right-6 z-30 w-[360px] rounded-2xl border border-emerald-400/25 bg-slate-950/92 backdrop-blur-md shadow-2xl shadow-emerald-950/40 overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/10 bg-gradient-to-r from-emerald-950/70 to-cyan-950/50">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-white font-bold text-sm">
                                <span className="material-symbols-outlined text-emerald-300">
                                    {multiScenarioActive ? 'sync' : 'psychology_alt'}
                                </span>
                                全国图 · 多工况AI仿真
                            </div>
                            <div className="flex items-center gap-1.5">
                                {simulationPressureChartEntries.length > 0 && (
                                    <button
                                        onClick={() => {
                                            if (!simulationPressureChartOpen || simulationPressureChartConfigs.length === 0) {
                                                setHiddenSimulationPressureChartIds({})
                                            }
                                            setSimulationPressureChartOpen(prev => simulationPressureChartConfigs.length === 0 ? true : !prev)
                                        }}
                                        className="text-[10px] px-2 py-1 rounded border border-cyan-400/25 bg-cyan-500/10 text-cyan-100"
                                    >
                                        {simulationPressureChartOpen && simulationPressureChartConfigs.length > 0 ? '隐藏曲线' : '压力曲线'}
                                    </button>
                                )}
                                {multiScenarioResults.length === multiScenarioDisplayCases.length && (
                                    <button
                                        onClick={() => setMultiScenarioPanelOpen(prev => !prev)}
                                        className="text-[10px] px-2 py-1 rounded border border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                                    >
                                        {multiScenarioPanelOpen ? '收起' : '比对'}
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">
                            {currentMultiScenarioCase
                                ? `正在运行：${currentMultiScenarioCase.label}`
                                : multiScenarioResults.length > 0
                                    ? `${multiScenarioResults.length} 组工况已完成`
                                    : '等待 AI 文本框触发'}
                        </div>
                    </div>

                    <div className="p-4 space-y-3">
                        <div className="space-y-1.5">
                            {multiScenarioDisplayCases.map(item => {
                                const done = multiScenarioResults.some(result => result.caseId === item.id)
                                const active = multiScenarioStepId === item.id
                                return (
                                    <div key={item.id} className="flex items-center gap-2 text-[11px]">
                                        <span className={`w-2.5 h-2.5 rounded-full ${done ? 'bg-emerald-400' : active ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'}`} />
                                        <span className={active ? 'text-cyan-100 font-semibold' : done ? 'text-emerald-100' : 'text-slate-400'}>{item.label}</span>
                                        <span className="ml-auto text-slate-500 font-mono">{item.flowText} 万方/天</span>
                                    </div>
                                )
                            })}
                        </div>

                        {(globalSimulation.isLoading || globalSimulation.animatingState?.active) && (
                            <div className="rounded-xl border border-cyan-400/15 bg-cyan-950/20 p-3">
                                <div className="flex items-center justify-between text-[10px] text-cyan-100 mb-1">
                                    <span>{globalSimulation.isLoading ? '求解器装配中' : '压力场演化中'}</span>
                                    <span>
                                        {globalSimulation.animatingState
                                            ? `${globalSimulation.animatingState.iteration}/${globalSimulation.animatingState.total}`
                                            : '--'}
                                    </span>
                                </div>
                                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-blue-400 to-emerald-400 transition-all duration-200"
                                        style={{
                                            width: globalSimulation.animatingState
                                                ? `${Math.min(100, (globalSimulation.animatingState.iteration / globalSimulation.animatingState.total) * 100)}%`
                                                : '16%',
                                        }}
                                    />
                                </div>
                                <div className="mt-2 text-[10px] text-slate-400">
                                    真实求解迭代 {globalSimulation.animatingState?.solverIterations ?? globalSimulation.overlay?.iterations ?? '--'} 次
                                </div>
                            </div>
                        )}

                        {multiScenarioPanelOpen && multiScenarioResults.length > 0 && (
                            <div className="rounded-xl border border-white/10 overflow-hidden">
                                <div className="grid grid-cols-[1.1fr_0.7fr_0.7fr_0.7fr] bg-slate-900/90 text-[10px] text-slate-400 px-2 py-1.5">
                                    <span>工况</span>
                                    <span className="text-right">未满足</span>
                                    <span className="text-right">最低压</span>
                                    <span className="text-right">告警</span>
                                </div>
                                <div className="divide-y divide-white/5">
                                    {multiScenarioResults.map(result => (
                                        <button
                                            key={result.caseId}
                                            onClick={() => {
                                                setSimulationPressureChartOverlay(result.overlay)
                                                setHiddenSimulationPressureChartIds(prev => ({ ...prev, [result.caseId]: false }))
                                                setSimulationPressureChartOpen(true)
                                            }}
                                            className="grid grid-cols-[1.1fr_0.7fr_0.7fr_0.7fr] w-full px-2 py-1.5 text-[10px] text-left hover:bg-white/[0.04] transition-colors"
                                            title={`查看${result.label}压力曲线`}
                                        >
                                            <span className="text-slate-100 truncate">{result.label}</span>
                                            <span className={`text-right font-mono ${result.unservedDemand > 0 ? 'text-red-300' : 'text-slate-400'}`}>{result.unservedDemand.toFixed(0)}</span>
                                            <span className="text-right font-mono text-cyan-300">{result.minPressure.toFixed(2)}</span>
                                            <span className="text-right font-mono text-amber-300">{result.alertCount.toFixed(0)}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {multiScenarioResults.length === multiScenarioDisplayCases.length && (
                            <div className="rounded-xl border border-emerald-400/20 bg-emerald-950/20 p-3 text-[11px] leading-relaxed text-emerald-100">
                                {multiScenarioConclusion}
                            </div>
                        )}

                        {multiScenarioError && (
                            <div className="rounded-xl border border-red-400/20 bg-red-950/30 p-3 text-[11px] text-red-200">
                                {multiScenarioError}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {simulationPressureChartOpen && simulationPressureChartConfigs.map((entry, index) => {
                const layout = simulationPressureChartLayouts[entry.id]
                    || buildDefaultSimulationPressureChartLayout(index, W, H)
                const isActiveChart = draggingSimulationPressureChartId === entry.id || resizingSimulationPressureChartId === entry.id
                return (
                    <div
                        key={entry.id}
                        className="absolute"
                        style={{
                            left: `${layout.x}px`,
                            top: `${layout.y}px`,
                            zIndex: isActiveChart ? 55 : 40 + index,
                            width: `${layout.width}px`,
                            height: `${layout.height}px`,
                        }}
                    >
                        <PressureTrendChart
                            config={entry.config}
                            onClose={() => {
                                if (simulationPressureChartConfigs.length <= 1) {
                                    setSimulationPressureChartOpen(false)
                                } else {
                                    setHiddenSimulationPressureChartIds(prev => ({ ...prev, [entry.id]: true }))
                                }
                            }}
                            onMouseDown={(event) => handleSimulationPressureChartMouseDown(entry.id, event)}
                            isDragging={draggingSimulationPressureChartId === entry.id}
                            width={layout.width}
                            height={layout.height}
                            resizeMode="both"
                            revealProgress={simulationPressureChartRevealProgress[entry.id] ?? 1}
                            onResizeMouseDown={(event) => handleSimulationPressureChartResizeMouseDown(entry.id, event)}
                        />
                    </div>
                )
            })}

            {/* 图层控制面板 - 树形结构 */}
            <div
                className={`absolute z-10 bg-[#0c1218]/90 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.6)] rounded-lg border border-[rgba(45,59,78,0.7)] flex flex-col overflow-hidden ${isDraggingDirectory ? 'cursor-grabbing' : ''}`}
                style={{
                    left: `${directoryPos.x}px`,
                    top: `${directoryPos.y}px`,
                    width: `${directorySize.width}px`,
                    height: `${directorySize.height}px`,
                }}
            >
                {/* 粘性表头 */}
                <div
                    className={`flex justify-between items-center px-4 py-3 bg-[#0c1218]/95 border-b border-gray-700/60 sticky top-0 z-20 shrink-0 ${isDraggingDirectory ? 'cursor-grabbing' : 'cursor-grab'}`}
                    onMouseDown={handleDirectoryMouseDown}
                    title="按住标题栏可拖动管线目录"
                >
                    <h3 className="text-white text-base font-bold flex items-center gap-2">
                        <span className="material-symbols-outlined text-xl">toc</span>
                        管线目录
                    </h3>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => toggleAllLayers(true)}
                            className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 hover:text-white transition-colors"
                            title="显示全部管线"
                        >
                            全选
                        </button>
                        <button
                            onClick={() => toggleAllLayers(false)}
                            className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 hover:text-white transition-colors"
                            title="隐藏全部管线"
                        >
                            全部取消
                        </button>
                        <button
                            onClick={resetDirectoryLayout}
                            className="text-xs px-2 py-1 bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-200 rounded border border-cyan-500/30 hover:text-white transition-colors"
                            title="复原目录位置、大小、排序和按钮状态"
                        >
                            复原
                        </button>

                    </div>
                </div>

                <div
                    className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1"
                    onDragOver={handlePipelineListDragOver}
                    onDrop={handlePipelineDrop}
                >
                    {orderedPipelines.map((pkg, pipelineIndex) => {
                        const layerIds = pkg.layers.map((layer, index) => getPipelineLayerId(pkg, layer, index))
                        const isAllVisible = layerIds.every(id => visibleLayers[id])
                        const isPartialVisible = !isAllVisible && layerIds.some(id => visibleLayers[id])
                        const hasBranches = pkg.layers.length > 1

                        return (
                            <React.Fragment key={pkg.id}>
                            {pipelineDropIndex === pipelineIndex && pipelineDragId !== pkg.id && (
                                <div className="relative mx-1 my-1 h-3">
                                    <div className="absolute left-1 right-1 top-1/2 h-px -translate-y-1/2 bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
                                    <div className="absolute left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-cyan-300 bg-[#0c1218]" />
                                </div>
                            )}
                            <div
                                className={`px-1 rounded-md ${pipelineDragId === pkg.id ? 'opacity-45' : ''}`}
                                data-pipeline-row
                                draggable
                                onDragStart={(e) => handlePipelineDragStart(e, pkg.id)}
                                onDragOver={(e) => handlePipelineDragOver(e, pipelineIndex)}
                                onDrop={handlePipelineDrop}
                                onDragEnd={() => { setPipelineDragId(null); setPipelineDropIndex(null) }}
                                title="按住管线行可上下拖动排序"
                            >
                                {/* 组头部 (管线名) */}
                                <div
                                    className="flex items-center gap-2 hover:bg-white/5 p-1.5 rounded transition-colors select-none cursor-grab active:cursor-grabbing group"
                                    onClick={() => {
                                        if (hasBranches) toggleGroupExpand(pkg.id)
                                        focusPipelinePackage(pkg)
                                    }}
                                >
                                    {/* 展开/收起箭头 */}
                                    <div className="w-5 h-5 flex items-center justify-center shrink-0">
                                        {hasBranches && (
                                            <span className={`material-symbols-outlined text-xl text-gray-400 group-hover:text-white transition-all duration-200 ${expandedGroups[pkg.id] ? 'rotate-90' : ''}`}>
                                                chevron_right
                                            </span>
                                        )}
                                    </div>

                                    {/* 自定义复选框 - 控制整个组 */}
                                    <div
                                        className="relative flex items-center justify-center w-[18px] h-[18px]"
                                        onClick={(e) => { e.stopPropagation(); togglePackageVisibility(pkg); }}
                                    >
                                        <div className={`absolute inset-0 rounded-[4px] border ${isAllVisible || isPartialVisible ? 'border-[#137fec] bg-[#137fec]' : 'border-gray-500 bg-[#1c2430] group-hover:border-gray-400'} transition-colors`}></div>
                                        {isAllVisible && (
                                            <svg className="absolute w-[12px] h-[12px] text-white pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12"></polyline>
                                            </svg>
                                        )}
                                        {isPartialVisible && (
                                            <svg className="absolute w-[10px] h-[10px] text-white pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
                                                <line x1="5" y1="12" x2="19" y2="12"></line>
                                            </svg>
                                        )}
                                    </div>

                                    {/* 文本标签及额外的弹出按钮 */}
                                    <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                        <span className="min-w-0 text-white font-medium text-sm flex items-center gap-2.5">
                                            <span
                                                className="shrink-0 w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]"
                                                style={{ backgroundColor: pkg.color }}
                                            ></span>
                                            <span className="truncate">{pkg.name}</span>
                                        </span>
                                        {renderPipelineActions(pkg)}
                                    </div>
                                </div>

                                {/* 图层列表 (子节点) */}
                                {expandedGroups[pkg.id] && hasBranches && (
                                    <div className="ml-[22px] mt-1 mb-2 space-y-1 pl-4 border-l border-gray-700/60 relative">
                                        {/* 顶部辅助渐变线 */}
                                        <div className="absolute top-0 bottom-0 left-[-1px] w-px bg-gradient-to-b from-gray-700/60 to-transparent"></div>
                                        {pkg.layers.map((layer, layerIndex) => {
                                            const layerId = getPipelineLayerId(pkg, layer, layerIndex)
                                            return (
                                            <div
                                                key={layerId}
                                                className="flex items-center gap-2 p-1.5 hover:bg-white/5 rounded cursor-pointer select-none group/item"
                                                onClick={() => {
                                                    const willShow = !visibleLayers[layerId]
                                                    toggleLayer(layerId)
                                                    if (willShow) focusPipelineLayer(layer)
                                                }}
                                            >
                                                {/* 自定义复选框 - 子图层 */}
                                                <div className="relative flex items-center justify-center w-[16px] h-[16px]">
                                                    <div className={`absolute inset-0 rounded-[3px] border ${visibleLayers[layerId] ? 'border-[#137fec] bg-[#137fec]' : 'border-gray-500 bg-[#1c2430] group-hover/item:border-gray-400'} transition-colors`}></div>
                                                    {visibleLayers[layerId] && (
                                                        <svg className="absolute w-[10px] h-[10px] text-white pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="20 6 9 17 4 12"></polyline>
                                                        </svg>
                                                    )}
                                                </div>
                                                <span
                                                    className={`w-1.5 h-1.5 rounded-full ${layer.type === 'trunk' ? 'opacity-100 shadow-[0_0_4px_rgba(0,0,0,0.5)]' : 'opacity-60'} transition-opacity`}
                                                    style={{ backgroundColor: pkg.color }}
                                                ></span>
                                                <span className={`text-sm transition-colors ${visibleLayers[layerId] ? 'text-gray-200 font-medium' : 'text-gray-400'}`}>
                                                    {layer.type === 'trunk' ? '干线' : layer.name.replace('支线', '')}
                                                </span>
                                            </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                            </React.Fragment>
                        )
                    })}
                    {pipelineDropIndex === orderedPipelines.length && (
                        <div className="relative mx-1 my-1 h-3">
                            <div className="absolute left-1 right-1 top-1/2 h-px -translate-y-1/2 bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
                            <div className="absolute left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-cyan-300 bg-[#0c1218]" />
                        </div>
                    )}
                </div>
                <div
                    data-directory-resize
                    className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize rounded-tl-md border-l border-t border-cyan-400/30 bg-cyan-400/10"
                    onMouseDown={handleDirectoryResizeMouseDown}
                    title="拖动调整管线目录宽高"
                />
            </div>

            {/* ====== 甪直分输站 · 历史回溯面板（试点） ====== */}
            {stationHistoryTarget && (
                <div
                    className="absolute z-20"
                    style={{ left: `${stationHistoryPos.x}px`, top: `${stationHistoryPos.y}px` }}
                >
                    <StationHistoryPanel
                        stationName={stationHistoryTarget.stationName}
                        displayName={stationHistoryTarget.displayName}
                        initialViewMode={stationHistoryTarget.initialViewMode}
                        initialHours={stationHistoryTarget.initialHours}
                        focusHint={stationHistoryTarget.focusHint}
                        onClose={() => setStationHistoryTarget(null)}
                        onMouseDown={handleStationHistoryMouseDown}
                        isDragging={isDraggingStationHistory}
                    />
                </div>
            )}

            {/* ====== 西一线 SCADA 浮动参数表 (支持弹窗新窗口) ====== */}
            {isScadaPoppedOut && (

                <div className="hidden">{/* 主页面隐藏该面板，在 Popup 窗口中渲染 */}</div>
            )}
            {fixedScadaPanels.filter(panel => panel.visible).map(panel => (
                <ScadaFloatingPanel
                    key={panel.id}
                    label={panel.label}
                    accentColor={panel.accentColor}
                    titleColor={panel.titleColor}
                    style={panel.style}
                    topBarGradient={panel.topBarGradient}
                    borderColor={panel.borderColor}
                    headerBorderColor={panel.headerBorderColor}
                    background={panel.background}
                    isDragging={panel.isDragging}
                    onMouseDown={panel.onMouseDown}
                    onClose={panel.onClose}
                >
                    <ScadaTableContent
                        data={panel.data}
                        isPoppedOut={false}
                        closePopOut={panel.closePopOut}
                        popOut={panel.popOut}
                        accentColor={panel.accentColor}
                        onMetricClick={handleMetricClick}
                        onStationHistoryClick={toggleStationHistoryPanel}
                        activeStationHistoryName={stationHistoryTarget?.stationName}
                    />
                </ScadaFloatingPanel>
            ))}

            {/* ====== 所有管线 SCADA 浮动面板（统一循环渲染 + 弹出独立窗口） ====== */}
            {EXTRA_SCADA_PANELS.map((panel, idx) => (
                extraScadaVisible[panel.id] && (
                    <ScadaFloatingPanel
                        key={panel.id}
                        label={panel.label}
                        accentColor={panel.color}
                        titleColor={panel.titleColor}
                        style={{
                            right: `${20 + (idx % 3) * 500}px`,
                            bottom: `${20 + Math.floor(idx / 3) * 340}px`,
                        }}
                        topBarGradient={`linear-gradient(90deg,${panel.color},${panel.color}88,${panel.color})`}
                        borderColor={`${panel.color}33`}
                        headerBorderColor={`${panel.color}22`}
                        background={`linear-gradient(135deg, ${panel.bgFrom} 0%, ${panel.bgTo} 100%)`}
                        onClose={() => toggleExtraScada(panel.id)}
                        actions={
                            <button
                                onClick={() => {
                                    const w = 520
                                    const h = 500
                                    const left = window.screenX + (window.outerWidth - w) / 2
                                    const top = window.screenY + (window.outerHeight - h) / 2
                                    window.open(
                                        `/#/popout/scada?id=${panel.id}`,
                                        `scada-${panel.id}`,
                                        `width=${w},height=${h},left=${left},top=${top}`
                                    )
                                }}
                                className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10"
                                title="弹出独立窗口"
                            >
                                <span className="material-symbols-outlined text-sm">open_in_new</span>
                            </button>
                        }
                    >
                        {Object.keys(panel.data).length > 0 ? (
                            <ScadaTableContent
                                data={panel.data}
                                isPoppedOut={false}
                                closePopOut={noop}
                                popOut={noop}
                                accentColor={panel.color}
                            />
                        ) : (
                            <EmptyScadaState color={panel.color} label={panel.label} />
                        )}
                    </ScadaFloatingPanel>
                )
            ))}

            {/* ====== 通用里程进出站压力图 ====== */}
            {activeTrendChart && (
                <div style={{ left: `${trendPos.x}px`, top: `${trendPos.y}px`, position: 'absolute', zIndex: 20 }}>
                    <PressureTrendChart
                        config={activeTrendChart}
                        onClose={() => setActiveTrendPipelineId(null)}
                        onMouseDown={handleTrendMouseDown}
                        isDragging={isDraggingTrend}
                        width={trendWidth}
                        onResizeMouseDown={handleTrendResizeMouseDown}
                    />
                </div>
            )}

            {/* 图例 */}
            <div className="absolute bottom-6 right-6 z-10 bg-black/70 backdrop-blur-sm rounded-lg px-4 py-3 border border-blue-500/30">
                <div className="space-y-2 text-sm">
                    {pipelines.map(pkg => (
                        <div key={pkg.id} className="flex items-center gap-2">
                            <div className="w-6 h-1 rounded" style={{ backgroundColor: pkg.color }} />
                            <span className="text-white">{pkg.name}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* SCADA 历史曲线浮动面板 — 点击压力/温度值弹出 */}
            {historyTarget && (
                <div
                    className="absolute z-30"
                    style={{ left: historyChartPos.x, top: historyChartPos.y }}
                >
                    <ScadaHistoryChart
                        stationName={historyTarget.stationName}
                        displayName={historyTarget.stationName}
                        metricType={historyTarget.metricType}
                        initialHours={historyTarget.hours}
                        baseValue={historyTarget.baseValue}
                        onClose={() => setHistoryTarget(null)}
                        onMouseDown={handleHistoryMouseDown}
                        isDragging={isDraggingHistory}
                    />
                </div>
            )}

            {selectedMapNode && selectedMapNodeMeta && (
                <div className="absolute top-24 right-6 z-20 w-[340px] bg-[#0c1218]/95 backdrop-blur-md rounded-xl border border-cyan-500/20 shadow-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-cyan-500/20 bg-[#0f1722] flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-white">{selectedMapNode.name}</h3>
                            <p className="text-[11px] text-gray-400 mt-0.5">地图节点详情</p>
                        </div>
                        <button
                            onClick={() => setSelectedMapNode(null)}
                            className="text-gray-400 hover:text-white transition-colors"
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <div className="p-4 space-y-3 text-sm">
                        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-2">
                            <p className="text-xs text-gray-400">类型：<span className="text-gray-200">{selectedMapNodeMeta.rawTypeLabel}</span></p>
                            {selectedMapNodeMeta.junctionKindLabel && (
                                <p className="text-xs text-gray-400">枢纽等级：<span className="text-gray-200">{selectedMapNodeMeta.junctionKindLabel}</span></p>
                            )}
                            <p className="text-xs text-gray-400">图层：<span className="text-gray-200">{selectedMapNodeMeta.layerName}</span></p>
                            <p className="text-xs text-gray-400">系统：<span className="text-gray-200">{selectedMapNodeMeta.systemId}</span></p>
                            <p className="text-xs text-gray-400">
                                坐标：<span className="text-gray-200">{selectedMapNode.coordinate.longitude.toFixed(4)}, {selectedMapNode.coordinate.latitude.toFixed(4)}</span>
                            </p>
                        </div>

                        <div className="space-y-2">
                            <button
                                onClick={() => {
                                    if (mapInstance) {
                                        mapInstance.setZoomAndCenter(13, [selectedMapNode.coordinate.longitude, selectedMapNode.coordinate.latitude])
                                    }
                                }}
                                className="w-full bg-gray-800 hover:bg-gray-700 text-gray-200 py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                            >
                                <span className="material-symbols-outlined text-sm">my_location</span>地图定位
                            </button>
                            {getEmbeddedHistoryStationName(selectedMapNode.name) && (
                                <button
                                    onClick={() => toggleStationHistoryPanel(getEmbeddedHistoryStationName(selectedMapNode.name)!)}
                                    className="w-full bg-cyan-500/10 hover:bg-cyan-500/18 text-cyan-100 border border-cyan-400/25 py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                                >
                                    <span className="material-symbols-outlined text-sm">history</span>
                                    打开{getEmbeddedHistoryStationName(selectedMapNode.name)}历史
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// 可点击单元格样式
const clickableCellStyle: React.CSSProperties = { cursor: 'pointer', borderRadius: '4px', transition: 'background 0.15s, box-shadow 0.15s' }

// 抽取 SCADA 内容渲染部分，供复用
const ScadaTableContent: React.FC<{
    data: Record<string, ScadaRecord>
    isPoppedOut: boolean
    closePopOut: () => void
    popOut: (w: number, h: number) => void
    accentColor?: string
    onStationClick?: (stationName: string) => void
    onMetricClick?: (stationName: string, metricType: 'pressure' | 'temperature', baseValue: number) => void
    onStationHistoryClick?: (stationName: string) => void
    activeStationHistoryName?: string
}> = ({ data, isPoppedOut, closePopOut, accentColor = '#10b981', onStationClick, onMetricClick, onStationHistoryClick, activeStationHistoryName }) => {
    const inPressureColor = accentColor === '#10b981' ? '#34d399'
        : accentColor === '#3b82f6' ? '#60a5fa'
        : accentColor === '#f59e0b' ? '#fcd34d'
        : accentColor === '#ec4899' ? '#f9a8d4'
        : accentColor === '#a855f7' ? '#d8b4fe'
        : '#a3e635'

    const isLowPressure = (p: number) => p < 5.0
    const isHighPressure = (p: number) => p > 10.5
    const getPressureColor = (p: number, baseColor: string) => {
        if (isLowPressure(p)) return '#f97316'
        if (isHighPressure(p)) return '#ef4444'
        return baseColor
    }

    const rowBgAccent = accentColor.replace('#', '')
    function hexToRgb(hex: string) {
        const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16)
        return `${r},${g},${b}`
    }
    const rgb = hexToRgb(rowBgAccent)

    // 可点击单元格悬停效果
    const handleCellHover = (e: React.MouseEvent<HTMLTableCellElement>, entering: boolean) => {
        if (!onMetricClick) return
        const el = e.currentTarget
        if (entering) {
            el.style.background = 'rgba(255,255,255,0.08)'
            el.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.15)'
        } else {
            el.style.background = ''
            el.style.boxShadow = ''
        }
    }

    return (
        <div className={`flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar ${isPoppedOut ? 'h-full w-full p-4 text-white' : 'p-2'}`}
            style={{ scrollbarWidth: 'thin', scrollbarColor: `${accentColor}40 transparent` }}
        >
            {isPoppedOut && (
                <div className="pb-3 mb-3 border-b border-white/10 flex justify-between items-center">
                    <h3 className="m-0 text-sm font-bold flex items-center gap-1.5 text-slate-200">
                        <span className="material-symbols-outlined text-lg" style={{ color: accentColor }}>sensors</span>
                        SCADA 实时监控参数
                    </h3>
                    <button onClick={closePopOut} className="text-gray-400 hover:text-white transition-colors" title="恢复回主窗口">
                        <span className="material-symbols-outlined text-sm">open_in_browser</span>
                    </button>
                </div>
            )}
            {onMetricClick && (
                <div style={{ fontSize: '10px', color: '#475569', padding: '2px 6px', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>touch_app</span>
                    <span>点击压力/温度值查看历史回溯曲线</span>
                </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 3px', fontSize: '12px' }}>
                <thead>
                    <tr style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        <th style={{ padding: '2px 6px', textAlign: 'left', fontWeight: 600 }}>站名</th>
                        <th style={{ padding: '2px 6px', textAlign: 'center', fontWeight: 600 }}>类型</th>
                        <th style={{ padding: '2px 8px', textAlign: 'right', fontWeight: 600 }}>进站压力</th>
                        <th style={{ padding: '2px 4px', textAlign: 'center', fontWeight: 600 }}>进温</th>
                        <th style={{ padding: '2px 8px', textAlign: 'right', fontWeight: 600 }}>出站压力</th>
                        <th style={{ padding: '2px 4px', textAlign: 'center', fontWeight: 600 }}>出温</th>
                    </tr>
                </thead>
                <tbody>
                    {(Object.entries(data) as [string, ScadaRecord][]).map(([name, d]) => {
                        const isCompressor = d.type === 'compressor'
                        const rowBg = isCompressor ? `rgba(${rgb},0.08)` : 'rgba(255,255,255,0.02)'
                        const nameBold = isCompressor
                        const typeLabel = d.type === 'compressor' ? '压' : d.type === 'distribution' ? '分' : '阀'
                        const typeBg = d.type === 'compressor' ? `rgba(${rgb},0.22)` : 'rgba(100,116,139,0.2)'
                        const typeColor = d.type === 'compressor' ? accentColor : '#94a3b8'
                        const historyStationName = name.includes('中卫') ? '中卫压气站' : name.includes('甪直') ? '甪直分输站' : ''
                        const hasEmbeddedHistory = Boolean(historyStationName)
                        const isHistoryActive = activeStationHistoryName === historyStationName
                        const historyAccent = historyStationName === '中卫压气站' ? '#facc15' : '#38bdf8'

                        return (
                            <tr key={name} style={{ background: rowBg, borderRadius: '6px', transition: 'background 0.15s' }}
                                onMouseEnter={e => (e.currentTarget.style.background = `rgba(${rgb},0.14)`)}
                                onMouseLeave={e => (e.currentTarget.style.background = rowBg)}>
                                <td style={{ padding: '5px 6px', borderRadius: '6px 0 0 6px', fontWeight: nameBold ? 600 : 400, color: '#e2e8f0', maxWidth: '150px' }} title={name}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                                        {onStationHistoryClick && hasEmbeddedHistory && (
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    onStationHistoryClick(historyStationName)
                                                }}
                                                title={`打开${historyStationName}历史回溯面板`}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 2,
                                                    padding: '1px 5px',
                                                    borderRadius: 999,
                                                    border: `1px solid ${isHistoryActive ? historyAccent : `${historyAccent}55`}`,
                                                    background: isHistoryActive ? `${historyAccent}2e` : `${historyAccent}14`,
                                                    color: isHistoryActive ? '#fff' : historyAccent,
                                                    fontSize: 10,
                                                    fontWeight: 800,
                                                    cursor: 'pointer',
                                                    whiteSpace: 'nowrap',
                                                    flexShrink: 0,
                                                }}
                                            >
                                                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>history</span>
                                                历史
                                            </button>
                                        )}
                                    </span>
                                </td>
                                <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                                    <span style={{ fontSize: '10px', background: typeBg, color: typeColor, padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>{typeLabel}</span>
                                </td>
                                <td style={{ ...clickableCellStyle, padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: getPressureColor(d.inP, inPressureColor), fontWeight: 600 }}
                                    title={onMetricClick ? `${name} 进站压力 ${d.inP.toFixed(3)} MPa，点击查看曲线` : undefined}
                                    onClick={() => onMetricClick?.(name, 'pressure', d.inP)}
                                    onMouseEnter={e => handleCellHover(e, true)} onMouseLeave={e => handleCellHover(e, false)}>
                                    {d.inP.toFixed(3)}
                                </td>
                                <td style={{ ...clickableCellStyle, padding: '5px 4px', textAlign: 'center', color: '#f97316', fontSize: '11px' }}
                                    title={onMetricClick && d.inT != null ? `${name} 进站温度 ${d.inT}°C，点击查看曲线` : undefined}
                                    onClick={() => d.inT != null && onMetricClick?.(name, 'temperature', d.inT)}
                                    onMouseEnter={e => d.inT != null && handleCellHover(e, true)} onMouseLeave={e => handleCellHover(e, false)}>
                                    {d.inT != null ? `${d.inT}°` : '—'}
                                </td>
                                <td style={{ ...clickableCellStyle, padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: getPressureColor(d.outP, accentColor), fontWeight: 600 }}
                                    title={onMetricClick ? `${name} 出站压力 ${d.outP.toFixed(3)} MPa，点击查看曲线` : undefined}
                                    onClick={() => onMetricClick?.(name, 'pressure', d.outP)}
                                    onMouseEnter={e => handleCellHover(e, true)} onMouseLeave={e => handleCellHover(e, false)}>
                                    {d.outP.toFixed(3)}
                                </td>
                                <td style={{ ...clickableCellStyle, padding: '5px 4px', textAlign: 'center', color: '#fb923c', fontSize: '11px', borderRadius: '0 6px 6px 0' }}
                                    title={onMetricClick && d.outT != null ? `${name} 出站温度 ${d.outT}°C，点击查看曲线` : undefined}
                                    onClick={() => d.outT != null && onMetricClick?.(name, 'temperature', d.outT)}
                                    onMouseEnter={e => d.outT != null && handleCellHover(e, true)} onMouseLeave={e => handleCellHover(e, false)}>
                                    {d.outT != null ? `${d.outT}°` : '—'}
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}

// 供独立路由使用的通用 SCADA 弹窗组件
// 通过 URL 参数 ?id=xxx 动态加载对应管线的 SCADA 数据
export const ScadaStandalone: React.FC = () => {
    // 从 URL 获取管线 ID
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    const pipelineId = params.get('id') || 'we1'
    const config = SCADA_DATA_MAP[pipelineId] || SCADA_DATA_MAP['we1']

    // 专用 Hook 负责防白屏和发送心跳
    usePopoutSync(`scada-${pipelineId}`);

    // 设置窗口标题
    React.useEffect(() => {
        document.title = `${config.label} - SCADA 实时参数`
    }, [config.label])

    return (
        <div className="h-screen w-screen bg-[#0c1218] flex flex-col">
            {/* 独立窗口标题栏 */}
            <div className="px-4 py-3 flex justify-between items-center shrink-0" style={{ borderBottom: `1px solid ${config.color}33`, background: 'rgba(12,18,24,0.95)' }}>
                <h2 className="m-0 text-base font-bold flex items-center gap-2" style={{ color: config.color }}>
                    <span className="material-symbols-outlined text-xl">sensors</span>
                    <span>{config.label}</span>
                    <span style={{ color: config.color, fontSize: '10px', fontWeight: 'normal', background: `${config.color}22`, padding: '2px 8px', borderRadius: '9999px', border: `1px solid ${config.color}44` }}>SCADA 实时</span>
                </h2>
                <button onClick={() => window.close()} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                    <span className="material-symbols-outlined">close</span>
                </button>
            </div>
            {Object.keys(config.data).length > 0 ? (
                <ScadaTableContent data={config.data} isPoppedOut={true} closePopOut={() => window.close()} popOut={() => {}} accentColor={config.color} />
            ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                        <span className="material-symbols-outlined text-5xl block mb-3" style={{ color: `${config.color}66` }}>database</span>
                        <p className="text-lg">暂无 SCADA 数据</p>
                        <p className="text-sm text-gray-600 mt-2">待导入 {config.label} 实际运行参数</p>
                    </div>
                </div>
            )}
        </div>
    )
}

export default GlobalPipelineView
