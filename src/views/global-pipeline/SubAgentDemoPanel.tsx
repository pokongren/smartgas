import React, { useEffect, useRef, useState } from 'react'

const AI_ASSISTANT_SYNC_CHANNEL = 'ai-assistant-sync'

export type SubAgentDemoStatus = 'pending' | 'running' | 'completed' | 'warning' | 'error'

export type SubAgentDemoStep = {
    id: string
    title: string
    icon: string
    status: SubAgentDemoStatus
    message: string
    updatedAt?: number
}

export type SubAgentDemoStepEventDetail = {
    step?: string
    status?: string
    title?: string
    message?: string
}

const SUBAGENT_DEMO_STEP_DEFS: Array<Pick<SubAgentDemoStep, 'id' | 'title' | 'icon' | 'message'>> = [
    { id: 'controller', title: '主控 Agent', icon: 'account_tree', message: '等待任务识别与编排' },
    { id: 'history', title: '历史曲线 Agent', icon: 'show_chart', message: '等待调取压力和水露点曲线' },
    { id: 'topology', title: '拓扑分析 Agent', icon: 'hub', message: '等待读取上下游关系' },
    { id: 'procedure', title: '规程处置 Agent', icon: 'rule', message: '等待检索规程和边界' },
    { id: 'simulation', title: '稳态仿真 Agent', icon: 'science', message: '等待启动三工况仿真' },
    { id: 'review', title: '风险复核 Agent', icon: 'fact_check', message: '等待复核数据缺口和边界' },
    { id: 'business_expression', title: '表达复核 Agent', icon: 'record_voice_over', message: '等待统一汇报口径' },
    { id: 'main_summary', title: '主 Agent 汇总', icon: 'summarize', message: '等待汇总输出' },
]

export function createDefaultSubAgentDemoSteps(): SubAgentDemoStep[] {
    return SUBAGENT_DEMO_STEP_DEFS.map(item => ({
        ...item,
        status: 'pending',
    }))
}

export function normalizeSubAgentDemoStatus(raw?: string): SubAgentDemoStatus {
    if (raw === 'running' || raw === 'completed' || raw === 'warning' || raw === 'error') return raw
    return 'pending'
}

export function emitSubAgentDemoFinalReady(): void {
    const detail = { ready: true }
    ;(window as typeof window & { __smartgasSubagentFinalReady?: boolean }).__smartgasSubagentFinalReady = true
    window.dispatchEvent(new CustomEvent('assistant-subagent-demo-final-ready', { detail }))
    if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'assistant-subagent-demo-final-ready', detail }, '*')
    }
    try {
        const channel = new BroadcastChannel(AI_ASSISTANT_SYNC_CHANNEL)
        channel.postMessage({ type: 'assistant-subagent-demo-final-ready', detail })
        channel.close()
    } catch {
        // BroadcastChannel is only used when the AI assistant is popped out.
    }
}

