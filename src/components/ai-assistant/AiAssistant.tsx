import React, { useCallback, useEffect, useRef, useState } from 'react'
import './ai-assistant.css'
import { useNewWindow, usePopoutSync } from '../../hooks/useNewWindow'
import { stripPrivateThinkBlocks, useAiAssistantChat } from './useAiAssistantChat'
import type { ChatMessage, HandleSendOptions } from './useAiAssistantChat'
import { DEFAULT_ZHONGWEI_MULTI_SCENARIO_IDS } from '@/config/simulationScenarios'

const AI_ASSISTANT_SYNC_CHANNEL = 'ai-assistant-sync'

const TOOL_LABELS: Record<string, string> = {
    query_stations: '获取站场详情',
    query_pipelines: '检索管线主干数据',
    count_by_type: '分类全网基础设施',
    analyze_impact: '演算故障波及范围',
    find_routes: '搜寻拓扑备用路径',
    get_topology_summary: '计算全网管存拓扑',
    simulate_failure: '推演沿线断流影响',
    compare_stations: '并发抓取历史记录并执行指标横向对比分析',
    'multi-scenario-ai': '调用 multi-scenario-ai skill',
    'networkx-cutoff-showcase': '调用 NetworkX 截断演示',
    'mcp.run_steady_sim': '调用 MCP 稳态仿真工具',
    'multi-source-query': '调用三库并行查询',
    search_knowledge_base: '检索操作规程/应急预案',
}

interface PromptExample {
    label: string
    prompt: string
    icon: string
    group?: string
}

interface SlashSkill {
    id: string
    label: string
    description: string
    prompt: string
    icon: string
    keywords: string[]
}

const EXAMPLE_QUESTIONS: PromptExample[] = [
    { group: '管网基础', label: '统计压气站数量', prompt: '管网里有多少个压气站？请按类型给出统计口径。', icon: 'pin_drop' },
    { group: '管网基础', label: '列出干线管线', prompt: '列出所有干线管线，并说明每条管线的起终点和关键站场。', icon: 'route' },
    { group: '管网基础', label: '全网概况', prompt: '请用汇报口径总结管网整体概况，包括站场、管线、管线组和重点节点。', icon: 'public' },
    { group: 'AI分析', label: '三库查中卫', prompt: '/三库查询 中卫压气站最近压力为什么偏低？结合时序、拓扑资料和规程依据给结论。', icon: 'database_search' },
    { group: 'RAG检索', label: '搜RAG原文', prompt: '/RAG检索 西气东输一线压气站出站超压保护定值', icon: 'manage_search' },
    { group: '规程查询', label: '中卫放空规程', prompt: '/规程查询 中卫压气站放空操作步骤和风险点', icon: 'plumbing' },
    { group: '规程查询', label: '超压保护定值', prompt: '/规程查询 西气东输一线压气站出站超压保护定值依据是什么？', icon: 'shield' },
    { group: '拓扑演示', label: '中卫截断推演', prompt: '演示中卫压气站截断推演，显示一连串操作，最后给分析。', icon: 'content_cut' },
    { group: '拓扑演示', label: '靖边NetworkX截断', prompt: '在全国一张网里演示靖边 NetworkX 原生截断推演，显示截断点、受影响路径、绕行范围和分析结论。', icon: 'account_tree' },
]

const DATA_ANALYSIS_EXAMPLES: PromptExample[] = [
    { label: '进入数据分析', prompt: '/数据分析', icon: 'login' },
    { label: '甪直单站露点', prompt: '甪直水露点，按结论、关键异常点、调度建议输出。', icon: 'water_drop' },
    { label: '中卫单站露点', prompt: '中卫水露点，按结论、关键异常点、调度建议输出。', icon: 'water_drop' },
    { label: '甪直风险分析', prompt: '甪直站风险分析', icon: 'health_and_safety' },
    { label: '甪直压力温度', prompt: '甪直站压力和温度情况，给出计算过程、风险等级和调度建议。', icon: 'device_thermostat' },
    { label: '中卫风险分析', prompt: '中卫站风险分析', icon: 'health_and_safety' },
    { label: '中卫压力分析', prompt: '中卫压气站12小时压力情况，给出计算过程、风险等级和历史曲线入口。', icon: 'speed' },
    { label: '双站露点对比', prompt: '甪直站和中卫站水露点对比，指出哪个站更需要关注。', icon: 'compare_arrows' },
    { label: '按汇报口径总结', prompt: '把刚才的数据分析结果整理成导师汇报能用的一段话。', icon: 'summarize' },
]

const SUBAGENT_EXAMPLES: PromptExample[] = [
    { label: '进入 SubAgent', prompt: '/subagent', icon: 'login' },
    { label: '中卫-靖边限流', prompt: '帮我用subagent分析中卫到靖边限流场景，并自动开启仿真推演演示。要求展示每个Agent过程，最后按结论、依据、影响、建议、待复核项、边界说明输出。', icon: 'science' },
    { label: '中卫单站风险', prompt: '帮我用subagent分析中卫压气站当前是否存在风险，结合历史曲线、拓扑关系、仿真场景和风险复核输出。', icon: 'fact_check' },
    { label: '甪直露点趋势', prompt: '用subagent分析甪直分输站最近水露点和压力趋势，判断是否存在异常，并说明数据来源和建议动作。', icon: 'water_drop' },
    { label: '中卫-白鹤全段', prompt: '用subagent分析中卫压气站到上海白鹤末站主干段的拓扑影响范围，说明关键压气站、分输站和下游关注点。', icon: 'account_tree' },
]

const SLASH_SKILLS: SlashSkill[] = [
    {
        id: 'rag-search',
        label: 'RAG原文检索',
        description: '直接搜索 RAG 库，返回命中文档、chunk 和摘要。',
        prompt: '/RAG检索 ',
        icon: 'manage_search',
        keywords: ['rag', 'RAG', '向量', '知识库', '原文', 'chunk'],
    },
    {
        id: 'procedure-search',
        label: '规程查询',
        description: '强制检索操作规程、运行规程和应急预案。',
        prompt: '/规程查询 ',
        icon: 'menu_book',
        keywords: ['规程', '操作', '预案', '定值', '超压', '放空'],
    },
    {
        id: 'multi-source',
        label: '三库并行查询',
        description: 'AI 自动并行查业务库、时序库和规程/资料库，合并证据链。',
        prompt: '/三库查询 ',
        icon: 'database_search',
        keywords: ['三库', '多库', '跨库', '证据', '验证', '查询'],
    },
    {
        id: 'multi-scenario-ai',
        label: '多工况AI Skill',
        description: '先选择工况，再在全国一张网执行比对。',
        prompt: '/多工况AI',
        icon: 'checklist',
        keywords: ['多工况', '仿真', 'ai', 'simulation', 'multi'],
    },
    {
        id: 'data-analysis',
        label: '数据分析 Skill',
        description: '进入站场水露点、压力、温度分析与双站对比模式。',
        prompt: '/数据分析',
        icon: 'analytics',
        keywords: ['数据', '分析', '露点', '压力', '温度', 'luzhi'],
    },
    {
        id: 'subagent',
        label: 'SubAgent 专家组',
        description: '进入多代理拆解、实施、验证和表达复核模式。',
        prompt: '/subagent',
        icon: 'hub',
        keywords: ['subagent', '代理', '方案', '验证', '表达复核'],
    },
    {
        id: 'mcp-demo',
        label: 'MCP仿真 Demo',
        description: '通过已注册 MCP 工具跑一次稳态仿真。',
        prompt: '/mcp演示',
        icon: 'electrical_services',
        keywords: ['mcp', '演示', '工具', '仿真'],
    },
]

function useDrag(initialPos: { x: number; y: number }) {
    const [, setRenderTick] = useState(0)
    const posRef = useRef(initialPos)
    const isDraggingRef = useRef(false)
    const [isDragging, setIsDragging] = useState(false)
    const dragOffset = useRef({ x: 0, y: 0 })

    const handleMouseDown = useCallback((event: React.MouseEvent) => {
        isDraggingRef.current = true
        setIsDragging(true)
        dragOffset.current = {
            x: event.clientX - posRef.current.x,
            y: event.clientY - posRef.current.y,
        }
        event.preventDefault()
        event.stopPropagation()

        document.body.classList.add('ai-dragging-active')

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!isDraggingRef.current) return
            moveEvent.preventDefault()
            const newX = moveEvent.clientX - dragOffset.current.x
            const newY = moveEvent.clientY - dragOffset.current.y
            posRef.current = {
                x: Math.max(0, Math.min(newX, window.innerWidth - 100)),
                y: Math.max(0, Math.min(newY, window.innerHeight - 100)),
            }
            setRenderTick((tick) => tick + 1)
        }

        const handleMouseUp = () => {
            isDraggingRef.current = false
            setIsDragging(false)
            document.body.classList.remove('ai-dragging-active')
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
    }, [])

    return { position: posRef.current, isDragging, handleMouseDown }
}

