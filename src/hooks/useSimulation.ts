/**
 * useSimulation Hook
 *
 * 管理稳态仿真状态：选场景、调接口、缓存结果。
 * 阶段二先用 Mock 数据，联调时把 USE_MOCK 改成 false 就切真实接口。
 */

import { useState, useCallback, useRef } from 'react'
import type { SimulationOverlay, ScenarioOption } from '@/types/simulation'
import { MAINLINE_SCENARIOS } from '@/types/simulation'

const API_BASE = '/api'
const USE_MOCK = false  // 改成 false 切真实接口

// ─────────────────────────────────────────────────────────────
// Mock 数据（与真实接口格式完全一致）
// ─────────────────────────────────────────────────────────────
function buildMockOverlay(pilotId: string, scenarioId: string): SimulationOverlay {
  const isFailure = scenarioId.includes('offline') || scenarioId.includes('break')
  const isLimited = scenarioId.includes('limited')

  // 主样板节点
  const baseNodes = [
    { id: 'WE1-67', label: '古浪压气站', pressure: 9.85, role: 'source' },
    { id: 'WE1-76', label: '中卫压气站', pressure: isFailure ? 7.2 : 9.55, role: 'transit' },
    { id: 'WE1-86', label: '西一盐池压气站', pressure: isFailure ? 5.8 : 9.35, role: 'transit' },
    { id: 'WE1-92', label: '西一靖边压气站', pressure: isFailure ? 4.1 : 9.15, role: 'transit' },
  ]

  const nodes = baseNodes.map(n => ({
    id: n.id,
    pressure_mpa: n.pressure,
    demand_served: 0,
    supply_actual: n.role === 'source' ? 180 : 0,
    alert_level: (n.pressure < 8.0 ? 'critical' : n.pressure < 8.8 ? 'warning' : 'normal') as 'normal' | 'warning' | 'critical',
  }))

  // 主样板管段（WE1-T-66 ~ WE1-T-91，展示关键几段）
  const keyEdges = [
    { id: 'WE1-T-66', flow: 142, util: isFailure ? 0.95 : 0.87 },
    { id: 'WE1-T-70', flow: isFailure ? 155 : 138, util: isFailure ? 0.98 : 0.85 },
    { id: 'WE1-T-75', flow: scenarioId === 'zhongwei_trunk_break' ? 0 : 130, util: scenarioId === 'zhongwei_trunk_break' ? 0 : 0.8 },
    { id: 'WE1-T-80', flow: isFailure ? 80 : 125, util: isFailure ? 0.5 : 0.78 },
    { id: 'WE1-T-85', flow: isFailure ? 60 : 118, util: isFailure ? 0.38 : 0.72 },
    { id: 'WE1-T-90', flow: isLimited ? 95 : isFailure ? 45 : 112, util: isLimited ? 0.92 : isFailure ? 0.28 : 0.68 },
  ]

  const edges = keyEdges.map(e => {
    const util = e.util
    const color = util <= 0 ? '#64748b' : util < 0.7 ? '#22c55e' : util < 0.85 ? '#eab308' : util < 0.95 ? '#f97316' : '#ef4444'
    const alert: 'normal' | 'warning' | 'critical' = util > 1 ? 'critical' : util > 0.92 ? 'warning' : 'normal'
    return {
      id: e.id,
      flow_rate: e.flow,
      direction: 'forward' as const,
      utilization: util,
      alert_level: alert,
      color,
      width_factor: Math.max(0.3, Math.min(1.5, 0.4 + util * 1.1)),
    }
  })

  return {
    pilot_id: pilotId,
    scenario_id: scenarioId,
    solver_status: 'converged',
    iterations: 12,
    nodes,
    edges,
    summary: {
      total_supply: 180,
      total_demand: 115,
      unserved_demand: isFailure ? 42 : 0,
      avg_utilization: isFailure ? 0.62 : 0.78,
      alert_count: isFailure ? 3 : isLimited ? 1 : 0,
    },
    meta: {
      pilot_id: pilotId,
      scenario_id: scenarioId,
      available_scenarios: MAINLINE_SCENARIOS.map(s => s.id),
      node_count: nodes.length,
      edge_count: edges.length,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

interface UseSimulationOptions {
  pilotId: string
  scenarios: ScenarioOption[]
}

interface UseSimulationReturn {
  overlay: SimulationOverlay | null
  isLoading: boolean
  error: string | null
  currentScenario: string
  setScenario: (id: string) => void
  runSimulation: () => Promise<void>
  clearOverlay: () => void
}

export function useSimulation({
  pilotId,
  scenarios,
}: UseSimulationOptions): UseSimulationReturn {
  const [overlay, setOverlay] = useState<SimulationOverlay | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentScenario, setCurrentScenario] = useState(scenarios[0]?.id ?? 'steady_base')

  // 缓存：同一 pilotId+scenarioId 不重复请求
  const cache = useRef<Map<string, SimulationOverlay>>(new Map())

  const runSimulation = useCallback(async () => {
    const cacheKey = `${pilotId}::${currentScenario}`

    if (cache.current.has(cacheKey)) {
      setOverlay(cache.current.get(cacheKey)!)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      let data: SimulationOverlay

      if (USE_MOCK) {
        // Mock 模式：假装等了 600ms
        await new Promise(r => setTimeout(r, 600))
        data = buildMockOverlay(pilotId, currentScenario)
      } else {
        // 真实接口
        const url = `${API_BASE}/pipeline-packages/simulation-overlay?pilot_id=${pilotId}&scenario_id=${currentScenario}`
        const resp = await fetch(url)
        if (!resp.ok) {
          const detail = await resp.text()
          throw new Error(`接口返回 ${resp.status}: ${detail}`)
        }
        data = await resp.json()
      }

      cache.current.set(cacheKey, data)
      setOverlay(data)
    } catch (err: any) {
      setError(err?.message ?? '求解失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }, [pilotId, currentScenario])

  const setScenario = useCallback((id: string) => {
    setCurrentScenario(id)
    // 切场景后清掉当前结果，等用户再次点运行
    setOverlay(null)
    setError(null)
  }, [])

  const clearOverlay = useCallback(() => {
    setOverlay(null)
    setError(null)
  }, [])

  return {
    overlay,
    isLoading,
    error,
    currentScenario,
    setScenario,
    runSimulation,
    clearOverlay,
  }
}
