/**
 * 甪直分输站 · 历史数据展示面板（试点）
 * 数据来源：真实 SCADA 历史文件（2026-03-11 ~ 2026-03-12）
 */
import React, { useMemo, useState, useCallback, useEffect } from 'react'
import Icon from '@/components/ui/Icon'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  MarkLineComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import {
  LUZHI_METRICS,
  getLuzhiSeriesByHours,
  getLuzhiTimeRange,
  type MetricMeta,
} from '@/data/luzhiHistoryData'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, CanvasRenderer])

interface Props {
  onClose: () => void
  onMouseDown?: (e: React.MouseEvent) => void
  isDragging?: boolean
  initialHours?: 0 | 6 | 12
  initialViewMode?: ViewMode
  focusHint?: string
}

const TIME_RANGES = [
  { label: '6h',  hours: 6  },
  { label: '12h', hours: 12 },
  { label: '全部', hours: 0  },
]

// 面板视图模式
type ViewMode = 'pressure' | 'temperature' | 'dewpoint' | 'overview'

const VIEW_LABELS: Record<ViewMode, string> = {
  overview:    '综合概览',
  pressure:    '压力曲线',
  temperature: '温度曲线',
  dewpoint:    '水露点',
}

const LuzhiHistoryPanel: React.FC<Props> = ({
  onClose,
  onMouseDown,
  isDragging,
  initialHours = 0,
  initialViewMode = 'pressure',
  focusHint,
}) => {
  const [selectedHours, setSelectedHours] = useState(initialHours)
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode)
  const [selectedPipelines, setSelectedPipelines] = useState<Set<string>>(
    new Set(['西一线', '西二线', '中俄线'])
  )

  useEffect(() => {
    setSelectedHours(initialHours)
  }, [initialHours])

  useEffect(() => {
    setViewMode(initialViewMode)
  }, [initialViewMode])

  const timeRange = getLuzhiTimeRange()

  // 根据视图模式确定显示哪些指标
  const visibleMetrics = useMemo<MetricMeta[]>(() => {
    let metrics: MetricMeta[]
    if (viewMode === 'overview') {
      // 综合：每条管线各取压力+温度
      metrics = LUZHI_METRICS.filter(m => m.type === 'pressure' || m.type === 'temperature')
    } else {
      metrics = LUZHI_METRICS.filter(m => m.type === viewMode)
    }
    return metrics.filter(m => selectedPipelines.has(m.pipeline))
  }, [viewMode, selectedPipelines])

  const togglePipeline = useCallback((pipeline: string) => {
    setSelectedPipelines(prev => {
      const next = new Set(prev)
      if (next.has(pipeline)) {
        if (next.size > 1) next.delete(pipeline) // 至少保留一条
      } else {
        next.add(pipeline)
      }
      return next
    })
  }, [])

  // 构建 ECharts 配置
  const chartOption = useMemo(() => {
    if (visibleMetrics.length === 0) return null

    // 判断是否多 Y 轴（综合模式下压力+温度单位不同）
    const hasMultiUnit = viewMode === 'overview'
    const isPressure = viewMode === 'pressure'
    const isTemp = viewMode === 'temperature' || viewMode === 'dewpoint'

    const seriesConfig = visibleMetrics.map((meta, idx) => {
      const points = getLuzhiSeriesByHours(meta.key, selectedHours)
      const yAxisIndex = hasMultiUnit && meta.type === 'temperature' ? 1 : 0

      return {
        name: meta.label,
        type: 'line' as const,
        smooth: true,
        symbol: 'none',
        yAxisIndex,
        lineStyle: { width: 2, color: meta.color },
        areaStyle: { color: `${meta.color}12` },
        data: points.map(p => [p.time, p.value]),
        // 压力曲线加设计压力上限线 (10 MPa)
        ...(meta.type === 'pressure' ? {
          markLine: {
            silent: true,
            lineStyle: { color: '#f97316', type: 'dashed' as const, width: 1 },
            data: [{ yAxis: 10, label: { formatter: '设计上限 10 MPa', color: '#f97316', fontSize: 9 } }],
          }
        } : {}),
      } satisfies object
    })

    // Y 轴配置
    const yAxisPressure = {
      type: 'value' as const,
      name: '(MPa)',
      nameTextStyle: { color: '#64748b', fontSize: 10 },
      axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => v.toFixed(2) },
      splitLine: { lineStyle: { color: 'rgba(51,65,85,0.3)' } },
      axisLine: { lineStyle: { color: '#334155' } },
    }
    const yAxisTemp = {
      type: 'value' as const,
      name: '(°C)',
      nameTextStyle: { color: '#64748b', fontSize: 10 },
      axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => v.toFixed(1) },
      splitLine: { show: false },
      axisLine: { lineStyle: { color: '#334155' } },
      position: 'right' as const,
    }

    const yAxis = hasMultiUnit
      ? [yAxisPressure, yAxisTemp]
      : [isPressure || viewMode === 'overview'
        ? yAxisPressure
        : { ...yAxisTemp, position: 'left' as const }]

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: 'rgba(10,15,25,0.97)',
        borderColor: 'rgba(59,130,246,0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        axisPointer: { type: 'cross' as const, lineStyle: { color: 'rgba(148,163,184,0.25)' } },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return ''
          const d = new Date(params[0].axisValue)
          const timeStr = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
          let html = `<div style="font-size:10px;color:#94a3b8;margin-bottom:4px">${timeStr}</div>`
          for (const p of params) {
            const meta = visibleMetrics[p.seriesIndex]
            const unit = meta?.unit || ''
            const decimals = meta?.type === 'pressure' ? 3 : 1
            html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;font-size:11px">
              <span style="width:8px;height:8px;border-radius:50%;background:${p.color};display:inline-block;;flex-shrink:0"></span>
              <span style="color:#cbd5e1">${p.seriesName}</span>
              <span style="font-weight:600;margin-left:auto;color:${p.color}">${Number(p.value[1]).toFixed(decimals)} ${unit}</span>
            </div>`
          }
          return html
        },
      },
      legend: {
        data: seriesConfig.map(s => s.name),
        textStyle: { color: '#94a3b8', fontSize: 10 },
        top: 5,
        right: 10,
        itemWidth: 12,
        itemHeight: 3,
      },
      grid: { left: 58, right: hasMultiUnit ? 58 : 16, top: 40, bottom: 52 },
      xAxis: {
        type: 'time' as const,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: {
          color: '#64748b', fontSize: 9,
          formatter: (val: number) => {
            const d = new Date(val)
            return `${d.getMonth()+1}/${d.getDate()}\n${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
          },
        },
        splitLine: { show: false },
      },
      yAxis,
      dataZoom: [
        { type: 'inside' as const, start: 0, end: 100, zoomOnMouseWheel: true },
        {
          type: 'slider' as const, height: 18, bottom: 3,
          borderColor: '#334155',
          backgroundColor: 'rgba(10,15,25,0.8)',
          fillerColor: 'rgba(59,130,246,0.15)',
          handleStyle: { color: '#3b82f6' },
          textStyle: { color: '#64748b', fontSize: 8 },
        },
      ],
      series: seriesConfig,
    }
  }, [visibleMetrics, selectedHours, viewMode])

  return (
    <div
      className={`flex flex-col select-none overflow-hidden ${isDragging ? 'cursor-grabbing' : ''}`}
      style={{
        width: '780px',
        height: '480px',
        background: 'linear-gradient(160deg, rgba(5,10,22,0.98) 0%, rgba(8,18,30,0.98) 100%)',
        backdropFilter: 'blur(20px)',
        borderRadius: '14px',
        border: '1px solid rgba(59,130,246,0.2)',
        boxShadow: '0 20px 80px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      {/* 顶部渐变装饰条 */}
      <div style={{ height: '3px', background: 'linear-gradient(90deg, #3b82f6, #06b6d4, #10b981, #3b82f6)', borderRadius: '14px 14px 0 0' }} />

      {/* 标题栏 */}
      <div
        className="px-4 py-2 flex justify-between items-center shrink-0 cursor-grab active:cursor-grabbing"
        style={{ borderBottom: '1px solid rgba(59,130,246,0.12)' }}
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-2">
          <Icon name="history" size={16} color="#3b82f6" />
          <h3 className="m-0 text-sm font-bold" style={{ color: '#bfdbfe' }}>
            甪直分输站 · 历史回溯
          </h3>
          {/* 真实数据标签 */}
          <span style={{
            fontSize: '9px', color: '#10b981', background: 'rgba(16,185,129,0.12)',
            padding: '1px 6px', borderRadius: '8px', border: '1px solid rgba(16,185,129,0.3)',
          }}>
            ✓ 真实数据
          </span>
          {timeRange && (
            <span style={{ fontSize: '9px', color: '#475569' }}>
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
        <div className="flex items-center gap-2" onMouseDown={e => e.stopPropagation()}>
          {/* 关闭 */}
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10">
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      {/* 工具栏：视图模式 + 管线筛选 + 时间量程 */}
      <div
        className="px-4 py-2 flex items-center gap-3 shrink-0 flex-wrap"
        style={{ borderBottom: '1px solid rgba(59,130,246,0.08)' }}
      >
        {/* 视图模式切换 */}
        <div className="flex items-center gap-1">
          {(Object.keys(VIEW_LABELS) as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className="text-xs px-2 py-0.5 rounded transition-all"
              style={{
                background: viewMode === mode ? 'rgba(59,130,246,0.25)' : 'rgba(30,41,59,0.5)',
                color: viewMode === mode ? '#93c5fd' : '#64748b',
                border: `1px solid ${viewMode === mode ? 'rgba(59,130,246,0.4)' : 'rgba(51,65,85,0.5)'}`,
              }}
            >
              {VIEW_LABELS[mode]}
            </button>
          ))}
        </div>

        {/* 分隔线 */}
        <div style={{ width: 1, height: 16, background: 'rgba(51,65,85,0.8)' }} />

        {/* 管线筛选 */}
        <div className="flex items-center gap-1">
          {['西一线', '西二线', '中俄线'].map(pl => {
            const colorMap: Record<string, string> = { '西一线': '#ef4444', '西二线': '#3b82f6', '中俄线': '#10b981' }
            const active = selectedPipelines.has(pl)
            return (
              <button
                key={pl}
                onClick={() => togglePipeline(pl)}
                className="text-xs px-2 py-0.5 rounded transition-all"
                style={{
                  background: active ? `${colorMap[pl]}22` : 'rgba(30,41,59,0.4)',
                  color: active ? colorMap[pl] : '#475569',
                  border: `1px solid ${active ? `${colorMap[pl]}55` : 'rgba(51,65,85,0.4)'}`,
                }}
              >
                {pl}
              </button>
            )
          })}
        </div>

        {/* 分隔线 */}
        <div style={{ width: 1, height: 16, background: 'rgba(51,65,85,0.8)' }} />

        {/* 时间量程 */}
        <div className="flex items-center gap-1">
          {TIME_RANGES.map(r => (
            <button
              key={r.hours}
              onClick={() => setSelectedHours(r.hours)}
              className="text-xs px-2 py-0.5 rounded transition-all"
              style={{
                background: selectedHours === r.hours ? 'rgba(59,130,246,0.2)' : 'rgba(30,41,59,0.5)',
                color: selectedHours === r.hours ? '#93c5fd' : '#64748b',
                border: `1px solid ${selectedHours === r.hours ? 'rgba(59,130,246,0.35)' : 'rgba(51,65,85,0.5)'}`,
              }}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* 指标徽章 */}
        <div className="ml-auto flex items-center gap-1" style={{ fontSize: '10px', color: '#475569' }}>
          <Icon name="mouse" size={11} />
          <span>滚轮缩放</span>
        </div>
      </div>

      {/* 图表区 */}
      <div className="flex-1 px-2 pt-1 pb-0 overflow-hidden">
        {chartOption ? (
          <ReactEChartsCore
            echarts={echarts}
            option={chartOption}
            style={{ height: '100%', width: '100%' }}
            notMerge
            lazyUpdate
            theme="dark"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="text-gray-500 text-sm">请选择至少一条管线</span>
          </div>
        )}
      </div>

      {/* 底部数据摘要 */}
      <div
        className="px-4 py-1.5 flex items-center gap-4 shrink-0 flex-wrap"
        style={{ borderTop: '1px solid rgba(59,130,246,0.08)', fontSize: '10px' }}
      >
        {visibleMetrics.slice(0, 4).map(meta => {
          const points = getLuzhiSeriesByHours(meta.key, selectedHours)
          if (points.length === 0) return null
          const latest = points[points.length - 1].value
          const min = Math.min(...points.map(p => p.value))
          const max = Math.max(...points.map(p => p.value))
          const decimals = meta.type === 'pressure' ? 3 : 1
          return (
            <div key={meta.key} className="flex items-center gap-1.5">
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, display: 'inline-block', flexShrink: 0 }} />
              <span style={{ color: '#64748b' }}>{meta.label}:</span>
              <span style={{ color: meta.color, fontWeight: 600 }}>{latest.toFixed(decimals)}</span>
              <span style={{ color: '#334155' }}>({min.toFixed(decimals)}~{max.toFixed(decimals)})</span>
              <span style={{ color: '#475569' }}>{meta.unit}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default LuzhiHistoryPanel
