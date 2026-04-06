import React, { useCallback, useEffect, useRef, useState } from 'react'
import './ai-assistant.css'
import { useNewWindow, usePopoutSync } from '../../hooks/useNewWindow'
import { useAiAssistantChat } from './useAiAssistantChat'
import type { ChatMessage } from './useAiAssistantChat'

const TOOL_LABELS: Record<string, string> = {
    query_stations: '查询站场',
    query_pipelines: '查询管线',
    count_by_type: '统计数量',
    analyze_impact: '影响分析',
    find_routes: '路径搜索',
    get_topology_summary: '拓扑概览',
    simulate_failure: '断流推演',
}

const EXAMPLE_QUESTIONS = [
    '管网里有多少个压气站？',
    '列出所有干线管线',
    '管网整体概况',
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

const WelcomeScreen: React.FC<{ onExampleClick: (question: string) => void }> = ({ onExampleClick }) => (
    <div className="ai-welcome">
        <div className="ai-welcome-icon">
            <span className="material-symbols-outlined" style={{ fontSize: 26, color: '#60a5fa' }}>
                smart_toy
            </span>
        </div>
        <h3>你好，我是管网 AI 助手</h3>
        <p>用自然语言查询管网数据、分析故障影响、执行断流推演。</p>
        <div className="ai-welcome-divider" />
        <span className="ai-welcome-label">试试问我</span>
        <div className="ai-welcome-examples">
            {EXAMPLE_QUESTIONS.map((question) => (
                <button key={question} onClick={() => onExampleClick(question)}>
                    <span className="material-symbols-outlined example-icon">lightbulb</span>
                    {question}
                </button>
            ))}
        </div>
    </div>
)

interface TableBlock {
    headers: string[]
    rows: string[][]
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

function renderMessageContent(content: string): React.ReactNode {
    const blocks = content.split(/\n\s*\n/)

    return blocks.map((block, index) => {
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
    handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
    handleSend: (text?: string) => void
    handleExampleClick: (question: string) => void
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
    handleKeyDown,
    handleSend,
    handleExampleClick,
    messagesEndRef,
    inputRef,
}) => {
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

            <div className="ai-messages">
                {messages.length === 0 ? (
                    <WelcomeScreen onExampleClick={handleExampleClick} />
                ) : (
                    messages.map((message, index) => (
                        <div key={`${message.role}-${index}`} className={`ai-msg-wrapper ${message.role}`}>
                            <div className={`ai-msg ${message.role}`}>
                                {renderMessageContent(message.content)}
                            </div>
                            {message.retrieval_log && message.retrieval_log.length > 0 && (
                                <div className="ai-retrieval-log">
                                    <span className="material-symbols-outlined">folder_open</span>
                                    检索文件: {message.retrieval_log.join(', ')}
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
                    onKeyDown={handleKeyDown}
                    placeholder="输入你的问题..."
                    disabled={loading}
                />
                <button
                    id="ai-assistant-send"
                    className="ai-send-btn"
                    onClick={() => void handleSend()}
                    disabled={!input.trim() || loading}
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        send
                    </span>
                </button>
            </div>
        </div>
    )
}

const AiAssistant: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
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
        if (!isOpen) return

        const timer = window.setTimeout(() => inputRef.current?.focus(), 300)
        return () => window.clearTimeout(timer)
    }, [isOpen])

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
                            popOut={() => popOut(450, 750, 'AI 调度工作流助手')}
                            setIsOpen={setIsOpen}
                            messages={chat.messages}
                            loading={chat.loading}
                            activeToolName={chat.activeToolName}
                            input={chat.input}
                            setInput={chat.setInput}
                            handleKeyDown={chat.handleKeyDown}
                            handleSend={(text?: string) => void chat.handleSend(text)}
                            handleExampleClick={chat.handleExampleClick}
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
            handleKeyDown={chat.handleKeyDown}
            handleSend={(text?: string) => void chat.handleSend(text)}
            handleExampleClick={chat.handleExampleClick}
            messagesEndRef={messagesEndRef}
            inputRef={inputRef}
        />
    )
}

export default AiAssistant
