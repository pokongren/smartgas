import React, { useMemo, useState, useCallback, lazy, Suspense, useEffect } from 'react'
import MapView from '@/components/map-view/MapView'
import {
    buildInitialLayerVisibility,
    buildPipelineDataFromPackages,
    getPipelineLayerId,
    loadAllPipelines,
    PipelinePackage,
    PipelineLayer
} from '@/data/pipelines'
import type { PipelineData, PipelineLine, PipelineNode } from '@/types'
import ScadaHistoryChart from '@/components/scada/ScadaHistoryChartCompat'
import StationHistoryPanel from '@/components/scada/StationHistoryPanel'
import {
    CRED_SCADA_DATA,
    EXTRA_SCADA_PANELS,
    PT_SCADA_DATA,
    REAL_SCADA_DATA,
    SCADA_DATA_MAP,
    WE1_FULL_STATIONS,
    WE1_WEST_SCADA_DATA,
    WE2_SCADA_DATA,
} from '@/views/global-pipeline/scadaConfig'
import { EmptyScadaState, ScadaFloatingPanel } from '@/views/global-pipeline/ScadaFloatingPanel'
import type { ScadaRecord } from '@/views/global-pipeline/scadaConfig'
import { useNavigate } from 'react-router-dom'
import { setAssistantRuntimeContext } from '@/components/ai-assistant/runtimeAssistantContext'

import { getNodeMarkerMap } from '@/utils/mapRenderer'
import { useNewWindow, usePopoutSync } from '@/hooks/useNewWindow'
import { getNodeRawType } from '@/utils/pipelineDomain'
import { getJunctionKind } from '@/utils/pipelineDomain'

const noop = () => {}

type TrendChartStation = {
    name: string
    inP: number
    outP: number
    type: string
    mileage: number
}

type TrendChartConfig = {
    pipelineId: string
    title: string
    color: string
    stations: TrendChartStation[]
    mileageMode: 'estimated' | 'sequence'
}

type DirectoryLayoutState = {
    position?: { x: number; y: number }
    size?: { width: number; height: number }
    orderIds?: string[]
    visibleLayers?: Record<string, boolean>
    expandedGroups?: Record<string, boolean>
    scadaPanels?: {
        we1?: boolean
        we1West?: boolean
        we2?: boolean
        cred?: boolean
        pt?: boolean
        extra?: Record<string, boolean>
    }
    activeTrendPipelineId?: string | null
    activePressureOverlayIds?: Record<string, boolean>
    trendWidth?: number
}

const DIRECTORY_LAYOUT_STORAGE_KEY = 'smartgas.globalPipeline.directoryLayout.v1'

function readDirectoryLayoutState(): DirectoryLayoutState {
    if (typeof window === 'undefined') return {}

    try {
        const raw = window.localStorage.getItem(DIRECTORY_LAYOUT_STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw) as DirectoryLayoutState
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
        console.warn('[GlobalPipelineView] 读取管线目录布局失败:', error)
        return {}
    }
}

function clampNumber(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
}

