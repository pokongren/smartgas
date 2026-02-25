/**
 * 枢纽节点详情面板
 *
 * 展示多端口节点的详细信息和端口连接关系
 */

import React from 'react'
import type { HubNode } from '@/types/hub'
import { PortDirection, DistributionStrategy } from '@/types/hub'

interface HubDetailPanelProps {
    node: HubNode | null
    visible: boolean
    onClose: () => void
    onPortClick?: (portId: string) => void
    onPipelineClick?: (pipelineId: string) => void
}

/**
 * 端口方向显示文本
 */
function getDirectionLabel(direction: PortDirection): string {
    switch (direction) {
        case PortDirection.IN:
            return '进气'
        case PortDirection.OUT:
            return '出气'
        case PortDirection.BIDIRECTIONAL:
            return '双向'
        default:
            return '未知'
    }
}

/**
 * 端口方向图标
 */
function getDirectionIcon(direction: PortDirection): string {
    switch (direction) {
        case PortDirection.IN:
            return 'arrow_downward'
        case PortDirection.OUT:
            return 'arrow_upward'
        case PortDirection.BIDIRECTIONAL:
            return 'swap_vert'
        default:
            return 'help'
    }
}

/**
 * 端口状态颜色
 */
function getStatusColor(status: string): string {
    switch (status) {
        case 'active':
            return 'bg-green-500'
        case 'inactive':
            return 'bg-gray-500'
        case 'maintenance':
            return 'bg-yellow-500'
        default:
            return 'bg-gray-500'
    }
}

/**
 * 枢纽等级显示
 */
function getHubLevelText(level: number): string {
    switch (level) {
        case 1:
            return '国家级枢纽'
        case 2:
            return '省级枢纽'
        case 3:
            return '区域枢纽'
        default:
            return '未知级别'
    }
}

/**
 * 流量分配策略显示
 */
function getStrategyText(strategy: DistributionStrategy): string {
    switch (strategy) {
        case DistributionStrategy.PROPORTIONAL:
            return '比例分配'
        case DistributionStrategy.PRIORITY:
            return '优先级分配'
        case DistributionStrategy.CAPACITY_BASED:
            return '容量分配'
        default:
            return '未知策略'
    }
}

