import React, { useEffect, useMemo, useState, useCallback } from 'react'
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

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
])

interface HistorySeries {
  [key: string]: Array<{ time: string; value: number }>
}

interface HistorySeriesMeta {
  [key: string]: {
    label?: string
    stationName?: string
    pipelineId?: string
    metricType?: string
  }
}

interface HistoryResponse {
  station: string
  hours: number
  count: number
  series: HistorySeries
  seriesMeta?: HistorySeriesMeta
  targetType?: 'station' | 'junction' | 'unknown'
}

interface ScadaHistoryChartProps {
  stationName?: string
  junctionId?: string
  displayName?: string
  designPressure?: number
  onClose: () => void
  onMouseDown?: (e: React.MouseEvent) => void
  isDragging?: boolean
  /** 指定显示的指标类型: pressure=压力, temperature=温度 */
  metricType?: 'pressure' | 'temperature' | 'dewpoint'
  /** 指标基准值，当 API 无数据时用于生成模拟历史曲线 */
  baseValue?: number
  initialHours?: number
}

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '全部', hours: 0 },
]

const METRIC_COLORS: Record<string, string> = {
  pressure: '#ef4444',
  temperature: '#3b82f6',
  flow: '#10b981',
  dewpoint: '#f59e0b',
}

const PIPELINE_NAMES: Record<string, string> = {
  we1: '西一线',
  we2: '西二线',
  cred: '中俄线',
  pt: '平泰线',
}

const METRIC_NAMES: Record<string, string> = {
  pressure: '压力',
  temperature: '温度',
  flow: '流量',
  dewpoint: '露点',
}

/** 指标单位 */
const METRIC_UNITS: Record<string, string> = {
  pressure: 'MPa',
  temperature: '°C',
}
METRIC_UNITS.dewpoint = METRIC_UNITS.dewpoint || METRIC_UNITS.temperature

function getSeriesLabel(key: string): string {
  if (key.includes('__')) {
    const [stationName, suffix] = key.split('__')
    const metric = suffix.split('_').slice(1).join('_') || suffix
    return `${stationName} ${METRIC_NAMES[metric] || metric}`
  }

  const parts = key.split('_')
  const pipelineId = parts[0] || ''
  const metric = parts.slice(1).join('_') || ''
  return `${PIPELINE_NAMES[pipelineId] || pipelineId} ${METRIC_NAMES[metric] || metric}`
}

/**
 * 基于基准值生成模拟历史曲线数据
 * 使用正弦波叠加随机噪声，模拟真实 SCADA 采集趋势
 */
function generateSimulatedHistory(
  baseValue: number,
  hours: number,
  metricType: 'pressure' | 'temperature' | 'dewpoint'
): Array<{ time: string; value: number }> {
  const totalHours = hours === 0 ? 48 : hours
  // 每 5 分钟一个采集点
  const intervalMinutes = 5
  const totalPoints = Math.floor((totalHours * 60) / intervalMinutes)
  const now = new Date()
  const points: Array<{ time: string; value: number }> = []

  // 波动幅度：压力 ±0.15 MPa，温度 ±1.5°C
  const amplitude = metricType === 'pressure' ? 0.15 : 1.5
  // 缓慢趋势：用长周期正弦波模拟日间变化
  const trendAmplitude = metricType === 'pressure' ? 0.08 : 0.8

  for (let i = 0; i < totalPoints; i++) {
    const timeOffset = (totalPoints - 1 - i) * intervalMinutes * 60 * 1000
    const timestamp = new Date(now.getTime() - timeOffset)

    // 高频随机噪声
    const noise = (Math.random() - 0.5) * 2 * amplitude * 0.6
    // 中频正弦波（周期约 2 小时）
    const wave = Math.sin((i / totalPoints) * Math.PI * totalHours) * amplitude * 0.4
    // 低频趋势（周期约 12 小时）
    const trend = Math.sin((i / totalPoints) * Math.PI * 2) * trendAmplitude

    const value = baseValue + noise + wave + trend

    points.push({
      time: timestamp.toISOString(),
      value: Number(value.toFixed(metricType === 'pressure' ? 3 : 1)),
    })
  }

  return points
}

