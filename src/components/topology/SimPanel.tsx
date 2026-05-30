import React, { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ScenarioOption,
  SimulationComparison,
  SimulationOverlay,
  SimulationSnapshotSummary,
  SimulationTrialRunItem,
} from '@/types/simulation'

interface SimPanelProps {
  scenarioId: string
  scenarios: ScenarioOption[]
  isLoading: boolean
  snapshotLoading: boolean
  baselineSnapshotLoading: boolean
  error: string | null
  snapshotError: string | null
  overlay: SimulationOverlay | null
  snapshots: SimulationSnapshotSummary[]
  selectedSnapshotRunId: string
  baselineSnapshotRunId: string
  trialRunScenarioId: string
  bulkTrialRunActive: boolean
  comparison: SimulationComparison | null
  trialRunItems: SimulationTrialRunItem[]
  selectedTrialScenarioIds?: string[]
  onScenarioChange: (id: string) => void
  onToggleTrialScenario?: (id: string) => void
  onChangeTrialScenarioAtIndex?: (index: number, scenarioId: string) => void
  onSnapshotSelect: (runId: string) => void
  onBaselineSnapshotSelect: (runId: string) => void
  onRun: () => void
  onSaveSnapshot: () => void
  onRefreshSnapshots: () => void
  onLoadSnapshot: () => void
  onRunTrialScenario: (scenarioId: string) => void
  onRunMissingTrialScenarios: () => void
  onRunSelectedTrialScenarios?: () => void
  onClear: () => void
  dockSide?: 'left' | 'right'
  defaultExpanded?: boolean
  floating?: boolean
  initialPosition?: { x: number; y: number }
  initialSize?: { width: number; height: number }
  paramEditor?: React.ReactNode
  multiStagePrimary?: boolean
  multiStageRunActive?: boolean
  multiStageCompletedCount?: number
  multiStageTotalCount?: number
  multiStageActiveLabel?: string
  simulationAnimationProgress?: {
    iteration: number
    total: number
    solverIterations: number
  } | null
}

function formatDateTime(value?: string): string {
  if (!value) {
    return '-'
  }

  return value.replace('T', ' ').slice(0, 19)
}

