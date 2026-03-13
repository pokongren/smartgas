import React, { useMemo, useState, useCallback, lazy, Suspense, useEffect } from 'react'
import MapView from '@/components/map-view/MapView'
import { ALL_PIPELINES, PipelinePackage, PipelineLayer } from '@/data/pipelines'
import type { PipelineData, PipelineLine, PipelineNode } from '@/types'
import PipelineEditorOverlay from './PipelineEditorOverlay'
import { getNodeMarkerMap } from '@/utils/mapRenderer'
import { useNewWindow, usePopoutSync } from '@/hooks/useNewWindow'

// SCADA 站场数据类型
interface ScadaRecord {
    inP: number
    outP: number
    inT?: number
    outT?: number
    /** 站场类型: compressor=压气站, distribution=分输站, valve=阀室 */
    type?: 'compressor' | 'distribution' | 'valve'
}

// 从监控系统截图中提取的西一线真实 SCADA 运行基准数据
const REAL_SCADA_DATA: Record<string, ScadaRecord> = {
    '中卫压气站': { inP: 6.391, outP: 7.856, inT: 7.7, outT: 30.8, type: 'compressor' },
    '盐池压气站': { inP: 7.133, outP: 7.092, inT: 10.3, outT: 10.2, type: 'compressor' },
    '靖边压气站': { inP: 6.681, outP: 8.947, inT: 5.7, outT: 34.9, type: 'compressor' },
    '子长分输站': { inP: 8.098, outP: 8.098, inT: 19.9, outT: 19.9, type: 'distribution' },
    '延川压气站': { inP: 7.880, outP: 9.175, inT: 21.4, outT: 31.9, type: 'compressor' },
    '沁水压气站': { inP: 6.889, outP: 8.762, inT: 18.0, outT: 39.4, type: 'compressor' },
    '阳城清管站': { inP: 7.936, outP: 7.912, inT: 16.4, outT: 16.4, type: 'distribution' },
    '博爱分输站': { inP: 7.118, outP: 7.126, outT: 26.2, type: 'distribution' },
    '郑州压气站': { inP: 6.166, outP: 7.830, inT: 20.1, outT: 41.9, type: 'compressor' },
    '薛店分输站': { inP: 7.273, outP: 7.273, outT: 34.8, type: 'distribution' },
    '淮阳压气站': { inP: 5.726, outP: 7.766, inT: 18.4, outT: 45.0, type: 'compressor' },
    '利辛分输站': { inP: 6.354, outP: 6.232, inT: 21.6, outT: 16.9, type: 'distribution' },
    '定远压气站': { inP: 4.818, outP: 6.245, inT: 12.8, outT: 35.0, type: 'compressor' },
    '龙池分输站': { inP: 6.005, outP: 6.002, outT: 19.3, type: 'distribution' },
    '龙源分输站': { inP: 5.971, outP: 5.590, outT: 20.4, type: 'distribution' },
    '镇江分输站': { inP: 5.573, outP: 5.575, outT: 14.9, type: 'distribution' },
    '常州分输站': { inP: 5.255, outP: 5.248, outT: 13.4, type: 'distribution' },
    '芙蓉分输站': { inP: 5.167, outP: 5.162, inT: 15.9, outT: 5.2, type: 'distribution' },
    '徐霞客分输站': { inP: 0.000, outP: 0.001, inT: 19.0, outT: 18.4, type: 'distribution' },
    '无锡分输站': { inP: 4.244, outP: 5.101, outT: 12.2, type: 'distribution' },
    '东桥分输站': { inP: 5.092, outP: 5.087, outT: 12.7, type: 'distribution' },
    '苏州分输站': { inP: 5.078, outP: 5.089, outT: 15.5, type: 'distribution' },
    '甪直分输站': { inP: 5.094, outP: 5.106, outT: 7.9, type: 'distribution' },
    '昆山分输站': { inP: 5.073, outP: 5.065, outT: 12.4, type: 'distribution' },
    '上海白鹤末站': { inP: 5.050, outP: 5.050, outT: 13.7, type: 'distribution' },
}

