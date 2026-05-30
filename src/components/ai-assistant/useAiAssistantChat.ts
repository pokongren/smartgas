import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, KeyboardEvent, SetStateAction } from 'react'
import { resolveApiPathCandidates } from '@/services/apiBase'
import { ZHONGWEI_MULTI_SCENARIO_CASES } from '@/config/simulationScenarios'
import { useAiAssistantPageContext } from './useAiAssistantPageContext'
import type { AssistantChatContext } from './useAiAssistantPageContext'

export interface ChatMessage {
    role: 'user' | 'assistant'
    content: string
    thinking?: string
    retrieval_log?: string[]
    isStreaming?: boolean
}

export interface ChatRequestPayload {
    message: string
    history: ChatMessage[]
    context?: AssistantChatContext
    analysis_mode?: 'default' | 'subagents'
}

type StreamChunkType = 'REPLY' | 'TOOL' | 'LOG' | 'THINK' | 'ERROR' | 'DONE'

const AI_ASSISTANT_API_URLS = resolveApiPathCandidates('/api/ai-assistant/chat')
const DATA_ANALYSIS_ENTER_PATTERN = /^\s*\/\u6570\u636e\u5206\u6790(?:\s+.+)?\s*$/i
const DATA_ANALYSIS_EXIT_PATTERN = /^\s*\/\u9000\u51fa\u6570\u636e\u5206\u6790\s*$/i
const SUBAGENT_ENTER_PATTERN = /^\s*\/subagent(?:\s+.+)?\s*$/i
const SUBAGENT_EXIT_PATTERN = /^\s*\/\u9000\u51fasubagent\s*$/i
const MULTI_SCENARIO_SELECTOR_PATTERN = /^\s*(?:\/\u591a\u5de5\u51b5ai|\/multi-scenario-ai)(?:\s+.+)?\s*$/i
const MULTI_SCENARIO_EXECUTE_PATTERN = /^\s*\/\u6267\u884c\u591a\u5de5\u51b5ai(?:\s+.+)?\s*$/i
const MULTI_SCENARIO_AI_PATTERN = /(多工况|三工况|3种工况|三种工况|中卫.*3000.*2000.*截断|multi[-\s]?scenario)/i
const SUBAGENT_INTENT_PATTERN = /(subagent|sub agent|多agent|多智能体|专家组|主agent|主控agent)/i
const NETWORKX_CUTOFF_SHOWCASE_PATTERN = /(networkx|NetworkX|全国一张网|全国网|原生截断).*(靖边).*(截断|推演|演示)|靖边.*(networkx|NetworkX|全国一张网|全国网|原生截断).*(截断|推演|演示)/i
const CUTOFF_SHOWCASE_PATTERN = /(地图拓扑|拓扑管理|截断推演|截断演示|断供|绕行).*(演示|自动|操作|一连串|显示|分析)|演示.*(中卫|靖边|永清).*(截断|断供|绕行)/i
const AI_ASSISTANT_SYNC_CHANNEL = 'ai-assistant-sync'

interface MultiScenarioAiEventDetail {
    skillName?: string
    message?: string
    error?: string
    selectedScenarioIds?: string[]
}

interface CutoffShowcaseEventDetail {
    skillName?: string
    station?: string
    stationLabel?: string
    step?: string
    message?: string
    error?: string
    summary?: {
        supplyLost?: number
        rerouted?: number
        same?: number
        stoppedEdges?: number
        rerouteEdges?: number
        sourceCount?: number
        totalDistributionNodes?: number
    }
    affectedNodes?: Array<{ name: string; status: string }>
}

interface NetworkxCutoffShowcaseEventDetail {
    skillName?: string
    message?: string
    error?: string
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

export interface HandleSendOptions {
    selectedScenarioIds?: string[]
    displayText?: string
}

async function postChatWithFallback(payload: ChatRequestPayload): Promise<Response> {
    let lastError: unknown = null

    for (const url of AI_ASSISTANT_API_URLS) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })

            if (response.ok) {
                return response
            }

            lastError = new Error(`HTTP ${response.status} (${url})`)
            if (![404, 502, 503, 504].includes(response.status)) {
                throw lastError
            }
        } catch (error) {
            lastError = error
        }
    }

    const attempted = AI_ASSISTANT_API_URLS.join('、')
    const message = lastError instanceof Error ? lastError.message : '请求失败'
    throw new Error(`${message}；已尝试接口：${attempted}`)
}

async function* fetchChatStream(
    message: string,
    history: ChatMessage[],
    context: AssistantChatContext | undefined,
    analysisMode: 'default' | 'subagents',
): AsyncGenerator<{ type: StreamChunkType; content: string }> {
    const payload: ChatRequestPayload = {
        message,
        history,
        analysis_mode: analysisMode,
    }

    if (context) {
        payload.context = context
    }

    const response = await postChatWithFallback(payload)

    const reader = response.body?.getReader()
    if (!reader) {
        throw new Error('Unable to read response stream')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
            if (!line.trim()) continue

            if (line.startsWith('[REPLY] ')) {
                const rawContent = line.substring(8)
                try {
                    const parsed = JSON.parse(rawContent)
                    yield { type: 'REPLY', content: typeof parsed === 'string' ? parsed : rawContent }
                } catch {
                    yield { type: 'REPLY', content: rawContent }
                }
                continue
            }

            if (line.startsWith('[TOOL] ')) {
                yield { type: 'TOOL', content: line.substring(7) }
                continue
            }

            if (line.startsWith('[LOG] ')) {
                yield { type: 'LOG', content: line.substring(6) }
                continue
            }

            if (line.startsWith('[THINK] ')) {
                const rawContent = line.substring(8)
                try {
                    const parsed = JSON.parse(rawContent)
                    yield { type: 'THINK', content: typeof parsed === 'string' ? parsed : rawContent }
                } catch {
                    yield { type: 'THINK', content: rawContent }
                }
                continue
            }

            if (line.startsWith('[ERROR] ')) {
                yield { type: 'ERROR', content: line.substring(8) }
                continue
            }

            if (line.trim() === '[DONE]') {
                yield { type: 'DONE', content: '' }
                return
            }
        }
    }
}

