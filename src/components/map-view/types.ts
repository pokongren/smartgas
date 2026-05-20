/**
 * 地图组件类型定义
 */

import type { CSSProperties } from 'react'
import type { PipelineData, PipelineLayerConfig, PipelineEvent } from '@/types'
import type { SimulationOverlay } from '@/types/simulation'

/**
 * 坐标点类型
 */
export interface Coordinate {
    /** 经度 */
    longitude: number
    /** 纬度 */
    latitude: number
}

/**
 * 地图配置类型
 */
export interface MapConfig {
    /** 地图中心点坐标 */
    center: Coordinate
    /** 缩放级别 (3-20) */
    zoom: number
    /** 是否允许缩放 */
    zoomControl?: boolean
    /** 是否允许拖拽 */
    draggable?: boolean
    /** 地图样式主题 */
    theme?: 'light' | 'dark'
    /** 最小缩放级别 */
    minZoom?: number
    /** 最大缩放级别 */
    maxZoom?: number
    /** 是否显示比例尺 */
    showScale?: boolean
    /** 是否显示指南针 */
    showCompass?: boolean
    viewMode?: 'auto' | '2D' | '3D'
    showProvinceLabels?: boolean
    showDistrictLayer?: boolean
    maxRenderNodes?: number
    maxRenderLines?: number
}

/**
 * 地图视图组件 Props
 */
export interface MapViewProps {
    /** 地图配置 */
    config?: Partial<MapConfig>
    /** 容器类名 */
    className?: string
    /** 容器样式 */
    style?: CSSProperties
    /** 管网数据 */
    pipelineData?: PipelineData
    /** 管网图层配置 */
    layerConfig?: PipelineLayerConfig
    /** 地图加载完成回调 */
    onLoad?: (map: any) => void
    /** 地图点击事件回调 */
    onClick?: (coordinate: Coordinate) => void
    /** 管网节点点击回调 */
    onNodeClick?: (event: PipelineEvent) => void
    /** 管网管线点击回调 */
    onLineClick?: (event: PipelineEvent) => void
    /** 管网设备点击回调 */
    onDeviceClick?: (event: PipelineEvent) => void
    /** 仿真覆盖层 */
    simulationOverlay?: SimulationOverlay | null
    /** 仿真中被主动截断的管段 ID，用于和下游零流量区分 */
    simulationCutoffEdgeIds?: string[]
    /** 节点显示模式：full 保持全量，hub 只保留少数枢纽 */
    nodeDisplayMode?: 'full' | 'hub'
    /** 枢纽精简模式下保留的节点类型 */
    hubNodeTypes?: Array<'source' | 'compressor' | 'junction' | 'distribution'>
    /** 阀室显示控制；不传时保持缩放 LOD 自动规则，true 强制显示，false 强制隐藏 */
    showValveRooms?: boolean
}
