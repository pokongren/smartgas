"""
多 Sheet Excel 导入工具
支持从单个 Excel 文件的多个工作表导入数据
"""
import sys
from pathlib import Path
import pandas as pd

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session
from app.database import engine, create_db_and_tables
from app.models import Station, Pipeline


def import_from_multi_sheet_excel(excel_file: str, clear_existing: bool = False):
    """
    从多 Sheet Excel 文件导入数据
    
    参数:
        excel_file: Excel 文件路径(.xlsx 或 .xls)
        clear_existing: 是否清空现有数据
    
    Excel 工作表命名规则:
        - "干线管道" 或 "trunk_pipelines" - 干线数据
        - "支线管道" 或 "branch_pipelines" - 支线数据
        - "分输口" 或 "delivery_points" - 分输口
        - "储气库" 或 "gas_storage" - 储气库
        - "压缩机" 或 "compressors" - 压缩机站
        - "拓扑关系" 或 "topology" - 管线站场关系
    """
    print("=" * 60)
    print("🚀 多 Sheet Excel 导入工具")
    print("=" * 60)
    
    print(f"\n📂 正在读取 Excel 文件: {excel_file}")
    
    try:
        # 读取 Excel 文件
        excel_data = pd.ExcelFile(excel_file)
        print(f"  ✅ 找到 {len(excel_data.sheet_names)} 个工作表")
        print(f"  📋 工作表列表: {', '.join(excel_data.sheet_names)}")
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
            print("\n🗑️  清空现有数据...")
            session.query(Pipeline).delete()
            session.query(Station).delete()
            session.commit()
        
        # 1. 导入站场/设施
        stations_count = import_facilities_from_sheets(excel_data, session)
        
        # 2. 导入管线
        pipelines_count = import_pipelines_from_sheets(excel_data, session)
        
        # 3. 处理拓扑关系
        topology_count = process_topology_from_sheet(excel_data, session)
    
    print("\n" + "=" * 60)
    print("✅ 导入完成!")
    print("=" * 60)
    print(f"  - 站场/设施: {stations_count} 个")
    print(f"  - 管线: {pipelines_count} 条")
    if topology_count > 0:
        print(f"  - 拓扑关系: {topology_count} 条")


def import_facilities_from_sheets(excel_data, session):
    """从多个 sheet 导入设施数据"""
    print("\n📍 步骤 1: 导入站场和设施...")
    
    # Sheet 名称映射
    facility_sheets = {
        # 中文名称
        "分输口": {"type": "distribution", "name_col": "名称"},
        "储气库": {"type": "source", "name_col": "名称"},
        "压缩机": {"type": "compressor", "name_col": "名称"},
        "压缩机站": {"type": "compressor", "name_col": "名称"},
        # 英文名称
        "delivery_points": {"type": "distribution", "name_col": "name"},
        "gas_storage": {"type": "source", "name_col": "name"},
        "compressors": {"type": "compressor", "name_col": "name"},
    }
    
    count = 0
    
    for sheet_name in excel_data.sheet_names:
        # 检查是否是设施 sheet
        config = None
        for key, value in facility_sheets.items():
            if key in sheet_name or sheet_name in key:
                config = value
                break
        
        if not config:
            continue
        
        print(f"\n  📄 处理工作表: {sheet_name}")
        
        try:
            df = pd.read_excel(excel_data, sheet_name=sheet_name)
            print(f"    找到 {len(df)} 条记录")
            
            # 清理列名
            df.columns = [c.strip() for c in df.columns]
            
            # 列名映射(支持多种写法)
            column_map = {
                '名称': 'name', 'name': 'name', '站场名称': 'name',
                '分输口名称': 'name', '储气库名称': 'name', '压缩机站名称': 'name',
                '经度': 'longitude', 'longitude': 'longitude', 'lon': 'longitude',
                '纬度': 'latitude', 'latitude': 'latitude', 'lat': 'latitude',
                '设计压力': 'pressure', '设计压力(MPa)': 'pressure', 
                'design_pressure': 'pressure', 'pressure': 'pressure',
                '状态': 'status', 'status': 'status'
            }
            
            df.rename(columns=column_map, inplace=True)
            
            # 导入数据
            for idx, row in df.iterrows():
                try:
                    # 跳过空行
                    if pd.isna(row.get('name')):
                        continue
                    
                    station_id = f"{config['type']}-{count+1:03d}"
                    
                    station = Station(
                        id=station_id,
                        name=str(row['name']),
                        type=config['type'],
                        longitude=float(row.get('longitude', 0)),
                        latitude=float(row.get('latitude', 0)),
                        design_pressure=float(row.get('pressure', 6.0))
                    )
                    
                    session.add(station)
                    count += 1
                    
                except Exception as e:
                    print(f"      ⚠️  行 {idx+2} 导入失败: {e}")
                    continue
        
        except Exception as e:
            print(f"    ❌ 工作表处理失败: {e}")
            continue
    
    session.commit()
    print(f"\n  ✅ 成功导入 {count} 个站场/设施")
    return count


