/**
 * 西气东输二线可视化数据
 *
 * 基于 Pipeline Master System 生成
 * 数据源: backend/data/we2_structure.json
 * 包含: 1条干线 + 10条支线
 */

import we2Structure from './we2_structure.json'
import { PipelinePackage, PipelineLayer } from './types'
import { PipelineNode, PipelineLine, PressureLevel, PipelineStatus, NodeType } from '@/types'

// ================== 坐标定义 ==================
// NOTE: 仅包含已知坐标的主要场站，阀室坐标通过线性插值自动生成
const WE2_COORDS: Record<string, { lng: number; lat: number }> = {
    // ---- 新疆段 (干线) ----
    '霍尔果斯压气站': { lng: 80.47, lat: 44.10 },
    '精河压气站': { lng: 82.89, lat: 44.60 },
    '乌苏压气站': { lng: 84.68, lat: 44.43 },
    '奎屯分输站': { lng: 84.90, lat: 44.45 },
    '玛纳斯压气站': { lng: 86.22, lat: 44.30 },
    '昌吉分输站': { lng: 87.30, lat: 44.01 },
    '乌鲁木齐压气站': { lng: 87.62, lat: 43.83 },
    '吐鲁番压气站': { lng: 89.19, lat: 42.94 },
    '连木沁压气站': { lng: 89.78, lat: 42.85 },
    '了墩压气站': { lng: 92.10, lat: 42.90 },
    '哈密分输站': { lng: 93.52, lat: 42.82 },
    '烟墩压气站': { lng: 94.20, lat: 42.50 },

    // ---- 甘肃段 (干线) ----
    '红柳压气站': { lng: 95.50, lat: 41.80 },
    '瓜州压气站': { lng: 95.78, lat: 40.52 },
    '嘉峪关压气站': { lng: 98.35, lat: 39.69 },
    '张掖压气站': { lng: 100.45, lat: 38.93 },
    '永昌压气站': { lng: 101.97, lat: 38.24 },
    '武威分输站': { lng: 102.64, lat: 37.93 },
    '古浪压气站': { lng: 103.00, lat: 37.60 },

    // ---- 中卫-吉安段 (干线) ----
    '中卫压气站': { lng: 105.19, lat: 37.51 },
    '海原压气站': { lng: 105.65, lat: 36.57 },
    '固原分输站': { lng: 106.24, lat: 36.00 },
    '彭阳压气站': { lng: 106.64, lat: 35.85 },
    '平泉分输站': { lng: 106.80, lat: 35.70 },
    '泾川分输站': { lng: 107.37, lat: 35.33 },
    '灵台压气站': { lng: 107.62, lat: 35.07 },
    '乾县西分输站': { lng: 108.23, lat: 34.53 },
    '乾县东分输站': { lng: 108.40, lat: 34.53 },
    '礼泉分输站': { lng: 108.63, lat: 34.48 },
    '泾阳分输站': { lng: 108.84, lat: 34.53 },
    '高陵压气站': { lng: 109.09, lat: 34.53 },
    '临潼分输站': { lng: 109.22, lat: 34.37 },
    '华阴分输站': { lng: 110.09, lat: 34.56 },
    '潼关压气站': { lng: 110.25, lat: 34.55 },
    '三门峡分输站': { lng: 111.20, lat: 34.77 },
    '洛宁压气站': { lng: 111.65, lat: 34.39 },
    '洛阳分输站': { lng: 112.45, lat: 34.62 },
    '鲁山压气站': { lng: 112.91, lat: 33.74 },
    '平顶山分输站': { lng: 113.19, lat: 33.77 },
    '社旗分输站': { lng: 112.95, lat: 33.06 },
    '南阳分输站': { lng: 112.53, lat: 33.00 },
    '枣阳压气站': { lng: 112.77, lat: 32.13 },
    '随州分输站': { lng: 113.38, lat: 31.69 },
    '孝感分输站': { lng: 113.92, lat: 30.92 },
    '黄冈分输站': { lng: 114.87, lat: 30.45 },
    '黄石压气站': { lng: 115.04, lat: 30.22 },
    '蕲春分输站': { lng: 115.44, lat: 30.23 },
    '九江分输站': { lng: 116.00, lat: 29.71 },
    '武穴压气站': { lng: 115.56, lat: 29.84 },
    '昌北分输站': { lng: 115.86, lat: 28.74 },
    '南昌压气站': { lng: 115.86, lat: 28.68 },
    '樟树分输站': { lng: 115.55, lat: 28.06 },
    '吉安压气站': { lng: 114.99, lat: 27.11 },
    '黄州分输站': { lng: 114.88, lat: 30.45 },

    // ---- 吉安-广州段 (干线) ----
    '赣州分输站': { lng: 114.94, lat: 25.85 },
    '南雄分输站': { lng: 114.31, lat: 25.12 },
    '广州压气站': { lng: 113.28, lat: 23.13 },

    // ---- 支线站点 ----
    // 独石化支线
    '独山子石化分输站': { lng: 84.88, lat: 44.33 },
    '独山子石化调压站': { lng: 84.85, lat: 44.32 },
    // 嘉峪关支线
    '嘉峪关门站': { lng: 98.37, lat: 39.70 },
    // 酒泉支线
    '酒泉压气站': { lng: 98.49, lat: 39.73 },
    '酒泉门站': { lng: 98.50, lat: 39.75 },
    // 张掖支线
    '张掖门站': { lng: 100.47, lat: 38.95 },
    // 金昌支线
    '金昌1#阀室': { lng: 102.15, lat: 38.50 },
    '金昌分输站': { lng: 102.19, lat: 38.52 },
    '金昌2#阀室': { lng: 102.20, lat: 38.49 },
    '金昌门站': { lng: 102.18, lat: 38.48 },
    // 武威支线
    '武威门站': { lng: 102.66, lat: 37.95 },
    '武威调压站': { lng: 102.68, lat: 37.96 },
    // 洛阳支线
    '洛阳1#阀室': { lng: 112.50, lat: 34.65 },
    '洛阳末站': { lng: 112.55, lat: 34.67 },
    '洛阳调压站': { lng: 112.60, lat: 34.70 },
    // 川气东送联络线
    '姜家湾联络线1#阀室': { lng: 115.50, lat: 29.80 },
    '姜家湾联络线2#阀室': { lng: 115.48, lat: 29.78 },
    '姜家湾分输站': { lng: 115.45, lat: 29.75 },
    // 淮黄联络线
    '大流量计量站郑州分站': { lng: 113.50, lat: 34.70 },
    // 富平支线
    '富平分输站': { lng: 109.18, lat: 34.75 },
    '富平调压站': { lng: 109.20, lat: 34.76 },
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
const COLOR_TRUNK = '#8b5cf6'  // 紫色 - 干线 (Violet 500)
const COLOR_BRANCH = '#a78bfa' // 浅紫色 - 支线 (Violet 400)

// 全局 ID 缓存 (确保跨层连接一致性)
const stationIdMap = new Map<string, string>()

// ================== 辅助函数 ==================

/**
 * 将原始节点类型映射为前端 NodeType 枚举
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
 * 在两个坐标之间进行线性插值
 * @param ratio 插值比例 (0~1)，0 为起点，1 为终点
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
 * 将原始节点数组转换为前端可渲染的 PipelineNode[] 和 PipelineLine[]
 *
 * 算法思路：
 * 1. 遍历节点，找出所有有坐标的"锚点"
 * 2. 在锚点之间，对没有坐标的中间节点（阀室等）使用线性插值生成坐标
 * 3. 相邻节点之间生成管段连线
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

    // 1. 识别锚点 (有已知坐标的节点)
    const anchors: { index: number; node: RawNode; coord: { lng: number; lat: number } }[] = []

    rawNodes.forEach((node, i) => {
        const coord = WE2_COORDS[node.name]
        if (coord) {
            anchors.push({ index: i, node, coord })
        }
    })

    if (anchors.length < 2) {
        if (anchors.length === 1 && !isTrunk) {
            // 支线只有一个锚点时，仍然生成该单点
        }
        console.warn(`[WE2] ${layerName} 锚点不足 (${anchors.length}个), 无法完整生成路径`)
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
            // 已存在节点 (通常是支线连接到干线的共享站点)
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
                    diameter: 1219,
                    material: 'X80',
                    pressureLevel: PressureLevel.HIGH,
                    status: PipelineStatus.NORMAL,
                    length: (midNode.mileage - (j === currAnchor.index + 1 ? currAnchor.node.mileage : rawNodes[j - 1].mileage)) * 1000,
                    properties: { category: '西二线', color }
                })

                prevNodeId = midNodeId
                prevCoord = midCoord
            }

            // --- 最后一段 (最后一个中间点 -> 下一个锚点) ---
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
                diameter: 1219,
                material: 'X80',
                pressureLevel: PressureLevel.HIGH,
                status: PipelineStatus.NORMAL,
                length: (nextAnchor.node.mileage - (currAnchor.index + 1 === nextAnchor.index ? currAnchor.node.mileage : rawNodes[nextAnchor.index - 1].mileage)) * 1000,
                properties: { category: '西二线', color }
            })
        }
    }

    return { nodes, lines }
}

// ================== 干线排序预处理 ==================

/**
 * 干线段序定义
 * NOTE: 原始 JSON 中不同 branch_name 段的节点可能交错排列，
 * 必须按地理顺序排序后才能正确插值连线。
 * 例如：黄州分输站 (中卫-吉安段, mileage 0.0) 出现在数组第2位，
 * 如果不排序会导致霍尔果斯直接连到黄冈。
 */
const TRUNK_SEGMENT_ORDER: string[] = [
    '西二线干线新疆段',
    '西二线干线甘肃段',
    '西二线干线中卫-吉安段',
    '西二线干线吉安-广州段',
]

/**
 * 按段序 + 里程排序干线节点，确保地理连续性
 */
function sortTrunkNodes(nodes: RawNode[]): RawNode[] {
    return [...nodes].sort((a, b) => {
        const segA = TRUNK_SEGMENT_ORDER.indexOf(a.branch_name)
        const segB = TRUNK_SEGMENT_ORDER.indexOf(b.branch_name)

        // 未知段放到最后
        const orderA = segA === -1 ? 999 : segA
        const orderB = segB === -1 ? 999 : segB

        if (orderA !== orderB) return orderA - orderB
        return a.mileage - b.mileage
    })
}

// 1. 干线 (排序后再生成)
const sortedTrunk = sortTrunkNodes(we2Structure.trunk as RawNode[])
const trunkData = generateLayerData(
    sortedTrunk,
    '西二线干线',
    'WE2',
    COLOR_TRUNK,
    true
)

const trunkLayer: PipelineLayer = {
    name: '西二线干线',
    type: 'trunk',
    nodes: trunkData.nodes,
    lines: trunkData.lines,
    visible: true
}

// 2. 支线 (自动遍历)
const branchLayers: PipelineLayer[] = []
if (we2Structure.branches && we2Structure.branch_names) {
    we2Structure.branches.forEach((branchNodes, index) => {
        const branchName = we2Structure.branch_names[index]
        if (!branchNodes || branchNodes.length === 0) return

        const layerData = generateLayerData(
            branchNodes as RawNode[],
            branchName,
            `WE2-B${index + 1}`,
            COLOR_BRANCH,
            false
        )

        if (layerData.nodes.length > 0 || layerData.lines.length > 0) {
            branchLayers.push({
                name: branchName,
                type: 'branch',
                nodes: layerData.nodes,
                lines: layerData.lines,
                visible: false // 支线默认隐藏，可在 UI 中切换
            })
        }
    })
}

// ================== 导出包 ==================

export const we2Package: PipelinePackage = {
    id: 'we2',
    name: '西气东输二线',
    color: COLOR_TRUNK,
    layers: [trunkLayer, ...branchLayers]
}

export default we2Package
