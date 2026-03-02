
import { PipelinePackage } from './types'
import { we1Package } from './we1'
import { we2Package } from './we2'
import { credPackage } from './cred'
import { ptPackage } from './pt'
import { zgPackage } from './zg'
import { zmPackage } from './zm'
import { gnPackage } from './gn'
import { gsPackage } from './gs'
import { sj4Package } from './sj4'

export * from './types'

/**
 * 跨管线共享站点全局去重
 *
 * 同一个物理站场（如"广州压气站"）可能同时是多条管线的起终点，
 * 各管线文件会独立生成同名但不同 ID 的节点，导致地图上叠加多个图标。
 * 此函数保留首次出现的节点，后续同名重复节点将被全局移除，
 * 并确保所有图层线段中对其引用都会被正确重定向。
 */
function deduplicateNodes(pipelines: PipelinePackage[]): void {
    const seen = new Map<string, string>()
    const idRemap = new Map<string, string>()

    // 1. 遍历所有管线图层，进行全局节点去重并生成统一重映射表
    pipelines.forEach(pkg => pkg.layers.forEach(layer => {
        layer.nodes = layer.nodes.filter(node => {
            const firstId = seen.get(node.name)
            if (firstId) {
                idRemap.set(node.id, firstId) // 记录重映射关系：重复节点ID -> 首次节点ID
                return false
            }
            seen.set(node.name, node.id)
            return true
        })
    }))

    // 2. 全局无差别重定向所有线段端点引用（解决跨管线节点引用问题）
    if (idRemap.size > 0) {
        pipelines.forEach(pkg => pkg.layers.forEach(layer => {
            layer.lines.forEach(line => {
                line.startNodeId = idRemap.get(line.startNodeId) ?? line.startNodeId
                line.endNodeId = idRemap.get(line.endNodeId) ?? line.endNodeId
            })
        }))
    }
}

// 所有管线数据包
export const ALL_PIPELINES: PipelinePackage[] = [
    we1Package,
    we2Package,
    credPackage,
    ptPackage,
    zgPackage,
    zmPackage,
    gnPackage,
    gsPackage,
    sj4Package
]

// 执行全局去重（模块加载时自动运行一次）
deduplicateNodes(ALL_PIPELINES)

// 辅助函数：根据ID获取管线
export function getPipelineById(id: string): PipelinePackage | undefined {
    return ALL_PIPELINES.find(p => p.id === id)
}
