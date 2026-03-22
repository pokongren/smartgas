"""
前端管线数据 → SQLite 一键同步脚本

原理：
1. 读取前端的 *_structure.json 文件（拓扑骨架：节点名称、类型、里程、连接关系）
2. 从对应的 TS 文件中提取坐标映射表
3. 合并后写入后端 SQLite 数据库的 stations / pipelines 表

运行: cd backend && python scripts/sync_frontend_data.py
"""

import json
import re
import sys
import os

# 确保可以 import app.*
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sqlmodel import Session, select
from app.database import engine, create_db_and_tables
from app.models import Station, Pipeline

# ============ 路径配置 ============

FRONTEND_DATA = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'data')
PIPELINES_DIR = os.path.join(FRONTEND_DATA, 'pipelines')

# 管线配置：(structure_json路径, ts文件路径, 管线中文名, id前缀)
PIPELINE_CONFIGS = [
    ('we1_structure.json', 'pipelines/we1.ts', '西气东输一线', 'WE1'),
    ('pipelines/we2_structure.json', 'pipelines/we2.ts', '西气东输二线', 'WE2'),
    ('cred_structure.json', 'pipelines/cred.ts', '中俄东线', 'CRED'),
    ('pt_structure.json', 'pipelines/pt.ts', '平泰支干线', 'PT'),
    ('zg_structure.json', 'pipelines/zg.ts', '中贵线', 'ZG'),
    ('zm_structure.json', 'pipelines/zm.ts', '中缅线', 'ZM'),
    ('gn_structure.json', 'pipelines/gn.ts', '广南支干线', 'GN'),
    ('gs_structure.json', 'pipelines/gs.ts', '广深支干线', 'GS'),
]

# sj4 没有 structure.json，在 TS 里直接定义了坐标和连线
SJ4_CONFIG = ('pipelines/sj4.ts', '川气东送', 'SJ4')


# ============ 坐标提取器 ============

def extract_coords_from_ts(ts_path: str) -> dict[str, tuple[float, float]]:
    """从 TypeScript 文件中提取坐标映射表
    
    解析类似这样的结构:
    const XXX_COORDS: Record<string, { lng: number; lat: number }> = {
        '轮南压气站': { lng: 84.25, lat: 41.78 },
        ...
    }
    """
    full_path = os.path.join(FRONTEND_DATA, ts_path)
    if not os.path.exists(full_path):
        print(f"  ⚠️ TS 文件不存在: {ts_path}")
        return {}

    with open(full_path, 'r', encoding='utf-8') as f:
        content = f.read()

    coords = {}
    # 匹配 '站名': { lng: 数字, lat: 数字 }
    pattern = r"'([^']+)'\s*:\s*\{\s*lng\s*:\s*([\d.]+)\s*,\s*lat\s*:\s*([\d.]+)\s*\}"
    for match in re.finditer(pattern, content):
        name = match.group(1)
        lng = float(match.group(2))
        lat = float(match.group(3))
        coords[name] = (lng, lat)

    return coords


