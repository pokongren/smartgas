"""
自定义数据导入脚本
支持从 JSON、CSV、Excel 等格式导入数据
"""
import sys
from pathlib import Path
import json
import csv

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session
from app.database import engine, create_db_and_tables
from app.models import Station, Pipeline


def import_from_json(json_file: str, clear_existing: bool = False):
    """
    从 JSON 文件导入数据
    
    参数:
        json_file: JSON 文件路径
        clear_existing: 是否清空现有数据
    
    JSON 格式示例:
    {
        "stations": [
            {
                "id": "node-001",
                "name": "贵阳",
                "type": "compressor",
                "longitude": 106.71,
                "latitude": 26.57,
                "design_pressure": 8.5,
                "status": "normal"
            }
        ],
        "pipelines": [
            {
                "id": "line-001",
                "name": "中贵干线",
                "start_station_id": "node-001",
                "end_station_id": "node-002",
                "diameter": 1016,
                "length": 580,
                "category": "中贵线",
                "status": "normal"
            }
        ]
    }
    """
    print(f"📂 正在读取 JSON 文件: {json_file}")
    
    # 读取 JSON 文件
    try:
        with open(json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"❌ 文件不存在: {json_file}")
        return
    except json.JSONDecodeError as e:
        print(f"❌ JSON 格式错误: {e}")
        return
    
    # 创建表
    create_db_and_tables()
    
    with Session(engine) as session:
        # 清空现有数据
        if clear_existing:
            print("🗑️  清空现有数据...")
            session.query(Pipeline).delete()
            session.query(Station).delete()
            session.commit()
        
        # 导入站场数据
        stations_data = data.get('stations', [])
        if stations_data:
            print(f"📍 导入 {len(stations_data)} 个站场...")
            for station_data in stations_data:
                try:
                    station = Station(**station_data)
                    session.add(station)
                except Exception as e:
                    print(f"  ⚠️  站场导入失败: {station_data.get('name', 'Unknown')} - {e}")
            
            session.commit()
            print(f"  ✅ 成功导入 {len(stations_data)} 个站场")
        
        # 导入管线数据
        pipelines_data = data.get('pipelines', [])
        if pipelines_data:
            print(f"🔗 导入 {len(pipelines_data)} 条管线...")
            for pipeline_data in pipelines_data:
                try:
                    pipeline = Pipeline(**pipeline_data)
                    session.add(pipeline)
                except Exception as e:
                    print(f"  ⚠️  管线导入失败: {pipeline_data.get('name', 'Unknown')} - {e}")
            
            session.commit()
            print(f"  ✅ 成功导入 {len(pipelines_data)} 条管线")
    
    print("\n✅ 数据导入完成!")


