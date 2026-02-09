"""
根据 we2_structure.json 生成西气东输二线的 TypeScript 数据
输出到 src/data/westEast2Data.ts
"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

# 加载提取的数据
with open('backend/data/we2_structure.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# 西二线主要站场坐标（需要从百度地图获取真实坐标）
# 这里先填入已知的关键站场坐标
COORDS = {
    # 新疆段
    '霍尔果斯压气站': {'lng': 80.41, 'lat': 44.21},
    '精河压气站': {'lng': 82.89, 'lat': 44.60},
    '乌苏压气站': {'lng': 84.68, 'lat': 44.43},
    '玛纳斯压气站': {'lng': 86.22, 'lat': 44.30},
    '乌鲁木齐压气站': {'lng': 87.62, 'lat': 43.82},
    '吐鲁番压气站': {'lng': 89.19, 'lat': 42.95},
    '连木沁压气站': {'lng': 89.74, 'lat': 42.78},
    '了墩压气站': {'lng': 91.73, 'lat': 42.85},
    '烟墩压气站': {'lng': 93.51, 'lat': 42.83},
    '红柳压气站': {'lng': 94.67, 'lat': 42.32},
    '瓜州压气站': {'lng': 95.78, 'lat': 40.52},
    '嘉峪关压气站': {'lng': 98.29, 'lat': 39.77},
    '张掖压气站': {'lng': 100.45, 'lat': 38.93},
    '永昌压气站': {'lng': 101.97, 'lat': 38.24},
    '古浪压气站': {'lng': 102.89, 'lat': 37.47},
    '中卫压气站': {'lng': 105.20, 'lat': 37.51},
    '同心压气站': {'lng': 105.91, 'lat': 36.98},
    '定边压气站': {'lng': 107.60, 'lat': 37.59},
    '靖边压气站': {'lng': 108.79, 'lat': 37.60},
    '延安分输站': {'lng': 109.49, 'lat': 36.58},
    '黄陵压气站': {'lng': 109.26, 'lat': 35.58},
    '西安分输站': {'lng': 108.95, 'lat': 34.27},
    '洛南压气站': {'lng': 110.15, 'lat': 34.09},
    '三门峡分输站': {'lng': 111.20, 'lat': 34.77},
    '洛阳分输站': {'lng': 112.45, 'lat': 34.62},
    '郑州分输站': {'lng': 113.65, 'lat': 34.76},
    '开封分输站': {'lng': 114.35, 'lat': 34.80},
    '商丘分输站': {'lng': 115.65, 'lat': 34.44},
    '永城分输站': {'lng': 116.45, 'lat': 33.93},
    '宿州分输站': {'lng': 116.97, 'lat': 33.64},
    '淮南分输站': {'lng': 117.02, 'lat': 32.63},
    '合肥分输站': {'lng': 117.23, 'lat': 31.82},
    '安庆压气站': {'lng': 117.06, 'lat': 30.53},
    '黄州分输站': {'lng': 114.88, 'lat': 30.44},
    '武穴压气站': {'lng': 115.56, 'lat': 29.85},
    '九江分输站': {'lng': 115.99, 'lat': 29.71},
    '南昌压气站': {'lng': 115.86, 'lat': 28.68},
    '吉安压气站': {'lng': 114.99, 'lat': 27.11},
    '赣州分输站': {'lng': 114.94, 'lat': 25.85},
    '韶关分输站': {'lng': 113.60, 'lat': 24.81},
    '广州压气站': {'lng': 113.25, 'lat': 23.12},
    
    # 分输站
    '奎屯分输站': {'lng': 84.90, 'lat': 44.42},
    '昌吉分输站': {'lng': 87.31, 'lat': 44.01},
    '哈密分输站': {'lng': 93.51, 'lat': 42.83},
    '武威分输站': {'lng': 102.64, 'lat': 37.93},
    '蕲春分输站': {'lng': 115.43, 'lat': 30.23},
    '昌北分输站': {'lng': 115.91, 'lat': 28.74},
    '樟树分输站': {'lng': 115.55, 'lat': 28.06},
    '南雄分输站': {'lng': 114.31, 'lat': 25.12},
}

def generate_ts():
    output_lines = []
    
    # 文件头
    output_lines.append("""/**
 * 西气东输二线可视化数据
 * 数据来源: SmartGas 数据库 node_relation_details
 * 包含: 干线 + 10条支线
 */

import { MultiStation, MultiPipeline, MULTI_PIPELINE_COLORS } from './multiPipelineData'

