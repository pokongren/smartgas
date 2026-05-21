/**
 * 枢纽节点类型定义
 *
 * 用于表达多条管线交汇的复杂节点（如中卫站）
 * 核心概念：端口(Port) + 内部连接(InternalConnection)
 */

import type { Coordinate } from '@/components/map-view/types'

/**
 * 端口方向
 */
export enum PortDirection {
  IN = 'in',           // 进气口
  OUT = 'out',         // 出气口
  BIDIRECTIONAL = 'both'  // 双向
}

/**
 * 流量分配策略
 */
export enum DistributionStrategy {
  PROPORTIONAL = 'proportional',     // 比例分配
  PRIORITY = 'priority',             // 优先级分配
  CAPACITY_BASED = 'capacity_based'  // 按容量分配
}

/**
 * 节点端口 - 表达节点与管线的连接
 */
export interface NodePort {
  /** 端口唯一标识 */
  portId: string

  /** 连接的管线ID */
  pipelineId: string

  /** 连接的管线名称（如：中贵线、西气东输一线） */
  pipelineName: string

  /** 端口方向 */
  direction: PortDirection

  /** 压力范围 [min, max] MPa */
  pressureRange: [number, number]

  /** 该端口的流量能力 万方/天 */
  flowCapacity: number

  /** 端口在节点周围的显示位置（角度，0-360） */
  displayAngle: number

  /** 端口状态 */
  status: 'active' | 'inactive' | 'maintenance'

  /** 站内阀组名称，用于详情面板展示 */
  valveGroupName?: string

  /** 与站外管线的关系 */
  connectionSide?: 'upstream' | 'downstream' | 'interconnect'

  /** 当前通过量 万方/天 */
  currentThroughput?: number

  /** 当前压力 MPa */
  currentPressure?: number

  /** 当前温度 ℃ */
  currentTemperature?: number

  /** 工艺图上的固定位置，用于贴近地图管道走向 */
  diagramPosition?: {
    x: number
    y: number
    labelX: number
    labelY: number
  }
}

/**
 * 端口间连通关系 - 表达管线间的调度关系
 */
export interface PortConnection {
  /** 源端口ID */
  fromPort: string

  /** 目标端口ID */
  toPort: string

  /** 流量分配比例（0.0~1.0） */
  flowRatio: number

  /** 是否启用 */
  isActive: boolean

  /** 优先级（数字越大越高） */
  priority?: number

  /** 备注 */
  remark?: string

  /** 当前通过量 万方/天 */
  currentThroughput?: number

  /** 当前压力 MPa */
  currentPressure?: number

  /** 当前温度 ℃ */
  currentTemperature?: number
}

/**
 * 站内流程阀门 - 用于工艺流程弹窗定位和交互
 */
export interface ProcessValve {
  /** 阀门唯一标识 */
  id: string

  /** 图上短标签，如 V101 */
  label: string

  /** 阀门业务名称 */
  name: string

  /** 工艺图坐标，百分比 */
  x: number

  /** 工艺图坐标，百分比 */
  y: number

  /** 图标旋转角度 */
  angle?: number
}

/**
 * 站内工艺流程展示配置
 */
export interface HubProcessFlowConfig {
  /** 图上方一句话流程说明 */
  summary?: string

  /** 阀门列表 */
  valves?: ProcessValve[]

  /** 连接到阀门的映射，key 格式为 fromPort->toPort */
  connectionValveMap?: Record<string, string[]>
}

/**
 * 枢纽节点扩展属性
 */
export interface HubNodeProps {
  /** 是否为枢纽节点 */
  isHub: true

  /** 端口列表 */
  ports: NodePort[]

  /** 端口间内部连接 */
  internalConnections: PortConnection[]

  /** 流量分配策略 */
  distributionStrategy: DistributionStrategy

  /** 枢纽等级 */
  hubLevel: 1 | 2 | 3  // 1=国家级枢纽, 2=省级枢纽, 3=区域枢纽

  /** 站内工艺流程展示配置 */
  processFlow?: HubProcessFlowConfig
}

/**
 * 普通节点扩展属性
 */
export interface RegularNodeProps {
  /** 非枢纽节点 */
  isHub: false

  /** 连接的管线ID列表 */
  connectedPipelines: string[]
}

/**
 * 节点扩展属性（联合类型）
 */
export type NodeExtension = HubNodeProps | RegularNodeProps

/**
 * 枢纽节点（完整类型，包含基础信息和扩展）
 */
export interface HubNode {
  /** 节点ID */
  id: string

  /** 节点名称 */
  name: string

  /** 节点类型 */
  type: 'compressor' | 'distribution' | 'source' | 'junction'

  /** 坐标 */
  coordinate: Coordinate

  /** 设计压力 MPa */
  designPressure: number

  /** 运行压力 MPa */
  operatingPressure?: number

  /** 处理能力 万方/天 */
  capacity?: number

  /** 节点扩展属性 */
  extension: NodeExtension
}

/**
 * 端口点击事件
 */
export interface PortClickEvent {
  port: NodePort
  node: HubNode
  position: Coordinate
  originalEvent: any
}

/**
 * 内部连接点击事件
 */
export interface ConnectionClickEvent {
  connection: PortConnection
  fromPort: NodePort
  toPort: NodePort
  node: HubNode
  position: Coordinate
}

/**
 * 枢纽节点可视化配置
 */
export interface HubVisualConfig {
  /** 是否显示端口 */
  showPorts: boolean

  /** 是否显示端口标签 */
  showPortLabels: boolean

  /** 是否显示内部连接线 */
  showInternalConnections: boolean

  /** 是否显示流量方向动画 */
  showFlowAnimation: boolean

  /** 端口标记大小 */
  portMarkerSize: number

  /** 内部连接线颜色 */
  connectionLineColor: string

  /** 内部连接线宽度 */
  connectionLineWidth: number

  /** 端口默认显示缩放级别 */
  minZoomForPorts: number

  /** 连接线默认显示缩放级别 */
  minZoomForConnections: number
}

/**
 * 默认枢纽可视化配置
 */
export const DEFAULT_HUB_VISUAL_CONFIG: HubVisualConfig = {
  showPorts: true,
  showPortLabels: true,
  showInternalConnections: true,
  showFlowAnimation: true,
  portMarkerSize: 10,
  connectionLineColor: '#fbbf24',  // 琥珀色
  connectionLineWidth: 2,
  minZoomForPorts: 8,
  minZoomForConnections: 9
}
