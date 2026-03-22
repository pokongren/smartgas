"""
管线系统数据迁移脚本

功能：
1. 创建 pipeline_systems 表
2. 从现有 stations/pipelines 表的 ID 前缀推断分组
3. 填充 9 条管线系统的元数据和图层配置
"""
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlmodel import SQLModel, Session, select
from sqlalchemy import text
from app.database import engine
from app.models import PipelineSystem, Station, Pipeline


# 管线系统定义：id → (name, color, sort_order, layers_config)
# layers_config 中的 id_prefix 用于匹配 stations/pipelines 表中的 ID 前缀
PIPELINE_SYSTEMS = [
    {
        "id": "we1",
        "name": "西气东输一线",
        "color": "#FF5722",
        "sort_order": 1,
        "layers": [
            {"name": "西一线干线", "type": "trunk", "id_prefix": "WE1", "visible": True},
            # 支线通过 WE1-B 前缀匹配
        ]
    },
    {
        "id": "we2",
        "name": "西气东输二线",
        "color": "#2196F3",
        "sort_order": 2,
        "layers": [
            {"name": "西二线干线", "type": "trunk", "id_prefix": "WE2", "visible": True},
        ]
    },
    {
        "id": "cred",
        "name": "中俄东线",
        "color": "#E91E63",
        "sort_order": 3,
        "layers": [
            {"name": "中俄东线干线", "type": "trunk", "id_prefix": "CRED", "visible": True},
        ]
    },
    {
        "id": "pt",
        "name": "中贵线",
        "color": "#9C27B0",
        "sort_order": 4,
        "layers": [
            {"name": "中贵线干线", "type": "trunk", "id_prefix": "PT", "visible": True},
        ]
    },
    {
        "id": "zg",
        "name": "中贵联络线",
        "color": "#00BCD4",
        "sort_order": 5,
        "layers": [
            {"name": "中贵联络线干线", "type": "trunk", "id_prefix": "ZG", "visible": True},
        ]
    },
    {
        "id": "zm",
        "name": "中缅线",
        "color": "#FF9800",
        "sort_order": 6,
        "layers": [
            {"name": "中缅线干线", "type": "trunk", "id_prefix": "ZM", "visible": True},
        ]
    },
    {
        "id": "gn",
        "name": "广南支干线",
        "color": "#4CAF50",
        "sort_order": 7,
        "layers": [
            {"name": "广南支干线干线", "type": "trunk", "id_prefix": "GN", "visible": True},
        ]
    },
    {
        "id": "gs",
        "name": "广深支干线",
        "color": "#795548",
        "sort_order": 8,
        "layers": [
            {"name": "广深支干线干线", "type": "trunk", "id_prefix": "GS", "visible": True},
        ]
    },
    {
        "id": "sj4",
        "name": "陕京四线",
        "color": "#607D8B",
        "sort_order": 9,
        "layers": [
            {"name": "陕京四线干线", "type": "trunk", "id_prefix": "SJ4", "visible": True},
        ]
    },
]


def detect_layers_from_data(session: Session):
    """从实际数据中检测各管线的图层配置"""
    # 读取所有站场 ID
    stations = session.exec(select(Station)).all()
    pipelines_db = session.exec(select(Pipeline)).all()
    
    # 统计每个 ID 前缀的节点数和边数
    prefix_stats = {}
    for s in stations:
        # 从 ID 解析前缀，如 WE1-S-1 → WE1, WE1-B1-S-100 → WE1-B1
        parts = s.id.split('-')
        if len(parts) >= 2:
            # 判断是否是支线（含 B 前缀）
            if len(parts) >= 3 and parts[1].startswith('B'):
                prefix = f"{parts[0]}-{parts[1]}"  # WE1-B1
            else:
                prefix = parts[0]  # WE1
            
            if prefix not in prefix_stats:
                prefix_stats[prefix] = {"stations": 0, "pipelines": 0, "station_names": []}
            prefix_stats[prefix]["stations"] += 1
            prefix_stats[prefix]["station_names"].append(s.name)
    
    for p in pipelines_db:
        parts = p.id.split('-')
        if len(parts) >= 2:
            if len(parts) >= 3 and parts[1].startswith('B'):
                prefix = f"{parts[0]}-{parts[1]}"
            else:
                prefix = parts[0]
            if prefix not in prefix_stats:
                prefix_stats[prefix] = {"stations": 0, "pipelines": 0, "station_names": []}
            prefix_stats[prefix]["pipelines"] += 1
    
    print(f"\n检测到 {len(prefix_stats)} 个 ID 前缀组:")
    for prefix, stats in sorted(prefix_stats.items()):
        print(f"  {prefix}: {stats['stations']} 站场, {stats['pipelines']} 管段")
    
    return prefix_stats


