import sqlite3
import sys
import json

# ID Ranges derived from analysis
BRANCHES = [
    {'name': 'ZM-TRUNK', 'range': (2461, 2539), 'label': '中缅干线', 'color_key': '中缅线', 'interval': 40},
    {'name': 'ZM-LIJIANG', 'range': (2540, 2549), 'label': '丽江支线', 'color_key': '中缅支线', 'interval': 20},
    {'name': 'ZM-YUXI', 'range': (2550, 2555), 'label': '玉溪支线', 'color_key': '中缅支线', 'interval': 20},
    {'name': 'ZM-DUYUN', 'range': (2556, 2558), 'label': '都匀支线', 'color_key': '中缅支线', 'interval': 20},
    {'name': 'ZM-GUILIN', 'range': (2560, 2568), 'label': '桂林支线', 'color_key': '中缅支线', 'interval': 30},
    {'name': 'ZM-QINZHOU', 'range': (2569, 2580), 'label': '钦州支线', 'color_key': '中缅支线', 'interval': 20},
    {'name': 'ZM-FANGCHENGGANG', 'range': (2581, 2585), 'label': '防城港支线', 'color_key': '中缅支线', 'interval': 20},
    {'name': 'ZM-HECHI', 'range': (2586, 2587), 'label': '河池支线', 'color_key': '中缅支线', 'interval': 20},
]

def generate_ts():
    db_path = 'backend/data/smartgas_temp.db'
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    with open('backend/scripts/zhongmian_ts_final.txt', 'w', encoding='utf-8') as f:
        # 1. Generate Node Arrays and Pipeline Definitions
        station_exports = []
        pipeline_exports = []
        
        for branch in BRANCHES:
            start_id, end_id = branch['range']
            cursor.execute("SELECT node_name, mileage FROM node_relation_details WHERE id BETWEEN ? AND ? ORDER BY id", (start_id, end_id))
            nodes = cursor.fetchall()
            
            ts_nodes = []
            for name, mileage in nodes:
                ntype = 'valve'
                if '压气站' in name: ntype = 'compressor'
                elif any(x in name for x in ['分输站', '末站', '首站', '门站']): ntype = 'distribution'
                
                ts_nodes.append(f"    {{ name: '{name}', mileage: {mileage}, type: '{ntype}' }},")
                
            node_const = branch['name'].replace('-', '_') + '_NODES'
            f.write(f"// {branch['label']}\n")
            f.write(f"const {node_const} = [\n")
            f.write("\n".join(ts_nodes) + "\n")
            f.write("] as const\n\n")
            
            # Generation functions
            var_base = branch['name'].lower().replace('-', '') + 'Stations'
            pipe_base = branch['name'].lower().replace('-', '') + 'Pipelines'
            label = branch['label']
            prefix = branch['name']
            color = f"MULTI_PIPELINE_COLORS['{branch['color_key']}']"
            interval = branch['interval']
            
            f.write(f"export const {var_base} = generatePipelineStationsWithValves({node_const}, '{label}', '{prefix}', {interval})\n")
            f.write(f"export const {pipe_base} = generatePipelineSegments({var_base}, '{label}', '{prefix}', {color})\n\n")
            
            station_exports.append(var_base)
            pipeline_exports.append(pipe_base)

        # 2. Add Link Logic
        f.write("// 自动连接支线到干线\n")
        f.write("const TRUNK_REF = zmtrunkStations // 引用主干线数据\n\n")
        
        for branch in BRANCHES:
            if 'TRUNK' in branch['name']: continue
            
            pipe_base = branch['name'].lower().replace('-', '') + 'Pipelines'
            node_const = branch['name'].replace('-', '_') + '_NODES'
            branch_name_js = branch['label']
            
            f.write(f"// 连接 {branch_name_js}\n")
            f.write(f"if ({pipe_base}.length > 0 && {node_const}.length > 0) {{\n")
            # Logic: Try to find start node in trunk.
            # Special logic for Qinzhou: Its 0.0 node is '南宁分输站'.
            # If Nanning is not in Trunk, we might need to search in other branches?
            # Or manually map.
            # For now, general logic.
            f.write(f"    const startNodeName = {node_const}[0].name\n")
            
            # Look in Trunk and ALL other branches generated so far?
            # No, usually branches connect to Trunk.
            f.write(f"    const trunkStation = TRUNK_REF.find(s => s.name === startNodeName)\n")
            f.write(f"    if (trunkStation) {{\n")
            f.write(f"        {pipe_base}[0].startStationId = trunkStation.id\n")
            f.write(f"    }}\n")
            f.write(f"}}\n\n")

        # 3. Export Combined Arrays
        f.write("// 合并所有数据 (中缅系列)\n")
        f.write("export const zhongmianStations = [\n")
        for s in station_exports:
            f.write(f"    ...{s},\n")
        f.write("]\n\n")
        
        f.write("export const zhongmianPipelines = [\n")
        for p in pipeline_exports:
            f.write(f"    ...{p},\n")
        f.write("]\n")

    conn.close()

if __name__ == "__main__":
    generate_ts()
