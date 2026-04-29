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
    config?: MapConfig
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
}
