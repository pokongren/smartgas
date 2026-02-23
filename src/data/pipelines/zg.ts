/**
 * 中贵线可视化数据
 *
 * 管线走向: 宁夏中卫 → 贵州贵阳
 * 包含: 1条干线 + 多条支线
 */

import zgStructure from '../zg_structure.json'
import { PipelinePackage, PipelineLayer } from './types'
import { PipelineNode, PipelineLine, PressureLevel, PipelineStatus, NodeType } from '../../types'

// ================== 坐标定义 ==================
const ZG_COORDS: Record<string, { lng: number; lat: number }> = {
    // 干线
    '中卫压气站': { lng: 105.18, lat: 37.51 },
    '固原压气站': { lng: 106.28, lat: 36.01 },
    '硝河分输站': { lng: 106.02, lat: 35.53 },
    '天水压气站': { lng: 105.72, lat: 34.58 },
    '陇南分输站': { lng: 104.92, lat: 33.38 },
    '广元压气站': { lng: 105.82, lat: 32.43 },
    '南部分输站': { lng: 106.06, lat: 31.35 },
    '南充压气站': { lng: 106.08, lat: 30.79 },
    '武胜分输站': { lng: 106.30, lat: 30.35 },
    '铜梁分输站': { lng: 106.05, lat: 29.84 },
    '中贵马坊分输站': { lng: 106.18, lat: 29.41 },
    '江津压气站': { lng: 106.25, lat: 29.28 },
    '遵义压气站': { lng: 106.92, lat: 27.72 },
    '贵阳北分输站': { lng: 106.63, lat: 26.65 },
    '贵阳压气站': { lng: 106.71, lat: 26.57 },

    // 支线
    '元坝首站': { lng: 105.95, lat: 32.22 },
    '陵江分输站': { lng: 105.98, lat: 32.25 },
    '陵江清管站': { lng: 105.96, lat: 32.24 },     // 元坝-陵江联络线末端
    '固原压气站门站': { lng: 106.29, lat: 36.00 },
    '固原门站': { lng: 106.29, lat: 36.00 },
    '原州联络站': { lng: 106.30, lat: 36.02 },     // 固原-原州联络线末端
    '天水末站': { lng: 105.74, lat: 34.60 },
    '广元燃机末站': { lng: 105.85, lat: 32.45 },
    '广元电厂末站': { lng: 105.85, lat: 32.45 },   // 广元燃机工程供气管道末端
    '广元燃机站': { lng: 105.85, lat: 32.45 },
    '支坪分输站': { lng: 106.27, lat: 29.30 },
    '支坪末站': { lng: 106.28, lat: 29.32 },
    '支坪分输站站': { lng: 106.28, lat: 29.32 },
    '成县末站': { lng: 105.72, lat: 33.74 },
    '陇南末站': { lng: 104.95, lat: 33.40 },       // 陇南支线末端
    '定西末站': { lng: 104.62, lat: 35.58 },
    '陇西末站': { lng: 104.60, lat: 35.00 },
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
const COLOR_TRUNK = '#00d4ff'    // 天蓝色 - 干线 (中贵线)
const COLOR_BRANCH = '#80e5ff'   // 浅蓝色 - 支线

// 全局 ID 缓存
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

    const anchors: { index: number; node: RawNode; coord: { lng: number; lat: number } }[] = []

    rawNodes.forEach((node, i) => {
        const coord = ZG_COORDS[node.name]
        if (coord) {
            anchors.push({ index: i, node, coord })
        }
    })

    if (anchors.length < 2) {
        console.warn(`[ZG] ${layerName} 锚点不足 (${anchors.length}个), 跳过`)
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
                    properties: { category: '中贵线', color }
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
                properties: { category: '中贵线', color }
            })
        }
    }

    return { nodes, lines }
}

// ================== 生成图层 ==================

const trunkData = generateLayerData(
    zgStructure.trunk as RawNode[],
    '中贵线干线',
    'ZG',
    COLOR_TRUNK,
    true
)

const trunkLayer: PipelineLayer = {
    name: '中贵线',
    type: 'trunk',
    nodes: trunkData.nodes,
    lines: trunkData.lines,
    visible: true
}

const branchLayers: PipelineLayer[] = []
if (zgStructure.branches && zgStructure.branch_names) {
    zgStructure.branches.forEach((branchNodes, index) => {
        const branchName = zgStructure.branch_names[index]
        if (!branchNodes || branchNodes.length === 0) return

        const layerData = generateLayerData(
            branchNodes as RawNode[],
            branchName,
            `ZG-B${index + 1}`,
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

export const zgPackage: PipelinePackage = {
    id: 'zg',
    name: '中贵线',
    color: COLOR_TRUNK,
    layers: [trunkLayer, ...branchLayers]
}

export default zgPackage
