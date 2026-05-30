import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ScenarioOption,
  SimulationInitialInput,
  SimulationComparison,
  SimulationDeltaMetric,
  SimulationOverlay,
  SimulationSnapshotRecord,
  SimulationSnapshotSummary,
  SimulationTrialRunItem,
} from '@/types/simulation'
import { MAINLINE_SCENARIOS } from '@/types/simulation'

const API_BASE = '/api'
const SNAPSHOT_API_BASE = '/topology-simulation/snapshots'
const USE_MOCK = false

interface UseSimulationOptions {
  pilotId: string
  scenarios: ScenarioOption[]
}

interface RunSimulationOptions {
  initialInput?: SimulationInitialInput
  scenarioId?: string
  waitForAnimation?: boolean
  failure?: {
    failureNodeId: string
    failureType: 'compressor_offline' | 'pipe_break' | 'valve_close'
    baseScenarioId?: string
  }
}

interface UseSimulationReturn {
  overlay: SimulationOverlay | null
  baselineOverlay: SimulationOverlay | null
  isLoading: boolean
  error: string | null
  currentScenario: string
  snapshots: SimulationSnapshotSummary[]
  snapshotLoading: boolean
  baselineSnapshotLoading: boolean
  snapshotError: string | null
  selectedSnapshotRunId: string
  baselineSnapshotRunId: string
  trialRunScenarioId: string
  bulkTrialRunActive: boolean
  comparison: SimulationComparison | null
  trialRunItems: SimulationTrialRunItem[]
  animatingState: {
    active: boolean
    iteration: number
    total: number
    solverIterations: number
    prevOverlay: SimulationOverlay | null
  } | null
  setScenario: (id: string) => void
  setSelectedSnapshotRunId: (id: string) => void
  setBaselineSnapshotRunId: (id: string) => void
  runSimulation: (options?: RunSimulationOptions) => Promise<SimulationOverlay | null>
  saveSnapshot: () => Promise<void>
  refreshSnapshots: () => Promise<void>
  loadSelectedSnapshot: () => Promise<void>
  loadSnapshotByRunId: (runId: string) => Promise<void>
  runTrialScenario: (scenarioId: string, options?: { initialInput?: SimulationInitialInput }) => Promise<SimulationOverlay | null>
  runMissingTrialScenarios: () => Promise<void>
  hydrateFromContext: (context: {
    scenarioId?: string
    selectedSnapshotRunId?: string
    baselineSnapshotRunId?: string
    overlay?: SimulationOverlay | null
  }) => void
  clearOverlay: () => void
}

function buildMockOverlay(pilotId: string, scenarioId: string): SimulationOverlay {
  const isFailure = scenarioId.includes('offline') || scenarioId.includes('break')
  const isLimited = scenarioId.includes('limited')
  const generatedAt = new Date().toISOString()

  const baseNodes = [
    { id: 'WE1-67', pressure: 9.85, role: 'source' },
    { id: 'WE1-76', pressure: isFailure ? 7.2 : 9.55, role: 'transit' },
    { id: 'WE1-86', pressure: isFailure ? 5.8 : 9.35, role: 'transit' },
    { id: 'WE1-92', pressure: isFailure ? 4.1 : 9.15, role: 'transit' },
  ]

  const nodes = baseNodes.map(item => ({
    id: item.id,
    pressure_mpa: item.pressure,
    temperature_c: Number((14 + item.pressure * 1.6).toFixed(1)),
    demand_served: 0,
    supply_actual: item.role === 'source' ? 180 : 0,
    alert_level: (item.pressure < 8.0 ? 'critical' : item.pressure < 8.8 ? 'warning' : 'normal') as
      | 'normal'
      | 'warning'
      | 'critical',
  }))

  const edgeSeeds = [
    { id: 'WE1-T-66', flow: 142, util: isFailure ? 0.95 : 0.87 },
    { id: 'WE1-T-70', flow: isFailure ? 155 : 138, util: isFailure ? 0.98 : 0.85 },
    { id: 'WE1-T-75', flow: scenarioId === 'zhongwei_trunk_break' ? 0 : 130, util: scenarioId === 'zhongwei_trunk_break' ? 0 : 0.8 },
    { id: 'WE1-T-80', flow: isFailure ? 80 : 125, util: isFailure ? 0.5 : 0.78 },
    { id: 'WE1-T-85', flow: isFailure ? 60 : 118, util: isFailure ? 0.38 : 0.72 },
    { id: 'WE1-T-90', flow: isLimited ? 95 : isFailure ? 45 : 112, util: isLimited ? 0.92 : isFailure ? 0.28 : 0.68 },
  ]

  const edges = edgeSeeds.map(item => {
    const color =
      item.util <= 0
        ? '#64748b'
        : item.util < 0.7
          ? '#22c55e'
          : item.util < 0.85
            ? '#eab308'
            : item.util < 0.95
              ? '#f97316'
              : '#ef4444'

    return {
      id: item.id,
      flow_rate: item.flow,
      direction: 'forward' as const,
      utilization: item.util,
      alert_level: (item.util > 1 ? 'critical' : item.util > 0.92 ? 'warning' : 'normal') as
        | 'normal'
        | 'warning'
        | 'critical',
      color,
      width_factor: Math.max(0.3, Math.min(1.5, 0.4 + item.util * 1.1)),
    }
  })

  return {
    pilot_id: pilotId,
    scenario_id: scenarioId,
    run_id: `mock-${pilotId}-${scenarioId}`,
    generated_at: generatedAt,
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
      available_scenarios: MAINLINE_SCENARIOS.map(item => item.id),
      node_count: nodes.length,
      edge_count: edges.length,
      solver_input_version: 'mock-v1',
    },
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

function buildDeltaMetric(current: number, baseline: number): SimulationDeltaMetric {
  return {
    current,
    baseline,
    delta: current - baseline,
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`request failed ${response.status}: ${detail}`)
  }

  return response.json() as Promise<T>
}

