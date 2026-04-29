import React, { useState } from 'react'
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
  onScenarioChange: (id: string) => void
  onSnapshotSelect: (runId: string) => void
  onBaselineSnapshotSelect: (runId: string) => void
  onRun: () => void
  onSaveSnapshot: () => void
  onRefreshSnapshots: () => void
  onLoadSnapshot: () => void
  onRunTrialScenario: (scenarioId: string) => void
  onRunMissingTrialScenarios: () => void
  onClear: () => void
  dockSide?: 'left' | 'right'
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
  onScenarioChange,
  onSnapshotSelect,
  onBaselineSnapshotSelect,
  onRun,
  onSaveSnapshot,
  onRefreshSnapshots,
  onLoadSnapshot,
  onRunTrialScenario,
  onRunMissingTrialScenarios,
  onClear,
  dockSide = 'left',
}) => {
  const [expanded, setExpanded] = useState(false)
  const summary = overlay?.summary
  const alertCount = summary?.alert_count ?? 0
  const hasAlert = alertCount > 0
  const isSnapshotBusy = snapshotLoading || baselineSnapshotLoading
  const uncoveredCount = trialRunItems.filter(item => !item.covered).length

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    top: '50%',
    left: dockSide === 'left' ? (expanded ? '0' : '-298px') : 'auto',
    right: dockSide === 'right' ? (expanded ? '0' : '-298px') : 'auto',
    transform: 'translateY(-50%)',
    zIndex: 200,
    width: '272px',
    maxHeight: '82vh',
    overflowY: 'auto',
    background: 'rgba(15, 23, 42, 0.96)',
    backdropFilter: 'blur(14px)',
    border: '1px solid rgba(99, 102, 241, 0.35)',
    borderLeft: dockSide === 'left' ? 'none' : '1px solid rgba(99, 102, 241, 0.35)',
    borderRight: dockSide === 'right' ? 'none' : '1px solid rgba(99, 102, 241, 0.35)',
    borderRadius: dockSide === 'left' ? '0 14px 14px 0' : '14px 0 0 14px',
    padding: '14px 14px 16px',
    boxShadow: '4px 0 32px rgba(0, 0, 0, 0.45)',
    color: '#e2e8f0',
    fontSize: '12px',
    transition: 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
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
    transition: 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#a5b4fc' }}>稳态仿真</span>
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

        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>试运行清单</div>
            <button
              onClick={onRunMissingTrialScenarios}
              disabled={isSnapshotBusy || uncoveredCount === 0}
              style={{
                padding: '4px 8px',
                borderRadius: '999px',
                border: '1px solid rgba(56, 189, 248, 0.28)',
                background: uncoveredCount === 0 ? 'rgba(51, 65, 85, 0.55)' : 'rgba(8, 145, 178, 0.22)',
                color: uncoveredCount === 0 ? '#94a3b8' : '#bae6fd',
                fontSize: '10px',
                cursor: isSnapshotBusy || uncoveredCount === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {bulkTrialRunActive ? '补齐中...' : uncoveredCount === 0 ? '已全覆盖' : `补齐未覆盖(${uncoveredCount})`}
            </button>
          </div>
          {trialRunItems.map(item => (
            <div
              key={item.scenario_id}
              style={{
                padding: '6px 0',
                borderBottom: '1px solid rgba(100, 116, 139, 0.1)',
                fontSize: '11px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span style={{ color: '#e2e8f0' }}>{item.label}</span>
                <span style={{ color: item.covered ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                  {item.covered ? '已覆盖' : '未覆盖'}
                </span>
              </div>
              <div style={{ color: '#64748b', fontSize: '10px' }}>
                快照数 {item.snapshot_count}
                {item.last_saved_at ? ` | 最近 ${formatDateTime(item.last_saved_at)}` : ''}
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                <button
                  onClick={() => onScenarioChange(item.scenario_id)}
                  disabled={isSnapshotBusy}
                  style={{
                    flex: 1,
                    padding: '5px 0',
                    borderRadius: '7px',
                    border: '1px solid rgba(148, 163, 184, 0.24)',
                    background: scenarioId === item.scenario_id ? 'rgba(99, 102, 241, 0.24)' : 'rgba(51, 65, 85, 0.55)',
                    color: '#cbd5e1',
                    fontSize: '10px',
                    cursor: isSnapshotBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  {scenarioId === item.scenario_id ? '当前场景' : '切换场景'}
                </button>
                <button
                  onClick={() => onRunTrialScenario(item.scenario_id)}
                  disabled={isSnapshotBusy}
                  style={{
                    flex: 1,
                    padding: '5px 0',
                    borderRadius: '7px',
                    border: '1px solid rgba(56, 189, 248, 0.28)',
                    background: 'rgba(8, 145, 178, 0.22)',
                    color: '#bae6fd',
                    fontSize: '10px',
                    cursor: isSnapshotBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  {trialRunScenarioId === item.scenario_id
                    ? '补跑中...'
                    : item.covered
                      ? '重跑归档'
                      : '补跑归档'}
                </button>
              </div>
            </div>
          ))}
        </div>

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
    </>
  )
}

export default SimPanel
