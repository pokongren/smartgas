/**
 * 枢纽节点详情面板
 *
 * 展示多端口节点的详细信息和端口连接关系
 */

import React from 'react'
import type { HubNode, NodePort, PortConnection, HubProcessFlowConfig, ProcessValve } from '@/types/hub'
import { PortDirection, DistributionStrategy } from '@/types/hub'
import type { StationProcessCutoffStageDetail } from '@/components/map-view/types'

interface HubDetailPanelProps {
    node: HubNode | null
    visible: boolean
    onClose: () => void
    onPortClick?: (portId: string) => void
    onPipelineClick?: (pipelineId: string) => void
    onCutoffStage?: (detail: StationProcessCutoffStageDetail) => void
}

type PanelLayout = {
    x: number
    y: number
    width: number
    height: number
}

type PanelDragState = {
    startX: number
    startY: number
    layout: PanelLayout
}

const PANEL_MIN_WIDTH = 720
const PANEL_MIN_HEIGHT = 560
const PANEL_MARGIN = 12

function getInitialPanelLayout(): PanelLayout {
    if (typeof window === 'undefined') {
        return { x: 80, y: 48, width: 900, height: 720 }
    }
    const width = Math.min(920, Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_MARGIN * 2))
    const height = Math.min(720, Math.max(PANEL_MIN_HEIGHT, window.innerHeight - PANEL_MARGIN * 2))
    return {
        x: Math.max(PANEL_MARGIN, Math.round((window.innerWidth - width) / 2)),
        y: Math.max(PANEL_MARGIN, Math.round((window.innerHeight - height) / 2)),
        width,
        height,
    }
}

function clampPanelLayout(layout: PanelLayout): PanelLayout {
    if (typeof window === 'undefined') return layout
    const maxWidth = Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_MARGIN * 2)
    const maxHeight = Math.max(PANEL_MIN_HEIGHT, window.innerHeight - PANEL_MARGIN * 2)
    const width = clamp(layout.width, PANEL_MIN_WIDTH, maxWidth)
    const height = clamp(layout.height, PANEL_MIN_HEIGHT, maxHeight)
    return {
        width,
        height,
        x: clamp(layout.x, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN)),
        y: clamp(layout.y, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN)),
    }
}

/**
 * 端口状态颜色
 */
function getStatusColor(status: string): string {
    switch (status) {
        case 'active':
            return 'bg-green-500'
        case 'inactive':
            return 'bg-gray-500'
        case 'maintenance':
            return 'bg-yellow-500'
        default:
            return 'bg-gray-500'
    }
}

/**
 * 枢纽等级显示
 */
function getHubLevelText(level: number): string {
    switch (level) {
        case 1:
            return '国家级枢纽'
        case 2:
            return '省级枢纽'
        case 3:
            return '区域枢纽'
        default:
            return '未知级别'
    }
}

/**
 * 流量分配策略显示
 */
function getStrategyText(strategy: DistributionStrategy): string {
    switch (strategy) {
        case DistributionStrategy.PROPORTIONAL:
            return '比例分配'
        case DistributionStrategy.PRIORITY:
            return '优先级分配'
        case DistributionStrategy.CAPACITY_BASED:
            return '容量分配'
        default:
            return '未知策略'
    }
}

function getNodeTypeLabel(type: HubNode['type']): string {
    switch (type) {
        case 'compressor':
            return '压气站'
        case 'distribution':
            return '分输站'
        case 'source':
            return '气源'
        case 'junction':
            return '流程枢纽'
        default:
            return type
    }
}

function getPortDisplayName(port: NodePort): string {
    return port.valveGroupName || port.pipelineName
}

function getPortStatusText(status: NodePort['status']): string {
    switch (status) {
        case 'active':
            return '已导通'
        case 'maintenance':
            return '检修'
        case 'inactive':
            return '关闭'
        default:
            return '未知'
    }
}

function getPortShortName(port: NodePort): string {
    return getPortDisplayName(port).replace('阀组', '')
}

