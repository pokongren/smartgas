/**
 * SimPanel — 仿真控制面板（可折叠）
 *
 * 默认折叠为左侧一个小标签，点击展开完整面板。
 * 不挡图，随时可以收起。
 */

import React, { useState } from 'react'
import type { SimulationOverlay, ScenarioOption } from '@/types/simulation'

interface SimPanelProps {
  scenarioId: string
  scenarios: ScenarioOption[]
  isLoading: boolean
  error: string | null
  overlay: SimulationOverlay | null
  onScenarioChange: (id: string) => void
  onRun: () => void
  onClear: () => void
}

export const SimPanel: React.FC<SimPanelProps> = ({
  scenarioId,
  scenarios,
  isLoading,
  error,
  overlay,
  onScenarioChange,
  onRun,
  onClear,
}) => {
  const [expanded, setExpanded] = useState(false)
  const summary = overlay?.summary
  const alertCount = summary?.alert_count ?? 0
  const hasAlert = alertCount > 0

  // 折叠状态：左侧竖排小标签
  const tabStyle: React.CSSProperties = {
    position: 'fixed',
    top: '50%',
    left: 0,
    transform: 'translateY(-50%)',
    zIndex: 200,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    width: '32px',
    padding: '10px 0',
    background: 'rgba(15,23,42,0.88)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(99,102,241,0.4)',
    borderLeft: 'none',
    borderRadius: '0 8px 8px 0',
    cursor: 'pointer',
    boxShadow: '3px 0 16px rgba(0,0,0,0.4)',
    transition: 'all 0.2s',
    userSelect: 'none',
  }

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    top: '50%',
    left: expanded ? '0' : '-260px',
    transform: 'translateY(-50%)',
    zIndex: 200,
    width: '230px',
    maxHeight: '80vh',
    overflowY: 'auto',
    background: 'rgba(15, 23, 42, 0.95)',
    backdropFilter: 'blur(14px)',
    border: '1px solid rgba(99,102,241,0.35)',
    borderLeft: 'none',
    borderRadius: '0 12px 12px 0',
    padding: '14px 16px',
    boxShadow: '4px 0 32px rgba(0,0,0,0.55)',
    fontFamily: 'Inter, system-ui, sans-serif',
    color: '#e2e8f0',
    fontSize: '12px',
    transition: 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
  }

  const toggleBtnStyle: React.CSSProperties = {
    position: 'fixed',
    top: '50%',
    left: expanded ? '230px' : '0',
    transform: 'translateY(-50%)',
    zIndex: 201,
    width: '22px',
    height: '52px',
    background: 'rgba(99,102,241,0.85)',
    border: '1px solid rgba(99,102,241,0.6)',
    borderLeft: 'none',
    borderRadius: '0 6px 6px 0',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
    boxShadow: '2px 0 8px rgba(99,102,241,0.3)',
  }

  return (
    <>
      {/* 滑出面板 */}
      <div style={panelStyle}>
        {/* 标题行 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
          <span style={{ fontSize: '15px' }}>⚡</span>
          <span style={{ fontWeight: 700, fontSize: '13px', color: '#a5b4fc' }}>稳态仿真</span>
          {overlay && (
            <span
              style={{
                marginLeft: 'auto', fontSize: '10px', color: '#64748b',
                cursor: 'pointer', padding: '1px 6px', borderRadius: '4px',
                background: 'rgba(100,116,139,0.2)',
              }}
              onClick={onClear}
            >
              ✕ 清除
            </span>
          )}
        </div>

        {/* 场景选择 */}
        <div style={{ marginBottom: '10px' }}>
          <div style={{ color: '#64748b', marginBottom: '4px', fontSize: '11px' }}>场景</div>
          <select
            value={scenarioId}
            onChange={e => onScenarioChange(e.target.value)}
            style={{
              width: '100%', background: 'rgba(30,41,59,0.9)',
              border: '1px solid rgba(99,102,241,0.4)', borderRadius: '6px',
              color: '#e2e8f0', fontSize: '11px', padding: '5px 8px',
              cursor: 'pointer', outline: 'none',
            }}
          >
            {scenarios.map(s => (
              <option key={s.id} value={s.id} style={{ background: '#1e293b' }}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* 运行按钮 */}
        <button
          onClick={onRun}
          disabled={isLoading}
          style={{
            width: '100%', padding: '7px 0', borderRadius: '8px', border: 'none',
            background: isLoading ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff', fontSize: '12px', fontWeight: 600,
            cursor: isLoading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '6px', marginBottom: '10px', transition: 'all 0.18s',
          }}
        >
          {isLoading
            ? <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>求解中…</>
            : <>▶ 运行仿真</>
          }
        </button>

        {/* 错误提示 */}
        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: '6px', padding: '6px 8px', color: '#fca5a5',
            fontSize: '11px', marginBottom: '8px',
          }}>
            ⚠ {error}
          </div>
        )}

        {/* 求解结果 */}
        {overlay && summary && (
          <div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              marginBottom: '8px', padding: '5px 8px',
              background: 'rgba(30,41,59,0.6)', borderRadius: '6px', fontSize: '11px',
            }}>
              <span style={{ color: overlay.solver_status === 'converged' ? '#22c55e' : '#f97316' }}>
                {overlay.solver_status === 'converged' ? '✅' : '⚠'}
              </span>
              <span style={{ color: '#94a3b8' }}>
                {overlay.solver_status === 'converged'
                  ? `已收敛 (${overlay.iterations} 轮)`
                  : `未完全收敛`}
              </span>
            </div>

            {[
              { label: '总供气', value: `${summary.total_supply} 万方/天`, color: '#34d399' },
              { label: '总需求', value: `${summary.total_demand} 万方/天`, color: '#60a5fa' },
              {
                label: '未满足',
                value: summary.unserved_demand > 0 ? `${summary.unserved_demand.toFixed(1)} 万` : '无',
                color: summary.unserved_demand > 0 ? '#f87171' : '#4ade80',
              },
              {
                label: '平均利用率',
                value: `${(summary.avg_utilization * 100).toFixed(1)}%`,
                color: summary.avg_utilization > 0.9 ? '#f97316' : '#e2e8f0',
              },
            ].map(row => (
              <div key={row.label} style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: '11px', padding: '2px 0',
                borderBottom: '1px solid rgba(100,116,139,0.1)',
              }}>
                <span style={{ color: '#64748b' }}>{row.label}</span>
                <span style={{ color: row.color, fontWeight: 600 }}>{row.value}</span>
              </div>
            ))}

            {alertCount > 0 && (
              <div style={{
                marginTop: '8px', padding: '5px 8px',
                background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.4)',
                borderRadius: '6px', fontSize: '11px', color: '#fdba74',
                display: 'flex', alignItems: 'center', gap: '5px',
              }}>
                🔔 {alertCount} 个告警点
              </div>
            )}
          </div>
        )}

        {/* 图例 */}
        {overlay && (
          <div style={{ marginTop: '10px', borderTop: '1px solid rgba(100,116,139,0.2)', paddingTop: '8px' }}>
            <div style={{ color: '#475569', fontSize: '10px', marginBottom: '5px' }}>管道利用率</div>
            {[
              { color: '#22c55e', label: '< 70%  正常' },
              { color: '#eab308', label: '70–85%  偏高' },
              { color: '#f97316', label: '85–95%  告警' },
              { color: '#ef4444', label: '> 95%  危险' },
            ].map(item => (
              <div key={item.color} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px', fontSize: '10px' }}>
                <div style={{ width: '20px', height: '3px', background: item.color, borderRadius: '2px', flexShrink: 0 }} />
                <span style={{ color: '#94a3b8' }}>{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 展开/折叠拨片按钮 */}
      <div style={toggleBtnStyle} onClick={() => setExpanded(e => !e)} title={expanded ? '收起仿真面板' : '展开仿真面板'}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
          {/* 告警小红点 */}
          {hasAlert && !expanded && (
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: '#ef4444', marginBottom: '2px',
              boxShadow: '0 0 4px #ef4444',
            }} />
          )}
          {/* 箭头 */}
          <span style={{
            fontSize: '10px', color: '#e2e8f0', lineHeight: 1,
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
            display: 'block',
          }}>▶</span>
          {/* 竖向文字 */}
          <span style={{
            fontSize: '9px', color: '#a5b4fc', fontWeight: 600,
            writingMode: 'vertical-rl', letterSpacing: '1px', marginTop: '4px',
          }}>仿真</span>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </>
  )
}

export default SimPanel
