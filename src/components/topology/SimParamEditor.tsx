import React, { useMemo } from 'react'
import type { SeedNodePressure } from '@/services/api'

interface EdgeOption {
  id: string
  name?: string
  defaultLength?: number
  defaultFlowRate?: number
}

interface NodeOverrideInput {
  target_pressure_mpa?: number
  min_pressure_mpa?: number
}

interface GlobalDefaultsInput {
  default_pressure_mpa?: number
  default_temperature_c?: number
  default_flow_rate?: number
  apply_to_sources?: boolean
}

interface SimParamEditorProps {
  seedNodes: SeedNodePressure[]
  edges: EdgeOption[]
  nodeOverrides: Record<string, NodeOverrideInput>
  edgeLengthOverrides: Record<string, number>
  edgeFlowOverrides: Record<string, number>
  globalDefaults: GlobalDefaultsInput
  validationError: string | null
  onNodeOverridesChange: (value: Record<string, NodeOverrideInput>) => void
  onEdgeLengthOverridesChange: (value: Record<string, number>) => void
  onEdgeFlowOverridesChange: (value: Record<string, number>) => void
  onGlobalDefaultsChange: (value: GlobalDefaultsInput) => void
}

const RECOMMENDED_NODE_KEYS = ['古浪', '中卫', '盐池', '靖边', '郑州', '薛店']
const INPUT_FIELD_CLASS =
  'w-full rounded border border-cyan-500/30 bg-black/30 px-1 py-1 text-center text-[11px] text-cyan-200 tabular-nums outline-none placeholder:text-slate-500'
const READONLY_FIELD_CLASS =
  'w-full rounded border border-slate-600/40 bg-slate-950/60 px-1 py-1 text-center text-[11px] text-slate-200 tabular-nums'
const GLOBAL_FIELD_CLASS =
  'w-full rounded border border-cyan-500/30 bg-black/30 px-2 py-1 text-[11px] text-cyan-100 outline-none placeholder:text-slate-500'

function toNumberOrUndefined(raw: string): number | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

function formatDisplayNumber(value: number | undefined | null, digits: number): string {
  if (value == null || !Number.isFinite(value)) return ''
  return Number(value.toFixed(digits)).toString()
}

function updateNodeOverride(
  nodeOverrides: Record<string, NodeOverrideInput>,
  nodeId: string,
  patch: Partial<NodeOverrideInput>,
): Record<string, NodeOverrideInput> {
  const nextMap = { ...nodeOverrides }
  const merged = { ...(nextMap[nodeId] ?? {}), ...patch }
  if (merged.target_pressure_mpa == null && merged.min_pressure_mpa == null) {
    delete nextMap[nodeId]
  } else {
    nextMap[nodeId] = merged
  }
  return nextMap
}

function updateEdgeLengthOverride(
  overrides: Record<string, number>,
  edgeId: string,
  value: number | undefined,
): Record<string, number> {
  const nextMap = { ...overrides }
  if (value == null) {
    delete nextMap[edgeId]
    return nextMap
  }
  nextMap[edgeId] = value
  return nextMap
}

function getReferenceInPressure(node: SeedNodePressure): number | undefined {
  if (typeof node.operating_pressure_in === 'number' && Number.isFinite(node.operating_pressure_in)) {
    return node.operating_pressure_in
  }
  if (typeof node.min_pressure_mpa === 'number' && Number.isFinite(node.min_pressure_mpa)) {
    return node.min_pressure_mpa
  }
  return undefined
}

function getEditableOutPressure(node: SeedNodePressure): number | undefined {
  if (typeof node.target_pressure_mpa === 'number' && Number.isFinite(node.target_pressure_mpa)) {
    return node.target_pressure_mpa
  }
  if (typeof node.operating_pressure_out === 'number' && Number.isFinite(node.operating_pressure_out)) {
    return node.operating_pressure_out
  }
  return undefined
}

function getMinConstraint(node: SeedNodePressure): number | undefined {
  if (typeof node.min_pressure_mpa === 'number' && Number.isFinite(node.min_pressure_mpa)) {
    return node.min_pressure_mpa
  }
  return undefined
}

