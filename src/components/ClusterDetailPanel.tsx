import React from 'react'
import type { ClusterGroup } from '@/types/cluster'
import type { PipelineNode } from '@/types/pipeline'

interface ClusterDetailPanelProps {
    cluster: ClusterGroup | null
    visible: boolean
    onClose: () => void
    onNodeSelect?: (node: PipelineNode) => void
}

export const ClusterDetailPanel: React.FC<ClusterDetailPanelProps> = ({
    cluster,
    visible,
    onClose,
    onNodeSelect
}) => {
    if (!visible || !cluster) return null

    const { nodes, coordinate } = cluster

    // 分类节点
    const compressorNodes = nodes.filter(n => n.name.includes('压气站'))
    const distributionNodes = nodes.filter(n =>
        n.name.includes('分输站') || n.name.includes('门站')
    )
    const valveNodes = nodes.filter(n =>
        n.name.includes('阀室') || n.name.includes('阀门') || n.name.includes('#')
    )

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-gray-900 rounded-lg shadow-2xl border border-blue-500/30 w-[400px] max-h-[70vh] overflow-hidden flex flex-col">
                {/* 头部 */}
                <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-800 shrink-0">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <span className="material-symbols-outlined text-blue-400">hub</span>
                        节点详情 ({nodes.length}个)
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-gray-700/50 rounded"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                {/* 节点列表 */}
                <div className="overflow-y-auto flex-1 p-4 space-y-3">
                    {/* 压气站 */}
                    {compressorNodes.length > 0 && (
                        <div className="border border-cyan-500/30 bg-cyan-900/20 rounded-lg p-3">
                            <h4 className="text-sm font-semibold mb-2 text-cyan-400 flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">compress</span>
                                压气站 ({compressorNodes.length})
                            </h4>
                            <div className="space-y-2">
                                {compressorNodes.map(node => (
                                    <NodeItem 
                                        key={node.id} 
                                        node={node} 
                                        onClick={() => {
                                            onNodeSelect?.(node)
                                            onClose()
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 分输站 */}
                    {distributionNodes.length > 0 && (
                        <div className="border border-yellow-500/30 bg-yellow-900/20 rounded-lg p-3">
                            <h4 className="text-sm font-semibold mb-2 text-yellow-400 flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">hub</span>
                                分输站 ({distributionNodes.length})
                            </h4>
                            <div className="space-y-2">
                                {distributionNodes.map(node => (
                                    <NodeItem 
                                        key={node.id} 
                                        node={node} 
                                        onClick={() => {
                                            onNodeSelect?.(node)
                                            onClose()
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 阀室 */}
                    {valveNodes.length > 0 && (
                        <div className="border border-gray-500/30 bg-gray-800/50 rounded-lg p-3">
                            <h4 className="text-sm font-semibold mb-2 text-gray-400 flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">valve</span>
                                阀室 ({valveNodes.length})
                            </h4>
                            <div className="space-y-2">
                                {valveNodes.map(node => (
                                    <NodeItem 
                                        key={node.id} 
                                        node={node} 
                                        onClick={() => {
                                            onNodeSelect?.(node)
                                            onClose()
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {compressorNodes.length === 0 && distributionNodes.length === 0 && valveNodes.length === 0 && (
                        <div className="text-center text-gray-500 py-8">
                            无节点数据
                        </div>
                    )}
                </div>

                {/* 底部 */}
                <div className="p-4 border-t border-gray-700 bg-gray-800 shrink-0 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    )
}

// 节点项组件
interface NodeItemProps {
    node: PipelineNode
    onClick: () => void
}

const NodeItem: React.FC<NodeItemProps> = ({ node, onClick }) => (
    <div
        onClick={onClick}
        className="flex items-center justify-between p-3 rounded bg-gray-900/60 hover:bg-gray-700 cursor-pointer transition-all border border-transparent hover:border-gray-600"
    >
        <div className="flex flex-col">
            <span className="text-sm text-gray-200 font-medium">{node.name}</span>
            <span className="text-[10px] text-gray-500 mt-1">
                {node.pressureLevel || '未知压力'}
            </span>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full ${node.status === 'normal'
            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
            {node.status === 'normal' ? '正常' : '异常'}
        </span>
    </div>
)

export default ClusterDetailPanel
