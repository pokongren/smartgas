/**
 * 广深支干线可视化数据
 *
 * 管线走向: 广州 → 东莞 → 求雨岭 → 大铲岛(深圳)
 * 包含: 1条干线 + 1条支线(樟木头支线)
 *
 * NOTE: 最短的支干线之一，全长约 258km，连接珠三角核心区域
 */

import gsStructure from '../gs_structure.json'
import { PipelinePackage, PipelineLayer } from './types'
import { PipelineNode, PipelineLine, PressureLevel, PipelineStatus, NodeType } from '../../types'

// ================== 坐标定义 ==================
const GS_COORDS: Record<string, { lng: number; lat: number }> = {
    // 干线 (广州 → 大铲岛)
    '广州压气站': { lng: 113.26, lat: 23.13 },
    '东莞分输站': { lng: 113.75, lat: 23.04 },
    '求雨岭分输站': { lng: 113.95, lat: 22.73 },
    '大铲岛压气站': { lng: 113.80, lat: 22.43 },

    // 樟木头支线
    '11#和12#阀室之间': { lng: 113.76, lat: 23.03 },  // 支线起点，在东莞分输站附近
    '樟木头分输站': { lng: 114.07, lat: 22.91 },
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
const COLOR_TRUNK = '#ff9800'    // 琥珀色 - 干线 (广深支干线)
const COLOR_BRANCH = '#ffcc80'   // 浅琥珀色 - 支线

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
        const coord = GS_COORDS[node.name]
        if (coord) {
            anchors.push({ index: i, node, coord })
        }
    })

    if (anchors.length < 2) {
        console.warn(`[GS] ${layerName} 锚点不足 (${anchors.length}个), 跳过`)
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
                    properties: { category: '广深支干线', color }
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
                properties: { category: '广深支干线', color }
            })
        }
    }

    return { nodes, lines }
}

// ================== 生成图层 ==================

const trunkData = generateLayerData(
    gsStructure.trunk as RawNode[],
    '广深支干线',
    'GS',
    COLOR_TRUNK,
    true
)

const trunkLayer: PipelineLayer = {
    name: '广深支干线',
    type: 'trunk',
    nodes: trunkData.nodes,
    lines: trunkData.lines,
    visible: true
}

const branchLayers: PipelineLayer[] = []
if (gsStructure.branches && gsStructure.branch_names) {
    gsStructure.branches.forEach((branchNodes, index) => {
        const branchName = gsStructure.branch_names[index]
        if (!branchNodes || branchNodes.length === 0) return

        const layerData = generateLayerData(
            branchNodes as RawNode[],
            branchName,
            `GS-B${index + 1}`,
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

export const gsPackage: PipelinePackage = {
    id: 'gs',
    name: '广深支干线',
    color: COLOR_TRUNK,
    layers: [trunkLayer, ...branchLayers]
}

export default gsPackage
