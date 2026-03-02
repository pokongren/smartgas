import React, { useState, useRef, useEffect } from 'react';

// API 调用接口
const queryKnowledge = async (question: string) => {
    try {
        const response = await fetch('http://localhost:8000/api/emergency/knowledge-query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
        });
        if (!response.ok) throw new Error(`请求失败: ${response.status}`);
        const data = await response.json();
        return data.answer || data.content || JSON.stringify(data);
    } catch (error) {
        console.error("QA 请求错误:", error);
        return "抱歉，系统回答时出现了错误。";
    }
};

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    isTyping?: boolean;
}

const SUGGESTIONS = [
    { icon: 'share_location', text: '查询陕京四线沿途经过的重点城市及其管存？' },
    { icon: 'warning', text: '如果某管网发生泄漏故障，如何调用应急预案？' },
    { icon: 'analytics', text: '帮我分析当前管网调度的压力分布与瓶颈。' },
    { icon: 'menu_book', text: '查看当前管线日常巡检的规范与安全标准。' }
];

const QaView: React.FC = () => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async (text: string = input) => {
        if (!text.trim() || isLoading) return;

        const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text.trim() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        const tempAssistantId = (Date.now() + 1).toString();
        setMessages(prev => [
            ...prev,
            { id: tempAssistantId, role: 'assistant', content: '', isTyping: true }
        ]);

        try {
            const answerText = await queryKnowledge(userMsg.content);
            setMessages(prev => prev.map(msg =>
                msg.id === tempAssistantId ? { ...msg, content: answerText, isTyping: false } : msg
            ));
        } catch (error) {
            setMessages(prev => prev.map(msg =>
                msg.id === tempAssistantId ? { ...msg, content: '网络或服务异常，请稍后再试。', isTyping: false } : msg
            ));
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleSend();
    };

    return (
        <div className="flex flex-col h-screen bg-[#090D11] text-gray-200 overflow-hidden font-sans relative selection:bg-blue-500/30">
            {/* 背景光晕装饰 */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-900/10 blur-[120px] rounded-full pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-900/10 blur-[120px] rounded-full pointer-events-none" />

            {/* 顶部简易导航（留白，增加呼吸感） */}
            <header className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-transparent sticky top-0 z-20">
                <div className="flex items-center gap-3">
                    <div className="size-9 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center backdrop-blur-md">
                        <span className="material-symbols-outlined text-gray-300 text-lg">smart_toy</span>
                    </div>
                    <span className="text-lg font-semibold text-gray-200 tracking-wide">
                        SmartGas <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">AI</span>
                    </span>
                </div>
            </header>

            {/* 聊天内容区域 */}
            <main className="flex-1 overflow-y-auto w-full pt-4 pb-36 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent flex flex-col items-center">
                <div className="w-full max-w-3xl px-4 md:px-6 flex flex-col gap-8">
                    {messages.length === 0 ? (
                        // 欢迎引导页 / 空状态
                        <div className="flex flex-col items-center justify-center mt-12 md:mt-24 mb-10 animate-fade-in-up">
                            <div className="size-20 rounded-[1.5rem] bg-gradient-to-tr from-blue-600 to-cyan-500 shadow-2xl flex items-center justify-center mb-8 relative">
                                <div className="absolute inset-0 rounded-[1.5rem] bg-blue-400/20 blur-xl"></div>
                                <span className="material-symbols-outlined text-[40px] text-white z-10">psychology</span>
                            </div>
                            <h2 className="text-2xl md:text-3xl font-semibold text-gray-100 mb-3 tracking-tight">有什么我可以帮您的？</h2>
                            <p className="text-gray-400 text-sm mb-12">我了解全网管线拓扑数据以及调度预案体系</p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl px-2">
                                {SUGGESTIONS.map((item, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => handleSend(item.text)}
                                        className="flex flex-col gap-2 p-5 rounded-2xl bg-[#141b22] border border-white/5 hover:bg-[#1c242e] hover:border-white/10 transition-all text-left group shadow-lg shadow-black/20"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-[18px] text-gray-400 group-hover:text-blue-400 transition-colors">
                                                {item.icon}
                                            </span>
                                        </div>
                                        <span className="text-sm text-gray-300 leading-relaxed font-medium group-hover:text-gray-100 transition-colors">{item.text}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        // 对话列表
                        messages.map((msg) => (
                            <div key={msg.id} className={`flex w-full gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} animate-fade-in-up`}>
                                {/* 头像 */}
                                <div className={`flex-shrink-0 size-8 mt-1 rounded-full flex items-center justify-center shadow-md ${msg.role === 'user' ? 'bg-indigo-500' : 'bg-[#1a232c] border border-white/10'
                                    }`}>
                                    <span className={`material-symbols-outlined text-[16px] ${msg.role === 'user' ? 'text-white' : 'text-cyan-400'
                                        }`}>
                                        {msg.role === 'user' ? 'person' : 'smart_toy'}
                                    </span>
                                </div>

                                {/* 消息体 */}
                                <div className={`flex flex-col gap-1.5 max-w-[85%] md:max-w-[75%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    <span className="text-xs text-gray-500 font-medium px-1">
                                        {msg.role === 'user' ? '你' : 'SmartGas AI'}
                                    </span>
                                    <div className={`px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm ${msg.role === 'user'
                                            ? 'bg-[#292929] text-gray-100 rounded-tr-sm'
                                            : 'bg-transparent text-gray-200'
                                        }`}>
                                        {msg.isTyping ? (
                                            <div className="flex items-center gap-1.5 h-6">
                                                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/80 animate-bounce" style={{ animationDelay: '0ms' }} />
                                                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/80 animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/80 animate-bounce" style={{ animationDelay: '300ms' }} />
                                            </div>
                                        ) : (
                                            <div className="whitespace-pre-wrap">{msg.content}</div>
                                        )}
                                    </div>
                                    {/* 提供操作按钮给 AI 消息（如复制） */}
                                    {msg.role === 'assistant' && !msg.isTyping && (
                                        <div className="flex gap-2 mt-1 opacity-0 group-hover:opacity-100 md:opacity-100">
                                            <button className="text-gray-500 hover:text-gray-300 transition-colors p-1" title="复制">
                                                <span className="material-symbols-outlined text-[16px]">content_copy</span>
                                            </button>
                                            <button className="text-gray-500 hover:text-gray-300 transition-colors p-1" title="重新生成">
                                                <span className="material-symbols-outlined text-[16px]">refresh</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </main>

            {/* 悬浮输入框区域 */}
            <div className="absolute w-full bottom-0 left-0 bg-gradient-to-t from-[#090D11] via-[#090D11]/80 to-transparent pt-10 pb-6 px-4 flex justify-center pointer-events-none z-30">
                <div className="w-full max-w-3xl bg-[#212121] rounded-[24px] border border-white/5 shadow-2xl shadow-black/50 p-2 pointer-events-auto">
                    <div className="flex items-end gap-2 relative">
                        {/* 附件按钮 */}
                        <button className="flex-shrink-0 size-9 rounded-full mb-1 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                            <span className="material-symbols-outlined text-[20px]">add_circle</span>
                        </button>

                        <textarea
                            className="flex-1 bg-transparent px-2 py-2.5 mb-1 text-gray-100 placeholder-gray-500 outline-none text-[15px] resize-none overflow-hidden max-h-32 min-h-[44px]"
                            placeholder="给 SmartGas AI 发送指令或问题..."
                            value={input}
                            onChange={(e) => {
                                setInput(e.target.value);
                                e.target.style.height = 'auto';
                                e.target.style.height = `${e.target.scrollHeight}px`;
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            disabled={isLoading}
                            rows={1}
                        />

                        {/* 语音或发送按钮 */}
                        <button
                            onClick={() => handleSend(input)}
                            disabled={!input.trim() || isLoading}
                            className={`flex-shrink-0 size-9 rounded-full mb-1 flex items-center justify-center transition-all ${input.trim() && !isLoading
                                    ? 'bg-white text-black shadow-lg hover:bg-gray-200'
                                    : 'bg-white/5 text-gray-500 hover:bg-white/10'
                                }`}
                        >
                            {input.trim()
                                ? <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                                : <span className="material-symbols-outlined text-[18px]">mic</span>
                            }
                        </button>
                    </div>
                    <div className="text-center mt-2 mb-1">
                        <span className="text-[11px] text-gray-500">
                            SmartGas AI 生成的信息可能不准确，关键调度决策请结合实际系统数据研判。
                        </span>
                    </div>
                </div>
            </div>

            {/* 注入极简自定义动画 (Tailwind 原生未全包含) */}
            <style>{`
                @keyframes fade-in-up {
                    0% { opacity: 0; transform: translateY(10px); }
                    100% { opacity: 1; transform: translateY(0); }
                }
                .animate-fade-in-up {
                    animation: fade-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
            `}</style>
        </div>
    );
};

export default QaView;
