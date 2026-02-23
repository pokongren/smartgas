/**
 * 中缅线（国内段）可视化数据
 *
 * 管线走向: 云南瑞丽 → 保山 → 楚雄 → 贵阳 → 河池 → 贵港
 * 包含: 1条干线 + 13条支线
 *
 * NOTE: 干线从瑞丽入境口延伸到广西贵港，全长约 1744km
 */

import zmStructure from '../zm_structure.json'
import { PipelinePackage, PipelineLayer } from './types'
import { PipelineNode, PipelineLine, PressureLevel, PipelineStatus, NodeType } from '../../types'

// ================== 坐标定义 ==================
// 干线沿途主要站场坐标（基于实际管线走向和沿线城市位置）
const ZM_COORDS: Record<string, { lng: number; lat: number }> = {
    // 干线 (西南→东南，从瑞丽到贵港)
    '瑞丽分输站': { lng: 97.85, lat: 24.02 },
    '芒市分输站': { lng: 98.57, lat: 24.44 },
    '龙陵分输站': { lng: 98.69, lat: 24.59 },
    '保山压气站': { lng: 99.18, lat: 25.12 },
    '弥渡分输站': { lng: 100.49, lat: 25.34 },
    '楚雄分输站': { lng: 101.55, lat: 25.03 },
    '禄丰分输站': { lng: 102.08, lat: 25.15 },
    '寻甸分输站': { lng: 103.26, lat: 25.56 },
    '曲靖分输站': { lng: 103.80, lat: 25.49 },
    '安顺分输站': { lng: 105.95, lat: 26.25 },
    '贵阳压气站': { lng: 106.71, lat: 26.57 },
    '都匀分输站': { lng: 107.52, lat: 26.26 },
    '河池压气站': { lng: 108.06, lat: 24.69 },
    '宜州分输站': { lng: 108.65, lat: 24.49 },
    '忻城分输站': { lng: 108.67, lat: 24.07 },
    '来宾分输站': { lng: 109.22, lat: 23.73 },
    '贵港压气站': { lng: 109.60, lat: 23.11 },

    // 丽江支线
    '大理分输站': { lng: 100.23, lat: 25.59 },
    '丽江末站': { lng: 100.23, lat: 26.87 },
    // 玉溪支线
    '安宁分输站': { lng: 102.47, lat: 24.92 },
    '玉溪末站': { lng: 102.55, lat: 24.35 },
    // 都匀支线
    '都匀末站': { lng: 107.52, lat: 26.24 },
    // 独山支线
    '独山首站': { lng: 107.54, lat: 25.83 },
    '独山分输站': { lng: 107.55, lat: 25.83 },
    // 荔波支线
    '荔波首站': { lng: 107.89, lat: 25.41 },
    '荔波末站': { lng: 107.90, lat: 25.40 },
    // 三都支线
    '三都末站': { lng: 107.87, lat: 25.98 },
    // 平塘支线
    '平塘分输站': { lng: 107.32, lat: 25.83 },
    // 福泉支线
    '云雾首站': { lng: 107.35, lat: 26.35 },
    '昌明分输站': { lng: 107.41, lat: 26.40 },
    '贵定分输站': { lng: 107.23, lat: 26.58 },
    '福泉末站': { lng: 107.51, lat: 26.70 },
    // 长顺支线
    '燕楼首站': { lng: 106.59, lat: 26.38 },
    '广顺分输站': { lng: 106.39, lat: 26.22 },
    '长顺分输站': { lng: 106.45, lat: 26.02 },
    // 河池支线
    '河池末站': { lng: 108.05, lat: 24.70 },
    // 钦州支线
    '南宁分输站': { lng: 108.37, lat: 22.82 },
    '钦州分输站': { lng: 108.65, lat: 21.98 },
    '钦州港分输站': { lng: 108.61, lat: 21.70 },
    '大番坡分输站': { lng: 108.55, lat: 22.10 },
    '河东分输站': { lng: 108.50, lat: 22.05 },
    // 防城港支线
    '防城港末站': { lng: 108.35, lat: 21.76 },
    // 桂林支线
    '柳州分输站': { lng: 109.42, lat: 24.33 },
    '永福分输站': { lng: 109.98, lat: 24.98 },
    '桂林末站': { lng: 110.29, lat: 25.27 },
}

