/**
 * AI 对话助手组件
 * 全局浮动聊天气泡 + 可拖动的对话面板
 * 通过自然语言调用系统已有的查询、分析、推演功能
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import './ai-assistant.css';

// ============ 类型定义 ============

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface ToolCallInfo {
    tool_name: string;
    tool_args: Record<string, unknown>;
    tool_result: string;
}

interface ChatResponse {
    reply: string;
    tool_calls: ToolCallInfo[];
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
 * 调用 AI 助手对话接口
 * @param message 用户消息文本
 * @param history 对话历史（最近几轮）
 */
async function sendMessage(
    message: string,
    history: ChatMessage[],
): Promise<ChatResponse> {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: '请求失败' }));
        throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
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

    // 拖拽：面板初始位置在左下角
    const { position, isDragging, handleMouseDown } = useDrag({
        x: 24,
        y: typeof window !== 'undefined' ? window.innerHeight - 560 - 92 : 200,
    });

    // 拖拽：浮动按钮也可拖动
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

        try {
            const response = await sendMessage(msg, messages);

            if (response.tool_calls.length > 0) {
                const toolName = response.tool_calls[0].tool_name;
                setActiveToolName(toolName);
            }

            const assistantMsg: ChatMessage = {
                role: 'assistant',
                content: response.reply,
            };
            setMessages((prev) => [...prev, assistantMsg]);
        } catch (e) {
            const errorMsg: ChatMessage = {
                role: 'assistant',
                content: `❌ ${e instanceof Error ? e.message : '请求失败，请稍后重试'}`,
            };
            setMessages((prev) => [...prev, errorMsg]);
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
                    }
                }}
                title={isOpen ? '关闭 AI 助手' : '打开 AI 助手'}
            >
                <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                    {isOpen ? 'keyboard_arrow_down' : 'smart_toy'}
                </span>
            </button>

            {/* 聊天面板 — 可拖动、半透明 */}
            {isOpen && (
                <div
                    className={`ai-assistant-panel ${isDragging ? 'dragging' : ''}`}
                    id="ai-assistant-panel"
                    style={{
                        left: position.x,
                        top: position.y,
                        bottom: 'auto',
                    }}
                >
                    {/* 头部 — 拖拽手柄 */}
                    <div
                        className="ai-panel-header"
                        onMouseDown={handleMouseDown}
                        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                    >
                        <div className="ai-avatar">
                            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#fff' }}>
                                smart_toy
                            </span>
                        </div>
                        <div className="ai-header-info">
                            <div className="ai-title">AI 助手</div>
                            <div className="ai-subtitle">智脉平台 · 拖动移动</div>
                        </div>
                        <div className="ai-status-dot" title="在线" />
                        <button
                            onClick={() => setIsOpen(false)}
                            className="ai-close-btn"
                            title="关闭"
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
                                <div key={i} className={`ai-msg ${msg.role}`}>
                                    {msg.content}
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

export default AiAssistant;
