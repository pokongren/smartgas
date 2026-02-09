
/**
 * 地理几何偏计算工具
 */

interface Point {
    lng: number
    lat: number
}

interface Vector {
    x: number
    y: number
}

// 向量加法
function add(v1: Vector, v2: Vector): Vector {
    return { x: v1.x + v2.x, y: v1.y + v2.y }
}

// 向量减法
function sub(v1: Vector, v2: Vector): Vector {
    return { x: v1.x - v2.x, y: v1.y - v2.y }
}

// 向量数乘
function scale(v: Vector, s: number): Vector {
    return { x: v.x * s, y: v.y * s }
}

// 向量模长
function len(v: Vector): number {
    return Math.sqrt(v.x * v.x + v.y * v.y)
}

// 归一化
function normalize(v: Vector): Vector {
    const l = len(v)
    if (l === 0) return { x: 0, y: 0 }
    return { x: v.x / l, y: v.y / l }
}

// 计算2D交点: Line A (p1->p1+v1) and Line B (p2->p2+v2)
// 使用行列式解线性方程
function intersect(p1: Vector, v1: Vector, p2: Vector, v2: Vector): Vector | null {
    const det = v1.x * v2.y - v1.y * v2.x
    if (Math.abs(det) < 1e-6) return null // 平行

    const t = ((p2.x - p1.x) * v2.y - (p2.y - p1.y) * v2.x) / det
    return add(p1, scale(v1, t))
}

/**
 * 生成平行线路径 (简化版 Miter Join)
 * @param points 原始经纬度路径
 * @param offsetDist 偏移距离 (单位：度，近似)
 * @returns 偏移后的路径
 */
export function generateParallelLine(points: Point[], offsetDist: number): Point[] {
    if (points.length < 2) return points

    // 1. 简单的墨卡托校正因子 (取平均纬度)
    const avgLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
    const cosLat = Math.cos(avgLat * Math.PI / 180)

    // 转换为平面坐标 (近似)
    const projected: Vector[] = points.map(p => ({ x: p.lng * cosLat, y: p.lat }))

    const offsetSegments: { p1: Vector, p2: Vector }[] = []

    // 2. 计算每一段的平行线段
    for (let i = 0; i < projected.length - 1; i++) {
        const curr = projected[i]
        const next = projected[i + 1]

        const dir = sub(next, curr)
        const l = len(dir)
        if (l < 1e-9) continue // 重合点跳过

        // 法向量 (-y, x)
        const normal = { x: -dir.y / l, y: dir.x / l }
        const offsetVec = scale(normal, offsetDist)

        offsetSegments.push({
            p1: add(curr, offsetVec),
            p2: add(next, offsetVec)
        })
    }

    if (offsetSegments.length === 0) return points

    // 3. 连接线段 (计算交点)
    const resultProjected: Vector[] = []

    // 起点: 第一段的起点
    resultProjected.push(offsetSegments[0].p1)

    for (let i = 0; i < offsetSegments.length - 1; i++) {
        const seg1 = offsetSegments[i]
        const seg2 = offsetSegments[i + 1]

        // 线段方向
        const dir1 = sub(seg1.p2, seg1.p1)
        const dir2 = sub(seg2.p2, seg2.p1)

        // 计算交点
        const intersection = intersect(seg1.p1, dir1, seg2.p1, dir2)

        if (intersection) {
            // 防止 Miter 尖角过大 (如果交点太远，限制之)
            const distToSeg1 = len(sub(intersection, seg1.p2))
            if (distToSeg1 > Math.abs(offsetDist) * 3) {
                // 尖角过大，使用 Bevel Join (直接连接两段端点)
                // 或者是取中间值
                resultProjected.push(seg1.p2)
                resultProjected.push(seg2.p1)
            } else {
                resultProjected.push(intersection)
            }
        } else {
            // 平行或共线，直接连接
            resultProjected.push(seg1.p2) // 或者 seg2.p1，理应重合
        }
    }

    // 终点: 最后一段的终点
    resultProjected.push(offsetSegments[offsetSegments.length - 1].p2)

    // 4. 转回经纬度
    return resultProjected.map(v => ({
        lng: v.x / cosLat,
        lat: v.y
    }))
}