function updateLastAssistantMessage(
    messages: ChatMessage[],
    updater: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
    const next = [...messages]
    for (let index = next.length - 1; index >= 0; index -= 1) {
        if (next[index].role === 'assistant') {
            next[index] = updater(next[index])
            break
        }
    }
    return next
}

function resolveModesByCommand(
    message: string,
    currentDataMode: boolean,
    currentSubagentMode: boolean,
): { dataMode: boolean; subagentMode: boolean } {
    if (DATA_ANALYSIS_EXIT_PATTERN.test(message)) {
        return { dataMode: false, subagentMode: currentSubagentMode }
    }
    if (SUBAGENT_EXIT_PATTERN.test(message)) {
        return { dataMode: currentDataMode, subagentMode: false }
    }
    if (DATA_ANALYSIS_ENTER_PATTERN.test(message)) {
        return { dataMode: true, subagentMode: false }
    }
    if (SUBAGENT_ENTER_PATTERN.test(message)) {
        return { dataMode: false, subagentMode: true }
    }
    return { dataMode: currentDataMode, subagentMode: currentSubagentMode }
}

function appendThinkingText(current: string | undefined, next: string): string {
    const text = next.trim()
    if (!text) return current || ''
    const mergedSubagentText = mergeSubagentProcessText(current, text)
    if (mergedSubagentText !== null) return mergedSubagentText
    if (!current?.trim()) return text
    if (current.includes(text)) return current
    return `${current.trim()}\n\n${text}`
}

function parseSubagentProcessText(content: string): { key: string; status?: string } | null {
    const match = content.trim().match(/^\[SUBAGENT:(.+)\]$/s)
    if (!match) return null

    try {
        const parsed = JSON.parse(match[1]) as { agent?: string; title?: string; status?: string }
        const key = String(parsed.agent || parsed.title || '').trim()
        if (!key) return null
        return { key, status: parsed.status }
    } catch {
        return null
    }
}

function mergeSubagentProcessText(current: string | undefined, next: string): string | null {
    const nextSubagent = parseSubagentProcessText(next)
    if (!nextSubagent) return null

    if (!current?.trim()) return next

    const blocks = current
        .trim()
        .split(/\n\s*\n/)
        .filter((block) => block.trim())
    const existingIndex = blocks.findIndex((block) => parseSubagentProcessText(block)?.key === nextSubagent.key)

    if (existingIndex >= 0) {
        blocks[existingIndex] = next
    } else {
        blocks.push(next)
    }

    return blocks.join('\n\n')
}

export function stripPrivateThinkBlocks(content: string): string {
    return content
        .replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
        .replace(/<\/?think>/gi, '')
}

function splitPrivateThinkFromChunk(
    content: string,
    insidePrivateThink: boolean,
): { publicContent: string; insidePrivateThink: boolean } {
    let remaining = content
    let publicContent = ''
    let hidden = insidePrivateThink

    while (remaining) {
        if (hidden) {
            const endMatch = remaining.match(/<\/think>/i)
            if (!endMatch || endMatch.index === undefined) {
                return { publicContent, insidePrivateThink: true }
            }
            remaining = remaining.slice(endMatch.index + endMatch[0].length)
            hidden = false
            continue
        }

        const startMatch = remaining.match(/<think>/i)
        if (!startMatch || startMatch.index === undefined) {
            publicContent += remaining
            break
        }

        publicContent += remaining.slice(0, startMatch.index)
        remaining = remaining.slice(startMatch.index + startMatch[0].length)
        hidden = true
    }

    return { publicContent, insidePrivateThink: hidden }
}

function isSubagentProcessBlock(content: string): boolean {
    return /^\s*\[SUBAGENT:[\s\S]+\]\s*$/.test(content)
}

function findFinalReplyStart(content: string): number {
    const patterns = [
        /^\s*#{1,3}\s*(?:结论|汇总答复|答复|结果)/,
        /^\s*\*\*结论[:：]?\*\*/,
        /^\s*结论[:：]/,
        /\n\s*#{1,3}\s*(?:结论|汇总答复|答复|结果)/,
        /\n\s*\*\*结论[:：]?\*\*/,
        /\n\s*结论[:：]/,
    ]
    const indexes = patterns
        .map((pattern) => {
            const match = content.match(pattern)
            return match?.index ?? -1
        })
        .filter((index) => index >= 0)
    return indexes.length > 0 ? Math.min(...indexes) : -1
}

function looksLikePublicProcess(content: string): boolean {
    const text = content.trim()
    if (!text) return false
    if (isSubagentProcessBlock(text)) return true
    return /(用户要求|让我分析|我需要根据|全域检索结果|命中的库|未命中来源|关键点：|现在我需要|首先，raw_excel|检索结果：)/.test(text)
}

