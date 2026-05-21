import React, { useCallback, useEffect, useRef, useState } from 'react'
import './ai-assistant.css'
import { useNewWindow, usePopoutSync } from '../../hooks/useNewWindow'
import { stripPrivateThinkBlocks, useAiAssistantChat } from './useAiAssistantChat'
import type { ChatMessage, HandleSendOptions } from './useAiAssistantChat'

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
    'mcp.run_steady_sim': '调用 MCP 稳态仿真工具',
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
]

const DATA_ANALYSIS_EXAMPLES: PromptExample[] = [
    { label: '进入数据分析', prompt: '/数据分析', icon: 'login' },
    { label: '甪直单站露点', prompt: '甪直水露点，按结论、关键异常点、调度建议输出。', icon: 'water_drop' },
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
        description: '进入站场水露点分析与双站对比模式。',
        prompt: '/数据分析',
        icon: 'analytics',
        keywords: ['数据', '分析', '露点', 'luzhi'],
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

interface SubagentBlock {
    agent?: string
    title?: string
    icon?: string
    status?: SubagentStatus
    tool?: string
    message?: string
    steps?: string[]
    evidence?: string[]
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

type AssistantActionType = 'OPEN_LUZHI_HISTORY' | 'OPEN_HISTORY_PANEL' | 'LOCATE_STATION'

interface AssistantActionPayload {
    type: AssistantActionType
    station?: string
    view?: 'pressure' | 'temperature' | 'dewpoint' | 'overview'
    hours?: number
    timeStart?: string
    timeEnd?: string
    metric?: string
}

interface AssistantSendMessagePayload {
    message: string
    autoOpen?: boolean
}

function parseAssistantActionToken(block: string): AssistantActionPayload | null {
    const normalized = block.trim()
    const match = normalized.match(/^\[ACTION:([A-Z_]+)\|(.+)\]$/)
    if (!match) return null

    const actionType = match[1] as AssistantActionType
    if (actionType !== 'OPEN_LUZHI_HISTORY' && actionType !== 'OPEN_HISTORY_PANEL' && actionType !== 'LOCATE_STATION') return null

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

    return {
        type: actionType,
        station: map.get('station') || undefined,
        view: allowedView,
        hours: Number.isFinite(hoursRaw) ? hoursRaw : undefined,
        timeStart: map.get('time_start') || undefined,
        timeEnd: map.get('time_end') || undefined,
        metric: map.get('metric') || undefined,
    }
}

function emitAssistantAction(action: AssistantActionPayload): void {
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

function parseSubagentBlock(block: string): SubagentBlock | null {
    const normalized = block.trim()
    const match = normalized.match(/^\[SUBAGENT:(.+)\]$/s)
    if (!match) return null

    try {
        const parsed = JSON.parse(match[1]) as SubagentBlock
        if (!parsed || typeof parsed !== 'object') return null
        return parsed
    } catch {
        return null
    }
}

function parseMultiScenarioSelectorBlock(block: string): MultiScenarioSelectorBlock | null {
    const normalized = block.trim()
    const match = normalized.match(/^\[MULTI_SCENARIO_SELECTOR:(.+)\]$/s)
    if (!match) return null

    try {
        const parsed = JSON.parse(match[1]) as MultiScenarioSelectorBlock
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
    } catch {
        return null
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

        const actionPayload = parseAssistantActionToken(block)
        if (actionPayload) {
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
    tone: 'conclusion' | 'scenario' | 'action' | 'risk' | 'pending' | 'source' | 'completeness' | 'evidence'
    label: string
    body: string
}

function parseSemanticMessageBlock(block: string): SemanticMessageBlock | null {
    const text = block.trim()
    if (!text) return null

    const normalized = text.replace(/^#{1,4}\s*/, '')
    const colonMatch = normalized.match(/^(.{2,14}?)[：:]\s*([\s\S]*)$/)
    const headingMatch = normalized.match(/^([^\n：:]{2,14})\n([\s\S]+)$/)
    const match = colonMatch || headingMatch
    if (!match) return null

    const rawLabel = match[1].trim()
    const body = match[2].trimStart()
    const labelKey = rawLabel.replace(/\s+/g, '')
    const labelMap: Array<[RegExp, SemanticMessageBlock['tone']]> = [
        [/^(结论|判断|当前判断|最终结论)$/, 'conclusion'],
        [/^(适用场景|场景|适用范围)$/, 'scenario'],
        [/^(操作要点|建议动作|建议|调度建议|处置步骤|处理步骤)$/, 'action'],
        [/^(风险与禁止项|风险影响|风险提示|风险|禁止项|边界说明)$/, 'risk'],
        [/^(待确认项|待复核项|不确定性说明|待补充项)$/, 'pending'],
        [/^(来源|证据来源|数据来源|规程依据|依据)$/, 'source'],
        [/^(完整性提示|完整性|置信度说明)$/, 'completeness'],
        [/^(证据|已查询|检索证据|命中的库|已检索但未命中的来源)$/, 'evidence'],
    ]

    const matchTone = labelMap.find(([pattern]) => pattern.test(labelKey))
    if (!matchTone) return null

    return {
        tone: matchTone[1],
        label: rawLabel,
        body,
    }
}

function renderMessageContent(
    content: string,
    onAction: (payload: AssistantActionPayload) => void,
    onSend?: (text?: string, options?: HandleSendOptions) => void,
): React.ReactNode {
    const blocks = dedupeSubagentBlocks(stripPrivateThinkBlocks(content).split(/\n\s*\n/))
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

        const semanticBlock = parseSemanticMessageBlock(block)
        if (semanticBlock) {
            return (
                <div
                    key={`block-${index}`}
                    className={`ai-msg-text-block ai-msg-section ai-msg-section-${semanticBlock.tone}`}
                >
                    <span className="ai-msg-section-label">{semanticBlock.label}：</span>
                    {semanticBlock.body ? (
                        <span className="ai-msg-section-body">{semanticBlock.body}</span>
                    ) : null}
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

    const stepCount = dedupeSubagentBlocks(trimmed.split(/\n\s*\n/)).filter(Boolean).length
    const assessmentText = `${userQuestion}\n${trimmed}\n${answer}`
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
                {renderMessageContent(trimmed, onAction, onSend)}
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
                                    <button type="button" onClick={() => handleSend('甪直水露点')} disabled={loading}>单站露点</button>
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
        for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
            const message = chat.messages[index]
            if (message.role === 'assistant') {
                latestAssistantMessage = message
                break
            }
        }
        if (!latestAssistantMessage) return

        const action = latestAssistantMessage.content
            .split(/\n\s*\n/)
            .map(parseAssistantActionToken)
            .find((item): item is AssistantActionPayload => Boolean(item))

        if (!action || action.type !== 'OPEN_HISTORY_PANEL') return

        const signature = [
            action.station || '',
            action.view || '',
            action.hours || 0,
            action.metric || '',
        ].join('|')
        if (lastAutoHistoryActionRef.current === signature) return

        lastAutoHistoryActionRef.current = signature
        window.setTimeout(() => emitAssistantAction(action), 300)
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
    const chat = useAiAssistantChat()

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [chat.messages, chat.loading])

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