def extract_sj4_data(
    ts_path: str,
    all_stations: dict[str, dict],
    all_pipelines: list[dict],
):
    """陕京四线（sj4）数据直接写在 TS 里，没有 structure.json

    TS 中使用 { name: '站名', mileage: 0.0, type: 'compressor' } 格式的数组，
    以及 COORDS 坐标映射表。需要提取这些数组并按相邻节点生成管段。
    """
    full_path = os.path.join(FRONTEND_DATA, ts_path)
    if not os.path.exists(full_path):
        print(f"  ⚠️ SJ4 TS 文件不存在: {ts_path}")
        return

    with open(full_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. 提取坐标映射表
    coords = {}
    coord_pattern = r"'([^']+)'\s*:\s*\{\s*lng\s*:\s*([\d.]+)\s*,\s*lat\s*:\s*([\d.]+)\s*\}"
    for match in re.finditer(coord_pattern, content):
        name = match.group(1)
        lng = float(match.group(2))
        lat = float(match.group(3))
        coords[name] = (lng, lat)

    print(f"  📍 坐标数: {len(coords)}")

    # 2. 提取所有节点数组（{ name: '...', mileage: ..., type: '...' }）
    node_pattern = r"\{\s*name\s*:\s*'([^']+)'\s*,\s*mileage\s*:\s*([\d.]+)\s*,\s*type\s*:\s*'([^']+)'"
    all_raw_nodes = []
    for match in re.finditer(node_pattern, content):
        all_raw_nodes.append({
            'name': match.group(1),
            'mileage': float(match.group(2)),
            'type': match.group(3),
        })

    # 3. 识别干线和支线数组
    # 使用 const XXX_NODES = [ 模式来分割节点组
    array_pattern = r"const\s+(TRUNK_NODES|BRANCH_\d+_NODES)\s*=\s*\[(.*?)\]\s*as\s*const"
    node_groups = []
    for match in re.finditer(array_pattern, content, re.DOTALL):
        group_name = match.group(1)
        group_content = match.group(2)
        is_trunk = group_name == 'TRUNK_NODES'

        # 从每个组中提取节点
        nodes_in_group = []
        for nm in re.finditer(node_pattern, group_content):
            nodes_in_group.append({
                'name': nm.group(1),
                'mileage': float(nm.group(2)),
                'type': nm.group(3),
            })

        # 确定支线名称
        if is_trunk:
            layer_name = '陕京四线'
            category = 'trunk'
        else:
            # 从注释中提取支线名称 (如 "// 支线: 万全支线 节点数据")
            # 搜索 array_pattern 匹配之前的注释
            pos = match.start()
            preceding = content[max(0, pos-100):pos]
            branch_name_match = re.search(r'//\s*支线:\s*(.+?)\s*节点', preceding)
            if branch_name_match:
                layer_name = branch_name_match.group(1).strip()
            else:
                layer_name = f'陕四支线-{group_name}'
            category = 'branch'

        node_groups.append({
            'name': layer_name,
            'category': category,
            'nodes': nodes_in_group,
        })

    print(f"  🔵 发现 {len(node_groups)} 个节点组")

    # 4. 处理各节点组，生成站场和管段
    id_prefix = 'SJ4'

    for gi, group in enumerate(node_groups):
        layer_name = group['name']
        category = group['category']
        group_nodes = group['nodes']

        if category == 'trunk':
            seg_prefix = f"{id_prefix}-T"
        else:
            seg_prefix = f"{id_prefix}-B{gi}"

        print(f"  {'🔵' if category == 'trunk' else '🟢'} [{layer_name}]: {len(group_nodes)} 节点")

        prev_station_id = None
        seg_count = 0

        for node in group_nodes:
            name = node['name']
            raw_type = node['type']
            station_type = map_node_type(raw_type)
            coord = coords.get(name, (0.0, 0.0))

            if name not in all_stations:
                station_id = f"{id_prefix}-{len(all_stations)}"
                all_stations[name] = {
                    'id': station_id,
                    'name': name,
                    'type': station_type,
                    'longitude': coord[0],
                    'latitude': coord[1],
                }
            elif coord != (0.0, 0.0) and all_stations[name]['longitude'] == 0.0:
                all_stations[name]['longitude'] = coord[0]
                all_stations[name]['latitude'] = coord[1]

            current_station_id = all_stations[name]['id']

            if prev_station_id and prev_station_id != current_station_id:
                seg_count += 1
                pipe_id = f"{seg_prefix}-{seg_count}"

                # 里程差估算长度
                idx = group_nodes.index(node)
                length_km = 0.0
                if idx > 0:
                    length_km = abs(node['mileage'] - group_nodes[idx - 1]['mileage'])

                all_pipelines.append({
                    'id': pipe_id,
                    'name': layer_name,
                    'start_station_id': prev_station_id,
                    'end_station_id': current_station_id,
                    'category': category,
                    'length_km': length_km,
                })

            prev_station_id = current_station_id


# ============ 主流程 ============

def map_node_type(raw_type: str) -> str:
    """将 structure.json 中的类型映射为后端类型"""
    mapping = {
        'compressor': 'compressor',
        'distribution': 'distribution',
        'valve': 'valve',
        'source': 'source',
        'shared': 'shared',
    }
    return mapping.get(raw_type, 'other')


def process_structure_json(
    json_path: str,
    ts_path: str,
    pipeline_name: str,
    id_prefix: str,
    all_stations: dict[str, dict],
    all_pipelines: list[dict],
):
    """处理一条管线的 structure.json + 坐标文件"""
    
    full_json_path = os.path.join(FRONTEND_DATA, json_path)
    if not os.path.exists(full_json_path):
        print(f"  ⚠️ JSON 不存在: {json_path}, 跳过")
        return

    with open(full_json_path, 'r', encoding='utf-8') as f:
        structure = json.load(f)

    # 提取坐标
    coords = extract_coords_from_ts(ts_path)
    print(f"  📍 坐标数: {len(coords)}")

    # 处理干线节点
    trunk_nodes = structure.get('trunk', [])
    print(f"  🔵 干线节点: {len(trunk_nodes)}")
    
    prev_station_id = None
    segment_count = 0
    
    for node in trunk_nodes:
        name = node['name']
        raw_type = node.get('type', 'other')
        station_type = map_node_type(raw_type)
        
        # 获取坐标（优先用坐标映射表，否则为 0）
        coord = coords.get(name, (0.0, 0.0))
        
        # 构建唯一 station_id（基于名称去重）
        if name not in all_stations:
            station_id = f"{id_prefix}-{node.get('id', len(all_stations))}"
            all_stations[name] = {
                'id': station_id,
                'name': name,
                'type': station_type,
                'longitude': coord[0],
                'latitude': coord[1],
            }
        
        current_station_id = all_stations[name]['id']
        
        # 生成管段（连接相邻站点）
        if prev_station_id and prev_station_id != current_station_id:
            segment_count += 1
            pipe_id = f"{id_prefix}-T-{segment_count}"
            
            # 计算管段长度（用里程差估算）
            length_km = 0.0
            if 'mileage' in node:
                # 找上一个节点的里程
                idx = trunk_nodes.index(node)
                if idx > 0:
                    prev_mileage = trunk_nodes[idx - 1].get('mileage', 0)
                    length_km = abs(node['mileage'] - prev_mileage)
            
            all_pipelines.append({
                'id': pipe_id,
                'name': pipeline_name,
                'start_station_id': prev_station_id,
                'end_station_id': current_station_id,
                'category': 'trunk',
                'length_km': length_km,
            })
        
        prev_station_id = current_station_id

    # 处理支线
    branches = structure.get('branches', [])
    branch_names = structure.get('branch_names', [])
    
    for bi, branch_nodes in enumerate(branches):
        b_name = branch_names[bi] if bi < len(branch_names) else f"{pipeline_name}-支线{bi+1}"
        print(f"  🟢 支线 [{b_name}]: {len(branch_nodes)} 节点")
        
        prev_station_id = None
        b_seg_count = 0
        
        for node in branch_nodes:
            name = node['name']
            raw_type = node.get('type', 'other')
            station_type = map_node_type(raw_type)
            coord = coords.get(name, (0.0, 0.0))
            
            if name not in all_stations:
                station_id = f"{id_prefix}-B{bi+1}-{node.get('id', len(all_stations))}"
                all_stations[name] = {
                    'id': station_id,
                    'name': name,
                    'type': station_type,
                    'longitude': coord[0],
                    'latitude': coord[1],
                }
            
            # 如果坐标更好则更新
            if coord != (0.0, 0.0) and all_stations[name]['longitude'] == 0.0:
                all_stations[name]['longitude'] = coord[0]
                all_stations[name]['latitude'] = coord[1]
            
            current_station_id = all_stations[name]['id']
            
            if prev_station_id and prev_station_id != current_station_id:
                b_seg_count += 1
                pipe_id = f"{id_prefix}-B{bi+1}-{b_seg_count}"
                
                length_km = 0.0
                if 'mileage' in node:
                    idx = branch_nodes.index(node)
                    if idx > 0:
                        prev_mileage = branch_nodes[idx - 1].get('mileage', 0)
                        length_km = abs(node['mileage'] - prev_mileage)
                
                all_pipelines.append({
                    'id': pipe_id,
                    'name': b_name,
                    'start_station_id': prev_station_id,
                    'end_station_id': current_station_id,
                    'category': 'branch',
                    'length_km': length_km,
                })
            
            prev_station_id = current_station_id


def main():
    print("=" * 60)
    print("🔄 前端管线数据 → SQLite 同步开始")
    print("=" * 60)

    # 确保数据库表存在
    create_db_and_tables()

    all_stations: dict[str, dict] = {}  # name -> station_info
    all_pipelines: list[dict] = []

    # 处理 8 条管线的 structure.json
    for json_path, ts_path, name, prefix in PIPELINE_CONFIGS:
        print(f"\n📦 处理管线: {name}")
        process_structure_json(json_path, ts_path, name, prefix, all_stations, all_pipelines)

    # 处理陕京四线（特殊：没有 structure.json）
    print(f"\n📦 处理管线: 陕京四线 (SJ4 - 直接解析 TS)")
    extract_sj4_data(SJ4_CONFIG[0], all_stations, all_pipelines)

    # ============ 写入数据库 ============
    print(f"\n{'=' * 60}")
    print(f"📊 统计: {len(all_stations)} 站场, {len(all_pipelines)} 管段")
    print(f"{'=' * 60}")

    with Session(engine) as session:
        # 清空旧数据
        existing_stations = session.exec(select(Station)).all()
        existing_pipelines = session.exec(select(Pipeline)).all()
        
        if existing_stations or existing_pipelines:
            print(f"\n🗑️  清空旧数据: {len(existing_stations)} 站场, {len(existing_pipelines)} 管段")
            for s in existing_stations:
                session.delete(s)
            for p in existing_pipelines:
                session.delete(p)
            session.commit()

        # 插入站场
        station_count = 0
        for info in all_stations.values():
            station = Station(
                id=info['id'],
                name=info['name'],
                type=info['type'],
                longitude=info['longitude'],
                latitude=info['latitude'],
            )
            session.add(station)
            station_count += 1

        # 插入管段
        pipeline_count = 0
        for info in all_pipelines:
            pipeline = Pipeline(
                id=info['id'],
                name=info['name'],
                start_station_id=info['start_station_id'],
                end_station_id=info['end_station_id'],
                category=info['category'],
                length_km=info['length_km'],
                length=info['length_km'],
            )
            session.add(pipeline)
            pipeline_count += 1

        session.commit()
        print(f"\n✅ 写入完成: {station_count} 站场, {pipeline_count} 管段")

    # 验证
    with Session(engine) as session:
        s_count = len(session.exec(select(Station)).all())
        p_count = len(session.exec(select(Pipeline)).all())
        print(f"📋 验证: 数据库中有 {s_count} 站场, {p_count} 管段")

    print(f"\n{'=' * 60}")
    print("🎉 同步完成!")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