const SUBAGENT_DEMO_ACCENT: Record<string, {
    title: string
    icon: string
    message: string
    badge: string
    ring: string
    line: string
}> = {
    controller: {
        title: 'text-cyan-100',
        icon: 'text-cyan-200',
        message: 'text-cyan-50/78',
        badge: 'border-cyan-300/35 bg-cyan-400/10 text-cyan-100',
        ring: 'border-cyan-200/55 bg-cyan-300/16',
        line: 'bg-cyan-300/35',
    },
    history: {
        title: 'text-sky-100',
        icon: 'text-sky-200',
        message: 'text-sky-50/78',
        badge: 'border-sky-300/35 bg-sky-400/10 text-sky-100',
        ring: 'border-sky-200/55 bg-sky-300/16',
        line: 'bg-sky-300/35',
    },
    topology: {
        title: 'text-violet-100',
        icon: 'text-violet-200',
        message: 'text-violet-50/78',
        badge: 'border-violet-300/35 bg-violet-400/10 text-violet-100',
        ring: 'border-violet-200/55 bg-violet-300/16',
        line: 'bg-violet-300/35',
    },
    procedure: {
        title: 'text-amber-100',
        icon: 'text-amber-200',
        message: 'text-amber-50/78',
        badge: 'border-amber-300/35 bg-amber-400/10 text-amber-100',
        ring: 'border-amber-200/55 bg-amber-300/16',
        line: 'bg-amber-300/35',
    },
    simulation: {
        title: 'text-emerald-100',
        icon: 'text-emerald-200',
        message: 'text-emerald-50/78',
        badge: 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100',
        ring: 'border-emerald-200/55 bg-emerald-300/16',
        line: 'bg-emerald-300/35',
    },
    review: {
        title: 'text-rose-100',
        icon: 'text-rose-200',
        message: 'text-rose-50/78',
        badge: 'border-rose-300/35 bg-rose-400/10 text-rose-100',
        ring: 'border-rose-200/55 bg-rose-300/16',
        line: 'bg-rose-300/35',
    },
    business_expression: {
        title: 'text-fuchsia-100',
        icon: 'text-fuchsia-200',
        message: 'text-fuchsia-50/78',
        badge: 'border-fuchsia-300/35 bg-fuchsia-400/10 text-fuchsia-100',
        ring: 'border-fuchsia-200/55 bg-fuchsia-300/16',
        line: 'bg-fuchsia-300/35',
    },
    main_summary: {
        title: 'text-orange-100',
        icon: 'text-orange-200',
        message: 'text-orange-50/78',
        badge: 'border-orange-300/35 bg-orange-400/10 text-orange-100',
        ring: 'border-orange-200/55 bg-orange-300/16',
        line: 'bg-orange-300/35',
    },
}

const SUBAGENT_DEMO_DEFAULT_ACCENT = {
    title: 'text-slate-100',
    icon: 'text-slate-200',
    message: 'text-slate-300',
    badge: 'border-slate-300/25 bg-slate-400/10 text-slate-100',
    ring: 'border-white/10 bg-white/5',
    line: 'bg-white/12',
}