// ================== 类型定义 ==================
interface RawNode {
    id: number
    name: string
    mileage: number
    type: string
    branch_name: string
}

// ================== 颜色定义 ==================
const COLOR_TRUNK = '#ff6b35'    // 橙红色 - 干线 (中缅管道)
const COLOR_BRANCH = '#ffab91'   // 浅橙色 - 支线

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
        const coord = ZM_COORDS[node.name]
        if (coord) {
            anchors.push({ index: i, node, coord })
        }
    })

    if (anchors.length < 2) {
        console.warn(`[ZM] ${layerName} 锚点不足 (${anchors.length}个), 跳过`)
        return { nodes: [], lines: [] }
    }

    let segmentCounter = 0

    for (let i = 0; i < anchors.length; i++) {
        const currAnchor = anchors[i]
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
                properties: { rotation: 90, pipeline: layerName, rawType: currAnchor.node.type }
            })
        }

        if (i < anchors.length - 1) {
            const nextAnchor = anchors[i + 1]
            const sectionDist = nextAnchor.node.mileage - currAnchor.node.mileage

            let prevNodeId = currNodeId
            let prevCoord = currAnchor.coord

            for (let j = currAnchor.index + 1; j < nextAnchor.index; j++) {
                const midNode = rawNodes[j]
                let ratio = 0
                if (sectionDist > 0) {
                    ratio = (midNode.mileage - currAnchor.node.mileage) / sectionDist
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
                    diameter: 1016,
                    material: 'Steel',
                    pressureLevel: PressureLevel.HIGH,
                    status: PipelineStatus.NORMAL,
                    length: (midNode.mileage - (j === currAnchor.index + 1 ? currAnchor.node.mileage : rawNodes[j - 1].mileage)) * 1000,
                    properties: { category: '中缅线', color }
                })

                prevNodeId = midNodeId
                prevCoord = midCoord
            }

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
                diameter: 1016,
                material: 'Steel',
                pressureLevel: PressureLevel.HIGH,
                status: PipelineStatus.NORMAL,
                length: (nextAnchor.node.mileage - (currAnchor.index + 1 === nextAnchor.index ? currAnchor.node.mileage : rawNodes[nextAnchor.index - 1].mileage)) * 1000,
                properties: { category: '中缅线', color }
            })
        }
    }

    return { nodes, lines }
}

// ================== 生成图层 ==================

const trunkData = generateLayerData(
    zmStructure.trunk as RawNode[],
    '中缅线干线',
    'ZM',
    COLOR_TRUNK,
    true
)

const trunkLayer: PipelineLayer = {
    name: '中缅线',
    type: 'trunk',
    nodes: trunkData.nodes,
    lines: trunkData.lines,
    visible: true
}

const branchLayers: PipelineLayer[] = []
if (zmStructure.branches && zmStructure.branch_names) {
    zmStructure.branches.forEach((branchNodes, index) => {
        const branchName = zmStructure.branch_names[index]
        if (!branchNodes || branchNodes.length === 0) return

        const layerData = generateLayerData(
            branchNodes as RawNode[],
            branchName,
            `ZM-B${index + 1}`,
            COLOR_BRANCH,
            false
        )

        if (layerData.nodes.length > 0 || layerData.lines.length > 0) {
            branchLayers.push({
                name: branchName,
                type: 'branch',
                nodes: layerData.nodes,
                lines: layerData.lines,
                visible: false
            })
        }
    })
}

// ================== 导出包 ==================

export const zmPackage: PipelinePackage = {
    id: 'zm',
    name: '中缅线',
    color: COLOR_TRUNK,
    layers: [trunkLayer, ...branchLayers]
}

export default zmPackage
