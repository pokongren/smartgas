import React from 'react'
import type { ClusterGroup } from '@/types/cluster'
import type { PipelineNode } from '@/types/pipeline'
import { getJunctionKind, getNodeRawType } from '@/utils/pipelineDomain'

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
    onNodeSelect,
}) => {
    if (!visible || !cluster) return null

    const { nodes, coordinate } = cluster

    const sourceNodes = nodes.filter(node => getNodeRawType(node) === 'source')
    const compressorNodes = nodes.filter(node => getNodeRawType(node) === 'compressor')
    const distributionNodes = nodes.filter(node => getNodeRawType(node) === 'distribution')
    const valveNodes = nodes.filter(node => getNodeRawType(node) === 'valve')
    const junctionNodes = nodes.filter(node => getNodeRawType(node) === 'junction')
    const otherNodes = nodes.filter(node => {
        const rawType = getNodeRawType(node)
        return rawType !== 'source'
            && rawType !== 'compressor'
            && rawType !== 'distribution'
            && rawType !== 'valve'
            && rawType !== 'junction'
    })

    const handleSelect = (node: PipelineNode) => {
        onNodeSelect?.(node)
        onClose()
    }

    const hasAnyNode = nodes.length > 0

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-gray-900 rounded-lg shadow-2xl border border-blue-500/30 w-[420px] max-h-[70vh] overflow-hidden flex flex-col">
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

                <div className="overflow-y-auto flex-1 p-4 space-y-3">
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-xs text-gray-400">聚合中心坐标</div>
                                <div className="text-sm text-gray-100 font-medium">
                                    {formatCoordinate(coordinate.longitude)}, {formatCoordinate(coordinate.latitude)}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-xs text-gray-400">交汇/枢纽节点</div>
                                <div className="text-sm text-cyan-300 font-medium">{junctionNodes.length} 个</div>
                            </div>
                        </div>
                    </div>

                    {sourceNodes.length > 0 && (
                        <NodeGroup
                            title={`气源/首末站 (${sourceNodes.length})`}
                            icon="flare"
                            className="border-rose-500/30 bg-rose-900/20 text-rose-400"
                            nodes={sourceNodes}
                            onNodeSelect={handleSelect}
                        />
                    )}

                    {compressorNodes.length > 0 && (
                        <NodeGroup
                            title={`压气站 (${compressorNodes.length})`}
                            icon="compress"
                            className="border-cyan-500/30 bg-cyan-900/20 text-cyan-400"
                            nodes={compressorNodes}
                            onNodeSelect={handleSelect}
                        />
                    )}

                    {distributionNodes.length > 0 && (
                        <NodeGroup
                            title={`分输站 (${distributionNodes.length})`}
                            icon="hub"
                            className="border-yellow-500/30 bg-yellow-900/20 text-yellow-400"
                            nodes={distributionNodes}
                            onNodeSelect={handleSelect}
                        />
                    )}

                    {valveNodes.length > 0 && (
                        <NodeGroup
                            title={`阀室 (${valveNodes.length})`}
                            icon="valve"
                            className="border-gray-500/30 bg-gray-800/50 text-gray-400"
                            nodes={valveNodes}
                            onNodeSelect={handleSelect}
                        />
                    )}

                    {junctionNodes.length > 0 && (
                        <NodeGroup
                            title={`交汇/枢纽 (${junctionNodes.length})`}
                            icon="account_tree"
                            className="border-cyan-500/30 bg-cyan-950/40 text-cyan-300"
                            nodes={junctionNodes}
                            onNodeSelect={handleSelect}
                        />
                    )}

                    {otherNodes.length > 0 && (
                        <NodeGroup
                            title={`其他节点 (${otherNodes.length})`}
                            icon="account_tree"
                            className="border-slate-500/30 bg-slate-900/40 text-slate-300"
                            nodes={otherNodes}
                            onNodeSelect={handleSelect}
                        />
                    )}

                    {!hasAnyNode && (
                        <div className="text-center text-gray-500 py-8">
                            无节点数据
                        </div>
                    )}
                </div>

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

interface NodeGroupProps {
    title: string
    icon: string
    className: string
    nodes: PipelineNode[]
    onNodeSelect: (node: PipelineNode) => void
}

const NodeGroup: React.FC<NodeGroupProps> = ({ title, icon, className, nodes, onNodeSelect }) => (
    <div className={`border rounded-lg p-3 ${className}`}>
        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">{icon}</span>
            {title}
        </h4>
        <div className="space-y-2">
            {nodes.map(node => (
                <NodeItem
                    key={node.id}
                    node={node}
                    onClick={() => onNodeSelect(node)}
                />
            ))}
        </div>
    </div>
)

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
            <div className="text-[10px] text-gray-500 mt-1 space-y-1">
                <div>{getNodeMetaLabel(node)}</div>
                {node.properties?.layerName && <div>图层：{String(node.properties.layerName)}</div>}
                <div>坐标：{formatNodeCoordinate(node)}</div>
            </div>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full ${node.status === 'normal'
            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
            {node.status === 'normal' ? '正常' : '异常'}
        </span>
    </div>
)

function getNodeMetaLabel(node: PipelineNode): string {
    switch (getNodeRawType(node)) {
        case 'source':
            return '气源/首末站'
        case 'compressor':
            return '压气站'
        case 'distribution':
            return '分输站'
        case 'valve':
            return '阀室'
        case 'junction':
            if (getJunctionKind(node) === 'major_junction') return '大枢纽节点'
            return node.isHub || node.hubInfo?.isJunction ? '枢纽节点' : '交汇节点'
        default:
            return node.pressureLevel || '未知类型'
    }
}

function formatCoordinate(value: number): string {
    return value.toFixed(4)
}

function formatNodeCoordinate(node: PipelineNode): string {
    return `${formatCoordinate(node.coordinate.longitude)}, ${formatCoordinate(node.coordinate.latitude)}`
}

export default ClusterDetailPanel
