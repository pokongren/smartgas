import React, { useEffect, useMemo, useState } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import Icon from '@/components/ui/Icon'
import { resolveApiPath } from '@/services/apiBase'

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
])

type ViewMode = 'pressure' | 'temperature' | 'dewpoint' | 'overview'

interface HistoryPoint {
  time: string
  value: number
}

interface HistorySeriesMeta {
  label?: string
  stationName?: string
  pipelineId?: string
  metricType?: string
}

interface HistoryResponse {
  station: string
  hours: number
  count: number
  series: Record<string, HistoryPoint[]>
  seriesMeta?: Record<string, HistorySeriesMeta>
}

interface Props {
  stationName: string
  displayName?: string
  onClose: () => void
  onMouseDown?: (e: React.MouseEvent) => void
  isDragging?: boolean
  initialHours?: 0 | 6 | 12
  initialViewMode?: ViewMode
  focusHint?: string
}

const TIME_RANGES = [
  { label: '6h', hours: 6 },
  { label: '12h', hours: 12 },
  { label: '全部', hours: 0 },
]

const VIEW_LABELS: Record<ViewMode, string> = {
  overview: '综合概览',
  pressure: '压力曲线',
  temperature: '温度曲线',
  dewpoint: '水露点',
}

const PIPELINE_LABELS: Record<string, string> = {
  we1: '西一线',
  we2: '西二线',
  cred: '中俄线',
  pt: '平泰线',
  we1_west: '西一线西段',
}

const METRIC_LABELS: Record<string, string> = {
  pressure: '压力',
  temperature: '温度',
  dewpoint: '水露点',
}

const METRIC_UNITS: Record<string, string> = {
  pressure: 'MPa',
  temperature: '°C',
  dewpoint: '°C',
}

const METRIC_COLORS: Record<string, string> = {
  pressure: '#f97316',
  temperature: '#38bdf8',
  dewpoint: '#facc15',
}

function parseSeriesKey(key: string, meta?: HistorySeriesMeta) {
  const [, suffix = ''] = key.split('__')
  const [pipelineId = '', ...metricParts] = suffix.split('_')
  const metricType = metricParts.join('_') || 'pressure'
  return {
    pipelineId: meta?.pipelineId || pipelineId,
    metricType: meta?.metricType || metricType,
  }
}

function buildSeriesLabel(key: string, meta?: HistorySeriesMeta) {
  const { pipelineId, metricType } = parseSeriesKey(key, meta)
  const pipelineLabel = PIPELINE_LABELS[pipelineId] || pipelineId.toUpperCase()
  const metricLabel = METRIC_LABELS[metricType] || metricType
  return `${pipelineLabel} ${metricLabel}`
}

