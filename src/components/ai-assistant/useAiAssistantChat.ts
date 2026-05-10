import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, KeyboardEvent, SetStateAction } from 'react'
import { resolveApiPath } from '@/services/apiBase'
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

type StreamChunkType = 'REPLY' | 'TOOL' | 'LOG' | 'THINK' | 'ERROR'

const AI_ASSISTANT_API_URL = resolveApiPath('/api/ai-assistant/chat')
const DATA_ANALYSIS_ENTER_PATTERN = /^\s*\/\u6570\u636e\u5206\u6790(?:\s+.+)?\s*$/i
const DATA_ANALYSIS_EXIT_PATTERN = /^\s*\/\u9000\u51fa\u6570\u636e\u5206\u6790\s*$/i
const SUBAGENT_ENTER_PATTERN = /^\s*\/subagent(?:\s+.+)?\s*$/i
const SUBAGENT_EXIT_PATTERN = /^\s*\/\u9000\u51fasubagent\s*$/i
const MULTI_SCENARIO_SELECTOR_PATTERN = /^\s*(?:\/\u591a\u5de5\u51b5ai|\/multi-scenario-ai)(?:\s+.+)?\s*$/i
const MULTI_SCENARIO_EXECUTE_PATTERN = /^\s*\/\u6267\u884c\u591a\u5de5\u51b5ai(?:\s+.+)?\s*$/i
const MULTI_SCENARIO_AI_PATTERN = /(多工况|三工况|3种工况|三种工况|中卫.*3000.*2000.*截断|multi[-\s]?scenario)/i
const AI_ASSISTANT_SYNC_CHANNEL = 'ai-assistant-sync'

interface MultiScenarioAiEventDetail {
    skillName?: string
    message?: string
    error?: string
    selectedScenarioIds?: string[]
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

    const response = await fetch(AI_ASSISTANT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
    }

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
    if (!current?.trim()) return text
    if (current.includes(text)) return current
    return `${current.trim()}\n\n${text}`
}

function isSubagentProcessBlock(content: string): boolean {
    return /^\s*\[SUBAGENT:[\s\S]+\]\s*$/.test(content)
}

function findFinalReplyStart(content: string): number {
    const patterns = [
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
    if (isSubagentProcessBlock(content)) {
        return { reply: '', thinking: content.trim(), answerStarted }
    }

    if (answerStarted) {
        return { reply: content, thinking: '', answerStarted: true }
    }

    const finalStart = findFinalReplyStart(content)
    if (finalStart >= 0) {
        return {
            thinking: content.slice(0, finalStart).trim(),
            reply: content.slice(finalStart),
            answerStarted: true,
        }
    }

    if (looksLikePublicProcess(content)) {
        return { reply: '', thinking: content.trim(), answerStarted: false }
    }

    return { reply: content, thinking: '', answerStarted: true }
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

function buildMultiScenarioSelectorMessage(): string {
    const block: MultiScenarioSelectorBlock = {
        title: '多工况AI Skill',
        hint: '先勾选工况，再点击开始仿真比对。',
        cases: [
            {
                id: 'zhongwei-3000',
                label: '中卫 3000 万标方/天',
                description: '基准供气工况，验证常规稳态能跑通。',
                selected: true,
            },
            {
                id: 'zhongwei-2000',
                label: '中卫 2000 万标方/天',
                description: '上游供气下降工况，观察压力、流量和缺口变化。',
                selected: true,
            },
            {
                id: 'zhongwei-cutoff',
                label: '中卫截断',
                description: '上游首段关闭工况，演示故障传播和供气缺口。',
                selected: true,
            },
        ],
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
    const frontendSkillTimeoutRef = useRef<number | null>(null)

    const clearFrontendSkillTimeout = useCallback(() => {
        if (frontendSkillTimeoutRef.current != null) {
            window.clearTimeout(frontendSkillTimeoutRef.current)
            frontendSkillTimeoutRef.current = null
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

    const handleSend = useCallback(async (text?: string, options?: HandleSendOptions) => {
        const nextMessage = (text || input).trim()
        if (!nextMessage || loading) return

        const nextModes = resolveModesByCommand(nextMessage, dataAnalysisMode, subagentMode)
        const analysisMode = nextModes.subagentMode ? 'subagents' : 'default'
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

        if (shouldOpenMultiScenarioSelector(nextMessage)) {
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

        if (shouldExecuteMultiScenarioAi(nextMessage)) {
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

        try {
            const stream = fetchChatStream(nextMessage, historySnapshot, pageContext, analysisMode)
            let fullReply = ''
            let answerStarted = false

            for await (const chunk of stream) {
                if (chunk.type === 'REPLY') {
                    const split = splitReplyForDisplay(chunk.content, answerStarted)
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
