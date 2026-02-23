/**
 * 广南支干线可视化数据
 *
 * 管线走向: 广东广州 → 清远 → 佛山 → 肇庆 → 德庆 → 梧州 → 贵港 → 横县 → 南宁
 * 包含: 1条干线(广东段+广西段合并) + 6条支线
 *
 * NOTE: 干线由"广南广东段"和"广南广西段"两段合并重排，
 *       广西段里程已偏移使其与广东段连续
 */

import gnStructure from '../gn_structure.json'
import { PipelinePackage, PipelineLayer } from './types'
import { PipelineNode, PipelineLine, PressureLevel, PipelineStatus, NodeType } from '../../types'

// ================== 坐标定义 ==================
// NOTE: 坐标沿管道走廊排列（非城市中心），确保所有站场呈线性平滑分布
// 广南支干线沿西江流域从广州(东) → 南宁(西) 铺设
const GN_COORDS: Record<string, { lng: number; lat: number }> = {
    // 干线 - 广东段 (广州一路向西，沿西江南岸)
    '广州压气站': { lng: 113.26, lat: 23.13 },
    '清远分输站': { lng: 113.10, lat: 23.15 },     // 站场在管道走廊上，非清远市中心
    '佛山分输站': { lng: 112.90, lat: 23.10 },     // 管道走廊经过佛山西侧
    '肇庆分输站': { lng: 112.50, lat: 23.06 },
    '高要分输站': { lng: 112.30, lat: 23.04 },
    '德庆分输站': { lng: 111.80, lat: 23.10 },

    // 干线 - 广西段 (沿西江继续向西到南宁)
    '梧州压气站': { lng: 111.30, lat: 23.20 },
    '贵港压气站': { lng: 109.60, lat: 23.11 },
    '横县分输站': { lng: 109.10, lat: 22.95 },
    '南宁分输站': { lng: 108.37, lat: 22.82 },

    // 苍梧-贺州支线 (从梧州向北)
    '苍梧分输站': { lng: 111.25, lat: 23.42 },
    '临港分输站': { lng: 111.20, lat: 23.55 },
    '长洲分输站': { lng: 111.30, lat: 23.70 },
    '贺州末站': { lng: 111.55, lat: 24.40 },

    // 贵港-玉林支线 (从贵港向东南)
    '玉林末站': { lng: 110.18, lat: 22.63 },

    // 南宁-百色支线 (从南宁向西)
    '吴圩分输站': { lng: 108.15, lat: 22.72 },
    '隆安分输站': { lng: 107.70, lat: 23.20 },
    '田东分输站': { lng: 107.12, lat: 23.55 },
    '百色末站': { lng: 106.62, lat: 23.85 },

    // 联络线
    '广西管道南宁分输站': { lng: 108.35, lat: 22.80 },
    '广南支干线南宁分输站': { lng: 108.38, lat: 22.83 },

    // 南宁-凭祥支线（南宁-崇左段，从南宁向西南）
    '苏圩输气站': { lng: 108.10, lat: 22.55 },
    '扶绥输气站': { lng: 107.85, lat: 22.40 },
    '崇左输气站': { lng: 107.37, lat: 22.35 },

    // 珊瑚支线
    '广南2#阀室': { lng: 112.85, lat: 23.08 },
    '珊瑚门站': { lng: 111.80, lat: 23.12 },
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
const COLOR_TRUNK = '#9c27b0'    // 紫色 - 干线
const COLOR_BRANCH = '#ce93d8'   // 浅紫色 - 支线

// 全局 ID 缓存（确保干支线共用站点 ID 一致）
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

    // 识别锚点（有坐标的节点）
    const anchors: { index: number; node: RawNode; coord: { lng: number; lat: number } }[] = []
    rawNodes.forEach((node, i) => {
        const coord = GN_COORDS[node.name]
        if (coord) {
            anchors.push({ index: i, node, coord })
        }
    })

    if (anchors.length < 2) {
        console.warn(`[GN] ${layerName} 锚点不足 (${anchors.length}个), 跳过`)
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
            // 支线遇到已有干线站点时不重复渲染
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

        // 在当前锚点和下一个锚点之间插值中间节点
        if (i < anchors.length - 1) {
            const nextAnchor = anchors[i + 1]
            const sectionDist = nextAnchor.node.mileage - currAnchor.node.mileage

            let prevNodeId = currNodeId
            let prevCoord = currAnchor.coord

            for (let j = currAnchor.index + 1; j < nextAnchor.index; j++) {
                const midNode = rawNodes[j]
                let ratio = 0
                if (Math.abs(sectionDist) > 0.01) {
                    ratio = (midNode.mileage - currAnchor.node.mileage) / sectionDist
                }
                // 防止异常比例
                ratio = Math.max(0, Math.min(1, ratio))
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
                    length: Math.abs(midNode.mileage - (j === currAnchor.index + 1 ? currAnchor.node.mileage : rawNodes[j - 1].mileage)) * 1000,
                    properties: { category: '广南支干线', color }
                })

                prevNodeId = midNodeId
                prevCoord = midCoord
            }

            // 连接到下一个锚点
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
                length: Math.abs(nextAnchor.node.mileage - (currAnchor.index + 1 === nextAnchor.index ? currAnchor.node.mileage : rawNodes[nextAnchor.index - 1].mileage)) * 1000,
                properties: { category: '广南支干线', color }
            })
        }
    }

    return { nodes, lines }
}

// ================== 生成图层 ==================

const trunkData = generateLayerData(
    gnStructure.trunk as RawNode[],
    '广南支干线',
    'GN',
    COLOR_TRUNK,
    true
)

const trunkLayer: PipelineLayer = {
    name: '广南支干线',
    type: 'trunk',
    nodes: trunkData.nodes,
    lines: trunkData.lines,
    visible: true
}

const branchLayers: PipelineLayer[] = []
if (gnStructure.branches && gnStructure.branch_names) {
    gnStructure.branches.forEach((branchNodes, index) => {
        const branchName = gnStructure.branch_names[index]
        if (!branchNodes || branchNodes.length === 0) return

        const layerData = generateLayerData(
            branchNodes as RawNode[],
            branchName,
            `GN-B${index + 1}`,
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

export const gnPackage: PipelinePackage = {
    id: 'gn',
    name: '广南支干线',
    color: COLOR_TRUNK,
    layers: [trunkLayer, ...branchLayers]
}

export default gnPackage
