import React from 'react'
import type { ScadaRecord } from '@/views/global-pipeline/scadaConfig'

const clickableCellStyle: React.CSSProperties = { cursor: 'pointer', borderRadius: '4px', transition: 'background 0.15s, box-shadow 0.15s' }

export const ScadaTableContent: React.FC<{
    data: Record<string, ScadaRecord>
    isPoppedOut: boolean
    closePopOut: () => void
    popOut: (w: number, h: number) => void
    accentColor?: string
    onStationClick?: (stationName: string) => void
    onMetricClick?: (stationName: string, metricType: 'pressure' | 'temperature', baseValue: number) => void
    onStationHistoryClick?: (stationName: string) => void
    activeStationHistoryName?: string
}> = ({ data, isPoppedOut, closePopOut, accentColor = '#10b981', onStationClick, onMetricClick, onStationHistoryClick, activeStationHistoryName }) => {
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
                        const historyStationName = name.includes('中卫') ? '中卫压气站' : name.includes('甪直') ? '甪直分输站' : ''
                        const hasEmbeddedHistory = Boolean(historyStationName)
                        const isHistoryActive = activeStationHistoryName === historyStationName
                        const historyAccent = historyStationName === '中卫压气站' ? '#facc15' : '#38bdf8'

                        return (
                            <tr key={name} style={{ background: rowBg, borderRadius: '6px', transition: 'background 0.15s' }}
                                onMouseEnter={e => (e.currentTarget.style.background = `rgba(${rgb},0.14)`)}
                                onMouseLeave={e => (e.currentTarget.style.background = rowBg)}>
                                <td
                                    style={{
                                        padding: '5px 6px',
                                        borderRadius: '6px 0 0 6px',
                                        fontWeight: nameBold ? 600 : 400,
                                        color: '#e2e8f0',
                                        maxWidth: '150px',
                                        cursor: onStationClick ? 'pointer' : 'default',
                                    }}
                                    title={onStationClick ? `定位到${name}` : name}
                                    onClick={() => onStationClick?.(name)}
                                >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                                        <span
                                            style={{
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                textDecoration: onStationClick ? 'underline dotted rgba(148,163,184,0.45)' : 'none',
                                                textUnderlineOffset: 3,
                                            }}
                                        >
                                            {name}
                                        </span>
                                        {onStationHistoryClick && hasEmbeddedHistory && (
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    onStationHistoryClick(historyStationName)
                                                }}
                                                title={`打开${historyStationName}历史回溯面板`}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 2,
                                                    padding: '1px 5px',
                                                    borderRadius: 999,
                                                    border: `1px solid ${isHistoryActive ? historyAccent : `${historyAccent}55`}`,
                                                    background: isHistoryActive ? `${historyAccent}2e` : `${historyAccent}14`,
                                                    color: isHistoryActive ? '#fff' : historyAccent,
                                                    fontSize: 10,
                                                    fontWeight: 800,
                                                    cursor: 'pointer',
                                                    whiteSpace: 'nowrap',
                                                    flexShrink: 0,
                                                }}
                                            >
                                                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>history</span>
                                                历史
                                            </button>
                                        )}
                                    </span>
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