function normalizeStationMatchKey(name: string): string {
    return name
        .replace(/[（(][^()（）]*[)）]/g, '')
        .replace(/\s+/g, '')
        .replace(/分输压气站|分输联络站|分输清管站|压气站|分输站|清管站|末站/g, '')
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

function buildGraphDistanceIndex(layer: PipelineLayer | undefined) {
    const exactNameToNodeId = new Map<string, string>()
    const normalizedNameToNodeId = new Map<string, string>()
    const adjacency = new Map<string, Array<{ to: string; lengthKm: number }>>()

    if (!layer) {
        return { exactNameToNodeId, normalizedNameToNodeId, adjacency }
    }

    layer.nodes.forEach((node) => {
        exactNameToNodeId.set(node.name, node.id)

        const normalizedKey = normalizeStationMatchKey(node.name)
        if (normalizedKey && !normalizedNameToNodeId.has(normalizedKey)) {
            normalizedNameToNodeId.set(normalizedKey, node.id)
        }
    })

    layer.lines.forEach((line) => {
        const startId = String(line.startNodeId)
        const endId = String(line.endNodeId)
        const lengthKm = typeof line.length === 'number' && Number.isFinite(line.length) && line.length > 0
            ? line.length / 1000
            : 0

        if (!adjacency.has(startId)) adjacency.set(startId, [])
        if (!adjacency.has(endId)) adjacency.set(endId, [])

        adjacency.get(startId)?.push({ to: endId, lengthKm })
        adjacency.get(endId)?.push({ to: startId, lengthKm })
    })

    return { exactNameToNodeId, normalizedNameToNodeId, adjacency }
}

function resolveNodeIdByStationName(
    stationName: string,
    exactNameToNodeId: Map<string, string>,
    normalizedNameToNodeId: Map<string, string>,
): string | undefined {
    const exactMatch = exactNameToNodeId.get(stationName)
    if (exactMatch) return exactMatch

    return normalizedNameToNodeId.get(normalizeStationMatchKey(stationName))
}

function findShortestDistanceKm(
    adjacency: Map<string, Array<{ to: string; lengthKm: number }>>,
    startId: string,
    endId: string,
): number | null {
    if (startId === endId) return 0
    if (!adjacency.has(startId) || !adjacency.has(endId)) return null

    const distances = new Map<string, number>([[startId, 0]])
    const visited = new Set<string>()
    const queue: Array<{ id: string; distance: number }> = [{ id: startId, distance: 0 }]

    while (queue.length > 0) {
        queue.sort((a, b) => a.distance - b.distance)
        const current = queue.shift()
        if (!current) break
        if (visited.has(current.id)) continue
        visited.add(current.id)

        if (current.id === endId) {
            return current.distance
        }

        const neighbors = adjacency.get(current.id) || []
        neighbors.forEach((neighbor) => {
            if (visited.has(neighbor.to)) return

            const nextDistance = current.distance + Math.max(neighbor.lengthKm, 0.1)
            const knownDistance = distances.get(neighbor.to)
            if (knownDistance == null || nextDistance < knownDistance) {
                distances.set(neighbor.to, nextDistance)
                queue.push({ id: neighbor.to, distance: nextDistance })
            }
        })
    }

    return null
}

function getTrendSource(pipelineId: string): { title: string; color: string; entries: Array<[string, ScadaRecord]> } | null {
    if (pipelineId === 'we1') {
        return {
            title: '西气东输一线',
            color: '#10b981',
            entries: WE1_FULL_STATIONS.map((station) => [
                station.name,
                {
                    inP: station.inP,
                    outP: station.outP,
                    type: station.type as ScadaRecord['type'],
                },
            ]),
        }
    }

    const scadaEntry = SCADA_DATA_MAP[pipelineId]
    if (!scadaEntry) return null

    return {
        title: scadaEntry.label,
        color: scadaEntry.color,
        entries: Object.entries(scadaEntry.data),
    }
}

function buildTrendChartConfig(pkg: PipelinePackage | undefined, pipelineId: string): TrendChartConfig | null {
    const source = getTrendSource(pipelineId)
    if (!source) return null

    const trunkLayer = pkg?.layers.find((layer) => layer.type === 'trunk') ?? pkg?.layers[0]
    const { exactNameToNodeId, normalizedNameToNodeId, adjacency } = buildGraphDistanceIndex(trunkLayer)

    let cumulativeMileage = 0
    let previousNodeId: string | undefined
    let usedEstimatedMileage = false

    const stations = source.entries
        .filter(([, record]) => Number.isFinite(record.inP) && Number.isFinite(record.outP))
        .map(([name, record], index) => {
            const currentNodeId = resolveNodeIdByStationName(name, exactNameToNodeId, normalizedNameToNodeId)
            if (index > 0) {
                const distanceKm = previousNodeId && currentNodeId
                    ? findShortestDistanceKm(adjacency, previousNodeId, currentNodeId)
                    : null

                if (distanceKm != null) {
                    cumulativeMileage += distanceKm
                    usedEstimatedMileage = true
                } else {
                    cumulativeMileage += 1
                }
            }

            previousNodeId = currentNodeId

            return {
                name,
                inP: record.inP,
                outP: record.outP,
                type: record.type || 'distribution',
                mileage: Number(cumulativeMileage.toFixed(1)),
            }
        })
        .filter((station) => station.inP > 0.1 || station.outP > 0.1)

    return {
        pipelineId,
        title: source.title,
        color: source.color,
        stations,
        mileageMode: usedEstimatedMileage ? 'estimated' : 'sequence',
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
const LegacyPressureTrendChart: React.FC<{
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

const PressureTrendChart: React.FC<{
    config: TrendChartConfig
    onClose: () => void
    onMouseDown?: (e: React.MouseEvent) => void
    isDragging?: boolean
    standalone?: boolean
    width?: number
    onResizeMouseDown?: (e: React.MouseEvent) => void
}> = ({ config, onClose, onMouseDown, isDragging, standalone = false, width = 920, onResizeMouseDown }) => {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

    const stations = config.stations
    const accentColor = config.color
    const hasData = stations.length > 0
    const jumpThreshold = 0.001

    const W = 860
    const H = 320
    const padL = 50
    const padR = 25
    const padT = 25
    const padB = 70
    const chartW = W - padL - padR
    const chartH = H - padT - padB

    const allP = hasData
        ? stations.flatMap((s) => [s.inP, s.outP])
        : [0, 1]
    const minP = Math.floor(Math.min(...allP) * 2) / 2
    const maxP = Math.ceil(Math.max(...allP) * 2) / 2 + 0.5
    const rangeP = Math.max(maxP - minP, 1)
    const maxMileage = hasData ? Math.max(stations[stations.length - 1]?.mileage ?? 0, 1) : 1

    const xScale = (mileage: number) => padL + (mileage / maxMileage) * chartW
    const yScale = (p: number) => padT + chartH - ((p - minP) / rangeP) * chartH

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
    const areaPath = hasData
        ? `${hydraulicPath} L ${xScale(maxMileage)} ${padT + chartH} L ${padL} ${padT + chartH} Z`
        : ''

    const gridLines: number[] = []
    for (let p = Math.ceil(minP); p <= Math.floor(maxP); p++) {
        gridLines.push(p)
    }

    const mileageTicks = Array.from({ length: 6 }, (_, idx) => Number(((maxMileage / 5) * idx).toFixed(1)))

    return (
        <div
            className={`${standalone ? 'h-full w-full' : `absolute z-20 ${isDragging ? 'cursor-grabbing' : ''}`} flex flex-col select-none overflow-hidden`}
            style={{
                width: standalone ? '100%' : `${width}px`,
                height: standalone ? '100%' : '420px',
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
                    <span>{config.title} · 里程进出站压力图</span>
                    <span style={{ color: '#64748b', fontSize: '10px', fontWeight: 'normal' }}>单位: MPa / km</span>
                    {config.mileageMode === 'estimated' && (
                        <span style={{ color: '#94a3b8', fontSize: '10px', fontWeight: 'normal' }}>主干线累计长度推算</span>
                    )}
                </h3>
                <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                    <span className="material-symbols-outlined text-sm">close</span>
                </button>
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
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
                        <defs>
                            <linearGradient id={`hydraulicGrad-${config.pipelineId}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={accentColor} stopOpacity="0.15" />
                                <stop offset="60%" stopColor={accentColor} stopOpacity="0.05" />
                                <stop offset="100%" stopColor={accentColor} stopOpacity="0.01" />
                            </linearGradient>
                        </defs>

                        {gridLines.map(p => (
                            <g key={`${config.pipelineId}-grid-${p}`}>
                                <line x1={padL} y1={yScale(p)} x2={padL + chartW} y2={yScale(p)} stroke="rgba(100,116,139,0.12)" strokeWidth={1} />
                                <text x={padL - 8} y={yScale(p) + 4} textAnchor="end" fill="#475569" fontSize="10" fontFamily="monospace">{p}</text>
                            </g>
                        ))}

                        <path d={areaPath} fill={`url(#hydraulicGrad-${config.pipelineId})`} />
                        <path d={hydraulicPath} fill="none" stroke={accentColor} strokeWidth={2} strokeLinejoin="round" />

                        {stations.map((s, i) => {
                            const x = xScale(s.mileage)
                            const yIn = yScale(s.inP)
                            const yOut = yScale(s.outP)
                            const hasJump = Math.abs(s.outP - s.inP) > jumpThreshold
                            const isHovered = hoveredIdx === i
                            const showLabel = isHovered || i === 0 || i === stations.length - 1

                            return (
                                <g
                                    key={`${config.pipelineId}-${s.name}-${s.mileage}`}
                                    onMouseEnter={() => setHoveredIdx(i)}
                                    onMouseLeave={() => setHoveredIdx(null)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <rect x={x - 10} y={padT} width={20} height={chartH} fill="transparent" />
                                    {isHovered && <line x1={x} y1={padT} x2={x} y2={padT + chartH} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />}

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
                                                height={60}
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
                                        </g>
                                    )}
                                </g>
                            )
                        })}

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
                    </svg>
                </div>
            )}
            {!standalone && (
                <div
                    className="absolute right-0 top-0 h-full w-3 cursor-ew-resize bg-white/[0.02] hover:bg-cyan-400/10"
                    onMouseDown={onResizeMouseDown}
                    title="拖动调整压力图宽度"
                />
            )}
        </div>
    )
}

function hasValidPressureData(pipelineId: string): boolean {
    const source = getTrendSource(pipelineId)
    if (!source) return false

    return source.entries.some(([, record]) => (
        Number.isFinite(record.inP)
        && Number.isFinite(record.outP)
        && (record.inP > 0.1 || record.outP > 0.1)
    ))
}

/**
 * 全管线统一视图 (性能优化版)
 * 使用标准化的 PipelinePackage 数据源
 * 
 * 优化点：
 * 1. 使用 for 循环替代 forEach + 展开运算符，减少内存分配
 * 2. useMemo 缓存计算结果
 * 3. 减少不必要的重新渲染
 */
const GlobalPipelineView: React.FC = () => {
    const navigate = useNavigate()
    // 管线数据异步加载
    const [pipelines, setPipelines] = useState<PipelinePackage[]>([])
    const [pipelinesLoaded, setPipelinesLoaded] = useState(false)
    useEffect(() => {
        loadAllPipelines()
            .then(data => { setPipelines(data); setPipelinesLoaded(true) })
            .catch(err => { console.error('[GlobalPipelineView] 加载管线数据失败:', err); setPipelinesLoaded(true) })
    }, [])

    const [mapInstance, setMapInstance] = useState<any>(null)
    const [selectedMapNode, setSelectedMapNode] = useState<PipelineNode | null>(null)

    const [showScada, setShowScada] = useState(false)
    const [showWe2Scada, setShowWe2Scada] = useState(false)
    // 三条新管线 SCADA 面板显示状态
    const [showWe1WestScada, setShowWe1WestScada] = useState(false)
    const [showCredScada, setShowCredScada] = useState(false)
    const [showPtScada, setShowPtScada] = useState(false)
    // 新增 7 条管线的 SCADA 面板显示状态（默认隐藏）
    const [extraScadaVisible, setExtraScadaVisible] = useState<Record<string, boolean>>({})
    const toggleExtraScada = (id: string) => setExtraScadaVisible(prev => ({ ...prev, [id]: !prev[id] }))
    // 通用压力趋势图面板
    const [activeTrendPipelineId, setActiveTrendPipelineId] = useState<string | null>(null)
    const [activePressureOverlayIds, setActivePressureOverlayIds] = useState<Record<string, boolean>>({})
    // SCADA 历史曲线面板状态，支持指定指标类型和基准值
    const [historyTarget, setHistoryTarget] = useState<{
        stationName: string
        metricType: 'pressure' | 'temperature' | 'dewpoint'
        baseValue?: number
        hours?: number
    } | null>(null)
    const [stationHistoryTarget, setStationHistoryTarget] = useState<{
        stationName: string
        displayName?: string
        initialViewMode?: 'pressure' | 'temperature' | 'dewpoint' | 'overview'
        initialHours?: 0 | 6 | 12
        focusHint?: string
    } | null>(null)
    const [historyChartPos, setHistoryChartPos] = useState({ x: Math.round((typeof window !== 'undefined' ? window.innerWidth : 1280) / 2) - 300, y: 120 })
    const [isDraggingHistory, setIsDraggingHistory] = useState(false)
    const historyOffsetRef = React.useRef({ x: 0, y: 0 })
    const handleHistoryMouseDown = (e: React.MouseEvent) => {
        setIsDraggingHistory(true)
        historyOffsetRef.current = { x: e.clientX - historyChartPos.x, y: e.clientY - historyChartPos.y }
    }
    // 统一的指标点击处理函数
    const handleMetricClick = useCallback((stationName: string, metricType: 'pressure' | 'temperature' | 'dewpoint', baseValue: number) => {
        setHistoryTarget({ stationName, metricType, baseValue })
    }, [])

    const openStationHistoryPanel = useCallback((
        stationName: string,
        options?: {
            displayName?: string
            initialViewMode?: 'pressure' | 'temperature' | 'dewpoint' | 'overview'
            initialHours?: 0 | 6 | 12
            focusHint?: string
        },
    ) => {
        setStationHistoryTarget({
            stationName,
            displayName: options?.displayName || stationName,
            initialViewMode: options?.initialViewMode || 'pressure',
            initialHours: options?.initialHours ?? 0,
            focusHint: options?.focusHint,
        })
    }, [])

    useEffect(() => {
        const handleAssistantHistoryOpen = (event: Event) => {
            const detail = (event as CustomEvent).detail as {
                station?: string
                view?: string
                hours?: number
                metric?: string
            } | undefined
            const stationName = detail?.station?.trim()
            if (!stationName) return
            const view = String(detail?.view || '').toLowerCase()
            const hoursRaw = Number(detail?.hours)
            const initialHours = hoursRaw === 6 || hoursRaw === 12 ? hoursRaw : 0
            openStationHistoryPanel(stationName, {
                initialViewMode: view === 'temperature'
                    ? 'temperature'
                    : view === 'dewpoint'
                        ? 'dewpoint'
                        : view === 'overview'
                            ? 'overview'
                            : 'pressure',
                initialHours,
                focusHint: detail?.metric?.trim() || undefined,
            })
            setHistoryTarget(null)
        }
        const handleAssistantHistoryMessage = (event: MessageEvent) => {
            const payload = event.data as {
                type?: string
                detail?: {
                    station?: string
                    view?: string
                    hours?: number
                    metric?: string
                }
            } | undefined
            if (!payload) return
            if (payload.type !== 'assistant-open-history' && payload.type !== 'assistant-open-luzhi-history') {
                return
            }
            handleAssistantHistoryOpen({ detail: payload.detail } as CustomEvent)
        }

        window.addEventListener('assistant-open-history', handleAssistantHistoryOpen as EventListener)
        window.addEventListener('assistant-open-luzhi-history', handleAssistantHistoryOpen as EventListener)
        window.addEventListener('message', handleAssistantHistoryMessage)
        return () => {
            window.removeEventListener('assistant-open-history', handleAssistantHistoryOpen as EventListener)
            window.removeEventListener('assistant-open-luzhi-history', handleAssistantHistoryOpen as EventListener)
            window.removeEventListener('message', handleAssistantHistoryMessage)
        }
    }, [openStationHistoryPanel])

    // 西二线 SCADA 面板拖拽状态
    useEffect(() => {
        setAssistantRuntimeContext({
            selection: {
                history_target_station: stationHistoryTarget?.stationName || historyTarget?.stationName || '',
            },
        })
    }, [historyTarget?.stationName, stationHistoryTarget?.stationName])

    const [we2ScadaPos, setWe2ScadaPos] = useState({
        x: typeof window !== 'undefined' ? Math.max(10, window.innerWidth - 450) : 800,
        y: typeof window !== 'undefined' ? window.innerHeight - 340 : 500
    })
    const [isDraggingWe2Scada, setIsDraggingWe2Scada] = useState(false)
    const we2DragOffsetRef = React.useRef({ x: 0, y: 0 })

    const handleWe2ScadaMouseDown = (e: React.MouseEvent) => {
        setIsDraggingWe2Scada(true)
        we2DragOffsetRef.current = {
            x: e.clientX - we2ScadaPos.x,
            y: e.clientY - we2ScadaPos.y
        }
    }

    // 通用拖拽面板处理
    // 将每个新面板的拖拽状态打包起来
    // 获取屏幕尺寸计算安全位置
    const W = typeof window !== 'undefined' ? window.innerWidth : 1280
    const H = typeof window !== 'undefined' ? window.innerHeight : 800
    const initialDirectoryLayoutRef = React.useRef<DirectoryLayoutState>(readDirectoryLayoutState())
    const [directoryPos, setDirectoryPos] = useState(() => {
        const saved = initialDirectoryLayoutRef.current.position
        return saved
            ? { x: clampNumber(saved.x, 0, Math.max(0, W - 260)), y: clampNumber(saved.y, 60, Math.max(60, H - 180)) }
            : { x: 24, y: 96 }
    })
    const [directorySize, setDirectorySize] = useState(() => {
        const saved = initialDirectoryLayoutRef.current.size
        return saved
            ? { width: clampNumber(saved.width, 260, Math.min(560, W - 20)), height: clampNumber(saved.height, 320, Math.max(320, H - 110)) }
            : { width: 288, height: Math.min(620, Math.max(420, H - 140)) }
    })
    const [isDraggingDirectory, setIsDraggingDirectory] = useState(false)
    const [isResizingDirectory, setIsResizingDirectory] = useState(false)
    const directoryDragOffsetRef = React.useRef({ x: 0, y: 0 })
    const directoryResizeStartRef = React.useRef({ x: 0, y: 0, width: 288, height: 520 })
    const [pipelineOrderIds, setPipelineOrderIds] = useState<string[]>(() => initialDirectoryLayoutRef.current.orderIds || [])
    const [pipelineDragId, setPipelineDragId] = useState<string | null>(null)
    const [pipelineDropIndex, setPipelineDropIndex] = useState<number | null>(null)
    const [trendWidth, setTrendWidth] = useState(() => clampNumber(initialDirectoryLayoutRef.current.trendWidth || 920, 720, 1280))
    const [isResizingTrend, setIsResizingTrend] = useState(false)
    const trendResizeStartRef = React.useRef({ x: 0, width: 920 })

    // 西一线西段 SCADA 面板（放在西一线东段面板右侧）
    const [we1WestPos, setWe1WestPos] = useState({ x: 330, y: H - 340 })
    const [isDraggingWe1West, setIsDraggingWe1West] = useState(false)
    const we1WestOffsetRef = React.useRef({ x: 0, y: 0 })
    const handleWe1WestMouseDown = (e: React.MouseEvent) => {
        setIsDraggingWe1West(true)
        we1WestOffsetRef.current = { x: e.clientX - we1WestPos.x, y: e.clientY - we1WestPos.y }
    }

    // 中俄东线 SCADA 面板（居中偏下）
    const [credPos, setCredPos] = useState({ x: Math.round(W / 2) - 240, y: H - 340 })
    const [isDraggingCred, setIsDraggingCred] = useState(false)
    const credOffsetRef = React.useRef({ x: 0, y: 0 })
    const handleCredMouseDown = (e: React.MouseEvent) => {
        setIsDraggingCred(true)
        credOffsetRef.current = { x: e.clientX - credPos.x, y: e.clientY - credPos.y }
    }

    // 平泰支干线 SCADA 面板（右下）
    const [ptPos, setPtPos] = useState({ x: Math.max(10, W - 510), y: H - 340 })
    const [isDraggingPt, setIsDraggingPt] = useState(false)
    const ptOffsetRef = React.useRef({ x: 0, y: 0 })
    const handlePtMouseDown = (e: React.MouseEvent) => {
        setIsDraggingPt(true)
        ptOffsetRef.current = { x: e.clientX - ptPos.x, y: e.clientY - ptPos.y }
    }

    // 压力趋势图面板（默认屏幕居中上部）
    const [trendPos, setTrendPos] = useState({ x: Math.round(W / 2) - 440, y: 100 })
    const [isDraggingTrend, setIsDraggingTrend] = useState(false)
    const trendOffsetRef = React.useRef({ x: 0, y: 0 })
    const handleTrendMouseDown = (e: React.MouseEvent) => {
        setIsDraggingTrend(true)
        trendOffsetRef.current = { x: e.clientX - trendPos.x, y: e.clientY - trendPos.y }
    }
    const handleTrendResizeMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation()
        setIsResizingTrend(true)
        trendResizeStartRef.current = { x: e.clientX, width: trendWidth }
    }

    // 使用 useCallback 稳定回调引用，避免触发 MapView 无限循环
    const handleMapLoad = useCallback((map: any) => {
        setMapInstance(map)
    }, [])

    const activeTrendChart = useMemo(() => {
        if (!activeTrendPipelineId) return null
        const targetPackage = pipelines.find((pkg) => pkg.id === activeTrendPipelineId)
        return buildTrendChartConfig(targetPackage, activeTrendPipelineId)
    }, [activeTrendPipelineId, pipelines])

    // SCADA 面板拖拽状态
    const { isPoppedOut: isScadaPoppedOut, popOut: popOutScada, closePopOut: closeScadaPopOut } = useNewWindow('scada-sync', '/popout/scada');
    const [scadaPos, setScadaPos] = useState({
        x: 330,
        y: typeof window !== 'undefined' ? window.innerHeight - 340 : 500
    })
    const [isDraggingScada, setIsDraggingScada] = useState(false)
    const dragOffsetRef = React.useRef({ x: 0, y: 0 })

    const handleScadaMouseDown = (e: React.MouseEvent) => {
        setIsDraggingScada(true)
        dragOffsetRef.current = {
            x: e.clientX - scadaPos.x,
            y: e.clientY - scadaPos.y
        }
    }

    const handleGlobalMouseMove = (e: React.MouseEvent) => {
        if (isDraggingScada) {
            setScadaPos({
                x: e.clientX - dragOffsetRef.current.x,
                y: e.clientY - dragOffsetRef.current.y
            })
        }
        if (isDraggingWe2Scada) {
            setWe2ScadaPos({
                x: e.clientX - we2DragOffsetRef.current.x,
                y: e.clientY - we2DragOffsetRef.current.y
            })
        }
        // 其余三个面板拖拽处理
        if (isDraggingWe1West) setWe1WestPos({ x: e.clientX - we1WestOffsetRef.current.x, y: e.clientY - we1WestOffsetRef.current.y })
        if (isDraggingCred)    setCredPos({    x: e.clientX - credOffsetRef.current.x,    y: e.clientY - credOffsetRef.current.y    })
        if (isDraggingPt)      setPtPos({      x: e.clientX - ptOffsetRef.current.x,      y: e.clientY - ptOffsetRef.current.y      })
        if (isDraggingTrend)   setTrendPos({   x: e.clientX - trendOffsetRef.current.x,   y: e.clientY - trendOffsetRef.current.y   })
        if (isDraggingHistory) setHistoryChartPos({ x: e.clientX - historyOffsetRef.current.x, y: e.clientY - historyOffsetRef.current.y })
        if (isDraggingStationHistory) setStationHistoryPos({ x: e.clientX - stationHistoryOffsetRef.current.x, y: e.clientY - stationHistoryOffsetRef.current.y })
        if (isDraggingDirectory) {
            setDirectoryPos({
                x: clampNumber(e.clientX - directoryDragOffsetRef.current.x, 0, Math.max(0, W - directorySize.width)),
                y: clampNumber(e.clientY - directoryDragOffsetRef.current.y, 60, Math.max(60, H - 120)),
            })
        }
        if (isResizingDirectory) {
            const nextWidth = directoryResizeStartRef.current.width + e.clientX - directoryResizeStartRef.current.x
            const nextHeight = directoryResizeStartRef.current.height + e.clientY - directoryResizeStartRef.current.y
            setDirectorySize({
                width: clampNumber(nextWidth, 260, Math.min(560, W - directoryPos.x - 10)),
                height: clampNumber(nextHeight, 320, Math.max(320, H - directoryPos.y - 10)),
            })
        }
        if (isResizingTrend) {
            setTrendWidth(clampNumber(trendResizeStartRef.current.width + e.clientX - trendResizeStartRef.current.x, 720, 1280))
        }
    }

    const handleGlobalMouseUp = () => {
        if (isDraggingScada)    setIsDraggingScada(false)
        if (isDraggingWe2Scada) setIsDraggingWe2Scada(false)
        if (isDraggingWe1West)  setIsDraggingWe1West(false)
        if (isDraggingCred)     setIsDraggingCred(false)
        if (isDraggingPt)       setIsDraggingPt(false)
        if (isDraggingTrend)    setIsDraggingTrend(false)
        if (isDraggingHistory)  setIsDraggingHistory(false)
        if (isDraggingStationHistory) setIsDraggingStationHistory(false)
        if (isDraggingDirectory) setIsDraggingDirectory(false)
        if (isResizingDirectory) setIsResizingDirectory(false)
        if (isResizingTrend) setIsResizingTrend(false)
        if (pipelineDragId) {
            setPipelineDragId(null)
            setPipelineDropIndex(null)
        }
    }

    const hasScadaStandalone = useCallback((pipelineId: string) => {
        return Boolean(SCADA_DATA_MAP[pipelineId])
    }, [])

    const findExtraScadaPanel = useCallback((pkg: PipelinePackage) => {
        return EXTRA_SCADA_PANELS.find(p =>
            pkg.name.includes(p.label)
            || (p.id === 'zg' && pkg.name === '中贵线')
            || (p.id === 'zm' && pkg.name === '中缅线')
            || (p.id === 'gn' && pkg.name === '广南支干线')
            || (p.id === 'gs' && pkg.name === '广深支干线')
            || (p.id === 'sj4' && pkg.name === '陕京四线')
            || (p.id === 'sj3' && pkg.name === '陕京三线')
            || (p.id === 'ncsh' && pkg.name.includes('南昌'))
            || (p.id === 'jxlz' && pkg.name.includes('嘉兴'))
            || (p.id === 'sj2' && pkg.name === '陕京二线')
            || (p.id === 'we3' && pkg.name.includes('三线'))
        )
    }, [])

    const openScadaStandalone = useCallback((pipelineId: string) => {
        if (!hasScadaStandalone(pipelineId)) return

        if (pipelineId === 'we1') {
            popOutScada(400, 500)
            setShowScada(false)
            return
        }

        const w = 520
        const h = 500
        const left = window.screenX + (window.outerWidth - w) / 2
        const top = window.screenY + (window.outerHeight - h) / 2
        window.open(
            `/#/popout/scada?id=${pipelineId}`,
            `scada-${pipelineId}`,
            `width=${w},height=${h},left=${left},top=${top}`
        )
    }, [hasScadaStandalone, popOutScada])

    const toggleTrendChart = useCallback((pipelineId: string) => {
        setActiveTrendPipelineId((prev) => prev === pipelineId ? null : pipelineId)
    }, [])

    const directoryActionButtonClass = 'transition-all duration-150 flex items-center justify-center size-7 rounded-md border border-transparent bg-white/[0.03] hover:bg-white/10 hover:border-white/10'
    const directoryActionPlaceholderClass = 'size-7 rounded-md opacity-0 pointer-events-none'

    const renderPipelineActions = (pkg: PipelinePackage) => {
        const extraPanel = findExtraScadaPanel(pkg)
        let visibilityButton: React.ReactNode = <span className={directoryActionPlaceholderClass} aria-hidden="true" />
        let popoutButton: React.ReactNode = <span className={directoryActionPlaceholderClass} aria-hidden="true" />
        let trendButton: React.ReactNode = <span className={directoryActionPlaceholderClass} aria-hidden="true" />
        let pressureButton: React.ReactNode = <span className={directoryActionPlaceholderClass} aria-hidden="true" />
        const trendSource = getTrendSource(pkg.id)
        const hasPressureData = hasValidPressureData(pkg.id)
        const isTrendActive = activeTrendPipelineId === pkg.id
        const isPressureActive = Boolean(activePressureOverlayIds[pkg.id])

        if (pkg.name === '西气东输一线' && !isScadaPoppedOut) {
            visibilityButton = (
                <button
                    onClick={(e) => { e.stopPropagation(); setShowScada(!showScada); setShowWe1WestScada(!showWe1WestScada); }}
                    className={`${directoryActionButtonClass} ${showScada ? 'text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border-emerald-400/20' : 'text-gray-500 hover:text-gray-300'}`}
                    title={showScada ? '隐藏西一线面板' : '显示西一线面板'}
                >
                    <span className="material-symbols-outlined text-sm">{showScada ? 'visibility' : 'visibility_off'}</span>
                </button>
            )
            popoutButton = (
                <button
                    onClick={(e) => { e.stopPropagation(); popOutScada(400, 500); setShowScada(false); }}
                    className={`${directoryActionButtonClass} text-gray-400 hover:text-white`}
                    title="弹出独立窗口"
                >
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                </button>
            )
        } else {
            if (pkg.name === '西气东输二线') {
                visibilityButton = (
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowWe2Scada(!showWe2Scada); }}
                        className={`${directoryActionButtonClass} ${showWe2Scada ? 'text-blue-400 hover:text-blue-300 bg-blue-500/10 border-blue-400/20' : 'text-gray-500 hover:text-gray-300'}`}
                        title={showWe2Scada ? '隐藏西二线参数表' : '显示西二线参数表'}
                    >
                        <span className="material-symbols-outlined text-sm">{showWe2Scada ? 'visibility' : 'visibility_off'}</span>
                    </button>
                )
            } else if (pkg.name === '中俄东线') {
                visibilityButton = (
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowCredScada(!showCredScada); }}
                        className={`${directoryActionButtonClass} ${showCredScada ? 'text-pink-400 hover:text-pink-300 bg-pink-500/10 border-pink-400/20' : 'text-gray-500 hover:text-gray-300'}`}
                        title={showCredScada ? '隐藏中俄东线参数表' : '显示中俄东线参数表'}
                    >
                        <span className="material-symbols-outlined text-sm">{showCredScada ? 'visibility' : 'visibility_off'}</span>
                    </button>
                )
            } else if (pkg.name === '平泰支干线') {
                visibilityButton = (
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowPtScada(!showPtScada); }}
                        className={`${directoryActionButtonClass} ${showPtScada ? 'text-purple-400 hover:text-purple-300 bg-purple-500/10 border-purple-400/20' : 'text-gray-500 hover:text-gray-300'}`}
                        title={showPtScada ? '隐藏平泰参数表' : '显示平泰参数表'}
                    >
                        <span className="material-symbols-outlined text-sm">{showPtScada ? 'visibility' : 'visibility_off'}</span>
                    </button>
                )
            } else if (extraPanel) {
                visibilityButton = (
                    <button
                        onClick={(e) => { e.stopPropagation(); toggleExtraScada(extraPanel.id); }}
                        className={`${directoryActionButtonClass} ${extraScadaVisible[extraPanel.id] ? 'bg-white/10 border-white/10 hover:opacity-80' : 'text-gray-500 hover:text-gray-300'}`}
                        style={extraScadaVisible[extraPanel.id] ? { color: extraPanel.color } : undefined}
                        title={`${extraScadaVisible[extraPanel.id] ? '隐藏' : '显示'}${extraPanel.label}参数表`}
                    >
                        <span className="material-symbols-outlined text-sm">{extraScadaVisible[extraPanel.id] ? 'visibility' : 'visibility_off'}</span>
                    </button>
                )
            }

            if (hasScadaStandalone(pkg.id)) {
                popoutButton = (
                    <button
                        onClick={(e) => { e.stopPropagation(); openScadaStandalone(pkg.id); }}
                        className={`${directoryActionButtonClass} text-gray-400 hover:text-white`}
                        title="弹出独立窗口"
                    >
                        <span className="material-symbols-outlined text-sm">open_in_new</span>
                    </button>
                )
            }
        }

        if (trendSource && hasPressureData) {
            trendButton = (
                <button
                    onClick={(e) => { e.stopPropagation(); toggleTrendChart(pkg.id) }}
                    className={`${directoryActionButtonClass} ${isTrendActive ? 'bg-white/10 border-white/10 hover:opacity-90' : 'text-gray-500 hover:text-gray-300'}`}
                    style={isTrendActive ? { color: trendSource.color } : undefined}
                    title={`弹出${trendSource.title}里程进出站压力图`}
                >
                    <span className="material-symbols-outlined text-sm">show_chart</span>
                </button>
            )
            pressureButton = (
                <button
                    onClick={(e) => { e.stopPropagation(); togglePressureOverlay(pkg.id) }}
                    className={`${directoryActionButtonClass} ${isPressureActive ? 'bg-white/10 border-white/10 hover:opacity-90' : 'text-gray-500 hover:text-gray-300'}`}
                    style={isPressureActive ? { color: trendSource.color } : undefined}
                    title={`${isPressureActive ? '隐藏' : '显示'}${trendSource.title}管道压力标签`}
                >
                    <span className="material-symbols-outlined text-sm">speed</span>
                </button>
            )
        }

        return (
            <div className="ml-3 shrink-0 grid w-[140px] grid-cols-4 justify-items-center gap-1 rounded-lg border border-white/5 bg-black/20 px-1.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                {visibilityButton}
                {popoutButton}
                {trendButton}
                {pressureButton}
            </div>
        )
    }

    // 甪直历史面板状态
    const [stationHistoryPos, setStationHistoryPos] = useState({ x: Math.round(W / 2) - 390, y: Math.round(H / 2) - 240 })
    const [isDraggingStationHistory, setIsDraggingStationHistory] = useState(false)
    const stationHistoryOffsetRef = React.useRef({ x: 0, y: 0 })
    const handleStationHistoryMouseDown = (e: React.MouseEvent) => {
        setIsDraggingStationHistory(true)
        stationHistoryOffsetRef.current = { x: e.clientX - stationHistoryPos.x, y: e.clientY - stationHistoryPos.y }
    }

    // 展开状态
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ 'we1': true })

    // 可见性状态 - 当管线数据加载完成后初始化
    const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>({})
    const hasHydratedDirectoryRef = React.useRef(false)
    useEffect(() => {
        if (!pipelinesLoaded || pipelines.length === 0) return
        const saved = initialDirectoryLayoutRef.current
        const defaults = buildInitialLayerVisibility(pipelines)
        setVisibleLayers({ ...defaults, ...(saved.visibleLayers || {}) })
        setExpandedGroups({ we1: true, ...(saved.expandedGroups || {}) })
        setPipelineOrderIds((saved.orderIds || []).filter(id => pipelines.some(pkg => pkg.id === id)))
        setShowScada(Boolean(saved.scadaPanels?.we1))
        setShowWe1WestScada(Boolean(saved.scadaPanels?.we1West))
        setShowWe2Scada(Boolean(saved.scadaPanels?.we2))
        setShowCredScada(Boolean(saved.scadaPanels?.cred))
        setShowPtScada(Boolean(saved.scadaPanels?.pt))
        setExtraScadaVisible(saved.scadaPanels?.extra || {})
        setActiveTrendPipelineId(saved.activeTrendPipelineId || null)
        setActivePressureOverlayIds(saved.activePressureOverlayIds || {})
        hasHydratedDirectoryRef.current = true
    }, [pipelinesLoaded, pipelines])

    const orderedPipelines = useMemo(() => {
        if (pipelineOrderIds.length === 0) return pipelines
        const packageMap = new Map(pipelines.map(pkg => [pkg.id, pkg]))
        const ordered = pipelineOrderIds
            .map(id => packageMap.get(id))
            .filter((pkg): pkg is PipelinePackage => Boolean(pkg))
        const missing = pipelines.filter(pkg => !pipelineOrderIds.includes(pkg.id))
        return [...ordered, ...missing]
    }, [pipelineOrderIds, pipelines])

    useEffect(() => {
        if (!pipelinesLoaded || !hasHydratedDirectoryRef.current) return

        const state: DirectoryLayoutState = {
            position: directoryPos,
            size: directorySize,
            orderIds: orderedPipelines.map(pkg => pkg.id),
            visibleLayers,
            expandedGroups,
            scadaPanels: {
                we1: showScada,
                we1West: showWe1WestScada,
                we2: showWe2Scada,
                cred: showCredScada,
                pt: showPtScada,
                extra: extraScadaVisible,
            },
            activeTrendPipelineId,
            activePressureOverlayIds,
            trendWidth,
        }

        try {
            window.localStorage.setItem(DIRECTORY_LAYOUT_STORAGE_KEY, JSON.stringify(state))
        } catch (error) {
            console.warn('[GlobalPipelineView] 保存管线目录布局失败:', error)
        }
    }, [
        activePressureOverlayIds,
        activeTrendPipelineId,
        directoryPos,
        directorySize,
        expandedGroups,
        extraScadaVisible,
        orderedPipelines,
        pipelinesLoaded,
        showCredScada,
        showPtScada,
        showScada,
        showWe1WestScada,
        showWe2Scada,
        trendWidth,
        visibleLayers,
    ])

    const resetDirectoryLayout = useCallback(() => {
        if (typeof window !== 'undefined') {
            window.localStorage.removeItem(DIRECTORY_LAYOUT_STORAGE_KEY)
        }
        setDirectoryPos({ x: 24, y: 96 })
        setDirectorySize({ width: 288, height: Math.min(620, Math.max(420, H - 140)) })
        setPipelineOrderIds(pipelines.map(pkg => pkg.id))
        setExpandedGroups({ we1: true })
        setVisibleLayers(buildInitialLayerVisibility(pipelines))
        setShowScada(false)
        setShowWe1WestScada(false)
        setShowWe2Scada(false)
        setShowCredScada(false)
        setShowPtScada(false)
        setExtraScadaVisible({})
        setActiveTrendPipelineId(null)
        setActivePressureOverlayIds({})
        setTrendWidth(920)
    }, [H, pipelines])

    const handleDirectoryMouseDown = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement
        if (target.closest('button') || target.closest('[data-pipeline-row]') || target.closest('[data-directory-resize]')) return
        setIsDraggingDirectory(true)
        directoryDragOffsetRef.current = { x: e.clientX - directoryPos.x, y: e.clientY - directoryPos.y }
    }

    const handleDirectoryResizeMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation()
        setIsResizingDirectory(true)
        directoryResizeStartRef.current = { x: e.clientX, y: e.clientY, width: directorySize.width, height: directorySize.height }
    }

    const handlePipelineDragStart = (e: React.DragEvent, pipelineId: string) => {
        setPipelineDragId(pipelineId)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', pipelineId)
    }

    const handlePipelineDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault()
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const nextIndex = e.clientY > rect.top + rect.height / 2 ? index + 1 : index
        setPipelineDropIndex(nextIndex)
    }

    const handlePipelineListDragOver = (e: React.DragEvent) => {
        if (!pipelineDragId) return
        e.preventDefault()

        const container = e.currentTarget as HTMLElement
        const rect = container.getBoundingClientRect()
        const pointerY = e.clientY
        const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-pipeline-row]'))

        if (rows.length === 0) {
            setPipelineDropIndex(0)
            return
        }

        if (pointerY <= rect.top + 20) {
            setPipelineDropIndex(0)
            return
        }

        if (pointerY >= rect.bottom - 20) {
            setPipelineDropIndex(rows.length)
            return
        }

        let matchedIndex = rows.length
        for (let i = 0; i < rows.length; i++) {
            const rowRect = rows[i].getBoundingClientRect()
            if (pointerY < rowRect.top + rowRect.height / 2) {
                matchedIndex = i
                break
            }
        }
        setPipelineDropIndex(matchedIndex)
    }

    const handlePipelineDrop = (e: React.DragEvent) => {
        e.preventDefault()
        const dragId = pipelineDragId || e.dataTransfer.getData('text/plain')
        if (!dragId || pipelineDropIndex == null) return

        const currentIds = orderedPipelines.map(pkg => pkg.id)
        const fromIndex = currentIds.indexOf(dragId)
        if (fromIndex < 0) return

        const nextIds = currentIds.filter(id => id !== dragId)
        const adjustedIndex = fromIndex < pipelineDropIndex ? pipelineDropIndex - 1 : pipelineDropIndex
        nextIds.splice(clampNumber(adjustedIndex, 0, nextIds.length), 0, dragId)
        setPipelineOrderIds(nextIds)
        setPipelineDragId(null)
        setPipelineDropIndex(null)
    }

    const togglePressureOverlay = useCallback((pipelineId: string) => {
        setActivePressureOverlayIds(prev => ({ ...prev, [pipelineId]: !prev[pipelineId] }))
    }, [])

    // 切换分组展开
    const toggleGroupExpand = (pipelineId: string) => {
        setExpandedGroups(prev => ({ ...prev, [pipelineId]: !prev[pipelineId] }))
    }

    // 切换单个图层可见性
    const toggleLayer = (layerId: string) => {
        setVisibleLayers(prev => ({ ...prev, [layerId]: !prev[layerId] }))
    }

    // 切换整个管线包可见性
    const togglePackageVisibility = (pkg: PipelinePackage) => {
        const layerIds = pkg.layers.map((layer, index) => getPipelineLayerId(pkg, layer, index))
        const allVisible = layerIds.every(id => visibleLayers[id])

        const newState = { ...visibleLayers }
        for (let i = 0; i < layerIds.length; i++) {
            newState[layerIds[i]] = !allVisible
        }
        setVisibleLayers(newState)
    }

    // 全选 / 全部取消功能
    const toggleAllLayers = (visible: boolean) => {
        const newState: Record<string, boolean> = {}
        for (let i = 0; i < pipelines.length; i++) {
            const pkg = pipelines[i]
            for (let j = 0; j < pkg.layers.length; j++) {
                newState[getPipelineLayerId(pkg, pkg.layers[j], j)] = visible
            }
        }
        setVisibleLayers(newState)
    }

    // 计算当前显示的管道数据 - 性能优化版
    const pipelineData = useMemo<PipelineData>(() => {
        return buildPipelineDataFromPackages(pipelines, visibleLayers)
    }, [visibleLayers, pipelines])

    useEffect(() => {
        if (!selectedMapNode) return

        const stillVisible = pipelineData.nodes.some(node => node.id === selectedMapNode.id)
        if (!stillVisible) {
            setSelectedMapNode(null)
        }
    }, [pipelineData.nodes, selectedMapNode])

    // 统计信息
    const stats = useMemo(() => ({
        stations: pipelineData.nodes.length,
        pipelines: pipelineData.lines.length,
        groups: pipelines.length
    }), [pipelineData, pipelines])

    const selectedMapNodeMeta = useMemo(() => {
        if (!selectedMapNode) return null

        const rawType = getNodeRawType(selectedMapNode)
        const rawTypeLabelMap: Record<string, string> = {
            source: '气源/首末站',
            compressor: '压气站',
            distribution: '分输站',
            valve: '阀室',
            junction: '交汇点',
            storage: '储气设施',
            shared: '共享站点',
            other: '其他节点',
        }

        const junctionKind = getJunctionKind(selectedMapNode)
        const rawTypeLabel = rawType === 'junction'
            ? junctionKind === 'major_junction'
                ? '大枢纽'
                : '枢纽/交汇点'
            : rawTypeLabelMap[rawType] || '其他节点'

        return {
            rawTypeLabel,
            layerName: typeof selectedMapNode.properties?.layerName === 'string'
                ? selectedMapNode.properties.layerName
                : '未标记图层',
            systemId: typeof selectedMapNode.properties?.systemId === 'string'
                ? selectedMapNode.properties.systemId
                : '未标记系统',
            junctionKindLabel: junctionKind === 'major_junction' ? '大枢纽' : junctionKind === 'junction' ? '普通枢纽' : null,
        }
    }, [selectedMapNode])

    const handleMapNodeClick = useCallback((event: { data: PipelineNode }) => {
        setSelectedMapNode(event.data)
    }, [])

    // ==========================================
    // 将 SCADA 数据直接渲染在对应管网节点上 (无动画/单纯显示)
    // ==========================================
    useEffect(() => {
        if (!mapInstance) return

        let timer: any
        const activeEntries = Object.entries(activePressureOverlayIds).filter(([, active]) => active)
        const activeStationData = new Map<string, { inP: number; outP: number; inT?: number; outT?: number; color: string }>()
        activeEntries.forEach(([pipelineId]) => {
            const source = getTrendSource(pipelineId)
            if (!source) return

            source.entries.forEach(([name, record]) => {
                if (!Number.isFinite(record.inP) || !Number.isFinite(record.outP)) return
                const value = {
                    inP: record.inP,
                    outP: record.outP,
                    inT: record.inT,
                    outT: record.outT,
                    color: source.color,
                }
                activeStationData.set(name, value)
                activeStationData.set(normalizeStationMatchKey(name), value)
            })
        })

        // 使用 timer 定期重新挂载属性（考虑用户缩放或平移时地图重新生成 marker）
        timer = setInterval(() => {
            const markerMap = getNodeMarkerMap()
            if (markerMap.size === 0) return

            markerMap.forEach((marker) => {
                if (!marker || !marker.getContent) return

                const node = marker.getExtData()?.node as PipelineNode
                if (!node) return

                let originalContent = typeof marker.getContent === 'function' ? marker.getContent() : marker.getContent?.() || ''
                if (typeof originalContent !== 'string') return

                const hasRealtime = originalContent.includes('<!--scada-label-->')
                if (hasRealtime) {
                    originalContent = originalContent.split('<!--scada-label-->')[0]
                }

                const scadaData = activeStationData.get(node.name) || activeStationData.get(normalizeStationMatchKey(node.name))
                if (!scadaData) {
                    if (hasRealtime) marker.setContent(originalContent)
                    return
                }

                const inTLabel = scadaData.inT ? ` T: ${scadaData.inT}` : ''
                const outTLabel = scadaData.outT ? ` T: ${scadaData.outT}` : ''
                const shadow = '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000'

                const scadaHTML = `
                    <!--scada-label-->
                    <div class="absolute left-1/2 -top-1 -translate-x-1/2 -translate-y-full flex flex-col items-center pointer-events-none whitespace-nowrap z-50 overflow-visible" 
                         style="line-height: 1.1; display:flex;">
                        <span style="font-size:10px; font-weight:bold; color:#f59e0b; text-shadow: ${shadow};">
                            入 P: ${scadaData.inP.toFixed(2)}${inTLabel}
                        </span>
                        <span style="font-size:10px; font-weight:bold; color:${scadaData.color}; text-shadow: ${shadow};">
                            出 P: ${scadaData.outP.toFixed(2)}${outTLabel}
                        </span>
                    </div>
                `

                if (originalContent.includes('class="compressor-marker-container"')) {
                    originalContent = originalContent.replace('class="compressor-marker-container"', 'class="compressor-marker-container" style="position:relative; overflow:visible;"')
                    marker.setContent(originalContent + scadaHTML)
                } else if (originalContent.startsWith('<div')) {
                    originalContent = originalContent.replace('<div', '<div style="position:relative; overflow:visible;"')
                    marker.setContent(originalContent + scadaHTML)
                }
            })
        }, 800)

        return () => clearInterval(timer)
    }, [activePressureOverlayIds, mapInstance])

    const fixedScadaPanels = [
        {
            id: 'we1',
            visible: showScada && !isScadaPoppedOut,
            label: '西气东输一线',
            accentColor: '#10b981',
            titleColor: '#a7f3d0',
            style: { left: `${scadaPos.x}px`, top: `${scadaPos.y}px` },
            topBarGradient: 'linear-gradient(90deg, #10b981, #059669, #10b981)',
            borderColor: 'rgba(16,185,129,0.3)',
            headerBorderColor: 'rgba(16,185,129,0.15)',
            background: 'linear-gradient(135deg, rgba(10,20,30,0.92) 0%, rgba(15,30,20,0.92) 100%)',
            isDragging: isDraggingScada,
            onMouseDown: handleScadaMouseDown,
            onClose: () => setShowScada(false),
            data: REAL_SCADA_DATA,
            closePopOut: closeScadaPopOut,
            popOut: popOutScada,
        },
        {
            id: 'we2',
            visible: showWe2Scada,
            label: '西气东输二线',
            accentColor: '#3b82f6',
            titleColor: '#bfdbfe',
            style: { left: `${we2ScadaPos.x}px`, top: `${we2ScadaPos.y}px` },
            topBarGradient: 'linear-gradient(90deg, #3b82f6, #2563eb, #3b82f6)',
            borderColor: 'rgba(59,130,246,0.3)',
            headerBorderColor: 'rgba(59,130,246,0.15)',
            background: 'linear-gradient(135deg, rgba(10,15,30,0.92) 0%, rgba(10,20,35,0.92) 100%)',
            isDragging: isDraggingWe2Scada,
            onMouseDown: handleWe2ScadaMouseDown,
            onClose: () => setShowWe2Scada(false),
            data: WE2_SCADA_DATA,
            closePopOut: noop,
            popOut: noop,
        },
        {
            id: 'we1-west',
            visible: showWe1WestScada,
            label: '西气东输一线（西段）',
            accentColor: '#f59e0b',
            titleColor: '#fde68a',
            style: { left: `${we1WestPos.x}px`, top: `${we1WestPos.y}px` },
            topBarGradient: 'linear-gradient(90deg,#f59e0b,#d97706,#f59e0b)',
            borderColor: 'rgba(245,158,11,0.3)',
            headerBorderColor: 'rgba(245,158,11,0.15)',
            background: 'linear-gradient(135deg, rgba(20,15,5,0.93) 0%, rgba(30,20,5,0.93) 100%)',
            isDragging: isDraggingWe1West,
            onMouseDown: handleWe1WestMouseDown,
            onClose: () => setShowWe1WestScada(false),
            data: WE1_WEST_SCADA_DATA,
            closePopOut: noop,
            popOut: noop,
        },
        {
            id: 'cred',
            visible: showCredScada,
            label: '中俄东线',
            accentColor: '#ec4899',
            titleColor: '#fbcfe8',
            style: { left: `${credPos.x}px`, top: `${credPos.y}px` },
            topBarGradient: 'linear-gradient(90deg,#ec4899,#be185d,#ec4899)',
            borderColor: 'rgba(236,72,153,0.3)',
            headerBorderColor: 'rgba(236,72,153,0.15)',
            background: 'linear-gradient(135deg, rgba(25,5,15,0.93) 0%, rgba(35,5,20,0.93) 100%)',
            isDragging: isDraggingCred,
            onMouseDown: handleCredMouseDown,
            onClose: () => setShowCredScada(false),
            data: CRED_SCADA_DATA,
            closePopOut: noop,
            popOut: noop,
        },
        {
            id: 'pt',
            visible: showPtScada,
            label: '平泰支干线',
            accentColor: '#a855f7',
            titleColor: '#e9d5ff',
            style: { left: `${ptPos.x}px`, top: `${ptPos.y}px` },
            topBarGradient: 'linear-gradient(90deg,#a855f7,#7c3aed,#a855f7)',
            borderColor: 'rgba(168,85,247,0.3)',
            headerBorderColor: 'rgba(168,85,247,0.15)',
            background: 'linear-gradient(135deg, rgba(15,5,25,0.93) 0%, rgba(20,5,35,0.93) 100%)',
            isDragging: isDraggingPt,
            onMouseDown: handlePtMouseDown,
            onClose: () => setShowPtScada(false),
            data: PT_SCADA_DATA,
            closePopOut: noop,
            popOut: noop,
        },
    ]

    return (
        <div
            className="h-screen w-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 overflow-hidden relative"
            onMouseMove={handleGlobalMouseMove}
            onMouseUp={handleGlobalMouseUp}
            onMouseLeave={handleGlobalMouseUp}
        >
            {/* 标题栏 */}
            <div className="absolute top-0 left-0 right-0 z-30 bg-black/50 backdrop-blur-sm border-b border-blue-500/30">
                <div className="container mx-auto px-6 py-4 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                            <span className="material-symbols-outlined text-3xl text-blue-400">public</span>
                            智脉平台-全国管网统一视图
                        </h1>
                        <p className="text-sm text-gray-300 mt-1">
                            站场: {stats.stations} | 管道段: {stats.pipelines} | 管线组: {stats.groups}
                        </p>
                    </div>
                    {/* 右侧工具栏 */}
                    <div className="flex items-center gap-3">
                        {/* 甪直站历史数据入口 */}
                        <button
                            onClick={() => {
                                if (stationHistoryTarget?.stationName === '甪直分输站') {
                                    setStationHistoryTarget(null)
                                } else {
                                    openStationHistoryPanel('甪直分输站', { displayName: '甪直分输站', initialViewMode: 'overview', initialHours: 0 })
                                }
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all"
                            style={{
                                background: stationHistoryTarget?.stationName === '甪直分输站' ? 'rgba(59,130,246,0.25)' : 'rgba(15,23,42,0.6)',
                                border: `1px solid ${stationHistoryTarget?.stationName === '甪直分输站' ? 'rgba(59,130,246,0.5)' : 'rgba(59,130,246,0.2)'}`,
                                color: stationHistoryTarget?.stationName === '甪直分输站' ? '#93c5fd' : '#64748b',
                            }}
                            title="甪直分输站历史回溯（试点）"
                        >
                            <span className="material-symbols-outlined text-base">history</span>
                            <span>甪直历史</span>
                            <span style={{ fontSize: '9px', color: '#10b981', background: 'rgba(16,185,129,0.15)', padding: '0 4px', borderRadius: '4px', border: '1px solid rgba(16,185,129,0.3)' }}>试点</span>
                        </button>
                        <button
                            onClick={() => {
                                if (stationHistoryTarget?.stationName === '中卫压气站') {
                                    setStationHistoryTarget(null)
                                } else {
                                    openStationHistoryPanel('中卫压气站', { displayName: '中卫压气站', initialViewMode: 'overview', initialHours: 0 })
                                }
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all"
                            style={{
                                background: stationHistoryTarget?.stationName === '中卫压气站' ? 'rgba(245,158,11,0.22)' : 'rgba(15,23,42,0.6)',
                                border: `1px solid ${stationHistoryTarget?.stationName === '中卫压气站' ? 'rgba(245,158,11,0.48)' : 'rgba(245,158,11,0.2)'}`,
                                color: stationHistoryTarget?.stationName === '中卫压气站' ? '#fde68a' : '#94a3b8',
                            }}
                            title="打开中卫压气站历史回溯面板"
                        >
                            <span className="material-symbols-outlined text-base">monitoring</span>
                            <span>中卫历史</span>
                            <span style={{ fontSize: '9px', color: '#facc15', background: 'rgba(250,204,21,0.12)', padding: '0 4px', borderRadius: '4px', border: '1px solid rgba(250,204,21,0.28)' }}>新接入</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* 地图 */}
            <MapView
                pipelineData={pipelineData}
                onLoad={handleMapLoad}
                onNodeClick={handleMapNodeClick}
            />

            {/* 图层控制面板 - 树形结构 */}
            <div
                className={`absolute z-10 bg-[#0c1218]/90 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.6)] rounded-lg border border-[rgba(45,59,78,0.7)] flex flex-col overflow-hidden ${isDraggingDirectory ? 'cursor-grabbing' : ''}`}
                style={{
                    left: `${directoryPos.x}px`,
                    top: `${directoryPos.y}px`,
                    width: `${directorySize.width}px`,
                    height: `${directorySize.height}px`,
                }}
            >
                {/* 粘性表头 */}
                <div
                    className={`flex justify-between items-center px-4 py-3 bg-[#0c1218]/95 border-b border-gray-700/60 sticky top-0 z-20 shrink-0 ${isDraggingDirectory ? 'cursor-grabbing' : 'cursor-grab'}`}
                    onMouseDown={handleDirectoryMouseDown}
                    title="按住标题栏可拖动管线目录"
                >
                    <h3 className="text-white text-base font-bold flex items-center gap-2">
                        <span className="material-symbols-outlined text-xl">toc</span>
                        管线目录
                    </h3>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => toggleAllLayers(true)}
                            className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 hover:text-white transition-colors"
                            title="显示全部管线"
                        >
                            全选
                        </button>
                        <button
                            onClick={() => toggleAllLayers(false)}
                            className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 hover:text-white transition-colors"
                            title="隐藏全部管线"
                        >
                            全部取消
                        </button>
                        <button
                            onClick={resetDirectoryLayout}
                            className="text-xs px-2 py-1 bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-200 rounded border border-cyan-500/30 hover:text-white transition-colors"
                            title="复原目录位置、大小、排序和按钮状态"
                        >
                            复原
                        </button>

                    </div>
                </div>

                <div
                    className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1"
                    onDragOver={handlePipelineListDragOver}
                    onDrop={handlePipelineDrop}
                >
                    {orderedPipelines.map((pkg, pipelineIndex) => {
                        const layerIds = pkg.layers.map((layer, index) => getPipelineLayerId(pkg, layer, index))
                        const isAllVisible = layerIds.every(id => visibleLayers[id])
                        const isPartialVisible = !isAllVisible && layerIds.some(id => visibleLayers[id])
                        const hasBranches = pkg.layers.length > 1

                        return (
                            <React.Fragment key={pkg.id}>
                            {pipelineDropIndex === pipelineIndex && pipelineDragId !== pkg.id && (
                                <div className="relative mx-1 my-1 h-3">
                                    <div className="absolute left-1 right-1 top-1/2 h-px -translate-y-1/2 bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
                                    <div className="absolute left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-cyan-300 bg-[#0c1218]" />
                                </div>
                            )}
                            <div
                                className={`px-1 rounded-md ${pipelineDragId === pkg.id ? 'opacity-45' : ''}`}
                                data-pipeline-row
                                draggable
                                onDragStart={(e) => handlePipelineDragStart(e, pkg.id)}
                                onDragOver={(e) => handlePipelineDragOver(e, pipelineIndex)}
                                onDrop={handlePipelineDrop}
                                onDragEnd={() => { setPipelineDragId(null); setPipelineDropIndex(null) }}
                                title="按住管线行可上下拖动排序"
                            >
                                {/* 组头部 (管线名) */}
                                <div
                                    className="flex items-center gap-2 hover:bg-white/5 p-1.5 rounded transition-colors select-none cursor-grab active:cursor-grabbing group"
                                    onClick={() => hasBranches && toggleGroupExpand(pkg.id)}
                                >
                                    {/* 展开/收起箭头 */}
                                    <div className="w-5 h-5 flex items-center justify-center shrink-0">
                                        {hasBranches && (
                                            <span className={`material-symbols-outlined text-xl text-gray-400 group-hover:text-white transition-all duration-200 ${expandedGroups[pkg.id] ? 'rotate-90' : ''}`}>
                                                chevron_right
                                            </span>
                                        )}
                                    </div>

                                    {/* 自定义复选框 - 控制整个组 */}
                                    <div
                                        className="relative flex items-center justify-center w-[18px] h-[18px]"
                                        onClick={(e) => { e.stopPropagation(); togglePackageVisibility(pkg); }}
                                    >
                                        <div className={`absolute inset-0 rounded-[4px] border ${isAllVisible || isPartialVisible ? 'border-[#137fec] bg-[#137fec]' : 'border-gray-500 bg-[#1c2430] group-hover:border-gray-400'} transition-colors`}></div>
                                        {isAllVisible && (
                                            <svg className="absolute w-[12px] h-[12px] text-white pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12"></polyline>
                                            </svg>
                                        )}
                                        {isPartialVisible && (
                                            <svg className="absolute w-[10px] h-[10px] text-white pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
                                                <line x1="5" y1="12" x2="19" y2="12"></line>
                                            </svg>
                                        )}
                                    </div>

                                    {/* 文本标签及额外的弹出按钮 */}
                                    <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                        <span className="min-w-0 text-white font-medium text-sm flex items-center gap-2.5">
                                            <span
                                                className="shrink-0 w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]"
                                                style={{ backgroundColor: pkg.color }}
                                            ></span>
                                            <span className="truncate">{pkg.name}</span>
                                        </span>
                                        {renderPipelineActions(pkg)}
                                    </div>
                                </div>

                                {/* 图层列表 (子节点) */}
                                {expandedGroups[pkg.id] && hasBranches && (
                                    <div className="ml-[22px] mt-1 mb-2 space-y-1 pl-4 border-l border-gray-700/60 relative">
                                        {/* 顶部辅助渐变线 */}
                                        <div className="absolute top-0 bottom-0 left-[-1px] w-px bg-gradient-to-b from-gray-700/60 to-transparent"></div>
                                        {pkg.layers.map((layer, layerIndex) => {
                                            const layerId = getPipelineLayerId(pkg, layer, layerIndex)
                                            return (
                                            <div
                                                key={layerId}
                                                className="flex items-center gap-2 p-1.5 hover:bg-white/5 rounded cursor-pointer select-none group/item"
                                                onClick={() => toggleLayer(layerId)}
                                            >
                                                {/* 自定义复选框 - 子图层 */}
                                                <div className="relative flex items-center justify-center w-[16px] h-[16px]">
                                                    <div className={`absolute inset-0 rounded-[3px] border ${visibleLayers[layerId] ? 'border-[#137fec] bg-[#137fec]' : 'border-gray-500 bg-[#1c2430] group-hover/item:border-gray-400'} transition-colors`}></div>
                                                    {visibleLayers[layerId] && (
                                                        <svg className="absolute w-[10px] h-[10px] text-white pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="20 6 9 17 4 12"></polyline>
                                                        </svg>
                                                    )}
                                                </div>
                                                <span
                                                    className={`w-1.5 h-1.5 rounded-full ${layer.type === 'trunk' ? 'opacity-100 shadow-[0_0_4px_rgba(0,0,0,0.5)]' : 'opacity-60'} transition-opacity`}
                                                    style={{ backgroundColor: pkg.color }}
                                                ></span>
                                                <span className={`text-sm transition-colors ${visibleLayers[layerId] ? 'text-gray-200 font-medium' : 'text-gray-400'}`}>
                                                    {layer.type === 'trunk' ? '干线' : layer.name.replace('支线', '')}
                                                </span>
                                            </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                            </React.Fragment>
                        )
                    })}
                    {pipelineDropIndex === orderedPipelines.length && (
                        <div className="relative mx-1 my-1 h-3">
                            <div className="absolute left-1 right-1 top-1/2 h-px -translate-y-1/2 bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
                            <div className="absolute left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-cyan-300 bg-[#0c1218]" />
                        </div>
                    )}
                </div>
                <div
                    data-directory-resize
                    className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize rounded-tl-md border-l border-t border-cyan-400/30 bg-cyan-400/10"
                    onMouseDown={handleDirectoryResizeMouseDown}
                    title="拖动调整管线目录宽高"
                />
            </div>

            {/* ====== 甪直分输站 · 历史回溯面板（试点） ====== */}
            {stationHistoryTarget && (
                <div
                    className="absolute z-20"
                    style={{ left: `${stationHistoryPos.x}px`, top: `${stationHistoryPos.y}px` }}
                >
                    <StationHistoryPanel
                        stationName={stationHistoryTarget.stationName}
                        displayName={stationHistoryTarget.displayName}
                        initialViewMode={stationHistoryTarget.initialViewMode}
                        initialHours={stationHistoryTarget.initialHours}
                        focusHint={stationHistoryTarget.focusHint}
                        onClose={() => setStationHistoryTarget(null)}
                        onMouseDown={handleStationHistoryMouseDown}
                        isDragging={isDraggingStationHistory}
                    />
                </div>
            )}

            {/* ====== 西一线 SCADA 浮动参数表 (支持弹窗新窗口) ====== */}
            {isScadaPoppedOut && (

                <div className="hidden">{/* 主页面隐藏该面板，在 Popup 窗口中渲染 */}</div>
            )}
            {fixedScadaPanels.filter(panel => panel.visible).map(panel => (
                <ScadaFloatingPanel
                    key={panel.id}
                    label={panel.label}
                    accentColor={panel.accentColor}
                    titleColor={panel.titleColor}
                    style={panel.style}
                    topBarGradient={panel.topBarGradient}
                    borderColor={panel.borderColor}
                    headerBorderColor={panel.headerBorderColor}
                    background={panel.background}
                    isDragging={panel.isDragging}
                    onMouseDown={panel.onMouseDown}
                    onClose={panel.onClose}
                >
                    <ScadaTableContent
                        data={panel.data}
                        isPoppedOut={false}
                        closePopOut={panel.closePopOut}
                        popOut={panel.popOut}
                        accentColor={panel.accentColor}
                        onMetricClick={handleMetricClick}
                    />
                </ScadaFloatingPanel>
            ))}

            {/* ====== 所有管线 SCADA 浮动面板（统一循环渲染 + 弹出独立窗口） ====== */}
            {EXTRA_SCADA_PANELS.map((panel, idx) => (
                extraScadaVisible[panel.id] && (
                    <ScadaFloatingPanel
                        key={panel.id}
                        label={panel.label}
                        accentColor={panel.color}
                        titleColor={panel.titleColor}
                        style={{
                            right: `${20 + (idx % 3) * 500}px`,
                            bottom: `${20 + Math.floor(idx / 3) * 340}px`,
                        }}
                        topBarGradient={`linear-gradient(90deg,${panel.color},${panel.color}88,${panel.color})`}
                        borderColor={`${panel.color}33`}
                        headerBorderColor={`${panel.color}22`}
                        background={`linear-gradient(135deg, ${panel.bgFrom} 0%, ${panel.bgTo} 100%)`}
                        onClose={() => toggleExtraScada(panel.id)}
                        actions={
                            <button
                                onClick={() => {
                                    const w = 520
                                    const h = 500
                                    const left = window.screenX + (window.outerWidth - w) / 2
                                    const top = window.screenY + (window.outerHeight - h) / 2
                                    window.open(
                                        `/#/popout/scada?id=${panel.id}`,
                                        `scada-${panel.id}`,
                                        `width=${w},height=${h},left=${left},top=${top}`
                                    )
                                }}
                                className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10"
                                title="弹出独立窗口"
                            >
                                <span className="material-symbols-outlined text-sm">open_in_new</span>
                            </button>
                        }
                    >
                        {Object.keys(panel.data).length > 0 ? (
                            <ScadaTableContent
                                data={panel.data}
                                isPoppedOut={false}
                                closePopOut={noop}
                                popOut={noop}
                                accentColor={panel.color}
                            />
                        ) : (
                            <EmptyScadaState color={panel.color} label={panel.label} />
                        )}
                    </ScadaFloatingPanel>
                )
            ))}

            {/* ====== 通用里程进出站压力图 ====== */}
            {activeTrendChart && (
                <div style={{ left: `${trendPos.x}px`, top: `${trendPos.y}px`, position: 'absolute', zIndex: 20 }}>
                    <PressureTrendChart
                        config={activeTrendChart}
                        onClose={() => setActiveTrendPipelineId(null)}
                        onMouseDown={handleTrendMouseDown}
                        isDragging={isDraggingTrend}
                        width={trendWidth}
                        onResizeMouseDown={handleTrendResizeMouseDown}
                    />
                </div>
            )}

            {/* 图例 */}
            <div className="absolute bottom-6 right-6 z-10 bg-black/70 backdrop-blur-sm rounded-lg px-4 py-3 border border-blue-500/30">
                <div className="space-y-2 text-sm">
                    {pipelines.map(pkg => (
                        <div key={pkg.id} className="flex items-center gap-2">
                            <div className="w-6 h-1 rounded" style={{ backgroundColor: pkg.color }} />
                            <span className="text-white">{pkg.name}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* SCADA 历史曲线浮动面板 — 点击压力/温度值弹出 */}
            {historyTarget && (
                <div
                    className="absolute z-30"
                    style={{ left: historyChartPos.x, top: historyChartPos.y }}
                >
                    <ScadaHistoryChart
                        stationName={historyTarget.stationName}
                        displayName={historyTarget.stationName}
                        metricType={historyTarget.metricType}
                        initialHours={historyTarget.hours}
                        baseValue={historyTarget.baseValue}
                        onClose={() => setHistoryTarget(null)}
                        onMouseDown={handleHistoryMouseDown}
                        isDragging={isDraggingHistory}
                    />
                </div>
            )}

            {selectedMapNode && selectedMapNodeMeta && (
                <div className="absolute top-24 right-6 z-20 w-[340px] bg-[#0c1218]/95 backdrop-blur-md rounded-xl border border-cyan-500/20 shadow-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-cyan-500/20 bg-[#0f1722] flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-white">{selectedMapNode.name}</h3>
                            <p className="text-[11px] text-gray-400 mt-0.5">地图节点详情</p>
                        </div>
                        <button
                            onClick={() => setSelectedMapNode(null)}
                            className="text-gray-400 hover:text-white transition-colors"
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <div className="p-4 space-y-3 text-sm">
                        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-2">
                            <p className="text-xs text-gray-400">类型：<span className="text-gray-200">{selectedMapNodeMeta.rawTypeLabel}</span></p>
                            {selectedMapNodeMeta.junctionKindLabel && (
                                <p className="text-xs text-gray-400">枢纽等级：<span className="text-gray-200">{selectedMapNodeMeta.junctionKindLabel}</span></p>
                            )}
                            <p className="text-xs text-gray-400">图层：<span className="text-gray-200">{selectedMapNodeMeta.layerName}</span></p>
                            <p className="text-xs text-gray-400">系统：<span className="text-gray-200">{selectedMapNodeMeta.systemId}</span></p>
                            <p className="text-xs text-gray-400">
                                坐标：<span className="text-gray-200">{selectedMapNode.coordinate.longitude.toFixed(4)}, {selectedMapNode.coordinate.latitude.toFixed(4)}</span>
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => {
                                    if (mapInstance) {
                                        mapInstance.setZoomAndCenter(13, [selectedMapNode.coordinate.longitude, selectedMapNode.coordinate.latitude])
                                    }
                                }}
                                className="bg-gray-800 hover:bg-gray-700 text-gray-200 py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                            >
                                <span className="material-symbols-outlined text-sm">my_location</span>地图定位
                            </button>
                            <button
                                onClick={() => {
                                    navigate(`/map-topology?focusNode=${encodeURIComponent(selectedMapNode.id)}`)
                                    setSelectedMapNode(null)
                                }}
                                className="bg-cyan-700/80 hover:bg-cyan-600 text-white py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                            >
                                <span className="material-symbols-outlined text-sm">conversion_path</span>地图拓扑
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// 可点击单元格样式
const clickableCellStyle: React.CSSProperties = { cursor: 'pointer', borderRadius: '4px', transition: 'background 0.15s, box-shadow 0.15s' }

// 抽取 SCADA 内容渲染部分，供复用
const ScadaTableContent: React.FC<{
    data: Record<string, ScadaRecord>
    isPoppedOut: boolean
    closePopOut: () => void
    popOut: (w: number, h: number) => void
    accentColor?: string
    onStationClick?: (stationName: string) => void
    onMetricClick?: (stationName: string, metricType: 'pressure' | 'temperature', baseValue: number) => void
}> = ({ data, isPoppedOut, closePopOut, accentColor = '#10b981', onStationClick, onMetricClick }) => {
    const inPressureColor = accentColor === '#10b981' ? '#34d399'
        : accentColor === '#3b82f6' ? '#60a5fa'
        : accentColor === '#f59e0b' ? '#fcd34d'
        : accentColor === '#ec4899' ? '#f9a8d4'
        : accentColor === '#a855f7' ? '#d8b4fe'
        : '#a3e635'

    const isLowPressure = (p: number) => p < 5.0
    const isHighPressure = (p: number) => p > 10.5
    const getPressureColor = (p: number, baseColor: string) => {
        if (isLowPressure(p)) return '#f97316'
        if (isHighPressure(p)) return '#ef4444'
        return baseColor
    }

    const rowBgAccent = accentColor.replace('#', '')
    function hexToRgb(hex: string) {
        const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16)
        return `${r},${g},${b}`
    }
    const rgb = hexToRgb(rowBgAccent)

    // 可点击单元格悬停效果
    const handleCellHover = (e: React.MouseEvent<HTMLTableCellElement>, entering: boolean) => {
        if (!onMetricClick) return
        const el = e.currentTarget
        if (entering) {
            el.style.background = 'rgba(255,255,255,0.08)'
            el.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.15)'
        } else {
            el.style.background = ''
            el.style.boxShadow = ''
        }
    }

    return (
        <div className={`flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar ${isPoppedOut ? 'h-full w-full p-4 text-white' : 'p-2'}`}
            style={{ scrollbarWidth: 'thin', scrollbarColor: `${accentColor}40 transparent` }}
        >
            {isPoppedOut && (
                <div className="pb-3 mb-3 border-b border-white/10 flex justify-between items-center">
                    <h3 className="m-0 text-sm font-bold flex items-center gap-1.5 text-slate-200">
                        <span className="material-symbols-outlined text-lg" style={{ color: accentColor }}>sensors</span>
                        SCADA 实时监控参数
                    </h3>
                    <button onClick={closePopOut} className="text-gray-400 hover:text-white transition-colors" title="恢复回主窗口">
                        <span className="material-symbols-outlined text-sm">open_in_browser</span>
                    </button>
                </div>
            )}
            {onMetricClick && (
                <div style={{ fontSize: '10px', color: '#475569', padding: '2px 6px', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>touch_app</span>
                    <span>点击压力/温度值查看历史回溯曲线</span>
                </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 3px', fontSize: '12px' }}>
                <thead>
                    <tr style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        <th style={{ padding: '2px 6px', textAlign: 'left', fontWeight: 600 }}>站名</th>
                        <th style={{ padding: '2px 6px', textAlign: 'center', fontWeight: 600 }}>类型</th>
                        <th style={{ padding: '2px 8px', textAlign: 'right', fontWeight: 600 }}>进站压力</th>
                        <th style={{ padding: '2px 4px', textAlign: 'center', fontWeight: 600 }}>进温</th>
                        <th style={{ padding: '2px 8px', textAlign: 'right', fontWeight: 600 }}>出站压力</th>
                        <th style={{ padding: '2px 4px', textAlign: 'center', fontWeight: 600 }}>出温</th>
                    </tr>
                </thead>
                <tbody>
                    {(Object.entries(data) as [string, ScadaRecord][]).map(([name, d]) => {
                        const isCompressor = d.type === 'compressor'
                        const rowBg = isCompressor ? `rgba(${rgb},0.08)` : 'rgba(255,255,255,0.02)'
                        const nameBold = isCompressor
                        const typeLabel = d.type === 'compressor' ? '压' : d.type === 'distribution' ? '分' : '阀'
                        const typeBg = d.type === 'compressor' ? `rgba(${rgb},0.22)` : 'rgba(100,116,139,0.2)'
                        const typeColor = d.type === 'compressor' ? accentColor : '#94a3b8'

                        return (
                            <tr key={name} style={{ background: rowBg, borderRadius: '6px', transition: 'background 0.15s' }}
                                onMouseEnter={e => (e.currentTarget.style.background = `rgba(${rgb},0.14)`)}
                                onMouseLeave={e => (e.currentTarget.style.background = rowBg)}>
                                <td style={{ padding: '5px 6px', borderRadius: '6px 0 0 6px', fontWeight: nameBold ? 600 : 400, color: '#e2e8f0', maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>
                                    {name}
                                </td>
                                <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                                    <span style={{ fontSize: '10px', background: typeBg, color: typeColor, padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>{typeLabel}</span>
                                </td>
                                <td style={{ ...clickableCellStyle, padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: getPressureColor(d.inP, inPressureColor), fontWeight: 600 }}
                                    title={onMetricClick ? `${name} 进站压力 ${d.inP.toFixed(3)} MPa，点击查看曲线` : undefined}
                                    onClick={() => onMetricClick?.(name, 'pressure', d.inP)}
                                    onMouseEnter={e => handleCellHover(e, true)} onMouseLeave={e => handleCellHover(e, false)}>
                                    {d.inP.toFixed(3)}
                                </td>
                                <td style={{ ...clickableCellStyle, padding: '5px 4px', textAlign: 'center', color: '#f97316', fontSize: '11px' }}
                                    title={onMetricClick && d.inT != null ? `${name} 进站温度 ${d.inT}°C，点击查看曲线` : undefined}
                                    onClick={() => d.inT != null && onMetricClick?.(name, 'temperature', d.inT)}
                                    onMouseEnter={e => d.inT != null && handleCellHover(e, true)} onMouseLeave={e => handleCellHover(e, false)}>
                                    {d.inT != null ? `${d.inT}°` : '—'}
                                </td>
                                <td style={{ ...clickableCellStyle, padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: getPressureColor(d.outP, accentColor), fontWeight: 600 }}
                                    title={onMetricClick ? `${name} 出站压力 ${d.outP.toFixed(3)} MPa，点击查看曲线` : undefined}
                                    onClick={() => onMetricClick?.(name, 'pressure', d.outP)}
                                    onMouseEnter={e => handleCellHover(e, true)} onMouseLeave={e => handleCellHover(e, false)}>
                                    {d.outP.toFixed(3)}
                                </td>
                                <td style={{ ...clickableCellStyle, padding: '5px 4px', textAlign: 'center', color: '#fb923c', fontSize: '11px', borderRadius: '0 6px 6px 0' }}
                                    title={onMetricClick && d.outT != null ? `${name} 出站温度 ${d.outT}°C，点击查看曲线` : undefined}
                                    onClick={() => d.outT != null && onMetricClick?.(name, 'temperature', d.outT)}
                                    onMouseEnter={e => d.outT != null && handleCellHover(e, true)} onMouseLeave={e => handleCellHover(e, false)}>
                                    {d.outT != null ? `${d.outT}°` : '—'}
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}

// 供独立路由使用的通用 SCADA 弹窗组件
// 通过 URL 参数 ?id=xxx 动态加载对应管线的 SCADA 数据
export const ScadaStandalone: React.FC = () => {
    // 从 URL 获取管线 ID
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    const pipelineId = params.get('id') || 'we1'
    const config = SCADA_DATA_MAP[pipelineId] || SCADA_DATA_MAP['we1']

    // 专用 Hook 负责防白屏和发送心跳
    usePopoutSync(`scada-${pipelineId}`);

    // 设置窗口标题
    React.useEffect(() => {
        document.title = `${config.label} - SCADA 实时参数`
    }, [config.label])

    return (
        <div className="h-screen w-screen bg-[#0c1218] flex flex-col">
            {/* 独立窗口标题栏 */}
            <div className="px-4 py-3 flex justify-between items-center shrink-0" style={{ borderBottom: `1px solid ${config.color}33`, background: 'rgba(12,18,24,0.95)' }}>
                <h2 className="m-0 text-base font-bold flex items-center gap-2" style={{ color: config.color }}>
                    <span className="material-symbols-outlined text-xl">sensors</span>
                    <span>{config.label}</span>
                    <span style={{ color: config.color, fontSize: '10px', fontWeight: 'normal', background: `${config.color}22`, padding: '2px 8px', borderRadius: '9999px', border: `1px solid ${config.color}44` }}>SCADA 实时</span>
                </h2>
                <button onClick={() => window.close()} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                    <span className="material-symbols-outlined">close</span>
                </button>
            </div>
            {Object.keys(config.data).length > 0 ? (
                <ScadaTableContent data={config.data} isPoppedOut={true} closePopOut={() => window.close()} popOut={() => {}} accentColor={config.color} />
            ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                        <span className="material-symbols-outlined text-5xl block mb-3" style={{ color: `${config.color}66` }}>database</span>
                        <p className="text-lg">暂无 SCADA 数据</p>
                        <p className="text-sm text-gray-600 mt-2">待导入 {config.label} 实际运行参数</p>
                    </div>
                </div>
            )}
        </div>
    )
}

export default GlobalPipelineView