// 西二线站场坐标
const WE2_COORDS: Record<string, { lng: number; lat: number }> = {""")
    
    # 输出坐标
    for name, coord in COORDS.items():
        output_lines.append(f"    '{name}': {{ lng: {coord['lng']}, lat: {coord['lat']} }},")
    
    output_lines.append("}\n")
    
    # 辅助函数
    output_lines.append("""
// 坐标插值函数
function interpolateCoord(
    startCoord: { lng: number; lat: number },
    endCoord: { lng: number; lat: number },
    ratio: number
): { lng: number; lat: number } {
    return {
        lng: startCoord.lng + (endCoord.lng - startCoord.lng) * ratio,
        lat: startCoord.lat + (endCoord.lat - startCoord.lat) * ratio
    }
}

// 生成站点（含阀室插值）
function generateWE2Stations(
    nodes: readonly { name: string; mileage: number; type: string }[],
    pipelineName: string,
    idPrefix: string,
    valveInterval: number = 35
): MultiStation[] {
    const stations: MultiStation[] = []
    let stationIdx = 0
    let valveIdx = 0
    
    // 筛选有坐标的节点
    const nodesWithCoords = nodes.filter(n => WE2_COORDS[n.name])
    
    for (let i = 0; i < nodesWithCoords.length; i++) {
        const node = nodesWithCoords[i]
        const coord = WE2_COORDS[node.name]
        
        stations.push({
            id: `${idPrefix}-${String(++stationIdx).padStart(3, '0')}`,
            name: node.name,
            type: node.type as any,
            longitude: coord.lng,
            latitude: coord.lat,
            mileage: node.mileage,
            pipeline: pipelineName
        })
        
        // 生成中间阀室
        if (i < nodesWithCoords.length - 1) {
            const nextNode = nodesWithCoords[i + 1]
            const nextCoord = WE2_COORDS[nextNode.name]
            const distance = nextNode.mileage - node.mileage
            const valveCount = Math.max(0, Math.floor(distance / valveInterval) - 1)
            
            for (let j = 1; j <= valveCount; j++) {
                const ratio = j / (valveCount + 1)
                const mileage = node.mileage + distance * ratio
                const interpCoord = interpolateCoord(coord, nextCoord, ratio)
                
                stations.push({
                    id: `${idPrefix}-V-${String(++valveIdx).padStart(3, '0')}`,
                    name: `${pipelineName}阀室${valveIdx}`,
                    type: 'valve',
                    longitude: interpCoord.lng,
                    latitude: interpCoord.lat,
                    mileage: Math.round(mileage * 10) / 10,
                    pipeline: pipelineName
                })
            }
        }
    }
    
    return stations.sort((a, b) => a.mileage - b.mileage)
}

// 生成管道段
function generateWE2Pipelines(
    stations: MultiStation[],
    pipelineName: string,
    idPrefix: string,
    color: string
): MultiPipeline[] {
    return stations.slice(0, -1).map((s, i) => ({
        id: `${idPrefix}-SEG-${String(i + 1).padStart(3, '0')}`,
        name: `${pipelineName}-段${i + 1}`,
        startStationId: s.id,
        endStationId: stations[i + 1].id,
        category: pipelineName,
        diameter: 1219,
        color: color
    }))
}
""")
    
    # 干线节点数组
    trunk = data['trunk']
    # 只保留压气站和分输站
    main_stations = [n for n in trunk if n['type'] in ['compressor', 'distribution']]
    
    output_lines.append("// ===== 西二线干线 =====")
    output_lines.append("const WE2_TRUNK_NODES = [")
    for node in main_stations:
        output_lines.append(f"    {{ name: '{node['name']}', mileage: {node['mileage']}, type: '{node['type']}' }},")
    output_lines.append("] as const\n")
    
    output_lines.append("export const we2TrunkStations = generateWE2Stations(WE2_TRUNK_NODES, '西二线干线', 'WE2-TRUNK', 40)")
    output_lines.append("export const we2TrunkPipelines = generateWE2Pipelines(we2TrunkStations, '西二线干线', 'WE2-TRUNK', '#2196f3')\n")
    
    # 支线
    branches = data.get('branches', [])
    branch_names = data.get('branch_names', [])
    
    for idx, (branch_nodes, branch_name) in enumerate(zip(branches, branch_names)):
        if not branch_nodes:
            continue
            
        # 只保留主要站场
        main_nodes = [n for n in branch_nodes if n['type'] in ['compressor', 'distribution']]
        if len(main_nodes) < 2:
            continue
            
        safe_name = f"WE2_BRANCH_{idx}"
        var_name = f"we2Branch{idx}"
        
        output_lines.append(f"// ===== {branch_name} =====")
        output_lines.append(f"const {safe_name}_NODES = [")
        for node in main_nodes:
            output_lines.append(f"    {{ name: '{node['name']}', mileage: {node['mileage']}, type: '{node['type']}' }},")
        output_lines.append("] as const\n")
        
        output_lines.append(f"export const {var_name}Stations = generateWE2Stations({safe_name}_NODES, '{branch_name}', 'WE2-B{idx}', 20)")
        output_lines.append(f"export const {var_name}Pipelines = generateWE2Pipelines({var_name}Stations, '{branch_name}', 'WE2-B{idx}', '#64b5f6')\n")
    
    # 合并导出
    output_lines.append("// 合并所有西二线数据")
    output_lines.append("export const allWE2Stations = [")
    output_lines.append("    ...we2TrunkStations,")
    for idx in range(len(branches)):
        if data.get('branches', [])[idx]:
            main_nodes = [n for n in data['branches'][idx] if n['type'] in ['compressor', 'distribution']]
            if len(main_nodes) >= 2:
                output_lines.append(f"    ...we2Branch{idx}Stations,")
    output_lines.append("]\n")
    
    output_lines.append("export const allWE2Pipelines = [")
    output_lines.append("    ...we2TrunkPipelines,")
    for idx in range(len(branches)):
        if data.get('branches', [])[idx]:
            main_nodes = [n for n in data['branches'][idx] if n['type'] in ['compressor', 'distribution']]
            if len(main_nodes) >= 2:
                output_lines.append(f"    ...we2Branch{idx}Pipelines,")
    output_lines.append("]")
    
    # 写入文件
    with open('src/data/westEast2Data.ts', 'w', encoding='utf-8') as f:
        f.write('\n'.join(output_lines))
    
    print("已生成: src/data/westEast2Data.ts")
    print(f"干线站场数: {len(main_stations)}")
    print(f"支线数量: {len([b for b in branches if b])}")

if __name__ == "__main__":
    generate_ts()
