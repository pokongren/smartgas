import { PipelineNode, PipelineLine } from '@/types'

/**
 * 管线层级定义 (对应一个干线或一个支线)
 */
export interface PipelineLayer {
    id?: string             // 稳定层级 ID，优先用于状态管理和跨视图引用
    name: string            // 层级名称 (如 "西二线干线", "丽江支线")
    type: 'trunk' | 'branch'
    nodes: PipelineNode[]
    lines: PipelineLine[]
    visible?: boolean       // 默认可见性
}

/**
 * 管线数据包 (对应一条完整的管线系统)
 */
export interface PipelinePackage {
    id: string              // 唯一标识 (如 'we2', 'zm')
    name: string            // 显示名称 (如 "西气东输二线")
    color: string           // 主题色
    layers: PipelineLayer[] // 包含的所有层级 (通常第0个是干线)
}