function getFlowPathColor(index: number): string {
    const colors = ['#22d3ee', '#f59e0b', '#38bdf8', '#a78bfa']
    return colors[index % colors.length]
}

const DEFAULT_PROCESS_SUMMARY = '站内流程：西一线直供下游，西二线直供下游并转供中贵线'

const DEFAULT_VALVE_NODES: ProcessValve[] = [
    { id: 'v101', label: 'V101', name: '西一线进站阀', x: 31, y: 30, angle: 0 },
    { id: 'v102', label: 'V102', name: '西一线出站阀', x: 74, y: 30, angle: 0 },
    { id: 'v201', label: 'V201', name: '西二线进站阀', x: 31, y: 62, angle: 0 },
    { id: 'v202', label: 'V202', name: '西二线出站阀', x: 74, y: 62, angle: 0 },
    { id: 'v301', label: 'V301', name: '中贵线外输阀', x: 56, y: 75, angle: 90 },
]

function getConnectionKey(conn: PortConnection): string {
    return `${conn.fromPort}->${conn.toPort}`
}

function getSvgSafeId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function getProcessTitle(node: HubNode): string {
    if (node.name.includes('工艺流程')) return node.name
    if (node.name.includes('阀组')) return node.name.replace('阀组', '工艺流程')
    return `${node.name}工艺流程`
}

function formatThroughput(value?: number): string {
    if (value === undefined || value === null) return '--'
    return `${value.toLocaleString('zh-CN')} 万方/天`
}

function formatTemperature(value?: number): string {
    if (value === undefined || value === null) return '--'
    return `${value.toFixed(1)} ℃`
}

function formatPressure(value?: number): string {
    if (value === undefined || value === null) return '--'
    return `${value.toFixed(1)} MPa`
}

