"""
Excel 灵活导入工具
支持从 Excel 文件(.xlsx, .xls)导入站场和管线数据
"""
import sys
from pathlib import Path
import pandas as pd

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session
from app.database import engine, create_db_and_tables
from app.models import Station, Pipeline


def import_from_excel(excel_file: str, clear_existing: bool = False):
    """
    从 Excel 文件导入数据
    
    参数:
        excel_file: Excel 文件路径(.xlsx 或 .xls)
        clear_existing: 是否清空现有数据
    
    Excel 格式:
        - 工作表1: "站场" 或 "stations"
        - 工作表2: "管线" 或 "pipelines"
    """
    print(f"📂 正在读取 Excel 文件: {excel_file}")
    
    try:
        # 读取 Excel 文件
        excel_data = pd.ExcelFile(excel_file)
        print(f"  ✅ 找到 {len(excel_data.sheet_names)} 个工作表: {excel_data.sheet_names}")
    except FileNotFoundError:
        print(f"❌ 文件不存在: {excel_file}")
        return
    except Exception as e:
        print(f"❌ 读取失败: {e}")
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
        stations_imported = import_stations_from_excel(excel_data, session)
        
        # 导入管线数据
        pipelines_imported = import_pipelines_from_excel(excel_data, session)
    
    print("\n✅ 数据导入完成!")
    print(f"  - 站场: {stations_imported} 个")
    print(f"  - 管线: {pipelines_imported} 条")


def import_stations_from_excel(excel_data, session):
    """从 Excel 导入站场数据"""
    # 尝试多个可能的工作表名称
    sheet_names = ['站场', 'stations', 'Stations', '站场数据', 'station']
    
    df = None
    for name in sheet_names:
        if name in excel_data.sheet_names:
            df = pd.read_excel(excel_data, sheet_name=name)
            print(f"\n📍 正在导入站场数据 (工作表: {name})...")
            break
    
    if df is None:
        print(f"⚠️  未找到站场工作表,跳过站场导入")
        print(f"   提示: 工作表名称应为: {', '.join(sheet_names)}")
        return 0
    
    # 列名映射(支持中英文)
    column_mapping = {
        'ID': 'id', 'id': 'id', '编号': 'id', '站场ID': 'id',
        '名称': 'name', 'name': 'name', '站场名称': 'name',
        '类型': 'type', 'type': 'type', '站场类型': 'type',
        '经度': 'longitude', 'longitude': 'longitude', 'lon': 'longitude',
        '纬度': 'latitude', 'latitude': 'latitude', 'lat': 'latitude',
        '设计压力': 'design_pressure', 'design_pressure': 'design_pressure', '压力': 'design_pressure',
        '状态': 'status', 'status': 'status'
    }
    
    # 重命名列
    df.rename(columns=column_mapping, inplace=True)
    
    # 类型映射(支持中文)
    type_mapping = {
        '气源站': 'source', '气源': 'source',
        '压气站': 'compressor', '压缩机': 'compressor',
        '分输站': 'distribution', '分输': 'distribution'
    }
    
    if 'type' in df.columns:
        df['type'] = df['type'].map(lambda x: type_mapping.get(x, x))
    
    # 状态映射
    status_mapping = {
        '正常': 'normal', '运行': 'normal',
        '维护': 'maintenance', '检修': 'maintenance',
        '故障': 'fault', '异常': 'fault',
        '停用': 'disabled', '关闭': 'disabled'
    }
    
    if 'status' in df.columns:
        df['status'] = df['status'].map(lambda x: status_mapping.get(x, x))
    else:
        df['status'] = 'normal'
    
    # 导入数据
    count = 0
    for _, row in df.iterrows():
        try:
            # 跳过空行
            if pd.isna(row.get('id')) or pd.isna(row.get('name')):
                continue
            
            station_data = {
                'id': str(row['id']),
                'name': str(row['name']),
                'type': str(row.get('type', 'distribution')),
                'longitude': float(row['longitude']),
                'latitude': float(row['latitude']),
                'design_pressure': float(row.get('design_pressure', 6.0)),
                'status': str(row.get('status', 'normal'))
            }
            
            station = Station(**station_data)
            session.add(station)
            count += 1
        except Exception as e:
            print(f"  ⚠️  站场导入失败: {row.get('name', 'Unknown')} - {e}")
    
    session.commit()
    print(f"  ✅ 成功导入 {count} 个站场")
    return count