const WelcomeScreen: React.FC<{
    onExampleClick: (question: string) => void
    dataAnalysisMode: boolean
    subagentMode: boolean
}> = ({ onExampleClick, dataAnalysisMode, subagentMode }) => {
    const examples = dataAnalysisMode ? DATA_ANALYSIS_EXAMPLES : (subagentMode ? SUBAGENT_EXAMPLES : EXAMPLE_QUESTIONS)
    const groupedExamples = examples.reduce<Array<{ group: string | null; items: PromptExample[] }>>((groups, example) => {
        const groupName = example.group || null
        const lastGroup = groups[groups.length - 1]
        if (lastGroup && lastGroup.group === groupName) {
            lastGroup.items.push(example)
        } else {
            groups.push({ group: groupName, items: [example] })
        }
        return groups
    }, [])

    return (
        <div className="ai-welcome">
            <div className="ai-welcome-icon">
                <span className="material-symbols-outlined" style={{ fontSize: 26, color: '#60a5fa' }}>
                    smart_toy
                </span>
            </div>
            <h3>你好，我是管网 AI 助手</h3>
            <p>你可以直接问业务，也可以输入 / 打开 Skill 菜单。</p>
            <div className="ai-welcome-divider" />
            <span className="ai-welcome-label">可用提示词</span>
            <div className="ai-welcome-examples">
                {groupedExamples.map((group, groupIndex) => (
                    <div className="ai-prompt-group" key={`${group.group || 'default'}-${groupIndex}`}>
                        {group.group && <div className="ai-prompt-group-title">{group.group}</div>}
                        {group.items.map((example) => (
                            <button key={example.prompt} onClick={() => onExampleClick(example.prompt)}>
                                <span className="material-symbols-outlined example-icon">{example.icon}</span>
                                <span className="ai-prompt-text">
                                    <span className="ai-prompt-title">{example.label}</span>
                                    <span className="ai-prompt-preview">{example.prompt}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    )
}

interface TableBlock {
    headers: string[]
    rows: string[][]
}

type SubagentStatus = 'queued' | 'running' | 'completed' | 'warning' | 'error'

interface SubagentReview {
    from_agent?: string
    to_agent?: string
    result?: string
    message?: string
}

interface SubagentCorrection {
    target?: string
    before?: string
    after?: string
    status?: string
}

interface SubagentBlock {
    agent?: string
    title?: string
    icon?: string
    status?: SubagentStatus
    tool?: string
    message?: string
    steps?: string[]
    evidence?: string[]
    claims?: string[]
    reviews?: SubagentReview[]
    corrections?: SubagentCorrection[]
    shared_board?: string[]
    action?: string
}

interface MultiScenarioSelectorCase {
    id: string
    label: string
    description: string
    selected?: boolean
}

interface MultiScenarioSelectorBlock {
    title?: string
    hint?: string
    cases: MultiScenarioSelectorCase[]
}

type AssistantActionType = 'OPEN_LUZHI_HISTORY' | 'OPEN_HISTORY_PANEL' | 'LOCATE_STATION' | 'START_MULTI_SCENARIO_AI' | 'SUBAGENT_STEP'

interface AssistantActionPayload {
    type: AssistantActionType
    station?: string
    view?: 'pressure' | 'temperature' | 'dewpoint' | 'overview'
    hours?: number
    timeStart?: string
    timeEnd?: string
    metric?: string
    selectedScenarioIds?: string[]
    auto?: boolean
    step?: string
    status?: string
    title?: string
    message?: string
}

interface AssistantSendMessagePayload {
    message: string
    autoOpen?: boolean
}

function parseAssistantActionToken(block: string): AssistantActionPayload | null {
    const normalized = block.trim()
    const match = normalized.match(/\[ACTION:([A-Z_]+)\|([^\]]+)\]/)
    if (!match) return null

    const actionType = match[1] as AssistantActionType
    if (
        actionType !== 'OPEN_LUZHI_HISTORY'
        && actionType !== 'OPEN_HISTORY_PANEL'
        && actionType !== 'LOCATE_STATION'
        && actionType !== 'START_MULTI_SCENARIO_AI'
        && actionType !== 'SUBAGENT_STEP'
    ) return null

    const rawPairs = match[2].split('|')
    const map = new Map<string, string>()
    rawPairs.forEach((pair) => {
        const idx = pair.indexOf('=')
        if (idx <= 0) return
        const key = pair.slice(0, idx).trim()
        const value = pair.slice(idx + 1).trim()
        if (key) map.set(key, value)
    })

    const hoursRaw = Number(map.get('hours') || '0')
    const viewRaw = (map.get('view') || 'pressure') as AssistantActionPayload['view']
    const allowedView = viewRaw === 'temperature' || viewRaw === 'dewpoint' || viewRaw === 'overview' ? viewRaw : 'pressure'
    const selectedScenarioIds = (map.get('scenario_ids') || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)

    return {
        type: actionType,
        station: map.get('station') || undefined,
        view: allowedView,
        hours: Number.isFinite(hoursRaw) ? hoursRaw : undefined,
        timeStart: map.get('time_start') || undefined,
        timeEnd: map.get('time_end') || undefined,
        metric: map.get('metric') || undefined,
        selectedScenarioIds: selectedScenarioIds.length > 0 ? selectedScenarioIds : undefined,
        auto: map.get('auto') === '1' || map.get('auto') === 'true',
        step: map.get('step') || undefined,
        status: map.get('status') || undefined,
        title: map.get('title') || undefined,
        message: map.get('message') || undefined,
    }
}

function extractAssistantActions(content: string): AssistantActionPayload[] {
    const tokens = content.match(/\[ACTION:[A-Z_]+\|[^\]]+\]/g) || []
    return tokens
        .map(parseAssistantActionToken)
        .filter((item): item is AssistantActionPayload => Boolean(item))
}

function emitAssistantAction(action: AssistantActionPayload): void {
    if (action.type === 'SUBAGENT_STEP') {
        const detail = {
            step: action.step,
            status: action.status,
            title: action.title,
            message: action.message,
        }
        window.dispatchEvent(new CustomEvent('assistant-subagent-demo-step', { detail }))
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'assistant-subagent-demo-step', detail }, '*')
        }
        try {
            const channel = new BroadcastChannel(AI_ASSISTANT_SYNC_CHANNEL)
            channel.postMessage({ type: 'assistant-subagent-demo-step', detail })
            channel.close()
        } catch {
            // BroadcastChannel is a convenience path for popped-out assistant windows.
        }
        return
    }

    if (action.type === 'START_MULTI_SCENARIO_AI') {
        const detail = {
            skillName: 'multi-scenario-ai',
            selectedScenarioIds: action.selectedScenarioIds || DEFAULT_ZHONGWEI_MULTI_SCENARIO_IDS,
            message: 'SubAgent 已触发中卫三工况仿真自动演示。',
        }
        window.dispatchEvent(new CustomEvent('assistant-start-multi-scenario-ai', { detail }))
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'assistant-start-multi-scenario-ai', detail }, '*')
        }
        try {
            const channel = new BroadcastChannel(AI_ASSISTANT_SYNC_CHANNEL)
            channel.postMessage({ type: 'assistant-start-multi-scenario-ai', detail })
            channel.close()
        } catch {
            // BroadcastChannel is a convenience path for popped-out assistant windows.
        }
        return
    }

    if (action.type === 'LOCATE_STATION') {
        window.dispatchEvent(new CustomEvent('assistant-locate-station', { detail: action }))
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage(
                {
                    type: 'assistant-locate-station',
                    detail: action,
                },
                '*',
            )
        }
        return
    }

    if (action.type === 'OPEN_LUZHI_HISTORY' || action.type === 'OPEN_HISTORY_PANEL') {
        window.dispatchEvent(new CustomEvent('assistant-open-history', { detail: action }))
        if (action.type === 'OPEN_LUZHI_HISTORY') {
            window.dispatchEvent(new CustomEvent('assistant-open-luzhi-history', { detail: action }))
        }
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage(
                {
                    type: 'assistant-open-history',
                    detail: action,
                },
                '*',
            )
            if (action.type === 'OPEN_LUZHI_HISTORY') {
                window.opener.postMessage(
                    {
                        type: 'assistant-open-luzhi-history',
                        detail: action,
                    },
                    '*',
                )
            }
        }
    }
}

function normalizeStructuredAssistantBlock(block: string): string {
    const normalized = block.trim()
    if (!normalized) return normalized

    if (
        (normalized.startsWith('"') && normalized.endsWith('"'))
        || (normalized.startsWith("'") && normalized.endsWith("'"))
    ) {
        try {
            const parsed = JSON.parse(normalized)
            if (typeof parsed === 'string') {
                return parsed.trim()
            }
        } catch {
            return normalized
        }
    }

    return normalized
}

function parseStructuredJsonPayload<T>(payload: string): T | null {
    const attempts: string[] = [payload]
    let unescaped = payload
    for (let index = 0; index < 3; index += 1) {
        unescaped = unescaped.replace(/\\\\/g, '\\').replace(/\\"/g, '"')
        if (!attempts.includes(unescaped)) {
            attempts.push(unescaped)
        }
    }

    for (const attempt of attempts) {
        try {
            const parsed = JSON.parse(attempt)
            if (typeof parsed === 'string') {
                return JSON.parse(parsed) as T
            }
            return parsed as T
        } catch {
            // Try the next normalization form.
        }
    }
    return null
}

function parseSubagentBlock(block: string): SubagentBlock | null {
    const normalized = normalizeStructuredAssistantBlock(block)
    const start = normalized.indexOf('[SUBAGENT:')
    if (start < 0) return null
    const candidate = normalized.slice(start)
    const end = candidate.lastIndexOf(']')
    if (end < 0) return null
    const payloadText = candidate.slice('[SUBAGENT:'.length, end)
    const parsed = parseStructuredJsonPayload<SubagentBlock>(payloadText)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
}

function parseMultiScenarioSelectorBlock(block: string): MultiScenarioSelectorBlock | null {
    const normalized = normalizeStructuredAssistantBlock(block)
    const start = normalized.indexOf('[MULTI_SCENARIO_SELECTOR:')
    if (start < 0) return null
    const candidate = normalized.slice(start)
    const end = candidate.lastIndexOf(']')
    if (end < 0) return null
    const payloadText = candidate.slice('[MULTI_SCENARIO_SELECTOR:'.length, end)

    const parsed = parseStructuredJsonPayload<MultiScenarioSelectorBlock>(payloadText)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cases)) return null
    const validCases = parsed.cases.filter((item) =>
        item
        && typeof item.id === 'string'
        && typeof item.label === 'string'
        && typeof item.description === 'string',
    )
    if (validCases.length === 0) return null
    return {
        ...parsed,
        cases: validCases,
    }
}