const StationHistoryPanel: React.FC<Props> = ({
  stationName,
  displayName,
  onClose,
  onMouseDown,
  isDragging,
  initialHours = 0,
  initialViewMode = 'pressure',
  focusHint,
}) => {
  const [selectedHours, setSelectedHours] = useState(initialHours)
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode)
  const [selectedPipelines, setSelectedPipelines] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryResponse | null>(null)

  useEffect(() => {
    setSelectedHours(initialHours)
  }, [initialHours])

  useEffect(() => {
    setViewMode(initialViewMode)
  }, [initialViewMode])

  useEffect(() => {
    if (!stationName) return

    const controller = new AbortController()
    const query = new URLSearchParams({
      station_id: stationName,
      hours: String(selectedHours),
    })

    setLoading(true)
    setError(null)
    fetch(resolveApiPath(`/api/scada/history-by-id?${query.toString()}`), {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await response.text())
        }
        return response.json() as Promise<HistoryResponse>
      })
      .then((payload) => {
        setHistory(payload)
      })
      .catch((fetchError) => {
        if (controller.signal.aborted) return
        setHistory(null)
        setError(fetchError instanceof Error ? fetchError.message : '历史数据读取失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [selectedHours, stationName])

  const availablePipelines = useMemo(() => {
    if (!history?.seriesMeta) return []
    const pipelines = (Object.values(history.seriesMeta) as HistorySeriesMeta[])
      .map((meta) => String(meta.pipelineId || '').trim())
      .filter(Boolean)
    return Array.from(new Set(pipelines))
  }, [history])

  useEffect(() => {
    if (!availablePipelines.length) {
      setSelectedPipelines(new Set())
      return
    }

    setSelectedPipelines((prev) => {
      const next = new Set(Array.from(prev).filter((pipeline) => availablePipelines.includes(pipeline)))
      if (next.size === 0) {
        availablePipelines.forEach((pipeline) => next.add(pipeline))
      }
      return next
    })
  }, [availablePipelines])

  const visibleSeries = useMemo(() => {
    if (!history) return []

    return (Object.entries(history.series) as Array<[string, HistoryPoint[]]>)
      .map(([key, points]) => {
        const meta = history.seriesMeta?.[key]
        const parsed = parseSeriesKey(key, meta)
        return {
          key,
          points,
          meta,
          pipelineId: parsed.pipelineId,
          metricType: parsed.metricType,
        }
      })
      .filter((item) => {
        if (!item.points.length) return false
        if (selectedPipelines.size && item.pipelineId && !selectedPipelines.has(item.pipelineId)) {
          return false
        }
        if (viewMode === 'overview') {
          return item.metricType === 'pressure' || item.metricType === 'temperature'
        }
        return item.metricType === viewMode
      })
  }, [history, selectedPipelines, viewMode])

  const timeRange = useMemo(() => {
    const allPoints = visibleSeries.flatMap((item) => item.points)
    if (!allPoints.length) return null
    const timestamps = allPoints
      .map((point) => Date.parse(point.time))
      .filter((value) => Number.isFinite(value))
    if (!timestamps.length) return null
    return {
      start: new Date(Math.min(...timestamps)).toISOString(),
      end: new Date(Math.max(...timestamps)).toISOString(),
    }
  }, [visibleSeries])

  const togglePipeline = (pipelineId: string) => {
    setSelectedPipelines((prev) => {
      const next = new Set(prev)
      if (next.has(pipelineId)) {
        if (next.size > 1) next.delete(pipelineId)
      } else {
        next.add(pipelineId)
      }
      return next
    })
  }

  const chartOption = useMemo(() => {
    if (!visibleSeries.length) return null

    const activeMetricTypes = Array.from(new Set(visibleSeries.map((item) => item.metricType)))
    const hasDualAxis = activeMetricTypes.includes('pressure') && activeMetricTypes.includes('temperature')

    const seriesConfig = visibleSeries.map((item, index) => {
      const color = METRIC_COLORS[item.metricType] || `hsl(${index * 57}, 80%, 60%)`
      const yAxisIndex = hasDualAxis && item.metricType === 'temperature' ? 1 : 0
      return {
        name: buildSeriesLabel(item.key, item.meta),
        type: 'line' as const,
        smooth: true,
        symbol: 'none',
        yAxisIndex,
        lineStyle: { width: 2, color },
        areaStyle: { color: `${color}18` },
        data: item.points.map((point) => [point.time, point.value]),
        ...(item.metricType === 'pressure'
          ? {
              markLine: {
                silent: true,
                lineStyle: { color: '#fb923c', type: 'dashed' as const, width: 1 },
                data: [{ yAxis: 10, label: { formatter: '设计上限 10 MPa', color: '#fb923c', fontSize: 9 } }],
              },
            }
          : {}),
      }
    })

    const pressureAxis = {
      type: 'value' as const,
      name: '(MPa)',
      nameTextStyle: { color: '#64748b', fontSize: 10 },
      axisLabel: { color: '#64748b', fontSize: 10, formatter: (value: number) => value.toFixed(2) },
      splitLine: { lineStyle: { color: 'rgba(51,65,85,0.28)' } },
      axisLine: { lineStyle: { color: '#334155' } },
    }

    const tempAxis = {
      type: 'value' as const,
      name: '(°C)',
      nameTextStyle: { color: '#64748b', fontSize: 10 },
      axisLabel: { color: '#64748b', fontSize: 10, formatter: (value: number) => value.toFixed(1) },
      splitLine: { show: false },
      axisLine: { lineStyle: { color: '#334155' } },
      position: 'right' as const,
    }

    const defaultMetric = activeMetricTypes[0] || 'pressure'
    const yAxis = hasDualAxis
      ? [pressureAxis, tempAxis]
      : [defaultMetric === 'pressure' ? pressureAxis : { ...tempAxis, position: 'left' as const }]

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: 'rgba(6,10,18,0.96)',
        borderColor: 'rgba(59,130,246,0.22)',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        axisPointer: { type: 'cross' as const, lineStyle: { color: 'rgba(148,163,184,0.2)' } },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return ''
          const current = new Date(params[0].axisValue)
          let html = `<div style="font-size:10px;color:#94a3b8;margin-bottom:4px">${current.toLocaleString('zh-CN')}</div>`
          params.forEach((param) => {
            const currentSeries = visibleSeries[param.seriesIndex]
            const metricType = currentSeries?.metricType || 'pressure'
            const unit = METRIC_UNITS[metricType] || ''
            const decimals = metricType === 'pressure' ? 3 : 1
            html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;font-size:11px">
              <span style="width:8px;height:8px;border-radius:50%;background:${param.color};display:inline-block"></span>
              <span style="color:#cbd5e1">${param.seriesName}</span>
              <span style="font-weight:600;margin-left:auto;color:${param.color}">${Number(param.value[1]).toFixed(decimals)} ${unit}</span>
            </div>`
          })
          return html
        },
      },
      legend: {
        data: seriesConfig.map((series) => series.name),
        textStyle: { color: '#94a3b8', fontSize: 10 },
        top: 4,
        right: 12,
        itemWidth: 12,
        itemHeight: 3,
      },
      grid: { left: 58, right: hasDualAxis ? 58 : 18, top: 42, bottom: 52 },
      xAxis: {
        type: 'time' as const,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: {
          color: '#64748b',
          fontSize: 9,
          formatter: (value: number) => {
            const current = new Date(value)
            return `${current.getMonth() + 1}/${current.getDate()}\n${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`
          },
        },
        splitLine: { show: false },
      },
      yAxis,
      dataZoom: [
        { type: 'inside' as const, start: 0, end: 100, zoomOnMouseWheel: true },
        {
          type: 'slider' as const,
          height: 18,
          bottom: 3,
          borderColor: '#334155',
          backgroundColor: 'rgba(10,15,25,0.82)',
          fillerColor: 'rgba(59,130,246,0.16)',
          handleStyle: { color: '#38bdf8' },
          textStyle: { color: '#64748b', fontSize: 8 },
        },
      ],
      series: seriesConfig,
    }
  }, [viewMode, visibleSeries])

  const summaryItems = useMemo(() => {
    return visibleSeries.slice(0, 4).map((item) => {
      const values = item.points.map((point) => point.value)
      const latest = values[values.length - 1]
      const minimum = Math.min(...values)
      const maximum = Math.max(...values)
      const decimals = item.metricType === 'pressure' ? 3 : 1
      return {
        key: item.key,
        label: buildSeriesLabel(item.key, item.meta),
        color: METRIC_COLORS[item.metricType] || '#94a3b8',
        unit: METRIC_UNITS[item.metricType] || '',
        latest: latest.toFixed(decimals),
        min: minimum.toFixed(decimals),
        max: maximum.toFixed(decimals),
      }
    })
  }, [visibleSeries])

  return (
    <div
      className={`flex flex-col select-none overflow-hidden ${isDragging ? 'cursor-grabbing' : ''}`}
      style={{
        width: '780px',
        height: '480px',
        background: 'linear-gradient(160deg, rgba(4,8,16,0.98) 0%, rgba(8,16,28,0.98) 50%, rgba(10,21,31,0.98) 100%)',
        backdropFilter: 'blur(20px)',
        borderRadius: '16px',
        border: '1px solid rgba(56,189,248,0.18)',
        boxShadow: '0 22px 90px rgba(0,0,0,0.78), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      <div style={{ height: '3px', background: 'linear-gradient(90deg, #38bdf8, #10b981, #facc15, #38bdf8)', borderRadius: '16px 16px 0 0' }} />

      <div
        className="px-4 py-2 flex justify-between items-center shrink-0 cursor-grab active:cursor-grabbing"
        style={{ borderBottom: '1px solid rgba(56,189,248,0.12)' }}
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-2">
          <Icon name="history" size={16} color="#38bdf8" />
          <h3 className="m-0 text-sm font-bold" style={{ color: '#dbeafe' }}>
            {displayName || stationName} · 历史回溯
          </h3>
          <span
            style={{
              fontSize: '9px',
              color: '#10b981',
              background: 'rgba(16,185,129,0.12)',
              padding: '1px 6px',
              borderRadius: '8px',
              border: '1px solid rgba(16,185,129,0.28)',
            }}
          >
            时序库
          </span>
          {timeRange && (
            <span style={{ fontSize: '9px', color: '#64748b' }}>
              {new Date(timeRange.start).toLocaleDateString('zh-CN')} ~ {new Date(timeRange.end).toLocaleDateString('zh-CN')}
            </span>
          )}
          {focusHint && (
            <span
              style={{
                fontSize: '9px',
                color: '#67e8f9',
                background: 'rgba(8,145,178,0.18)',
                padding: '1px 6px',
                borderRadius: '8px',
                border: '1px solid rgba(8,145,178,0.35)',
              }}
              title={focusHint}
            >
              AI定位：{focusHint}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2" onMouseDown={(event) => event.stopPropagation()}>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10">
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      <div
        className="px-4 py-2 flex items-center gap-3 shrink-0 flex-wrap"
        style={{ borderBottom: '1px solid rgba(56,189,248,0.08)' }}
      >
        <div className="flex items-center gap-1">
          {(Object.keys(VIEW_LABELS) as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className="text-xs px-2 py-0.5 rounded transition-all"
              style={{
                background: viewMode === mode ? 'rgba(56,189,248,0.2)' : 'rgba(30,41,59,0.45)',
                color: viewMode === mode ? '#bae6fd' : '#64748b',
                border: `1px solid ${viewMode === mode ? 'rgba(56,189,248,0.4)' : 'rgba(51,65,85,0.45)'}`,
              }}
            >
              {VIEW_LABELS[mode]}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 16, background: 'rgba(51,65,85,0.8)' }} />

        <div className="flex items-center gap-1">
          {availablePipelines.map((pipelineId) => {
            const active = selectedPipelines.has(pipelineId)
            const color = METRIC_COLORS.pressure
            return (
              <button
                key={pipelineId}
                onClick={() => togglePipeline(pipelineId)}
                className="text-xs px-2 py-0.5 rounded transition-all"
                style={{
                  background: active ? `${color}18` : 'rgba(30,41,59,0.4)',
                  color: active ? '#e2e8f0' : '#475569',
                  border: `1px solid ${active ? `${color}55` : 'rgba(51,65,85,0.4)'}`,
                }}
              >
                {PIPELINE_LABELS[pipelineId] || pipelineId.toUpperCase()}
              </button>
            )
          })}
        </div>

        <div style={{ width: 1, height: 16, background: 'rgba(51,65,85,0.8)' }} />

        <div className="flex items-center gap-1">
          {TIME_RANGES.map((item) => (
            <button
              key={item.hours}
              onClick={() => setSelectedHours(item.hours)}
              className="text-xs px-2 py-0.5 rounded transition-all"
              style={{
                background: selectedHours === item.hours ? 'rgba(56,189,248,0.2)' : 'rgba(30,41,59,0.5)',
                color: selectedHours === item.hours ? '#bae6fd' : '#64748b',
                border: `1px solid ${selectedHours === item.hours ? 'rgba(56,189,248,0.36)' : 'rgba(51,65,85,0.5)'}`,
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1" style={{ fontSize: '10px', color: '#475569' }}>
          <Icon name="mouse" size={11} />
          <span>滚轮缩放</span>
        </div>
      </div>

      <div className="flex-1 px-2 pt-1 pb-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full text-sm" style={{ color: '#94a3b8' }}>
            正在读取 {displayName || stationName} 的历史曲线…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-sm" style={{ color: '#fca5a5' }}>
            {error}
          </div>
        ) : chartOption ? (
          <ReactEChartsCore
            echarts={echarts}
            option={chartOption}
            style={{ height: '100%', width: '100%' }}
            notMerge
            lazyUpdate
            theme="dark"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm" style={{ color: '#64748b' }}>
            当前站场暂无 {VIEW_LABELS[viewMode]} 数据，后面把对应指标入库就能直接看。
          </div>
        )}
      </div>

      <div
        className="px-4 py-1.5 flex items-center gap-4 shrink-0 flex-wrap"
        style={{ borderTop: '1px solid rgba(56,189,248,0.08)', fontSize: '10px' }}
      >
        {summaryItems.map((item) => (
          <div key={item.key} className="flex items-center gap-1.5">
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.color, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ color: '#64748b' }}>{item.label}:</span>
            <span style={{ color: item.color, fontWeight: 600 }}>{item.latest}</span>
            <span style={{ color: '#334155' }}>({item.min}~{item.max})</span>
            <span style={{ color: '#475569' }}>{item.unit}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default StationHistoryPanel
