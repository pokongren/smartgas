import React, { useMemo, useState, useCallback, lazy, Suspense } from 'react'
import MapView from '@/components/map-view/MapView'
import { ALL_PIPELINES, PipelinePackage, PipelineLayer } from '@/data/pipelines'
import type { PipelineData, PipelineLine, PipelineNode } from '@/types'
import PipelineEditorOverlay from './PipelineEditorOverlay'

// 懒加载 AI 工作流组件
const WorkflowRunner = lazy(() => import('@/components/workflow/WorkflowRunner'))

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
    const [mapInstance, setMapInstance] = useState<any>(null)
    const [isEditMode, setIsEditMode] = useState(false)
    const [showWorkflow, setShowWorkflow] = useState(false)

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
        <div className="h-screen w-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 overflow-hidden relative">
            {/* 标题栏 */}
            <div className="absolute top-0 left-0 right-0 z-30 bg-black/50 backdrop-blur-sm border-b border-blue-500/30">
                <div className="container mx-auto px-6 py-4 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                            <span className="material-symbols-outlined text-3xl text-blue-400">public</span>
                            智脉平台-全国管网统一视图
                        </h1>
                        <p className="text-sm text-gray-300 mt-1">
                            站场: {stats.stations} | 管道段: {stats.pipelines} | 管线组: {stats.groups}
                        </p>
                    </div>

                    {/* 右侧工具栏 */}
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setShowWorkflow(!showWorkflow)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all shadow-lg ${showWorkflow
                                ? 'bg-blue-600 text-white shadow-blue-500/30'
                                : 'bg-[#141b22] border border-blue-500/20 text-gray-300 hover:bg-white/5 hover:text-white'}`}
                        >
                            <span className="material-symbols-outlined text-xl">neurology</span>
                            AI 发令台
                        </button>
                    </div>
                </div>
            </div>

            {/* 地图 */}
            <MapView
                pipelineData={pipelineData}
                onLoad={handleMapLoad}
            />

            {/* 图层控制面板 - 树形结构 */}
            <div className="absolute top-24 left-6 z-10 bg-[#0c1218]/90 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.6)] rounded-lg border border-[rgba(45,59,78,0.7)] w-72 max-h-[75vh] flex flex-col overflow-hidden">
                {/* 粘性表头 */}
                <div className="flex justify-between items-center px-4 py-3 bg-[#0c1218]/95 border-b border-gray-700/60 sticky top-0 z-20 shrink-0">
                    <h3 className="text-white text-base font-bold flex items-center gap-2">
                        <span className="material-symbols-outlined text-xl">toc</span>
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

                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                    {ALL_PIPELINES.map(pkg => {
                        const layerNames = pkg.layers.map(l => l.name)
                        const isAllVisible = layerNames.every(n => visibleLayers[n])
                        const isPartialVisible = !isAllVisible && layerNames.some(n => visibleLayers[n])
                        const hasBranches = pkg.layers.length > 1

                        return (
                            <div key={pkg.id} className="px-1">
                                {/* 组头部 (管线名) */}
                                <div
                                    className="flex items-center gap-2 hover:bg-white/5 p-1.5 rounded transition-colors select-none cursor-pointer group"
                                    onClick={() => hasBranches && toggleGroupExpand(pkg.id)}
                                >
                                    {/* 展开/收起箭头 */}
                                    <div className="w-5 h-5 flex items-center justify-center shrink-0">
                                        {hasBranches && (
                                            <span className={`material-symbols-outlined text-xl text-gray-400 group-hover:text-white transition-all duration-200 ${expandedGroups[pkg.id] ? 'rotate-90' : ''}`}>
                                                chevron_right
                                            </span>
                                        )}
                                    </div>

                                    {/* 自定义复选框 - 控制整个组 */}
                                    <div
                                        className="relative flex items-center justify-center w-[18px] h-[18px]"
                                        onClick={(e) => { e.stopPropagation(); togglePackageVisibility(pkg); }}
                                    >
                                        <div className={`absolute inset-0 rounded-[4px] border ${isAllVisible || isPartialVisible ? 'border-[#137fec] bg-[#137fec]' : 'border-gray-500 bg-[#1c2430] group-hover:border-gray-400'} transition-colors`}></div>
                                        {isAllVisible && (
                                            <svg className="absolute w-[12px] h-[12px] text-white pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12"></polyline>
                                            </svg>
                                        )}
                                        {isPartialVisible && (
                                            <svg className="absolute w-[10px] h-[10px] text-white pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
                                                <line x1="5" y1="12" x2="19" y2="12"></line>
                                            </svg>
                                        )}
                                    </div>

                                    {/* 文本标签 */}
                                    <span className="text-white font-medium text-sm flex-1 flex items-center gap-2.5">
                                        <span
                                            className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]"
                                            style={{ backgroundColor: pkg.color }}
                                        ></span>
                                        {pkg.name}
                                    </span>
                                </div>

                                {/* 图层列表 (子节点) */}
                                {expandedGroups[pkg.id] && hasBranches && (
                                    <div className="ml-[22px] mt-1 mb-2 space-y-1 pl-4 border-l border-gray-700/60 relative">
                                        {/* 顶部辅助渐变线 */}
                                        <div className="absolute top-0 bottom-0 left-[-1px] w-px bg-gradient-to-b from-gray-700/60 to-transparent"></div>
                                        {pkg.layers.map(layer => (
                                            <div
                                                key={layer.name}
                                                className="flex items-center gap-2 p-1.5 hover:bg-white/5 rounded cursor-pointer select-none group/item"
                                                onClick={() => toggleLayer(layer.name)}
                                            >
                                                {/* 自定义复选框 - 子图层 */}
                                                <div className="relative flex items-center justify-center w-[16px] h-[16px]">
                                                    <div className={`absolute inset-0 rounded-[3px] border ${visibleLayers[layer.name] ? 'border-[#137fec] bg-[#137fec]' : 'border-gray-500 bg-[#1c2430] group-hover/item:border-gray-400'} transition-colors`}></div>
                                                    {visibleLayers[layer.name] && (
                                                        <svg className="absolute w-[10px] h-[10px] text-white pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="20 6 9 17 4 12"></polyline>
                                                        </svg>
                                                    )}
                                                </div>
                                                <span
                                                    className={`w-1.5 h-1.5 rounded-full ${layer.type === 'trunk' ? 'opacity-100 shadow-[0_0_4px_rgba(0,0,0,0.5)]' : 'opacity-60'} transition-opacity`}
                                                    style={{ backgroundColor: pkg.color }}
                                                ></span>
                                                <span className={`text-sm transition-colors ${visibleLayers[layer.name] ? 'text-gray-200 font-medium' : 'text-gray-400'}`}>
                                                    {layer.type === 'trunk' ? '干线' : layer.name.replace('支线', '')}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* 编辑器覆盖层 —— 传入当前可见管线数据供"导入"功能使用 */}
            {isEditMode && mapInstance && (
                <PipelineEditorOverlay
                    mapInstance={mapInstance}
                    onClose={() => setIsEditMode(false)}
                    existingNodes={pipelineData.nodes}
                    existingLines={pipelineData.lines}
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

            {/* AI 工作流抽屉 (右侧展示) */}
            <div
                className={`absolute top-[73px] right-0 bottom-0 w-[500px] bg-[#0c1218]/95 backdrop-blur-md border-l border-blue-500/30 z-20 shadow-[-10px_0_30px_rgba(0,0,0,0.5)] transition-transform duration-300 flex flex-col ${showWorkflow ? 'translate-x-0' : 'translate-x-full'}`}
            >
                {/* 抽屉头部 */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
                    <h3 className="text-white text-base font-semibold flex items-center gap-2">
                        <span className="material-symbols-outlined text-blue-400">neurology</span>
                        智脉平台-AI 调度工作流
                    </h3>
                    <button
                        onClick={() => setShowWorkflow(false)}
                        className="text-gray-400 hover:text-white transition-colors p-1"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
                {/* 内容区 */}
                <div className="flex-1 overflow-hidden relative">
                    <Suspense fallback={
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            <span className="text-gray-500 text-sm">唤醒 AI 中...</span>
                        </div>
                    }>
                        <WorkflowRunner />
                    </Suspense>
                </div>
            </div>
        </div>
    )
}

export default GlobalPipelineView