function splitReplyForDisplay(
    content: string,
    answerStarted: boolean,
): { reply: string; thinking: string; answerStarted: boolean } {
    const cleanedContent = stripPrivateThinkBlocks(content)
    if (!cleanedContent.trim()) {
        return { reply: '', thinking: '', answerStarted }
    }

    if (isSubagentProcessBlock(cleanedContent)) {
        return { reply: '', thinking: cleanedContent.trim(), answerStarted }
    }

    if (answerStarted) {
        return { reply: cleanedContent, thinking: '', answerStarted: true }
    }

    const finalStart = findFinalReplyStart(cleanedContent)
    if (finalStart >= 0) {
        return {
            thinking: cleanedContent.slice(0, finalStart).trim(),
            reply: cleanedContent.slice(finalStart),
            answerStarted: true,
        }
    }

    if (looksLikePublicProcess(cleanedContent)) {
        return { reply: '', thinking: cleanedContent.trim(), answerStarted: false }
    }

    return { reply: cleanedContent, thinking: '', answerStarted: true }
}

function shouldStartMultiScenarioAi(message: string): boolean {
    return MULTI_SCENARIO_AI_PATTERN.test(message) && /(仿真|比对|比较|演示|skill|运行|调用)/i.test(message)
}

function shouldOpenMultiScenarioSelector(message: string): boolean {
    if (MULTI_SCENARIO_EXECUTE_PATTERN.test(message)) return false
    return MULTI_SCENARIO_SELECTOR_PATTERN.test(message) || shouldStartMultiScenarioAi(message)
}

function shouldExecuteMultiScenarioAi(message: string): boolean {
    return MULTI_SCENARIO_EXECUTE_PATTERN.test(message)
}

function shouldUseSubagentBackendFlow(message: string, subagentMode: boolean): boolean {
    return subagentMode || SUBAGENT_INTENT_PATTERN.test(message)
}

function shouldStartNetworkxCutoffShowcase(message: string): boolean {
    return NETWORKX_CUTOFF_SHOWCASE_PATTERN.test(message)
}

function detectCutoffShowcaseStation(message: string): { station: string; stationLabel: string } | null {
    if (!CUTOFF_SHOWCASE_PATTERN.test(message)) return null
    if (/靖边/.test(message)) return { station: 'jingbian', stationLabel: '靖边压气站' }
    if (/永清/.test(message)) return { station: 'yongqing', stationLabel: '永清压气站' }
    return { station: 'zhongwei', stationLabel: '中卫压气站' }
}

function formatNetworkxCutoffShowcaseProgress(detail: NetworkxCutoffShowcaseEventDetail): string {
    return [
        'NetworkX 靖边截断演示',
        '',
        `当前操作：${detail.message || '正在联动全国一张网页面。'}`,
        '',
        '操作回放：',
        '1. 打开全国管网统一视图',
        '2. 展开 WE1 / SJ2 / SJ4 相关图层',
        '3. 后端构建 NetworkX 全国无向图',
        '4. 移除靖边相关节点并重新寻路',
        '5. 把红色截断段、橙色受影响段、绿色绕行段叠加回地图',
    ].join('\n')
}

function formatCutoffShowcaseProgress(detail: CutoffShowcaseEventDetail): string {
    const stationLabel = detail.stationLabel || '目标站点'
    return [
        '地图拓扑截断推演',
        '',
        `当前操作：${detail.message || '正在联动地图拓扑管理页面。'}`,
        '',
        '操作回放：',
        '1. 打开地图拓扑管理页面',
        '2. 切换到“截断”功能面板',
        `3. 选择截断点：${stationLabel}`,
        '4. 自动运行截断推演',
        '5. 汇总断供、绕行和停流路径',
    ].join('\n')
}

function formatCutoffShowcaseResult(detail: CutoffShowcaseEventDetail): string {
    if (detail.error) {
        return [
            '结论：截断推演没有跑通。',
            '',
            `待确认项：${detail.error}`,
            '',
            '建议：确认当前主窗口已经打开智脉平台，并能进入地图拓扑管理页面。',
        ].join('\n')
    }

    const stationLabel = detail.stationLabel || '目标站点'
    const summary = detail.summary || {}
    const lost = summary.supplyLost ?? 0
    const rerouted = summary.rerouted ?? 0
    const same = summary.same ?? 0
    const stoppedEdges = summary.stoppedEdges ?? 0
    const rerouteEdges = summary.rerouteEdges ?? 0
    const total = summary.totalDistributionNodes ?? (lost + rerouted + same)
    const affectedPreview = (detail.affectedNodes || [])
        .slice(0, 6)
        .map(item => `${item.name}（${item.status === 'supply_lost' ? '断供' : '绕行'}）`)
        .join('、')

    return [
        `结论：${stationLabel}截断推演已完成，影响范围已自动计算。`,
        '',
        `影响：共分析 ${total} 个分输站，其中 ${lost} 个断供、${rerouted} 个绕行、${same} 个保持正常；停流管段 ${stoppedEdges} 条，绕行路径管段 ${rerouteEdges} 条。`,
        '',
        affectedPreview ? `路径分析：重点受影响节点包括 ${affectedPreview}。地图上红色虚线表示停流/关闭方向，橙色路径表示可绕行链路。` : '路径分析：地图已完成截断点和受影响路径高亮。',
        '',
        '建议：汇报时先展示左侧统计卡，再指向地图上的红色停流路径和橙色绕行路径；真实调度使用前，还要补充实时压力、流量和站控边界。',
        '',
        '完整性提示：是，已完成 AI 指令触发、地图自动操作、截断推演和结果回传；该结果用于演示，不能直接替代真实调度指令。',
    ].join('\n')
}

