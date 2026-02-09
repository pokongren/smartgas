/**
 * 西气东输一线可视化数据 (重构版)
 * 
 * 基于 Pipeline Topology Extractor 生成的结构文件 (we1_structure.json)
 *自适应生成干线和支线，支持阀室插值
 */

import we1Structure from '../we1_structure.json'
import { PipelinePackage, PipelineLayer } from './types'
import { PipelineNode, PipelineLine, PressureLevel, PipelineStatus, NodeType } from '@/types'

// ================== 坐标定义 ==================
// 仅包含已知坐标的站场，阀室坐标将通过插值生成
const WE1_COORDS: Record<string, { lng: number; lat: number }> = {
    // 新疆段
    '轮南压气站': { lng: 84.25, lat: 41.78 },
    '孔雀河压气站': { lng: 86.17, lat: 41.73 },
    '四道班压气站': { lng: 88.00, lat: 42.30 },
    '鄯善压气站': { lng: 90.21, lat: 42.86 },
    '哈密压气站': { lng: 93.52, lat: 42.82 },
    '雅满苏压气站': { lng: 94.80, lat: 42.50 },
    // 甘肃段
    '红柳压气站': { lng: 95.50, lat: 41.80 },
    '柳园压气站': { lng: 96.00, lat: 41.00 },
    '玉门压气站': { lng: 97.04, lat: 40.27 },
    '酒泉压气站': { lng: 98.49, lat: 39.73 },
    '山丹压气站': { lng: 101.09, lat: 38.78 },
    '金昌压气站': { lng: 102.06, lat: 38.37 },
    '古浪分输站': { lng: 103.00, lat: 37.60 },
    '古浪压气站': { lng: 103.52, lat: 37.48 },
    // 宁夏/陕西/山西段
    '中卫压气站': { lng: 105.19, lat: 37.51 },
    '西一盐池压气站': { lng: 107.40, lat: 37.78 },
    '西一靖边压气站': { lng: 108.79, lat: 37.60 },
    '延川压气站': { lng: 110.19, lat: 36.88 },
    '蒲县压气站': { lng: 111.10, lat: 36.41 },
    '临汾分输站': { lng: 111.52, lat: 36.09 },
    // 河南/安徽/江苏/上海段
    '郑州分输站': { lng: 113.63, lat: 34.75 },
    '南京分输站': { lng: 118.80, lat: 32.06 },
    '南京末站': { lng: 118.85, lat: 32.10 },
    '南京计量中心': { lng: 118.90, lat: 32.12 },
    '白鹤末站': { lng: 121.14, lat: 31.26 },

    // 补充：靖边以东缺失的关键站场 (Based on we1_structure.json)
    '沁水压气站': { lng: 112.18, lat: 35.69 },
    '郑州压气站': { lng: 113.30, lat: 34.80 }, // 修正：结构中使用的是压气站
    '薛店分输站': { lng: 113.72, lat: 34.46 },
    '淮阳压气站': { lng: 114.88, lat: 33.73 },
    '太和分输站': { lng: 115.62, lat: 33.17 },
    '利辛分输站': { lng: 116.21, lat: 32.90 },
    '刘巷子分输站': { lng: 116.90, lat: 32.70 },
    '定远压气站': { lng: 117.68, lat: 32.53 },
    '滁州分输站': { lng: 118.32, lat: 32.30 },
    '龙池分输站': { lng: 118.83, lat: 32.24 },
    '青山分输站': { lng: 119.05, lat: 32.20 },
    '龙潭分输站': { lng: 119.10, lat: 32.18 },
    '镇江分输站': { lng: 119.45, lat: 32.20 },
    '丹阳分输站': { lng: 119.60, lat: 32.00 },
    '常州分输站': { lng: 119.98, lat: 31.81 },
    '芙蓉分输站': { lng: 120.20, lat: 31.65 },
    '无锡分输站': { lng: 120.31, lat: 31.49 },
    '东桥分输站': { lng: 120.50, lat: 31.40 },
    '苏州分输站': { lng: 120.58, lat: 31.30 },
    '甪直分输站': { lng: 120.87, lat: 31.27 },
    '昆山分输站': { lng: 120.98, lat: 31.38 },

    // 补充支线可能用到的关键点 (如有)
    // 暂时假设支线起点都在干线上
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
const COLOR_TRUNK = '#FF5722' // 深橙色
const COLOR_BRANCH = '#FF8A65' // 浅橙色

// 全局 ID 缓存 (确保跨层连接一致性)
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

// ================== 核心生成逻辑 ==================

function generateLayerData(
    rawNodes: RawNode[],
    layerName: string,
    idPrefix: string,
    color: string,
    isTrunk: boolean
): { nodes: PipelineNode[]; lines: PipelineLine[] } {
    const nodes: PipelineNode[] = []
    const lines: PipelineLine[] = []

    // 1. 识别锚点 (有坐标的节点)
    const anchors: { index: number; node: RawNode; coord: { lng: number; lat: number } }[] = []

    rawNodes.forEach((node, i) => {
        const coord = WE1_COORDS[node.name]
        if (coord) {
            anchors.push({ index: i, node, coord })
        }
    })

    if (anchors.length < 2) {
        // 如果是支线，可能只有一个锚点(连接干线处)，或者没有
        // 这种情况下由于无法插值，暂时跳过或者只显示点
        if (anchors.length === 1 && !isTrunk) {
            // 尝试生成单个节点?
        }
        console.warn(`[WE1] ${layerName} 锚点不足 (${anchors.length}个), 无法完整生成路径`)
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
            // 新节点
            currNodeId = `${idPrefix}-S-${currAnchor.node.id}`
            stationIdMap.set(currAnchor.node.name, currNodeId)
        } else {
            // 已存在节点 (通常是支线连接到干线)
            // 如果不是干线，且节点已存在，则不渲染重复节点
            if (!isTrunk) shouldRenderNode = false
        }

        // 强制渲染干线节点，或支线独有节点
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

        // --- 处理区段插值 (连接到下一个锚点) ---
        if (i < anchors.length - 1) {
            const nextAnchor = anchors[i + 1]
            const sectionDist = nextAnchor.node.mileage - currAnchor.node.mileage

            let prevNodeId = currNodeId
            let prevCoord = currAnchor.coord

            // 遍历中间节点 (阀室等)
            for (let j = currAnchor.index + 1; j < nextAnchor.index; j++) {
                const midNode = rawNodes[j]

                // 计算插值
                let ratio = 0
                if (sectionDist > 0) {
                    ratio = (midNode.mileage - currAnchor.node.mileage) / sectionDist
                }
                const midCoord = interpolateCoord(currAnchor.coord, nextAnchor.coord, ratio)

                // 生成中间节点
                const midNodeId = `${idPrefix}-N-${midNode.id}` // 阀室/中间点使用不同ID前缀
                // 注意: 这里假设中间节点都是独有的 (阀室不共用)

                nodes.push({
                    id: midNodeId,
                    name: midNode.name,
                    type: mapNodeType(midNode.type),
                    coordinate: { longitude: midCoord.lng, latitude: midCoord.lat },
                    pressureLevel: PressureLevel.HIGH,
                    status: PipelineStatus.NORMAL,
                    properties: { pipeline: layerName }
                })

                // 生成管段 (前一个点 -> 中间点)
                lines.push({
                    id: `${idPrefix}-L-${++segmentCounter}`,
                    name: `${layerName}-段${segmentCounter}`,
                    startNodeId: prevNodeId!,
                    endNodeId: midNodeId,
                    path: [
                        { longitude: prevCoord.lng, latitude: prevCoord.lat },
                        { longitude: midCoord.lng, latitude: midCoord.lat }
                    ],
                    // 样式
                    diameter: 1016,
                    material: 'Steel',
                    pressureLevel: PressureLevel.HIGH,
                    status: PipelineStatus.NORMAL,
                    length: (midNode.mileage - (j === currAnchor.index + 1 ? currAnchor.node.mileage : rawNodes[j - 1].mileage)) * 1000,
                    properties: { category: '西一线', color: color }
                })

                prevNodeId = midNodeId
                prevCoord = midCoord
            }

            // --- 最后一段 (最后一个中间点 -> 下一个锚点) ---

            // 确定下一个锚点ID
            let nextNodeId = stationIdMap.get(nextAnchor.node.name)
            if (!nextNodeId) {
                // 如果还没生成，预先分配一个ID
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
                diameter: 1016,
                material: 'Steel',
                pressureLevel: PressureLevel.HIGH,
                status: PipelineStatus.NORMAL,
                length: (nextAnchor.node.mileage - (currAnchor.index + 1 === nextAnchor.index ? currAnchor.node.mileage : rawNodes[nextAnchor.index - 1].mileage)) * 1000,
                properties: { category: '西一线', color: color }
            })
        }
    }

    return { nodes, lines }
}

