import React, { useMemo, useState, useCallback } from 'react'
import MapView from '@/components/map-view/MapView'
import { ALL_PIPELINES, PipelinePackage, PipelineLayer } from '@/data/pipelines'
import type { PipelineData, PipelineLine, PipelineNode } from '@/types'
import PipelineEditorOverlay from './PipelineEditorOverlay'

/**
 * 全管线统一视图 (性能优化版)
 * 使用标准化的 PipelinePackage 数据源
 * 
 * 优化点：
 * 1. 使用 for 循环替代 forEach + 展开运算符，减少内存分配
 * 2. useMemo 缓存计算结果
 * 3. 减少不必要的重新渲染
 */
const GlobalPipelineView: React.FC = () => {
    // 状态管理
    const [mapInstance, setMapInstance] = useState<any>(null)
    const [isEditMode, setIsEditMode] = useState(false)

    // 使用 useCallback 稳定回调引用，避免触发 MapView 无限循环
    const handleMapLoad = useCallback((map: any) => {
        setMapInstance(map)
    }, [])

    // 展开状态
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ 'we1': true })

    // 可见性状态 - 使用懒加载初始化
    const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {}
        for (let i = 0; i < ALL_PIPELINES.length; i++) {
            const pkg = ALL_PIPELINES[i]
            for (let j = 0; j < pkg.layers.length; j++) {
                const layer = pkg.layers[j]
                initial[layer.name] = layer.visible ?? true
            }
        }
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
        for (let i = 0; i < layerNames.length; i++) {
            newState[layerNames[i]] = !allVisible
        }
        setVisibleLayers(newState)
    }

    // 计算当前显示的管道数据 - 性能优化版
    const pipelineData = useMemo<PipelineData>(() => {
        const allNodes: PipelineNode[] = []
        const allLines: PipelineLine[] = []

        // 使用 for 循环替代 forEach + 展开运算符，减少内存分配
        for (let i = 0; i < ALL_PIPELINES.length; i++) {
            const pkg = ALL_PIPELINES[i]
            for (let j = 0; j < pkg.layers.length; j++) {
                const layer = pkg.layers[j]
                if (visibleLayers[layer.name]) {
                    // 手动 push 而不是使用展开运算符
                    const nodes = layer.nodes
                    const lines = layer.lines
                    for (let k = 0; k < nodes.length; k++) {
                        allNodes.push(nodes[k])
                    }
                    for (let k = 0; k < lines.length; k++) {
                        allLines.push(lines[k])
                    }
                }
            }
        }

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
            <MapView
                pipelineData={pipelineData}
                onLoad={handleMapLoad}
            />

            {/* 图层控制面板 - 树形结构 */}
            <div className="absolute top-24 left-6 z-10 bg-black/70 backdrop-blur-sm rounded-lg p-3 border border-blue-500/30 w-72 max-h-[75vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-700">
                    <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                        <span className="material-symbols-outlined text-lg">toc</span>
                        管线目录
                    </h3>
                    <button
                        onClick={() => setIsEditMode(!isEditMode)}
                        className={`text-xs px-2 py-1 rounded border transition-colors flex items-center gap-1 ${isEditMode ? 'bg-blue-600 border-blue-500 text-white' : 'border-gray-600 text-gray-400 hover:text-white'}`}
                        title="开启/关闭绘图工具"
                    >
                        <span className="material-symbols-outlined text-sm">edit</span>
                        {isEditMode ? '绘图开启' : '绘图'}
                    </button>
                </div>

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

            {/* 编辑器覆盖层 */}
            {isEditMode && mapInstance && (
                <PipelineEditorOverlay
                    mapInstance={mapInstance}
                    onClose={() => setIsEditMode(false)}
                />
            )}

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