def import_from_csv(stations_csv: str = None, pipelines_csv: str = None, clear_existing: bool = False):
    """
    从 CSV 文件导入数据
    
    参数:
        stations_csv: 站场 CSV 文件路径
        pipelines_csv: 管线 CSV 文件路径
        clear_existing: 是否清空现有数据
    
    CSV 格式要求:
    
    stations.csv:
    id,name,type,longitude,latitude,design_pressure,status
    node-001,贵阳,compressor,106.71,26.57,8.5,normal
    
    pipelines.csv:
    id,name,start_station_id,end_station_id,diameter,length,category,status
    line-001,中贵干线,node-001,node-002,1016,580,中贵线,normal
    """
    # 创建表
    create_db_and_tables()
    
    with Session(engine) as session:
        # 清空现有数据
        if clear_existing:
            print("🗑️  清空现有数据...")
            session.query(Pipeline).delete()
            session.query(Station).delete()
            session.commit()
        
        # 导入站场数据
        if stations_csv:
            print(f"📂 正在读取站场 CSV: {stations_csv}")
            try:
                with open(stations_csv, 'r', encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    stations = []
                    for row in reader:
                        # 转换数据类型
                        station_data = {
                            'id': row['id'],
                            'name': row['name'],
                            'type': row['type'],
                            'longitude': float(row['longitude']),
                            'latitude': float(row['latitude']),
                            'design_pressure': float(row['design_pressure']),
                            'status': row.get('status', 'normal')
                        }
                        stations.append(Station(**station_data))
                    
                    session.add_all(stations)
                    session.commit()
                    print(f"  ✅ 成功导入 {len(stations)} 个站场")
            except FileNotFoundError:
                print(f"  ❌ 文件不存在: {stations_csv}")
            except Exception as e:
                print(f"  ❌ 导入失败: {e}")
        
        # 导入管线数据
        if pipelines_csv:
            print(f"📂 正在读取管线 CSV: {pipelines_csv}")
            try:
                with open(pipelines_csv, 'r', encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    pipelines = []
                    for row in reader:
                        # 转换数据类型
                        pipeline_data = {
                            'id': row['id'],
                            'name': row['name'],
                            'start_station_id': row['start_station_id'],
                            'end_station_id': row['end_station_id'],
                            'diameter': int(row['diameter']),
                            'length': float(row['length']),
                            'category': row['category'],
                            'status': row.get('status', 'normal')
                        }
                        pipelines.append(Pipeline(**pipeline_data))
                    
                    session.add_all(pipelines)
                    session.commit()
                    print(f"  ✅ 成功导入 {len(pipelines)} 条管线")
            except FileNotFoundError:
                print(f"  ❌ 文件不存在: {pipelines_csv}")
            except Exception as e:
                print(f"  ❌ 导入失败: {e}")
    
    print("\n✅ 数据导入完成!")


def export_template_json(output_file: str = "data_template.json"):
    """
    导出 JSON 模板文件
    """
    template = {
        "stations": [
            {
                "id": "node-001",
                "name": "示例站场",
                "type": "compressor",  # source, compressor, distribution
                "longitude": 106.71,
                "latitude": 26.57,
                "design_pressure": 8.5,
                "status": "normal"  # normal, maintenance, fault, disabled
            }
        ],
        "pipelines": [
            {
                "id": "line-001",
                "name": "示例管线",
                "start_station_id": "node-001",
                "end_station_id": "node-002",
                "diameter": 1016,
                "length": 580.0,
                "category": "中贵线",
                "status": "normal"  # normal, maintenance, fault, disabled
            }
        ]
    }
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(template, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 模板文件已生成: {output_file}")


def export_template_csv():
    """
    导出 CSV 模板文件
    """
    # 站场模板
    stations_template = "stations_template.csv"
    with open(stations_template, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['id', 'name', 'type', 'longitude', 'latitude', 'design_pressure', 'status'])
        writer.writerow(['node-001', '示例站场', 'compressor', '106.71', '26.57', '8.5', 'normal'])
    
    print(f"✅ 站场模板已生成: {stations_template}")
    
    # 管线模板
    pipelines_template = "pipelines_template.csv"
    with open(pipelines_template, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['id', 'name', 'start_station_id', 'end_station_id', 'diameter', 'length', 'category', 'status'])
        writer.writerow(['line-001', '示例管线', 'node-001', 'node-002', '1016', '580', '中贵线', 'normal'])
    
    print(f"✅ 管线模板已生成: {pipelines_template}")


def show_usage():
    """显示使用说明"""
    print("""
╔══════════════════════════════════════════════════════════════╗
║          SmartGas Grid - 自定义数据导入工具                  ║
╚══════════════════════════════════════════════════════════════╝

使用方法:

1️⃣  导出模板文件
   python scripts/import_custom_data.py --export-template

2️⃣  从 JSON 文件导入
   python scripts/import_custom_data.py --json your_data.json

3️⃣  从 CSV 文件导入
   python scripts/import_custom_data.py --csv-stations stations.csv --csv-pipelines pipelines.csv

4️⃣  清空现有数据并导入
   python scripts/import_custom_data.py --json your_data.json --clear

参数说明:
  --export-template     导出模板文件 (JSON 和 CSV)
  --json FILE          从 JSON 文件导入
  --csv-stations FILE  从 CSV 文件导入站场数据
  --csv-pipelines FILE 从 CSV 文件导入管线数据
  --clear              导入前清空现有数据

示例:
  # 导出模板
  python scripts/import_custom_data.py --export-template
  
  # 从 JSON 导入
  python scripts/import_custom_data.py --json data.json
  
  # 从 CSV 导入并清空现有数据
  python scripts/import_custom_data.py --csv-stations stations.csv --csv-pipelines pipelines.csv --clear
""")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='SmartGas Grid 自定义数据导入工具')
    parser.add_argument('--export-template', action='store_true', help='导出模板文件')
    parser.add_argument('--json', type=str, help='从 JSON 文件导入')
    parser.add_argument('--csv-stations', type=str, help='从 CSV 文件导入站场数据')
    parser.add_argument('--csv-pipelines', type=str, help='从 CSV 文件导入管线数据')
    parser.add_argument('--clear', action='store_true', help='导入前清空现有数据')
    
    args = parser.parse_args()
    
    # 如果没有参数，显示使用说明
    if len(sys.argv) == 1:
        show_usage()
        sys.exit(0)
    
    # 导出模板
    if args.export_template:
        print("📝 正在生成模板文件...\n")
        export_template_json()
        export_template_csv()
        print("\n✅ 模板文件生成完成!")
        print("\n💡 提示: 请编辑模板文件后使用 --json 或 --csv-* 参数导入数据")
        sys.exit(0)
    
    # 从 JSON 导入
    if args.json:
        import_from_json(args.json, clear_existing=args.clear)
    
    # 从 CSV 导入
    if args.csv_stations or args.csv_pipelines:
        import_from_csv(
            stations_csv=args.csv_stations,
            pipelines_csv=args.csv_pipelines,
            clear_existing=args.clear
        )