def import_pipelines_from_sheets(excel_data, session):
    """从多个 sheet 导入管线数据"""
    print("\n🔗 步骤 2: 导入管线数据...")
    
    # Sheet 名称映射
    pipeline_sheets = {
        "干线管道": "trunk",
        "支线管道": "branch",
        "trunk_pipelines": "trunk",
        "branch_pipelines": "branch",
        "管线": "general",
        "pipelines": "general"
    }
    
    count = 0
    
    for sheet_name in excel_data.sheet_names:
        # 检查是否是管线 sheet
        category = None
        for key, value in pipeline_sheets.items():
            if key in sheet_name or sheet_name in key:
                category = value
                break
        
        if not category:
            continue
        
        print(f"\n  📄 处理工作表: {sheet_name}")
        
        try:
            df = pd.read_excel(excel_data, sheet_name=sheet_name)
            print(f"    找到 {len(df)} 条记录")
            
            # 清理列名
            df.columns = [c.strip() for c in df.columns]
            
            # 列名映射
            column_map = {
                '管道名称': 'name', '名称': 'name', 'name': 'name',
                '管径': 'diameter', '管径(mm)': 'diameter', 'diameter': 'diameter',
                '长度': 'length', '长度(km)': 'length', 'length': 'length',
                '起点': 'start', '起点站场': 'start', 'start_station': 'start',
                '终点': 'end', '终点站场': 'end', 'end_station': 'end',
                '类别': 'category', 'category': 'category'
            }
            
            df.rename(columns=column_map, inplace=True)
            
            # 导入数据
            for idx, row in df.iterrows():
                try:
                    # 跳过空行
                    if pd.isna(row.get('name')):
                        continue
                    
                    pipeline_id = f"{category}-{count+1:03d}"
                    
                    # 起点终点(先用占位符,后续从拓扑关系更新)
                    start_id = str(row.get('start', f'unknown-start-{count}'))
                    end_id = str(row.get('end', f'unknown-end-{count}'))
                    
                    pipeline = Pipeline(
                        id=pipeline_id,
                        name=str(row['name']),
                        start_station_id=start_id,
                        end_station_id=end_id,
                        diameter=int(row.get('diameter', 813)),
                        length=float(row.get('length', 0)),
                        category=str(row.get('category', category))
                    )
                    
                    session.add(pipeline)
                    count += 1
                    
                except Exception as e:
                    print(f"      ⚠️  行 {idx+2} 导入失败: {e}")
                    continue
        
        except Exception as e:
            print(f"    ❌ 工作表处理失败: {e}")
            continue
    
    session.commit()
    print(f"\n  ✅ 成功导入 {count} 条管线")
    return count


def process_topology_from_sheet(excel_data, session):
    """处理拓扑关系 sheet"""
    print("\n🔀 步骤 3: 处理拓扑关系...")
    
    # 查找拓扑关系 sheet
    topology_sheets = ["拓扑关系", "管道站场关系", "管道站场阀室关系", "topology", "relations"]
    
    sheet_name = None
    for name in excel_data.sheet_names:
        for key in topology_sheets:
            if key in name or name in key:
                sheet_name = name
                break
        if sheet_name:
            break
    
    if not sheet_name:
        print("  ⚠️  未找到拓扑关系工作表,跳过")
        return 0
    
    try:
        df = pd.read_excel(excel_data, sheet_name=sheet_name)
        print(f"  📄 处理工作表: {sheet_name} ({len(df)} 条记录)")
        
        # 显示列名供调试
        print(f"  💡 列名: {list(df.columns)}")
        
        # TODO: 根据实际列名实现拓扑关系映射
        # 这里需要根据你的实际数据结构调整
        
        return len(df)
        
    except Exception as e:
        print(f"  ❌ 处理失败: {e}")
        return 0


def show_excel_structure(excel_file: str):
    """显示 Excel 文件结构"""
    print("=" * 60)
    print("📋 Excel 文件结构分析")
    print("=" * 60)
    
    try:
        excel_data = pd.ExcelFile(excel_file)
        print(f"\n📂 文件: {excel_file}")
        print(f"📊 工作表数量: {len(excel_data.sheet_names)}\n")
        
        for sheet_name in excel_data.sheet_names:
            print(f"{'=' * 60}")
            print(f"📄 工作表: {sheet_name}")
            print(f"{'=' * 60}")
            
            try:
                df = pd.read_excel(excel_data, sheet_name=sheet_name, nrows=3)
                print(f"  行数: {len(df)}")
                print(f"  列名: {list(df.columns)}")
                print(f"\n  示例数据:")
                print(df.head(3).to_string(index=False))
                print()
            except Exception as e:
                print(f"  ❌ 读取失败: {e}\n")
    
    except Exception as e:
        print(f"❌ 文件读取失败: {e}")


