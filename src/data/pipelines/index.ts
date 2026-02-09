
import { PipelinePackage } from './types'
import { we1Package } from './we1'

export * from './types'

// 所有管线数据包
export const ALL_PIPELINES: PipelinePackage[] = [
    we1Package
]

// 辅助函数：根据ID获取管线
export function getPipelineById(id: string): PipelinePackage | undefined {
    return ALL_PIPELINES.find(p => p.id === id)
}