export function SubAgentDemoPanel({
    steps,
    lastMessage,
    onClose,
    onStartSimulation,
}: {
    steps: SubAgentDemoStep[]
    lastMessage: string
    onClose: () => void
    onStartSimulation: () => void
}) {
    const [position, setPosition] = useState(() => ({
        x: typeof window !== 'undefined' ? Math.min(450, Math.max(20, window.innerWidth - 420)) : 450,
        y: 104,
    }))
    const [size, setSize] = useState({ width: 400, height: 620 })
    const dragStateRef = useRef<{
        mode: 'move' | 'resize'
        startX: number
        startY: number
        startLeft: number
        startTop: number
        startWidth: number
        startHeight: number
    } | null>(null)
    const completedCount = steps.filter(item => item.status === 'completed').length
    const runningStep = steps.find(item => item.status === 'running')
    const progress = Math.round((completedCount / Math.max(1, steps.length)) * 100)

    const statusText: Record<SubAgentDemoStatus, string> = {
        pending: '等待',
        running: '运行中',
        completed: '完成',
        warning: '需复核',
        error: '失败',
    }

    const statusClass: Record<SubAgentDemoStatus, string> = {
        pending: 'border-slate-600/45 bg-slate-950/48 text-slate-300',
        running: 'border-cyan-300/75 bg-cyan-500/16 text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.24)]',
        completed: 'border-emerald-300/55 bg-emerald-500/14 text-emerald-50',
        warning: 'border-amber-300/60 bg-amber-500/14 text-amber-50',
        error: 'border-red-300/60 bg-red-500/14 text-red-50',
    }

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            const state = dragStateRef.current
            if (!state) return
            event.preventDefault()
            const deltaX = event.clientX - state.startX
            const deltaY = event.clientY - state.startY
            if (state.mode === 'move') {
                setPosition({
                    x: Math.max(0, Math.min(window.innerWidth - size.width, state.startLeft + deltaX)),
                    y: Math.max(64, Math.min(window.innerHeight - 120, state.startTop + deltaY)),
                })
                return
            }
            setSize({
                width: Math.max(340, Math.min(720, state.startWidth + deltaX)),
                height: Math.max(420, Math.min(window.innerHeight - 90, state.startHeight + deltaY)),
            })
        }
        const handleMouseUp = () => {
            dragStateRef.current = null
        }
        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [size.width])

    const handleMoveMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        if ((event.target as HTMLElement).closest('button')) return
        dragStateRef.current = {
            mode: 'move',
            startX: event.clientX,
            startY: event.clientY,
            startLeft: position.x,
            startTop: position.y,
            startWidth: size.width,
            startHeight: size.height,
        }
    }

    const handleResizeMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault()
        event.stopPropagation()
        dragStateRef.current = {
            mode: 'resize',
            startX: event.clientX,
            startY: event.clientY,
            startLeft: position.x,
            startTop: position.y,
            startWidth: size.width,
            startHeight: size.height,
        }
    }

    return (
        <div
            className="absolute z-50 flex flex-col overflow-hidden rounded-2xl border border-cyan-300/35 bg-slate-950/92 text-slate-100 shadow-2xl shadow-cyan-950/45 backdrop-blur-xl"
            style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
        >
            <div
                className="cursor-move border-b border-white/10 bg-gradient-to-r from-cyan-950/80 via-slate-950/90 to-blue-950/70 px-4 py-3"
                onMouseDown={handleMoveMouseDown}
            >
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-bold">
                            <span className={`material-symbols-outlined text-cyan-200 ${runningStep ? 'animate-spin' : ''}`}>hub</span>
                            SubAgent 协同分析
                        </div>
                        <div className="mt-1 text-[11px] text-slate-300">
                            中卫工况调整 · 曲线 / 拓扑 / 规程 / 仿真
                        </div>
                    </div>
                    <button
                        type="button"
                        className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                        onClick={onClose}
                        title="关闭 SubAgent 演示面板"
                    >
                        <span className="material-symbols-outlined text-base">close</span>
                    </button>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-emerald-300 to-blue-300 transition-all duration-500"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                    <span>{completedCount}/{steps.length} 已完成</span>
                    <span>{runningStep ? `${runningStep.title} 正在处理` : '等待下一步'}</span>
                </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {steps.map((step, index) => {
                    const accent = SUBAGENT_DEMO_ACCENT[step.id] || SUBAGENT_DEMO_DEFAULT_ACCENT
                    const canStartSimulation = step.id === 'simulation' && step.status === 'running'
                    return (
                        <div
                            key={step.id}
                            className={`relative rounded-xl border px-3 py-2.5 transition-all duration-300 ${statusClass[step.status]} ${step.status === 'running' ? 'scale-[1.015] animate-pulse' : ''}`}
                        >
                            {index < steps.length - 1 && (
                                <div className={`absolute left-[22px] top-[45px] h-4 w-px ${accent.line}`} />
                            )}
                            <div className="flex items-start gap-2.5">
                                <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border ${accent.ring}`}>
                                    <span className={`material-symbols-outlined text-[17px] ${accent.icon}`}>
                                        {step.status === 'completed' ? 'check' : step.icon}
                                    </span>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className={`truncate text-[12px] font-semibold ${accent.title}`}>{step.title}</div>
                                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${accent.badge}`}>
                                            {statusText[step.status]}
                                        </span>
                                    </div>
                                    <div className={`mt-1 line-clamp-2 text-[11px] leading-relaxed ${accent.message}`}>
                                        {step.message}
                                    </div>
                                    {canStartSimulation && (
                                        <button
                                            type="button"
                                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300/45 bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 hover:border-emerald-200 hover:bg-emerald-400/25"
                                            onClick={onStartSimulation}
                                        >
                                            <span className="material-symbols-outlined text-[15px]">play_arrow</span>
                                            点击开始三工况仿真
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            {lastMessage && (
                <div className="border-t border-white/10 bg-black/18 px-4 py-2.5 text-[11px] leading-relaxed text-cyan-100">
                    {lastMessage}
                </div>
            )}
            <div
                className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize rounded-tl-lg border-l border-t border-cyan-300/30 bg-cyan-300/10 hover:bg-cyan-300/25"
                onMouseDown={handleResizeMouseDown}
                title="拖动调整大小"
            />
        </div>
    )
}
