/**
 * 管线数据中心（API 驱动版）
 *
 * 所有管线数据从后端 /api/pipeline-packages API 获取，
 * 前端不再硬编码任何管线节点/管段数据。
 *
 * 策略：
 * - loadAllPipelines()：异步加载 + 内存缓存，首次调用走网络，后续直接返回
 * - ALL_PIPELINES：向后兼容的同步引用，loadAllPipelines() 成功后自动填充
 * - 去重逻辑保留：跨管线共享站点仍然需要全局去重
 */

import { PipelinePackage } from './types'
import { pipelinePackageAPI } from '@/services/api'

export * from './types'

// 跨管线共享站点全局去重
// NOTE: 阀室(valve)类型节点不参与名称去重——不同管线系统的阀室天然同名
// （如"1#阀室""2#阀室"）但地理位置完全不同，强制合并会产生跨越数十度的飞线
function deduplicateNodes(pipelines: PipelinePackage[]): void {
    const seen = new Map<string, string>()
    const idRemap = new Map<string, string>()

    // 1. 遍历所有管线图层，进行全局节点去重并生成统一重映射表
    pipelines.forEach(pkg => pkg.layers.forEach(layer => {
        layer.nodes = layer.nodes.filter(node => {
            // 阀室类型跳过去重，避免跨系统同名阀室被错误合并
            if (node.type === 'valve') return true

            const firstId = seen.get(node.name)
            if (firstId) {
                idRemap.set(node.id, firstId)
                return false
            }
            seen.set(node.name, node.id)
            return true
        })
    }))

    // 2. 全局无差别重定向所有线段端点引用
    if (idRemap.size > 0) {
        pipelines.forEach(pkg => pkg.layers.forEach(layer => {
            layer.lines.forEach(line => {
                line.startNodeId = idRemap.get(line.startNodeId) ?? line.startNodeId
                line.endNodeId = idRemap.get(line.endNodeId) ?? line.endNodeId
            })
        }))
    }
}

// 图层过滤（干线全部保留，支线按白名单控制）
function filterLayers(pipelines: PipelinePackage[]): void {
    // 陕京四线只保留这两条支线
    const sj4BranchKeywords = ['宝坻', '西集', '密云', '香河']
    pipelines.forEach(pkg => {
        pkg.layers = pkg.layers.filter(layer => {
            if (layer.type === 'trunk') return true
            if (layer.nodes.length === 0 && layer.lines.length === 0) return false
            // 南昌-上海支干线：保留全部支线
            if (pkg.id === 'ncsh') return true
            // 陕京四线：只保留宝坻-西集、密云-香河
            if (pkg.id === 'sj4') return sj4BranchKeywords.some(kw => layer.name.includes(kw))
            return false
        })
    })
}

// ============ 缓存和同步引用 ============

/** 缓存的管线数据（loadAllPipelines 成功后填充） */
let _cachedPackages: PipelinePackage[] | null = null

/** 加载状态 Promise（防止并发重复请求） */
let _loadingPromise: Promise<PipelinePackage[]> | null = null

/**
 * 向后兼容的同步引用
 *
 * 初始为空数组，loadAllPipelines() 成功后会原地填充内容。
 * 旧代码中直接引用 ALL_PIPELINES 的地方仍可工作，但必须确保
 * 在组件 useEffect 中先 await loadAllPipelines() 再使用。
 */
export const ALL_PIPELINES: PipelinePackage[] = []

/** 主动失效缓存：用于拓扑捏合后强制重新拉取后端数据 */
export function invalidatePipelineCache(): void {
    _cachedPackages = null
    _loadingPromise = null
    ALL_PIPELINES.length = 0
}

/**
 * 异步加载所有管线数据（带缓存）
 *
 * 首次调用从 /api/pipeline-packages 获取数据，执行去重和过滤后缓存。
 * 后续调用直接返回缓存。同时填充 ALL_PIPELINES 同步引用。
 */
export async function loadAllPipelines(): Promise<PipelinePackage[]> {
    // 已有缓存直接返回
    if (_cachedPackages) return _cachedPackages

    // 防止并发重复请求
    if (_loadingPromise) return _loadingPromise

    _loadingPromise = (async () => {
        try {
            console.log('[Pipelines] 从后端 API 加载管线数据...')
            const resp = await pipelinePackageAPI.getAll()
            const packages: PipelinePackage[] = resp.data

            // 执行图层过滤和节点去重
            filterLayers(packages)
            deduplicateNodes(packages)

            // 填充缓存和同步引用
            _cachedPackages = packages
            ALL_PIPELINES.length = 0
            ALL_PIPELINES.push(...packages)

            console.log(`[Pipelines] 加载完成: ${packages.length} 个管线系统`)
            return packages
        } catch (err) {
            console.error('[Pipelines] API 加载失败:', err)
            _loadingPromise = null
            throw err
        }
    })()

    return _loadingPromise
}

// 辅助函数：根据 ID 获取管线
export function getPipelineById(id: string): PipelinePackage | undefined {
    return ALL_PIPELINES.find(p => p.id === id)
}
