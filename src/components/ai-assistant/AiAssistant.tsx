/**
 * AI 对话助手组件
 * 全局浮动聊天气泡 + 可拖动的对话面板
 * 通过自然语言调用系统已有的查询、分析、推演功能
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import './ai-assistant.css';
import { useNewWindow, usePopoutSync } from '../../hooks/useNewWindow';

// ============ 类型定义 ============

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    retrieval_log?: string[];
    isStreaming?: boolean;
}

interface ToolCallInfo {
    tool_name: string;
    tool_args: Record<string, unknown>;
    tool_result: string;
}

interface ChatResponse {
    reply: string;
    tool_calls: ToolCallInfo[];
    retrieval_log?: string[];
}

// 工具名称的中文映射，方便前端展示
const TOOL_LABELS: Record<string, string> = {
    query_stations: '查询站场',
    query_pipelines: '查询管线',
    count_by_type: '统计数量',
    analyze_impact: '影响分析',
    find_routes: '路径搜索',
    get_topology_summary: '拓扑概览',
    simulate_failure: '断流推演',
};

// 示例问题，引导用户快速上手
const EXAMPLE_QUESTIONS = [
    '管网里有多少个压气站？',
    '列出所有干线管线',
    '管网整体概况',
];

// ============ API 调用 ============

const API_URL = '/api/ai-assistant/chat';

/**
 * 调用 AI 助手流式对话接口
 */
async function* fetchChatStream(
    message: string,
    history: ChatMessage[],
): AsyncGenerator<{ type: 'REPLY' | 'TOOL' | 'LOG' | 'ERROR', content: string }> {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
    });

    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) continue;

            if (line.startsWith('[REPLY] ')) {
                try {
                    const parsed = JSON.parse(line.substring(8));
                    yield { type: 'REPLY', content: parsed };
                } catch (e) {
                    yield { type: 'REPLY', content: line.substring(8) };
                }
            } else if (line.startsWith('[TOOL] ')) {
                yield { type: 'TOOL', content: line.substring(7) };
            } else if (line.startsWith('[LOG] ')) {
                yield { type: 'LOG', content: line.substring(6) };
            } else if (line.startsWith('[ERROR] ')) {
                yield { type: 'ERROR', content: line.substring(8) };
            }
        }
    }
}

// ============ 拖拽 Hook ============

/**
 * 自定义 Hook：实现元素拖拽功能
 * 使用 ref 存储位置避免闭包陷阱
 */
function useDrag(initialPos: { x: number; y: number }) {
    const [, setRenderTick] = useState(0);
    const posRef = useRef(initialPos);
    const isDraggingRef = useRef(false);
    const [isDragging, setIsDragging] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        isDraggingRef.current = true;
        setIsDragging(true);
        dragOffset.current = {
            x: e.clientX - posRef.current.x,
            y: e.clientY - posRef.current.y,
        };
        e.preventDefault();
        e.stopPropagation();

        // NOTE: 拖拽时给 body 添加全局样式，防止鼠标移出面板后文本选择中断拖拽
        document.body.classList.add('ai-dragging-active');

        const handleMouseMove = (ev: MouseEvent) => {
            if (!isDraggingRef.current) return;
            ev.preventDefault();
            const newX = ev.clientX - dragOffset.current.x;
            const newY = ev.clientY - dragOffset.current.y;
            // 边界限制：不超出视窗
            posRef.current = {
                x: Math.max(0, Math.min(newX, window.innerWidth - 100)),
                y: Math.max(0, Math.min(newY, window.innerHeight - 100)),
            };
            // 触发重渲染更新位置
            setRenderTick((t) => t + 1);
        };

        const handleMouseUp = () => {
            isDraggingRef.current = false;
            setIsDragging(false);
            document.body.classList.remove('ai-dragging-active');
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, []);

    return { position: posRef.current, isDragging, handleMouseDown };
}

// ============ 主组件 ============

