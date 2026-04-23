import { useCallback, useState } from 'react'
import type { Dispatch, KeyboardEvent, SetStateAction } from 'react'
import { resolveApiPath } from '@/services/apiBase'
import { useAiAssistantPageContext } from './useAiAssistantPageContext'
import type { AssistantChatContext } from './useAiAssistantPageContext'

export interface ChatMessage {
    role: 'user' | 'assistant'
    content: string
    retrieval_log?: string[]
    isStreaming?: boolean
}

export interface ChatRequestPayload {
    message: string
    history: ChatMessage[]
    context?: AssistantChatContext
    analysis_mode?: 'default' | 'subagents'
}

type StreamChunkType = 'REPLY' | 'TOOL' | 'LOG' | 'ERROR'

const AI_ASSISTANT_API_URL = resolveApiPath('/api/ai-assistant/chat')
const DATA_ANALYSIS_ENTER_PATTERN = /^\s*\/\u6570\u636e\u5206\u6790(?:\s+.+)?\s*$/i
const DATA_ANALYSIS_EXIT_PATTERN = /^\s*\/\u9000\u51fa\u6570\u636e\u5206\u6790\s*$/i
const SUBAGENT_ENTER_PATTERN = /^\s*\/subagent(?:\s+.+)?\s*$/i
const SUBAGENT_EXIT_PATTERN = /^\s*\/\u9000\u51fasubagent\s*$/i

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

export interface UseAiAssistantChatResult {
    messages: ChatMessage[]
    input: string
    setInput: Dispatch<SetStateAction<string>>
    loading: boolean
    activeToolName: string
    dataAnalysisMode: boolean
    subagentMode: boolean
    handleSend: (text?: string) => Promise<void>
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

    const handleSend = useCallback(async (text?: string) => {
        const nextMessage = (text || input).trim()
        if (!nextMessage || loading) return

        const nextModes = resolveModesByCommand(nextMessage, dataAnalysisMode, subagentMode)
        const analysisMode = nextModes.subagentMode ? 'subagents' : 'default'
        const historySnapshot = messages
        const userMessage: ChatMessage = { role: 'user', content: nextMessage }
        const assistantPlaceholder: ChatMessage = {
            role: 'assistant',
            content: '',
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

        try {
            const stream = fetchChatStream(nextMessage, historySnapshot, pageContext, analysisMode)
            let fullReply = ''

            for await (const chunk of stream) {
                if (chunk.type === 'REPLY') {
                    fullReply += chunk.content
                    setMessages((prev) =>
                        updateLastAssistantMessage(prev, (message) => ({
                            ...message,
                            content: fullReply,
                        })),
                    )
                    continue
                }

                if (chunk.type === 'TOOL') {
                    setActiveToolName(chunk.content)
                    continue
                }

                if (chunk.type === 'LOG') {
                    const retrievalLog = chunk.content.split(', ').filter(Boolean)
                    setMessages((prev) =>
                        updateLastAssistantMessage(prev, (message) => ({
                            ...message,
                            retrieval_log: retrievalLog,
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
