"""
数据初始化脚本
将前端的南部管网数据导入到 SQLite 数据库
"""
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session
from app.database import engine, create_db_and_tables
from app.models import Station, Pipeline

def init_data():
    """初始化数据"""
    # 创建表
    create_db_and_tables()
    
    with Session(engine) as session:
        # 清空现有数据
        session.query(Station).delete()
        session.query(Pipeline).delete()
        
        # 添加站场数据 (从前端 southernPipelineData.ts 复制)
        stations = [
            Station(id="node-001", name="中卫", type="source", longitude=105.18, latitude=37.50, design_pressure=10.0),
            Station(id="node-002", name="兰州", type="compressor", longitude=103.83, latitude=36.06, design_pressure=8.5),
            Station(id="node-003", name="广元", type="compressor", longitude=105.84, latitude=32.44, design_pressure=8.5),
            Station(id="node-004", name="贵阳", type="compressor", longitude=106.71, latitude=26.57, design_pressure=8.5),
            Station(id="node-005", name="昆明", type="distribution", longitude=102.71, latitude=25.04, design_pressure=6.0),
            Station(id="node-006", name="南宁", type="distribution", longitude=108.37, latitude=22.82, design_pressure=6.0),
            Station(id="node-007", name="广州", type="distribution", longitude=113.26, latitude=23.13, design_pressure=6.0),
            Station(id="node-008", name="海口", type="distribution", longitude=110.32, latitude=20.03, design_pressure=4.0),
            Station(id="node-009", name="梧州", type="distribution", longitude=111.30, latitude=23.48, design_pressure=5.0),
            Station(id="node-010", name="贵港", type="distribution", longitude=109.60, latitude=23.11, design_pressure=5.0),
            Station(id="node-011", name="文山", type="distribution", longitude=104.25, latitude=23.37, design_pressure=4.5),
            Station(id="node-012", name="安顺", type="distribution", longitude=105.95, latitude=26.25, design_pressure=5.5),
        ]
        
        # 添加管线数据
        pipelines = [
            Pipeline(id="line-001", name="中贵干线 中卫-广元", start_station_id="node-001", end_station_id="node-003", diameter=1016, length=580, category="中贵线"),
            Pipeline(id="line-002", name="中贵干线 广元-贵阳", start_station_id="node-003", end_station_id="node-004", diameter=1016, length=620, category="中贵线"),
            Pipeline(id="line-003", name="中缅线 昆明-贵阳", start_station_id="node-005", end_station_id="node-004", diameter=813, length=450, category="中缅线"),
            Pipeline(id="line-004", name="中缅线 昆明-文山", start_station_id="node-005", end_station_id="node-011", diameter=610, length=280, category="中缅线"),
            Pipeline(id="line-005", name="广南支线 贵阳-南宁", start_station_id="node-004", end_station_id="node-006", diameter=660, length=520, category="广南/广西"),
            Pipeline(id="line-006", name="广南支线 南宁-贵港", start_station_id="node-006", end_station_id="node-010", diameter=508, length=120, category="广南/广西"),
            Pipeline(id="line-007", name="广南支线 贵港-梧州", start_station_id="node-010", end_station_id="node-009", diameter=508, length=180, category="广南/广西"),
            Pipeline(id="line-008", name="广南支线 梧州-广州", start_station_id="node-009", end_station_id="node-007", diameter=660, length=320, category="广南/广西"),
            Pipeline(id="line-009", name="海南支线 南宁-海口", start_station_id="node-006", end_station_id="node-008", diameter=406, length=480, category="海南"),
            Pipeline(id="line-010", name="西二线 兰州-广元", start_station_id="node-002", end_station_id="node-003", diameter=1219, length=680, category="西二线"),
            Pipeline(id="line-011", name="LNG外输 贵阳-安顺", start_station_id="node-004", end_station_id="node-012", diameter=508, length=95, category="LNG外输"),
        ]
        
        # 批量插入
        session.add_all(stations)
        session.add_all(pipelines)
        session.commit()
        
        print(f"✅ 成功导入 {len(stations)} 个站场")
        print(f"✅ 成功导入 {len(pipelines)} 条管线")

if __name__ == "__main__":
    init_data()
