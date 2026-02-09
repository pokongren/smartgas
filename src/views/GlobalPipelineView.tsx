import React, { useMemo, useState } from 'react'
import MapView from '@/components/map-view/MapView'
import { ALL_PIPELINES, PipelinePackage, PipelineLayer } from '@/data/pipelines'
import type { PipelineData, PipelineLine, PipelineNode } from '@/types'

/**
 * 全管线统一视图 (重构版)
 * 使用标准化的 PipelinePackage 数据源
 */
const GlobalPipelineView: React.FC = () => {
    // 状态管理
    // 展开状态: key是 pipeline.id (如 'we2')
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ 'we1': true })

    // 可见性状态: key是 layer.name (如 "西二线干线", "丽江支线")
    const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {}
        ALL_PIPELINES.forEach(pkg => {
            pkg.layers.forEach(layer => {
                // 默认可见性: 如果 layer.visible 未定义则默认为 true
                initial[layer.name] = layer.visible ?? true
            })
        })
        return initial
    })

    // 切换分组展开
    const toggleGroupExpand = (pipelineId: string) => {
        setExpandedGroups(prev => ({ ...prev, [pipelineId]: !prev[pipelineId] }))
    }

    // 切换单个图层可见性
    const toggleLayer = (layerName: string) => {
        setVisibleLayers(prev => ({ ...prev, [layerName]: !prev[layerName] }))
    }

    // 切换整个管线包可见性
    const togglePackageVisibility = (pkg: PipelinePackage) => {
        const layerNames = pkg.layers.map(l => l.name)
        const allVisible = layerNames.every(name => visibleLayers[name])

        const newState = { ...visibleLayers }
        layerNames.forEach(name => newState[name] = !allVisible)
        setVisibleLayers(newState)
    }

    // 计算当前显示的管道数据
    const pipelineData = useMemo<PipelineData>(() => {
        const allNodes: PipelineNode[] = []
        const allLines: PipelineLine[] = []

        console.log('🔍 ALL_PIPELINES 数量:', ALL_PIPELINES.length)
        ALL_PIPELINES.forEach(pkg => {
            console.log(`  📦 ${pkg.name}: ${pkg.layers.length} 层`)
            pkg.layers.forEach(layer => {
                const isVisible = visibleLayers[layer.name]
                console.log(`    📌 ${layer.name}: visible=${isVisible}, nodes=${layer.nodes?.length}, lines=${layer.lines?.length}`)
                if (isVisible) {
                    allNodes.push(...layer.nodes)
                    allLines.push(...layer.lines)
                }
            })
        })

        console.log(`✅ 最终数据: ${allNodes.length} 节点, ${allLines.length} 管道段`)
        return { nodes: allNodes, lines: allLines, devices: [] }
    }, [visibleLayers])

    // 统计信息
    const stats = useMemo(() => ({
        stations: pipelineData.nodes.length,
        pipelines: pipelineData.lines.length,
        groups: ALL_PIPELINES.length
    }), [pipelineData])

    return (
        <div className="h-screen w-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900">
            {/* 标题栏 */}
            <div className="absolute top-0 left-0 right-0 z-10 bg-black/50 backdrop-blur-sm border-b border-blue-500/30">
                <div className="container mx-auto px-6 py-4">
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                        <span className="material-symbols-outlined text-3xl text-blue-400">public</span>
                        全国管网统一视图
                    </h1>
                    <p className="text-sm text-gray-300 mt-1">
                        站场: {stats.stations} | 管道段: {stats.pipelines} | 管线组: {stats.groups}
                    </p>
                </div>
            </div>

            {/* 地图 */}
            <MapView pipelineData={pipelineData} />

            {/* 图层控制面板 - 树形结构 */}
            <div className="absolute top-24 left-6 z-10 bg-black/70 backdrop-blur-sm rounded-lg p-3 border border-blue-500/30 w-72 max-h-[75vh] overflow-y-auto">
                <h3 className="text-white text-sm font-semibold mb-2 flex items-center gap-2 pb-2 border-b border-gray-700">
                    <span className="material-symbols-outlined text-lg">toc</span>
                    管线目录
                </h3>

                <div className="space-y-1">
                    {ALL_PIPELINES.map(pkg => {
                        const layerNames = pkg.layers.map(l => l.name)
                        const isAllVisible = layerNames.every(n => visibleLayers[n])
                        const isPartialVisible = !isAllVisible && layerNames.some(n => visibleLayers[n])
                        const hasBranches = pkg.layers.length > 1

                        return (
                            <div key={pkg.id} className="px-1">
                                {/* 组头部 (管线名) */}
                                <div className="flex items-center gap-2 hover:bg-white/5 p-1 rounded transition-colors select-none">
                                    {/* 展开/收起箭头 */}
                                    {hasBranches ? (
                                        <button
                                            onClick={() => toggleGroupExpand(pkg.id)}
                                            className="text-gray-400 hover:text-white transition-colors"
                                        >
                                            <span className="material-symbols-outlined text-xl">
                                                {expandedGroups[pkg.id] ? 'expand_more' : 'chevron_right'}
                                            </span>
                                        </button>
                                    ) : (
                                        <span className="w-5"></span>
                                    )}

                                    {/* 复选框 - 控制整个组 */}
                                    <input
                                        type="checkbox"
                                        ref={input => {
                                            if (input) input.indeterminate = isPartialVisible
                                        }}
                                        checked={isAllVisible}
                                        onChange={() => togglePackageVisibility(pkg)}
                                        className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-blue-500 cursor-pointer"
                                    />

                                    {/* 文本标签 */}
                                    <span
                                        onClick={() => hasBranches && toggleGroupExpand(pkg.id)}
                                        className="text-white font-medium text-sm flex-1 cursor-pointer flex items-center gap-2"
                                    >
                                        <span
                                            className="w-2 h-2 rounded-full"
                                            style={{ backgroundColor: pkg.color }}
                                        ></span>
                                        {pkg.name}
                                    </span>
                                </div>

                                {/* 图层列表 (子节点) */}
                                {expandedGroups[pkg.id] && hasBranches && (
                                    <div className="ml-8 mt-1 space-y-1 border-l border-gray-700 pl-2">
                                        {pkg.layers.map(layer => (
                                            <label key={layer.name} className="flex items-center gap-2 p-1 hover:bg-white/5 rounded cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={visibleLayers[layer.name]}
                                                    onChange={() => toggleLayer(layer.name)}
                                                    className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 accent-blue-400"
                                                />
                                                <span
                                                    className={`w-1.5 h-1.5 rounded-full ${layer.type === 'trunk' ? 'opacity-100' : 'opacity-60'}`}
                                                    style={{ backgroundColor: pkg.color }}
                                                ></span>
                                                <span className="text-gray-300 text-sm">
                                                    {layer.type === 'trunk' ? '干线' : layer.name.replace('支线', '')}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* 图例 */}
            <div className="absolute bottom-6 right-6 z-10 bg-black/70 backdrop-blur-sm rounded-lg px-4 py-3 border border-blue-500/30">
                <div className="space-y-2 text-sm">
                    {ALL_PIPELINES.map(pkg => (
                        <div key={pkg.id} className="flex items-center gap-2">
                            <div className="w-6 h-1 rounded" style={{ backgroundColor: pkg.color }} />
                            <span className="text-white">{pkg.name}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default GlobalPipelineView