// ================== 生成图层 ==================

// 1. 干线
const trunkData = generateLayerData(
    we1Structure.trunk as RawNode[],
    '西一线干线',
    'WE1',
    COLOR_TRUNK,
    true
)

const trunkLayer: PipelineLayer = {
    name: '西一线干线',
    type: 'trunk',
    nodes: trunkData.nodes,
    lines: trunkData.lines,
    visible: true
}

// 2. 支线
const branchLayers: PipelineLayer[] = []
if (we1Structure.branches && we1Structure.branch_names) {
    we1Structure.branches.forEach((branchNodes, index) => {
        const branchName = we1Structure.branch_names[index]
        // 简单过滤可能的空支线
        if (!branchNodes || branchNodes.length === 0) return

        const layerData = generateLayerData(
            branchNodes as RawNode[],
            branchName,
            `WE1-B${index + 1}`, // 支线ID前缀
            COLOR_BRANCH,
            false
        )

        if (layerData.nodes.length > 0 || layerData.lines.length > 0) {
            branchLayers.push({
                name: branchName,
                type: 'branch',
                nodes: layerData.nodes,
                lines: layerData.lines,
                visible: false // 支线默认隐藏? 或者显示? 视需求而定，这里默认隐藏保持整洁
            })
        }
    })
}

// ================== 导出包 ==================

export const we1Package: PipelinePackage = {
    id: 'we1',
    name: '西气东输一线',
    color: COLOR_TRUNK,
    layers: [trunkLayer, ...branchLayers]
}

export default we1Package