const SimParamEditor: React.FC<SimParamEditorProps> = ({
  seedNodes,
  edges,
  nodeOverrides,
  edgeLengthOverrides,
  edgeFlowOverrides,
  globalDefaults,
  validationError,
  onNodeOverridesChange,
  onEdgeLengthOverridesChange,
  onEdgeFlowOverridesChange,
  onGlobalDefaultsChange,
}) => {
  const displayNodes = useMemo(() => {
    const filtered = seedNodes.filter((item) => {
      const name = item.name ?? ''
      return RECOMMENDED_NODE_KEYS.some((key) => name.includes(key))
    })
    if (filtered.length > 0) return filtered.slice(0, 8)
    return seedNodes.slice(0, 8)
  }, [seedNodes])

  const displayEdges = useMemo(() => {
    const mainline = edges.filter((item) => item.id.includes('WE1'))
    if (mainline.length > 0) return mainline.slice(0, 8)
    return edges.slice(0, 8)
  }, [edges])

  const nodeOverrideCount = Object.keys(nodeOverrides).length

  return (
    <div className="space-y-3 rounded-lg border border-cyan-500/20 bg-cyan-950/10 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-cyan-200">仿真参数面板</div>
        <div className="text-[10px] text-cyan-100/80">已单独设置 {nodeOverrideCount} 个站场</div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] text-slate-300">全网默认值</div>
          <div className="text-[10px] text-slate-500">没有单独设置的站场会使用这里的参数</div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input
            type="number"
            step="0.01"
            value={globalDefaults.default_pressure_mpa ?? ''}
            placeholder="默认压力 MPa"
            onChange={(event) =>
              onGlobalDefaultsChange({
                ...globalDefaults,
                default_pressure_mpa: toNumberOrUndefined(event.target.value),
              })
            }
            className={GLOBAL_FIELD_CLASS}
          />
          <input
            type="number"
            step="0.1"
            value={globalDefaults.default_temperature_c ?? ''}
            placeholder="默认温度 ℃"
            onChange={(event) =>
              onGlobalDefaultsChange({
                ...globalDefaults,
                default_temperature_c: toNumberOrUndefined(event.target.value),
              })
            }
            className={GLOBAL_FIELD_CLASS}
          />
          <input
            type="number"
            step="0.1"
            value={globalDefaults.default_flow_rate ?? ''}
            placeholder="默认流量 万方/天"
            onChange={(event) =>
              onGlobalDefaultsChange({
                ...globalDefaults,
                default_flow_rate: toNumberOrUndefined(event.target.value),
              })
            }
            className={GLOBAL_FIELD_CLASS}
          />
          <label className="col-span-3 flex items-center gap-1.5 rounded border border-cyan-500/20 bg-black/20 px-2 py-1 text-[11px] text-slate-200">
            <input
              type="checkbox"
              checked={Boolean(globalDefaults.apply_to_sources)}
              onChange={(event) =>
                onGlobalDefaultsChange({
                  ...globalDefaults,
                  apply_to_sources: event.target.checked,
                })
              }
            />
            默认值也应用于气源点
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] text-slate-300">关键站场设置</div>
          <div className="text-[10px] text-slate-500">进站设定只读，出站与最小压力可调</div>
        </div>
        {displayNodes.length === 0 ? (
          <div className="text-[11px] text-slate-400">当前还没有读到站场种子数据</div>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[minmax(54px,1fr)_60px_60px_60px] items-center gap-1 px-0.5">
              <div className="text-[10px] text-slate-500">站场</div>
              <div className="text-center text-[10px] text-slate-500">进站设定</div>
              <div className="text-center text-[10px] text-slate-500">出站设定</div>
              <div className="text-center text-[10px] text-slate-500">最小约束</div>
            </div>
            {displayNodes.map((node) => (
              <div key={node.id} className="grid grid-cols-[minmax(54px,1fr)_60px_60px_60px] items-center gap-1">
                <div
                  className="min-w-0 truncate text-[11px] text-slate-200"
                  title={`${node.name || node.id} (${node.id})`}
                >
                  {node.name || node.id}
                </div>
                <div className={READONLY_FIELD_CLASS}>
                  {formatDisplayNumber(getReferenceInPressure(node), 2) || '--'}
                </div>
                <input
                  type="number"
                  step="0.01"
                  value={
                    nodeOverrides[node.id]?.target_pressure_mpa ??
                    formatDisplayNumber(getEditableOutPressure(node), 2)
                  }
                  placeholder="出站"
                  onChange={(event) =>
                    onNodeOverridesChange(
                      updateNodeOverride(nodeOverrides, node.id, {
                        target_pressure_mpa: toNumberOrUndefined(event.target.value),
                      }),
                    )
                  }
                  className={INPUT_FIELD_CLASS}
                />
                <input
                  type="number"
                  step="0.01"
                  value={
                    nodeOverrides[node.id]?.min_pressure_mpa ??
                    formatDisplayNumber(getMinConstraint(node), 2)
                  }
                  placeholder="最小"
                  onChange={(event) =>
                    onNodeOverridesChange(
                      updateNodeOverride(nodeOverrides, node.id, {
                        min_pressure_mpa: toNumberOrUndefined(event.target.value),
                      }),
                    )
                  }
                  className={INPUT_FIELD_CLASS}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] text-slate-300">关键管段参数</div>
          <div className="text-[10px] text-slate-500">可单独设置长度和流量，留空即使用默认</div>
        </div>
        {displayEdges.length === 0 ? (
          <div className="text-[11px] text-slate-400">当前还没有读到主干管段数据</div>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_72px_72px] items-center gap-1.5 px-0.5">
              <div className="text-[10px] text-slate-500">管段</div>
              <div className="text-center text-[10px] text-slate-500">长度 km</div>
              <div className="text-center text-[10px] text-slate-500">流量 万方/天</div>
            </div>
            {displayEdges.map((edge) => (
              <div key={edge.id} className="grid grid-cols-[1fr_72px_72px] items-center gap-1.5">
                <div className="min-w-0 truncate text-[11px] text-slate-200" title={edge.name || edge.id}>
                  {edge.name || edge.id}
                </div>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={edgeLengthOverrides[edge.id] ?? formatDisplayNumber(edge.defaultLength, 1)}
                  placeholder="长度"
                  onChange={(event) =>
                    onEdgeLengthOverridesChange(
                      updateEdgeLengthOverride(
                        edgeLengthOverrides,
                        edge.id,
                        toNumberOrUndefined(event.target.value),
                      ),
                    )
                  }
                  className={INPUT_FIELD_CLASS}
                />
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={edgeFlowOverrides[edge.id] ?? formatDisplayNumber(edge.defaultFlowRate, 1)}
                  placeholder="流量"
                  onChange={(event) =>
                    onEdgeFlowOverridesChange(
                      updateEdgeLengthOverride(
                        edgeFlowOverrides,
                        edge.id,
                        toNumberOrUndefined(event.target.value),
                      ),
                    )
                  }
                  className={INPUT_FIELD_CLASS}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {validationError && (
        <div className="rounded border border-amber-500/40 bg-amber-950/25 px-2.5 py-2 text-[11px] text-amber-100">
          参数校验未通过：{validationError}
        </div>
      )}
    </div>
  )
}

export default SimParamEditor