function getSeed(text: string): number {
    return text.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

function getLiveMetric(base: number | undefined, key: string, tick: number, amplitude: number, decimals = 1): number | undefined {
    if (base === undefined || base === null) return undefined
    const seed = getSeed(key)
    const wave = Math.sin(tick / 2600 + seed) + Math.sin(tick / 7100 + seed / 3) * 0.35
    const value = base + wave * amplitude
    const factor = 10 ** decimals
    return Math.round(value * factor) / factor
}

function getLiveThroughput(base: number | undefined, key: string, tick: number): number | undefined {
    const amplitude = Math.max(12, (base || 0) * 0.018)
    return getLiveMetric(base, `${key}-q`, tick, amplitude, 0)
}

function getLivePressure(base: number | undefined, key: string, tick: number): number | undefined {
    return getLiveMetric(base, `${key}-p`, tick, 0.08, 1)
}

function getLiveTemperature(base: number | undefined, key: string, tick: number): number | undefined {
    return getLiveMetric(base, `${key}-t`, tick, 0.35, 1)
}

function getLivePortMetrics(port: NodePort, tick: number): { throughput?: number; pressure?: number; temperature?: number } {
    return {
        throughput: getLiveThroughput(port.currentThroughput, port.portId, tick),
        pressure: getLivePressure(port.currentPressure, port.portId, tick),
        temperature: getLiveTemperature(port.currentTemperature, port.portId, tick),
    }
}

function getLiveConnectionMetrics(conn: PortConnection, tick: number): { throughput?: number; pressure?: number; temperature?: number } {
    return {
        throughput: getLiveThroughput(conn.currentThroughput, `${conn.fromPort}-${conn.toPort}`, tick),
        pressure: getLivePressure(conn.currentPressure, `${conn.fromPort}-${conn.toPort}`, tick),
        temperature: getLiveTemperature(conn.currentTemperature, `${conn.fromPort}-${conn.toPort}`, tick),
    }
}

function getPortDiagramPosition(port: NodePort, index: number, total: number): { x: number; y: number; labelX: number; labelY: number } {
    if (port.diagramPosition) return port.diagramPosition

    const spread = total <= 1 ? 0 : index / (total - 1)
    if (port.connectionSide === 'upstream' || port.direction === PortDirection.IN) {
        return { x: 15, y: 28 + spread * 44, labelX: 4, labelY: 20 + spread * 44 }
    }
    if (port.connectionSide === 'downstream' || port.direction === PortDirection.OUT) {
        return { x: 85, y: 28 + spread * 44, labelX: 64, labelY: 20 + spread * 44 }
    }
    return { x: 50, y: 50, labelX: 38, labelY: 42 }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

function createOrthogonalPath(conn: PortConnection, from: { x: number; y: number }, to: { x: number; y: number }): string {
    if (conn.fromPort === 'zhongwei-we2-upstream-in' && conn.toPort === 'zhongwei-zg-downstream-out') {
        return `M ${from.x} ${from.y} L ${to.x} ${from.y} L ${to.x} ${to.y}`
    }
    if (to.y >= 80 && from.y < to.y) {
        return `M ${from.x} ${from.y} L ${to.x} ${from.y} L ${to.x} ${to.y}`
    }
    if (from.x === to.x || from.y === to.y) {
        return `M ${from.x} ${from.y} L ${to.x} ${to.y}`
    }
    const midX = Math.round((from.x + to.x) / 2)
    return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`
}

function getConnectionValveIds(conn: PortConnection, processFlow?: HubProcessFlowConfig): string[] {
    const mappedValveIds = processFlow?.connectionValveMap?.[getConnectionKey(conn)]
    if (mappedValveIds) return mappedValveIds

    if (conn.fromPort === 'zhongwei-we1-upstream-in' && conn.toPort === 'zhongwei-we1-downstream-out') {
        return ['v101', 'v102']
    }
    if (conn.fromPort === 'zhongwei-we2-upstream-in' && conn.toPort === 'zhongwei-we2-downstream-out') {
        return ['v201', 'v202']
    }
    if (conn.fromPort === 'zhongwei-we2-upstream-in' && conn.toPort === 'zhongwei-zg-downstream-out') {
        return ['v201', 'v301']
    }
    return []
}

function buildStationCutoffStageDetail(
    node: HubNode,
    valve: ProcessValve,
    action: 'cutoff' | 'restore',
    valveOpen: boolean,
): StationProcessCutoffStageDetail | null {
    if (!valve.cutoffAction) return null
    return {
        stationId: node.id,
        stationName: node.name,
        valveId: valve.id,
        valveLabel: valve.label,
        valveName: valve.name,
        action,
        valveOpen,
        stage: valve.cutoffAction.stage,
        label: action === 'restore' ? `${valve.cutoffAction.label}恢复` : valve.cutoffAction.label,
        description: action === 'restore'
            ? `${valve.label} ${valve.name}重新打开，外部全国一张网恢复该阶段截断显示。`
            : valve.cutoffAction.description,
    }
}

function emitStationCutoffStage(detail: StationProcessCutoffStageDetail): void {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('station-process-cutoff-stage', {
        detail,
    }))
}

export const HubDetailPanel: React.FC<HubDetailPanelProps> = ({
    node,
    visible,
    onClose,
    onPortClick,
    onPipelineClick,
    onCutoffStage
}) => {
    const diagramRef = React.useRef<HTMLDivElement>(null)
    const dragStateRef = React.useRef<{ id: string; offsetX: number; offsetY: number } | null>(null)
    const panelDragRef = React.useRef<PanelDragState | null>(null)
    const panelResizeRef = React.useRef<PanelDragState | null>(null)
    const [metricTick, setMetricTick] = React.useState(() => Date.now())
    const [labelOverrides, setLabelOverrides] = React.useState<Record<string, { x: number; y: number }>>({})
    const [valveStates, setValveStates] = React.useState<Record<string, boolean>>({})
    const [panelLayout, setPanelLayout] = React.useState<PanelLayout>(() => getInitialPanelLayout())

    React.useEffect(() => {
        if (!visible) return
        const timer = window.setInterval(() => setMetricTick(Date.now()), 2000)
        return () => window.clearInterval(timer)
    }, [visible])

    React.useEffect(() => {
        if (!visible) return
        setPanelLayout(prev => clampPanelLayout(prev))
    }, [visible])

    React.useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const panelDrag = panelDragRef.current
            if (panelDrag) {
                const dx = event.clientX - panelDrag.startX
                const dy = event.clientY - panelDrag.startY
                setPanelLayout(clampPanelLayout({
                    ...panelDrag.layout,
                    x: panelDrag.layout.x + dx,
                    y: panelDrag.layout.y + dy,
                }))
                return
            }

            const panelResize = panelResizeRef.current
            if (panelResize) {
                const dx = event.clientX - panelResize.startX
                const dy = event.clientY - panelResize.startY
                setPanelLayout(clampPanelLayout({
                    ...panelResize.layout,
                    width: panelResize.layout.width + dx,
                    height: panelResize.layout.height + dy,
                }))
                return
            }

            const dragState = dragStateRef.current
            const rect = diagramRef.current?.getBoundingClientRect()
            if (!dragState || !rect) return

            const nextX = ((event.clientX - rect.left - dragState.offsetX) / rect.width) * 100
            const nextY = ((event.clientY - rect.top - dragState.offsetY) / rect.height) * 100

            setLabelOverrides(prev => ({
                ...prev,
                [dragState.id]: {
                    x: clamp(nextX, 1, 72),
                    y: clamp(nextY, 6, 88),
                },
            }))
        }

        const handlePointerUp = () => {
            dragStateRef.current = null
            panelDragRef.current = null
            panelResizeRef.current = null
        }

        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)
        return () => {
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', handlePointerUp)
        }
    }, [])

    if (!visible || !node || !node.extension.isHub) return null

    const { extension } = node
    const ports = extension.ports || []
    const activeConnections = extension.internalConnections?.filter(conn => conn.isActive) || []
    const valveNodes = extension.processFlow?.valves?.length ? extension.processFlow.valves : DEFAULT_VALVE_NODES
    const processSummary = extension.processFlow?.summary || DEFAULT_PROCESS_SUMMARY
    const portLayout = new Map<string, { x: number; y: number; labelX: number; labelY: number }>()

    ports.forEach((port, index) => {
        portLayout.set(port.portId, getPortDiagramPosition(port, index, ports.length))
    })

    const beginLabelDrag = (id: string, fallback: { labelX: number; labelY: number }, event: React.PointerEvent) => {
        const rect = diagramRef.current?.getBoundingClientRect()
        if (!rect) return
        event.stopPropagation()

        const current = labelOverrides[id] || { x: fallback.labelX, y: fallback.labelY }
        dragStateRef.current = {
            id,
            offsetX: event.clientX - rect.left - (current.x / 100) * rect.width,
            offsetY: event.clientY - rect.top - (current.y / 100) * rect.height,
        }
    }

    const beginPanelDrag = (event: React.PointerEvent<HTMLElement>) => {
        const target = event.target as HTMLElement
        if (target.closest('button')) return
        panelDragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            layout: panelLayout,
        }
    }

    const beginPanelResize = (event: React.PointerEvent<HTMLElement>) => {
        event.preventDefault()
        event.stopPropagation()
        panelResizeRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            layout: panelLayout,
        }
    }

    const isValveOpen = (valveId: string): boolean => valveStates[valveId] !== false
    const isConnectionOpen = (conn: PortConnection): boolean => getConnectionValveIds(conn, extension.processFlow).every(isValveOpen)
    const publishValveCutoffStage = (valve: ProcessValve, nextOpen: boolean) => {
        const detail = buildStationCutoffStageDetail(node, valve, nextOpen ? 'restore' : 'cutoff', nextOpen)
        if (!detail) return
        onCutoffStage?.(detail)
        emitStationCutoffStage(detail)
    }
    const toggleValve = (valve: ProcessValve) => {
        const nextOpen = !isValveOpen(valve.id)
        setValveStates(prev => ({
            ...prev,
            [valve.id]: nextOpen,
        }))
        publishValveCutoffStage(valve, nextOpen)
    }

    return (
        <div
            className="pointer-events-none fixed inset-0 z-50"
            style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
        >
            <div
                className="pointer-events-auto absolute bg-slate-950/85 backdrop-blur-xl rounded-2xl shadow-[0_30px_70px_rgba(6,182,212,0.25)] border border-cyan-500/40 overflow-hidden flex flex-col"
                style={{
                    left: panelLayout.x,
                    top: panelLayout.y,
                    width: panelLayout.width,
                    height: panelLayout.height,
                }}
            >
                <div
                    className="flex cursor-move select-none justify-between items-center px-5 py-4 border-b border-slate-800/80 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 shrink-0"
                    onPointerDown={beginPanelDrag}
                    title="按住标题栏拖动窗口"
                >
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-cyan-300 text-2xl">valve</span>
                        <div>
                            <h3 className="text-lg font-bold text-white">{getProcessTitle(node)}</h3>
                            <div className="flex flex-wrap gap-2 mt-1">
                                <span className="text-[11px] text-cyan-300">{getHubLevelText(extension.hubLevel)}</span>
                                <span className="text-[11px] text-slate-400">{getNodeTypeLabel(node.type)}</span>
                                <span className="text-[11px] text-slate-400">{node.operatingPressure || '-'} MPa</span>
                                <span className="text-[11px] text-emerald-300">{getStrategyText(extension.distributionStrategy)}</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-gray-700/50 rounded"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="overflow-y-auto flex-1 p-4">
                    <div
                        ref={diagramRef}
                        className="relative h-[430px] rounded-xl border border-slate-800 bg-slate-950 overflow-hidden"
                        style={{
                            backgroundImage: 'radial-gradient(rgba(34, 211, 238, 0.1) 1.2px, transparent 0), linear-gradient(180deg, #020617 0%, #0f172a 100%)',
                            backgroundSize: '16px 16px, 100% 100%',
                        }}
                    >
                        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ fontFamily: 'inherit' }}>
                            <defs>
                                <marker id="hub-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                                    <path d="M0,0 L6,3 L0,6 Z" fill="#67e8f9" />
                                </marker>
                                <filter id="hub-glow">
                                    <feGaussianBlur stdDeviation="0.9" result="blur" />
                                    <feMerge>
                                        <feMergeNode in="blur" />
                                        <feMergeNode in="SourceGraphic" />
                                    </feMerge>
                                </filter>
                                <style>
                                    {`
                                        @keyframes hubFlowDash {
                                            from { stroke-dashoffset: 28; }
                                            to { stroke-dashoffset: 0; }
                                        }
                                        .hub-flow-runner {
                                            animation: hubFlowDash 1.35s linear infinite;
                                        }
                                    `}
                                </style>
                            </defs>
                            <line x1="8" y1="30" x2="92" y2="30" stroke="rgba(148,163,184,0.24)" strokeWidth="5" strokeLinecap="square" vectorEffect="non-scaling-stroke" />
                            <line x1="10" y1="30" x2="90" y2="30" stroke="rgba(51,65,85,0.58)" strokeWidth="3" strokeLinecap="square" vectorEffect="non-scaling-stroke" />
                            <line x1="8" y1="62" x2="92" y2="62" stroke="rgba(148,163,184,0.22)" strokeWidth="5" strokeLinecap="square" vectorEffect="non-scaling-stroke" />
                            <line x1="10" y1="62" x2="90" y2="62" stroke="rgba(51,65,85,0.54)" strokeWidth="3" strokeLinecap="square" vectorEffect="non-scaling-stroke" />
                            <line x1="56" y1="62" x2="56" y2="88" stroke="rgba(148,163,184,0.22)" strokeWidth="5" strokeLinecap="square" vectorEffect="non-scaling-stroke" />
                            <line x1="56" y1="62" x2="56" y2="88" stroke="rgba(51,65,85,0.52)" strokeWidth="3" strokeLinecap="square" vectorEffect="non-scaling-stroke" />
                            {activeConnections.map((conn, index) => {
                                const fromPort = extension.ports?.find(p => p.portId === conn.fromPort)
                                const toPort = extension.ports?.find(p => p.portId === conn.toPort)
                                const from = portLayout.get(conn.fromPort) || { x: 15, y: 50, labelX: 4, labelY: 42 }
                                const to = portLayout.get(conn.toPort) || { x: 85, y: 50, labelX: 68, labelY: 42 }
                                const open = isConnectionOpen(conn)
                                const color = open ? getFlowPathColor(index) : '#ef4444'
                                const routePath = createOrthogonalPath(conn, from, to)
                                const pathId = `hub-flow-${getSvgSafeId(conn.fromPort)}-${getSvgSafeId(conn.toPort)}`

                                return (
                                    <g key={`${conn.fromPort}-${conn.toPort}`}>
                                        <path
                                            id={pathId}
                                            d={routePath}
                                            fill="none"
                                            stroke={color}
                                            strokeWidth="4"
                                            strokeLinecap="square"
                                            strokeLinejoin="miter"
                                            strokeDasharray={open ? undefined : '3 2'}
                                            markerEnd={open ? 'url(#hub-arrow)' : undefined}
                                            opacity={open ? 1 : 0.72}
                                            vectorEffect="non-scaling-stroke"
                                        />
                                        {open && (
                                            <>
                                                <path
                                                    d={routePath}
                                                    fill="none"
                                                    stroke="#ecfeff"
                                                    strokeWidth="1.6"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeDasharray="7 21"
                                                    className="hub-flow-runner"
                                                    opacity="0.9"
                                                    filter="url(#hub-glow)"
                                                    vectorEffect="non-scaling-stroke"
                                                    style={{ animationDelay: `${index * -0.18}s` }}
                                                />
                                                <circle r="0.85" fill="#e0f2fe" opacity="0.95" filter="url(#hub-glow)">
                                                    <animateMotion dur="1.8s" repeatCount="indefinite" begin={`${index * 0.22}s`} rotate="auto">
                                                        <mpath href={`#${pathId}`} />
                                                    </animateMotion>
                                                </circle>
                                            </>
                                        )}
                                        <title>
                                            {`${fromPort ? getPortDisplayName(fromPort) : conn.fromPort} -> ${toPort ? getPortDisplayName(toPort) : conn.toPort}`}
                                        </title>
                                    </g>
                                )
                            })}
                        </svg>

                        <div className="absolute left-4 top-4 text-[11px] font-semibold text-emerald-300">{processSummary}</div>

                        {ports.map(port => {
                            const position = portLayout.get(port.portId)
                            if (!position) return null
                            const color = port.direction === PortDirection.IN ? '#34d399' : '#38bdf8'
                            return (
                                <span
                                    key={`${port.portId}-anchor`}
                                    className="absolute z-[9] h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 shadow-[0_0_8px_rgba(34,211,238,0.55)]"
                                    style={{ left: `${position.x}%`, top: `${position.y}%`, backgroundColor: color }}
                                />
                            )
                        })}

                        {valveNodes.map((valve) => {
                            const open = isValveOpen(valve.id)
                            const valveColor = open ? '#22c55e' : '#ef4444'
                            return (
                                <div
                                    key={valve.id}
                                    className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
                                    style={{ left: `${valve.x}%`, top: `${valve.y}%` }}
                                >
                                    <button
                                        type="button"
                                        onClick={() => toggleValve(valve)}
                                        className="flex flex-col items-center gap-0.5 rounded px-1 py-0.5 text-[10px] leading-none text-white transition-transform hover:scale-125"
                                        title={`${valve.label} ${valve.name}：${open ? '开' : '关'}，点击切换`}
                                    >
                                        <svg
                                            width="20"
                                            height="12"
                                            viewBox="0 0 20 12"
                                            style={{ transform: `rotate(${valve.angle ?? 0}deg)` }}
                                            aria-hidden="true"
                                        >
                                            <rect x="0.5" y="0.5" width="19" height="11" rx="1.5" fill="rgba(2,6,23,0.94)" stroke="rgba(255,255,255,0.2)" />
                                            <path
                                                d="M2 2 L10 6 L2 10 Z M18 2 L10 6 L18 10 Z"
                                                fill={open ? 'rgba(34,197,94,0.16)' : 'rgba(239,68,68,0.18)'}
                                                stroke={valveColor}
                                                strokeWidth="1.25"
                                                strokeLinejoin="round"
                                            />
                                            <circle cx="10" cy="6" r="2.15" fill="#020617" stroke={valveColor} strokeWidth="1.1" />
                                            <circle cx="10" cy="6" r="1.05" fill={valveColor} />
                                            {!open && <path d="M3.5 2.4 L16.5 9.6" stroke={valveColor} strokeWidth="1.2" strokeLinecap="round" />}
                                        </svg>
                                        <span className="rounded bg-slate-950/80 px-1 font-semibold tracking-normal">{valve.label}</span>
                                        <span className="font-semibold tracking-normal" style={{ color: valveColor }}>{open ? '开' : '关'}</span>
                                    </button>
                                    {valve.cutoffAction && (
                                        <button
                                            type="button"
                                            onClick={() => toggleValve(valve)}
                                            className={`rounded border px-1.5 py-0.5 text-[9px] font-bold leading-none shadow-[0_0_10px_rgba(239,68,68,0.28)] transition-colors ${
                                                open
                                                    ? 'border-red-400/45 bg-red-950/75 text-red-100 hover:border-red-200 hover:bg-red-800/85'
                                                    : 'border-emerald-400/45 bg-emerald-950/75 text-emerald-100 hover:border-emerald-200 hover:bg-emerald-800/85'
                                            }`}
                                            title={valve.cutoffAction.description || valve.cutoffAction.label}
                                        >
                                            {open ? '截断' : '恢复'}
                                        </button>
                                    )}
                                </div>
                            )
                        })}

                        {ports.map(port => {
                            const position = portLayout.get(port.portId)!
                            const labelPosition = labelOverrides[port.portId] || { x: position.labelX, y: position.labelY }
                            const metrics = getLivePortMetrics(port, metricTick)
                            const isInput = port.direction === PortDirection.IN
                            return (
                                <button
                                    key={port.portId}
                                    type="button"
                                    onPointerDown={(event) => beginLabelDrag(port.portId, position, event)}
                                    onClick={() => {
                                        onPortClick?.(port.portId)
                                        onPipelineClick?.(port.pipelineId)
                                    }}
                                    className={`absolute w-[184px] rounded-lg border px-3 py-2 text-left shadow-[0_4px_12px_rgba(0,0,0,0.4)] backdrop-blur-md transition-all duration-200 ${
                                        isInput
                                            ? 'border-emerald-400/40 bg-slate-950/80 hover:border-emerald-300 hover:shadow-[0_4px_15px_rgba(16,185,129,0.25)] hover:scale-105'
                                            : 'border-sky-400/40 bg-slate-950/80 hover:border-sky-300 hover:shadow-[0_4px_15px_rgba(56,189,248,0.25)] hover:scale-105'
                                    }`}
                                    style={{ left: `${labelPosition.x}%`, top: `${labelPosition.y}%`, cursor: 'move', zIndex: 30 }}
                                    title={port.pipelineName}
                                >
                                    <div className="flex items-center justify-between gap-1.5">
                                        <span className="truncate text-xs font-bold text-white">{getPortShortName(port)}</span>
                                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${getStatusColor(port.status)}`} />
                                    </div>
                                    <div className={`truncate text-[10px] opacity-75 mt-0.5 ${isInput ? 'text-emerald-200' : 'text-sky-200'}`}>{port.pipelineName}</div>
                                    <div className="mt-2 flex items-center justify-between text-[9px] font-bold text-slate-300 border-t border-white/5 pt-1.5">
                                        <span className="text-white/95">{formatThroughput(metrics.throughput).replace(' 万方/天', '万方')}</span>
                                        <span className="w-px h-2 bg-white/10" />
                                        <span className="text-cyan-300">{formatPressure(metrics.pressure)}</span>
                                        <span className="w-px h-2 bg-white/10" />
                                        <span className="text-amber-300">{formatTemperature(metrics.temperature)}</span>
                                    </div>
                                </button>
                            )
                        })}
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {activeConnections.map((conn, index) => {
                            const fromPort = extension.ports?.find(p => p.portId === conn.fromPort)
                            const toPort = extension.ports?.find(p => p.portId === conn.toPort)
                            const open = isConnectionOpen(conn)
                            const metrics = getLiveConnectionMetrics(conn, metricTick)
                            return (
                                <div
                                    key={`${conn.fromPort}-${conn.toPort}-summary`}
                                    className={`rounded-md border px-3 py-2 ${open ? 'border-slate-700 bg-slate-900/80' : 'border-red-500/45 bg-red-950/20'}`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: open ? getFlowPathColor(index) : '#ef4444' }} />
                                        <span className={`text-xs font-bold ${open ? 'text-cyan-200' : 'text-red-300'}`}>
                                            {open ? formatThroughput(metrics.throughput) : '停输'}
                                        </span>
                                    </div>
                                    <div className="mt-1 truncate text-xs text-slate-200">
                                        {fromPort ? getPortShortName(fromPort) : conn.fromPort}
                                        <span className="px-1 text-slate-500">-&gt;</span>
                                        {toPort ? getPortShortName(toPort) : conn.toPort}
                                    </div>
                                    <div className="mt-1 truncate text-[11px] text-slate-500">
                                        {open
                                            ? `${formatPressure(metrics.pressure)} / ${formatTemperature(metrics.temperature)} · ${conn.remark || '已导通'}`
                                            : '对应阀门关闭，通道停止流动'}
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                        {valveNodes.map(valve => {
                            const open = isValveOpen(valve.id)
                            return (
                                <span
                                    key={`${valve.id}-status`}
                                    className="inline-flex items-center gap-1.5"
                                >
                                    <button
                                        type="button"
                                        onClick={() => toggleValve(valve)}
                                        className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
                                    >
                                        <span className={`h-2 w-2 rounded-full ${open ? 'bg-green-500' : 'bg-red-500'}`} />
                                        {valve.label} {valve.name}：{open ? '开' : '关'}
                                    </button>
                                    {valve.cutoffAction && (
                                        <button
                                            type="button"
                                            onClick={() => toggleValve(valve)}
                                            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold hover:text-white ${
                                                open
                                                    ? 'border-red-500/35 bg-red-950/50 text-red-200 hover:border-red-300'
                                                    : 'border-emerald-500/35 bg-emerald-950/50 text-emerald-200 hover:border-emerald-300'
                                            }`}
                                            title={valve.cutoffAction.description || valve.cutoffAction.label}
                                        >
                                            {open ? valve.cutoffAction.label : '恢复外部联动'}
                                        </button>
                                    )}
                                </span>
                            )
                        })}
                        {extension.ports?.map(port => (
                            <span key={`${port.portId}-status`} className="inline-flex items-center gap-1.5">
                                <span className={`h-2 w-2 rounded-full ${getStatusColor(port.status)}`} />
                                {getPortShortName(port)}：{getPortStatusText(port.status)}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="px-4 py-3 border-t border-slate-700 bg-slate-900 shrink-0">
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors text-sm"
                        >
                            关闭
                        </button>
                    </div>
                </div>
                <div
                    className="absolute bottom-1 right-1 h-5 w-5 cursor-nwse-resize rounded border-b-2 border-r-2 border-cyan-300/70 opacity-80 hover:opacity-100"
                    onPointerDown={beginPanelResize}
                    title="拖动改变窗口大小"
                />
            </div>
        </div>
    )
}

export default HubDetailPanel
