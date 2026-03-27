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

const ScadaHistoryChart: React.FC<ScadaHistoryChartProps> = ({
  stationName,
  junctionId,
  displayName,
  designPressure = 12.0,
  onClose,
  onMouseDown,
  isDragging,
}) => {
  const [selectedHours, setSelectedHours] = useState(6)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const title = displayName || stationName || junctionId || '历史曲线'

  useEffect(() => {
    if (!stationName && !junctionId) return

    setLoading(true)
    setError(null)

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
        setData(result)
        setLoading(false)
      })
      .catch(err => {
        setError(`获取数据失败: ${err.message}`)
        setLoading(false)
      })
  }, [junctionId, selectedHours, stationName])

  const chartOption = useMemo(() => {
    if (!data || !data.series || Object.keys(data.series).length === 0) {
      return null
    }

    const seriesEntries = Object.entries(data.series) as Array<[string, Array<{ time: string; value: number }>]>
    const seriesConfig = seriesEntries.map(([key, points], index) => {
      const meta = data.seriesMeta?.[key]
      const metricType = meta?.metricType || key.split('_').slice(1).join('_')
      const color = METRIC_COLORS[metricType] || `hsl(${index * 60}, 70%, 55%)`

      return {
        name: meta?.label || getSeriesLabel(key),
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

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: 'rgba(59, 130, 246, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        axisPointer: { type: 'cross' as const, lineStyle: { color: 'rgba(148, 163, 184, 0.3)' } },
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
        axisLabel: { color: '#64748b', fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(51, 65, 85, 0.3)' } },
      },
      dataZoom: [
        { type: 'inside' as const, start: 0, end: 100 },
        {
          type: 'slider' as const,
          height: 18,
          bottom: 5,
          borderColor: '#334155',
          backgroundColor: 'rgba(15, 23, 42, 0.8)',
          fillerColor: 'rgba(59, 130, 246, 0.2)',
          handleStyle: { color: '#3b82f6' },
          textStyle: { color: '#64748b', fontSize: 9 },
        },
      ],
      series: seriesConfig,
    }
  }, [data, designPressure])

  return (
    <div
      className={`flex flex-col select-none overflow-hidden ${isDragging ? 'cursor-grabbing' : ''}`}
      style={{
        width: '600px',
        height: '400px',
        background: 'linear-gradient(180deg, rgba(5,10,18,0.97) 0%, rgba(8,12,20,0.97) 100%)',
        backdropFilter: 'blur(16px)',
        borderRadius: '12px',
        border: '1px solid rgba(59, 130, 246, 0.2)',
        boxShadow: '0 16px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      <div style={{ height: '3px', background: 'linear-gradient(90deg, #3b82f6, #60a5fa, #2563eb, #3b82f6)', borderRadius: '12px 12px 0 0' }} />

      <div
        className="px-4 py-2 flex justify-between items-center shrink-0 cursor-grab active:cursor-grabbing"
        style={{ borderBottom: '1px solid rgba(59, 130, 246, 0.1)' }}
        onMouseDown={onMouseDown}
      >
        <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: '#93c5fd' }}>
          <span className="material-symbols-outlined text-lg" style={{ color: '#3b82f6' }}>show_chart</span>
          <span>{title} · 历史曲线</span>
        </h3>
        <div className="flex items-center gap-2" onMouseDown={event => event.stopPropagation()}>
          {TIME_RANGES.map(item => (
            <button
              key={item.hours}
              onClick={() => setSelectedHours(item.hours)}
              className="text-xs px-2 py-0.5 rounded transition-colors"
              style={{
                background: selectedHours === item.hours ? '#3b82f6' : 'rgba(51, 65, 85, 0.5)',
                color: selectedHours === item.hours ? '#fff' : '#94a3b8',
                border: `1px solid ${selectedHours === item.hours ? '#3b82f6' : 'rgba(71, 85, 105, 0.5)'}`,
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
        {!loading && !error && !chartOption && (
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
