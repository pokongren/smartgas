/**
 * 平泰支干线可视化数据
 *
 * 管线走向: 河南鲁山 → 禹州 → 新郑(薛店) → 中牟 → 开封 → 杞县 → 兰考 → 菏泽 → 巨野 → 济宁 → 泰安
 * 包含: 1条干线(河南段+山东段连续里程) + 1条支线(西二中开-中开平泰联络线)
 *
 * NOTE: 干线里程 0~545km，河南段和山东段在数据库中虽然 branch_name 不同，但里程连续，视为同一条干线
 */

import ptStructure from '../pt_structure.json'
import { PipelinePackage, PipelineLayer } from './types'
import { PipelineNode, PipelineLine, PressureLevel, PipelineStatus, NodeType } from '@/types'

// ================== 坐标定义 ==================
// 基于天然气管线实际走向和沿线城市地理位置
const PT_COORDS: Record<string, { lng: number; lat: number }> = {
    // 河南段 (鲁山 → 兰考, 自西南向东北)
    '鲁山压气站': { lng: 112.91, lat: 33.74 },       // 平顶山市鲁山县
    '禹州分输站': { lng: 113.47, lat: 34.16 },       // 许昌市禹州市
    '薛店分输站': { lng: 113.72, lat: 34.46 },       // 郑州市新郑市薛店镇
    '中牟分输站': { lng: 114.00, lat: 34.72 },       // 郑州市中牟县
    '开封分输站': { lng: 114.35, lat: 34.79 },       // 开封市祥符区
    '杞县分输站': { lng: 114.78, lat: 34.55 },       // 开封市杞县
    '兰考分输站': { lng: 114.82, lat: 34.82 },       // 开封市兰考县

    // 山东段 (兰考 → 泰安, 自西向东)
    '菏泽分输站': { lng: 115.48, lat: 35.24 },       // 菏泽市牡丹区
    '巨野分输站': { lng: 116.10, lat: 35.39 },       // 菏泽市巨野县
    '济宁分输站': { lng: 116.59, lat: 35.41 },       // 济宁市任城区
    '泰安压气站': { lng: 117.09, lat: 36.19 },       // 泰安市岱岳区

    // 支线: 西二中开-中开平泰联络线 (开封站 → 杞县)
    '中开线开封站': { lng: 114.31, lat: 34.80 },     // 开封市区，西二线中开联络线起点
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
const COLOR_TRUNK = '#E91E63'    // 玫红色 - 干线
const COLOR_BRANCH = '#F48FB1'   // 浅粉色 - 支线

// 全局 ID 缓存 (确保跨层连接一致性，例如杞县分输站被干线和支线共用)
const stationIdMap = new Map<string, string>()

// ================== 辅助函数 ==================

/**
 * 将数据库原始类型映射为前端 NodeType 枚举
 * NOTE: 数据库的 node_type_2025 字段有不同分类（监控阀室、监视阀室等），这里统一映射
 */
function mapNodeType(rawType: string): NodeType {
    switch (rawType) {
        case 'compressor': return NodeType.REGULATOR
        case 'distribution': return NodeType.METERING
        case 'valve': return NodeType.VALVE
        default: return NodeType.JUNCTION
    }
}

/**
 * 在两个坐标点之间做线性插值
 * 用于没有已知坐标的阀室等中间节点
 */
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

/**
 * 将一组原始节点生成为 PipelineNode[] 和 PipelineLine[]
 *
 * 工作流程:
 * 1. 识别锚点 (有已知坐标的节点)
 * 2. 在锚点之间对中间节点(阀室)做线性插值
 * 3. 生成管线段(PipelineLine)连接相邻节点
 */
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
        const coord = PT_COORDS[node.name]
        if (coord) {
            anchors.push({ index: i, node, coord })
        }
    })

    if (anchors.length < 2) {
        console.warn(`[PT] ${layerName} 锚点不足 (${anchors.length}个), 无法完整生成路径`)
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
            // 已存在节点 (支线连接到干线的共享站)
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

        // --- 处理区段插值 (连接到下一个锚点) ---
        if (i < anchors.length - 1) {
            const nextAnchor = anchors[i + 1]
            const sectionDist = nextAnchor.node.mileage - currAnchor.node.mileage

            let prevNodeId = currNodeId
            let prevCoord = currAnchor.coord

            // 遍历中间节点 (阀室等)
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
                    properties: { category: '平泰支干线', color }
                })

                prevNodeId = midNodeId
                prevCoord = midCoord
            }

            // --- 最后一段 (最后一个中间点 → 下一个锚点) ---
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
                properties: { category: '平泰支干线', color }
            })
        }
    }

    return { nodes, lines }
}

// ================== 生成图层 ==================

// 1. 干线 (河南段+山东段合并)
const trunkData = generateLayerData(
    ptStructure.trunk as RawNode[],
    '平泰支干线',
    'PT',
    COLOR_TRUNK,
    true
)

const trunkLayer: PipelineLayer = {
    name: '平泰支干线',
    type: 'trunk',
    nodes: trunkData.nodes,
    lines: trunkData.lines,
    visible: true
}

// 2. 支线 (西二中开-中开平泰联络线)
const branchLayers: PipelineLayer[] = []
if (ptStructure.branches && ptStructure.branch_names) {
    ptStructure.branches.forEach((branchNodes, index) => {
        const branchName = ptStructure.branch_names[index]
        if (!branchNodes || branchNodes.length === 0) return

        const layerData = generateLayerData(
            branchNodes as RawNode[],
            branchName,
            `PT-B${index + 1}`,
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

export const ptPackage: PipelinePackage = {
    id: 'pt',
    name: '平泰支干线',
    color: COLOR_TRUNK,
    layers: [trunkLayer, ...branchLayers]
}

export default ptPackage