def export_multi_sheet_template(output_file: str = "多Sheet导入模板.xlsx"):
    """导出多 Sheet 模板"""
    print(f"📝 正在生成多 Sheet Excel 模板: {output_file}")
    
    # 站场数据
    stations_data = {
        "分输口": pd.DataFrame({
            '名称': ['北京分输口', '天津分输口'],
            '经度': [116.40, 117.20],
            '纬度': [39.90, 39.13],
            '设计压力(MPa)': [6.0, 6.0]
        }),
        "压缩机": pd.DataFrame({
            '名称': ['石家庄压缩机站', '保定压缩机站'],
            '经度': [114.48, 115.48],
            '纬度': [38.03, 38.87],
            '设计压力(MPa)': [8.5, 8.5]
        }),
        "储气库": pd.DataFrame({
            '名称': ['示例储气库'],
            '经度': [116.00],
            '纬度': [39.50],
            '设计压力(MPa)': [10.0]
        })
    }
    
    # 管线数据
    pipelines_data = {
        "干线管道": pd.DataFrame({
            '管道名称': ['京津干线', '津石干线'],
            '起点': ['北京分输口', '天津分输口'],
            '终点': ['天津分输口', '石家庄压缩机站'],
            '管径(mm)': [1016, 813],
            '长度(km)': [120.0, 280.0],
            '类别': ['干线', '干线']
        }),
        "支线管道": pd.DataFrame({
            '管道名称': ['石保支线'],
            '起点': ['石家庄压缩机站'],
            '终点': ['保定压缩机站'],
            '管径(mm)': [660],
            '长度(km)': [95.0],
            '类别': ['支线']
        })
    }
    
    # 写入 Excel
    with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
        # 写入站场 sheets
        for sheet_name, df in stations_data.items():
            df.to_excel(writer, sheet_name=sheet_name, index=False)
        
        # 写入管线 sheets
        for sheet_name, df in pipelines_data.items():
            df.to_excel(writer, sheet_name=sheet_name, index=False)
    
    print(f"✅ 模板文件已生成: {output_file}")
    print("\n💡 使用说明:")
    print("  1. 打开模板文件")
    print("  2. 在各个工作表中填写数据")
    print("  3. 保存文件")
    print("  4. 运行导入命令:")
    print(f"     python scripts/import_multi_sheet.py --file {output_file}")


def show_usage():
    """显示使用说明"""
    print("""
╔══════════════════════════════════════════════════════════════╗
║          SmartGas Grid - 多 Sheet Excel 导入工具             ║
╚══════════════════════════════════════════════════════════════╝

使用方法:

1️⃣  生成模板
   python scripts/import_multi_sheet.py --export-template

2️⃣  查看 Excel 结构
   python scripts/import_multi_sheet.py --show-structure --file your.xlsx

3️⃣  导入数据
   python scripts/import_multi_sheet.py --file your.xlsx

4️⃣  清空并导入
   python scripts/import_multi_sheet.py --file your.xlsx --clear

支持的工作表名称:
  站场/设施:
    - "分输口" / "delivery_points"
    - "储气库" / "gas_storage"
    - "压缩机" / "compressors"
  
  管线:
    - "干线管道" / "trunk_pipelines"
    - "支线管道" / "branch_pipelines"
  
  关系:
    - "拓扑关系" / "topology"

示例:
  # 生成模板
  python scripts/import_multi_sheet.py --export-template
  
  # 查看结构
  python scripts/import_multi_sheet.py --show-structure --file 数据.xlsx
  
  # 导入数据
  python scripts/import_multi_sheet.py --file 数据.xlsx --clear
""")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='多 Sheet Excel 导入工具')
    parser.add_argument('--export-template', action='store_true', help='导出模板')
    parser.add_argument('--show-structure', action='store_true', help='显示 Excel 结构')
    parser.add_argument('--file', type=str, help='Excel 文件路径')
    parser.add_argument('--clear', action='store_true', help='清空现有数据')
    
    args = parser.parse_args()
    
    if len(sys.argv) == 1:
        show_usage()
        sys.exit(0)
    
    if args.export_template:
        export_multi_sheet_template()
        sys.exit(0)
    
    if args.show_structure:
        if args.file:
            show_excel_structure(args.file)
        else:
            print("❌ 请指定文件路径 (--file)")
        sys.exit(0)
    
    if args.file:
        import_from_multi_sheet_excel(args.file, clear_existing=args.clear)
    else:
        print("❌ 请指定文件路径 (--file)")
        show_usage()
