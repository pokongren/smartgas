import React, { useCallback, useEffect, useRef, useState } from 'react'
import './ai-assistant.css'
import { useNewWindow, usePopoutSync } from '../../hooks/useNewWindow'
import { useAiAssistantChat } from './useAiAssistantChat'
import type { ChatMessage } from './useAiAssistantChat'

const TOOL_LABELS: Record<string, string> = {
    query_stations: '获取站场详情',
    query_pipelines: '检索管线主干数据',
    count_by_type: '分类全网基础设施',
    analyze_impact: '演算故障波及范围',
    find_routes: '搜寻拓扑备用路径',
    get_topology_summary: '计算全网管存拓扑',
    simulate_failure: '推演沿线断流影响',
    compare_stations: '并发抓取历史记录并执行指标横向对比分析',
}

const EXAMPLE_QUESTIONS = [
    '管网里有多少个压气站？',
    '列出所有干线管线',
    '管网整体概况',
]

const DATA_ANALYSIS_EXAMPLES = [
    '/数据分析',
    '甪直水露点',
    '甪直站和雅满苏站水露点对比',
    '/退出数据分析',
]

const SUBAGENT_EXAMPLES = [
    '/subagent',
    '请用subagent方式并行侦察当前问题',
    '请用subagent方式给出实施和验证方案',
    '/退出subagent',
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
    return (
        <div className="ai-welcome">
            <div className="ai-welcome-icon">
                <span className="material-symbols-outlined" style={{ fontSize: 26, color: '#60a5fa' }}>
                    smart_toy
                </span>
            </div>
            <h3>你好，我是管网 AI 助手</h3>
            <p>你可以直接问业务，也可以在下方技能区进入“数据分析”或“SubAgent”模式。</p>
            <div className="ai-welcome-divider" />
            <span className="ai-welcome-label">试试问我</span>
            <div className="ai-welcome-examples">
                {examples.map((question) => (
                    <button key={question} onClick={() => onExampleClick(question)}>
                        <span className="material-symbols-outlined example-icon">lightbulb</span>
                        {question}
                    </button>
                ))}
            </div>
        </div>
    )
}

interface TableBlock {
    headers: string[]
    rows: string[][]
}

type AssistantActionType = 'OPEN_LUZHI_HISTORY' | 'OPEN_HISTORY_PANEL'

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
    if (actionType !== 'OPEN_LUZHI_HISTORY' && actionType !== 'OPEN_HISTORY_PANEL') return null

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
    const blocks = content.split(/\n\s*\n/)
    return blocks.map((block, index) => {
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

function renderMessageContent(
    content: string,
    onAction: (payload: AssistantActionPayload) => void,
): React.ReactNode {
    const blocks = content.split(/\n\s*\n/)
    return blocks.map((block, index) => {
        const actionPayload = parseAssistantActionToken(block)
        if (actionPayload) {
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
    dataAnalysisMode: boolean
    subagentMode: boolean
    handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
    handleSend: (text?: string) => void
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

            <div className="ai-messages">
                {messages.length === 0 ? (
                    <WelcomeScreen onExampleClick={handleExampleClick} dataAnalysisMode={dataAnalysisMode} subagentMode={subagentMode} />
                ) : (
                    messages.map((message, index) => (
                        <div key={`${message.role}-${index}`} className={`ai-msg-wrapper ${message.role}`}>
                            <div className={`ai-msg ${message.role}`}>
                                {renderMessageContent(message.content, onAction)}
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
                                <button type="button" onClick={() => handleSend('甪直站和雅满苏站水露点对比')} disabled={loading}>双站对比</button>
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
                        SubAgent Skill
                    </div>
                    <div className="ai-skill-actions">
                        {subagentMode ? (
                            <>
                                <button type="button" onClick={() => handleSend('请用subagent方式并行侦察当前问题，先列证据再给结论。')} disabled={loading}>并行侦察</button>
                                <button type="button" onClick={() => handleSend('请用subagent方式输出实施方案，按侦察、实施、验证三段给出。')} disabled={loading}>实施方案</button>
                                <button type="button" onClick={() => handleSend('请用subagent方式做独立验证，输出风险和回退点。')} disabled={loading}>独立验证</button>
                                <button type="button" onClick={() => handleSend('/退出subagent')} disabled={loading}>退出</button>
                            </>
                        ) : (
                            <button type="button" onClick={() => handleSend('/subagent')} disabled={loading}>进入</button>
                        )}
                    </div>
                </div>
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
                            handleSend={(text?: string) => void chat.handleSend(text)}
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
            handleSend={(text?: string) => void chat.handleSend(text)}
            handleExampleClick={chat.handleExampleClick}
            onAction={emitAssistantAction}
            messagesEndRef={messagesEndRef}
            inputRef={inputRef}
        />
    )
}

export default AiAssistant
