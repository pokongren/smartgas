/**
 * 中俄东线天然气管道可视化数据
 * 
 * 北起黑龙江省黑河市，南至上海市，全长约5111公里
 * 包含：跨境段、北段干线、中段干线、南段干线
 * 支线：齐齐哈尔支线、明水-哈尔滨支线、兰西-绥化支线、
 *        大庆-双合支线、长岭-长春支线等
 */

import credStructure from '../cred_structure.json'
import { PipelinePackage, PipelineLayer } from './types'
import { PipelineNode, PipelineLine, PressureLevel, PipelineStatus, NodeType } from '@/types'

// ================== 坐标定义 ==================
// 关键站场的经纬度坐标（用于锚点定位，阀室坐标通过线性插值自动计算）
const CRED_COORDS: Record<string, { lng: number; lat: number }> = {
    // === 跨境段 ===
    '交气点': { lng: 127.50, lat: 50.25 },         // 中俄边境交气点
    '黑河压气站': { lng: 127.53, lat: 50.22 },      // 黑河

    // === 北段干线（黑河 → 长岭）===
    '五大连池压气站': { lng: 126.10, lat: 48.60 },
    '明水压气站': { lng: 125.90, lat: 47.17 },
    '大庆分输站': { lng: 125.10, lat: 46.58 },
    '肇源压气站': { lng: 124.69, lat: 45.52 },
    '中俄长岭分输站': { lng: 123.97, lat: 44.28 },

    // === 中段干线（长岭 → 永清）===
    '双辽分输站': { lng: 123.50, lat: 43.50 },
    '通辽分输站': { lng: 122.27, lat: 43.62 },
    '沈阳压气站': { lng: 123.38, lat: 41.80 },
    '盘锦联络站': { lng: 122.07, lat: 41.12 },
    '锦州压气站': { lng: 121.13, lat: 41.10 },
    '中俄秦皇岛分输站': { lng: 119.60, lat: 39.93 },
    '中俄唐山压气站': { lng: 118.18, lat: 39.63 },
    '中俄宝坻分输站': { lng: 117.31, lat: 39.72 },
    '永清压气站': { lng: 116.50, lat: 39.32 },

    // === 南段干线（安平-泰兴）===
    '安平压气站': { lng: 115.52, lat: 38.23 },
    '德州分输站': { lng: 116.36, lat: 37.45 },
    '济南西站': { lng: 116.85, lat: 36.66 },
    '泰安压气站': { lng: 117.09, lat: 36.19 },
    // NOTE: 以下站名与数据库实际名称一致（之前用的"东平分输站"等名称与实际不匹配）
    '泗水分输清管站': { lng: 117.25, lat: 35.66 },     // 济宁市泗水县
    '临沂分输清管站': { lng: 118.35, lat: 35.05 },     // 临沂市兰山区
    '连云港分输压气站': { lng: 119.18, lat: 34.60 },   // 连云港市赣榆区
    '灌南分输站': { lng: 119.32, lat: 34.09 },         // 连云港市灌南县
    '阜宁联络站': { lng: 119.80, lat: 33.78 },         // 盐城市阜宁县
    '阜宁分输站': { lng: 119.82, lat: 33.76 },         // 紧邻阜宁联络站
    '盐城分输清管站': { lng: 120.13, lat: 33.35 },     // 盐城市亭湖区
    '盐都分输站': { lng: 120.15, lat: 33.28 },         // 盐城市盐都区
    '盐都南分输站': { lng: 120.18, lat: 33.18 },       // 盐都区南部
    '兴化分输站': { lng: 119.85, lat: 32.94 },         // 泰州市兴化市
    '东台分输站': { lng: 120.32, lat: 32.87 },         // 盐城市东台市
    '海安分输站': { lng: 120.47, lat: 32.53 },         // 南通市海安市
    '泰兴联络站': { lng: 120.05, lat: 32.17 },         // 泰州市泰兴市

    // === 南段干线（南通-甪直）===
    '南通联络站': { lng: 120.86, lat: 32.01 },         // 南通市
    '南通分输站': { lng: 120.86, lat: 32.01 },         // 同南通联络站位置
    '常熟分输站': { lng: 120.75, lat: 31.65 },
    '甪直联络站': { lng: 120.98, lat: 31.30 },         // 苏州市吴中区甪直镇
    '甪直末站': { lng: 120.98, lat: 31.27 },

    // === 支线关键节点 ===
    // 齐齐哈尔支线
    '齐齐哈尔分输站': { lng: 123.97, lat: 47.35 },
    // 明水-哈尔滨支线
    '哈尔滨分输站': { lng: 126.63, lat: 45.76 },
    // 兰西-绥化支线
    '绥化分输站': { lng: 126.99, lat: 46.65 },
    // 大庆-双合支线
    '双合站': { lng: 124.25, lat: 46.10 },
    // 长岭-长春支线
    '长春分输站': { lng: 125.32, lat: 43.88 },
}

