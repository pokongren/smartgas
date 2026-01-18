/**
 * 管网数据类型定义
 * 
 * 定义智慧燃气管网系统中的核心数据结构
 */

import type { Coordinate } from '@/components/map-view/types'

/**
 * 节点类型枚举
 */
export enum NodeType {
    /** 阀门 */
    VALVE = 'valve',
    /** 接口 */
    INTERFACE = 'interface',
    /** 连接点 */
    JUNCTION = 'junction',
    /** 调压站 */
    REGULATOR = 'regulator',
    /** 计量站 */
    METERING = 'metering',
}

/**
 * 设备类型枚举
 */
export enum DeviceType {
    /** 压力传感器 */
    PRESSURE_SENSOR = 'pressure_sensor',
    /** 流量传感器 */
    FLOW_SENSOR = 'flow_sensor',
    /** 温度传感器 */
    TEMPERATURE_SENSOR = 'temperature_sensor',
    /** 泄漏检测器 */
    LEAK_DETECTOR = 'leak_detector',
    /** 监控摄像头 */
    CAMERA = 'camera',
}

/**
 * 管线状态枚举
 */
export enum PipelineStatus {
    /** 正常运行 */
    NORMAL = 'normal',
    /** 维修中 */
    MAINTENANCE = 'maintenance',
    /** 故障 */
    FAULT = 'fault',
    /** 已停用 */
    DISABLED = 'disabled',
}

/**
 * 压力等级枚举
 */
export enum PressureLevel {
    /** 高压 (>1.6 MPa) */
    HIGH = 'high',
    /** 次高压 (0.8-1.6 MPa) */
    MEDIUM_HIGH = 'medium_high',
    /** 中压 (0.01-0.8 MPa) */
    MEDIUM = 'medium',
    /** 低压 (<0.01 MPa) */
    LOW = 'low',
}

/**
 * 管网节点
 */
export interface PipelineNode {
    /** 节点唯一标识 */
    id: string
    /** 节点名称 */
    name: string
    /** 节点类型 */
    type: NodeType
    /** 节点坐标 */
    coordinate: Coordinate
    /** 压力等级 */
    pressureLevel: PressureLevel
    /** 当前状态 */
    status: PipelineStatus
    /** 安装日期 */
    installDate?: string
    /** 最后检修日期 */
    lastMaintenanceDate?: string
    /** 备注信息 */
    remarks?: string
    /** 扩展属性 */
    properties?: Record<string, any>
}

/**
 * 管网管线
 */
export interface PipelineLine {
    /** 管线唯一标识 */
    id: string
    /** 管线名称 */
    name: string
    /** 起始节点 ID */
    startNodeId: string
    /** 结束节点 ID */
    endNodeId: string
    /** 管线路径坐标数组 */
    path: Coordinate[]
    /** 管径 (mm) */
    diameter: number
    /** 管材 */
    material: string
    /** 压力等级 */
    pressureLevel: PressureLevel
    /** 长度 (m) */
    length: number
    /** 当前状态 */
    status: PipelineStatus
    /** 设计压力 (MPa) */
    designPressure?: number
    /** 当前压力 (MPa) */
    currentPressure?: number
    /** 流量 (m³/h) */
    flowRate?: number
    /** 安装日期 */
    installDate?: string
    /** 最后检修日期 */
    lastMaintenanceDate?: string
    /** 备注信息 */
    remarks?: string
    /** 扩展属性 */
    properties?: Record<string, any>
}

/**
 * 管网设备
 */
export interface PipelineDevice {
    /** 设备唯一标识 */
    id: string
    /** 设备名称 */
    name: string
    /** 设备类型 */
    type: DeviceType
    /** 设备坐标 */
    coordinate: Coordinate
    /** 关联节点 ID (可选) */
    nodeId?: string
    /** 关联管线 ID (可选) */
    lineId?: string
    /** 当前状态 */
    status: PipelineStatus
    /** 设备型号 */
    model?: string
    /** 制造商 */
    manufacturer?: string
    /** 当前读数 */
    currentValue?: number
    /** 读数单位 */
    unit?: string
    /** 最后更新时间 */
    lastUpdateTime?: string
    /** 安装日期 */
    installDate?: string
    /** 最后维护日期 */
    lastMaintenanceDate?: string
    /** 在线状态 */
    online?: boolean
    /** 备注信息 */
    remarks?: string
    /** 扩展属性 */
    properties?: Record<string, any>
}

/**
 * 管网数据集合
 */
export interface PipelineData {
    /** 节点列表 */
    nodes: PipelineNode[]
    /** 管线列表 */
    lines: PipelineLine[]
    /** 设备列表 */
    devices: PipelineDevice[]
}

/**
 * 管网图层配置
 */
export interface PipelineLayerConfig {
    /** 是否显示节点 */
    showNodes?: boolean
    /** 是否显示管线 */
    showLines?: boolean
    /** 是否显示设备 */
    showDevices?: boolean
    /** 节点图标大小 */
    nodeIconSize?: number
    /** 管线宽度 */
    lineWidth?: number
    /** 设备图标大小 */
    deviceIconSize?: number
    /** 是否显示标签 */
    showLabels?: boolean
}

/**
 * 管网事件数据
 */
export interface PipelineEvent {
    /** 事件类型 */
    type: 'node' | 'line' | 'device'
    /** 事件目标 ID */
    targetId: string
    /** 事件目标数据 */
    data: PipelineNode | PipelineLine | PipelineDevice
    /** 原始事件 */
    originalEvent?: any
}
