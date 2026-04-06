/**
 * 甪直分输站 · 真实历史数据服务
 * 数据来源：甪直站20262311-0312.xlsx（2026-03-11 ~ 2026-03-12）
 * 包含：西一线/西二线/中俄线 的压力、温度，以及西二线/中俄线水露点
 */
import rawData from './luzhi_history.json'

// JSON 中每条记录的格式
interface RawPoint {
  ts: string  // "2026-03-12 08:00"
  v: number
}

// 统一的时序数据点格式（echarts 需要 ISO 时间字符串）
export interface TimeSeriesPoint {
  time: string   // ISO 8601 格式，如 "2026-03-12T08:00:00"
  value: number
}

// 指标元数据
export interface MetricMeta {
  key: string
  label: string
  unit: string
  type: 'pressure' | 'temperature' | 'dewpoint'
  color: string
  pipeline: string
}

// 甪直站全量指标定义
export const LUZHI_METRICS: MetricMeta[] = [
  { key: '西一线压力', label: '西一线 进站压力', unit: 'MPa', type: 'pressure',    color: '#ef4444', pipeline: '西一线' },
  { key: '西一线温度', label: '西一线 进站温度', unit: '°C',  type: 'temperature', color: '#f97316', pipeline: '西一线' },
  { key: '西二线压力', label: '西二线 进站压力', unit: 'MPa', type: 'pressure',    color: '#3b82f6', pipeline: '西二线' },
  { key: '西二线温度', label: '西二线 进站温度', unit: '°C',  type: 'temperature', color: '#06b6d4', pipeline: '西二线' },
  { key: '中俄线压力', label: '中俄线 进站压力', unit: 'MPa', type: 'pressure',    color: '#10b981', pipeline: '中俄线' },
  { key: '中俄线温度', label: '中俄线 进站温度', unit: '°C',  type: 'temperature', color: '#84cc16', pipeline: '中俄线' },
  { key: '二线水露点', label: '西二线 水露点',   unit: '°C',  type: 'dewpoint',   color: '#a78bfa', pipeline: '西二线' },
  { key: '中俄水露点', label: '中俄线 水露点',   unit: '°C',  type: 'dewpoint',   color: '#f59e0b', pipeline: '中俄线' },
]

/**
 * 将原始时间字符串转换为 ISO 8601 格式
 * "2026-03-12 08:00" → "2026-03-12T08:00:00"
 */
function toISOTime(ts: string): string {
  return ts.replace(' ', 'T') + ':00'
}

/**
 * 获取指标的所有时序数据（已排好序，从旧到新）
 */
export function getLuzhiSeries(metricKey: string): TimeSeriesPoint[] {
  const raw = (rawData as Record<string, RawPoint[]>)[metricKey]
  if (!raw) return []
  // 原始数据从新到旧，反转为从旧到新
  return [...raw].reverse().map(p => ({
    time: toISOTime(p.ts),
    value: p.v,
  }))
}

/**
 * 按时间范围过滤（hours=0 表示全部）
 */
export function getLuzhiSeriesByHours(metricKey: string, hours: number): TimeSeriesPoint[] {
  const all = getLuzhiSeries(metricKey)
  if (hours === 0 || all.length === 0) return all

  const latestTime = new Date(all[all.length - 1].time).getTime()
  const cutoff = latestTime - hours * 3600 * 1000
  return all.filter(p => new Date(p.time).getTime() >= cutoff)
}

/**
 * 获取数据时间范围
 */
export function getLuzhiTimeRange(): { start: string; end: string } | null {
  const series = getLuzhiSeries('西一线压力')
  if (series.length === 0) return null
  return {
    start: series[0].time,
    end: series[series.length - 1].time,
  }
}

/**
 * 按类型获取指标列表
 */
export function getMetricsByType(type: 'pressure' | 'temperature' | 'dewpoint'): MetricMeta[] {
  return LUZHI_METRICS.filter(m => m.type === type)
}

/**
 * 获取某条管线的所有指标
 */
export function getMetricsByPipeline(pipeline: string): MetricMeta[] {
  return LUZHI_METRICS.filter(m => m.pipeline === pipeline)
}
