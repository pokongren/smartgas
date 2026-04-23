import { PipelineNode, PipelineLine, PressureLevel, PipelineStatus, NodeType } from '../../types'

/**
 * 通用管线站点插值生成器
 * 
 * 基于真实坐标与里程，为管线（干线或支线）批量生成带有坐标点及默认间距（如虚拟阀室）的抽象拓扑站点结构队。
 */
export function generateStations(
    nodes: ReadonlyArray<{ name: string; mileage: number; type: string }>,
    coords: Record<string, { lng: number; lat: number }>,
    pipelineName: string,
    idPrefix: string,
    maxDistanceKm: number = 40
): PipelineNode[] {
    const result: PipelineNode[] = []

    // 取出有真实坐标作为锚点的节点
    const anchors = nodes
        .map((n, i) => ({ index: i, node: n, coord: coords[n.name] }))
        .filter(x => x.coord !== undefined)

    if (anchors.length < 2) {
        console.warn(`[Pipeline] ${pipelineName} 的锚点坐标不足，跳过渲染。`)
        return []
    }

    let valveCounter = 1

    for (let i = 0; i < anchors.length; i++) {
        const curr = anchors[i]

        // 压入当前主要站点
        result.push({
            id: `${idPrefix}-S-${i}`,
            name: curr.node.name,
            type: curr.node.type as NodeType,
            coordinate: { longitude: curr.coord.lng, latitude: curr.coord.lat },
            pressureLevel: PressureLevel.HIGH,
            status: PipelineStatus.NORMAL,
            properties: { pipeline: pipelineName }
        })

        // 若不是最后一个锚点，进行中间插值计算
        if (i < anchors.length - 1) {
            const next = anchors[i + 1]
            const sectionDist = next.node.mileage - curr.node.mileage

            // 需要判断里程是否合理增长以计算插入点
            if (sectionDist > maxDistanceKm) {
                const numValves = Math.floor(sectionDist / maxDistanceKm)
                for (let j = 1; j <= numValves; j++) {
                    const ratio = j / (numValves + 1)

                    const lng = curr.coord.lng + (next.coord.lng - curr.coord.lng) * ratio
                    const lat = curr.coord.lat + (next.coord.lat - curr.coord.lat) * ratio

                    result.push({
                        id: `${idPrefix}-V-${valveCounter++}`,
                        name: `${pipelineName}虚拟阀室${valveCounter}`,
                        type: NodeType.VALVE,
                        coordinate: { longitude: lng, latitude: lat },
                        pressureLevel: PressureLevel.HIGH,
                        status: PipelineStatus.NORMAL,
                        properties: { pipeline: pipelineName, isVirtual: true }
                    })
                }
            }
        }
    }

    return result
}


/**
 * 通用管线段（Line）拓扑组装工厂
 * 
 * 将站点结构队列两两结合，形成真实地理的连接线段段落信息，携带材质、管径及属性。
 */
export interface PhysicsConfig {
    initialPressure: number; // 初始压力 MPa
    constantFlowRate: number; // 稳定工况流量（10^4 Nm3/d）
}

export function generatePipelines(
    stations: PipelineNode[],
    pipelineCategory: string,
    idPrefix: string,
    color: string,
    physics?: PhysicsConfig
): PipelineLine[] {
    const lines: PipelineLine[] = []

    let currentP = physics?.initialPressure || 0;
    const flow = physics?.constantFlowRate || 0;

    for (let i = 0; i < stations.length - 1; i++) {
        const start = stations[i]
        const end = stations[i + 1]

        // 估算球面大致距离（这里简化为欧式，高精度可改用 haversine）
        const dx = (end.coordinate.longitude - start.coordinate.longitude) * 100000
        const dy = (end.coordinate.latitude - start.coordinate.latitude) * 111000
        const lengthMeters = Math.sqrt(dx * dx + dy * dy)
        const lengthKm = lengthMeters / 1000;
        
        let pEnd = currentP;
        let pDrop = 0;

        if (physics) {
            // 采用近似的 Weymouth 伪推演比例： Δ(P^2) ∝ L * Flow^2
            // 使得在 3000 万方/天 流量下，每 100 公里管线压力下降约 0.3 - 0.5 MPa
            const scale = 0.002; 
            const deltaPSq = Math.pow(flow / 1000, 2) * lengthKm * scale;
            const pSqEnd = Math.pow(currentP, 2) - deltaPSq;
            pEnd = pSqEnd > 0 ? Math.sqrt(pSqEnd) : 0;
            pDrop = currentP - pEnd;
        }

        lines.push({
            id: `${idPrefix}-L-${i + 1}`,
            name: `${pipelineCategory}-段${i + 1}`,
            startNodeId: start.id,
            endNodeId: end.id,
            path: [start.coordinate, end.coordinate],
            diameter: 1016, // mm
            material: 'Steel',
            pressureLevel: start.pressureLevel,
            status: start.status,
            length: lengthMeters,
            flowRate: physics ? flow : undefined,
            currentPressure: physics ? Number(((currentP + pEnd) / 2).toFixed(2)) : undefined, // 显示为中间压力
            designPressure: 10.0,
            properties: { 
                category: pipelineCategory, 
                color,
                startPressureMpa: physics ? Number(currentP.toFixed(2)) : undefined,
                endPressureMpa: physics ? Number(pEnd.toFixed(2)) : undefined
            }
        });

        // 推演到下一段的起站压力
        if (physics) {
            // 如果到达压气站，压力重新恢复至出站高压设定值
            if ((end.type as any) === 'compressor' || (end.type as string) === 'compressor') {
                currentP = physics.initialPressure;
            } else {
                currentP = pEnd;
            }
        }
    }

    return lines
}
