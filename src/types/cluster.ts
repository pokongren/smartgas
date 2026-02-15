import type { PipelineNode } from './pipeline'

/**
 * 聚合节点组
 */
export interface ClusterGroup {
    /** 聚合组唯一标识（基于坐标生成） */
    id: string

    /** 中心坐标 */
    coordinate: {
        longitude: number
        latitude: number
    }

    /** 聚合的节点列表 */
    nodes: PipelineNode[]

    /** 节点类型统计 */
    typeStats: {
        compressor: number    // 压气站数量
        distribution: number  // 分输站数量
        valve: number         // 阀室数量
        other: number         // 其他类型数量
    }

    /** 是否包含重要站场 */
    hasImportantStation: boolean
}

/**
 * 聚合标记点击事件数据
 */
export interface ClusterClickEvent {
    /** 聚合组数据 */
    cluster: ClusterGroup

    /** 点击位置 */
    position: {
        longitude: number
        latitude: number
    }

    /** 原始地图事件 */
    originalEvent: any
}