// 类型定义
interface RawNode {
    id: number
    name: string
    mileage: number
    type: string
    branch_name: string
}

// 颜色定义
const COLOR_TRUNK = '#e91e63'   // 品红色 - 干线（与其他管线区分）
const COLOR_BRANCH = '#f48fb1'  // 浅粉色 - 支线

// 全局 ID 缓存（确保跨层连接一致性）
const stationIdMap = new Map<string, string>()

// ================== 辅助函数 ==================

function mapNodeType(rawType: string): NodeType {
    switch (rawType) {
        case 'compressor': return NodeType.REGULATOR
        case 'distribution': return NodeType.METERING
        case 'valve': return NodeType.VALVE
        default: return NodeType.JUNCTION
    }
}

function interpolateCoord(
    start: { lng: number; lat: number },
    end: { lng: number; lat: number },
    ratio: number
) {
    return {
        lng: start.lng + (end.lng - start.lng) * ratio,
        lat: start.lat + (end.lat - start.lat) * ratio
    }
}

// ================== 干线节点排序预处理（Pipeline Master System 阶段二必做步骤） ==================
// NOTE: 中俄东线由多段组成，里程在每段内独立编号
// 必须按「段序 + 里程」双重排序，防止跨段节点错位导致连线异常
const TRUNK_SEGMENT_ORDER = [
    '中俄东线跨境段',
    '中俄东线北段干线',
    '中俄东线中段干线',
    '中俄东线南段干线（安平-泰兴）',
    '中俄东线南段干线（南通-甪直）',
]

// ================== 核心生成逻辑 ==================

function generateLayerData(
    rawNodes: RawNode[],
    layerName: string,
    idPrefix: string,
    color: string,
    isTrunk: boolean,
    category: string = '中俄东线'
): { nodes: PipelineNode[]; lines: PipelineLine[] } {
    const nodes: PipelineNode[] = []
    const lines: PipelineLine[] = []

    // 1. 识别锚点（有坐标的节点）
    const anchors: { index: number; node: RawNode; coord: { lng: number; lat: number } }[] = []

    rawNodes.forEach((node, i) => {
        const coord = CRED_COORDS[node.name]
        if (coord) {
            anchors.push({ index: i, node, coord })
        }
    })

    if (anchors.length < 2) {
        if (anchors.length === 1 && !isTrunk) {
            // 支线只有一个锚点，无法插值，跳过
        }
        console.warn(`[CRED] ${layerName} 锚点不足 (${anchors.length}个), 无法完整生成路径`)
        return { nodes: [], lines: [] }
    }

    let segmentCounter = 0

    // 2. 遍历锚点区段
    for (let i = 0; i < anchors.length; i++) {
        const currAnchor = anchors[i]

        // --- 处理当前锚点节点 ---
        let currNodeId = stationIdMap.get(currAnchor.node.name)
        let shouldRenderNode = true

        if (!currNodeId) {
            currNodeId = `${idPrefix}-S-${currAnchor.node.id}`
            stationIdMap.set(currAnchor.node.name, currNodeId)
        } else {
            if (!isTrunk) shouldRenderNode = false
        }

        if (shouldRenderNode) {
            nodes.push({
                id: currNodeId,
                name: currAnchor.node.name,
                type: mapNodeType(currAnchor.node.type),
                coordinate: { longitude: currAnchor.coord.lng, latitude: currAnchor.coord.lat },
                pressureLevel: PressureLevel.HIGH,
                status: PipelineStatus.NORMAL,
                properties: {
                    rotation: 90,
                    pipeline: layerName,
                    rawType: currAnchor.node.type
                }
            })
        }

        // --- 处理区段插值（连接到下一个锚点）---
        if (i < anchors.length - 1) {
            const nextAnchor = anchors[i + 1]
            const sectionDist = nextAnchor.node.mileage - currAnchor.node.mileage

            let prevNodeId = currNodeId
            let prevCoord = currAnchor.coord

            // 遍历中间节点（阀室等）
            for (let j = currAnchor.index + 1; j < nextAnchor.index; j++) {
                const midNode = rawNodes[j]

                let ratio = 0
                if (sectionDist > 0) {
                    ratio = (midNode.mileage - currAnchor.node.mileage) / sectionDist
                } else if (sectionDist < 0) {
                    // 跨段时里程可能重置，使用均匀分布
                    ratio = (j - currAnchor.index) / (nextAnchor.index - currAnchor.index)
                }
                const midCoord = interpolateCoord(currAnchor.coord, nextAnchor.coord, ratio)

                const midNodeId = `${idPrefix}-N-${midNode.id}`

                nodes.push({
                    id: midNodeId,
                    name: midNode.name,
                    type: mapNodeType(midNode.type),
                    coordinate: { longitude: midCoord.lng, latitude: midCoord.lat },
                    pressureLevel: PressureLevel.HIGH,
                    status: PipelineStatus.NORMAL,
                    properties: { pipeline: layerName }
                })

                lines.push({
                    id: `${idPrefix}-L-${++segmentCounter}`,
                    name: `${layerName}-段${segmentCounter}`,
                    startNodeId: prevNodeId!,
                    endNodeId: midNodeId,
                    path: [
                        { longitude: prevCoord.lng, latitude: prevCoord.lat },
                        { longitude: midCoord.lng, latitude: midCoord.lat }
                    ],
                    diameter: 1422,
                    material: 'X80',
                    pressureLevel: PressureLevel.HIGH,
                    status: PipelineStatus.NORMAL,
                    length: Math.abs(midNode.mileage - (j === currAnchor.index + 1 ? currAnchor.node.mileage : rawNodes[j - 1].mileage)) * 1000,
                    properties: { category, color }
                })

                prevNodeId = midNodeId
                prevCoord = midCoord
            }

            // --- 最后一段（最后中间点 → 下一个锚点）---
            let nextNodeId = stationIdMap.get(nextAnchor.node.name)
            if (!nextNodeId) {
                nextNodeId = `${idPrefix}-S-${nextAnchor.node.id}`
                stationIdMap.set(nextAnchor.node.name, nextNodeId)
            }

            lines.push({
                id: `${idPrefix}-L-${++segmentCounter}`,
                name: `${layerName}-段${segmentCounter}`,
                startNodeId: prevNodeId!,
                endNodeId: nextNodeId,
                path: [
                    { longitude: prevCoord.lng, latitude: prevCoord.lat },
                    { longitude: nextAnchor.coord.lng, latitude: nextAnchor.coord.lat }
                ],
                diameter: 1422,
                material: 'X80',
                pressureLevel: PressureLevel.HIGH,
                status: PipelineStatus.NORMAL,
                length: Math.abs(nextAnchor.node.mileage - currAnchor.node.mileage) * 1000,
                properties: { category, color }
            })
        }
    }

    return { nodes, lines }
}

