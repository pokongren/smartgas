import React from 'react'
import { getPipelineLayerId, type PipelineLayer, type PipelinePackage } from '@/data/pipelines'

type PipelineDirectoryPanelProps = {
    directoryPos: { x: number; y: number }
    directorySize: { width: number; height: number }
    isDraggingDirectory: boolean
    orderedPipelines: PipelinePackage[]
    visibleLayers: Record<string, boolean>
    expandedGroups: Record<string, boolean>
    pipelineDragId: string | null
    pipelineDropIndex: number | null
    onDirectoryMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
    onToggleAllLayers: (visible: boolean) => void
    onResetDirectoryLayout: () => void
    onPipelineListDragOver: (event: React.DragEvent<HTMLDivElement>) => void
    onPipelineDrop: (event: React.DragEvent<HTMLDivElement>) => void
    onPipelineDragStart: (event: React.DragEvent<HTMLDivElement>, packageId: string) => void
    onPipelineDragOver: (event: React.DragEvent<HTMLDivElement>, pipelineIndex: number) => void
    onPipelineDragEnd: () => void
    onToggleGroupExpand: (packageId: string) => void
    onFocusPipelinePackage: (pkg: PipelinePackage) => void
    onTogglePackageVisibility: (pkg: PipelinePackage) => void
    onToggleLayer: (layerId: string) => void
    onFocusPipelineLayer: (layer: PipelineLayer) => void
    onDirectoryResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
    renderPipelineActions: (pkg: PipelinePackage) => React.ReactNode
}

