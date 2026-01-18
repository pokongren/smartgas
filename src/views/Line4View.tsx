import { useState, useMemo, useEffect } from 'react'
import MapView from '@/components/map-view/MapView'
import { stationAPI, pipelineAPI } from '@/services/api'
import type { PipelineData, PipelineNode, PipelineLine } from '@/types'
import { NodeType, PipelineStatus, PressureLevel } from '@/types'

const Line4View = () => {
    const [allStations, setAllStations] = useState<any[]>([])
    const [allPipelines, setAllPipelines] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const fetchData = async () => {
            try {
                console.log('🔄 开始获取西四线数据...')
                const [stRes, pipeRes] = await Promise.all([
                    stationAPI.getAll(),
                    pipelineAPI.getAll()
                ])
                console.log('✅ 获取到站点:', stRes.data?.length || 0)
                console.log('✅ 获取到管线:', pipeRes.data?.length || 0)

                setAllStations(stRes.data || [])
                setAllPipelines(pipeRes.data || [])
            } catch (err) {
                console.error("❌ 获取数据失败:", err)
                setError(err instanceof Error ? err.message : '数据加载失败')
            } finally {
                setLoading(false)
            }
        }
        fetchData()
    }, [])

    const line4Data = useMemo<PipelineData>(() => {
        // 过滤西四线管段（ID以LINE4-SEG开头）
        const lines4 = allPipelines.filter(p => p.id && p.id.startsWith('LINE4-SEG'))
        console.log('🔗 西四线管段数:', lines4.length)

        // 获取唯一的站点ID
        const stationIds = new Set<string>()
        lines4.forEach(p => {
            if (p.start_station_id) stationIds.add(p.start_station_id)
            if (p.end_station_id) stationIds.add(p.end_station_id)
        })
        console.log('📍 涉及站点数:', stationIds.size)

        // 创建站点ID到站点的映射
        const stationMap = new Map<string, any>()
        allStations.forEach(s => {
            if (stationIds.has(s.id)) {
                stationMap.set(s.id, s)
            }
        })

        // 映射站点数据
        const nodes: PipelineNode[] = Array.from(stationMap.values())
            .filter(s => s.longitude != null && s.latitude != null)
            .map(s => ({
                id: s.id,
                name: s.name || '未命名站点',
                type: NodeType.METERING,
                coordinate: {
                    longitude: parseFloat(s.longitude),
                    latitude: parseFloat(s.latitude)
                },
                pressureLevel: PressureLevel.HIGH,
                status: PipelineStatus.NORMAL,
                properties: { type: s.type || 'unknown' }
            }))
        console.log('✅ 有效站点数:', nodes.length)

        // 映射管线数据 - 关键修复：添加path数组
        const lines: PipelineLine[] = lines4
            .map(p => {
                const startStation = stationMap.get(p.start_station_id)
                const endStation = stationMap.get(p.end_station_id)

                // 如果起点或终点缺失，跳过此管线
                if (!startStation || !endStation) {
                    console.warn(`管线 ${p.id} 的起点或终点站点缺失`)
                    return null
                }

                // 检查坐标是否有效
                if (!startStation.longitude || !startStation.latitude ||
                    !endStation.longitude || !endStation.latitude) {
                    console.warn(`管线 ${p.id} 的起点或终点坐标无效`)
                    return null
                }

                return {
                    id: p.id,
                    name: p.name || `管段-${p.id}`,
                    startNodeId: p.start_station_id,
                    endNodeId: p.end_station_id,
                    path: [
                        {
                            longitude: parseFloat(startStation.longitude),
                            latitude: parseFloat(startStation.latitude)
                        },
                        {
                            longitude: parseFloat(endStation.longitude),
                            latitude: parseFloat(endStation.latitude)
                        }
                    ],
                    diameter: p.diameter || 1219,
                    material: 'Steel',
                    pressureLevel: PressureLevel.HIGH,
                    status: PipelineStatus.NORMAL,
                    length: p.length || 0,
                    properties: {
                        category: '西四线'
                    }
                }
            })
            .filter((line): line is PipelineLine => line !== null)

        console.log('✅ 有效管线数:', lines.length)
        if (lines.length > 0) {
            console.log('📝 管线示例:', lines[0])
        }

        return { nodes, lines }
    }, [allStations, allPipelines])

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-[#0a0c10] text-white">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
                    <p>正在加载西气东输四线数据...</p>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-screen bg-[#0a0c10] text-white">
                <div className="text-center p-8 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <p className="text-red-400 mb-2">❌ 数据加载失败</p>
                    <p className="text-sm text-slate-400">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-4 px-4 py-2 bg-purple-600 rounded hover:bg-purple-700"
                    >
                        重新加载
                    </button>
                </div>
            </div>
        )
    }

    if (line4Data.nodes.length === 0 || line4Data.lines.length === 0) {
        return (
            <div className="flex items-center justify-center h-screen bg-[#0a0c10] text-white">
                <div className="text-center p-8 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-yellow-400 mb-2">⚠️ 未找到西四线数据</p>
                    <p className="text-sm text-slate-400">站点: {line4Data.nodes.length}, 管线: {line4Data.lines.length}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-screen w-full bg-[#0a0c10] text-slate-200 overflow-hidden font-sans">
            <header className="flex-none h-16 border-b border-white/10 bg-[#111418]/80 backdrop-blur-md flex items-center justify-between px-6 z-50">
                <div className="flex items-center gap-4">
                    <div className="size-10 bg-purple-600/20 rounded-lg flex items-center justify-center border border-purple-500/20">
                        <span className="material-symbols-outlined text-purple-400">route</span>
                    </div>
                    <div>
                        <h2 className="text-xl font-black tracking-tight text-white uppercase italic">West-East Line 4</h2>
                        <p className="text-[10px] text-purple-400 font-bold tracking-[0.2em] uppercase opacity-70">西气东输四线工程可视化</p>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-slate-500 uppercase font-bold">建设长度</span>
                        <span className="text-lg font-mono font-bold text-white tracking-tighter">1,745.0 <span className="text-xs text-slate-500">KM</span></span>
                    </div>
                    <div className="w-px h-8 bg-white/10"></div>
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-slate-500 uppercase font-bold">节点总数</span>
                        <span className="text-lg font-mono font-bold text-white tracking-tighter">{line4Data.nodes.length} <span className="text-xs text-slate-500">个</span></span>
                    </div>
                    <div className="w-px h-8 bg-white/10"></div>
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-slate-500 uppercase font-bold">管段数量</span>
                        <span className="text-lg font-mono font-bold text-white tracking-tighter">{line4Data.lines.length} <span className="text-xs text-slate-500">条</span></span>
                    </div>
                </div>
            </header>

            <main className="flex-1 relative">
                <MapView
                    config={{
                        center: { longitude: 90.0, latitude: 38.5 },
                        zoom: 5,
                        theme: 'dark',
                        zoomControl: true,
                        showScale: true,
                    }}
                    pipelineData={line4Data}
                    className="absolute inset-0 z-0"
                />

                {/* 左侧信息面板 */}
                <div className="absolute top-6 left-6 z-10 w-80 space-y-4">
                    <div className="bg-[#111418]/90 border border-white/10 rounded-xl p-5 backdrop-blur-xl shadow-2xl">
                        <h3 className="text-xs font-black text-purple-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <span className="size-1.5 bg-purple-400 rounded-full animate-pulse"></span>
                            项目概况
                        </h3>
                        <p className="text-sm text-slate-300 leading-relaxed mb-6">
                            西气东输四线工程是国家"十四五"石油天然气发展规划重点项目，起自新疆乌恰，终至宁夏中卫。
                        </p>

                        <div className="space-y-3">
                            <div className="p-3 bg-white/5 rounded-lg border border-white/5 flex justify-between items-center">
                                <span className="text-xs text-slate-400">管径</span>
                                <span className="text-sm font-bold text-white font-mono">1219 mm</span>
                            </div>
                            <div className="p-3 bg-white/5 rounded-lg border border-white/5 flex justify-between items-center">
                                <span className="text-xs text-slate-400">设计压力</span>
                                <span className="text-sm font-bold text-white font-mono">12.0 MPa</span>
                            </div>
                            <div className="p-3 bg-white/5 rounded-lg border border-white/5 flex justify-between items-center">
                                <span className="text-xs text-slate-400">输气能力</span>
                                <span className="text-sm font-bold text-white font-mono">150 亿方/年</span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-[#111418]/90 border border-white/10 rounded-xl p-5 backdrop-blur-xl shadow-2xl">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">关键站点</h3>
                        <div className="max-h-[300px] overflow-y-auto space-y-1">
                            {line4Data.nodes.filter(n => !n.name.includes('阀室')).slice(0, 15).map(n => (
                                <div key={n.id} className="py-2 px-2 border-b border-white/5 flex items-center justify-between group hover:bg-white/5 rounded cursor-default transition-colors">
                                    <span className="text-[13px] text-slate-300 group-hover:text-purple-400 transition-colors">{n.name}</span>
                                    <span className="text-[10px] text-slate-600 font-mono">{n.coordinate.longitude.toFixed(2)}°E</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 底部状态栏 */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-4">
                    <div className="px-6 py-3 bg-[#111418]/90 border border-white/10 rounded-full backdrop-blur-xl flex items-center gap-6 shadow-2xl">
                        <div className="flex items-center gap-2">
                            <div className="size-2 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                            <span className="text-xs text-slate-400 font-bold uppercase">实时监测</span>
                        </div>
                        <div className="h-4 w-px bg-white/10"></div>
                        <div className="flex items-center gap-4 text-xs">
                            <span className="text-slate-500">运行时长: <span className="text-white font-mono">4,120h</span></span>
                            <span className="text-slate-500">平均负载: <span className="text-white font-mono">78%</span></span>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    )
}

export default Line4View