export function useSimulation({
  pilotId,
  scenarios,
}: UseSimulationOptions): UseSimulationReturn {
  const [overlay, setOverlay] = useState<SimulationOverlay | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentScenario, setCurrentScenario] = useState(scenarios[0]?.id ?? 'steady_base')
  const [snapshots, setSnapshots] = useState<SimulationSnapshotSummary[]>([])
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [baselineSnapshotLoading, setBaselineSnapshotLoading] = useState(false)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [selectedSnapshotRunId, setSelectedSnapshotRunId] = useState('')
  const [baselineSnapshotRunId, setBaselineSnapshotRunId] = useState('')
  const [trialRunScenarioId, setTrialRunScenarioId] = useState('')
  const [bulkTrialRunActive, setBulkTrialRunActive] = useState(false)
  const [baselineSnapshot, setBaselineSnapshot] = useState<SimulationSnapshotRecord | null>(null)
  const [animatingState, setAnimatingState] = useState<{
    active: boolean
    iteration: number
    total: number
    solverIterations: number
    prevOverlay: SimulationOverlay | null
  } | null>(null)

  const overlayCacheRef = useRef<Map<string, SimulationOverlay>>(new Map())
  const snapshotRecordCacheRef = useRef<Map<string, SimulationSnapshotRecord>>(new Map())

  const getSnapshotRecord = useCallback(
    async (runId: string): Promise<SimulationSnapshotRecord> => {
      const cached = snapshotRecordCacheRef.current.get(runId)
      if (cached) {
        return cached
      }

      const query = new URLSearchParams({ pilot_id: pilotId })
      const data = await fetchJson<SimulationSnapshotRecord>(
        `${SNAPSHOT_API_BASE}/${runId}?${query.toString()}`,
      )
      snapshotRecordCacheRef.current.set(runId, data)
      return data
    },
    [pilotId],
  )

  const runSimulation = useCallback(async (options?: RunSimulationOptions): Promise<SimulationOverlay | null> => {
    const scenarioId = options?.scenarioId ?? currentScenario
    const cacheKey = options?.failure
      ? `${pilotId}::${scenarioId}::failure::${options.failure.failureNodeId}::${options.failure.failureType}`
      : `${pilotId}::${scenarioId}`
    const cached = overlayCacheRef.current.get(cacheKey)

    if (scenarioId !== currentScenario) {
      setCurrentScenario(scenarioId)
    }

    // 先回显缓存，避免空白闪烁；但仍然强制拉取最新结果，确保每次“运行主仿真”都有新 run。
    if (cached) {
      setOverlay(cached)
      setSelectedSnapshotRunId('')
    }

    setIsLoading(true)
    setError(null)
    setSnapshotError(null)
    setAnimatingState(null)

    try {
      const data = USE_MOCK
        ? await (async () => {
            await new Promise(resolve => setTimeout(resolve, 600))
            return buildMockOverlay(pilotId, scenarioId)
          })()
        : options?.failure
          ? await fetchJson<SimulationOverlay>('/topology-simulation/solve-failure', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                pilot_id: pilotId,
                base_scenario_id: options.failure.baseScenarioId ?? scenarioId,
                failure_node_id: options.failure.failureNodeId,
                failure_type: options.failure.failureType,
              }),
            })
          : await fetchJson<SimulationOverlay>('/topology-simulation/solve-steady', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                pilot_id: pilotId,
                scenario_id: scenarioId,
                initial_conditions: options?.initialInput,
              }),
            })

      const prevOverlay = overlayCacheRef.current.get(cacheKey) ?? null
      overlayCacheRef.current.set(cacheKey, data)
      setOverlay(data)
      setSelectedSnapshotRunId('')
      setIsLoading(false)

      // Start animation loop
      const solverIterations = Math.max(1, data.iterations ?? 1)
      const totalIters = Math.max(8, Math.ceil(solverIterations * 3.5))
      setAnimatingState({ active: true, iteration: 1, total: totalIters, solverIterations, prevOverlay })
      
      const animateTicks = async () => {
        for (let i = 1; i <= totalIters; i++) {
          setAnimatingState({ active: true, iteration: i, total: totalIters, solverIterations, prevOverlay })
          await new Promise(r => setTimeout(r, 240)) // 展示用 tick，略慢一些方便看清求解过程
        }
        setAnimatingState(null)
      }
      const animationPromise = animateTicks()
      if (options?.waitForAnimation) {
        await animationPromise
      } else {
        void animationPromise
      }
      return data

    } catch (requestError) {
      setAnimatingState(null)
      setError(getErrorMessage(requestError, '仿真运行失败，请稍后再试'))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [currentScenario, pilotId])

  const refreshSnapshots = useCallback(async () => {
    setSnapshotLoading(true)
    setSnapshotError(null)

    try {
      const query = new URLSearchParams({
        pilot_id: pilotId,
        limit: '20',
      })
      const data = await fetchJson<{ items?: SimulationSnapshotSummary[] }>(
        `${SNAPSHOT_API_BASE}?${query.toString()}`,
      )
      setSnapshots(Array.isArray(data.items) ? data.items : [])
    } catch (requestError) {
      setSnapshotError(getErrorMessage(requestError, '快照列表刷新失败'))
    } finally {
      setSnapshotLoading(false)
    }
  }, [pilotId])

  const persistScenarioSnapshot = useCallback(
    async (
      scenarioId: string,
      options?: { syncCurrentScenario?: boolean; refreshSnapshotList?: boolean; initialInput?: SimulationInitialInput },
    ): Promise<SimulationSnapshotRecord> => {
      const syncCurrentScenario = options?.syncCurrentScenario ?? true
      const refreshSnapshotList = options?.refreshSnapshotList ?? true

      setSnapshotLoading(true)
      setSnapshotError(null)

      try {
        const data = await fetchJson<SimulationSnapshotRecord>(SNAPSHOT_API_BASE, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pilot_id: pilotId,
            scenario_id: scenarioId,
            initial_conditions: options?.initialInput,
          }),
        })

        snapshotRecordCacheRef.current.set(data.run_id, data)
        overlayCacheRef.current.set(`${pilotId}::${data.result.scenario_id}`, data.result)

        if (syncCurrentScenario) {
          setCurrentScenario(data.result.scenario_id)
        }
        setOverlay(data.result)
        setSelectedSnapshotRunId(data.run_id)
        if (refreshSnapshotList) {
          await refreshSnapshots()
        }
        return data
      } catch (requestError) {
        setSnapshotError(getErrorMessage(requestError, '保存快照失败'))
        throw requestError
      } finally {
        setSnapshotLoading(false)
      }
    },
    [pilotId, refreshSnapshots],
  )

  const saveSnapshot = useCallback(async () => {
    await persistScenarioSnapshot(currentScenario, { syncCurrentScenario: true })
  }, [currentScenario, persistScenarioSnapshot])

  const runTrialScenario = useCallback(async (scenarioId: string, options?: { initialInput?: SimulationInitialInput }): Promise<SimulationOverlay | null> => {
    setTrialRunScenarioId(scenarioId)
    setError(null)
    setSnapshotError(null)

    try {
      const snapshot = await persistScenarioSnapshot(scenarioId, { syncCurrentScenario: true, initialInput: options?.initialInput })
      return snapshot.result
    } catch (requestError) {
      return null
    } finally {
      setTrialRunScenarioId('')
    }
  }, [persistScenarioSnapshot])

  const loadSelectedSnapshot = useCallback(async () => {
    if (!selectedSnapshotRunId) {
      setSnapshotError('请先选择一个历史快照')
      return
    }

    setSnapshotLoading(true)
    setSnapshotError(null)

    try {
      const data = await getSnapshotRecord(selectedSnapshotRunId)
      overlayCacheRef.current.set(`${pilotId}::${data.result.scenario_id}`, data.result)

      setCurrentScenario(data.result.scenario_id)
      setOverlay(data.result)
    } catch (requestError) {
      setSnapshotError(getErrorMessage(requestError, '加载快照失败'))
    } finally {
      setSnapshotLoading(false)
    }
  }, [getSnapshotRecord, pilotId, selectedSnapshotRunId])

  useEffect(() => {
    void refreshSnapshots()
  }, [refreshSnapshots])

  useEffect(() => {
    if (snapshots.length === 0) {
      if (baselineSnapshotRunId) {
        setBaselineSnapshotRunId('')
      }
      return
    }

    const exists = snapshots.some(item => item.run_id === baselineSnapshotRunId)
    if (exists) {
      return
    }

    const preferred =
      snapshots.find(item => item.scenario_id === 'steady_base') ?? snapshots[0]

    setBaselineSnapshotRunId(preferred?.run_id ?? '')
  }, [baselineSnapshotRunId, snapshots])

  useEffect(() => {
    if (!baselineSnapshotRunId) {
      setBaselineSnapshot(null)
      return
    }

    let cancelled = false

    const loadBaselineSnapshot = async () => {
      setBaselineSnapshotLoading(true)
      setSnapshotError(null)

      try {
        const data = await getSnapshotRecord(baselineSnapshotRunId)
        if (!cancelled) {
          setBaselineSnapshot(data)
        }
      } catch (requestError) {
        if (!cancelled) {
          setBaselineSnapshot(null)
          setSnapshotError(getErrorMessage(requestError, '加载基线快照失败'))
        }
      } finally {
        if (!cancelled) {
          setBaselineSnapshotLoading(false)
        }
      }
    }

    void loadBaselineSnapshot()

    return () => {
      cancelled = true
    }
  }, [baselineSnapshotRunId, getSnapshotRecord])

  const comparison = useMemo<SimulationComparison | null>(() => {
    if (!overlay || !baselineSnapshot) {
      return null
    }

    const baselineOverlay = baselineSnapshot.result
    const baselineNodeMap = new Map(baselineOverlay.nodes.map(item => [item.id, item]))
    const baselineEdgeMap = new Map(baselineOverlay.edges.map(item => [item.id, item]))

    const topNodePressureChanges = overlay.nodes
      .map(item => {
        const baselineNode = baselineNodeMap.get(item.id)
        if (!baselineNode) {
          return null
        }

        return {
          id: item.id,
          current_pressure_mpa: item.pressure_mpa,
          baseline_pressure_mpa: baselineNode.pressure_mpa,
          delta_pressure_mpa: item.pressure_mpa - baselineNode.pressure_mpa,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((left, right) => Math.abs(right.delta_pressure_mpa) - Math.abs(left.delta_pressure_mpa))
      .slice(0, 5)

    const topEdgeFlowChanges = overlay.edges
      .map(item => {
        const baselineEdge = baselineEdgeMap.get(item.id)
        if (!baselineEdge) {
          return null
        }

        return {
          id: item.id,
          current_flow_rate: item.flow_rate,
          baseline_flow_rate: baselineEdge.flow_rate,
          delta_flow_rate: item.flow_rate - baselineEdge.flow_rate,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((left, right) => Math.abs(right.delta_flow_rate) - Math.abs(left.delta_flow_rate))
      .slice(0, 5)

    return {
      baseline_run_id: baselineSnapshot.run_id,
      baseline_scenario_id: baselineOverlay.scenario_id,
      current_run_id: overlay.run_id,
      current_scenario_id: overlay.scenario_id,
      summary_delta: {
        total_supply: buildDeltaMetric(overlay.summary.total_supply, baselineOverlay.summary.total_supply),
        total_demand: buildDeltaMetric(overlay.summary.total_demand, baselineOverlay.summary.total_demand),
        unserved_demand: buildDeltaMetric(overlay.summary.unserved_demand, baselineOverlay.summary.unserved_demand),
        avg_utilization: buildDeltaMetric(overlay.summary.avg_utilization, baselineOverlay.summary.avg_utilization),
        alert_count: buildDeltaMetric(overlay.summary.alert_count, baselineOverlay.summary.alert_count),
      },
      top_node_pressure_changes: topNodePressureChanges,
      top_edge_flow_changes: topEdgeFlowChanges,
    }
  }, [baselineSnapshot, overlay])

  const trialRunItems = useMemo<SimulationTrialRunItem[]>(() => {
    const scenarioOptions = scenarios.length > 0 ? scenarios : MAINLINE_SCENARIOS

    return scenarioOptions
      .map(item => {
        const matched = snapshots
          .filter(snapshot => snapshot.scenario_id === item.id)
          .sort((left, right) => right.saved_at.localeCompare(left.saved_at))

        return {
          scenario_id: item.id,
          label: item.label,
          covered: matched.length > 0,
          snapshot_count: matched.length,
          last_run_id: matched[0]?.run_id,
          last_saved_at: matched[0]?.saved_at,
        }
      })
      .sort((left, right) => {
        if (left.covered !== right.covered) {
          return Number(left.covered) - Number(right.covered)
        }

        return left.label.localeCompare(right.label)
      })
  }, [scenarios, snapshots])

  const runMissingTrialScenarios = useCallback(async () => {
    const pendingItems = trialRunItems.filter(item => !item.covered)
    if (pendingItems.length === 0) {
      return
    }

    setBulkTrialRunActive(true)
    setError(null)
    setSnapshotError(null)

    try {
      for (let index = 0; index < pendingItems.length; index += 1) {
        const item = pendingItems[index]
        const isLast = index === pendingItems.length - 1

        setTrialRunScenarioId(item.scenario_id)
        await persistScenarioSnapshot(item.scenario_id, {
          syncCurrentScenario: isLast,
          refreshSnapshotList: isLast,
        })
      }
    } catch (requestError) {
    } finally {
      setTrialRunScenarioId('')
      setBulkTrialRunActive(false)
    }
  }, [persistScenarioSnapshot, trialRunItems])

  const setScenario = useCallback((id: string) => {
    setCurrentScenario(id)
    setOverlay(null)
    setError(null)
    setSnapshotError(null)
  }, [])

  const loadSnapshotByRunId = useCallback(async (runId: string) => {
    if (!runId) {
      setSnapshotError('请先选择一个历史快照')
      return
    }

    setSnapshotLoading(true)
    setSnapshotError(null)

    try {
      const data = await getSnapshotRecord(runId)
      overlayCacheRef.current.set(`${pilotId}::${data.result.scenario_id}`, data.result)

      setSelectedSnapshotRunId(runId)
      setCurrentScenario(data.result.scenario_id)
      setOverlay(data.result)
    } catch (requestError) {
      setSnapshotError(getErrorMessage(requestError, '加载快照失败'))
      throw requestError
    } finally {
      setSnapshotLoading(false)
    }
  }, [getSnapshotRecord, pilotId])

  const hydrateFromContext = useCallback((context: {
    scenarioId?: string
    selectedSnapshotRunId?: string
    baselineSnapshotRunId?: string
    overlay?: SimulationOverlay | null
  }) => {
    const nextOverlay = context.overlay ?? null
    const nextScenarioId = nextOverlay?.scenario_id ?? context.scenarioId

    if (typeof context.selectedSnapshotRunId === 'string') {
      setSelectedSnapshotRunId(context.selectedSnapshotRunId)
    }
    if (typeof context.baselineSnapshotRunId === 'string') {
      setBaselineSnapshotRunId(context.baselineSnapshotRunId)
    }
    if (nextScenarioId) {
      setCurrentScenario(nextScenarioId)
    }
    if (nextOverlay) {
      overlayCacheRef.current.set(`${pilotId}::${nextOverlay.scenario_id}`, nextOverlay)
      setOverlay(nextOverlay)
    }

    setError(null)
    setSnapshotError(null)
  }, [pilotId])

  const clearOverlay = useCallback(() => {
    setOverlay(null)
    setError(null)
  }, [])

  return {
    overlay,
    baselineOverlay: baselineSnapshot?.result ?? null,
    isLoading,
    error,
    currentScenario,
    snapshots,
    snapshotLoading,
    baselineSnapshotLoading,
    snapshotError,
    selectedSnapshotRunId,
    baselineSnapshotRunId,
    trialRunScenarioId,
    bulkTrialRunActive,
    comparison,
    trialRunItems,
    animatingState,
    setScenario,
    setSelectedSnapshotRunId,
    setBaselineSnapshotRunId,
    runSimulation,
    saveSnapshot,
    refreshSnapshots,
    loadSelectedSnapshot,
    loadSnapshotByRunId,
    runTrialScenario,
    runMissingTrialScenarios,
    hydrateFromContext,
    clearOverlay,
  }
}