function dedupeSubagentBlocks(blocks: string[]): string[] {
    const lastIndexByKey = new Map<string, number>()
    blocks.forEach((block, index) => {
        const subagentBlock = parseSubagentBlock(block)
        if (!subagentBlock) return
        const key = String(subagentBlock.agent || subagentBlock.title || '').trim()
        if (!key) return
        lastIndexByKey.set(key, index)
    })

    return blocks.filter((block, index) => {
        const subagentBlock = parseSubagentBlock(block)
        if (!subagentBlock) return true
        const key = String(subagentBlock.agent || subagentBlock.title || '').trim()
        if (!key) return true
        return lastIndexByKey.get(key) === index
    })
}

function getDefaultSelectorCaseIds(cases: MultiScenarioSelectorCase[]): string[] {
    return cases
        .filter((item) => item.selected !== false)
        .map((item) => item.id)
}

const MultiScenarioSelectorCard: React.FC<{
    block: MultiScenarioSelectorBlock
    onStart: (selectedScenarioIds: string[]) => void
}> = ({ block, onStart }) => {
    const defaultSelectedKey = block.cases
        .map((item) => `${item.id}:${item.selected === false ? '0' : '1'}`)
        .join('|')
    const [selectedIds, setSelectedIds] = useState<string[]>(() => getDefaultSelectorCaseIds(block.cases))

    useEffect(() => {
        setSelectedIds(getDefaultSelectorCaseIds(block.cases))
    }, [defaultSelectedKey])

    const toggleCase = (caseId: string) => {
        setSelectedIds((prev) => (
            prev.includes(caseId)
                ? prev.filter((item) => item !== caseId)
                : [...prev, caseId]
        ))
    }

    const orderedSelectedIds = block.cases
        .filter((item) => selectedIds.includes(item.id))
        .map((item) => item.id)

    return (
        <div className="ai-multi-selector-card">
            <div className="ai-multi-selector-head">
                <div className="ai-multi-selector-title">
                    <span className="material-symbols-outlined">checklist</span>
                    {block.title || '多工况AI Skill'}
                </div>
                <div className="ai-multi-selector-count">已选 {orderedSelectedIds.length} 个工况</div>
            </div>
            {block.hint && <div className="ai-multi-selector-hint">{block.hint}</div>}
            <div className="ai-multi-selector-list">
                {block.cases.map((item) => {
                    const checked = selectedIds.includes(item.id)
                    return (
                        <label className={`ai-multi-selector-item ${checked ? 'checked' : ''}`} key={item.id}>
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCase(item.id)}
                            />
                            <span className="ai-multi-selector-copy">
                                <span className="ai-multi-selector-label">{item.label}</span>
                                <span className="ai-multi-selector-desc">{item.description}</span>
                            </span>
                        </label>
                    )
                })}
            </div>
            <div className="ai-multi-selector-actions">
                <button
                    type="button"
                    className="secondary"
                    onClick={() => setSelectedIds(getDefaultSelectorCaseIds(block.cases))}
                >
                    重新选择
                </button>
                <button
                    type="button"
                    className="primary"
                    disabled={orderedSelectedIds.length === 0}
                    onClick={() => onStart(orderedSelectedIds)}
                >
                    开始仿真比对
                </button>
            </div>
        </div>
    )
}

const AutoAssistantAction: React.FC<{
    action: AssistantActionPayload
    onAction: (payload: AssistantActionPayload) => void
}> = ({ action, onAction }) => {
    const firedRef = useRef(false)

    useEffect(() => {
        if (firedRef.current) return
        firedRef.current = true
        onAction(action)
    }, [action, onAction])

    return null
}

function getSubagentStatusLabel(status?: SubagentStatus): string {
    switch (status) {
        case 'running':
            return '分析中'
        case 'completed':
            return '已完成'
        case 'warning':
            return '需复核'
        case 'error':
            return '异常'
        case 'queued':
        default:
            return '等待中'
    }
}