// ================== 生成图层 ==================

// 1. 干线
const trunkData = generateLayerData(
    credStructure.trunk as RawNode[],
    '中俄东线干线',
    'CRED',
    COLOR_TRUNK,
    true,
    '中俄东线'
)

const trunkLayer: PipelineLayer = {
    name: '中俄东线干线',
    type: 'trunk',
    nodes: trunkData.nodes,
    lines: trunkData.lines,
    visible: true
}

// FIX: 补充南段干线跨段连接（安平-泰兴 与 南通-甪直 之间里程重置导致连接中断）
const taixingId = stationIdMap.get('泰兴联络站')
const nantongId = stationIdMap.get('南通联络站')
if (taixingId && nantongId) {
    const hasCrossSegment = trunkLayer.lines.some(l =>
        (l.startNodeId === taixingId && l.endNodeId === nantongId) ||
        (l.startNodeId === nantongId && l.endNodeId === taixingId)
    )
    if (!hasCrossSegment) {
        console.warn('[CRED] 补充泰兴-南通跨段连接线')
        trunkLayer.lines.push({
            id: 'CRED-L-CROSS-TAIXING-NANTONG',
            name: '中俄东线干线-泰兴南通跨段',
            startNodeId: taixingId,
            endNodeId: nantongId,
            path: [
                { longitude: 120.05, latitude: 32.17 },
                { longitude: 120.86, latitude: 32.01 }
            ],
            diameter: 1422,
            material: 'X80',
            pressureLevel: PressureLevel.HIGH,
            status: PipelineStatus.NORMAL,
            length: 78000,
            properties: { category: '中俄东线', color: COLOR_TRUNK }
        })
    }
}

// 2. 支线
const branchLayers: PipelineLayer[] = []
if (credStructure.branches && credStructure.branch_names) {
    credStructure.branches.forEach((branchNodes, index) => {
        const branchName = credStructure.branch_names[index]
        if (!branchNodes || branchNodes.length === 0) return

        const layerData = generateLayerData(
            branchNodes as RawNode[],
            branchName,
            `CRED-B${index + 1}`,
            COLOR_BRANCH,
            false,
            '中俄东线'
        )

        if (layerData.nodes.length > 0 || layerData.lines.length > 0) {
            branchLayers.push({
                name: branchName,
                type: 'branch',
                nodes: layerData.nodes,
                lines: layerData.lines,
                visible: false  // 支线默认隐藏保持整洁
            })
        }
    })
}

// ================== 导出包 ==================

export const credPackage: PipelinePackage = {
    id: 'cred',
    name: '中俄东线',
    color: COLOR_TRUNK,
    layers: [trunkLayer, ...branchLayers]
}

export default credPackage