const ScadaHistoryChart: React.FC<ScadaHistoryChartProps> = ({
  stationName,
  junctionId,
  displayName,
  designPressure = 12.0,
  onClose,
  onMouseDown,
  isDragging,
  metricType: propMetricType,
  baseValue,
  initialHours,
}) => {
  const [selectedHours, setSelectedHours] = useState(initialHours ?? 6)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (typeof initialHours === 'number' && Number.isFinite(initialHours)) {
      setSelectedHours(initialHours)
    }
  }, [initialHours])
  // 是否使用模拟数据
  const [useSimulated, setUseSimulated] = useState(false)

  const metricLabel = propMetricType ? METRIC_NAMES[propMetricType] || propMetricType : ''
  const metricUnit = propMetricType ? METRIC_UNITS[propMetricType] || '' : ''
  const title = `${displayName || stationName || junctionId || '历史曲线'}${metricLabel ? ` · ${metricLabel}` : ''}`

  useEffect(() => {
    if (!stationName && !junctionId) return

    setLoading(true)
    setError(null)
    setUseSimulated(false)

    const query = new URLSearchParams()
    if (stationName) query.set('station_id', stationName)
    if (junctionId) query.set('junction_id', junctionId)
    query.set('hours', String(selectedHours))

    fetch(`/api/scada/history-by-id?${query.toString()}`)
      .then(async res => {
        if (!res.ok) {
          throw new Error(await res.text())
        }
        return res.json()
      })
      .then((result: HistoryResponse) => {
        // 检查 API 是否返回了有效数据
        const hasData = result.series && Object.keys(result.series).length > 0 &&
          Object.values(result.series).some(arr => arr.length > 0)

        if (hasData) {
          setData(result)
        } else {
          // API 无数据，切换到模拟模式
          setUseSimulated(true)
        }
        setLoading(false)
      })
      .catch(() => {
        // API 请求失败，也切换到模拟模式
        setUseSimulated(true)
        setLoading(false)
      })
  }, [junctionId, selectedHours, stationName])

  // 模拟数据生成
  const simulatedData = useMemo(() => {
    if (!useSimulated || baseValue == null || !propMetricType) return null

    const points = generateSimulatedHistory(baseValue, selectedHours, propMetricType)
    const seriesKey = `simulated_${propMetricType}`

    return {
      series: { [seriesKey]: points },
      seriesMeta: {
        [seriesKey]: {
          label: `${stationName || ''} ${METRIC_NAMES[propMetricType]}`,
          metricType: propMetricType,
        }
      }
    }
  }, [useSimulated, baseValue, propMetricType, selectedHours, stationName])

  // 滚轮调整时间量程
  const handleWheel = useCallback((e: React.WheelEvent) => {
    // 仅在图表区域外触发量程切换（图表内部由 ECharts dataZoom 处理）
    // 通过 Ctrl+滚轮 来切换预设时间量程
    if (!e.ctrlKey) return

    e.preventDefault()
    const currentIdx = TIME_RANGES.findIndex(r => r.hours === selectedHours)
    if (e.deltaY < 0 && currentIdx > 0) {
      // 向上滚 → 缩小时间范围
      setSelectedHours(TIME_RANGES[currentIdx - 1].hours)
    } else if (e.deltaY > 0 && currentIdx < TIME_RANGES.length - 1) {
      // 向下滚 → 扩大时间范围
      setSelectedHours(TIME_RANGES[currentIdx + 1].hours)
    }
  }, [selectedHours])

  const chartOption = useMemo(() => {
    // 合并 API 数据和模拟数据
    const effectiveData = useSimulated && simulatedData
      ? simulatedData
      : data

    if (!effectiveData || !effectiveData.series || Object.keys(effectiveData.series).length === 0) {
      return null
    }

    const seriesEntriesRaw = Object.entries(effectiveData.series) as Array<[string, Array<{ time: string; value: number }>]>
    const meta = effectiveData.seriesMeta || (data?.seriesMeta)
    const seriesEntries = propMetricType
      ? seriesEntriesRaw.filter(([key]) => {
          const seriesMeta = meta?.[key]
          if (seriesMeta?.metricType) {
            return seriesMeta.metricType === propMetricType
          }
          return key.includes(`_${propMetricType}`)
        })
      : seriesEntriesRaw

    const seriesConfig = seriesEntries.map(([key, points], index) => {
      const seriesMeta = meta?.[key]
      const metricType = seriesMeta?.metricType || propMetricType || key.split('_').slice(1).join('_')
      const color = METRIC_COLORS[metricType] || `hsl(${index * 60}, 70%, 55%)`

      return {
        name: seriesMeta?.label || getSeriesLabel(key),
        type: 'line' as const,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color },
        areaStyle: { color: `${color}15` },
        data: points.map(point => [point.time, point.value]),
        ...(metricType === 'pressure'
          ? {
              markLine: {
                silent: true,
                lineStyle: { color: '#f97316', type: 'dashed' as const, width: 1.5 },
                data: [
                  {
                    yAxis: designPressure,
                    label: {
                      formatter: `设计上限 ${designPressure} MPa`,
                      color: '#f97316',
                      fontSize: 10,
                    },
                  },
                ],
              },
            }
          : {}),
      }
    })

    const unit = propMetricType ? METRIC_UNITS[propMetricType] : ''

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: propMetricType === 'temperature'
          ? 'rgba(59, 130, 246, 0.3)'
          : propMetricType === 'dewpoint'
            ? 'rgba(245, 158, 11, 0.35)'
            : 'rgba(239, 68, 68, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        axisPointer: { type: 'cross' as const, lineStyle: { color: 'rgba(148, 163, 184, 0.3)' } },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return ''
          const time = new Date(params[0].axisValue).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          })
          let html = `<div style="font-size:11px;color:#94a3b8;margin-bottom:4px">${time}</div>`
          for (const p of params) {
            html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">
              <span style="width:8px;height:8px;border-radius:50%;background:${p.color};display:inline-block"></span>
              <span>${p.seriesName}</span>
              <span style="font-weight:600;margin-left:auto">${Number(p.value[1]).toFixed(propMetricType === 'pressure' ? 3 : 1)} ${unit}</span>
            </div>`
          }
          return html
        },
      },
      legend: {
        data: seriesConfig.map(item => item.name),
        textStyle: { color: '#94a3b8', fontSize: 11 },
        top: 5,
        right: 10,
      },
      grid: { left: 55, right: 20, top: 40, bottom: 55 },
      xAxis: {
        type: 'time' as const,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: {
          color: '#64748b',
          fontSize: 10,
          formatter: (value: number) => {
            const d = new Date(value)
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          },
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        name: unit ? `(${unit})` : '',
        nameTextStyle: { color: '#64748b', fontSize: 10, padding: [0, 0, 0, -30] },
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: {
          color: '#64748b',
          fontSize: 10,
          formatter: (v: number) => propMetricType === 'pressure' ? v.toFixed(2) : v.toFixed(1),
        },
        splitLine: { lineStyle: { color: 'rgba(51, 65, 85, 0.3)' } },
      },
      dataZoom: [
        {
          type: 'inside' as const,
          start: 0,
          end: 100,
          // 鼠标滚轮缩放
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
        },
        {
          type: 'slider' as const,
          height: 18,
          bottom: 5,
          borderColor: '#334155',
          backgroundColor: 'rgba(15, 23, 42, 0.8)',
          fillerColor: propMetricType === 'temperature'
            ? 'rgba(59, 130, 246, 0.2)'
            : propMetricType === 'dewpoint'
              ? 'rgba(245, 158, 11, 0.2)'
              : 'rgba(239, 68, 68, 0.2)',
          handleStyle: {
            color: propMetricType === 'temperature'
              ? '#3b82f6'
              : propMetricType === 'dewpoint'
                ? '#f59e0b'
                : '#ef4444',
          },
          textStyle: { color: '#64748b', fontSize: 9 },
        },
      ],
      series: seriesConfig,
    }
  }, [data, designPressure, useSimulated, simulatedData, propMetricType])

  // 指标对应的主题色
  const themeColor = propMetricType === 'temperature'
    ? '#3b82f6'
    : propMetricType === 'dewpoint'
      ? '#f59e0b'
      : '#ef4444'
  const themeColorLight = propMetricType === 'temperature'
    ? '#93c5fd'
    : propMetricType === 'dewpoint'
      ? '#fcd34d'
      : '#fca5a5'

  return (
    <div
      className={`flex flex-col select-none overflow-hidden ${isDragging ? 'cursor-grabbing' : ''}`}
      style={{
        width: '620px',
        height: '420px',
        background: 'linear-gradient(180deg, rgba(5,10,18,0.97) 0%, rgba(8,12,20,0.97) 100%)',
        backdropFilter: 'blur(16px)',
        borderRadius: '12px',
        border: `1px solid ${themeColor}33`,
        boxShadow: '0 16px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
      onWheel={handleWheel}
    >
      <div style={{ height: '3px', background: `linear-gradient(90deg, ${themeColor}, ${themeColorLight}, ${themeColor})`, borderRadius: '12px 12px 0 0' }} />

      <div
        className="px-4 py-2 flex justify-between items-center shrink-0 cursor-grab active:cursor-grabbing"
        style={{ borderBottom: `1px solid ${themeColor}1a` }}
        onMouseDown={onMouseDown}
      >
        <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: themeColorLight }}>
          <span className="material-symbols-outlined text-lg" style={{ color: themeColor }}>show_chart</span>
          <span>{title}</span>
          {useSimulated && (
            <span style={{
              fontSize: '9px', color: '#f59e0b', background: 'rgba(245,158,11,0.15)',
              padding: '1px 5px', borderRadius: '8px', border: '1px solid rgba(245,158,11,0.3)',
            }}>模拟数据</span>
          )}
        </h3>
        <div className="flex items-center gap-2" onMouseDown={event => event.stopPropagation()}>
          {TIME_RANGES.map(item => (
            <button
              key={item.hours}
              onClick={() => setSelectedHours(item.hours)}
              className="text-xs px-2 py-0.5 rounded transition-colors"
              style={{
                background: selectedHours === item.hours ? themeColor : 'rgba(51, 65, 85, 0.5)',
                color: selectedHours === item.hours ? '#fff' : '#94a3b8',
                border: `1px solid ${selectedHours === item.hours ? themeColor : 'rgba(71, 85, 105, 0.5)'}`,
              }}
            >
              {item.label}
            </button>
          ))}
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10 ml-1" title="关闭">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      </div>

      {/* 滚轮提示 */}
      <div className="px-4 pt-1 flex items-center gap-2" style={{ fontSize: '10px', color: '#475569' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>mouse</span>
        <span>滚轮缩放时间 | Ctrl+滚轮切换时间量程</span>
      </div>

      <div className="flex-1 px-2 py-1 overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <span className="text-gray-400 text-sm animate-pulse">加载历史数据中...</span>
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full">
            <span className="text-red-400 text-sm">{error}</span>
          </div>
        )}
        {!loading && !error && !chartOption && !useSimulated && (
          <div className="flex items-center justify-center h-full flex-col gap-2">
            <span className="material-symbols-outlined text-4xl text-gray-600">timeline</span>
            <span className="text-gray-500 text-sm">暂无历史数据</span>
            <span className="text-gray-600 text-xs">请先导入或生成 SCADA 历史时序数据</span>
          </div>
        )}
        {!loading && !error && chartOption && (
          <ReactEChartsCore
            echarts={echarts}
            option={chartOption}
            style={{ height: '100%', width: '100%' }}
            notMerge
            lazyUpdate
            theme="dark"
          />
        )}
      </div>
    </div>
  )
}

export default ScadaHistoryChart
