import React, { useState } from 'react'
import { SCADA_DATA_MAP } from '@/views/global-pipeline/scadaConfig'

export type TrendChartStation = {
    name: string
    inP: number
    outP: number
    baselineInP?: number
    baselineOutP?: number
    flowRate?: number
    baselineFlowRate?: number
    type: string
    mileage: number
}

export type TrendChartConfig = {
    pipelineId: string
    title: string
    color: string
    stations: TrendChartStation[]
    mileageMode: 'estimated' | 'sequence'
}

const SIMULATION_PRESSURE_AXIS_MIN_MPA = 0
const SIMULATION_PRESSURE_AXIS_MAX_MPA = 10
const SIMULATION_FLOW_AXIS_MAX_10K_NM3D = 4000

function clampNumber(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
}

function hexToRgba(hex: string, alpha: number): string {
    const normalized = hex.replace('#', '')
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return `rgba(59,130,246,${alpha})`
    }

    const r = Number.parseInt(normalized.slice(0, 2), 16)
    const g = Number.parseInt(normalized.slice(2, 4), 16)
    const b = Number.parseInt(normalized.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${alpha})`
}

function formatSignedDelta(value: number, digits = 2, unit = ''): string {
    if (!Number.isFinite(value) || Math.abs(value) < 0.0005) return `0${unit}`
    return `${value > 0 ? '+' : ''}${value.toFixed(digits)}${unit}`
}

function getDeltaTone(delta?: number): {
    color: string
    bg: string
    border: string
    label: string
    arrow: string
} {
    if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 0.0005) {
        return {
            color: '#cbd5e1',
            bg: 'rgba(51,65,85,0.45)',
            border: 'rgba(148,163,184,0.28)',
            label: '持平',
            arrow: '→',
        }
    }
    if (delta > 0) {
        return {
            color: '#fbbf24',
            bg: 'rgba(120,53,15,0.46)',
            border: 'rgba(251,191,36,0.42)',
            label: '增加',
            arrow: '↑',
        }
    }
    return {
        color: '#38bdf8',
        bg: 'rgba(8,47,73,0.52)',
        border: 'rgba(56,189,248,0.42)',
        label: '减少',
        arrow: '↓',
    }
}

/**
 * 西气东输一线 · 水力坡降线（SVG）
 *
 * 绘制逻辑：
 *   - 压气站：显示 inP 和 outP 两个点，竖线跃变（增压）
 *   - 其余站场：只显示 inP
 *   - 用一条连续线串起来：上一站 outP → 下一站 inP → (如果是压气站) outP → ...
 *   - 形成经典的 SCADA 水力坡降锯齿形
 */
export const LegacyPressureTrendChart: React.FC<{
    title: string
    accentColor: string
    stations: TrendChartStation[]
    mileageMode: 'estimated' | 'sequence'
    onClose: () => void
    onMouseDown?: (e: React.MouseEvent) => void
    isDragging?: boolean
}> = ({ title, accentColor, stations, mileageMode, onClose, onMouseDown, isDragging }) => {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
    const hasStations = stations.length > 0

    const W = 860, H = 320
    const padL = 50, padR = 25, padT = 25, padB = 70
    const chartW = W - padL - padR
    const chartH = H - padT - padB

    const allP = hasStations
        ? stations.flatMap((station) => station.type === 'compressor' ? [station.inP, station.outP] : [station.inP])
        : [0, 1]
    const minP = Math.floor(Math.min(...allP) * 2) / 2
    const maxP = Math.ceil(Math.max(...allP) * 2) / 2 + 0.5
    const rangeP = maxP - minP || 1
    const maxMileage = hasStations ? Math.max(...stations.map((station) => station.mileage), 1) : 1
    const xAxisLabel = mileageMode === 'estimated' ? '估算里程 km' : '站序'

    const borderColor = hexToRgba(accentColor, 0.2)
    const headerBorderColor = hexToRgba(accentColor, 0.1)
    const areaTopColor = hexToRgba(accentColor, 0.15)
    const areaMidColor = hexToRgba(accentColor, 0.05)
    const areaBottomColor = hexToRgba(accentColor, 0.01)

    const xScale = (station: TrendChartStation, index: number) => {
        if (mileageMode === 'estimated' && maxMileage > 0) {
            return padL + (station.mileage / maxMileage) * chartW
        }
        return padL + ((stations.length <= 1 ? 0 : index / (stations.length - 1)) * chartW)
    }
    const yScale = (p: number) => padT + chartH - ((p - minP) / rangeP) * chartH

    const buildHydraulicPath = () => {
        let path = ''
        stations.forEach((station, index) => {
            const x = xScale(station, index)
            const yIn = yScale(station.inP)
            const isCompressor = station.type === 'compressor'

            if (index === 0) {
                path += `M ${x} ${yIn}`
                if (isCompressor) path += ` L ${x} ${yScale(station.outP)}`
                return
            }

            path += ` L ${x} ${yIn}`
            if (isCompressor) path += ` L ${x} ${yScale(station.outP)}`
        })
        return path
    }

    const hydraulicPath = hasStations ? buildHydraulicPath() : ''
    const lastStation = hasStations ? stations[stations.length - 1] : null
    const areaPath = hasStations && lastStation
        ? `${hydraulicPath} L ${xScale(lastStation, stations.length - 1)} ${padT + chartH} L ${padL} ${padT + chartH} Z`
        : ''

    const gridLines: number[] = []
    for (let p = Math.ceil(minP); p <= Math.floor(maxP); p++) {
        gridLines.push(p)
    }

    return (
        <div
            className={`absolute z-20 flex flex-col select-none overflow-hidden ${isDragging ? 'cursor-grabbing' : ''}`}
            style={{
                width: '920px',
                height: '420px',
                background: 'linear-gradient(180deg, rgba(5,10,18,0.97) 0%, rgba(8,15,12,0.97) 100%)',
                backdropFilter: 'blur(16px)',
                borderRadius: '12px',
                border: `1px solid ${borderColor}`,
                boxShadow: '0 16px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
        >
            <div style={{ height: '3px', background: `linear-gradient(90deg, ${accentColor}, ${hexToRgba(accentColor, 0.75)}, ${accentColor})`, borderRadius: '12px 12px 0 0' }} />
            <div
                className="px-5 py-2.5 flex justify-between items-center shrink-0 cursor-grab active:cursor-grabbing"
                style={{ borderBottom: `1px solid ${headerBorderColor}` }}
                onMouseDown={onMouseDown}
            >
                <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: '#e2e8f0' }}>
                    <span className="material-symbols-outlined text-lg" style={{ color: accentColor }}>show_chart</span>
                    <span>{title} · 里程进出站压力图</span>
                    <span style={{ color: '#64748b', fontSize: '10px', fontWeight: 'normal' }}>{xAxisLabel}</span>
                </h3>
                <div className="flex items-center gap-3" onMouseDown={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-4 mr-2" style={{ fontSize: '11px' }}>
                        <span className="flex items-center gap-1.5">
                            <span style={{ display: 'inline-block', width: 8, height: 8, background: accentColor, borderRadius: '50%' }} />
                            <span style={{ color: '#94a3b8' }}>压气站 (进/出)</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span style={{ display: 'inline-block', width: 6, height: 6, background: '#f59e0b', borderRadius: '50%' }} />
                            <span style={{ color: '#94a3b8' }}>分输/阀室 (进)</span>
                        </span>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                        <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 px-4 py-2 overflow-hidden">
                {!hasStations ? (
                    <div className="h-full flex items-center justify-center text-gray-500">
                        <div className="text-center">
                            <span className="material-symbols-outlined text-5xl block mb-3" style={{ color: `${accentColor}66` }}>show_chart</span>
                            <p className="text-lg">暂无压力图数据</p>
                            <p className="text-sm text-gray-600 mt-2">当前管线还没有可用的进出站压力数据</p>
                        </div>
                    </div>
                ) : (
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
                        <defs>
                            <linearGradient id="hydraulicGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={areaTopColor} />
                                <stop offset="60%" stopColor={areaMidColor} />
                                <stop offset="100%" stopColor={areaBottomColor} />
                            </linearGradient>
                        </defs>

                        {gridLines.map((pressure) => (
                            <g key={pressure}>
                                <line x1={padL} y1={yScale(pressure)} x2={padL + chartW} y2={yScale(pressure)} stroke="rgba(100,116,139,0.12)" strokeWidth={1} />
                                <text x={padL - 8} y={yScale(pressure) + 4} textAnchor="end" fill="#475569" fontSize="10" fontFamily="monospace">{pressure}</text>
                            </g>
                        ))}

                        <path d={areaPath} fill="url(#hydraulicGrad)" />
                        <path d={hydraulicPath} fill="none" stroke={accentColor} strokeWidth={2} strokeLinejoin="round" />

                        {stations.map((station, index) => {
                            const x = xScale(station, index)
                            const yIn = yScale(station.inP)
                            const isCompressor = station.type === 'compressor'
                            const yOut = isCompressor ? yScale(station.outP) : yIn
                            const isHovered = hoveredIdx === index
                            const showLabel = isCompressor || isHovered || index === 0 || index === stations.length - 1

                            return (
                                <g
                                    key={`${station.name}-${index}`}
                                    onMouseEnter={() => setHoveredIdx(index)}
                                    onMouseLeave={() => setHoveredIdx(null)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <rect x={x - 10} y={padT} width={20} height={chartH} fill="transparent" />
                                    {isHovered && <line x1={x} y1={padT} x2={x} y2={padT + chartH} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />}

                                    {isCompressor ? (
                                        <>
                                            <line
                                                x1={x}
                                                y1={yIn}
                                                x2={x}
                                                y2={yOut}
                                                stroke={isHovered ? '#e2e8f0' : accentColor}
                                                strokeWidth={isHovered ? 2.5 : 1.5}
                                                opacity={isHovered ? 1 : 0.6}
                                            />
                                            <circle cx={x} cy={yIn} r={isHovered ? 4.5 : 3} fill={accentColor} stroke={isHovered ? '#e2e8f0' : hexToRgba(accentColor, 0.35)} strokeWidth={1.5} />
                                            <circle cx={x} cy={yOut} r={isHovered ? 5 : 3.5} fill="#f8fafc" stroke={isHovered ? '#ffffff' : hexToRgba(accentColor, 0.45)} strokeWidth={1.5} />
                                            {isHovered && (
                                                <>
                                                    <text x={x + 8} y={yIn + 3} fill="#f59e0b" fontSize="9" fontFamily="monospace">
                                                        {station.inP.toFixed(2)}
                                                    </text>
                                                    <text x={x + 8} y={yOut + 3} fill={accentColor} fontSize="9" fontFamily="monospace">
                                                        {station.outP.toFixed(2)}
                                                    </text>
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <circle
                                            cx={x}
                                            cy={yIn}
                                            r={isHovered ? 4 : 2}
                                            fill="#f59e0b"
                                            stroke={isHovered ? '#fde68a' : 'none'}
                                            strokeWidth={1.5}
                                            opacity={isHovered ? 1 : 0.7}
                                        />
                                    )}

                                    {showLabel && (
                                        <text
                                            x={x}
                                            y={padT + chartH + 14}
                                            textAnchor="end"
                                            fill={isHovered ? '#e2e8f0' : '#4b5563'}
                                            fontSize={isHovered ? '10' : '8'}
                                            fontWeight={isHovered ? 600 : 400}
                                            transform={`rotate(-50, ${x}, ${padT + chartH + 14})`}
                                        >
                                            {station.name.replace(/压气站|分输压气站|分输站|清管站|分输联络站|分输清管站|末站/, '')}
                                        </text>
                                    )}

                                    {isHovered && (
                                        <g>
                                            <rect
                                                x={Math.min(x - 76, W - padR - 153)}
                                                y={Math.max(padT, Math.min(yIn, yOut) - 56)}
                                                width={152}
                                                height={isCompressor ? 64 : 50}
                                                rx={6}
                                                fill="rgba(15,23,42,0.95)"
                                                stroke={hexToRgba(accentColor, 0.25)}
                                                strokeWidth={1}
                                            />
                                            <text
                                                x={Math.min(x, W - padR - 77)}
                                                y={Math.max(padT + 14, Math.min(yIn, yOut) - 38)}
                                                textAnchor="middle"
                                                fill="#e2e8f0"
                                                fontSize="11"
                                                fontWeight={600}
                                            >
                                                {station.name}
                                            </text>
                                            <text
                                                x={Math.min(x, W - padR - 77)}
                                                y={Math.max(padT + 27, Math.min(yIn, yOut) - 24)}
                                                textAnchor="middle"
                                                fill="#94a3b8"
                                                fontSize="9"
                                                fontFamily="monospace"
                                            >
                                                {mileageMode === 'estimated' ? `${station.mileage.toFixed(1)} km` : `站序 ${index + 1}`}
                                            </text>
                                            {isCompressor ? (
                                                <>
                                                    <text
                                                        x={Math.min(x - 64, W - padR - 141)}
                                                        y={Math.max(padT + 42, Math.min(yIn, yOut) - 7)}
                                                        fill="#f59e0b"
                                                        fontSize="10"
                                                        fontFamily="monospace"
                                                    >
                                                        进 {station.inP.toFixed(3)}
                                                    </text>
                                                    <text
                                                        x={Math.min(x + 8, W - padR - 69)}
                                                        y={Math.max(padT + 42, Math.min(yIn, yOut) - 7)}
                                                        fill={accentColor}
                                                        fontSize="10"
                                                        fontFamily="monospace"
                                                    >
                                                        出 {station.outP.toFixed(3)}
                                                    </text>
                                                    <text
                                                        x={Math.min(x, W - padR - 77)}
                                                        y={Math.max(padT + 56, Math.min(yIn, yOut) + 7)}
                                                        textAnchor="middle"
                                                        fill="#94a3b8"
                                                        fontSize="9"
                                                    >
                                                        增压 +{(station.outP - station.inP).toFixed(3)} MPa
                                                    </text>
                                                </>
                                            ) : (
                                                <text
                                                    x={Math.min(x, W - padR - 77)}
                                                    y={Math.max(padT + 42, Math.min(yIn, yOut) - 7)}
                                                    textAnchor="middle"
                                                    fill="#f59e0b"
                                                    fontSize="10"
                                                    fontFamily="monospace"
                                                >
                                                    进站 {station.inP.toFixed(3)} MPa
                                                </text>
                                            )}
                                        </g>
                                    )}
                                </g>
                            )
                        })}
                    </svg>
                )}
            </div>
        </div>
    )
}

export const PressureTrendChart: React.FC<{
    config: TrendChartConfig
    onClose: () => void
    onMouseDown?: (e: React.MouseEvent) => void
    isDragging?: boolean
    standalone?: boolean
    width?: number
    height?: number
    resizeMode?: 'width' | 'both'
    revealProgress?: number
    onResizeMouseDown?: (e: React.MouseEvent) => void
}> = ({ config, onClose, onMouseDown, isDragging, standalone = false, width = 920, height = 420, resizeMode = 'width', revealProgress = 1, onResizeMouseDown }) => {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

    const stations = config.stations
    const accentColor = config.color
    const hasData = stations.length > 0
    const jumpThreshold = 0.001

    const W = 860
    const H = 340
    const padL = 50
    const padR = 62
    const padT = 25
    const padB = 92
    const chartW = W - padL - padR
    const chartH = H - padT - padB

    const minP = SIMULATION_PRESSURE_AXIS_MIN_MPA
    const maxP = SIMULATION_PRESSURE_AXIS_MAX_MPA
    const rangeP = Math.max(maxP - minP, 1)
    const flowValues = stations
        .map((station) => station.flowRate)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    const hasFlowData = flowValues.length > 0
    const hasBaselinePressure = stations.some(station =>
        typeof station.baselineInP === 'number'
        || typeof station.baselineOutP === 'number'
    )
    const hasBaselineFlow = stations.some(station => typeof station.baselineFlowRate === 'number')
    const flowAxisMax = SIMULATION_FLOW_AXIS_MAX_10K_NM3D
    const flowColor = '#a78bfa'
    const baselineColor = 'rgba(148,163,184,0.72)'
    const maxMileage = hasData ? Math.max(stations[stations.length - 1]?.mileage ?? 0, 1) : 1
    const safeRevealProgress = clampNumber(revealProgress, 0, 1)
    const revealWidth = chartW * safeRevealProgress
    const chartClipId = `hydraulicClip-${config.pipelineId}`

    const xScale = (mileage: number) => padL + (mileage / maxMileage) * chartW
    const yScale = (p: number) => padT + chartH - ((p - minP) / rangeP) * chartH
    const flowYScale = (flow: number) => padT + chartH - (flow / flowAxisMax) * chartH

    const buildHydraulicPath = () => {
        let path = ''
        stations.forEach((s, i) => {
            const x = xScale(s.mileage)
            const yIn = yScale(s.inP)
            const yOut = yScale(s.outP)
            const hasJump = Math.abs(s.outP - s.inP) > jumpThreshold

            if (i === 0) {
                path += `M ${x} ${yIn}`
                if (hasJump) path += ` L ${x} ${yOut}`
                return
            }

            path += ` L ${x} ${yIn}`
            if (hasJump) path += ` L ${x} ${yOut}`
        })
        return path
    }

    const hydraulicPath = hasData ? buildHydraulicPath() : ''
    const buildBaselinePressurePath = () => {
        let path = ''
        stations.forEach((s, i) => {
            const baselineIn = typeof s.baselineInP === 'number' ? s.baselineInP : s.baselineOutP
            const baselineOut = typeof s.baselineOutP === 'number' ? s.baselineOutP : baselineIn
            if (baselineIn == null || baselineOut == null) return

            const x = xScale(s.mileage)
            const yIn = yScale(baselineIn)
            const yOut = yScale(baselineOut)
            const hasJump = Math.abs(baselineOut - baselineIn) > jumpThreshold

            if (i === 0 || !path) {
                path += `M ${x} ${yIn}`
                if (hasJump) path += ` L ${x} ${yOut}`
                return
            }

            path += ` L ${x} ${yIn}`
            if (hasJump) path += ` L ${x} ${yOut}`
        })
        return path
    }
    const baselinePressurePath = hasBaselinePressure ? buildBaselinePressurePath() : ''
    const buildFlowPath = () => {
        let path = ''
        stations.forEach((station) => {
            if (typeof station.flowRate !== 'number' || !Number.isFinite(station.flowRate)) return
            const x = xScale(station.mileage)
            const y = flowYScale(station.flowRate)
            path += path ? ` L ${x} ${y}` : `M ${x} ${y}`
        })
        return path
    }
    const flowPath = hasFlowData ? buildFlowPath() : ''
    const buildBaselineFlowPath = () => {
        let path = ''
        stations.forEach((station) => {
            if (typeof station.baselineFlowRate !== 'number' || !Number.isFinite(station.baselineFlowRate)) return
            const x = xScale(station.mileage)
            const y = flowYScale(station.baselineFlowRate)
            path += path ? ` L ${x} ${y}` : `M ${x} ${y}`
        })
        return path
    }
    const baselineFlowPath = hasBaselineFlow ? buildBaselineFlowPath() : ''
    const areaPath = hasData
        ? `${hydraulicPath} L ${xScale(maxMileage)} ${padT + chartH} L ${padL} ${padT + chartH} Z`
        : ''
    const pressureDeltaSamples = stations
        .map(station => {
            const before = typeof station.baselineOutP === 'number' ? station.baselineOutP : station.baselineInP
            return typeof before === 'number' ? station.outP - before : null
        })
        .filter((value): value is number => value != null && Number.isFinite(value))
    const avgPressureDelta = pressureDeltaSamples.length
        ? pressureDeltaSamples.reduce((sum, value) => sum + value, 0) / pressureDeltaSamples.length
        : undefined
    const maxPressureDelta = pressureDeltaSamples.length
        ? pressureDeltaSamples.reduce((best, value) => Math.abs(value) > Math.abs(best) ? value : best, pressureDeltaSamples[0])
        : undefined
    const pressureDeltaTone = getDeltaTone(avgPressureDelta)
    const highlightedDeltaIndices = new Set(
        stations
            .map((station, index) => {
                const beforePressureOut = typeof station.baselineOutP === 'number' ? station.baselineOutP : station.baselineInP
                const pressureDelta = typeof beforePressureOut === 'number' ? station.outP - beforePressureOut : undefined
                const flowDelta = typeof station.baselineFlowRate === 'number' && typeof station.flowRate === 'number'
                    ? station.flowRate - station.baselineFlowRate
                    : undefined
                const pressureScore = pressureDelta == null ? 0 : Math.abs(pressureDelta) / 0.05
                const flowScore = flowDelta == null ? 0 : Math.abs(flowDelta) / 200
                return {
                    index,
                    score: Math.max(pressureScore, flowScore),
                }
            })
            .filter(item => item.score >= 1)
            .sort((left, right) => right.score - left.score)
            .slice(0, 7)
            .map(item => item.index),
    )

    const gridLines: number[] = []
    for (let p = Math.ceil(minP); p <= Math.floor(maxP); p++) {
        gridLines.push(p)
    }

    const mileageTicks = Array.from({ length: 6 }, (_, idx) => Number(((maxMileage / 5) * idx).toFixed(1)))
    const flowTicks = hasFlowData
        ? Array.from({ length: 5 }, (_, idx) => Math.round((flowAxisMax / 4) * idx))
        : []

    return (
        <div
            className={`${standalone ? 'h-full w-full' : `absolute z-20 ${isDragging ? 'cursor-grabbing' : ''}`} flex flex-col select-none overflow-hidden`}
            style={{
                width: standalone ? '100%' : `${width}px`,
                height: standalone ? '100%' : `${height}px`,
                background: 'linear-gradient(180deg, rgba(5,10,18,0.97) 0%, rgba(8,15,12,0.97) 100%)',
                backdropFilter: 'blur(16px)',
                borderRadius: standalone ? '0' : '12px',
                border: `1px solid ${hexToRgba(accentColor, 0.2)}`,
                boxShadow: standalone ? 'none' : '0 16px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
        >
            <div style={{ height: '3px', background: `linear-gradient(90deg, ${accentColor}, ${hexToRgba(accentColor, 0.65)}, ${accentColor})`, borderRadius: standalone ? '0' : '12px 12px 0 0' }} />
            <div
                className={`px-5 py-2.5 flex justify-between items-center shrink-0 ${standalone ? '' : 'cursor-grab active:cursor-grabbing'}`}
                style={{ borderBottom: `1px solid ${hexToRgba(accentColor, 0.12)}` }}
                onMouseDown={onMouseDown}
            >
                <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: '#e2e8f0' }}>
                    <span className="material-symbols-outlined text-lg" style={{ color: accentColor }}>show_chart</span>
                    <span>{config.title} · 里程进出站压力/流量图</span>
                    <span style={{ color: '#64748b', fontSize: '10px', fontWeight: 'normal' }}>单位: MPa / 万方/天 / km</span>
                    {config.mileageMode === 'estimated' && (
                        <span style={{ color: '#94a3b8', fontSize: '10px', fontWeight: 'normal' }}>主干线累计长度推算</span>
                    )}
                    {safeRevealProgress < 1 && (
                        <span style={{ color: accentColor, fontSize: '10px', fontWeight: 600 }}>
                            曲线生成 {Math.round(safeRevealProgress * 100)}%
                        </span>
                    )}
                </h3>
                <div className="flex items-center gap-3" onMouseDown={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-3 text-[10px] text-slate-400">
                        <span className="flex items-center gap-1">
                            <span style={{ width: 16, height: 2, background: accentColor, display: 'inline-block' }} />
                            仿真后压力
                        </span>
                        {hasBaselinePressure && (
                            <span className="flex items-center gap-1">
                                <span style={{ width: 16, height: 0, borderTop: `2px dashed ${baselineColor}`, display: 'inline-block' }} />
                                仿真前
                            </span>
                        )}
                        {hasFlowData && (
                            <span className="flex items-center gap-1">
                                <span style={{ width: 16, height: 0, borderTop: `2px dashed ${flowColor}`, display: 'inline-block' }} />
                                仿真后流量
                            </span>
                        )}
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                        <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                </div>
            </div>

            {!hasData ? (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                        <span className="material-symbols-outlined text-5xl block mb-3" style={{ color: `${accentColor}66` }}>show_chart</span>
                        <p className="text-lg">暂无里程进出站压力图数据</p>
                        <p className="text-sm text-gray-600 mt-2">
                            {(SCADA_DATA_MAP[config.pipelineId]?.data && Object.keys(SCADA_DATA_MAP[config.pipelineId].data).length > 0)
                                ? '当前主干线站序没有和 SCADA 站名匹配上'
                                : '当前管线还没有导入可用的 SCADA 压力数据'}
                        </p>
                    </div>
                </div>
            ) : (
                <div className="flex-1 px-4 py-2 overflow-hidden">
                    {avgPressureDelta != null && (
                        <div
                            className="mb-1 inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-[10px] font-semibold"
                            style={{
                                color: pressureDeltaTone.color,
                                background: pressureDeltaTone.bg,
                                borderColor: pressureDeltaTone.border,
                            }}
                        >
                            <span>{pressureDeltaTone.arrow} 平均出站压力{pressureDeltaTone.label}</span>
                            <span className="font-mono">{formatSignedDelta(avgPressureDelta, 3, ' MPa')}</span>
                            {maxPressureDelta != null && (
                                <span className="text-slate-300">最大变化 {formatSignedDelta(maxPressureDelta, 3, ' MPa')}</span>
                            )}
                        </div>
                    )}
                    {safeRevealProgress < 1 && (
                        <div className="mb-1.5 rounded-lg border border-cyan-400/20 bg-slate-950/75 px-2 py-1.5 shadow-inner shadow-cyan-950/30">
                            <div className="mb-1 flex items-center justify-between text-[10px]">
                                <span className="font-semibold text-cyan-100">曲线生成进度</span>
                                <span className="font-mono text-cyan-300">{Math.round(safeRevealProgress * 100)}%</span>
                            </div>
                            <div className="relative h-1.5 overflow-hidden rounded-full bg-slate-800/90">
                                <div
                                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400 via-cyan-300 to-sky-400"
                                    style={{
                                        width: `${Math.max(4, safeRevealProgress * 100)}%`,
                                        backgroundSize: '220% 100%',
                                        animation: 'simProgressFlow 1.1s linear infinite',
                                        boxShadow: '0 0 12px rgba(34,211,238,0.55)',
                                    }}
                                />
                                <div
                                    className="absolute inset-0"
                                    style={{
                                        backgroundImage: 'linear-gradient(110deg, transparent 0%, rgba(255,255,255,0.28) 38%, transparent 72%)',
                                        animation: 'simProgressSweep 1.35s ease-in-out infinite',
                                    }}
                                />
                            </div>
                        </div>
                    )}
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
                        <defs>
                            <linearGradient id={`hydraulicGrad-${config.pipelineId}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={accentColor} stopOpacity="0.15" />
                                <stop offset="60%" stopColor={accentColor} stopOpacity="0.05" />
                                <stop offset="100%" stopColor={accentColor} stopOpacity="0.01" />
                            </linearGradient>
                            <clipPath id={chartClipId}>
                                <rect x={padL} y={padT - 4} width={revealWidth} height={chartH + padB + 8} />
                            </clipPath>
                        </defs>

                        {gridLines.map(p => (
                            <g key={`${config.pipelineId}-grid-${p}`}>
                                <line x1={padL} y1={yScale(p)} x2={padL + chartW} y2={yScale(p)} stroke="rgba(100,116,139,0.12)" strokeWidth={1} />
                                <text x={padL - 8} y={yScale(p) + 4} textAnchor="end" fill="#475569" fontSize="10" fontFamily="monospace">{p}</text>
                            </g>
                        ))}
                        {flowTicks.map(flow => (
                            <g key={`${config.pipelineId}-flow-grid-${flow}`}>
                                <text x={padL + chartW + 8} y={flowYScale(flow) + 4} textAnchor="start" fill={hexToRgba(flowColor, 0.7)} fontSize="9" fontFamily="monospace">
                                    {flow}
                                </text>
                            </g>
                        ))}

                        <g clipPath={`url(#${chartClipId})`}>
                            <path d={areaPath} fill={`url(#hydraulicGrad-${config.pipelineId})`} />
                            {baselinePressurePath && (
                                <path d={baselinePressurePath} fill="none" stroke={baselineColor} strokeWidth={1.8} strokeDasharray="7 5" strokeLinejoin="round" />
                            )}
                            <path d={hydraulicPath} fill="none" stroke={accentColor} strokeWidth={2} strokeLinejoin="round" />
                            {baselineFlowPath && (
                                <path d={baselineFlowPath} fill="none" stroke={hexToRgba(flowColor, 0.48)} strokeWidth={1.4} strokeDasharray="2 6" strokeLinejoin="round" />
                            )}
                            {hasFlowData && (
                                <path
                                    d={flowPath}
                                    fill="none"
                                    stroke={flowColor}
                                    strokeWidth={1.8}
                                    strokeDasharray="5 4"
                                    strokeLinejoin="round"
                                    opacity={0.95}
                                />
                            )}
                        </g>

                        <g clipPath={`url(#${chartClipId})`}>
                            {stations.map((s, i) => {
                            const x = xScale(s.mileage)
                            const yIn = yScale(s.inP)
                            const yOut = yScale(s.outP)
                            const baselineOut = typeof s.baselineOutP === 'number' ? s.baselineOutP : s.baselineInP
                            const pressureDelta = typeof baselineOut === 'number' ? s.outP - baselineOut : undefined
                            const flowDelta = typeof s.baselineFlowRate === 'number' && typeof s.flowRate === 'number' ? s.flowRate - s.baselineFlowRate : undefined
                            const deltaTone = getDeltaTone(pressureDelta)
                            const flowDeltaTone = getDeltaTone(flowDelta)
                            const pressureChanged = pressureDelta != null && Math.abs(pressureDelta) > 0.005
                            const flowChanged = flowDelta != null && Math.abs(flowDelta) >= 1
                            const hasDeltaAnimation = pressureChanged || flowChanged
                            const deltaAnimationTone = pressureChanged ? deltaTone : flowDeltaTone
                            const hasJump = Math.abs(s.outP - s.inP) > jumpThreshold
                            const isHovered = hoveredIdx === i
                            const isStationLabel = s.type !== 'valve' && !/^WE1-\d+阀室$/.test(s.name)
                            const showLabel = isHovered || i === 0 || i === stations.length - 1 || isStationLabel
                            const showDeltaBadge = highlightedDeltaIndices.has(i) && !isHovered
                            const deltaBadgeText = pressureChanged
                                ? `ΔP ${formatSignedDelta(pressureDelta ?? 0, 2)}`
                                : flowChanged
                                    ? `ΔQ ${formatSignedDelta(flowDelta ?? 0, 0)}`
                                    : ''
                            const deltaBadgeWidth = Math.max(54, Math.min(84, deltaBadgeText.length * 6 + 10))
                            const deltaBadgeX = Math.max(padL + 2, Math.min(x - deltaBadgeWidth / 2, W - padR - deltaBadgeWidth - 2))
                            const deltaBadgeY = Math.max(padT + 4, yOut - 32 - (i % 2) * 14)

                                return (
                                    <g
                                        key={`${config.pipelineId}-${s.name}-${s.mileage}`}
                                        onMouseEnter={() => setHoveredIdx(i)}
                                        onMouseLeave={() => setHoveredIdx(null)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <rect x={x - 10} y={padT} width={20} height={chartH} fill="transparent" />
                                        {isHovered && <line x1={x} y1={padT} x2={x} y2={padT + chartH} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />}

                                        {hasDeltaAnimation && (
                                            <g pointerEvents="none">
                                                <circle
                                                    cx={x}
                                                    cy={yOut}
                                                    r={5}
                                                    fill="none"
                                                    stroke={deltaAnimationTone.color}
                                                    strokeWidth={1.5}
                                                    opacity={0.82}
                                                >
                                                    <animate attributeName="r" values="4;11;4" dur="1.45s" repeatCount="indefinite" />
                                                    <animate attributeName="opacity" values="0.82;0.16;0.82" dur="1.45s" repeatCount="indefinite" />
                                                </circle>
                                                <text
                                                    x={Math.min(x + 10, W - padR - 22)}
                                                    y={Math.max(padT + 12, yOut - 9)}
                                                    fill={deltaAnimationTone.color}
                                                    fontSize="10"
                                                    fontWeight={800}
                                                    fontFamily="monospace"
                                                >
                                                    {pressureChanged ? deltaTone.arrow : flowDeltaTone.arrow}
                                                </text>
                                            </g>
                                        )}

                                        {showDeltaBadge && deltaBadgeText && (
                                            <g pointerEvents="none">
                                                <rect
                                                    x={deltaBadgeX}
                                                    y={deltaBadgeY}
                                                    width={deltaBadgeWidth}
                                                    height={16}
                                                    rx={5}
                                                    fill="rgba(2,6,23,0.86)"
                                                    stroke={deltaAnimationTone.border}
                                                    strokeWidth={1}
                                                />
                                                <text
                                                    x={deltaBadgeX + deltaBadgeWidth / 2}
                                                    y={deltaBadgeY + 11.5}
                                                    textAnchor="middle"
                                                    fill={deltaAnimationTone.color}
                                                    fontSize="9"
                                                    fontWeight={800}
                                                    fontFamily="monospace"
                                                >
                                                    {deltaAnimationTone.arrow} {deltaBadgeText}
                                                </text>
                                            </g>
                                        )}

                                        {isHovered && (
                                            <>
                                                {hasJump && (
                                                    <line x1={x} y1={yIn} x2={x} y2={yOut} stroke="#ffffff" strokeWidth={2} opacity={0.9} />
                                                )}
                                                <circle cx={x} cy={yIn} r={4.5} fill="#f59e0b" stroke="#fde68a" strokeWidth={1.5} />
                                                <circle cx={x} cy={yOut} r={4.5} fill={accentColor} stroke="#ffffff" strokeWidth={1.5} />
                                            </>
                                        )}

                                        {showLabel && (
                                            <text
                                                x={x}
                                                y={padT + chartH + 14}
                                                textAnchor="end"
                                                fill={isHovered ? '#e2e8f0' : '#4b5563'}
                                                fontSize={isHovered ? '10' : '8'}
                                                fontWeight={isHovered ? 600 : 400}
                                                transform={`rotate(-50, ${x}, ${padT + chartH + 14})`}
                                            >
                                                {s.name.replace(/压气站|分输压气站|分输站|清管站|分输联络站|分输清管站|末站/g, '')}
                                            </text>
                                        )}

                                        {isHovered && (
                                            <g>
                                                <rect
                                                    x={Math.min(x - 84, W - padR - 168)}
                                                    y={Math.max(padT, Math.min(yIn, yOut) - 68)}
                                                    width={168}
                                                    height={pressureDelta != null ? 102 : 76}
                                                    rx={6}
                                                    fill="rgba(15,23,42,0.95)"
                                                    stroke={hexToRgba(accentColor, 0.35)}
                                                    strokeWidth={1}
                                                />
                                                <text x={Math.min(x, W - padR - 84)} y={Math.max(padT + 14, Math.min(yIn, yOut) - 50)} textAnchor="middle" fill="#e2e8f0" fontSize="11" fontWeight={600}>
                                                    {s.name}
                                                </text>
                                                <text x={Math.min(x, W - padR - 84)} y={Math.max(padT + 28, Math.min(yIn, yOut) - 36)} textAnchor="middle" fill="#94a3b8" fontSize="9">
                                                    里程 {s.mileage.toFixed(1)} km
                                                </text>
                                                <text x={Math.min(x - 42, W - padR - 126)} y={Math.max(padT + 44, Math.min(yIn, yOut) - 20)} textAnchor="middle" fill="#f59e0b" fontSize="10" fontFamily="monospace">
                                                    进 {s.inP.toFixed(3)}
                                                </text>
                                                <text x={Math.min(x + 42, W - padR - 42)} y={Math.max(padT + 44, Math.min(yIn, yOut) - 20)} textAnchor="middle" fill={accentColor} fontSize="10" fontFamily="monospace">
                                                    出 {s.outP.toFixed(3)}
                                                </text>
                                                {pressureDelta != null && (
                                                    <>
                                                        <text x={Math.min(x, W - padR - 84)} y={Math.max(padT + 58, Math.min(yIn, yOut) - 6)} textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">
                                                            仿真前 {baselineOut?.toFixed(3)} → 后 {s.outP.toFixed(3)}
                                                        </text>
                                                        <text x={Math.min(x, W - padR - 84)} y={Math.max(padT + 72, Math.min(yIn, yOut) + 8)} textAnchor="middle" fill={deltaTone.color} fontSize="10" fontWeight={700} fontFamily="monospace">
                                                            ΔP {formatSignedDelta(pressureDelta, 3, ' MPa')}（{deltaTone.label}）
                                                        </text>
                                                    </>
                                                )}
                                                {typeof s.flowRate === 'number' && Number.isFinite(s.flowRate) && (
                                                    <text x={Math.min(x, W - padR - 84)} y={Math.max(padT + (pressureDelta != null ? 88 : 60), Math.min(yIn, yOut) + (pressureDelta != null ? 24 : -4))} textAnchor="middle" fill={flowColor} fontSize="10" fontFamily="monospace">
                                                        Q {s.flowRate.toFixed(0)}{flowDelta != null ? ` (${formatSignedDelta(flowDelta, 0)})` : ''} 万方/天
                                                    </text>
                                                )}
                                            </g>
                                        )}
                                    </g>
                                )
                            })}
                        </g>

                        <line x1={padL} y1={padT + chartH} x2={padL + chartW} y2={padT + chartH} stroke="rgba(100,116,139,0.2)" strokeWidth={1} />
                        {mileageTicks.map((tick) => {
                            const x = xScale(tick)
                            return (
                                <g key={`${config.pipelineId}-tick-${tick}`}>
                                    <line x1={x} y1={padT + chartH} x2={x} y2={padT + chartH + 4} stroke="rgba(100,116,139,0.35)" strokeWidth={1} />
                                    <text x={x} y={padT + chartH + 18} textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="monospace">
                                        {tick.toFixed(0)}
                                    </text>
                                </g>
                            )
                        })}
                        <text x={padL + chartW} y={padT + chartH + 32} textAnchor="end" fill="#475569" fontSize="10">
                            里程 / km
                        </text>
                        {hasFlowData && (
                            <text x={padL + chartW + 42} y={padT + 10} textAnchor="middle" fill={hexToRgba(flowColor, 0.78)} fontSize="10" transform={`rotate(90, ${padL + chartW + 42}, ${padT + 10})`}>
                                流量 万方/天
                            </text>
                        )}
                    </svg>
                </div>
            )}
            {!standalone && resizeMode === 'width' && (
                <div
                    className="absolute right-0 top-0 h-full w-3 cursor-ew-resize bg-white/[0.02] hover:bg-cyan-400/10"
                    onMouseDown={onResizeMouseDown}
                    title="拖动调整压力图宽度"
                />
            )}
            {!standalone && resizeMode === 'both' && (
                <div
                    className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize rounded-tl-md border-l border-t border-white/10 bg-white/[0.06] hover:bg-cyan-400/20"
                    onMouseDown={onResizeMouseDown}
                    title="拖动扩大或缩小压力图"
                >
                    <span className="material-symbols-outlined absolute -right-0.5 -bottom-0.5 text-[16px] text-slate-400">open_in_full</span>
                </div>
            )}
        </div>
    )
}