const AiAssistant: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [activeToolName, setActiveToolName] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // 新窗口 Pop-out Hook
    const { isPoppedOut, popOut, closePopOut } = useNewWindow('ai-assistant-sync', '/popout/assistant');

    // 拖拽：面板初始位置在左下角
    const { position, isDragging, handleMouseDown } = useDrag({
        x: 24,
        y: typeof window !== 'undefined' ? window.innerHeight - 560 - 92 : 200,
    });

    // 拖拽：浮动按钮也可拖动 (如果是作为独立页面渲染则不需要这个 Hook 调用)
    const fabDrag = useDrag({
        x: 24,
        y: typeof window !== 'undefined' ? window.innerHeight - 80 : 600,
    });

    // 自动滚动到底部
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    // 打开面板时自动聚焦输入框
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 300);
        }
    }, [isOpen]);

    /** 发送消息 */
    const handleSend = useCallback(async (text?: string) => {
        const msg = (text || input).trim();
        if (!msg || loading) return;

        setInput('');
        const userMsg: ChatMessage = { role: 'user', content: msg };
        setMessages((prev) => [...prev, userMsg]);
        setLoading(true);
        setActiveToolName('');

        // 预创建一个助手消息用于流式更新
        const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: '',
            isStreaming: true
        };
        setMessages((prev) => [...prev, assistantMsg]);

        try {
            const stream = fetchChatStream(msg, messages);
            let fullReply = '';
            let logs: string[] = [];

            for await (const chunk of stream) {
                if (chunk.type === 'REPLY') {
                    fullReply += chunk.content;
                    setMessages((prev) => {
                        const next = [...prev];
                        const last = next[next.length - 1];
                        if (last && last.role === 'assistant') {
                            last.content = fullReply;
                        }
                        return next;
                    });
                } else if (chunk.type === 'TOOL') {
                    setActiveToolName(chunk.content);
                } else if (chunk.type === 'LOG') {
                    logs = chunk.content.split(', ');
                    setMessages((prev) => {
                        const next = [...prev];
                        const last = next[next.length - 1];
                        if (last && last.role === 'assistant') {
                            last.retrieval_log = logs;
                        }
                        return next;
                    });
                } else if (chunk.type === 'ERROR') {
                    throw new Error(chunk.content);
                }
            }

            // 完成流式传输
            setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                    last.isStreaming = false;
                }
                return next;
            });

        } catch (e) {
            setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant' && !last.content) {
                    last.content = `❌ ${e instanceof Error ? e.message : '请求失败'}`;
                } else {
                    next.push({ role: 'assistant', content: `❌ ${e instanceof Error ? e.message : '连接异常'}` });
                }
                return next;
            });
        } finally {
            setLoading(false);
            setActiveToolName('');
        }
    }, [input, loading, messages]);

    /** 键盘事件：回车发送 */
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

    /** 点击示例问题快速发送 */
    const handleExampleClick = useCallback((question: string) => {
        handleSend(question);
    }, [handleSend]);

    return (
        <>
            {/* 浮动按钮 — 可拖动 */}
            <button
                id="ai-assistant-fab"
                className={`ai-assistant-fab ${isOpen ? 'open' : ''} ${fabDrag.isDragging ? 'dragging' : ''}`}
                style={{
                    left: fabDrag.position.x,
                    top: fabDrag.position.y,
                    bottom: 'auto',
                    cursor: fabDrag.isDragging ? 'grabbing' : 'grab',
                }}
                onMouseDown={(e) => {
                    // 区分拖拽和点击：记录起始位置
                    (e.currentTarget as HTMLElement).dataset.startX = String(e.clientX);
                    (e.currentTarget as HTMLElement).dataset.startY = String(e.clientY);
                    fabDrag.handleMouseDown(e);
                }}
                onMouseUp={(e) => {
                    // 判断是否为点击（移动距离很小）
                    const startX = Number((e.currentTarget as HTMLElement).dataset.startX || 0);
                    const startY = Number((e.currentTarget as HTMLElement).dataset.startY || 0);
                    const dist = Math.sqrt((e.clientX - startX) ** 2 + (e.clientY - startY) ** 2);
                    if (dist < 5) {
                        setIsOpen(!isOpen);
                        // 如果当前还在弹出窗口，点击关闭会导致其回弹或者直接关闭。
                        if (isPoppedOut && isOpen) closePopOut();
                    }
                }}
                title={isOpen ? '关闭 AI 助手' : '打开 AI 助手'}
            >
                <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                    {isOpen ? 'keyboard_arrow_down' : 'smart_toy'}
                </span>
            </button>

            {/* 聊天面板 / 新窗口内容区域 抽象 */}
            {isOpen && (
                <>
                    {/* 我们不再依赖 Portal 将真实 DOM 挪过去，而是挂起当前页面的渲染 */}
                    {isPoppedOut ? (
                        <div className="hidden" aria-hidden="true" id="ai-assistant-suspended">{/* 主页被挂起隐藏 */}</div>
                    ) : (
                        <AssistantPanel
                            isPoppedOut={false}
                            position={position}
                            isDragging={isDragging}
                            handleMouseDown={handleMouseDown}
                            closePopOut={closePopOut}
                            popOut={() => popOut(450, 750, 'AI 调度工作流助手')}
                            setIsOpen={setIsOpen}
                            messages={messages}
                            loading={loading}
                            activeToolName={activeToolName}
                            input={input}
                            setInput={setInput}
                            handleKeyDown={handleKeyDown}
                            handleSend={handleSend}
                            handleExampleClick={handleExampleClick}
                            messagesEndRef={messagesEndRef}
                            inputRef={inputRef}
                        />
                    )}
                </>
            )}
        </>
    );
};

