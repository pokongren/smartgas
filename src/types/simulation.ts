/**
 * 稳态仿真结果类型定义
 * 与后端 /topology-simulation/solve-steady 返回格式完全对齐
 */

/** 节点仿真状态 */
export interface SimNodeResult {
  id: string
  pressure_mpa: number
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
}

/** 完整仿真结果（来自 simulation-overlay 接口） */
export interface SimulationOverlay {
  pilot_id: string
  scenario_id: string
  solver_status: 'converged' | 'max_iter' | 'error'
  iterations: number
  nodes: SimNodeResult[]
  edges: SimEdgeResult[]
  summary: SimSummary
  meta?: SimMeta
}

/** 场景选项 */
export interface ScenarioOption {
  id: string
  label: string
}

/** 主样板场景列表 */
export const MAINLINE_SCENARIOS: ScenarioOption[] = [
  { id: 'steady_base', label: '常规稳态输气' },
  { id: 'zhongwei_compressor_offline', label: '中卫压气站停运' },
  { id: 'zhongwei_trunk_break', label: '中卫附近主干中断' },
  { id: 'yanchi_jingbian_limited', label: '盐池→靖边段限流' },
]

/** 辅样板场景列表 */
export const BRANCH_SCENARIOS: ScenarioOption[] = [
  { id: 'steady_branch_base', label: '常规分输' },
  { id: 'xuedian_load_up', label: '薛店负荷上调' },
  { id: 'changlv_load_up', label: '长铝支线负荷上调' },
  { id: 'branch_limited', label: '支线限流' },
]
