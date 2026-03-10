/**
 * 拓扑计算演示页面
 * 
 * 展示拓扑分析功能的完整示例
 */

import React, { useEffect, useState } from 'react'
import { TopoViewer } from '@/components/topology'
import type { PipelineNode, PipelineLine } from '@/types'

// 示例数据 - 简单的测试管网
const DEMO_NODES: PipelineNode[] = [
    { id: 'A', name: '首站', type: 'junction' as const, coordinate: { longitude: 100, latitude: 30 }, pressureLevel: 'high' as const, status: 'normal' as const },
    { id: 'B', name: '压气站1', type: 'junction' as const, coordinate: { longitude: 101, latitude: 30.5 }, pressureLevel: 'high' as const, status: 'normal' as const },
    { id: 'C', name: '分输站1', type: 'junction' as const, coordinate: { longitude: 102, latitude: 31 }, pressureLevel: 'high' as const, status: 'normal' as const },
    { id: 'D', name: '压气站2', type: 'junction' as const, coordinate: { longitude: 101.5, latitude: 29.5 }, pressureLevel: 'high' as const, status: 'normal' as const },
    { id: 'E', name: '末站', type: 'junction' as const, coordinate: { longitude: 103, latitude: 30 }, pressureLevel: 'high' as const, status: 'normal' as const },
    { id: 'F', name: '支线站', type: 'junction' as const, coordinate: { longitude: 102.5, latitude: 32 }, pressureLevel: 'medium' as const, status: 'normal' as const },
]

const DEMO_LINES: PipelineLine[] = [
    { id: 'L1', name: '干线1段', startNodeId: 'A', endNodeId: 'B', path: [{ longitude: 100, latitude: 30 }, { longitude: 101, latitude: 30.5 }], diameter: 1016, material: 'steel', pressureLevel: 'high' as const, length: 150000, status: 'normal' as const },
    { id: 'L2', name: '干线2段', startNodeId: 'B', endNodeId: 'C', path: [{ longitude: 101, latitude: 30.5 }, { longitude: 102, latitude: 31 }], diameter: 1016, material: 'steel', pressureLevel: 'high' as const, length: 160000, status: 'normal' as const },
    { id: 'L3', name: '干线3段', startNodeId: 'C', endNodeId: 'E', path: [{ longitude: 102, latitude: 31 }, { longitude: 103, latitude: 30 }], diameter: 1016, material: 'steel', pressureLevel: 'high' as const, length: 170000, status: 'normal' as const },
    { id: 'L4', name: '联络线1', startNodeId: 'B', endNodeId: 'D', path: [{ longitude: 101, latitude: 30.5 }, { longitude: 101.5, latitude: 29.5 }], diameter: 508, material: 'steel', pressureLevel: 'high' as const, length: 120000, status: 'normal' as const },
    { id: 'L5', name: '联络线2', startNodeId: 'D', endNodeId: 'E', path: [{ longitude: 101.5, latitude: 29.5 }, { longitude: 103, latitude: 30 }], diameter: 508, material: 'steel', pressureLevel: 'high' as const, length: 180000, status: 'normal' as const },
    { id: 'L6', name: '支线', startNodeId: 'C', endNodeId: 'F', path: [{ longitude: 102, latitude: 31 }, { longitude: 102.5, latitude: 32 }], diameter: 323, material: 'steel', pressureLevel: 'medium' as const, length: 130000, status: 'normal' as const },
]

export const TopologyDemoView: React.FC = () => {
    const [ready, setReady] = useState(false)

    useEffect(() => {
        // 模拟加载延迟
        const timer = setTimeout(() => setReady(true), 500)
        return () => clearTimeout(timer)
    }, [])

    if (!ready) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="flex items-center gap-3 text-white">
                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    加载中...
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-slate-900 p-6">
            <div className="max-w-7xl mx-auto">
                {/* 页面标题 */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-white mb-2">
                        管网拓扑计算演示
                    </h1>
                    <p className="text-slate-400">
                        演示路径查找、最小生成树、环检测等拓扑分析功能
                    </p>
                </div>

                {/* 使用说明 */}
                <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4 mb-6">
                    <h3 className="text-blue-300 font-medium mb-2">使用说明</h3>
                    <ul className="text-blue-200 text-sm space-y-1 list-disc list-inside">
                        <li>选择起点和终点，点击"查找路径"查看最短路径</li>
                        <li>点击"备选路径"查看多条可选路径</li>
                        <li>点击"最小生成树"查看管网骨架结构</li>
                        <li>点击"检测环路"查看管网中的环路</li>
                        <li>查看下方拓扑指标和关键节点分析</li>
                    </ul>
                </div>

                {/* 拓扑查看器 */}
                <TopoViewer
                    pipelineName="demo_pipeline"
                    nodes={DEMO_NODES}
                    lines={DEMO_LINES}
                    showMetrics={true}
                    showControls={true}
                    onNodeClick={(id, name) => console.log('点击节点:', name)}
                    onPathSelect={(path) => console.log('选中路径:', path)}
                />

                {/* API 测试链接 */}
                <div className="mt-8 bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <h3 className="text-white font-medium mb-3">API 测试</h3>
                    <div className="flex flex-wrap gap-3">
                        <a
                            href="http://localhost:8000/docs"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded transition-colors"
                        >
                            打开 API 文档
                        </a>
                        <a
                            href="http://localhost:8000/api/topology/graphs"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-slate-600 hover:bg-slate-500 text-white text-sm px-4 py-2 rounded transition-colors"
                        >
                            测试 /graphs API
                        </a>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default TopologyDemoView