export const PipelineDirectoryPanel: React.FC<PipelineDirectoryPanelProps> = ({
    directoryPos,
    directorySize,
    isDraggingDirectory,
    orderedPipelines,
    visibleLayers,
    expandedGroups,
    pipelineDragId,
    pipelineDropIndex,
    onDirectoryMouseDown,
    onToggleAllLayers,
    onResetDirectoryLayout,
    onPipelineListDragOver,
    onPipelineDrop,
    onPipelineDragStart,
    onPipelineDragOver,
    onPipelineDragEnd,
    onToggleGroupExpand,
    onFocusPipelinePackage,
    onTogglePackageVisibility,
    onToggleLayer,
    onFocusPipelineLayer,
    onDirectoryResizeMouseDown,
    renderPipelineActions,
}) => (
    <div
        className={`absolute z-10 bg-[#0c1218]/90 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.6)] rounded-lg border border-[rgba(45,59,78,0.7)] flex flex-col overflow-hidden ${isDraggingDirectory ? 'cursor-grabbing' : ''}`}
        style={{
            left: `${directoryPos.x}px`,
            top: `${directoryPos.y}px`,
            width: `${directorySize.width}px`,
            height: `${directorySize.height}px`,
        }}
    >
        <div
            className={`flex justify-between items-center px-4 py-3 bg-[#0c1218]/95 border-b border-gray-700/60 sticky top-0 z-20 shrink-0 ${isDraggingDirectory ? 'cursor-grabbing' : 'cursor-grab'}`}
            onMouseDown={onDirectoryMouseDown}
            title="按住标题栏可拖动管线目录"
        >
            <h3 className="text-white text-base font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-xl">toc</span>
                管线目录
            </h3>
            <div className="flex items-center gap-2">
                <button
                    onClick={() => onToggleAllLayers(true)}
                    className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 hover:text-white transition-colors"
                    title="显示全部管线"
                >
                    全选
                </button>
                <button
                    onClick={() => onToggleAllLayers(false)}
                    className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 hover:text-white transition-colors"
                    title="隐藏全部管线"
                >
                    全部取消
                </button>
                <button
                    onClick={onResetDirectoryLayout}
                    className="text-xs px-2 py-1 bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-200 rounded border border-cyan-500/30 hover:text-white transition-colors"
                    title="复原目录位置、大小、排序和按钮状态"
                >
                    复原
                </button>
            </div>
        </div>

        <div
            className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1"
            onDragOver={onPipelineListDragOver}
            onDrop={onPipelineDrop}
        >
            {orderedPipelines.map((pkg, pipelineIndex) => {
                const layerIds = pkg.layers.map((layer, index) => getPipelineLayerId(pkg, layer, index))
                const isAllVisible = layerIds.every(id => visibleLayers[id])
                const isPartialVisible = !isAllVisible && layerIds.some(id => visibleLayers[id])
                const hasBranches = pkg.layers.length > 1

                return (
                    <React.Fragment key={pkg.id}>
                        {pipelineDropIndex === pipelineIndex && pipelineDragId !== pkg.id && (
                            <div className="relative mx-1 my-1 h-3">
                                <div className="absolute left-1 right-1 top-1/2 h-px -translate-y-1/2 bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
                                <div className="absolute left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-cyan-300 bg-[#0c1218]" />
                            </div>
                        )}
                        <div
                            className={`px-1 rounded-md ${pipelineDragId === pkg.id ? 'opacity-45' : ''}`}
                            data-pipeline-row
                            draggable
                            onDragStart={(event) => onPipelineDragStart(event, pkg.id)}
                            onDragOver={(event) => onPipelineDragOver(event, pipelineIndex)}
                            onDrop={onPipelineDrop}
                            onDragEnd={onPipelineDragEnd}
                            title="按住管线行可上下拖动排序"
                        >
                            <div
                                className="flex items-center gap-2 hover:bg-white/5 p-1.5 rounded transition-colors select-none cursor-grab active:cursor-grabbing group"
                                onClick={() => {
                                    if (hasBranches) onToggleGroupExpand(pkg.id)
                                    onFocusPipelinePackage(pkg)
                                }}
                            >
                                <div className="w-5 h-5 flex items-center justify-center shrink-0">
                                    {hasBranches && (
                                        <span className={`material-symbols-outlined text-xl text-gray-400 group-hover:text-white transition-all duration-200 ${expandedGroups[pkg.id] ? 'rotate-90' : ''}`}>
                                            chevron_right
                                        </span>
                                    )}
                                </div>

                                <div
                                    className="relative flex items-center justify-center w-[18px] h-[18px] cursor-default"
                                    onMouseDown={(event) => {
                                        event.stopPropagation()
                                    }}
                                    onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        onTogglePackageVisibility(pkg)
                                    }}
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

                                <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                    <span className="min-w-0 text-white font-medium text-sm flex items-center gap-2.5">
                                        <span
                                            className="shrink-0 w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]"
                                            style={{ backgroundColor: pkg.color }}
                                        ></span>
                                        <span className="truncate">{pkg.name}</span>
                                    </span>
                                    {renderPipelineActions(pkg)}
                                </div>
                            </div>

                            {expandedGroups[pkg.id] && hasBranches && (
                                <div className="ml-[22px] mt-1 mb-2 space-y-1 pl-4 border-l border-gray-700/60 relative">
                                    <div className="absolute top-0 bottom-0 left-[-1px] w-px bg-gradient-to-b from-gray-700/60 to-transparent"></div>
                                    {pkg.layers.map((layer, layerIndex) => {
                                        const layerId = getPipelineLayerId(pkg, layer, layerIndex)
                                        return (
                                            <div
                                                key={layerId}
                                                className="flex items-center gap-2 p-1.5 hover:bg-white/5 rounded cursor-pointer select-none group/item"
                                                onClick={() => {
                                                    const willShow = !visibleLayers[layerId]
                                                    onToggleLayer(layerId)
                                                    if (willShow) onFocusPipelineLayer(layer)
                                                }}
                                            >
                                                <div
                                                    className="relative flex items-center justify-center w-[16px] h-[16px] cursor-default"
                                                    onMouseDown={(event) => {
                                                        event.stopPropagation()
                                                    }}
                                                    onClick={(event) => {
                                                        event.preventDefault()
                                                        event.stopPropagation()
                                                        onToggleLayer(layerId)
                                                    }}
                                                >
                                                    <div className={`absolute inset-0 rounded-[3px] border ${visibleLayers[layerId] ? 'border-[#137fec] bg-[#137fec]' : 'border-gray-500 bg-[#1c2430] group-hover/item:border-gray-400'} transition-colors`}></div>
                                                    {visibleLayers[layerId] && (
                                                        <svg className="absolute w-[10px] h-[10px] text-white pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="20 6 9 17 4 12"></polyline>
                                                        </svg>
                                                    )}
                                                </div>
                                                <span
                                                    className={`w-1.5 h-1.5 rounded-full ${layer.type === 'trunk' ? 'opacity-100 shadow-[0_0_4px_rgba(0,0,0,0.5)]' : 'opacity-60'} transition-opacity`}
                                                    style={{ backgroundColor: pkg.color }}
                                                ></span>
                                                <span className={`text-sm transition-colors ${visibleLayers[layerId] ? 'text-gray-200 font-medium' : 'text-gray-400'}`}>
                                                    {layer.type === 'trunk' ? '干线' : layer.name.replace('支线', '')}
                                                </span>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </React.Fragment>
                )
            })}
            {pipelineDropIndex === orderedPipelines.length && (
                <div className="relative mx-1 my-1 h-3">
                    <div className="absolute left-1 right-1 top-1/2 h-px -translate-y-1/2 bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
                    <div className="absolute left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-cyan-300 bg-[#0c1218]" />
                </div>
            )}
        </div>
        <div
            data-directory-resize
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize rounded-tl-md border-l border-t border-cyan-400/30 bg-cyan-400/10"
            onMouseDown={onDirectoryResizeMouseDown}
            title="拖动调整管线目录宽高"
        />
    </div>
)