function formatSigned(value: number, digits = 2, suffix = ''): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}${suffix}`
}

function formatSnapshotOption(item: SimulationSnapshotSummary): string {
  return `${item.scenario_id} | ${item.run_id.slice(0, 12)} | ${item.saved_at.slice(11, 19)}`
}

const sectionTitleStyle: React.CSSProperties = {
  color: '#94a3b8',
  marginBottom: '6px',
  fontSize: '11px',
  fontWeight: 600,
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(30, 41, 59, 0.9)',
  border: '1px solid rgba(99, 102, 241, 0.35)',
  borderRadius: '8px',
  color: '#e2e8f0',
  fontSize: '11px',
  padding: '6px 8px',
  outline: 'none',
}

const cardStyle: React.CSSProperties = {
  marginBottom: '10px',
  padding: '8px 9px',
  background: 'rgba(15, 23, 42, 0.45)',
  border: '1px solid rgba(100, 116, 139, 0.18)',
  borderRadius: '8px',
}

export const SimPanel: React.FC<SimPanelProps> = ({
  scenarioId,
  scenarios,
  isLoading,
  snapshotLoading,
  baselineSnapshotLoading,
  error,
  snapshotError,
  overlay,
  snapshots,
  selectedSnapshotRunId,
  baselineSnapshotRunId,
  trialRunScenarioId,
  bulkTrialRunActive,
  comparison,
  trialRunItems,
  selectedTrialScenarioIds,
  onScenarioChange,
  onToggleTrialScenario,
  onChangeTrialScenarioAtIndex,
  onSnapshotSelect,
  onBaselineSnapshotSelect,
  onRun,
  onSaveSnapshot,
  onRefreshSnapshots,
  onLoadSnapshot,
  onRunTrialScenario,
  onRunMissingTrialScenarios,
  onRunSelectedTrialScenarios,
  onClear,
  dockSide = 'left',
  defaultExpanded = false,
  floating = false,
  initialPosition = { x: 16, y: 88 },
  initialSize = { width: 320, height: 680 },
  paramEditor,
  multiStagePrimary = false,
  multiStageRunActive = false,
  multiStageCompletedCount,
  multiStageTotalCount,
  multiStageActiveLabel,
  simulationAnimationProgress,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [floatingPosition, setFloatingPosition] = useState(initialPosition)
  const [floatingSize, setFloatingSize] = useState(initialSize)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const resizeStartRef = useRef({ x: 0, y: 0, width: initialSize.width, height: initialSize.height })
  const summary = overlay?.summary
  const alertCount = summary?.alert_count ?? 0
  const hasAlert = alertCount > 0
  const isSnapshotBusy = snapshotLoading || baselineSnapshotLoading
  const orderedTrialRunItems = useMemo(() => {
    const itemMap = new Map(trialRunItems.map(item => [item.scenario_id, item]))
    const scenarioMap = new Map(scenarios.map(item => [item.id, item]))
    if (multiStagePrimary) {
      const slotIds = (selectedTrialScenarioIds?.length ? selectedTrialScenarioIds : scenarios.map(item => item.id)).slice(0, 5)
      return slotIds.map((scenarioId, index) => {
        const option = scenarioMap.get(scenarioId)
        const coveredItem = itemMap.get(scenarioId)
        return coveredItem ?? {
          scenario_id: scenarioId,
          label: option?.label ?? `第 ${index + 1} 段`,
          covered: false,
          snapshot_count: 0,
        }
      })
    }

    const orderedItems = scenarios
      .map(item => itemMap.get(item.id) ?? {
        scenario_id: item.id,
        label: item.label,
        covered: false,
        snapshot_count: 0,
      })

    const extraItems = trialRunItems.filter(item => !scenarios.some(scenario => scenario.id === item.scenario_id))
    return [...orderedItems, ...extraItems]
  }, [multiStagePrimary, scenarios, selectedTrialScenarioIds, trialRunItems])
  const coveredTrialRunCount = orderedTrialRunItems.filter(item => item.covered).length
  const hasPendingTrialRun = orderedTrialRunItems.some(item => !item.covered)
  const selectedTrialScenarioSet = useMemo(
    () => new Set(selectedTrialScenarioIds ?? orderedTrialRunItems.map(item => item.scenario_id)),
    [orderedTrialRunItems, selectedTrialScenarioIds],
  )
  const selectedTrialRunCount = multiStagePrimary
    ? orderedTrialRunItems.length
    : orderedTrialRunItems.filter(item => selectedTrialScenarioSet.has(item.scenario_id)).length
  const activeScenarioLabel = scenarios.find(item => item.id === scenarioId)?.label ?? scenarioId
  const effectiveRunActive = multiStageRunActive || bulkTrialRunActive || isLoading || Boolean(simulationAnimationProgress)
  const effectiveProgressTotal = Math.max(1, multiStageTotalCount ?? selectedTrialRunCount)
  const effectiveCompletedCount = Math.min(effectiveProgressTotal, Math.max(0, multiStageCompletedCount ?? 0))
  const currentProgressIndex = Math.min(effectiveProgressTotal, effectiveCompletedCount + (effectiveRunActive ? 1 : 0))
  const multiStageProgressPercent = Math.min(100, ((effectiveCompletedCount + (effectiveRunActive ? 0.62 : 0)) / effectiveProgressTotal) * 100)
  const solverProgressPercent = simulationAnimationProgress
    ? Math.min(100, (simulationAnimationProgress.iteration / Math.max(1, simulationAnimationProgress.total)) * 100)
    : 0

  useEffect(() => {
    if (!floating || (!isDragging && !isResizing)) return

    const handleMouseMove = (event: MouseEvent) => {
      if (isDragging) {
        const nextX = Math.min(Math.max(0, event.clientX - dragOffsetRef.current.x), Math.max(0, window.innerWidth - floatingSize.width - 8))
        const nextY = Math.min(Math.max(58, event.clientY - dragOffsetRef.current.y), Math.max(58, window.innerHeight - floatingSize.height - 8))
        setFloatingPosition({ x: nextX, y: nextY })
      }

      if (isResizing) {
        const nextWidth = Math.min(Math.max(300, resizeStartRef.current.width + event.clientX - resizeStartRef.current.x), Math.max(300, window.innerWidth - floatingPosition.x - 8))
        const nextHeight = Math.min(Math.max(420, resizeStartRef.current.height + event.clientY - resizeStartRef.current.y), Math.max(420, window.innerHeight - floatingPosition.y - 8))
        setFloatingSize({ width: nextWidth, height: nextHeight })
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(false)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [floating, floatingPosition.x, floatingPosition.y, floatingSize.height, floatingSize.width, isDragging, isResizing])

  const handleFloatingDragStart = (event: React.MouseEvent) => {
    if (!floating) return
    const target = event.target as HTMLElement
    if (target.closest('button, select, input, textarea')) return
    setIsDragging(true)
    dragOffsetRef.current = {
      x: event.clientX - floatingPosition.x,
      y: event.clientY - floatingPosition.y,
    }
  }

  const handleFloatingResizeStart = (event: React.MouseEvent) => {
    if (!floating) return
    event.stopPropagation()
    event.preventDefault()
    setIsResizing(true)
    resizeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      width: floatingSize.width,
      height: floatingSize.height,
    }
  }

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    top: floating ? `${floatingPosition.y}px` : '50%',
    left: floating ? `${floatingPosition.x}px` : dockSide === 'left' ? (expanded ? '0' : '-298px') : 'auto',
    right: floating ? 'auto' : dockSide === 'right' ? (expanded ? '0' : '-298px') : 'auto',
    transform: floating ? 'none' : 'translateY(-50%)',
    zIndex: 200,
    width: floating ? `${floatingSize.width}px` : '272px',
    height: floating ? `${floatingSize.height}px` : undefined,
    maxHeight: floating ? 'none' : '82vh',
    overflowY: 'auto',
    background: 'rgba(15, 23, 42, 0.96)',
    backdropFilter: 'blur(14px)',
    border: '1px solid rgba(99, 102, 241, 0.35)',
    borderLeft: floating ? '1px solid rgba(99, 102, 241, 0.35)' : dockSide === 'left' ? 'none' : '1px solid rgba(99, 102, 241, 0.35)',
    borderRight: floating ? '1px solid rgba(99, 102, 241, 0.35)' : dockSide === 'right' ? 'none' : '1px solid rgba(99, 102, 241, 0.35)',
    borderRadius: floating ? '14px' : dockSide === 'left' ? '0 14px 14px 0' : '14px 0 0 14px',
    padding: '14px 14px 16px',
    boxShadow: '4px 0 32px rgba(0, 0, 0, 0.45)',
    color: '#e2e8f0',
    fontSize: '12px',
    transition: 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1), right 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
    cursor: floating && (isDragging || isResizing) ? (isResizing ? 'nwse-resize' : 'grabbing') : undefined,
  }

  const toggleBtnStyle: React.CSSProperties = {
    position: 'fixed',
    top: '50%',
    left: dockSide === 'left' ? (expanded ? '272px' : '0') : 'auto',
    right: dockSide === 'right' ? (expanded ? '272px' : '0') : 'auto',
    transform: 'translateY(-50%)',
    zIndex: 201,
    width: '24px',
    height: '56px',
    background: 'rgba(99, 102, 241, 0.86)',
    border: '1px solid rgba(99, 102, 241, 0.6)',
    borderLeft: dockSide === 'left' ? 'none' : '1px solid rgba(99, 102, 241, 0.6)',
    borderRight: dockSide === 'right' ? 'none' : '1px solid rgba(99, 102, 241, 0.6)',
    borderRadius: dockSide === 'left' ? '0 6px 6px 0' : '6px 0 0 6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1), right 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
    boxShadow: '2px 0 8px rgba(99, 102, 241, 0.3)',
  }

  const comparisonRows = comparison
    ? [
        {
          label: '总供气',
          deltaText: formatSigned(comparison.summary_delta.total_supply.delta, 1, ' 万方/天'),
        },
        {
          label: '总需求',
          deltaText: formatSigned(comparison.summary_delta.total_demand.delta, 1, ' 万方/天'),
        },
        {
          label: '未满足',
          deltaText: formatSigned(comparison.summary_delta.unserved_demand.delta, 1, ' 万方/天'),
        },
        {
          label: '平均利用率',
          deltaText: formatSigned(comparison.summary_delta.avg_utilization.delta * 100, 1, '%'),
        },
        {
          label: '告警数',
          deltaText: formatSigned(comparison.summary_delta.alert_count.delta, 0),
        },
      ]
    : []

  return (
    <>
      <div style={panelStyle}>
        <div
          onMouseDown={handleFloatingDragStart}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px',
            cursor: floating ? (isDragging ? 'grabbing' : 'grab') : 'default',
            userSelect: floating ? 'none' : undefined,
          }}
          title={floating ? '按住拖动仿真面板' : undefined}
        >
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#a5b4fc' }}>稳态仿真</span>
          {floating && <span style={{ color: '#64748b', fontSize: '10px' }}>拖动</span>}
          {overlay && (
            <button
              onClick={onClear}
              style={{
                marginLeft: 'auto',
                fontSize: '10px',
                color: '#cbd5e1',
                padding: '2px 8px',
                borderRadius: '999px',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                background: 'rgba(51, 65, 85, 0.6)',
                cursor: 'pointer',
              }}
            >
              清除
            </button>
          )}
        </div>

        {!multiStagePrimary && (
          <>
            <div style={{ marginBottom: '10px' }}>
              <div style={sectionTitleStyle}>场景</div>
              <select value={scenarioId} onChange={event => onScenarioChange(event.target.value)} style={selectStyle}>
                {scenarios.map(item => (
                  <option key={item.id} value={item.id} style={{ background: '#1e293b' }}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            {paramEditor && (
              <div style={{ marginBottom: '10px' }}>
                {paramEditor}
              </div>
            )}

            <button
              onClick={onRun}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '8px 0',
                borderRadius: '9px',
                border: 'none',
                background: isLoading ? 'rgba(99, 102, 241, 0.35)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 700,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                marginBottom: '10px',
              }}
            >
              {isLoading ? '运行中...' : '运行仿真'}
            </button>
          </>
        )}

        {orderedTrialRunItems.length > 0 && (
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div>
                <div style={{ ...sectionTitleStyle, marginBottom: '2px' }}>多段仿真</div>
                <div style={{ fontSize: '10px', color: '#64748b' }}>
                  {coveredTrialRunCount}/{orderedTrialRunItems.length} 段已有快照
                </div>
              </div>
              <button
                onClick={onRunSelectedTrialScenarios ?? onRunMissingTrialScenarios}
                disabled={
                  isSnapshotBusy ||
                  bulkTrialRunActive ||
                  (multiStagePrimary ? selectedTrialRunCount === 0 : !hasPendingTrialRun)
                }
                title={multiStagePrimary ? '按当前勾选顺序运行多段仿真' : '按当前多段顺序补齐未生成快照的仿真段'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '5px 8px',
                  borderRadius: '8px',
                  border: '1px solid rgba(45, 212, 191, 0.35)',
                  background: (multiStagePrimary ? selectedTrialRunCount > 0 : hasPendingTrialRun) ? 'rgba(13, 148, 136, 0.24)' : 'rgba(51, 65, 85, 0.45)',
                  color: (multiStagePrimary ? selectedTrialRunCount > 0 : hasPendingTrialRun) ? '#99f6e4' : '#94a3b8',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: (
                    isSnapshotBusy ||
                    bulkTrialRunActive ||
                    (multiStagePrimary ? selectedTrialRunCount === 0 : !hasPendingTrialRun)
                  ) ? 'not-allowed' : 'pointer',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px', lineHeight: 1 }}>
                  {bulkTrialRunActive ? 'hourglass_top' : 'playlist_play'}
                </span>
                {bulkTrialRunActive ? '运行中' : multiStagePrimary ? `运行这${selectedTrialRunCount}段` : '补齐'}
              </button>
            </div>

            {effectiveRunActive && (
              <div
                style={{
                  marginBottom: '8px',
                  padding: '8px',
                  borderRadius: '8px',
                  border: '1px solid rgba(45, 212, 191, 0.24)',
                  background: 'rgba(8, 47, 73, 0.22)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '6px', fontSize: '10px' }}>
                  <span style={{ color: '#ccfbf1', fontWeight: 700 }}>
                    {multiStagePrimary
                      ? `正在运行第 ${currentProgressIndex}/${effectiveProgressTotal} 段`
                      : simulationAnimationProgress
                        ? `求解迭代 ${simulationAnimationProgress.iteration}/${simulationAnimationProgress.total}`
                        : '仿真运行中'}
                  </span>
                  <span style={{ color: '#67e8f9', fontFamily: 'monospace' }}>
                    {multiStagePrimary
                      ? `${Math.round(multiStageProgressPercent)}%`
                      : simulationAnimationProgress
                        ? `${Math.round(solverProgressPercent)}%`
                        : '...'}
                  </span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: '10px', marginBottom: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {multiStageActiveLabel || activeScenarioLabel}
                  {simulationAnimationProgress && (
                    <span style={{ color: '#64748b' }}> · 真实求解迭代 {simulationAnimationProgress.solverIterations} 次</span>
                  )}
                </div>
                <div
                  style={{
                    position: 'relative',
                    height: '8px',
                    overflow: 'hidden',
                    borderRadius: '999px',
                    background: 'rgba(15, 23, 42, 0.9)',
                    border: '1px solid rgba(45, 212, 191, 0.18)',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${multiStagePrimary ? multiStageProgressPercent : solverProgressPercent || 18}%`,
                      borderRadius: '999px',
                      background: 'linear-gradient(90deg, #14b8a6, #22d3ee, #a7f3d0, #22d3ee)',
                      backgroundSize: '220% 100%',
                      animation: 'simProgressFlow 1.1s linear infinite',
                      boxShadow: '0 0 16px rgba(34, 211, 238, 0.45)',
                      transition: 'width 0.24s ease',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      backgroundImage: 'linear-gradient(110deg, transparent 0%, rgba(255,255,255,0.2) 35%, transparent 70%)',
                      transform: 'translateX(-70%)',
                      animation: 'simProgressSweep 1.35s ease-in-out infinite',
                    }}
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {orderedTrialRunItems.map((item, index) => {
                const active = trialRunScenarioId === item.scenario_id
                const selected = scenarioId === item.scenario_id
                const checked = selectedTrialScenarioSet.has(item.scenario_id)
                const disabled = isSnapshotBusy || bulkTrialRunActive || active

                return (
                  <React.Fragment key={multiStagePrimary ? `${index}-${item.scenario_id}` : item.scenario_id}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: multiStagePrimary && !onChangeTrialScenarioAtIndex
                          ? '18px 22px minmax(0, 1fr) 62px'
                          : '22px minmax(0, 1fr) 62px',
                        alignItems: 'center',
                        gap: '7px',
                        padding: '7px',
                        borderRadius: '8px',
                        border: selected ? '1px solid rgba(129, 140, 248, 0.55)' : '1px solid rgba(100, 116, 139, 0.16)',
                        background: selected ? 'rgba(79, 70, 229, 0.18)' : 'rgba(2, 6, 23, 0.26)',
                      }}
                    >
                      {multiStagePrimary && !onChangeTrialScenarioAtIndex && (
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleTrialScenario?.(item.scenario_id)}
                          title="加入多段批量运行"
                          style={{
                            width: '14px',
                            height: '14px',
                            accentColor: '#22d3ee',
                            cursor: 'pointer',
                          }}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => onScenarioChange(item.scenario_id)}
                        title="切换到这一段"
                        style={{
                          width: '22px',
                          height: '22px',
                          borderRadius: '50%',
                          border: item.covered ? '1px solid rgba(34, 197, 94, 0.55)' : '1px solid rgba(148, 163, 184, 0.25)',
                          background: item.covered ? 'rgba(22, 163, 74, 0.18)' : 'rgba(15, 23, 42, 0.78)',
                          color: item.covered ? '#86efac' : '#94a3b8',
                          fontSize: '10px',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        {index + 1}
                      </button>
                      {multiStagePrimary && onChangeTrialScenarioAtIndex ? (
                        <div style={{ minWidth: 0 }}>
                          <select
                            value={item.scenario_id}
                            onChange={(event) => {
                              onChangeTrialScenarioAtIndex(index, event.target.value)
                              onScenarioChange(event.target.value)
                            }}
                            disabled={disabled}
                            style={{
                              ...selectStyle,
                              height: '26px',
                              padding: '3px 6px',
                              fontSize: '11px',
                              borderColor: selected ? 'rgba(129, 140, 248, 0.65)' : 'rgba(56, 189, 248, 0.26)',
                            }}
                            title="更换这一段仿真工况"
                          >
                            {scenarios.map(option => (
                              <option key={option.id} value={option.id} style={{ background: '#1e293b' }}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <div style={{ marginTop: '2px', color: '#64748b', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {active ? '运行中' : item.covered
                              ? `快照 ${item.snapshot_count} 条${item.last_saved_at ? ` · ${item.last_saved_at.slice(11, 19)}` : ''}`
                              : '未生成快照'}
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onScenarioChange(item.scenario_id)}
                          style={{
                            minWidth: 0,
                            border: 'none',
                            padding: 0,
                            background: 'transparent',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                            <span
                              style={{
                                color: selected ? '#e0e7ff' : '#cbd5e1',
                                fontSize: '11px',
                                fontWeight: 700,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {item.label}
                            </span>
                            {active && (
                              <span style={{ color: '#22d3ee', fontSize: '10px', flexShrink: 0 }}>运行中</span>
                            )}
                          </div>
                          <div style={{ marginTop: '2px', color: '#64748b', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.covered
                              ? `快照 ${item.snapshot_count} 条${item.last_saved_at ? ` · ${item.last_saved_at.slice(11, 19)}` : ''}`
                              : '未生成快照'}
                          </div>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          onScenarioChange(item.scenario_id)
                          onRunTrialScenario(item.scenario_id)
                        }}
                        disabled={disabled}
                        title="运行并保存这一段快照"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '3px',
                          height: '26px',
                          borderRadius: '7px',
                          border: '1px solid rgba(56, 189, 248, 0.32)',
                          background: active ? 'rgba(14, 116, 144, 0.12)' : 'rgba(14, 116, 144, 0.22)',
                          color: '#bae6fd',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          opacity: disabled && !active ? 0.5 : 1,
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '13px', lineHeight: 1 }}>
                          {active ? 'hourglass_top' : 'play_arrow'}
                        </span>
                        {active ? '跑' : '单段'}
                      </button>
                    </div>
                    {multiStagePrimary && selected && paramEditor && (
                      <div
                        style={{
                          padding: '7px',
                          borderRadius: '8px',
                          border: '1px solid rgba(34, 211, 238, 0.22)',
                          background: 'rgba(8, 47, 73, 0.16)',
                        }}
                      >
                        <div style={{ marginBottom: '6px', color: '#a5f3fc', fontSize: '10px', fontWeight: 700 }}>
                          {activeScenarioLabel} 参数
                        </div>
                        {paramEditor}
                      </div>
                    )}
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
          <button
            onClick={onSaveSnapshot}
            disabled={isSnapshotBusy}
            style={{
              flex: 1,
              padding: '7px 0',
              borderRadius: '8px',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              background: 'rgba(14, 116, 144, 0.22)',
              color: '#bae6fd',
              fontSize: '11px',
              cursor: isSnapshotBusy ? 'not-allowed' : 'pointer',
            }}
          >
            {snapshotLoading ? '保存中...' : '保存快照'}
          </button>
          <button
            onClick={onRefreshSnapshots}
            disabled={isSnapshotBusy}
            style={{
              flex: 1,
              padding: '7px 0',
              borderRadius: '8px',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              background: 'rgba(51, 65, 85, 0.6)',
              color: '#cbd5e1',
              fontSize: '11px',
              cursor: isSnapshotBusy ? 'not-allowed' : 'pointer',
            }}
          >
            刷新快照
          </button>
        </div>

        <div style={cardStyle}>
          <div style={sectionTitleStyle}>历史快照回放</div>
          <select
            value={selectedSnapshotRunId}
            onChange={event => onSnapshotSelect(event.target.value)}
            style={{ ...selectStyle, marginBottom: '6px' }}
          >
            <option value="" style={{ background: '#1e293b' }}>
              选择历史快照
            </option>
            {snapshots.map(item => (
              <option key={item.run_id} value={item.run_id} style={{ background: '#1e293b' }}>
                {formatSnapshotOption(item)}
              </option>
            ))}
          </select>
          <button
            onClick={onLoadSnapshot}
            disabled={isSnapshotBusy || !selectedSnapshotRunId}
            style={{
              width: '100%',
              padding: '7px 0',
              borderRadius: '8px',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              background: 'rgba(20, 83, 45, 0.45)',
              color: '#bbf7d0',
              fontSize: '11px',
              cursor: isSnapshotBusy || !selectedSnapshotRunId ? 'not-allowed' : 'pointer',
            }}
          >
            加载快照
          </button>
        </div>

        <div style={cardStyle}>
          <div style={sectionTitleStyle}>基线快照</div>
          <select
            value={baselineSnapshotRunId}
            onChange={event => onBaselineSnapshotSelect(event.target.value)}
            style={selectStyle}
          >
            <option value="" style={{ background: '#1e293b' }}>
              选择对比基线
            </option>
            {snapshots.map(item => (
              <option key={item.run_id} value={item.run_id} style={{ background: '#1e293b' }}>
                {formatSnapshotOption(item)}
              </option>
            ))}
          </select>
          <div style={{ marginTop: '6px', fontSize: '10px', color: '#94a3b8' }}>
            {baselineSnapshotLoading ? '基线快照加载中...' : '默认优先选择 steady_base 快照'}
          </div>
        </div>

        {error && (
          <div
            style={{
              ...cardStyle,
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#fca5a5',
            }}
          >
            {error}
          </div>
        )}

        {snapshotError && (
          <div
            style={{
              ...cardStyle,
              background: 'rgba(249, 115, 22, 0.15)',
              border: '1px solid rgba(249, 115, 22, 0.4)',
              color: '#fdba74',
            }}
          >
            {snapshotError}
          </div>
        )}

        {overlay && summary && (
          <div style={cardStyle}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px',
              }}
            >
              <span style={{ color: overlay.solver_status === 'converged' ? '#22c55e' : '#f97316', fontWeight: 700 }}>
                {overlay.solver_status === 'converged' ? '已收敛' : '需复核'}
              </span>
              <span style={{ color: '#94a3b8', fontSize: '11px' }}>{overlay.iterations} 次迭代</span>
            </div>

            <div style={{ marginBottom: '8px', fontSize: '10px', color: '#94a3b8', lineHeight: 1.5 }}>
              <div>run_id: {overlay.run_id}</div>
              <div>generated_at: {formatDateTime(overlay.generated_at)}</div>
            </div>

            {[
              ['总供气', `${summary.total_supply.toFixed(1)} 万方/天`, '#34d399'],
              ['总需求', `${summary.total_demand.toFixed(1)} 万方/天`, '#60a5fa'],
              ['未满足', `${summary.unserved_demand.toFixed(1)} 万方/天`, summary.unserved_demand > 0 ? '#f87171' : '#4ade80'],
              ['平均利用率', `${(summary.avg_utilization * 100).toFixed(1)}%`, summary.avg_utilization > 0.9 ? '#f97316' : '#e2e8f0'],
              ['告警数', `${summary.alert_count}`, summary.alert_count > 0 ? '#fdba74' : '#cbd5e1'],
            ].map(([label, value, color]) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '3px 0',
                  borderBottom: '1px solid rgba(100, 116, 139, 0.1)',
                  fontSize: '11px',
                }}
              >
                <span style={{ color: '#64748b' }}>{label}</span>
                <span style={{ color: `${color}`, fontWeight: 700 }}>{value}</span>
              </div>
            ))}
          </div>
        )}

        {overlay && (
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>压力 / 流量</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <div style={{ marginBottom: '4px', color: '#38bdf8', fontSize: '10px', fontWeight: 700 }}>低压节点</div>
                {overlay.nodes
                  .slice()
                  .sort((left, right) => (left.pressure_in_mpa ?? left.pressure_mpa) - (right.pressure_in_mpa ?? right.pressure_mpa))
                  .slice(0, 5)
                  .map(node => (
                    <div key={`p-${node.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', padding: '2px 0', fontSize: '10px' }}>
                      <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.id}</span>
                      <span style={{ color: node.alert_level === 'normal' ? '#67e8f9' : '#fbbf24', fontFamily: 'monospace' }}>
                        {(node.pressure_in_mpa ?? node.pressure_mpa).toFixed(2)}
                      </span>
                    </div>
                  ))}
              </div>
              <div>
                <div style={{ marginBottom: '4px', color: '#34d399', fontSize: '10px', fontWeight: 700 }}>大流量管段</div>
                {overlay.edges
                  .slice()
                  .sort((left, right) => Math.abs(right.flow_rate) - Math.abs(left.flow_rate))
                  .slice(0, 5)
                  .map(edge => (
                    <div key={`q-${edge.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', padding: '2px 0', fontSize: '10px' }}>
                      <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{edge.id}</span>
                      <span style={{ color: edge.direction === 'zero' ? '#94a3b8' : '#34d399', fontFamily: 'monospace' }}>
                        {edge.flow_rate.toFixed(0)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {comparison && (
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>快照对比</div>
            <div style={{ fontSize: '10px', color: '#94a3b8', lineHeight: 1.5, marginBottom: '8px' }}>
              <div>当前: {comparison.current_scenario_id}</div>
              <div>基线: {comparison.baseline_scenario_id}</div>
            </div>

            {comparisonRows.map(item => (
              <div
                key={item.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '3px 0',
                  borderBottom: '1px solid rgba(100, 116, 139, 0.1)',
                  fontSize: '11px',
                }}
              >
                <span style={{ color: '#64748b' }}>{item.label}</span>
                <span
                  style={{
                    color: item.deltaText.startsWith('+') ? '#fbbf24' : item.deltaText.startsWith('-') ? '#38bdf8' : '#cbd5e1',
                    fontWeight: 700,
                  }}
                >
                  {item.deltaText}
                </span>
              </div>
            ))}

            <div style={{ marginTop: '8px' }}>
              <div style={{ ...sectionTitleStyle, marginBottom: '4px' }}>压力变化最大的节点</div>
              {comparison.top_node_pressure_changes.length === 0 ? (
                <div style={{ fontSize: '10px', color: '#64748b' }}>暂无可对比节点</div>
              ) : (
                comparison.top_node_pressure_changes.map(item => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', padding: '2px 0' }}>
                    <span style={{ color: '#cbd5e1' }}>{item.id}</span>
                    <span style={{ color: item.delta_pressure_mpa >= 0 ? '#fbbf24' : '#38bdf8' }}>
                      {formatSigned(item.delta_pressure_mpa, 3, ' MPa')}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div style={{ marginTop: '8px' }}>
              <div style={{ ...sectionTitleStyle, marginBottom: '4px' }}>流量变化最大的管段</div>
              {comparison.top_edge_flow_changes.length === 0 ? (
                <div style={{ fontSize: '10px', color: '#64748b' }}>暂无可对比管段</div>
              ) : (
                comparison.top_edge_flow_changes.map(item => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', padding: '2px 0' }}>
                    <span style={{ color: '#cbd5e1' }}>{item.id}</span>
                    <span style={{ color: item.delta_flow_rate >= 0 ? '#fbbf24' : '#38bdf8' }}>
                      {formatSigned(item.delta_flow_rate, 1, ' 万方/天')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {overlay && (
          <div style={{ ...cardStyle, marginBottom: 0 }}>
            <div style={sectionTitleStyle}>管段利用率颜色</div>
            {[
              ['#22c55e', '< 70% 正常'],
              ['#eab308', '70% - 85% 偏高'],
              ['#f97316', '85% - 95% 告警'],
              ['#ef4444', '> 95% 危险'],
            ].map(([color, label]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontSize: '10px' }}>
                <div style={{ width: '20px', height: '3px', background: color, borderRadius: '2px', flexShrink: 0 }} />
                <span style={{ color: '#94a3b8' }}>{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!floating && (
        <div
          style={toggleBtnStyle}
          onClick={() => setExpanded(value => !value)}
          title={expanded ? '收起仿真面板' : '展开仿真面板'}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
            {hasAlert && !expanded && (
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#ef4444',
                  marginBottom: '2px',
                  boxShadow: '0 0 4px #ef4444',
                }}
              />
            )}
            <span
              style={{
                fontSize: '10px',
                color: '#e2e8f0',
                lineHeight: 1,
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
                display: 'block',
              }}
            >
              {'<'}
            </span>
            <span
              style={{
                fontSize: '9px',
                color: '#a5b4fc',
                fontWeight: 700,
                writingMode: 'vertical-rl',
                letterSpacing: '1px',
                marginTop: '4px',
              }}
            >
              仿真
            </span>
          </div>
        </div>
      )}
      {floating && (
        <div
          onMouseDown={handleFloatingResizeStart}
          title="拖动调整仿真面板长宽"
          style={{
            position: 'fixed',
            left: `${floatingPosition.x + floatingSize.width - 18}px`,
            top: `${floatingPosition.y + floatingSize.height - 18}px`,
            zIndex: 202,
            width: '18px',
            height: '18px',
            cursor: 'nwse-resize',
            borderRadius: '8px 0 14px 0',
            borderLeft: '1px solid rgba(125, 211, 252, 0.22)',
            borderTop: '1px solid rgba(125, 211, 252, 0.22)',
            background: 'linear-gradient(135deg, rgba(14,165,233,0.08), rgba(99,102,241,0.32))',
          }}
        >
          <span
            style={{
              position: 'absolute',
              right: '1px',
              bottom: '-2px',
              color: '#93c5fd',
              fontSize: '14px',
              lineHeight: 1,
            }}
          >
            ◢
          </span>
        </div>
      )}
    </>
  )
}

export default SimPanel
