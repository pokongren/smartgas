/**
 * SCADA 历史曲线面板组件
 * 
 * 从后端 /api/scada/history-by-id 获取时序数据，
 * 使用 ECharts 渲染多指标折线图（压力/温度）。
 * 支持时间范围选择和联动捏合状态（枢纽模式显示多线对比）。
 */
import React, { useState, useEffect, useRef, useMemo } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

// 注册 ECharts 模块
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

interface HistoryResponse {
  station: string
  hours: number
  count: number
  series: HistorySeries
}

interface ScadaHistoryChartProps {
  /** 站场名称 */
  stationName: string
  /** 设计压力上限（用于绘制超标参考线） */
  designPressure?: number
  /** 关闭回调 */
  onClose: () => void
  /** 拖拽开始回调（可选，用于父组件管理拖拽） */
  onMouseDown?: (e: React.MouseEvent) => void
  /** 是否正在拖拽 */
  isDragging?: boolean
}

// 时间范围选项
const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '全部', hours: 0 },
]

// 指标颜色映射
const METRIC_COLORS: Record<string, string> = {
  pressure: '#ef4444',    // 红色 - 压力
  temperature: '#3b82f6', // 蓝色 - 温度
  flow: '#10b981',        // 绿色 - 流量
  dewpoint: '#f59e0b',    // 琥珀色 - 露点
}

// 从 series key 中提取可读标签
const getSeriesLabel = (key: string): string => {
  const parts = key.split('_')
  const pipelineId = parts[0] || ''
  const metric = parts.slice(1).join('_') || ''
  
  const pipelineNames: Record<string, string> = {
    we1: '西一线', we2: '西二线', cred: '中俄线', pt: '平泰线',
  }
  const metricNames: Record<string, string> = {
    pressure: '压力', temperature: '温度', flow: '流量', dewpoint: '露点',
  }
  
  return `${pipelineNames[pipelineId] || pipelineId} ${metricNames[metric] || metric}`
}

const getMetricUnit = (key: string): string => {
  if (key.includes('pressure')) return 'MPa'
  if (key.includes('temperature')) return '°C'
  if (key.includes('flow')) return '万m³/d'
  return ''
}

const ScadaHistoryChart: React.FC<ScadaHistoryChartProps> = ({
  stationName,
  designPressure = 12.0,
  onClose,
  onMouseDown,
  isDragging,
}) => {
  const [selectedHours, setSelectedHours] = useState(6)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 获取历史数据
  useEffect(() => {
    if (!stationName) return

    setLoading(true)
    setError(null)

    const url = `/api/scada/history-by-id?station_id=${encodeURIComponent(stationName)}&hours=${selectedHours}`
    
    fetch(url)
      .then(res => res.json())
      .then((result: HistoryResponse) => {
        setData(result)
        setLoading(false)
      })
      .catch(err => {
        setError(`获取数据失败: ${err.message}`)
        setLoading(false)
      })
  }, [stationName, selectedHours])

  // 构建 ECharts 配置
  const chartOption = useMemo(() => {
    if (!data || !data.series || Object.keys(data.series).length === 0) {
      return null
    }

    const seriesEntries: [string, Array<{ time: string; value: number }>][] = Object.entries(data.series) as any
    const seriesConfig = seriesEntries.map(([key, points], idx) => {
      const metricType = key.split('_').slice(1).join('_')
      const color = METRIC_COLORS[metricType] || `hsl(${idx * 60}, 70%, 55%)`
      
      return {
        name: getSeriesLabel(key),
        type: 'line' as const,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color },
        areaStyle: { color: `${color}15` },
        data: points.map((p: { time: string; value: number }) => [p.time, p.value]),
        // 为压力指标添加超标线
        ...(metricType === 'pressure' ? {
          markLine: {
            silent: true,
            lineStyle: { color: '#f97316', type: 'dashed' as const, width: 1.5 },
            data: [{ yAxis: designPressure, label: { formatter: `设计上限 ${designPressure} MPa`, color: '#f97316', fontSize: 10 } }],
          },
        } : {}),
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
        data: seriesConfig.map(s => s.name),
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
      {/* 顶部装饰条 */}
      <div style={{ height: '3px', background: 'linear-gradient(90deg, #3b82f6, #60a5fa, #2563eb, #3b82f6)', borderRadius: '12px 12px 0 0' }} />
      
      {/* 头部 */}
      <div
        className="px-4 py-2 flex justify-between items-center shrink-0 cursor-grab active:cursor-grabbing"
        style={{ borderBottom: '1px solid rgba(59, 130, 246, 0.1)' }}
        onMouseDown={onMouseDown}
      >
        <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: '#93c5fd' }}>
          <span className="material-symbols-outlined text-lg" style={{ color: '#3b82f6' }}>show_chart</span>
          <span>{stationName} · 历史曲线</span>
        </h3>
        <div className="flex items-center gap-2" onMouseDown={e => e.stopPropagation()}>
          {/* 时间范围选择器 */}
          {TIME_RANGES.map(tr => (
            <button
              key={tr.hours}
              onClick={() => setSelectedHours(tr.hours)}
              className="text-xs px-2 py-0.5 rounded transition-colors"
              style={{
                background: selectedHours === tr.hours ? '#3b82f6' : 'rgba(51, 65, 85, 0.5)',
                color: selectedHours === tr.hours ? '#fff' : '#94a3b8',
                border: `1px solid ${selectedHours === tr.hours ? '#3b82f6' : 'rgba(71, 85, 105, 0.5)'}`,
              }}
            >
              {tr.label}
            </button>
          ))}
          {/* 关闭按钮 */}
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10 ml-1" title="关闭">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      </div>

      {/* 图表区域 */}
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
            <span className="text-gray-600 text-xs">请先通过后端导入 SCADA 历史时序数据</span>
          </div>
        )}
        {!loading && !error && chartOption && (
          <ReactEChartsCore
            echarts={echarts}
            option={chartOption}
            style={{ height: '100%', width: '100%' }}
            notMerge={true}
            lazyUpdate={true}
            theme="dark"
          />
        )}
      </div>
    </div>
  )
}

export default ScadaHistoryChart
