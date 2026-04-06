import json
import os

def generate_ts():
    # 1. 读坐标
    with open('tmp_coords.json', 'r', encoding='utf-8') as f:
        coords = json.load(f)
        
    # 2. 读结构
    with open('src/data/we1_structure.json', 'r', encoding='utf-8') as f:
        struct = json.load(f)
        
    out = []
    out.append("import { generateStations, generatePipelines } from './utils'")
    out.append("")
    out.append("// 西一线坐标字典")
    out.append("const COORDS: Record<string, { lng: number; lat: number }> = {")
    for k, v in coords.items():
        out.append(f"  '{k}': {{ lng: {v['lng']}, lat: {v['lat']} }},")
    out.append("}")
    out.append("")
    
    # 3. 处理干线
    out.append("// ============== 干线节点 ==============")
    out.append("const TRUNK_NODES = [")
    for n in struct.get('trunk', []):
        name = n['name']
        mlg = n['mileage']
        typ = n['type']
        out.append(f"  {{ name: '{name}', mileage: {mlg}, type: '{typ}' }},")
    out.append("] as const")
    out.append("")
    
    # 4. 处理支线
    branches = struct.get('branches', [])
    bnames = struct.get('branch_names', [])
    for i, (b_nodes, b_name) in enumerate(zip(branches, bnames)):
        out.append(f"// ============== {b_name} ==============")
        out.append(f"const BRANCH_{i}_NODES = [")
        for n in b_nodes:
            name = n['name']
            mlg = n['mileage']
            typ = n['type']
            out.append(f"  {{ name: '{name}', mileage: {mlg}, type: '{typ}' }},")
        out.append("] as const")
        out.append("")
        
    # 5. 生成stations
    out.append("// ============== 生成站点 ==============")
    out.append("export const trunkStations = generateStations(TRUNK_NODES, COORDS, '西一线干线', 'WE1_TRUNK', 40)")
    for i, b_name in enumerate(bnames):
        out.append(f"export const branch{i}Stations = generateStations(BRANCH_{i}_NODES, COORDS, '{b_name}', 'WE1_B{i}', 30)")
    out.append("")
    
    # 6. 生成pipelines
    out.append("// ============== 生成管段 ==============")
    out.append("export const trunkPipelines = generatePipelines(trunkStations, '西一线干线', 'WE1_TRUNK', '#2196f3')")
    colors = ['#42a5f5', '#64b5f6', '#90caf9', '#1976d2', '#1565c0', '#0d47a1', '#82b1ff']
    for i, b_name in enumerate(bnames):
        color = colors[i % len(colors)]
        out.append(f"export const branch{i}Pipelines = generatePipelines(branch{i}Stations, '{b_name}', 'WE1_B{i}', '{color}')")
    out.append("")
    
    # 7. 汇总导出
    out.append("// ============== 汇总导出 ==============")
    all_stations = "export const allStations = [...trunkStations, " + ", ".join([f"...branch{i}Stations" for i in range(len(bnames))]) + "]"
    all_pipelines = "export const allPipelines = [...trunkPipelines, " + ", ".join([f"...branch{i}Pipelines" for i in range(len(bnames))]) + "]"
    out.append(all_stations)
    out.append(all_pipelines)
    
    os.makedirs('src/data/pipelines', exist_ok=True)
    with open('src/data/pipelines/we1.ts', 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
        
if __name__ == "__main__":
    generate_ts()