// ============ 子组件 ============

/** 欢迎页面 */
const WelcomeScreen: React.FC<{ onExampleClick: (q: string) => void }> = ({ onExampleClick }) => (
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
            {EXAMPLE_QUESTIONS.map((q, i) => (
                <button key={i} onClick={() => onExampleClick(q)}>
                    <span className="material-symbols-outlined example-icon">lightbulb</span>
                    {q}
                </button>
            ))}
        </div>
    </div>
);

// 将 Panel 抽离为单独无状态组件，方便 Portal 挂载复用
const AssistantPanel: React.FC<{
    isPoppedOut: boolean;
    position: { x: number; y: number };
    isDragging: boolean;
    handleMouseDown: (e: React.MouseEvent) => void;
    popOut: () => void;
    closePopOut: () => void;
    setIsOpen: (open: boolean) => void;
    messages: ChatMessage[];
    loading: boolean;
    activeToolName: string;
    input: string;
    setInput: (v: string) => void;
    handleKeyDown: (e: React.KeyboardEvent) => void;
    handleSend: (text?: string) => void;
    handleExampleClick: (q: string) => void;
    messagesEndRef: React.RefObject<HTMLDivElement>;
    inputRef: React.RefObject<HTMLInputElement>;
}> = ({
    isPoppedOut, position, isDragging, handleMouseDown, popOut, closePopOut, setIsOpen,
    messages, loading, activeToolName, input, setInput, handleKeyDown, handleSend, handleExampleClick, messagesEndRef, inputRef
}) => {
        return (
            <div
                className={`ai-assistant-panel ${isDragging ? 'dragging' : ''} ${isPoppedOut ? 'popped-out' : ''}`}
                id="ai-assistant-panel"
                style={isPoppedOut ? {
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    borderRadius: 0,
                    margin: 0,
                    border: 'none',
                    left: 0,
                    top: 0
                } : {
                    left: `${position.x}px`,
                    top: `${position.y}px`,
                    bottom: 'auto',
                }}
            >
                {/* 头部 — 拖拽手柄 */}
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
                        <div className="ai-subtitle">智脉平台 {isPoppedOut ? '· 独立窗口' : '· 拖动移动'}</div>
                    </div>
                    <div className="ai-status-dot" title="在线" />

                    {!isPoppedOut && (
                        <button onClick={popOut} className="ai-close-btn" title="弹出为独立窗口" style={{ marginRight: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>open_in_new</span>
                        </button>
                    )}

                    <button
                        onClick={() => {
                            if (isPoppedOut) closePopOut();
                            else setIsOpen(false);
                        }}
                        className="ai-close-btn"
                        title={isPoppedOut ? "恢复并回到主界面关闭" : "从主界面隐藏"}
                    >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
                    </button>
                </div>

                {/* 消息区 */}
                <div className="ai-messages">
                    {messages.length === 0 ? (
                        <WelcomeScreen onExampleClick={handleExampleClick} />
                    ) : (
                        messages.map((msg, i) => (
                            <div key={i} className={`ai-msg-wrapper ${msg.role}`}>
                                <div className={`ai-msg ${msg.role}`}>
                                    {msg.content}
                                </div>
                                {msg.retrieval_log && msg.retrieval_log.length > 0 && (
                                    <div className="ai-retrieval-log">
                                        <span className="material-symbols-outlined">folder_open</span>
                                        检索文件: {msg.retrieval_log.join(', ')}
                                    </div>
                                )}
                            </div>
                        ))
                    )
                    }

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

                {/* 输入区 */}
                <div className="ai-input-area">
                    <input
                        ref={inputRef}
                        id="ai-assistant-input"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="输入你的问题..."
                        disabled={loading}
                    />
                    <button
                        id="ai-assistant-send"
                        className="ai-send-btn"
                        onClick={() => handleSend()}
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

// 供独立路由使用的单体组件
export const AiAssistantStandalone: React.FC = () => {
    // 专用 Hook 负责防白屏和发送心跳
    usePopoutSync('ai-assistant-sync');

    // 内部独立的数据状态（这里我们简化为开箱即用的白板状态，可以结合全局 Store）
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [activeToolName, setActiveToolName] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSend = useCallback(async (text?: string) => {
        const msg = (text || input).trim();
        if (!msg || loading) return;

        setInput('');
        const userMsg: ChatMessage = { role: 'user', content: msg };
        setMessages((prev) => [...prev, userMsg]);
        setLoading(true);
        setActiveToolName('');

        // 预创建一个助手消息
        const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: '',
            isStreaming: true
        };
        setMessages((prev) => [...prev, assistantMsg]);

        try {
            const stream = fetchChatStream(msg, messages);
            let fullReply = '';
            let logs: string[] = [];

            for await (const chunk of stream) {
                if (chunk.type === 'REPLY') {
                    fullReply += chunk.content;
                    setMessages((prev) => {
                        const next = [...prev];
                        const last = next[next.length - 1];
                        if (last && last.role === 'assistant') {
                            last.content = fullReply;
                        }
                        return next;
                    });
                } else if (chunk.type === 'TOOL') {
                    setActiveToolName(chunk.content);
                } else if (chunk.type === 'LOG') {
                    logs = chunk.content.split(', ');
                    setMessages((prev) => {
                        const next = [...prev];
                        const last = next[next.length - 1];
                        if (last && last.role === 'assistant') {
                            last.retrieval_log = logs;
                        }
                        return next;
                    });
                }
            }

            setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                    last.isStreaming = false;
                }
                return next;
            });
        } catch (e) {
            setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${e instanceof Error ? e.message : '请求失败'}` }]);
        } finally {
            setLoading(false);
            setActiveToolName('');
        }
    }, [input, loading, messages]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

    return (
        <AssistantPanel
            isPoppedOut={true}
            position={{ x: 0, y: 0 }}
            isDragging={false}
            handleMouseDown={() => { }}
            closePopOut={() => window.close()}
            popOut={() => { }}
            setIsOpen={() => { }}
            messages={messages}
            loading={loading}
            activeToolName={activeToolName}
            input={input}
            setInput={setInput}
            handleKeyDown={handleKeyDown}
            handleSend={handleSend}
            handleExampleClick={(q) => handleSend(q)}
            messagesEndRef={messagesEndRef}
            inputRef={inputRef}
        />
    )
}

export default AiAssistant;
