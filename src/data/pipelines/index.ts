
import { PipelinePackage } from './types'
import { we1Package } from './we1'
import { we2Package } from './we2'
import { credPackage } from './cred'
import { ptPackage } from './pt'
import { zgPackage } from './zg'
import { zmPackage } from './zm'
import { gnPackage } from './gn'
import { gsPackage } from './gs'

export * from './types'

/**
 * 跨管线共享站点全局去重
 *
 * 同一个物理站场（如"广州压气站"）可能同时是多条管线的起终点，
 * 各管线文件会独立生成同名但不同 ID 的节点，导致地图上叠加多个图标。
 * 此函数保留首次出现的节点，后续重复的节点被移除，
 * 并将引用它的线段 startNodeId/endNodeId 重定向到首次 ID。
 */
function deduplicateNodes(pipelines: PipelinePackage[]): void {
    // 站名 → 首次出现的节点 ID
    const seen = new Map<string, string>()

    for (const pkg of pipelines) {
        for (const layer of pkg.layers) {
            // 收集本层中需要重映射的 ID: 旧 ID → 首次 ID
            const idRemap = new Map<string, string>()

            layer.nodes = layer.nodes.filter(node => {
                const firstId = seen.get(node.name)
                if (firstId) {
                    // 此站名已被其他管线注册过，记录重映射关系后移除
                    idRemap.set(node.id, firstId)
                    return false
                }
                // 首次出现，保留并注册
                seen.set(node.name, node.id)
                return true
            })

            // 重定向线段中引用了被移除节点的 ID
            if (idRemap.size > 0) {
                for (const line of layer.lines) {
                    const remappedStart = idRemap.get(line.startNodeId)
                    if (remappedStart) line.startNodeId = remappedStart

                    const remappedEnd = idRemap.get(line.endNodeId)
                    if (remappedEnd) line.endNodeId = remappedEnd
                }
            }
        }
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
    gsPackage
]

// 执行全局去重（模块加载时自动运行一次）
deduplicateNodes(ALL_PIPELINES)

// 辅助函数：根据ID获取管线
export function getPipelineById(id: string): PipelinePackage | undefined {
    return ALL_PIPELINES.find(p => p.id === id)
}