export const HubDetailPanel: React.FC<HubDetailPanelProps> = ({
    node,
    visible,
    onClose,
    onPortClick,
    onPipelineClick
}) => {
    if (!visible || !node || !node.extension.isHub) return null

    const { extension } = node

    // 分类端口：进气口、出气口
    const inPorts = extension.ports?.filter(p => p.direction === PortDirection.IN) || []
    const outPorts = extension.ports?.filter(p => p.direction === PortDirection.OUT) || []
    const biPorts = extension.ports?.filter(p => p.direction === PortDirection.BIDIRECTIONAL) || []

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-gray-900 rounded-lg shadow-2xl border border-amber-500/30 w-[500px] max-h-[80vh] overflow-hidden flex flex-col">
                {/* 头部 */}
                <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gradient-to-r from-amber-900/30 to-gray-800 shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-amber-400 text-2xl">hub</span>
                        <div>
                            <h3 className="text-lg font-bold text-white">{node.name}</h3>
                            <span className="text-xs text-amber-400">{getHubLevelText(extension.hubLevel)}</span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-gray-700/50 rounded"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                {/* 基本信息 */}
                <div className="p-4 border-b border-gray-700 bg-gray-800/50 shrink-0">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                            <span className="text-gray-400">节点类型</span>
                            <p className="text-white font-medium">{node.type === 'compressor' ? '压气站' : node.type}</p>
                        </div>
                        <div>
                            <span className="text-gray-400">设计压力</span>
                            <p className="text-white font-medium">{node.designPressure} MPa</p>
                        </div>
                        <div>
                            <span className="text-gray-400">运行压力</span>
                            <p className="text-white font-medium">{node.operatingPressure || '-'} MPa</p>
                        </div>
                        <div>
                            <span className="text-gray-400">处理能力</span>
                            <p className="text-white font-medium">{node.capacity || '-'} 万方/天</p>
                        </div>
                        <div>
                            <span className="text-gray-400">端口数量</span>
                            <p className="text-white font-medium">{extension.ports?.length || 0} 个</p>
                        </div>
                        <div>
                            <span className="text-gray-400">分配策略</span>
                            <p className="text-white font-medium">{getStrategyText(extension.distributionStrategy)}</p>
                        </div>
                    </div>
                </div>

                {/* 端口列表 */}
                <div className="overflow-y-auto flex-1 p-4 space-y-4">
                    {/* 进气口 */}
                    {inPorts.length > 0 && (
                        <div className="border border-green-500/30 bg-green-900/10 rounded-lg p-3">
                            <h4 className="text-sm font-semibold mb-3 text-green-400 flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                                进气口 ({inPorts.length})
                            </h4>
                            <div className="space-y-2">
                                {inPorts.map(port => (
                                    <div
                                        key={port.portId}
                                        className="bg-gray-800/50 rounded-lg p-3 hover:bg-gray-700/50 cursor-pointer transition-colors"
                                        onClick={() => onPortClick?.(port.portId)}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <p className="text-white font-medium">{port.pipelineName}</p>
                                                <p className="text-xs text-gray-400 mt-1">
                                                    压力: {port.pressureRange[0]}-{port.pressureRange[1]} MPa
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className={`inline-block w-2 h-2 rounded-full ${getStatusColor(port.status)}`}></span>
                                                <p className="text-xs text-gray-400 mt-1">{port.flowCapacity} 万方/天</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 出气口 */}
                    {outPorts.length > 0 && (
                        <div className="border border-blue-500/30 bg-blue-900/10 rounded-lg p-3">
                            <h4 className="text-sm font-semibold mb-3 text-blue-400 flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                                出气口 ({outPorts.length})
                            </h4>
                            <div className="space-y-2">
                                {outPorts.map(port => (
                                    <div
                                        key={port.portId}
                                        className="bg-gray-800/50 rounded-lg p-3 hover:bg-gray-700/50 cursor-pointer transition-colors"
                                        onClick={() => onPortClick?.(port.portId)}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <p className="text-white font-medium">{port.pipelineName}</p>
                                                <p className="text-xs text-gray-400 mt-1">
                                                    压力: {port.pressureRange[0]}-{port.pressureRange[1]} MPa
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className={`inline-block w-2 h-2 rounded-full ${getStatusColor(port.status)}`}></span>
                                                <p className="text-xs text-gray-400 mt-1">{port.flowCapacity} 万方/天</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 双向端口 */}
                    {biPorts.length > 0 && (
                        <div className="border border-purple-500/30 bg-purple-900/10 rounded-lg p-3">
                            <h4 className="text-sm font-semibold mb-3 text-purple-400 flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">swap_vert</span>
                                双向端口 ({biPorts.length})
                            </h4>
                            <div className="space-y-2">
                                {biPorts.map(port => (
                                    <div
                                        key={port.portId}
                                        className="bg-gray-800/50 rounded-lg p-3 hover:bg-gray-700/50 cursor-pointer transition-colors"
                                        onClick={() => onPortClick?.(port.portId)}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <p className="text-white font-medium">{port.pipelineName}</p>
                                                <p className="text-xs text-gray-400 mt-1">
                                                    压力: {port.pressureRange[0]}-{port.pressureRange[1]} MPa
                                                </p>
                                            </div>
                                            <span className={`inline-block w-2 h-2 rounded-full ${getStatusColor(port.status)}`}></span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 内部连接关系 */}
                    {extension.internalConnections && extension.internalConnections.length > 0 && (
                        <div className="border border-amber-500/30 bg-amber-900/10 rounded-lg p-3">
                            <h4 className="text-sm font-semibold mb-3 text-amber-400 flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">sync_alt</span>
                                内部调度关系
                            </h4>
                            <div className="space-y-2">
                                {extension.internalConnections.map((conn, index) => {
                                    const fromPort = extension.ports?.find(p => p.portId === conn.fromPort)
                                    const toPort = extension.ports?.find(p => p.portId === conn.toPort)

                                    return (
                                        <div
                                            key={index}
                                            className={`bg-gray-800/50 rounded-lg p-3 ${conn.isActive ? '' : 'opacity-50'}`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-green-400 text-sm">{fromPort?.pipelineName || conn.fromPort}</span>
                                                    <span className="material-symbols-outlined text-gray-400 text-xs">arrow_forward</span>
                                                    <span className="text-blue-400 text-sm">{toPort?.pipelineName || conn.toPort}</span>
                                                </div>
                                                <span className="text-amber-400 font-bold">
                                                    {Math.round(conn.flowRatio * 100)}%
                                                </span>
                                            </div>
                                            {conn.remark && (
                                                <p className="text-xs text-gray-500 mt-1">{conn.remark}</p>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* 底部操作 */}
                <div className="p-4 border-t border-gray-700 bg-gray-800/50 shrink-0">
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm"
                        >
                            关闭
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default HubDetailPanel