function buildMultiScenarioSelectorMessage(): string {
    const block: MultiScenarioSelectorBlock = {
        title: '多工况AI Skill',
        hint: '先勾选工况，再点击开始仿真比对。',
        cases: ZHONGWEI_MULTI_SCENARIO_CASES.map(item => ({
            id: item.id,
            label: item.label,
            description: item.description,
            selected: true,
        })),
    }

    return [
        '调用 multi-scenario-ai skill',
        '',
        '已生成 3 个候选工况，请先确认选择后再执行。',
        '',
        `[MULTI_SCENARIO_SELECTOR:${JSON.stringify(block)}]`,
    ].join('\n')
}

function dispatchMultiScenarioAiStart(message: string, selectedScenarioIds?: string[]): void {
    const detail = {
        skillName: 'multi-scenario-ai',
        message,
        selectedScenarioIds,
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
        // BroadcastChannel is a convenience path for the popped-out assistant.
    }
}

function isSubagentFinalReplyContent(content: string): boolean {
    const text = stripPrivateThinkBlocks(content).trim()
    return /^结论[:：]/.test(text)
        || /^【AI\s*风险诊断报告】/.test(text)
        || text.includes('Agent证据互证链')
}

function waitForSubagentFinalReady(timeoutMs = 60000): Promise<boolean> {
    if ((window as typeof window & { __smartgasSubagentFinalReady?: boolean }).__smartgasSubagentFinalReady) {
        return Promise.resolve(true)
    }
    return new Promise((resolve) => {
        let done = false
        let channel: BroadcastChannel | null = null
        const cleanup = () => {
            window.removeEventListener('assistant-subagent-demo-final-ready', onReady as EventListener)
            window.removeEventListener('assistant-multi-scenario-ai-result', onReady as EventListener)
            window.removeEventListener('message', onMessage)
            channel?.close()
            window.clearTimeout(timer)
        }
        const finish = (ready: boolean) => {
            if (done) return
            done = true
            cleanup()
            resolve(ready)
        }
        const onReady = () => finish(true)
        const onMessage = (event: MessageEvent) => {
            const payload = event.data as { type?: string } | undefined
            if (
                payload?.type === 'assistant-subagent-demo-final-ready'
                || payload?.type === 'assistant-multi-scenario-ai-result'
            ) finish(true)
        }
        const timer = window.setTimeout(() => finish(false), timeoutMs)

        window.addEventListener('assistant-subagent-demo-final-ready', onReady as EventListener)
        window.addEventListener('assistant-multi-scenario-ai-result', onReady as EventListener)
        window.addEventListener('message', onMessage)
        try {
            channel = new BroadcastChannel(AI_ASSISTANT_SYNC_CHANNEL)
            channel.onmessage = (event) => {
                const payload = event.data as { type?: string } | undefined
                if (
                    payload?.type === 'assistant-subagent-demo-final-ready'
                    || payload?.type === 'assistant-multi-scenario-ai-result'
                ) finish(true)
            }
        } catch {
            channel = null
        }
    })
}

function dispatchSubagentFinalShown(): void {
    const detail = { shown: true }
    window.dispatchEvent(new CustomEvent('assistant-subagent-demo-final-shown', { detail }))
    if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'assistant-subagent-demo-final-shown', detail }, '*')
    }
    try {
        const channel = new BroadcastChannel(AI_ASSISTANT_SYNC_CHANNEL)
        channel.postMessage({ type: 'assistant-subagent-demo-final-shown', detail })
        channel.close()
    } catch {
        // BroadcastChannel is a convenience path for the popped-out assistant.
    }
}

function dispatchCutoffShowcaseStart(message: string, target: { station: string; stationLabel: string }): void {
    const detail = {
        skillName: 'map-topology-cutoff-showcase',
        message,
        station: target.station,
        stationLabel: target.stationLabel,
    }

    window.dispatchEvent(new CustomEvent('assistant-start-cutoff-showcase', { detail }))
    if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'assistant-start-cutoff-showcase', detail }, '*')
    }

    try {
        const channel = new BroadcastChannel(AI_ASSISTANT_SYNC_CHANNEL)
        channel.postMessage({ type: 'assistant-start-cutoff-showcase', detail })
        channel.close()
    } catch {
        // BroadcastChannel is a convenience path for the popped-out assistant.
    }
}

function dispatchNetworkxCutoffShowcaseStart(message: string): void {
    const detail = {
        skillName: 'networkx-cutoff-showcase',
        message,
        station: 'jingbian',
        stationLabel: '靖边枢纽',
    }

    window.dispatchEvent(new CustomEvent('assistant-start-networkx-cutoff-showcase', { detail }))
    if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'assistant-start-networkx-cutoff-showcase', detail }, '*')
    }

    try {
        const channel = new BroadcastChannel(AI_ASSISTANT_SYNC_CHANNEL)
        channel.postMessage({ type: 'assistant-start-networkx-cutoff-showcase', detail })
        channel.close()
    } catch {
        // BroadcastChannel is a convenience path for the popped-out assistant.
    }
}

export interface UseAiAssistantChatResult {
    messages: ChatMessage[]
    input: string
    setInput: Dispatch<SetStateAction<string>>
    loading: boolean
    activeToolName: string
    dataAnalysisMode: boolean
    subagentMode: boolean
    handleSend: (text?: string, options?: HandleSendOptions) => Promise<void>
    handleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
    handleExampleClick: (question: string) => void
}