// 从监控系统截图中提取的西二线真实 SCADA 运行基准数据
// 数据来源：西二线导航图监控截图 (新疆段 + 甘肃段)
const WE2_SCADA_DATA: Record<string, ScadaRecord> = {
    // === 新疆段 ===
    '霍尔果斯压气站':   { inP: 7.566, outP: 9.615, inT: 15.7, outT: 34.5, type: 'compressor' },
    '精河压气站':       { inP: 8.856, outP: 8.835, inT: 14.7, type: 'compressor' },
    '乌苏压气站':       { inP: 7.981, outP: 7.977, inT: 13.8, type: 'compressor' },
    '玛纳斯压气站':     { inP: 7.202, outP: 10.123, inT: 6.7, outT: 34.0, type: 'compressor' },
    '昌吉分输站':       { inP: 9.492, outP: 9.526, inT: 6.7, type: 'distribution' },
    '乌鲁木齐压气站':   { inP: 8.529, outP: 8.441, inT: 14.7, outT: 14.7, type: 'compressor' },
    '吐鲁番分输联络站': { inP: 7.826, outP: 7.832, inT: 29.5, outT: 28.7, type: 'distribution' },
    '连木沁压气站':     { inP: 7.086, outP: 9.323, inT: 9.7, outT: 24.0, type: 'compressor' },
    '了墩压气站':       { inP: 7.940, outP: 10.163, inT: 18.9, outT: 39.7, type: 'compressor' },
    '哈密分输站':       { inP: 9.364, outP: 9.145, inT: 31.4, outT: 30.9, type: 'distribution' },
    '烟墩压气站':       { inP: 9.011, outP: 8.977, inT: 26.8, outT: 25.5, type: 'compressor' },
    // === 甘肃段 ===
    '红柳压气站':       { inP: 7.462, outP: 10.155, inT: 13.3, outT: 38.6, type: 'compressor' },
    '瓜州压气站':       { inP: 9.162, outP: 9.120, inT: 24.5, outT: 24.4, type: 'compressor' },
    '嘉峪关压气站':     { inP: 7.753, outP: 9.670, inT: 12.8, outT: 31.9, type: 'compressor' },
    '张掖压气站':       { inP: 8.599, outP: 8.555, inT: 17.1, outT: 16.6, type: 'compressor' },
    '永昌压气站':       { inP: 6.765, outP: 8.201, inT: 6.9, outT: 23.9, type: 'compressor' },
    '武威分输站':       { inP: 7.655, outP: 4.006, inT: 18.2, outT: 5.0, type: 'distribution' },
    '古浪压气站':       { inP: 6.731, outP: 8.693, inT: 10.6, outT: 31.9, type: 'compressor' },
    '中卫压气站(二线)': { inP: 8.177, outP: 8.178, inT: 24.7, type: 'compressor' },
    // === 宁夏/陕西段 ===
    '彭阳压气站':       { inP: 6.765, outP: 8.201, inT: 6.9, outT: 23.9, type: 'compressor' },
    '灵台压气站':       { inP: 6.153, outP: 8.388, inT: 12.3, outT: 38.0, type: 'compressor' },
    '高陵压气站':       { inP: 7.511, outP: 7.539, inT: 26.7, type: 'compressor' },
    '潼关压气站':       { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
    '洛宁压气站':       { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
    '鲁山压气站':       { inP: 6.614, outP: 9.230, inT: 21.0, type: 'compressor' },
    '枣阳压气站':       { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
    '黄石压气站':       { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
    '南昌压气站':       { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
    '吉安压气站':       { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
    '广州压气站':       { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
}

// 西气东输一线西段（新疆段）SCADA 运行数据
// 数据来源：西一线西段工艺综合图（2026-03-09）
const WE1_WEST_SCADA_DATA: Record<string, ScadaRecord> = {
    '轮南压气站':     { inP: 7.566, outP: 8.415, inT: 23.9, outT: 52.8, type: 'compressor' },
    '孔雀河压气站':   { inP: 8.831, outP: 8.832, inT: 25.6, outT: 49.4, type: 'compressor' },
    '四道班压气站':   { inP: 7.768, outP: 7.735, inT: 30.0, outT: 29.6, type: 'compressor' },
    '哈密压气站':     { inP: 5.878, outP: 8.868, inT: 12.6, outT: 47.0, type: 'compressor' },
    '雅满苏压气站':   { inP: 8.517, outP: 8.509, inT: 23.0, outT: 23.0, type: 'compressor' },
    '红柳压气站':     { inP: 7.382, outP: 7.388, inT: 9.8,  outT: 10.6, type: 'compressor' },
    '玉石压气站':     { inP: 5.935, outP: 8.814, inT: 6.1,  outT: 37.4, type: 'compressor' },
    '温泉压气站':     { inP: 8.298, outP: 8.245, inT: 10.0, outT: 9.7,  type: 'compressor' },
    '古浪分输压气站': { inP: 6.875, outP: 6.594, inT: 6.9,  outT: 6.6,  type: 'compressor' },
}

// 中俄东线天然气管道 SCADA 运行数据
// 数据来源：中俄东线北段+南段工艺综合图（2026-03-07）
const CRED_SCADA_DATA: Record<string, ScadaRecord> = {
    // === 北段（黑河 → 长岭）===
    '黑河首站':       { inP: 9.708, outP: 11.174, inT: 2.9,  outT: 14.4, type: 'compressor' },
    '五大连池压气站': { inP: 9.230, outP: 10.584, inT: 4.4,  outT: 15.1, type: 'compressor' },
    '明水压气站':     { inP: 8.629, outP: 10.546, inT: 5.6,  outT: 21.4, type: 'compressor' },
    '大庆分输站':     { inP: 9.148, outP: 9.000,  inT: 13.0,             type: 'distribution' },
    '肇源压气站':     { inP: 8.756, outP: 8.761,  inT: 7.7,              type: 'compressor' },
    // === 中段（长岭 → 宝坻）===
    '双辽分输站':     { inP: 8.585, outP: 10.549, inT: 10.7, outT: 27.1, type: 'distribution' },
    '长岭分输站':     { inP: 9.048, outP: 9.086,  inT: 18.5, outT: 16.6, type: 'distribution' },
    '锦州压气站':     { inP: 8.629, outP: 10.546, inT: 5.6,  outT: 21.4, type: 'compressor' },
    '永清压气站':     { inP: 8.447, outP: 8.451,  inT: 6.5,  outT: 6.9,  type: 'compressor' },
    // === 南段（安平 → 甪直）===
    '安平压气站':     { inP: 7.291, outP: 8.839,                outT: 34.6, type: 'compressor' },
    '德州分输站':     { inP: 7.291, outP: 7.291,                           type: 'distribution' },
    '济南西分输站':   { inP: 6.505, outP: 6.509,                           type: 'distribution' },
    '泰安压气站':     { inP: 6.116, outP: 8.400,  inT: 12.0, outT: 36.8, type: 'compressor' },
    '临沂分输清管站': { inP: 7.888, outP: 7.862,  inT: 15.9, outT: 15.7, type: 'distribution' },
    '连云港分输压气站':{ inP: 7.291, outP: 8.064,             outT: 22.4, type: 'compressor' },
    '阜宁联络站':     { inP: 8.034, outP: 8.045,                           type: 'distribution' },
    '盐城分输清管站': { inP: 7.980, outP: 7.992,                           type: 'distribution' },
    '泰兴联络站':     { inP: 7.250, outP: 7.218,  inT: 15.3,              type: 'distribution' },
    '南通联络站':     { inP: 7.210, outP: 7.248,  inT: 16.5, outT: 6.4,  type: 'distribution' },
    '常熟分输站':     { inP: 7.128, outP: 7.103,  inT: 16.4, outT: 18.3, type: 'distribution' },
    '甪直末站':       { inP: 7.061, outP: 5.097,  inT: 17.0, outT: 7.8,  type: 'distribution' },
}

// 平泰支干线 SCADA 运行数据
// 数据来源：东部台综合图1-平泰线区域（2026-03-07）
const PT_SCADA_DATA: Record<string, ScadaRecord> = {
    '鲁山压气站':   { inP: 5.832, outP: 5.831, inT: 18.3,              type: 'compressor' },
    '禹州分输站':   { inP: 5.742, outP: 5.742,                          type: 'distribution' },
    '薛店分输站':   { inP: 5.767, outP: 5.782,                          type: 'distribution' },
    '中牟分输站':   { inP: 5.759, outP: 5.770,                          type: 'distribution' },
    '开封分输站':   { inP: 5.730, outP: 5.724,                          type: 'distribution' },
    '杞县分输站':   { inP: 5.689, outP: 5.688, inT: 14.5,              type: 'distribution' },
    '兰考分输站':   { inP: 5.660, outP: 5.660,                          type: 'distribution' },
    '菏泽分输站':   { inP: 5.646, outP: 5.619, inT: 15.7, outT: 15.6, type: 'distribution' },
    '巨野分输站':   { inP: 5.615, outP: 5.616, inT: 14.6,              type: 'distribution' },
    '济宁分输站':   { inP: 5.597, outP: 5.616, inT: 14.6,              type: 'distribution' },
    '上山末站':     { inP: 5.542, outP: 4.203, inT: 16.5, outT: 10.5, type: 'distribution' },
    '泰安压气站':   { inP: 4.203, outP: 5.883, inT: 22.6, outT: 16.6, type: 'compressor' },
}

// 懒加载 AI 工作流组件
// 西气东输一线完整站场排列（从西到东，合并西段+东段）
const WE1_FULL_STATIONS: { name: string; inP: number; outP: number; type: string }[] = [
    // 西段（新疆→甘肃）
    ...Object.entries(WE1_WEST_SCADA_DATA).map(([name, d]) => ({ name, inP: d.inP, outP: d.outP, type: d.type || 'compressor' })),
    // 东段（中卫→上海）
    ...Object.entries(REAL_SCADA_DATA).map(([name, d]) => ({ name, inP: d.inP, outP: d.outP, type: d.type || 'distribution' })),
]

/**
 * 西气东输一线沿线压力趋势图（SVG 折线图）
 * 展示管网典型的锯齿形压力特征：压气站增压 → 沿线衰减 → 下一站再增压
 */
const PressureTrendChart: React.FC<{
    onClose: () => void
    onMouseDown?: (e: React.MouseEvent) => void
    isDragging?: boolean
}> = ({ onClose, onMouseDown, isDragging }) => {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

    const stations = WE1_FULL_STATIONS.filter(s => s.inP > 0.1) // 过滤无效值（如徐霞客）

    // SVG 绘图参数
    const W = 820, H = 300
    const padL = 50, padR = 20, padT = 20, padB = 60
    const chartW = W - padL - padR
    const chartH = H - padT - padB

    // 压力范围
    const allP = stations.flatMap(s => [s.inP, s.outP])
    const minP = Math.floor(Math.min(...allP)) - 0.5
    const maxP = Math.ceil(Math.max(...allP)) + 0.5
    const rangeP = maxP - minP

    // 坐标转换
    const xScale = (i: number) => padL + (i / (stations.length - 1)) * chartW
    const yScale = (p: number) => padT + chartH - ((p - minP) / rangeP) * chartH

    // 生成进站和出站压力的折线路径
    // 锯齿形pattern：每个站显示inP->outP的跃变（压气站增压）
    const buildSawtoothPath = () => {
        let path = ''
        stations.forEach((s, i) => {
            const x = xScale(i)
            const yIn = yScale(s.inP)
            const yOut = yScale(s.outP)
            if (i === 0) {
                path += `M ${x} ${yIn} L ${x} ${yOut}`
            } else {
                // 从上一站出站压力衰减到当前进站压力，再跳到当前出站压力
                path += ` L ${x} ${yIn} L ${x} ${yOut}`
            }
        })
        return path
    }

    // 生成水平网格线（压力刻度）
    const gridLines: number[] = []
    for (let p = Math.ceil(minP); p <= Math.floor(maxP); p++) {
        gridLines.push(p)
    }

    // 生成进站压力折线+出站压力折线（独立线）
    const inPPath = stations.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(s.inP)}`).join(' ')
    const outPPath = stations.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(s.outP)}`).join(' ')

    // 渐变填充区域
    const inPArea = inPPath + ` L ${xScale(stations.length-1)} ${padT + chartH} L ${padL} ${padT + chartH} Z`
    const outPArea = outPPath + ` L ${xScale(stations.length-1)} ${padT + chartH} L ${padL} ${padT + chartH} Z`

    return (
        <div
            className={`absolute z-20 flex flex-col select-none overflow-hidden ${isDragging ? 'cursor-grabbing' : ''}`}
            style={{
                width: '880px', height: '390px',
                background: 'linear-gradient(135deg, rgba(5,12,20,0.96) 0%, rgba(8,18,12,0.96) 100%)',
                backdropFilter: 'blur(16px)', borderRadius: '12px',
                border: '1px solid rgba(16,185,129,0.25)',
                boxShadow: '0 12px 48px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 80px rgba(16,185,129,0.04)',
            }}
        >
            {/* 顶部渐变装饰条 */}
            <div style={{ height: '3px', background: 'linear-gradient(90deg, #10b981, #34d399, #059669, #10b981)', borderRadius: '12px 12px 0 0' }} />
            {/* 头部 */}
            <div
                className="px-5 py-2.5 flex justify-between items-center shrink-0 cursor-grab active:cursor-grabbing"
                style={{ borderBottom: '1px solid rgba(16,185,129,0.12)' }}
                onMouseDown={onMouseDown}
            >
                <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: '#a7f3d0' }}>
                    <span className="material-symbols-outlined text-lg" style={{ color: '#10b981' }}>show_chart</span>
                    <span>西气东输一线 · 沿线压力趋势</span>
                    <span style={{ color: '#10b981', fontSize: '10px', fontWeight: 'normal', background: 'rgba(16,185,129,0.12)', padding: '1px 8px', borderRadius: '9999px', border: '1px solid rgba(16,185,129,0.2)' }}>
                        {stations.length} 站
                    </span>
                </h3>
                <div className="flex items-center gap-3" onMouseDown={e => e.stopPropagation()}>
                    {/* 图例 */}
                    <div className="flex items-center gap-4 mr-2" style={{ fontSize: '11px' }}>
                        <span className="flex items-center gap-1">
                            <span style={{ display: 'inline-block', width: 14, height: 3, background: '#f59e0b', borderRadius: 2 }} />
                            <span style={{ color: '#fcd34d' }}>进站压力</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <span style={{ display: 'inline-block', width: 14, height: 3, background: '#10b981', borderRadius: 2 }} />
                            <span style={{ color: '#34d399' }}>出站压力</span>
                        </span>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                        <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                </div>
            </div>

            {/* SVG 图表区 */}
            <div className="flex-1 px-4 py-2 overflow-hidden">
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
                    <defs>
                        {/* 进站压力渐变填充 */}
                        <linearGradient id="inPGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2" />
                            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
                        </linearGradient>
                        {/* 出站压力渐变填充 */}
                        <linearGradient id="outPGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                        </linearGradient>
                    </defs>

                    {/* 网格线 */}
                    {gridLines.map(p => (
                        <g key={p}>
                            <line x1={padL} y1={yScale(p)} x2={padL + chartW} y2={yScale(p)} stroke="rgba(100,116,139,0.15)" strokeWidth={1} />
                            <text x={padL - 6} y={yScale(p) + 4} textAnchor="end" fill="#64748b" fontSize="10" fontFamily="monospace">{p}</text>
                        </g>
                    ))}
                    {/* Y轴标签 */}
                    <text x={12} y={padT + chartH / 2} textAnchor="middle" fill="#94a3b8" fontSize="10" transform={`rotate(-90, 12, ${padT + chartH / 2})`}>MPa</text>

                    {/* 面积填充 */}
                    <path d={inPArea} fill="url(#inPGrad)" />
                    <path d={outPArea} fill="url(#outPGrad)" />

                    {/* 锯齿形连线（进站→出站跃变） */}
                    <path d={buildSawtoothPath()} fill="none" stroke="rgba(16,185,129,0.15)" strokeWidth={1} strokeDasharray="3,3" />

                    {/* 进站压力折线 */}
                    <path d={inPPath} fill="none" stroke="#f59e0b" strokeWidth={1.8} strokeLinejoin="round" />
                    {/* 出站压力折线 */}
                    <path d={outPPath} fill="none" stroke="#10b981" strokeWidth={1.8} strokeLinejoin="round" />

                    {/* 站点标记 + 悬停交互 */}
                    {stations.map((s, i) => {
                        const x = xScale(i)
                        const yIn = yScale(s.inP)
                        const yOut = yScale(s.outP)
                        const isHovered = hoveredIdx === i
                        const isCompressor = s.type === 'compressor'
                        // 站名：只显示压气站和悬停站，避免太密
                        const showLabel = isCompressor || isHovered || i === 0 || i === stations.length - 1
                        return (
                            <g key={i}
                                onMouseEnter={() => setHoveredIdx(i)}
                                onMouseLeave={() => setHoveredIdx(null)}
                                style={{ cursor: 'pointer' }}
                            >
                                {/* 悬停区域 */}
                                <rect x={x - 8} y={padT} width={16} height={chartH} fill="transparent" />
                                {/* 悬停竖线 */}
                                {isHovered && <line x1={x} y1={padT} x2={x} y2={padT + chartH} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />}
                                {/* 进站压力点 */}
                                <circle cx={x} cy={yIn} r={isHovered ? 4 : 2.5} fill="#f59e0b" stroke={isHovered ? '#fde68a' : 'none'} strokeWidth={1.5} opacity={isHovered ? 1 : 0.8} />
                                {/* 出站压力点 */}
                                <circle cx={x} cy={yOut} r={isHovered ? 4 : 2.5} fill="#10b981" stroke={isHovered ? '#a7f3d0' : 'none'} strokeWidth={1.5} opacity={isHovered ? 1 : 0.8} />
                                {/* 压气站增压竖线 */}
                                {isCompressor && (
                                    <line x1={x} y1={yIn} x2={x} y2={yOut} stroke="rgba(16,185,129,0.25)" strokeWidth={1} />
                                )}
                                {/* 站名标注 */}
                                {showLabel && (
                                    <text
                                        x={x} y={padT + chartH + 12}
                                        textAnchor="middle" fill={isHovered ? '#e2e8f0' : '#64748b'}
                                        fontSize={isHovered ? '10' : '8'}
                                        fontWeight={isHovered ? 600 : 400}
                                        transform={`rotate(${showLabel && !isHovered ? -45 : -30}, ${x}, ${padT + chartH + 12})`}
                                    >
                                        {s.name.replace(/压气站|分输站|清管站|末站/, '')}
                                    </text>
                                )}
                                {/* 悬停Tooltip */}
                                {isHovered && (
                                    <g>
                                        <rect x={x - 65} y={Math.min(yIn, yOut) - 58} width={130} height={52} rx={6}
                                            fill="rgba(15,23,42,0.95)" stroke="rgba(16,185,129,0.3)" strokeWidth={1} />
                                        <text x={x} y={Math.min(yIn, yOut) - 42} textAnchor="middle" fill="#e2e8f0" fontSize="11" fontWeight={600}>
                                            {s.name}
                                        </text>
                                        <text x={x - 55} y={Math.min(yIn, yOut) - 26} fill="#fcd34d" fontSize="10">
                                            进: {s.inP.toFixed(3)} MPa
                                        </text>
                                        <text x={x + 8} y={Math.min(yIn, yOut) - 26} fill="#34d399" fontSize="10">
                                            出: {s.outP.toFixed(3)} MPa
                                        </text>
                                        <text x={x} y={Math.min(yIn, yOut) - 12} textAnchor="middle" fill="#94a3b8" fontSize="9">
                                            ΔP: {(s.outP - s.inP) >= 0 ? '+' : ''}{(s.outP - s.inP).toFixed(3)} MPa
                                        </text>
                                    </g>
                                )}
                            </g>
                        )
                    })}
                </svg>
            </div>
        </div>
    )
}

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
    const [showScada, setShowScada] = useState(true)
    const [showWe2Scada, setShowWe2Scada] = useState(true)
    // 三条新管线 SCADA 面板显示状态
    const [showWe1WestScada, setShowWe1WestScada] = useState(true)
    const [showCredScada, setShowCredScada] = useState(true)
    const [showPtScada, setShowPtScada] = useState(true)
    // 压力趋势图面板
    const [showTrendChart, setShowTrendChart] = useState(true)

    // 西二线 SCADA 面板拖拽状态
    const [we2ScadaPos, setWe2ScadaPos] = useState({
        x: typeof window !== 'undefined' ? Math.max(10, window.innerWidth - 450) : 800,
        y: typeof window !== 'undefined' ? window.innerHeight - 340 : 500
    })
    const [isDraggingWe2Scada, setIsDraggingWe2Scada] = useState(false)
    const we2DragOffsetRef = React.useRef({ x: 0, y: 0 })

    const handleWe2ScadaMouseDown = (e: React.MouseEvent) => {
        setIsDraggingWe2Scada(true)
        we2DragOffsetRef.current = {
            x: e.clientX - we2ScadaPos.x,
            y: e.clientY - we2ScadaPos.y
        }
    }

    // 通用拖拽面板处理
    // 将每个新面板的拖拽状态打包起来
    // 获取屏幕尺寸计算安全先
    const W = typeof window !== 'undefined' ? window.innerWidth : 1280
    const H = typeof window !== 'undefined' ? window.innerHeight : 800

    // 西一线西段 SCADA 面板（放在西一线东段面板右侧）
    const [we1WestPos, setWe1WestPos] = useState({ x: 330, y: H - 340 })
    const [isDraggingWe1West, setIsDraggingWe1West] = useState(false)
    const we1WestOffsetRef = React.useRef({ x: 0, y: 0 })
    const handleWe1WestMouseDown = (e: React.MouseEvent) => {
        setIsDraggingWe1West(true)
        we1WestOffsetRef.current = { x: e.clientX - we1WestPos.x, y: e.clientY - we1WestPos.y }
    }

    // 中俄东线 SCADA 面板（居中偏下）
    const [credPos, setCredPos] = useState({ x: Math.round(W / 2) - 240, y: H - 340 })
    const [isDraggingCred, setIsDraggingCred] = useState(false)
    const credOffsetRef = React.useRef({ x: 0, y: 0 })
    const handleCredMouseDown = (e: React.MouseEvent) => {
        setIsDraggingCred(true)
        credOffsetRef.current = { x: e.clientX - credPos.x, y: e.clientY - credPos.y }
    }

    // 平泰支干线 SCADA 面板（右下）
    const [ptPos, setPtPos] = useState({ x: Math.max(10, W - 510), y: H - 340 })
    const [isDraggingPt, setIsDraggingPt] = useState(false)
    const ptOffsetRef = React.useRef({ x: 0, y: 0 })
    const handlePtMouseDown = (e: React.MouseEvent) => {
        setIsDraggingPt(true)
        ptOffsetRef.current = { x: e.clientX - ptPos.x, y: e.clientY - ptPos.y }
    }

    // 压力趋势图面板（默认屏幕居中上部）
    const [trendPos, setTrendPos] = useState({ x: Math.round(W / 2) - 440, y: 100 })
    const [isDraggingTrend, setIsDraggingTrend] = useState(false)
    const trendOffsetRef = React.useRef({ x: 0, y: 0 })
    const handleTrendMouseDown = (e: React.MouseEvent) => {
        setIsDraggingTrend(true)
        trendOffsetRef.current = { x: e.clientX - trendPos.x, y: e.clientY - trendPos.y }
    }

    // 使用 useCallback 稳定回调引用，避免触发 MapView 无限循环
    const handleMapLoad = useCallback((map: any) => {
        setMapInstance(map)
    }, [])

    // SCADA 面板拖拽状态
    const { isPoppedOut: isScadaPoppedOut, popOut: popOutScada, closePopOut: closeScadaPopOut } = useNewWindow('scada-sync', '/popout/scada');
    const [scadaPos, setScadaPos] = useState({
        x: 330,
        y: typeof window !== 'undefined' ? window.innerHeight - 340 : 500
    })
    const [isDraggingScada, setIsDraggingScada] = useState(false)
    const dragOffsetRef = React.useRef({ x: 0, y: 0 })

    const handleScadaMouseDown = (e: React.MouseEvent) => {
        setIsDraggingScada(true)
        dragOffsetRef.current = {
            x: e.clientX - scadaPos.x,
            y: e.clientY - scadaPos.y
        }
    }

    const handleGlobalMouseMove = (e: React.MouseEvent) => {
        if (isDraggingScada) {
            setScadaPos({
                x: e.clientX - dragOffsetRef.current.x,
                y: e.clientY - dragOffsetRef.current.y
            })
        }
        if (isDraggingWe2Scada) {
            setWe2ScadaPos({
                x: e.clientX - we2DragOffsetRef.current.x,
                y: e.clientY - we2DragOffsetRef.current.y
            })
        }
        // 其余三个面板拖拽处理
        if (isDraggingWe1West) setWe1WestPos({ x: e.clientX - we1WestOffsetRef.current.x, y: e.clientY - we1WestOffsetRef.current.y })
        if (isDraggingCred)    setCredPos({    x: e.clientX - credOffsetRef.current.x,    y: e.clientY - credOffsetRef.current.y    })
        if (isDraggingPt)      setPtPos({      x: e.clientX - ptOffsetRef.current.x,      y: e.clientY - ptOffsetRef.current.y      })
        if (isDraggingTrend)   setTrendPos({   x: e.clientX - trendOffsetRef.current.x,   y: e.clientY - trendOffsetRef.current.y   })
    }

    const handleGlobalMouseUp = () => {
        if (isDraggingScada)    setIsDraggingScada(false)
        if (isDraggingWe2Scada) setIsDraggingWe2Scada(false)
        if (isDraggingWe1West)  setIsDraggingWe1West(false)
        if (isDraggingCred)     setIsDraggingCred(false)
        if (isDraggingPt)       setIsDraggingPt(false)
        if (isDraggingTrend)    setIsDraggingTrend(false)
    }

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

    // 全选 / 全部取消功能
    const toggleAllLayers = (visible: boolean) => {
        const newState: Record<string, boolean> = {}
        for (let i = 0; i < ALL_PIPELINES.length; i++) {
            const pkg = ALL_PIPELINES[i]
            for (let j = 0; j < pkg.layers.length; j++) {
                newState[pkg.layers[j].name] = visible
            }
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

    // ==========================================
    // 将 SCADA 数据直接渲染在对应管网节点上 (无动画/单纯显示)
    // ==========================================
    useEffect(() => {
        if (!mapInstance) return

        let timer: any

        // 使用 timer 定期重新挂载属性（考虑用户缩放或平移时地图重新生成 marker）
        timer = setInterval(() => {
            const markerMap = getNodeMarkerMap()
            if (markerMap.size === 0) return

            markerMap.forEach((marker) => {
                if (!marker || !marker.getContent) return

                const node = marker.getExtData()?.node as PipelineNode
                if (!node) return

                let originalContent = typeof marker.getContent === 'function' ? marker.getContent() : marker.getContent?.() || ''
                if (typeof originalContent !== 'string') return

                const hasRealtime = originalContent.includes('<!--scada-label-->')
                if (hasRealtime) {
                    originalContent = originalContent.split('<!--scada-label-->')[0]
                }

                const scadaData = REAL_SCADA_DATA[node.name]
                if (!scadaData) {
                    if (hasRealtime) marker.setContent(originalContent)
                    return
                }

                const inTLabel = scadaData.inT ? ` T: ${scadaData.inT}` : ''
                const outTLabel = scadaData.outT ? ` T: ${scadaData.outT}` : ''

                const scadaHTML = `
                    <!--scada-label-->
                    <div class="absolute left-1/2 -top-1 -translate-x-1/2 -translate-y-full flex flex-col items-center pointer-events-none whitespace-nowrap z-50 overflow-visible" 
                         style="line-height: 1.1; display:flex;">
                        <span style="font-size:10px; font-weight:bold; color:#10b981; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;">
                            入 P: ${scadaData.inP.toFixed(2)}${inTLabel}
                        </span>
                        <span style="font-size:10px; font-weight:bold; color:#3b82f6; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;">
                            出 P: ${scadaData.outP.toFixed(2)}${outTLabel}
                        </span>
                    </div>
                `

                if (originalContent.includes('class="compressor-marker-container"')) {
                    originalContent = originalContent.replace('class="compressor-marker-container"', 'class="compressor-marker-container" style="position:relative; overflow:visible;"')
                    marker.setContent(originalContent + scadaHTML)
                } else if (originalContent.startsWith('<div')) {
                    originalContent = originalContent.replace('<div', '<div style="position:relative; overflow:visible;"')
                    marker.setContent(originalContent + scadaHTML)
                }
            })
        }, 800)

        return () => clearInterval(timer)
    }, [mapInstance])

    return (
        <div
            className="h-screen w-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 overflow-hidden relative"
            onMouseMove={handleGlobalMouseMove}
            onMouseUp={handleGlobalMouseUp}
            onMouseLeave={handleGlobalMouseUp}
        >
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
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => toggleAllLayers(true)}
                            className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 hover:text-white transition-colors"
                            title="显示全部管线"
                        >
                            全选
                        </button>
                        <button
                            onClick={() => toggleAllLayers(false)}
                            className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 hover:text-white transition-colors"
                            title="隐藏全部管线"
                        >
                            全部取消
                        </button>
                        <button
                            onClick={() => setIsEditMode(!isEditMode)}
                            className={`text-xs px-2 py-1 rounded border transition-colors flex items-center gap-1 ${isEditMode ? 'bg-blue-600 border-blue-500 text-white' : 'border-gray-600 text-gray-400 hover:text-white'}`}
                            title="开启/关闭绘图工具"
                        >
                            <span className="material-symbols-outlined text-sm">edit</span>
                            {isEditMode ? '绘图开启' : '绘图'}
                        </button>
                    </div>
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

                                    {/* 文本标签及额外的弹出按钮 */}
                                    <div className="flex-1 flex items-center justify-between">
                                        <span className="text-white font-medium text-sm flex items-center gap-2.5">
                                            <span
                                                className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]"
                                                style={{ backgroundColor: pkg.color }}
                                            ></span>
                                            {pkg.name}
                                        </span>
                                        {/* 仅针对西气东输一线和二线显示 SCADA 图标 */}
                                        {pkg.name === '西气东输二线' && (
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setShowWe2Scada(!showWe2Scada); }}
                                                    className={`transition-colors flex items-center justify-center w-6 h-6 rounded hover:bg-white/10 ${showWe2Scada ? 'text-blue-400 hover:text-blue-300' : 'text-gray-500 hover:text-gray-300'}`}
                                                    title={showWe2Scada ? "隐藏西二线参数表" : "显示西二线参数表"}
                                                >
                                                    <span className="material-symbols-outlined text-sm">{showWe2Scada ? 'visibility' : 'visibility_off'}</span>
                                                </button>
                                            </div>
                                        )}
                                        {pkg.name === '西气东输一线' && !isScadaPoppedOut && (
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setShowScada(!showScada); }}
                                                    className={`transition-colors flex items-center justify-center w-6 h-6 rounded hover:bg-white/10 ${showScada ? 'text-emerald-400 hover:text-emerald-300' : 'text-gray-500 hover:text-gray-300'}`}
                                                    title={showScada ? "隐藏原位面板" : "显示原位面板"}
                                                >
                                                    <span className="material-symbols-outlined text-sm">{showScada ? 'visibility' : 'visibility_off'}</span>
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); popOutScada(400, 500); setShowScada(false); }}
                                                    className="text-gray-400 hover:text-white transition-colors flex items-center justify-center w-6 h-6 rounded hover:bg-white/10"
                                                    title="弹出独立窗口"
                                                >
                                                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
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

            {/* ====== 西一线 SCADA 浮动参数表 (支持弹窗新窗口) ====== */}
            {isScadaPoppedOut && (
                <div className="hidden">{/* 主页面隐藏该面板，在 Popup 窗口中渲染 */}</div>
            )}
            {showScada && !isScadaPoppedOut && (
                <div
                    className={`absolute z-10 flex flex-col select-none overflow-hidden ${isDraggingScada ? 'cursor-grabbing' : ''}`}
                    style={{
                        left: `${scadaPos.x}px`,
                        top: `${scadaPos.y}px`,
                        width: '480px',
                        height: '310px',
                        background: 'linear-gradient(135deg, rgba(10,20,30,0.92) 0%, rgba(15,30,20,0.92) 100%)',
                        backdropFilter: 'blur(12px)',
                        borderRadius: '10px',
                        border: '1px solid rgba(16,185,129,0.3)',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(16,185,129,0.05)',
                    }}
                >
                    {/* 头部装饰条 */}
                    <div style={{ height: '3px', background: 'linear-gradient(90deg, #10b981, #059669, #10b981)', borderRadius: '10px 10px 0 0', opacity: 0.9 }} />
                    <div
                        className={`px-4 py-2.5 flex justify-between items-center shrink-0 cursor-grab active:cursor-grabbing`}
                        style={{ borderBottom: '1px solid rgba(16,185,129,0.15)' }}
                        onMouseDown={handleScadaMouseDown}
                    >
                        <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: '#a7f3d0' }}>
                            <span className="material-symbols-outlined text-lg" style={{ color: '#10b981' }}>sensors</span>
                            <span>西气东输一线</span>
                            <span style={{ color: '#10b981', fontSize: '10px', fontWeight: 'normal', background: 'rgba(16,185,129,0.15)', padding: '1px 6px', borderRadius: '9999px', border: '1px solid rgba(16,185,129,0.3)' }}>SCADA 实时</span>
                        </h3>
                        <div className="flex gap-1" onMouseDown={e => e.stopPropagation()}>
                            <button onClick={() => setShowScada(false)} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                                <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                        </div>
                    </div>
                    <ScadaTableContent data={REAL_SCADA_DATA} isPoppedOut={false} closePopOut={closeScadaPopOut} popOut={popOutScada} accentColor="#10b981" />
                </div>
            )}

            {/* ====== 西二线 SCADA 浮动参数表 ====== */}
            {showWe2Scada && (
                <div
                    className={`absolute z-10 flex flex-col select-none overflow-hidden ${isDraggingWe2Scada ? 'cursor-grabbing' : ''}`}
                    style={{
                        left: `${we2ScadaPos.x}px`,
                        top: `${we2ScadaPos.y}px`,
                        width: '480px',
                        height: '310px',
                        background: 'linear-gradient(135deg, rgba(10,15,30,0.92) 0%, rgba(10,20,35,0.92) 100%)',
                        backdropFilter: 'blur(12px)',
                        borderRadius: '10px',
                        border: '1px solid rgba(59,130,246,0.3)',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(59,130,246,0.05)',
                    }}
                >
                    {/* 头部装饰条 */}
                    <div style={{ height: '3px', background: 'linear-gradient(90deg, #3b82f6, #2563eb, #3b82f6)', borderRadius: '10px 10px 0 0', opacity: 0.9 }} />
                    <div
                        className={`px-4 py-2.5 flex justify-between items-center shrink-0 cursor-grab active:cursor-grabbing`}
                        style={{ borderBottom: '1px solid rgba(59,130,246,0.15)' }}
                        onMouseDown={handleWe2ScadaMouseDown}
                    >
                        <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: '#bfdbfe' }}>
                            <span className="material-symbols-outlined text-lg" style={{ color: '#3b82f6' }}>sensors</span>
                            <span>西气东输二线</span>
                            <span style={{ color: '#3b82f6', fontSize: '10px', fontWeight: 'normal', background: 'rgba(59,130,246,0.15)', padding: '1px 6px', borderRadius: '9999px', border: '1px solid rgba(59,130,246,0.3)' }}>SCADA 实时</span>
                        </h3>
                        <div className="flex gap-1" onMouseDown={e => e.stopPropagation()}>
                            <button onClick={() => setShowWe2Scada(false)} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                                <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                        </div>
                    </div>
                    <ScadaTableContent data={WE2_SCADA_DATA} isPoppedOut={false} closePopOut={() => {}} popOut={() => {}} accentColor="#3b82f6" />
                </div>
            )}

            {/* ====== 西一线西段 SCADA 浮动参数表（主色：黄橙/amber） ====== */}
            {showWe1WestScada && (
                <div
                    className={`absolute z-10 flex flex-col select-none overflow-hidden ${isDraggingWe1West ? 'cursor-grabbing' : ''}`}
                    style={{
                        left: `${we1WestPos.x}px`, top: `${we1WestPos.y}px`,
                        width: '480px', height: '310px',
                        background: 'linear-gradient(135deg, rgba(20,15,5,0.93) 0%, rgba(30,20,5,0.93) 100%)',
                        backdropFilter: 'blur(12px)', borderRadius: '10px',
                        border: '1px solid rgba(245,158,11,0.3)',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
                    }}
                >
                    <div style={{ height: '3px', background: 'linear-gradient(90deg,#f59e0b,#d97706,#f59e0b)', borderRadius: '10px 10px 0 0' }} />
                    <div className="px-4 py-2.5 flex justify-between items-center shrink-0 cursor-grab active:cursor-grabbing" style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }} onMouseDown={handleWe1WestMouseDown}>
                        <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: '#fde68a' }}>
                            <span className="material-symbols-outlined text-lg" style={{ color: '#f59e0b' }}>sensors</span>
                            <span>西气东输一线（西段）</span>
                            <span style={{ color: '#f59e0b', fontSize: '10px', fontWeight: 'normal', background: 'rgba(245,158,11,0.15)', padding: '1px 6px', borderRadius: '9999px', border: '1px solid rgba(245,158,11,0.3)' }}>SCADA 实时</span>
                        </h3>
                        <div className="flex gap-1" onMouseDown={e => e.stopPropagation()}>
                            <button onClick={() => setShowWe1WestScada(false)} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                                <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                        </div>
                    </div>
                    <ScadaTableContent data={WE1_WEST_SCADA_DATA} isPoppedOut={false} closePopOut={() => {}} popOut={() => {}} accentColor="#f59e0b" />
                </div>
            )}

            {/* ====== 中俄东线 SCADA 浮动参数表（主色：玫红） ====== */}
            {showCredScada && (
                <div
                    className={`absolute z-10 flex flex-col select-none overflow-hidden ${isDraggingCred ? 'cursor-grabbing' : ''}`}
                    style={{
                        left: `${credPos.x}px`, top: `${credPos.y}px`,
                        width: '480px', height: '310px',
                        background: 'linear-gradient(135deg, rgba(25,5,15,0.93) 0%, rgba(35,5,20,0.93) 100%)',
                        backdropFilter: 'blur(12px)', borderRadius: '10px',
                        border: '1px solid rgba(236,72,153,0.3)',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
                    }}
                >
                    <div style={{ height: '3px', background: 'linear-gradient(90deg,#ec4899,#be185d,#ec4899)', borderRadius: '10px 10px 0 0' }} />
                    <div className="px-4 py-2.5 flex justify-between items-center shrink-0 cursor-grab active:cursor-grabbing" style={{ borderBottom: '1px solid rgba(236,72,153,0.15)' }} onMouseDown={handleCredMouseDown}>
                        <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: '#fbcfe8' }}>
                            <span className="material-symbols-outlined text-lg" style={{ color: '#ec4899' }}>sensors</span>
                            <span>中俄东线</span>
                            <span style={{ color: '#ec4899', fontSize: '10px', fontWeight: 'normal', background: 'rgba(236,72,153,0.15)', padding: '1px 6px', borderRadius: '9999px', border: '1px solid rgba(236,72,153,0.3)' }}>SCADA 实时</span>
                        </h3>
                        <div className="flex gap-1" onMouseDown={e => e.stopPropagation()}>
                            <button onClick={() => setShowCredScada(false)} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                                <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                        </div>
                    </div>
                    <ScadaTableContent data={CRED_SCADA_DATA} isPoppedOut={false} closePopOut={() => {}} popOut={() => {}} accentColor="#ec4899" />
                </div>
            )}

            {/* ====== 平泰支干线 SCADA 浮动参数表（主色：紫色） ====== */}
            {showPtScada && (
                <div
                    className={`absolute z-10 flex flex-col select-none overflow-hidden ${isDraggingPt ? 'cursor-grabbing' : ''}`}
                    style={{
                        left: `${ptPos.x}px`, top: `${ptPos.y}px`,
                        width: '480px', height: '310px',
                        background: 'linear-gradient(135deg, rgba(15,5,25,0.93) 0%, rgba(20,5,35,0.93) 100%)',
                        backdropFilter: 'blur(12px)', borderRadius: '10px',
                        border: '1px solid rgba(168,85,247,0.3)',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
                    }}
                >
                    <div style={{ height: '3px', background: 'linear-gradient(90deg,#a855f7,#7c3aed,#a855f7)', borderRadius: '10px 10px 0 0' }} />
                    <div className="px-4 py-2.5 flex justify-between items-center shrink-0 cursor-grab active:cursor-grabbing" style={{ borderBottom: '1px solid rgba(168,85,247,0.15)' }} onMouseDown={handlePtMouseDown}>
                        <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: '#e9d5ff' }}>
                            <span className="material-symbols-outlined text-lg" style={{ color: '#a855f7' }}>sensors</span>
                            <span>平泰支干线</span>
                            <span style={{ color: '#a855f7', fontSize: '10px', fontWeight: 'normal', background: 'rgba(168,85,247,0.15)', padding: '1px 6px', borderRadius: '9999px', border: '1px solid rgba(168,85,247,0.3)' }}>SCADA 实时</span>
                        </h3>
                        <div className="flex gap-1" onMouseDown={e => e.stopPropagation()}>
                            <button onClick={() => setShowPtScada(false)} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                                <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                        </div>
                    </div>
                    <ScadaTableContent data={PT_SCADA_DATA} isPoppedOut={false} closePopOut={() => {}} popOut={() => {}} accentColor="#a855f7" />
                </div>
            )}

            {/* ====== 西气东输一线 沿线压力趋势图 ====== */}
            {showTrendChart && (
                <div style={{ left: `${trendPos.x}px`, top: `${trendPos.y}px`, position: 'absolute', zIndex: 20 }}>
                    <PressureTrendChart
                        onClose={() => setShowTrendChart(false)}
                        onMouseDown={handleTrendMouseDown}
                        isDragging={isDraggingTrend}
                    />
                </div>
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

// 抽取 SCADA 内容渲染部分，供复用
const ScadaTableContent: React.FC<{
    data: Record<string, ScadaRecord>
    isPoppedOut: boolean
    closePopOut: () => void
    popOut: (w: number, h: number) => void
    accentColor?: string
}> = ({ data, isPoppedOut, closePopOut, accentColor = '#10b981' }) => {
    // 根据 accentColor 生成进入亮色（将色调变亮一点作为进入压力列）
    // 映射表：升色额色 → 进入色 (accentColor 相对是“出射2”，进入用更亮变体)
    const inPressureColor = accentColor === '#10b981' ? '#34d399'
        : accentColor === '#3b82f6' ? '#60a5fa'
        : accentColor === '#f59e0b' ? '#fcd34d'
        : accentColor === '#ec4899' ? '#f9a8d4'
        : accentColor === '#a855f7' ? '#d8b4fe'
        : '#a3e635'  // fallback

    // 压力异常判断阈值（MPa）
    const isLowPressure = (p: number) => p < 5.0
    const isHighPressure = (p: number) => p > 10.5
    const getPressureColor = (p: number, baseColor: string) => {
        if (isLowPressure(p)) return '#f97316' // 橙色警告
        if (isHighPressure(p)) return '#ef4444' // 红色高压
        return baseColor
    }

    // 将 accentColor (hex) 转换为 rgba 背景色
    const rowBgAccent = accentColor.replace('#', '')
    function hexToRgb(hex: string) {
        const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16)
        return `${r},${g},${b}`
    }
    const rgb = hexToRgb(rowBgAccent)

    return (
        <div className={`flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar ${isPoppedOut ? 'h-full w-full p-4 text-white' : 'p-2'}`}
            style={{ scrollbarWidth: 'thin', scrollbarColor: `${accentColor}40 transparent` }}
        >
            {isPoppedOut && (
                <div className="pb-3 mb-3 border-b border-white/10 flex justify-between items-center">
                    <h3 className="m-0 text-sm font-bold flex items-center gap-1.5 text-slate-200">
                        <span className="material-symbols-outlined text-lg" style={{ color: accentColor }}>sensors</span>
                        SCADA 实时监控参数
                    </h3>
                    <button onClick={closePopOut} className="text-gray-400 hover:text-white transition-colors" title="恢复回主窗口">
                        <span className="material-symbols-outlined text-sm">open_in_browser</span>
                    </button>
                </div>
            )}
            {/* 优化后的列表式表格 */}
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 3px', fontSize: '12px' }}>
                <thead>
                    <tr style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        <th style={{ padding: '2px 6px', textAlign: 'left', fontWeight: 600 }}>站名</th>
                        <th style={{ padding: '2px 6px', textAlign: 'center', fontWeight: 600 }}>类型</th>
                        <th style={{ padding: '2px 8px', textAlign: 'right', fontWeight: 600 }}>进站压力</th>
                        <th style={{ padding: '2px 4px', textAlign: 'center', fontWeight: 600 }}>进温</th>
                        <th style={{ padding: '2px 8px', textAlign: 'right', fontWeight: 600 }}>出站压力</th>
                        <th style={{ padding: '2px 4px', textAlign: 'center', fontWeight: 600 }}>出温</th>
                    </tr>
                </thead>
                <tbody>
                    {(Object.entries(data) as [string, ScadaRecord][]).map(([name, d]) => {
                        const isCompressor = d.type === 'compressor'
                        const rowBg = isCompressor
                            ? `rgba(${rgb},0.08)`
                            : 'rgba(255,255,255,0.02)'
                        const nameBold = isCompressor
                        const typeLabel = d.type === 'compressor' ? '压' : d.type === 'distribution' ? '分' : '阀'
                        const typeBg = d.type === 'compressor' ? `rgba(${rgb},0.22)` : 'rgba(100,116,139,0.2)'
                        const typeColor = d.type === 'compressor' ? accentColor : '#94a3b8'

                        return (
                            <tr
                                key={name}
                                style={{ background: rowBg, borderRadius: '6px', transition: 'background 0.15s' }}
                                onMouseEnter={e => (e.currentTarget.style.background = `rgba(${rgb},0.14)`)}
                                onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                            >
                                <td style={{ padding: '5px 6px', borderRadius: '6px 0 0 6px', fontWeight: nameBold ? 600 : 400, color: '#e2e8f0', maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>
                                    {name}
                                </td>
                                <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                                    <span style={{ fontSize: '10px', background: typeBg, color: typeColor, padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>{typeLabel}</span>
                                </td>
                                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: getPressureColor(d.inP, inPressureColor), fontWeight: 600 }}>
                                    {d.inP.toFixed(3)}
                                </td>
                                <td style={{ padding: '5px 4px', textAlign: 'center', color: '#f97316', fontSize: '11px' }}>
                                    {d.inT != null ? `${d.inT}°` : '—'}
                                </td>
                                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: getPressureColor(d.outP, accentColor), fontWeight: 600 }}>
                                    {d.outP.toFixed(3)}
                                </td>
                                <td style={{ padding: '5px 4px', textAlign: 'center', color: '#fb923c', fontSize: '11px', borderRadius: '0 6px 6px 0' }}>
                                    {d.outT != null ? `${d.outT}°` : '—'}
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}

// 供独立路由使用的单体组件
export const ScadaStandalone: React.FC = () => {
    // 专用 Hook 负责防白屏和发送心跳
    usePopoutSync('scada-sync');

    return (
        <div className="h-screen w-screen bg-[#0c1218] flex flex-col">
            <ScadaTableContent data={REAL_SCADA_DATA} isPoppedOut={true} closePopOut={() => window.close()} popOut={() => { }} accentColor="#10b981" />
        </div>
    )
}

export default GlobalPipelineView
