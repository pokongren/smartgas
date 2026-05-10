/**
 * 管线数据中心（API 驱动版）
 *
 * 所有管线数据从后端 /api/pipeline-packages API 获取，
 * 前端不再硬编码任何管线节点/管段数据。
 *
 * 策略：
 * - loadAllPipelines()：异步加载 + 内存缓存，首次调用走网络，后续直接返回
 * - ALL_PIPELINES：向后兼容的同步引用，loadAllPipelines() 成功后自动填充
 * - 去重逻辑收敛：仅按稳定节点 ID 去重，避免按站名误合并同名异点
 */

import { PipelinePackage } from './types'
import { pipelinePackageAPI } from '@/services/api'
import { normalizePipelinePackages } from './transform'

export * from './types'
export * from './transform'

// 跨管线共享站点全局去重
// 共享站点/JunctionGroup 已由后端显式输出稳定 ID，前端仅按节点 ID 去重。
// 不再按站名硬合并，避免把同名异点错误吸附成一个节点。
function deduplicateNodes(pipelines: PipelinePackage[]): void {
    const seenNodeIds = new Set<string>()
    const coordinateById = new Map<string, { longitude: number; latitude: number; name: string }>()

    pipelines.forEach(pkg => pkg.layers.forEach(layer => {
        layer.nodes = layer.nodes.filter(node => {
            const existing = coordinateById.get(node.id)
            if (existing) {
                const sameLongitude = existing.longitude === node.coordinate.longitude
                const sameLatitude = existing.latitude === node.coordinate.latitude
                if (!sameLongitude || !sameLatitude) {
                    console.warn(
                        `[Pipelines] 节点 ID 重复但坐标不一致，保留首次出现节点: ${node.id} (${existing.name} / ${node.name})`
                    )
                }
            } else {
                coordinateById.set(node.id, {
                    longitude: node.coordinate.longitude,
                    latitude: node.coordinate.latitude,
                    name: node.name,
                })
            }

            if (seenNodeIds.has(node.id)) {
                return false
            }
            seenNodeIds.add(node.id)
            return true
        })
    }))
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
            // 广深支干线：取消樟木头支线，只保留深圳 LNG 接入支线
            if (pkg.id === 'gs') {
                const isZhangmutouBranch = layer.name.includes('樟木头') || layer.id?.endsWith(':GS-B1')
                return !isZhangmutouBranch
            }
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
            const packages: PipelinePackage[] = normalizePipelinePackages(resp.data)

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