def import_pipelines_from_excel(excel_data, session):
    """从 Excel 导入管线数据"""
    # 尝试多个可能的工作表名称
    sheet_names = ['管线', 'pipelines', 'Pipelines', '管线数据', 'pipeline']
    
    df = None
    for name in sheet_names:
        if name in excel_data.sheet_names:
            df = pd.read_excel(excel_data, sheet_name=name)
            print(f"\n🔗 正在导入管线数据 (工作表: {name})...")
            break
    
    if df is None:
        print(f"⚠️  未找到管线工作表,跳过管线导入")
        print(f"   提示: 工作表名称应为: {', '.join(sheet_names)}")
        return 0
    
    # 列名映射
    column_mapping = {
        'ID': 'id', 'id': 'id', '编号': 'id', '管线ID': 'id',
        '名称': 'name', 'name': 'name', '管线名称': 'name',
        '起点': 'start_station_id', 'start_station_id': 'start_station_id', '起点站场': 'start_station_id',
        '终点': 'end_station_id', 'end_station_id': 'end_station_id', '终点站场': 'end_station_id',
        '管径': 'diameter', 'diameter': 'diameter',
        '长度': 'length', 'length': 'length',
        '类别': 'category', 'category': 'category', '管线类别': 'category',
        '状态': 'status', 'status': 'status'
    }
    
    df.rename(columns=column_mapping, inplace=True)
    
    # 状态映射
    status_mapping = {
        '正常': 'normal', '运行': 'normal',
        '维护': 'maintenance', '检修': 'maintenance',
        '故障': 'fault', '异常': 'fault',
        '停用': 'disabled', '关闭': 'disabled'
    }
    
    if 'status' in df.columns:
        df['status'] = df['status'].map(lambda x: status_mapping.get(x, x))
    else:
        df['status'] = 'normal'
    
    # 导入数据
    count = 0
    for _, row in df.iterrows():
        try:
            # 跳过空行
            if pd.isna(row.get('id')) or pd.isna(row.get('name')):
                continue
            
            pipeline_data = {
                'id': str(row['id']),
                'name': str(row['name']),
                'start_station_id': str(row['start_station_id']),
                'end_station_id': str(row['end_station_id']),
                'diameter': int(row['diameter']),
                'length': float(row['length']),
                'category': str(row.get('category', '未分类')),
                'status': str(row.get('status', 'normal'))
            }
            
            pipeline = Pipeline(**pipeline_data)
            session.add(pipeline)
            count += 1
        except Exception as e:
            print(f"  ⚠️  管线导入失败: {row.get('name', 'Unknown')} - {e}")
    
    session.commit()
    print(f"  ✅ 成功导入 {count} 条管线")
    return count


def export_template(output_file: str = "数据导入模板.xlsx"):
    """
    导出 Excel 模板文件
    """
    print(f"📝 正在生成 Excel 模板: {output_file}")
    
    # 站场模板数据
    stations_template = pd.DataFrame({
        'ID': ['station-001', 'station-002', 'station-003'],
        '名称': ['示例站场1', '示例站场2', '示例站场3'],
        '类型': ['气源站', '压气站', '分输站'],
        '经度': [116.40, 117.20, 114.48],
        '纬度': [39.90, 39.13, 38.03],
        '设计压力': [10.0, 8.5, 6.0],
        '状态': ['正常', '正常', '正常']
    })
    
    # 管线模板数据
    pipelines_template = pd.DataFrame({
        'ID': ['line-001', 'line-002'],
        '名称': ['示例管线1', '示例管线2'],
        '起点站场': ['station-001', 'station-002'],
        '终点站场': ['station-002', 'station-003'],
        '管径': [1016, 813],
        '长度': [120.0, 280.0],
        '类别': ['示例线路', '示例线路'],
        '状态': ['正常', '正常']
    })
    
    # 写入 Excel
    with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
        stations_template.to_excel(writer, sheet_name='站场', index=False)
        pipelines_template.to_excel(writer, sheet_name='管线', index=False)
    
    print(f"✅ 模板文件已生成: {output_file}")
    print("\n💡 使用说明:")
    print("  1. 打开模板文件")
    print("  2. 在'站场'工作表中填写站场数据")
    print("  3. 在'管线'工作表中填写管线数据")
    print("  4. 保存文件")
    print("  5. 运行导入命令:")
    print(f"     python scripts/import_excel.py --file {output_file}")


def show_usage():
    """显示使用说明"""
    print("""
╔══════════════════════════════════════════════════════════════╗
║          SmartGas Grid - Excel 灵活导入工具                  ║
╚══════════════════════════════════════════════════════════════╝

使用方法:

1️⃣  生成 Excel 模板
   python scripts/import_excel.py --export-template

2️⃣  从 Excel 导入数据
   python scripts/import_excel.py --file your_data.xlsx

3️⃣  清空现有数据并导入
   python scripts/import_excel.py --file your_data.xlsx --clear

参数说明:
  --export-template     生成 Excel 模板文件
  --file FILE          指定 Excel 文件路径
  --clear              导入前清空现有数据

Excel 格式要求:
  - 必须包含两个工作表: "站场" 和 "管线"
  - 支持中文列名
  - 支持中文类型和状态(会自动转换)

示例:
  # 生成模板
  python scripts/import_excel.py --export-template
  
  # 导入数据
  python scripts/import_excel.py --file 数据导入模板.xlsx
  
  # 清空并导入
  python scripts/import_excel.py --file my_data.xlsx --clear
""")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Excel 灵活导入工具')
    parser.add_argument('--export-template', action='store_true', help='导出 Excel 模板')
    parser.add_argument('--file', type=str, help='Excel 文件路径')
    parser.add_argument('--clear', action='store_true', help='导入前清空现有数据')
    
    args = parser.parse_args()
    
    # 如果没有参数,显示使用说明
    if len(sys.argv) == 1:
        show_usage()
        sys.exit(0)
    
    # 导出模板
    if args.export_template:
        export_template()
        sys.exit(0)
    
    # 导入数据
    if args.file:
        import_from_excel(args.file, clear_existing=args.clear)
    else:
        print("❌ 请指定 Excel 文件路径 (--file)")
        show_usage()