export function useAiAssistantChat(): UseAiAssistantChatResult {
    const pageContext = useAiAssistantPageContext()
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [activeToolName, setActiveToolName] = useState('')
    const [dataAnalysisMode, setDataAnalysisMode] = useState(false)
    const [subagentMode, setSubagentMode] = useState(false)
    const frontendSkillRunningRef = useRef(false)
    const cutoffShowcaseRunningRef = useRef(false)
    const networkxCutoffShowcaseRunningRef = useRef(false)
    const frontendSkillTimeoutRef = useRef<number | null>(null)
    const cutoffShowcaseTimeoutRef = useRef<number | null>(null)
    const networkxCutoffShowcaseTimeoutRef = useRef<number | null>(null)

    const clearFrontendSkillTimeout = useCallback(() => {
        if (frontendSkillTimeoutRef.current != null) {
            window.clearTimeout(frontendSkillTimeoutRef.current)
            frontendSkillTimeoutRef.current = null
        }
    }, [])

    const clearCutoffShowcaseTimeout = useCallback(() => {
        if (cutoffShowcaseTimeoutRef.current != null) {
            window.clearTimeout(cutoffShowcaseTimeoutRef.current)
            cutoffShowcaseTimeoutRef.current = null
        }
    }, [])

    const clearNetworkxCutoffShowcaseTimeout = useCallback(() => {
        if (networkxCutoffShowcaseTimeoutRef.current != null) {
            window.clearTimeout(networkxCutoffShowcaseTimeoutRef.current)
            networkxCutoffShowcaseTimeoutRef.current = null
        }
    }, [])

    useEffect(() => {
        const handleProgress = (detail: MultiScenarioAiEventDetail) => {
            if (!frontendSkillRunningRef.current) return
            const skillName = detail.skillName || 'multi-scenario-ai'
            const statusText = detail.message || '正在全国一张网执行多工况仿真。'
            setMessages((prev) =>
                updateLastAssistantMessage(prev, (message) => ({
                    ...message,
                    content: `调用 ${skillName} skill\n\n${statusText}`,
                    isStreaming: true,
                })),
            )
        }

        const handleResult = (detail: MultiScenarioAiEventDetail) => {
            if (!frontendSkillRunningRef.current) return
            clearFrontendSkillTimeout()
            frontendSkillRunningRef.current = false
            const skillName = detail.skillName || 'multi-scenario-ai'
            const content = detail.error
                ? `调用 ${skillName} skill 失败\n\n${detail.error}`
                : (detail.message || `${skillName} 已完成。`)
            setMessages((prev) =>
                updateLastAssistantMessage(prev, (message) => ({
                    ...message,
                    content,
                    isStreaming: false,
                })),
            )
            setLoading(false)
            setActiveToolName('')
        }

        const onProgress = (event: Event) => {
            handleProgress((event as CustomEvent<MultiScenarioAiEventDetail>).detail || {})
        }
        const onResult = (event: Event) => {
            handleResult((event as CustomEvent<MultiScenarioAiEventDetail>).detail || {})
        }
        const onMessage = (event: MessageEvent) => {
            const payload = event.data as { type?: string; detail?: MultiScenarioAiEventDetail } | undefined
            if (payload?.type === 'assistant-multi-scenario-ai-progress') handleProgress(payload.detail || {})
            if (payload?.type === 'assistant-multi-scenario-ai-result') handleResult(payload.detail || {})
        }

        let channel: BroadcastChannel | null = null
        try {
            channel = new BroadcastChannel(AI_ASSISTANT_SYNC_CHANNEL)
            channel.onmessage = (event) => {
                const payload = event.data as { type?: string; detail?: MultiScenarioAiEventDetail } | undefined
                if (payload?.type === 'assistant-multi-scenario-ai-progress') handleProgress(payload.detail || {})
                if (payload?.type === 'assistant-multi-scenario-ai-result') handleResult(payload.detail || {})
            }
        } catch {
            channel = null
        }

        window.addEventListener('assistant-multi-scenario-ai-progress', onProgress)
        window.addEventListener('assistant-multi-scenario-ai-result', onResult)
        window.addEventListener('message', onMessage)
        return () => {
            clearFrontendSkillTimeout()
            window.removeEventListener('assistant-multi-scenario-ai-progress', onProgress)
            window.removeEventListener('assistant-multi-scenario-ai-result', onResult)
            window.removeEventListener('message', onMessage)
            channel?.close()
        }
    }, [clearFrontendSkillTimeout])

    useEffect(() => {
        const handleProgress = (detail: CutoffShowcaseEventDetail) => {
            if (!cutoffShowcaseRunningRef.current) return
            setMessages((prev) =>
                updateLastAssistantMessage(prev, (message) => ({
                    ...message,
                    content: formatCutoffShowcaseProgress(detail),
                    thinking: appendThinkingText(message.thinking, detail.message || ''),
                    isStreaming: true,
                })),
            )
        }

        const handleResult = (detail: CutoffShowcaseEventDetail) => {
            if (!cutoffShowcaseRunningRef.current) return
            clearCutoffShowcaseTimeout()
            cutoffShowcaseRunningRef.current = false
            setMessages((prev) =>
                updateLastAssistantMessage(prev, (message) => ({
                    ...message,
                    content: formatCutoffShowcaseResult(detail),
                    thinking: appendThinkingText(message.thinking, detail.message || '地图拓扑截断推演已返回结果。'),
                    isStreaming: false,
                })),
            )
            setLoading(false)
            setActiveToolName('')
        }

        const onProgress = (event: Event) => {
            handleProgress((event as CustomEvent<CutoffShowcaseEventDetail>).detail || {})
        }
        const onResult = (event: Event) => {
            handleResult((event as CustomEvent<CutoffShowcaseEventDetail>).detail || {})
        }
        const onMessage = (event: MessageEvent) => {
            const payload = event.data as { type?: string; detail?: CutoffShowcaseEventDetail } | undefined
            if (payload?.type === 'assistant-cutoff-showcase-progress') handleProgress(payload.detail || {})
            if (payload?.type === 'assistant-cutoff-showcase-result') handleResult(payload.detail || {})
        }

        let channel: BroadcastChannel | null = null
        try {
            channel = new BroadcastChannel(AI_ASSISTANT_SYNC_CHANNEL)
            channel.onmessage = (event) => {
                const payload = event.data as { type?: string; detail?: CutoffShowcaseEventDetail } | undefined
                if (payload?.type === 'assistant-cutoff-showcase-progress') handleProgress(payload.detail || {})
                if (payload?.type === 'assistant-cutoff-showcase-result') handleResult(payload.detail || {})
            }
        } catch {
            channel = null
        }

        window.addEventListener('assistant-cutoff-showcase-progress', onProgress)
        window.addEventListener('assistant-cutoff-showcase-result', onResult)
        window.addEventListener('message', onMessage)
        return () => {
            clearCutoffShowcaseTimeout()
            window.removeEventListener('assistant-cutoff-showcase-progress', onProgress)
            window.removeEventListener('assistant-cutoff-showcase-result', onResult)
            window.removeEventListener('message', onMessage)
            channel?.close()
        }
    }, [clearCutoffShowcaseTimeout])

    useEffect(() => {
        const handleProgress = (detail: NetworkxCutoffShowcaseEventDetail) => {
            if (!networkxCutoffShowcaseRunningRef.current) return
            setMessages((prev) =>
                updateLastAssistantMessage(prev, (message) => ({
                    ...message,
                    content: formatNetworkxCutoffShowcaseProgress(detail),
                    thinking: appendThinkingText(message.thinking, detail.message || ''),
                    isStreaming: true,
                })),
            )
        }

        const handleResult = (detail: NetworkxCutoffShowcaseEventDetail) => {
            if (!networkxCutoffShowcaseRunningRef.current) return
            clearNetworkxCutoffShowcaseTimeout()
            networkxCutoffShowcaseRunningRef.current = false
            const content = detail.error
                ? ['结论：NetworkX 靖边截断演示没有跑通。', '', `待确认项：${detail.error}`].join('\n')
                : (detail.message || '结论：NetworkX 靖边截断演示已完成。')
            setMessages((prev) =>
                updateLastAssistantMessage(prev, (message) => ({
                    ...message,
                    content,
                    thinking: appendThinkingText(message.thinking, detail.message || 'NetworkX 靖边截断演示已返回结果。'),
                    isStreaming: false,
                })),
            )
            setLoading(false)
            setActiveToolName('')
        }

        const onProgress = (event: Event) => {
            handleProgress((event as CustomEvent<NetworkxCutoffShowcaseEventDetail>).detail || {})
        }
        const onResult = (event: Event) => {
            handleResult((event as CustomEvent<NetworkxCutoffShowcaseEventDetail>).detail || {})
        }
        const onMessage = (event: MessageEvent) => {
            const payload = event.data as { type?: string; detail?: NetworkxCutoffShowcaseEventDetail } | undefined
            if (payload?.type === 'assistant-networkx-cutoff-showcase-progress') handleProgress(payload.detail || {})
            if (payload?.type === 'assistant-networkx-cutoff-showcase-result') handleResult(payload.detail || {})
        }

        let channel: BroadcastChannel | null = null
        try {
            channel = new BroadcastChannel(AI_ASSISTANT_SYNC_CHANNEL)
            channel.onmessage = (event) => {
                const payload = event.data as { type?: string; detail?: NetworkxCutoffShowcaseEventDetail } | undefined
                if (payload?.type === 'assistant-networkx-cutoff-showcase-progress') handleProgress(payload.detail || {})
                if (payload?.type === 'assistant-networkx-cutoff-showcase-result') handleResult(payload.detail || {})
            }
        } catch {
            channel = null
        }

        window.addEventListener('assistant-networkx-cutoff-showcase-progress', onProgress)
        window.addEventListener('assistant-networkx-cutoff-showcase-result', onResult)
        window.addEventListener('message', onMessage)
        return () => {
            clearNetworkxCutoffShowcaseTimeout()
            window.removeEventListener('assistant-networkx-cutoff-showcase-progress', onProgress)
            window.removeEventListener('assistant-networkx-cutoff-showcase-result', onResult)
            window.removeEventListener('message', onMessage)
            channel?.close()
        }
    }, [clearNetworkxCutoffShowcaseTimeout])

    const handleSend = useCallback(async (text?: string, options?: HandleSendOptions) => {
        const nextMessage = (text || input).trim()
        if (!nextMessage || loading) return

        const nextModes = resolveModesByCommand(nextMessage, dataAnalysisMode, subagentMode)
        const analysisMode = nextModes.subagentMode ? 'subagents' : 'default'
        const useSubagentBackendFlow = shouldUseSubagentBackendFlow(nextMessage, nextModes.subagentMode)
        const waitForManualSubagentSimulation = useSubagentBackendFlow && /(2000|3000|截断|三工况|三种工况)/i.test(nextMessage)
        if (waitForManualSubagentSimulation) {
            ;(window as typeof window & { __smartgasSubagentFinalReady?: boolean }).__smartgasSubagentFinalReady = false
        }
        const historySnapshot = messages
        const visibleMessage = options?.displayText?.trim() || nextMessage
        const userMessage: ChatMessage = { role: 'user', content: visibleMessage }
        const assistantPlaceholder: ChatMessage = {
            role: 'assistant',
            content: '',
            thinking: '理解问题：正在判断问题类型、可用数据源和是否需要调用工具。',
            isStreaming: true,
        }

        setInput('')
        setMessages((prev) => [...prev, userMessage, assistantPlaceholder])
        setLoading(true)
        setActiveToolName('')

        if (nextModes.dataMode !== dataAnalysisMode) {
            setDataAnalysisMode(nextModes.dataMode)
        }
        if (nextModes.subagentMode !== subagentMode) {
            setSubagentMode(nextModes.subagentMode)
        }

        if (!useSubagentBackendFlow && shouldOpenMultiScenarioSelector(nextMessage)) {
            setMessages((prev) =>
                updateLastAssistantMessage(prev, (message) => ({
                    ...message,
                    content: buildMultiScenarioSelectorMessage(),
                    thinking: appendThinkingText(message.thinking, '选择工况：识别到多工况仿真意图，先让用户确认要跑哪些场景。'),
                    isStreaming: false,
                })),
            )
            setLoading(false)
            setActiveToolName('')
            return
        }

        if (!useSubagentBackendFlow && shouldExecuteMultiScenarioAi(nextMessage)) {
            const selectedCount = options?.selectedScenarioIds?.length || 3
            frontendSkillRunningRef.current = true
            setActiveToolName('multi-scenario-ai')
            setMessages((prev) =>
                updateLastAssistantMessage(prev, (message) => ({
                        ...message,
                        content: `调用 multi-scenario-ai skill\n\n已选择 ${selectedCount} 个工况，正在全国一张网按所选顺序执行仿真。`,
                        thinking: appendThinkingText(message.thinking, `启动前端 Skill：已选择 ${selectedCount} 个工况，准备触发全国一张网仿真流程。`),
                    })),
            )
            dispatchMultiScenarioAiStart(nextMessage, options?.selectedScenarioIds)
            clearFrontendSkillTimeout()
            frontendSkillTimeoutRef.current = window.setTimeout(() => {
                if (!frontendSkillRunningRef.current) return
                frontendSkillRunningRef.current = false
                setMessages((prev) =>
                    updateLastAssistantMessage(prev, (message) => ({
                        ...message,
                        content: '调用 multi-scenario-ai skill 超时\n\n全国一张网没有返回仿真结果，请确认当前页面是全国管网统一视图，且后端仿真服务正在运行。',
                        isStreaming: false,
                    })),
                )
                setLoading(false)
                setActiveToolName('')
            }, 120000)
            return
        }

        if (!useSubagentBackendFlow && shouldStartNetworkxCutoffShowcase(nextMessage)) {
            networkxCutoffShowcaseRunningRef.current = true
            setActiveToolName('networkx-cutoff-showcase')
            setMessages((prev) =>
                updateLastAssistantMessage(prev, (message) => ({
                    ...message,
                    content: formatNetworkxCutoffShowcaseProgress({
                        message: '已识别“全国一张网 + NetworkX 靖边截断”演示意图，准备打开全国网图。',
                    }),
                    thinking: appendThinkingText(
                        message.thinking,
                        '启动前端演示：目标为靖边枢纽，算法使用后端 NetworkX 原生截断，结果回填全国一张网。',
                    ),
                })),
            )
            dispatchNetworkxCutoffShowcaseStart(nextMessage)
            clearNetworkxCutoffShowcaseTimeout()
            networkxCutoffShowcaseTimeoutRef.current = window.setTimeout(() => {
                if (!networkxCutoffShowcaseRunningRef.current) return
                networkxCutoffShowcaseRunningRef.current = false
                setMessages((prev) =>
                    updateLastAssistantMessage(prev, (message) => ({
                        ...message,
                        content: ['结论：NetworkX 靖边截断演示没有返回结果。', '', '待确认项：全国一张网页面没有在限定时间内返回截断推演结果。'].join('\n'),
                        isStreaming: false,
                    })),
                )
                setLoading(false)
                setActiveToolName('')
            }, 60000)
            return
        }

        const cutoffShowcaseTarget = detectCutoffShowcaseStation(nextMessage)
        if (!useSubagentBackendFlow && cutoffShowcaseTarget) {
            cutoffShowcaseRunningRef.current = true
            setActiveToolName('map-topology-cutoff-showcase')
            setMessages((prev) =>
                updateLastAssistantMessage(prev, (message) => ({
                    ...message,
                    content: formatCutoffShowcaseProgress({
                        station: cutoffShowcaseTarget.station,
                        stationLabel: cutoffShowcaseTarget.stationLabel,
                        message: '已识别截断推演演示意图，准备联动地图拓扑页面。',
                    }),
                    thinking: appendThinkingText(
                        message.thinking,
                        `启动前端演示：目标截断点 ${cutoffShowcaseTarget.stationLabel}，准备打开地图拓扑、切换截断面板并运行推演。`,
                    ),
                })),
            )
            dispatchCutoffShowcaseStart(nextMessage, cutoffShowcaseTarget)
            clearCutoffShowcaseTimeout()
            cutoffShowcaseTimeoutRef.current = window.setTimeout(() => {
                if (!cutoffShowcaseRunningRef.current) return
                cutoffShowcaseRunningRef.current = false
                setMessages((prev) =>
                    updateLastAssistantMessage(prev, (message) => ({
                        ...message,
                        content: formatCutoffShowcaseResult({
                            station: cutoffShowcaseTarget.station,
                            stationLabel: cutoffShowcaseTarget.stationLabel,
                            error: '地图拓扑页面没有在限定时间内返回截断推演结果。',
                        }),
                        isStreaming: false,
                    })),
                )
                setLoading(false)
                setActiveToolName('')
            }, 60000)
            return
        }

        try {
            const stream = fetchChatStream(nextMessage, historySnapshot, pageContext, analysisMode)
            let fullReply = ''
            let deferredSubagentFinalReply = ''
            let subagentFinalDeferred = false
            let answerStarted = false
            let insidePrivateThink = false

            for await (const chunk of stream) {
                if (chunk.type === 'REPLY') {
                    const filtered = splitPrivateThinkFromChunk(chunk.content, insidePrivateThink)
                    insidePrivateThink = filtered.insidePrivateThink
                    if (
                        useSubagentBackendFlow
                        && waitForManualSubagentSimulation
                        && (subagentFinalDeferred || isSubagentFinalReplyContent(filtered.publicContent))
                    ) {
                        deferredSubagentFinalReply += filtered.publicContent
                        subagentFinalDeferred = true
                        setMessages((prev) =>
                            updateLastAssistantMessage(prev, (message) => ({
                                ...message,
                                thinking: appendThinkingText(
                                    message.thinking,
                                    '主 Agent 已收到最终材料，等待三工况仿真完成后再统一输出结论。',
                                ),
                            })),
                        )
                        continue
                    }
                    const split = splitReplyForDisplay(filtered.publicContent, answerStarted)
                    answerStarted = split.answerStarted
                    if (split.reply) {
                        fullReply += split.reply
                    }
                    setMessages((prev) =>
                        updateLastAssistantMessage(prev, (message) => ({
                            ...message,
                            content: fullReply,
                            thinking: appendThinkingText(message.thinking, split.thinking),
                        })),
                    )
                    continue
                }

                if (chunk.type === 'TOOL') {
                    setActiveToolName(chunk.content)
                    setMessages((prev) =>
                        updateLastAssistantMessage(prev, (message) => ({
                            ...message,
                            thinking: appendThinkingText(
                                message.thinking,
                                `调用工具：${chunk.content}，正在读取对应数据。`,
                            ),
                        })),
                    )
                    continue
                }

                if (chunk.type === 'LOG') {
                    const retrievalLog = chunk.content.split(', ').filter(Boolean)
                    setMessages((prev) =>
                        updateLastAssistantMessage(prev, (message) => ({
                            ...message,
                            retrieval_log: retrievalLog,
                            thinking: appendThinkingText(
                                message.thinking,
                                `检索证据：${retrievalLog.join('、')}`,
                            ),
                        })),
                    )
                    continue
                }

                if (chunk.type === 'THINK') {
                    setMessages((prev) =>
                        updateLastAssistantMessage(prev, (message) => ({
                            ...message,
                            thinking: appendThinkingText(message.thinking, chunk.content),
                        })),
                    )
                    continue
                }

                if (chunk.type === 'ERROR') {
                    throw new Error(chunk.content)
                }

                if (chunk.type === 'DONE') {
                    break
                }
            }

            if (deferredSubagentFinalReply.trim()) {
                const finalReplyToRelease = deferredSubagentFinalReply
                const replyPrefix = fullReply
                setMessages((prev) =>
                    updateLastAssistantMessage(prev, (message) => ({
                        ...message,
                        isStreaming: false,
                        thinking: appendThinkingText(
                            message.thinking,
                            '最终答复已暂存：等待三工况仿真完成信号，随后自动显示主 Agent 汇总结论。',
                        ),
                    })),
                )
                void (async () => {
                    await waitForSubagentFinalReady()
                    setMessages((prev) =>
                        updateLastAssistantMessage(prev, (message) => ({
                            ...message,
                            content: `${replyPrefix}${finalReplyToRelease}`,
                            thinking: appendThinkingText(
                                message.thinking,
                                '三工况仿真已完成，主 Agent 汇总结论已输出。',
                            ),
                            isStreaming: false,
                        })),
                    )
                    dispatchSubagentFinalShown()
                })()
                return
            }

            setMessages((prev) =>
                updateLastAssistantMessage(prev, (message) => ({
                    ...message,
                    isStreaming: false,
                })),
            )
        } catch (error) {
            const errorMessage = `❌ ${error instanceof Error ? error.message : '请求失败'}`
            setMessages((prev) => {
                const lastMessage = prev[prev.length - 1]
                if (lastMessage?.role === 'assistant' && !lastMessage.content) {
                    return updateLastAssistantMessage(prev, (message) => ({
                        ...message,
                        content: errorMessage,
                        thinking: appendThinkingText(message.thinking, '请求失败：已停止本轮处理。'),
                        isStreaming: false,
                    }))
                }

                return [...prev, { role: 'assistant', content: errorMessage }]
            })
        } finally {
            setLoading(false)
            setActiveToolName('')
        }
    }, [dataAnalysisMode, input, loading, messages, pageContext, subagentMode])

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void handleSend()
        }
    }, [handleSend])

    const handleExampleClick = useCallback((question: string) => {
        void handleSend(question)
    }, [handleSend])

    return {
        messages,
        input,
        setInput,
        loading,
        activeToolName,
        dataAnalysisMode,
        subagentMode,
        handleSend,
        handleKeyDown,
        handleExampleClick,
    }
}
