/**
 * 稳态仿真结果类型定义
 * 与后端 /topology-simulation/solve-steady 返回格式完全对齐
 */

/** 节点仿真状态 */
export interface SimNodeResult {
  id: string
  pressure_mpa: number
  pressure_in_mpa?: number
  temperature_c?: number
  demand_served: number
  supply_actual: number
  alert_level: 'normal' | 'warning' | 'critical'
}

/** 管段仿真状态 */
export interface SimEdgeResult {
  id: string
  flow_rate: number       // 万方/天
  direction: 'forward' | 'reverse' | 'zero'
  utilization: number     // 0.0 ~ 1.0+
  alert_level: 'normal' | 'warning' | 'critical'
  color: string           // 后端直接给好的颜色值，前端不用算
  width_factor: number    // 线宽系数，前端乘以基础宽度
}

/** 全局汇总 */
export interface SimSummary {
  total_supply: number
  total_demand: number
  unserved_demand: number
  avg_utilization: number
  alert_count: number
}

/** 覆盖层元数据 */
export interface SimMeta {
  pilot_id: string
  scenario_id: string
  available_scenarios: string[]
  node_count: number
  edge_count: number
  solver_input_version?: string
}

export interface SimulationSnapshotSummary {
  snapshot_version: string
  run_id: string
  pilot_id: string
  scenario_id: string
  generated_at: string
  saved_at: string
  solver_status: 'converged' | 'max_iter' | 'error'
  iterations: number
  output_summary: SimSummary
  key_nodes: Array<{
    id: string
    pressure_mpa: number
    temperature_c?: number
    alert_level: 'normal' | 'warning' | 'critical'
    demand_served: number
    supply_actual: number
  }>
  key_edges: Array<{
    id: string
    flow_rate: number
    utilization: number
    direction: 'forward' | 'reverse' | 'zero'
    alert_level: 'normal' | 'warning' | 'critical'
  }>
  snapshot_path?: string
}

export interface SimulationSnapshotRecord extends SimulationSnapshotSummary {
  input_summary: {
    solver_input_version?: string
    seed_file?: string
    node_count: number
    edge_count: number
    valve_count: number
    scenario_count: number
    available_scenarios: string[]
  }
  result: SimulationOverlay
}

export interface SimulationDeltaMetric {
  current: number
  baseline: number
  delta: number
}

export interface SimulationComparison {
  baseline_run_id: string
  baseline_scenario_id: string
  current_run_id: string
  current_scenario_id: string
  summary_delta: {
    total_supply: SimulationDeltaMetric
    total_demand: SimulationDeltaMetric
    unserved_demand: SimulationDeltaMetric
    avg_utilization: SimulationDeltaMetric
    alert_count: SimulationDeltaMetric
  }
  top_node_pressure_changes: Array<{
    id: string
    current_pressure_mpa: number
    baseline_pressure_mpa: number
    delta_pressure_mpa: number
  }>
  top_edge_flow_changes: Array<{
    id: string
    current_flow_rate: number
    baseline_flow_rate: number
    delta_flow_rate: number
  }>
}

export interface SimulationTrialRunItem {
  scenario_id: string
  label: string
  covered: boolean
  snapshot_count: number
  last_run_id?: string
  last_saved_at?: string
}

/** 完整仿真结果（来自 simulation-overlay 接口） */
export interface SimulationOverlay {
  pilot_id: string
  scenario_id: string
  run_id: string
  generated_at: string
  solver_status: 'converged' | 'max_iter' | 'error'
  iterations: number
  nodes: SimNodeResult[]
  edges: SimEdgeResult[]
  summary: SimSummary
  meta: SimMeta
}

/** 场景选项 */
export interface ScenarioOption {
  id: string
  label: string
}

export interface SimulationPilotConfig {
  id: string
  label: string
  scenarios: ScenarioOption[]
}

export interface SimulationInitialInput {
  node_overrides?: Array<{
    node_id: string
    target_pressure_mpa?: number
    min_pressure_mpa?: number
    temperature_c?: number
    supply_max?: number
    nominal_flow?: number
    supply_nominal?: number
    compressor_enabled?: boolean
  }>
  edge_overrides?: Array<{
    edge_id: string
    flow_rate?: number
    length_km?: number
    max_flow?: number
    status?: 'open' | 'limited' | 'closed'
  }>
  default_pressure_mpa?: number
  default_temperature_c?: number
  default_flow_rate?: number
  apply_to_sources?: boolean
}

/** 主样板场景列表 */
export const MAINLINE_SCENARIOS: ScenarioOption[] = [
  { id: 'steady_base', label: '常规稳态输气' },
  { id: 'zhongwei_compressor_offline', label: '中卫压气站停运' },
  { id: 'zhongwei_trunk_break', label: '中卫附近主干中断' },
  { id: 'yanchi_jingbian_limited', label: '盐池→靖边段限流' },
]

/** 中卫到上海白鹤全段主样板场景列表 */
export const ZHONGWEI_BAIHE_PILOT_ID = 'zhongwei_shanghai_baihe'

export const ZHONGWEI_BAIHE_SCENARIOS: ScenarioOption[] = [
  { id: 'steady_base', label: '常规稳态输气' },
  { id: 'zhongwei_supply_pressure_drop', label: '中卫出站压力下调' },
  { id: 'zhengzhou_compressor_offline', label: '郑州压气站停运' },
  { id: 'east_china_peak_demand', label: '华东末端负荷上调' },
  { id: 'baihe_delivery_limited', label: '白鹤末端交付受限' },
]

/** 辅样板场景列表 */
export const BRANCH_SCENARIOS: ScenarioOption[] = [
  { id: 'steady_branch_base', label: '常规分输' },
  { id: 'xuedian_load_up', label: '薛店负荷上调' },
  { id: 'changlv_load_up', label: '长铝支线负荷上调' },
  { id: 'branch_limited', label: '支线限流' },
]

export const DEFAULT_WE1_PILOT_ID = ZHONGWEI_BAIHE_PILOT_ID

export const SIMULATION_PILOT_CONFIGS: Record<string, SimulationPilotConfig> = {
  [ZHONGWEI_BAIHE_PILOT_ID]: {
    id: ZHONGWEI_BAIHE_PILOT_ID,
    label: '中卫-上海白鹤',
    scenarios: ZHONGWEI_BAIHE_SCENARIOS,
  },
  mainline_zhongwei_jingbian: {
    id: 'mainline_zhongwei_jingbian',
    label: '中卫-靖边旧样板',
    scenarios: MAINLINE_SCENARIOS,
  },
}

export function resolveSimulationPilotConfig(pilotId?: string | null): SimulationPilotConfig {
  const id = (pilotId || '').trim()
  return SIMULATION_PILOT_CONFIGS[id] || SIMULATION_PILOT_CONFIGS[DEFAULT_WE1_PILOT_ID]
}