const SubagentProcessCard: React.FC<{ block: SubagentBlock }> = ({ block }) => {
    const status = block.status || 'queued'
    return (
        <div className={`ai-subagent-card ${status}`}>
            <div className="ai-subagent-head">
                <div className="ai-subagent-icon">
                    <span className="material-symbols-outlined">{block.icon || 'hub'}</span>
                </div>
                <div className="ai-subagent-title-wrap">
                    <div className="ai-subagent-title">{block.title || block.agent || 'SubAgent'}</div>
                    {block.tool && <div className="ai-subagent-tool">{block.tool}</div>}
                </div>
                <div className={`ai-subagent-status ${status}`}>
                    {status === 'running' && <span className="material-symbols-outlined">sync</span>}
                    {status === 'completed' && <span className="material-symbols-outlined">check_circle</span>}
                    {status === 'warning' && <span className="material-symbols-outlined">report</span>}
                    {status === 'error' && <span className="material-symbols-outlined">error</span>}
                    <span>{getSubagentStatusLabel(status)}</span>
                </div>
            </div>

            {block.action && (
                <div className="ai-subagent-action">
                    <span className="material-symbols-outlined">bolt</span>
                    {block.action}
                </div>
            )}

            {block.steps && block.steps.length > 0 && (
                <div className="ai-subagent-steps">
                    {block.steps.map((step, index) => (
                        <div key={`${step}-${index}`} className="ai-subagent-step">
                            <span>{index + 1}</span>
                            {step}
                        </div>
                    ))}
                </div>
            )}

            {block.message && <div className="ai-subagent-message">{block.message}</div>}

            {((block.claims && block.claims.length > 0) || (block.reviews && block.reviews.length > 0) || (block.corrections && block.corrections.length > 0) || (block.shared_board && block.shared_board.length > 0)) && (
                <div className="ai-subagent-collab">
                    <div className="ai-subagent-collab-head">
                        <span className="material-symbols-outlined">forum</span>
                        协作纠错
                    </div>

                    {block.shared_board && block.shared_board.length > 0 && (
                        <div className="ai-subagent-board">
                            {block.shared_board.map((item, index) => (
                                <span key={`board-${index}`}>{item}</span>
                            ))}
                        </div>
                    )}

                    {block.claims && block.claims.length > 0 && (
                        <div className="ai-subagent-collab-section">
                            <em>本轮判断</em>
                            {block.claims.map((claim, index) => (
                                <div key={`claim-${index}`} className="ai-subagent-claim">
                                    {claim}
                                </div>
                            ))}
                        </div>
                    )}

                    {block.reviews && block.reviews.length > 0 && (
                        <div className="ai-subagent-collab-section">
                            <em>互审记录</em>
                            {block.reviews.map((review, index) => (
                                <div key={`review-${index}`} className="ai-subagent-review">
                                    <span>{review.from_agent || '当前 Agent'} → {review.to_agent || '前序 Agent'}</span>
                                    <strong>{review.result || '复核'}</strong>
                                    <p>{review.message || '已完成交叉复核。'}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {block.corrections && block.corrections.length > 0 && (
                        <div className="ai-subagent-collab-section">
                            <em>纠正结果</em>
                            {block.corrections.map((correction, index) => (
                                <div key={`correction-${index}`} className="ai-subagent-correction">
                                    <span>{correction.status || '已采纳'}</span>
                                    <strong>{correction.target || '口径'}</strong>
                                    {correction.before && <p>原判断：{correction.before}</p>}
                                    {correction.after && <p>修正后：{correction.after}</p>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {block.evidence && block.evidence.length > 0 && (
                <div className="ai-subagent-evidence">
                    {block.evidence.map((item, index) => (
                        <span key={`${item}-${index}`}>{item}</span>
                    ))}
                </div>
            )}
        </div>
    )
}

function parseMarkdownTable(block: string): TableBlock | null {
    const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    if (lines.length < 3 || !lines.every((line) => line.startsWith('|') && line.endsWith('|'))) {
        return null
    }

    const separator = lines[1]
    if (!/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|$/.test(separator)) {
        return null
    }

    const parseCells = (line: string) =>
        line
            .slice(1, -1)
            .split('|')
            .map((cell) => cell.trim())

    const headers = parseCells(lines[0])
    const rows = lines.slice(2).map(parseCells)
    return { headers, rows }
}

function renderMessageContentDeprecated(
    content: string,
    onAction: (payload: AssistantActionPayload) => void,
): React.ReactNode {
    const blocks = dedupeSubagentBlocks(content.split(/\n\s*\n/))
    return blocks.map((block, index) => {
        const subagentBlock = parseSubagentBlock(block)
        if (subagentBlock) {
            return <SubagentProcessCard key={`subagent-${index}`} block={subagentBlock} />
        }

        if (block.includes('[SUBAGENT:')) {
            return null
        }

        const actionPayload = parseAssistantActionToken(block)
        if (actionPayload) {
            if (actionPayload.type === 'SUBAGENT_STEP') {
                return null
            }

            const labelHours = actionPayload.hours ? `${actionPayload.hours}h` : '全量'
            const labelMetric = actionPayload.metric ? ` · ${actionPayload.metric}` : ''
            return (
                <button
                    key={`action-${index}`}
                    className="ai-msg-action-btn"
                    onClick={() => onAction(actionPayload)}
                    title="打开甪直历史并定位对应时间窗"
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>insights</span>
                    打开甪直历史曲线（{labelHours}{labelMetric}）
                </button>
            )
        }

        const table = parseMarkdownTable(block)
        if (table) {
            return (
                <div key={`block-${index}`} className="ai-msg-table-wrap">
                    <table className="ai-msg-table">
                        <thead>
                            <tr>
                                {table.headers.map((header, headerIndex) => (
                                    <th key={`header-${headerIndex}`}>{header}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {table.rows.map((row, rowIndex) => (
                                <tr key={`row-${rowIndex}`}>
                                    {row.map((cell, cellIndex) => (
                                        <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )
        }

        return (
            <div key={`block-${index}`} className="ai-msg-text-block">
                {block}
            </div>
        )
    })
}

type SemanticMessageBlock = {
    tone: 'conclusion' | 'scenario' | 'station' | 'scale' | 'topology' | 'data' | 'process' | 'detail' | 'action' | 'risk' | 'pending' | 'source' | 'completeness' | 'evidence' | 'path' | 'direction'
    label: string
    body: string
}

function parseSemanticMessageBlock(block: string): SemanticMessageBlock | null {
    const text = block.trim()
    if (!text) return null

    const normalized = text
        .replace(/^[-*]\s*/, '')
        .replace(/^#{1,4}\s*/, '')
        .replace(/^\*\*(.+?)\*\*/, '$1')
    const colonMatch = normalized.match(/^(.{2,34}?)[：:]\s*([\s\S]*)$/)
    const headingMatch = normalized.match(/^([^\n：:]{2,34})\n([\s\S]+)$/)
    const match = colonMatch || headingMatch
    if (!match) return null

    const rawLabel = match[1].trim().replace(/^\*+|\*+$/g, '')
    const body = match[2].trimStart()
    const labelKey = rawLabel.replace(/\s+/g, '')
    const labelMap: Array<[RegExp, SemanticMessageBlock['tone']]> = [
        [/^(结论|判断|当前判断|关键判断|最终结论|.+结论)$/, 'conclusion'],
        [/^(适用场景|场景|适用范围)$/, 'scenario'],
        [/^(站场类型|站点类型|场站类型|站场信息|站点信息)$/, 'station'],
        [/^(规模与对象|规模|对象|设备规模|业务规模)$/, 'scale'],
        [/^(拓扑关系|拓扑|上下游拓扑|连接关系|管网关系)$/, 'topology'],
        [/^(数据连接|数据库连接|数据源连接|数据来源连接|重点监测|指标研判|边界余量)$/, 'data'],
        [/^(计算过程|分析过程|处理过程|AI处理过程|推理过程|过程说明|Agent证据互证链（编排校验）|Agent证据互证链|Agent互证\/辩论链|Agent互证|证据互证链|互证\/辩论链|辩论链|协作纠错|证据互证)$/, 'process'],
        [/^(指标明细|.+指标明细|明细|证据表|证据表（快照）|数据明细|计算明细)$/, 'detail'],
        [/^(路径分析|关键路径|路径|上下游|上下游关系)$/, 'path'],
        [/^(气流方向|流向|方向)$/, 'direction'],
        [/^(操作要点|建议动作|动作建议|动作建议（模板）|建议|调度建议|处置建议|处置步骤|处理步骤)$/, 'action'],
        [/^(风险与禁止项|风险影响|风险提示|风险边界|风险|禁止项|边界说明)$/, 'risk'],
        [/^(待确认项|待复核项|不确定性说明|待补充项)$/, 'pending'],
        [/^(来源|证据来源|数据来源|规程依据|依据)$/, 'source'],
        [/^(完整性提示|完整性|置信度说明)$/, 'completeness'],
        [/^(证据|已查询|检索证据|命中的库|命中的数据源|未命中的数据源|已检索但未命中的来源|数据覆盖)$/, 'evidence'],
    ]

    const matchTone = labelMap.find(([pattern]) => pattern.test(labelKey))
    if (!matchTone) return null

    return {
        tone: matchTone[1],
        label: rawLabel,
        body,
    }
}

function isSemanticHeadingOnly(block: string): boolean {
    const text = block.trim()
    if (!text) return false
    const normalized = text
        .replace(/^[-*]\s*/, '')
        .replace(/^#{1,4}\s*/, '')
        .replace(/^\*\*(.+?)\*\*$/, '$1')
        .replace(/[：:]$/, '')
        .replace(/\s+/g, '')
    return /^(结论|判断|当前判断|关键判断|最终结论|适用场景|场景|适用范围|站场类型|站点类型|场站类型|站场信息|站点信息|规模与对象|规模|对象|设备规模|业务规模|拓扑关系|拓扑|上下游拓扑|连接关系|管网关系|数据连接|数据库连接|数据源连接|数据来源连接|重点监测|指标研判|边界余量|计算过程|分析过程|处理过程|AI处理过程|推理过程|过程说明|Agent证据互证链（编排校验）|Agent证据互证链|Agent互证\/辩论链|Agent互证|证据互证链|互证\/辩论链|辩论链|协作纠错|证据互证|指标明细|明细|证据表|证据表（快照）|数据明细|计算明细|路径分析|关键路径|路径|上下游|上下游关系|气流方向|流向|方向|操作要点|建议动作|动作建议|动作建议（模板）|建议|调度建议|处置建议|处置步骤|处理步骤|风险与禁止项|风险影响|风险提示|风险边界|风险|禁止项|边界说明|待确认项|待复核项|不确定性说明|待补充项|来源|证据来源|数据来源|规程依据|依据|完整性提示|完整性|置信度说明|证据|已查询|检索证据|命中的库|命中的数据源|未命中的数据源|已检索但未命中的来源|数据覆盖)$/.test(normalized)
}

function normalizeAssistantSemanticBreaks(content: string): string {
    const headingPattern = /(关键判断|重点监测|处置建议|数据覆盖|风险边界|计算过程|完整性提示|(?:压力、温度、水露点|压力、温度|压力|温度|水露点|露点|[\u4e00-\u9fa5、]{2,18})指标明细)[：:]/g
    return content.replace(headingPattern, (match, _label, offset, fullText) => {
        if (offset === 0) return match
        const before = fullText.slice(Math.max(0, offset - 2), offset)
        if (before === '\n\n') return match
        return `\n\n${match}`
    })
}

function splitSubagentSegments(block: string): string[] {
    const parts: string[] = []
    let cursor = 0

    while (cursor < block.length) {
        const start = block.indexOf('[SUBAGENT:', cursor)
        if (start < 0) {
            parts.push(block.slice(cursor))
            break
        }

        if (start > cursor) {
            parts.push(block.slice(cursor, start))
        }

        const jsonStart = start + '[SUBAGENT:'.length
        if (block[jsonStart] !== '{') {
            cursor = start + '[SUBAGENT:'.length
            continue
        }

        let depth = 0
        let inString = false
        let escaped = false
        let end = -1
        for (let index = jsonStart; index < block.length; index += 1) {
            const char = block[index]
            if (inString) {
                if (escaped) {
                    escaped = false
                } else if (char === '\\') {
                    escaped = true
                } else if (char === '"') {
                    inString = false
                }
                continue
            }

            if (char === '"') {
                inString = true
            } else if (char === '{') {
                depth += 1
            } else if (char === '}') {
                depth -= 1
                if (depth === 0 && block[index + 1] === ']') {
                    end = index + 2
                    break
                }
            }
        }

        if (end < 0) {
            parts.push(block.slice(start))
            break
        }

        parts.push(block.slice(start, end))
        cursor = end
    }

    return parts.map(part => part.trim()).filter(Boolean)
}

function stripSubagentBlockLines(content: string): string {
    return content
        .split('\n')
        .filter(line => !line.includes('[SUBAGENT:'))
        .join('\n')
        .trim()
}

function splitAssistantDisplayBlocks(content: string): string[] {
    const normalizedContent = normalizeAssistantSemanticBreaks(stripPrivateThinkBlocks(content))
    const rawBlocks = dedupeSubagentBlocks(normalizedContent.split(/\n\s*\n/))
        .map(block => block.trim())
        .filter(Boolean)
    const merged: string[] = []

    for (let index = 0; index < rawBlocks.length; index += 1) {
        const block = rawBlocks[index]
        const next = rawBlocks[index + 1]
        const subagentSegments = splitSubagentSegments(block)
        if (subagentSegments.length > 1 || parseSubagentBlock(subagentSegments[0] || '')) {
            merged.push(...subagentSegments)
            continue
        }

        const parts = block
            .split(/(\[ACTION:[A-Z_]+\|[^\]]+\])/g)
            .map(part => part.trim())
            .filter(Boolean)

        if (parts.length > 1) {
            merged.push(...parts)
            continue
        }

        if (next && isSemanticHeadingOnly(block)) {
            merged.push(`${block.replace(/[：:]$/, '')}\n${next}`)
            index += 1
        } else {
            merged.push(block)
        }
    }

    return merged
}

function parseLeadConclusionBlock(block: string, index: number): SemanticMessageBlock | null {
    if (index !== 0) return null
    const text = block.trim()
    if (!text || text.length > 260) return null
    if (/^\s*(?:[-*]|\|)/.test(text)) return null
    const looksLikeConclusion =
        /^(要我说，先给准话|咱先把结论放这儿|先给准话|结论|找到了|可以|当前|这次|已完成|没有找到|未找到|不能|建议先)/.test(text)
        || /(共|总计|合计|累计|命中|找到|未找到|存在|不存在|可作为|不能作为).*\d+(?:\.\d+)?\s*(?:座|个|条|段|项|%|km|公里|MPa)?/.test(text)
    if (looksLikeConclusion) {
        const cleaned = text
            .replace(/^(要我说，先给准话|咱先把结论放这儿|先给准话)[：:]/, '')
            .replace(/^结论[：:]/, '')
            .trim()
        return { tone: 'conclusion', label: '结论', body: cleaned }
    }
    return null
}

function renderHighlightedBody(text: string): React.ReactNode {
    const parts = text.split(/(\d+(?:\.\d+)?\s*(?:km|公里|段|个|座|条|项|MPa|°C|摄氏度|万方\/天|万方|小时|分钟|次|%)|风险(?:等级)?[：: ]?[高中低]|高风险|中风险|低风险|正常|10MPa|0°C)/g)
    return parts.map((part, index) => {
        const metricLike = /^\d+(?:\.\d+)?\s*(?:km|公里|MPa|°C|摄氏度|万方\/天|万方|小时|分钟|次|%)$/.test(part)
        const riskLike = /^(风险(?:等级)?[：: ]?[高中低]|高风险|中风险|低风险|正常|10MPa|0°C)$/.test(part)
        const nearbyText = `${parts[index - 1] || ''}${parts[index + 1] || ''}`
        const countWorthHighlighting =
            /^\d+(?:\.\d+)?\s*(?:段|个|座|条|项)$/.test(part)
            && /(命中|合计|累计|总计|关联|相邻|用户|压缩机|管段|管线|数据|记录|边|节点)/.test(nearbyText)
            && !/(由\s*$|分站|站点|合并展示)/.test(nearbyText)
        if (metricLike || riskLike || countWorthHighlighting) {
            return <strong key={index} className={`ai-msg-key-number ${riskLike ? 'risk' : ''}`}>{part}</strong>
        }
        return <React.Fragment key={index}>{part}</React.Fragment>
    })
}

function renderSemanticBlock(semanticBlock: SemanticMessageBlock, key: string): React.ReactNode {
    if (semanticBlock.tone === 'conclusion') {
        return (
            <div key={key} className="ai-msg-conclusion-card">
                <div className="ai-msg-conclusion-icon">
                    <span className="material-symbols-outlined">verified</span>
                </div>
                <div className="ai-msg-conclusion-copy">
                    <span>{semanticBlock.label}</span>
                    <strong>{renderHighlightedBody(semanticBlock.body)}</strong>
                </div>
            </div>
        )
    }

    if (semanticBlock.tone === 'source' || semanticBlock.tone === 'evidence' || semanticBlock.tone === 'completeness' || semanticBlock.tone === 'process' || semanticBlock.tone === 'detail') {
        const defaultOpen = semanticBlock.tone === 'detail'
        return (
            <details key={key} open={defaultOpen} className={`ai-msg-folded-section ai-msg-folded-section-${semanticBlock.tone}`}>
                <summary>
                    <span className="material-symbols-outlined">unfold_more</span>
                    {semanticBlock.label}
                </summary>
                {semanticBlock.body ? (
                    <div className="ai-msg-folded-body">{renderHighlightedBody(semanticBlock.body)}</div>
                ) : null}
            </details>
        )
    }

    return (
        <div key={key} className={`ai-msg-text-block ai-msg-section ai-msg-section-${semanticBlock.tone}`}>
            <span className="ai-msg-section-label">{semanticBlock.label}：</span>
            {semanticBlock.body ? (
                <span className="ai-msg-section-body">{renderHighlightedBody(semanticBlock.body)}</span>
            ) : null}
        </div>
    )
}

function renderMessageContent(
    content: string,
    onAction: (payload: AssistantActionPayload) => void,
    onSend?: (text?: string, options?: HandleSendOptions) => void,
): React.ReactNode {
    const blocks = splitAssistantDisplayBlocks(content)
    const hasLeadConclusion = !!parseLeadConclusionBlock(blocks[0] ?? '', 0)
    return blocks.map((block, index) => {
        const selectorBlock = parseMultiScenarioSelectorBlock(block)
        if (selectorBlock) {
            return (
                <MultiScenarioSelectorCard
                    key={`multi-selector-${index}`}
                    block={selectorBlock}
                    onStart={(selectedScenarioIds) => onSend?.('/执行多工况AI', {
                        selectedScenarioIds,
                        displayText: `已选择 ${selectedScenarioIds.length} 个工况，开始仿真比对。`,
                    })}
                />
            )
        }

        const subagentBlock = parseSubagentBlock(block)
        if (subagentBlock) {
            return <SubagentProcessCard key={`subagent-${index}`} block={subagentBlock} />
        }

        const actionPayload = parseAssistantActionToken(block)
        if (actionPayload) {
            if (actionPayload.type === 'SUBAGENT_STEP') {
                return null
            }

            if (actionPayload.type === 'START_MULTI_SCENARIO_AI') {
                return (
                    <React.Fragment key={`action-${index}`}>
                        <button
                            className="ai-msg-action-btn"
                            onClick={() => onAction(actionPayload)}
                            title="启动全国一张网中卫三工况仿真演示"
                        >
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>science</span>
                            启动中卫仿真演示
                        </button>
                    </React.Fragment>
                )
            }

            if (actionPayload.type === 'LOCATE_STATION') {
                const labelStation = actionPayload.station ? `${actionPayload.station}` : '该站'
                return (
                    <React.Fragment key={`action-${index}`}>
                        <AutoAssistantAction action={actionPayload} onAction={onAction} />
                        <button
                            className="ai-msg-action-btn"
                            onClick={() => onAction(actionPayload)}
                            title={`地图定位到${labelStation}`}
                        >
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>my_location</span>
                            地图定位到{labelStation}
                        </button>
                    </React.Fragment>
                )
            }

            const labelHours = actionPayload.hours ? `${actionPayload.hours}h` : '全量'
            const labelMetric = actionPayload.metric ? ` · ${actionPayload.metric}` : ''
            const labelStation = actionPayload.station ? `${actionPayload.station}` : '此站'
            return (
                <button
                    key={`action-${index}`}
                    className="ai-msg-action-btn"
                    onClick={() => onAction(actionPayload)}
                    title={`打开${labelStation}历史并定位对应时间窗`}
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>insights</span>
                    打开{labelStation}历史曲线（{labelHours}{labelMetric}）                </button>
            )
        }

        const table = parseMarkdownTable(block)
        if (table) {
            const tableNode = (
                <div className="ai-msg-table-wrap">
                    <table className="ai-msg-table">
                        <thead>
                            <tr>
                                {table.headers.map((header, headerIndex) => (
                                    <th key={`header-${headerIndex}`}>{header}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {table.rows.map((row, rowIndex) => (
                                <tr key={`row-${rowIndex}`}>
                                    {row.map((cell, cellIndex) => (
                                        <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )
            return (
                <React.Fragment key={`table-${index}`}>{tableNode}</React.Fragment>
            )
        }

        const semanticBlock = parseSemanticMessageBlock(block)
        if (semanticBlock) {
            return renderSemanticBlock(semanticBlock, `block-${index}`)
        }

        const leadConclusion = parseLeadConclusionBlock(block, index)
        if (leadConclusion) {
            return renderSemanticBlock(leadConclusion, `lead-${index}`)
        }

        return (
            <div key={`block-${index}`} className="ai-msg-text-block">
                {block}
            </div>
        )
    })
}

const ThinkingPanel: React.FC<{
    content: string
    isStreaming?: boolean
    answer?: string
    userQuestion?: string
    onAction: (payload: AssistantActionPayload) => void
    onSend?: (text?: string, options?: HandleSendOptions) => void
}> = ({ content, isStreaming, answer = '', userQuestion = '', onAction, onSend }) => {
    const trimmed = stripPrivateThinkBlocks(content).trim()
    if (!trimmed) return null
    const visibleThinkingContent = !isStreaming && trimmed.includes('[SUBAGENT:')
        ? stripSubagentBlockLines(trimmed)
        : trimmed

    const stepCount = dedupeSubagentBlocks(trimmed.split(/\n\s*\n/)).filter(Boolean).length
    const assessmentText = `${userQuestion}\n${trimmed}\n${answer}`
    const hasZhongweiSimulationAgent = /中卫稳态仿真 Agent|START_MULTI_SCENARIO_AI|run_steady_sim/.test(assessmentText)
    const hasCompleteHint = /完整性提示[:：]\s*是/.test(assessmentText)
    const hasIncompleteHint = /完整性提示[:：]\s*否/.test(assessmentText)
    const hasExactEntityMatch = /(索引\s*ID\s*是|RAW-ST-\d+|唯一命中|确定为|已定位|登记的一个(?:压气站|分输站|输气站|阀室|门站|末站|首站)|是\s*[^。；\n]*(?:压气站|分输站|输气站|阀室|门站|末站|首站|LNG))/i.test(assessmentText)
    const hasEvidence = /(证据[:：]|数据来源|检索证据|命中|SubAgent|\[SUBAGENT:|仿真|SCADA|raw_excel|知识库|完整性提示)/i.test(assessmentText)
    const hasMissing = /(未命中|缺少|不足|无法|未找到|不确定|非实时)/.test(assessmentText)
    const hasAction = /\[ACTION:|建议|可操作|调度/.test(assessmentText)
    const questionText = userQuestion.trim() || assessmentText
    const assistantAssessmentText = `${trimmed}\n${answer}`
    const hasCommonMetricTypoInQuestion = /(水路点|水漏点|水落点|水陆点)/.test(userQuestion)
    const hasCommonMetricTypoInAssistant = /(水路点|水漏点|水落点|水陆点)/.test(assistantAssessmentText)
    const hasMetricTypoCorrection = /(水露点|已(?:将|把).*(?:纠正|识别).*水露点|疑似.*水露点)/.test(assistantAssessmentText)
    const hasUnresolvedMetricTypo = hasCommonMetricTypoInAssistant || (hasCommonMetricTypoInQuestion && !hasMetricTypoCorrection)
    const hasDeterministicAgent = /(确定性查询 Agent|已按数据库口径直出|确定性查询已直接走数据库口径|数据库口径已闭合)/.test(assessmentText)
    const isDeterministicLookup = hasDeterministicAgent || (/(有多少|多少个|统计|数量|列出|按类型|分类|全网概况|基础设施|压气站数量|干线管线)/.test(questionText)
        && !hasIncompleteHint
        && !hasMissing
        && !/(风险|仿真|推演|预测|限流|异常|是否存在风险|需不需要关注)/.test(questionText))
    const shouldShowConfidence = hasUnresolvedMetricTypo || isDeterministicLookup || hasEvidence || hasExactEntityMatch || hasCompleteHint || hasIncompleteHint || hasAction
    const evidenceMissingPenalty = hasMissing ? (hasExactEntityMatch ? 4 : 14) : 0
    const completenessMissingPenalty = hasMissing ? (hasExactEntityMatch ? 4 : 12) : 0
    const evidenceConfidence = hasUnresolvedMetricTypo ? 0 : isDeterministicLookup ? 100 : Math.max(
        32,
        Math.min(96, 48 + stepCount * 7 + (hasEvidence ? 18 : 0) + (hasExactEntityMatch ? 16 : 0) + (hasAction ? 5 : 0) - evidenceMissingPenalty),
    )
    const completenessConfidence = hasUnresolvedMetricTypo ? 0 : isDeterministicLookup ? 100 : Math.max(
        25,
        Math.min(98, 54 + (hasCompleteHint ? 28 : 0) + (hasExactEntityMatch ? 12 : 0) - (hasIncompleteHint ? 30 : 0) - completenessMissingPenalty + Math.min(stepCount * 3, 12)),
    )
    const overallConfidence = Math.round((evidenceConfidence * 0.55) + (completenessConfidence * 0.45))
    const stageLabel = stepCount <= 1
        ? '理解问题'
        : stepCount <= 3
            ? '检索证据'
            : stepCount <= 5
                ? '交叉分析'
                : '整理结论'

    return (
        <details className="ai-thinking-panel" open={Boolean(isStreaming)}>
            <summary>
                <span className={`ai-thinking-dot ${isStreaming ? 'running' : ''}`} />
                <span>{isStreaming ? 'AI 正在处理' : 'AI 处理过程'}</span>
                <em>{stepCount} 步</em>
            </summary>
            <div className="ai-thinking-content">
                {isStreaming && (
                    <div className="ai-thinking-hero">
                        <div className="ai-thinking-hero-icon">
                            <span className="material-symbols-outlined">psychology</span>
                        </div>
                        <div className="ai-thinking-hero-title">AI 思考中...</div>
                        <div className="ai-thinking-hero-subtitle">
                            {stageLabel} · 正在读取证据、调用工具并整理可展示过程
                        </div>
                        <div className="ai-thinking-progress" aria-label="AI 思考进度">
                            <div className="ai-thinking-progress-track">
                                <div className="ai-thinking-progress-fill" />
                                <div className="ai-thinking-progress-glow" />
                            </div>
                            <div className="ai-thinking-progress-label">
                                <span>PROCESSING</span>
                                <span>{String(Math.min(stepCount, 99)).padStart(2, '0')} STEPS</span>
                            </div>
                        </div>
                    </div>
                )}
                {shouldShowConfidence && (
                    <div className="ai-confidence-card">
                        <div className="ai-confidence-head">
                            <div>
                                <span className="ai-confidence-kicker">CONFIDENCE</span>
                                <strong>置信度评估</strong>
                            </div>
                            <span className="material-symbols-outlined">verified</span>
                        </div>
                        <div className="ai-confidence-metrics">
                            <div>
                                <span>{Math.round(evidenceConfidence)}%</span>
                                <em>证据置信度</em>
                            </div>
                            <div>
                                <span>{Math.round(completenessConfidence)}%</span>
                                <em>完整性置信度</em>
                            </div>
                        </div>
                        <div className="ai-confidence-track">
                            <div style={{ width: `${overallConfidence}%` }} />
                        </div>
                        <div className="ai-confidence-note">
                            综合评估 {overallConfidence}% · {hasUnresolvedMetricTypo ? '存在明显术语错字，未完成纠正前不采信' : isDeterministicLookup ? '确定性查询，数据库口径已闭合' : hasExactEntityMatch ? '实体已定位，可作为当前站点结论使用' : hasMissing ? '存在数据缺口，结论需保守使用' : '证据链较完整，可用于当前演示'}
                        </div>
                    </div>
                )}
                {!isStreaming && trimmed.includes('[SUBAGENT:') && (
                    <div className="ai-subagent-collab ai-subagent-collab-summary">
                        <div className="ai-subagent-collab-head">
                            <span className="material-symbols-outlined">forum</span>
                            证据互证
                        </div>
                        <div className="ai-subagent-board">
                            {hasZhongweiSimulationAgent ? (
                                <>
                                    <span>中卫稳态仿真 Agent 已接入</span>
                                    <span>工具：run_steady_sim</span>
                                    <span>演示：3000/2000/截断三工况</span>
                                </>
                            ) : (
                                <>
                                    <span>共享证据板已闭合</span>
                                    <span>风险边界：压力=管线设计压力；水露点=0°C</span>
                                    <span>最终结论已由风险复核与业务表达复核收口</span>
                                </>
                            )}
                        </div>
                        <div className="ai-subagent-collab-section">
                            <em>证据互证链</em>
                            {hasZhongweiSimulationAgent ? (
                                <>
                                    <div className="ai-subagent-review">
                                        <span>主控 Agent → 中卫稳态仿真 Agent</span>
                                        <p>识别中卫对象和演示意图；仿真 Agent 调用 run_steady_sim 回证模型状态和 run_id。</p>
                                    </div>
                                    <div className="ai-subagent-review">
                                        <span>仿真 Agent → 全国一张网演示</span>
                                        <p>下发中卫 3000、2000、截断三组工况，触发前端自动播放和压力/流量曲线生成。</p>
                                    </div>
                                    <div className="ai-subagent-review">
                                        <span>风险复核 Agent → 业务表达复核 Agent</span>
                                        <p>把结果限定为仿真场景，要求生产研判继续补 SCADA、规程和设计边界。</p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="ai-subagent-review">
                                        <span>主控 Agent → 历史曲线 Agent</span>
                                        <p>校验是否有真实数据；历史曲线用 SCADA 命中记录和当前值、6h变化、波动幅度回证。</p>
                                    </div>
                                    <div className="ai-subagent-review">
                                        <span>历史曲线 Agent → 风险复核 Agent</span>
                                        <p>提出风险信号；风险复核按本轮实际数值判断是越界风险还是波动风险，并修正最终口径。</p>
                                    </div>
                                    <div className="ai-subagent-review">
                                        <span>拓扑/规程 Agent → 业务表达复核 Agent</span>
                                        <p>追问是否上下游传导，并拦截调度指令；最终只输出趋势复核单、证据清单和边界说明。</p>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
                {renderMessageContent(visibleThinkingContent, onAction, onSend)}
            </div>
        </details>
    )
}

interface AssistantPanelProps {
    isPoppedOut: boolean
    position: { x: number; y: number }
    isDragging: boolean
    handleMouseDown: (event: React.MouseEvent) => void
    popOut: () => void
    closePopOut: () => void
    setIsOpen: (open: boolean) => void
    messages: ChatMessage[]
    loading: boolean
    activeToolName: string
    input: string
    setInput: (value: string) => void
    dataAnalysisMode: boolean
    subagentMode: boolean
    handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
    handleSend: (text?: string, options?: HandleSendOptions) => void
    handleExampleClick: (question: string) => void
    onAction: (payload: AssistantActionPayload) => void
    messagesEndRef: React.RefObject<HTMLDivElement | null>
    inputRef: React.RefObject<HTMLInputElement | null>
}

const AssistantPanel: React.FC<AssistantPanelProps> = ({
    isPoppedOut,
    position,
    isDragging,
    handleMouseDown,
    popOut,
    closePopOut,
    setIsOpen,
    messages,
    loading,
    activeToolName,
    input,
    setInput,
    dataAnalysisMode,
    subagentMode,
    handleKeyDown,
    handleSend,
    handleExampleClick,
    onAction,
    messagesEndRef,
    inputRef,
}) => {
    const slashInput = input.trimStart()
    const showSlashSkills = slashInput.startsWith('/') && !loading
    const slashQuery = showSlashSkills ? slashInput.slice(1).trim().toLowerCase() : ''
    const filteredSlashSkills = showSlashSkills
        ? SLASH_SKILLS.filter((skill) => {
            if (!slashQuery) return true
            const searchableText = [
                skill.label,
                skill.description,
                skill.prompt,
                ...skill.keywords,
            ].join(' ').toLowerCase()
            return searchableText.includes(slashQuery)
        })
        : []

    const handleSlashSkillEnter = (skill: SlashSkill) => {
        setInput('')
        handleSend(skill.prompt)
    }

    return (
        <div
            className={`ai-assistant-panel ${isDragging ? 'dragging' : ''} ${isPoppedOut ? 'popped-out' : ''}`}
            id="ai-assistant-panel"
            style={isPoppedOut
                ? {
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    borderRadius: 0,
                    margin: 0,
                    border: 'none',
                    left: 0,
                    top: 0,
                }
                : {
                    left: `${position.x}px`,
                    top: `${position.y}px`,
                    bottom: 'auto',
                }}
        >
            <div
                className="ai-panel-header"
                onMouseDown={isPoppedOut ? undefined : handleMouseDown}
                style={{ cursor: isPoppedOut ? 'default' : (isDragging ? 'grabbing' : 'grab') }}
            >
                <div className="ai-avatar">
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#fff' }}>
                        smart_toy
                    </span>
                </div>
                <div className="ai-header-info">
                    <div className="ai-title">AI 助手</div>
                    <div className="ai-subtitle">智慧平台 {isPoppedOut ? '· 独立窗口' : '· 拖动移动'}</div>
                </div>
                <div className="ai-status-dot" title="在线" />
                {dataAnalysisMode && <div className="ai-mode-pill">数据分析</div>}
                {subagentMode && <div className="ai-mode-pill ai-mode-pill-subagent">SubAgent</div>}

                {!isPoppedOut && (
                    <button onClick={popOut} className="ai-close-btn" title="弹出为独立窗口" style={{ marginRight: 4 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                            open_in_new
                        </span>
                    </button>
                )}

                <button
                    onClick={() => {
                        if (isPoppedOut) {
                            closePopOut()
                        } else {
                            setIsOpen(false)
                        }
                    }}
                    className="ai-close-btn"
                    title={isPoppedOut ? '关闭独立窗口' : '隐藏面板'}
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        close
                    </span>
                </button>
            </div>

            {loading && (
                <div className="ai-live-thinking-bar" role="status" aria-live="polite">
                    <div className="ai-live-thinking-icon">
                        <span className="material-symbols-outlined">psychology</span>
                    </div>
                    <div className="ai-live-thinking-copy">
                        <strong>AI 思考中...</strong>
                        <span>
                            {activeToolName
                                ? `正在${TOOL_LABELS[activeToolName] || activeToolName}`
                                : subagentMode
                                    ? 'SubAgent 正在分工分析、调用仿真并复核结论'
                                    : '正在检索证据、组织推理并生成结果'}
                        </span>
                    </div>
                    <div className="ai-live-progress" aria-label="AI 思考进度">
                        <div className="ai-live-progress-track">
                            <div className="ai-live-progress-fill" />
                        </div>
                        <span>PROCESSING</span>
                    </div>
                </div>
            )}

            <div className="ai-messages">
                {messages.length === 0 ? (
                    <WelcomeScreen onExampleClick={handleExampleClick} dataAnalysisMode={dataAnalysisMode} subagentMode={subagentMode} />
                ) : (
                    messages.map((message, index) => (
                        <div key={`${message.role}-${index}`} className={`ai-msg-wrapper ${message.role}`}>
                            <div className={`ai-msg ${message.role}`}>
                                {message.role === 'assistant' && message.thinking && (
                                    <ThinkingPanel
                                        content={message.thinking}
                                        isStreaming={message.isStreaming}
                                        answer={message.content}
                                        userQuestion={messages[index - 1]?.role === 'user' ? messages[index - 1].content : ''}
                                        onAction={onAction}
                                        onSend={handleSend}
                                    />
                                )}
                                {renderMessageContent(message.content, onAction, handleSend)}
                            </div>
                            {message.retrieval_log && message.retrieval_log.length > 0 && (
                                <div className="ai-retrieval-log">
                                    <span className="material-symbols-outlined">folder_open</span>
                                    检索文件：{message.retrieval_log.join(', ')}
                                </div>
                            )}
                        </div>
                    ))
                )}

                {loading && activeToolName && (
                    <div className="ai-tool-badge">
                        <span className="material-symbols-outlined">sync</span>
                        正在{TOOL_LABELS[activeToolName] || activeToolName}...
                    </div>
                )}
                {loading && !activeToolName && (
                    <div className="ai-typing">
                        <span /><span /><span />
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            <div className="ai-input-area">
                <input
                    ref={inputRef}
                    id="ai-assistant-input"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                        if (showSlashSkills && event.key === 'Enter') {
                            event.preventDefault()
                            if (filteredSlashSkills[0]) {
                                handleSlashSkillEnter(filteredSlashSkills[0])
                            }
                            return
                        }
                        if (showSlashSkills && event.key === 'Escape') {
                            event.preventDefault()
                            setInput('')
                            return
                        }
                        handleKeyDown(event)
                    }}
                    placeholder="输入你的问题..."
                    disabled={loading}
                />
                <button
                    id="ai-assistant-send"
                    className="ai-send-btn"
                    onClick={() => {
                        if (showSlashSkills && filteredSlashSkills[0]) {
                            handleSlashSkillEnter(filteredSlashSkills[0])
                            return
                        }
                        handleSend()
                    }}
                    disabled={(showSlashSkills ? filteredSlashSkills.length === 0 : !input.trim()) || loading}
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        send
                    </span>
                </button>
            </div>

            {showSlashSkills && (
                <div className="ai-slash-menu">
                    {filteredSlashSkills.length > 0 ? (
                        <div className="ai-slash-grid">
                            {filteredSlashSkills.map((skill) => (
                                <div className="ai-slash-card" key={skill.id}>
                                    <div className="ai-slash-title">
                                        <span className="material-symbols-outlined">{skill.icon}</span>
                                        {skill.label}
                                    </div>
                                    <div className="ai-slash-desc">{skill.description}</div>
                                    <button type="button" onClick={() => handleSlashSkillEnter(skill)}>
                                        进入
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="ai-slash-empty">没有匹配的 Skill</div>
                    )}
                </div>
            )}

            {!showSlashSkills && (dataAnalysisMode || subagentMode) && (
                <div className="ai-skill-grid">
                    <div className={`ai-skill-card ${dataAnalysisMode ? 'active' : ''}`}>
                        <div className="ai-skill-title">
                            <span className="material-symbols-outlined">analytics</span>
                            数据分析 Skill
                        </div>
                        <div className="ai-skill-actions">
                            {dataAnalysisMode ? (
                                <>
                                    <button type="button" onClick={() => handleSend('甪直水露点')} disabled={loading}>甪直露点</button>
                                    <button type="button" onClick={() => handleSend('中卫水露点')} disabled={loading}>中卫露点</button>
                                    <button type="button" onClick={() => handleSend('甪直站风险分析')} disabled={loading}>甪直风险</button>
                                    <button type="button" onClick={() => handleSend('中卫站风险分析')} disabled={loading}>中卫风险</button>
                                    <button type="button" onClick={() => handleSend('甪直站和中卫站水露点对比')} disabled={loading}>双站对比</button>
                                    <button type="button" onClick={() => handleSend('/退出数据分析')} disabled={loading}>退出</button>
                                </>
                            ) : (
                                <button type="button" onClick={() => handleSend('/数据分析')} disabled={loading}>进入</button>
                            )}
                        </div>
                    </div>

                    <div className={`ai-skill-card ${subagentMode ? 'active subagent' : ''}`}>
                        <div className="ai-skill-title">
                            <span className="material-symbols-outlined">hub</span>
                            SubAgent 专家组
                        </div>
                        <div className="ai-skill-actions">
                            {subagentMode ? (
                                <>
                                    <button type="button" onClick={() => handleSend('帮我用subagent分析中卫到靖边限流场景，并自动开启仿真推演演示。要求展示每个Agent过程，最后按结论、依据、影响、建议、待复核项、边界说明输出。')} disabled={loading}>中卫-靖边限流</button>
                                    <button type="button" onClick={() => handleSend('帮我用subagent分析中卫压气站当前是否存在风险，结合历史曲线、拓扑关系、仿真场景和风险复核输出。')} disabled={loading}>中卫单站风险</button>
                                    <button type="button" onClick={() => handleSend('用subagent分析甪直分输站最近水露点和压力趋势，判断是否存在异常，并说明数据来源和建议动作。')} disabled={loading}>甪直露点趋势</button>
                                    <button type="button" onClick={() => handleSend('/退出subagent')} disabled={loading}>退出</button>
                                </>
                            ) : (
                                <button type="button" onClick={() => handleSend('/subagent')} disabled={loading}>进入</button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

const AiAssistant: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const lastAutoHistoryActionRef = useRef<string>('')
    const lastAutoSimulationActionRef = useRef<string>('')
    const emittedSubagentStepSignaturesRef = useRef<Set<string>>(new Set())
    const chat = useAiAssistantChat()
    const { isPoppedOut, popOut, closePopOut } = useNewWindow('ai-assistant-sync', '/popout/assistant')

    const { position, isDragging, handleMouseDown } = useDrag({
        x: 24,
        y: typeof window !== 'undefined' ? window.innerHeight - 560 - 92 : 200,
    })

    const fabDrag = useDrag({
        x: 24,
        y: typeof window !== 'undefined' ? window.innerHeight - 80 : 600,
    })

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [chat.messages, chat.loading])

    useEffect(() => {
        let latestAssistantMessage: ChatMessage | undefined
        let latestAssistantIndex = -1
        for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
            const message = chat.messages[index]
            if (message.role === 'assistant') {
                latestAssistantMessage = message
                latestAssistantIndex = index
                break
            }
        }
        if (!latestAssistantMessage) return

        const actions = extractAssistantActions(latestAssistantMessage.content)
        const subagentStepActions = actions.filter((item) => item.type === 'SUBAGENT_STEP')
        subagentStepActions.forEach((action, actionIndex) => {
            const signature = [
                latestAssistantIndex,
                actionIndex,
                action.step || '',
                action.status || '',
                action.title || '',
                action.message || '',
            ].join('|')
            if (!emittedSubagentStepSignaturesRef.current.has(signature)) {
                emittedSubagentStepSignaturesRef.current.add(signature)
                const delay = action.status === 'completed' ? 1200 : 520
                window.setTimeout(() => emitAssistantAction(action), delay)
            }
        })

        const historyAction = actions.find((item) => item.type === 'OPEN_HISTORY_PANEL')
        if (historyAction) {
            const signature = [
                latestAssistantIndex,
                historyAction.station || '',
                historyAction.view || '',
                historyAction.hours || 0,
                historyAction.timeStart || '',
                historyAction.timeEnd || '',
                historyAction.metric || '',
            ].join('|')
            if (lastAutoHistoryActionRef.current !== signature) {
                lastAutoHistoryActionRef.current = signature
                window.setTimeout(() => emitAssistantAction(historyAction), 300)
            }
        }

        const simulationAction = actions.find((item) => item.type === 'START_MULTI_SCENARIO_AI' && item.auto)
        if (simulationAction) {
            const signature = [
                latestAssistantIndex,
                simulationAction.selectedScenarioIds?.join(',') || '',
            ].join('|')
            if (lastAutoSimulationActionRef.current !== signature) {
                lastAutoSimulationActionRef.current = signature
                window.setTimeout(() => emitAssistantAction(simulationAction), 500)
            }
        }
    }, [chat.loading, chat.messages])

    useEffect(() => {
        if (!isOpen) return
        const timer = window.setTimeout(() => inputRef.current?.focus(), 300)
        return () => window.clearTimeout(timer)
    }, [isOpen])

    useEffect(() => {
        const handleAssistantSendMessage = (event: Event) => {
            const detail = (event as CustomEvent<AssistantSendMessagePayload>).detail
            if (!detail?.message || !detail.message.trim()) return
            if (detail.autoOpen !== false) {
                setIsOpen(true)
            }
            void chat.handleSend(detail.message)
        }
        window.addEventListener('assistant-send-message', handleAssistantSendMessage as EventListener)
        return () => {
            window.removeEventListener('assistant-send-message', handleAssistantSendMessage as EventListener)
        }
    }, [chat])

    return (
        <>
            <button
                id="ai-assistant-fab"
                className={`ai-assistant-fab ${isOpen ? 'open' : ''} ${fabDrag.isDragging ? 'dragging' : ''}`}
                style={{
                    left: fabDrag.position.x,
                    top: fabDrag.position.y,
                    bottom: 'auto',
                    cursor: fabDrag.isDragging ? 'grabbing' : 'grab',
                }}
                onMouseDown={(event) => {
                    const target = event.currentTarget as HTMLElement
                    target.dataset.startX = String(event.clientX)
                    target.dataset.startY = String(event.clientY)
                    fabDrag.handleMouseDown(event)
                }}
                onMouseUp={(event) => {
                    const target = event.currentTarget as HTMLElement
                    const startX = Number(target.dataset.startX || 0)
                    const startY = Number(target.dataset.startY || 0)
                    const distance = Math.sqrt((event.clientX - startX) ** 2 + (event.clientY - startY) ** 2)

                    if (distance < 5) {
                        setIsOpen((open) => !open)
                        if (isPoppedOut && isOpen) {
                            closePopOut()
                        }
                    }
                }}
                title={isOpen ? '关闭 AI 助手' : '打开 AI 助手'}
            >
                <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                    {isOpen ? 'keyboard_arrow_down' : 'smart_toy'}
                </span>
            </button>

            {isOpen && (
                <>
                    {isPoppedOut ? (
                        <div className="hidden" aria-hidden="true" id="ai-assistant-suspended" />
                    ) : (
                        <AssistantPanel
                            isPoppedOut={false}
                            position={position}
                            isDragging={isDragging}
                            handleMouseDown={handleMouseDown}
                            closePopOut={closePopOut}
                            popOut={() => popOut(500, 780, 'AI 调度工作流助手')}
                            setIsOpen={setIsOpen}
                            messages={chat.messages}
                            loading={chat.loading}
                            activeToolName={chat.activeToolName}
                            input={chat.input}
                            setInput={chat.setInput}
                            dataAnalysisMode={chat.dataAnalysisMode}
                            subagentMode={chat.subagentMode}
                            handleKeyDown={chat.handleKeyDown}
                            handleSend={(text?: string, options?: HandleSendOptions) => void chat.handleSend(text, options)}
                            handleExampleClick={chat.handleExampleClick}
                            onAction={emitAssistantAction}
                            messagesEndRef={messagesEndRef}
                            inputRef={inputRef}
                        />
                    )}
                </>
            )}
        </>
    )
}

export const AiAssistantStandalone: React.FC = () => {
    usePopoutSync('ai-assistant-sync')

    const messagesEndRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const lastAutoHistoryActionRef = useRef<string>('')
    const lastAutoSimulationActionRef = useRef<string>('')
    const emittedSubagentStepSignaturesRef = useRef<Set<string>>(new Set())
    const chat = useAiAssistantChat()

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [chat.messages, chat.loading])

    useEffect(() => {
        let latestAssistantMessage: ChatMessage | undefined
        let latestAssistantIndex = -1
        for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
            const message = chat.messages[index]
            if (message.role === 'assistant') {
                latestAssistantMessage = message
                latestAssistantIndex = index
                break
            }
        }
        if (!latestAssistantMessage) return

        const actions = extractAssistantActions(latestAssistantMessage.content)
        const subagentStepActions = actions.filter((item) => item.type === 'SUBAGENT_STEP')
        subagentStepActions.forEach((action, actionIndex) => {
            const signature = [
                latestAssistantIndex,
                actionIndex,
                action.step || '',
                action.status || '',
                action.title || '',
                action.message || '',
            ].join('|')
            if (!emittedSubagentStepSignaturesRef.current.has(signature)) {
                emittedSubagentStepSignaturesRef.current.add(signature)
                const delay = action.status === 'completed' ? 1200 : 520
                window.setTimeout(() => emitAssistantAction(action), delay)
            }
        })

        const historyAction = actions.find((item) => item.type === 'OPEN_HISTORY_PANEL')
        if (historyAction) {
            const signature = [
                latestAssistantIndex,
                historyAction.station || '',
                historyAction.view || '',
                historyAction.hours || 0,
                historyAction.timeStart || '',
                historyAction.timeEnd || '',
                historyAction.metric || '',
            ].join('|')
            if (lastAutoHistoryActionRef.current !== signature) {
                lastAutoHistoryActionRef.current = signature
                window.setTimeout(() => emitAssistantAction(historyAction), 300)
            }
        }

        const simulationAction = actions.find((item) => item.type === 'START_MULTI_SCENARIO_AI' && item.auto)
        if (simulationAction) {
            const signature = [
                latestAssistantIndex,
                simulationAction.selectedScenarioIds?.join(',') || '',
            ].join('|')
            if (lastAutoSimulationActionRef.current !== signature) {
                lastAutoSimulationActionRef.current = signature
                window.setTimeout(() => emitAssistantAction(simulationAction), 500)
            }
        }
    }, [chat.loading, chat.messages])

    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    return (
        <AssistantPanel
            isPoppedOut={true}
            position={{ x: 0, y: 0 }}
            isDragging={false}
            handleMouseDown={() => {}}
            closePopOut={() => window.close()}
            popOut={() => {}}
            setIsOpen={() => {}}
            messages={chat.messages}
            loading={chat.loading}
            activeToolName={chat.activeToolName}
            input={chat.input}
            setInput={chat.setInput}
            dataAnalysisMode={chat.dataAnalysisMode}
            subagentMode={chat.subagentMode}
            handleKeyDown={chat.handleKeyDown}
            handleSend={(text?: string, options?: HandleSendOptions) => void chat.handleSend(text, options)}
            handleExampleClick={chat.handleExampleClick}
            onAction={emitAssistantAction}
            messagesEndRef={messagesEndRef}
            inputRef={inputRef}
        />
    )
}

export default AiAssistant