def build_layers_config(prefix_stats: dict) -> dict:
    """根据 ID 前缀统计，为每个管线系统生成完整的图层配置"""
    system_layers = {}
    
    for system in PIPELINE_SYSTEMS:
        base_prefix = system["layers"][0]["id_prefix"]  # 主前缀
        layers = []
        
        # 干线图层
        trunk_layer = system["layers"][0].copy()
        layers.append(trunk_layer)
        
        # 查找支线（以 BASE_PREFIX-B 开头的前缀）
        for prefix in sorted(prefix_stats.keys()):
            if prefix.startswith(f"{base_prefix}-B"):
                branch_idx = prefix.split('-B')[1] if '-B' in prefix else '?'
                branch_name = f"{system['name']}支线{branch_idx}"
                layers.append({
                    "name": branch_name,
                    "type": "branch",
                    "id_prefix": prefix,
                    "visible": False
                })
        
        system_layers[system["id"]] = layers
    
    return system_layers


def migrate():
    """执行迁移"""
    # 确保表存在
    SQLModel.metadata.create_all(engine)
    
    with Session(engine) as session:
        # 检查是否已迁移
        existing = session.exec(select(PipelineSystem)).all()
        if existing:
            print(f"pipeline_systems 表已有 {len(existing)} 条数据，先清空重建...")
            for item in existing:
                session.delete(item)
            session.commit()
        
        # 检测数据前缀
        prefix_stats = detect_layers_from_data(session)
        
        # 生成图层配置
        system_layers = build_layers_config(prefix_stats)
        
        # 写入 pipeline_systems 表
        created = 0
        for system in PIPELINE_SYSTEMS:
            layers_config = system_layers.get(system["id"], system["layers"])
            
            ps = PipelineSystem(
                id=system["id"],
                name=system["name"],
                color=system["color"],
                sort_order=system["sort_order"],
                layers_config=json.dumps(layers_config, ensure_ascii=False)
            )
            session.add(ps)
            created += 1
            
            layer_count = len(layers_config)
            print(f"  [OK] {system['name']} ({system['id']}): {layer_count} layers")
        
        session.commit()
        print(f"\n迁移完成：创建了 {created} 条管线系统记录")
        
        # 验证：统计每个系统的站场和管段数量
        print("\n数据验证:")
        for system in PIPELINE_SYSTEMS:
            layers_config = json.loads(
                session.get(PipelineSystem, system["id"]).layers_config
            )
            total_stations = 0
            total_pipelines = 0
            for layer in layers_config:
                prefix = layer["id_prefix"]
                # 查询该前缀的站场数
                s_count = len([s for s in session.exec(select(Station)).all() 
                             if s.id.startswith(prefix + "-")])
                p_count = len([p for p in session.exec(select(Pipeline)).all() 
                             if p.id.startswith(prefix + "-")])
                total_stations += s_count
                total_pipelines += p_count
            print(f"  {system['name']}: {total_stations} 站场, {total_pipelines} 管段")


if __name__ == "__main__":
    migrate()
