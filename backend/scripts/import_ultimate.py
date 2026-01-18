"""
终极 Excel 导入方案
结合简洁性和数据模型兼容性
支持多 Sheet Excel,自动映射到正确的数据库表
"""
import pandas as pd
import sqlite3
import argparse
import os
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session
from app.database import engine, create_db_and_tables
from app.models import Station, Pipeline

# 配置路径
DB_PATH = Path(__file__).parent.parent / "data" / "smartgas.db"

# Sheet 名称到设施类型的映射
FACILITY_TYPE_MAPPING = {
    "分输口": "distribution",
    "压缩机": "compressor",
    "压缩机站": "compressor",
    "储气库": "source",
    "气源站": "source",
    "delivery_points": "distribution",
    "compressors": "compressor",
    "gas_storage": "source",
    "gas_storages": "source"
}

# Sheet 名称到管线类别的映射
PIPELINE_CATEGORY_MAPPING = {
    "干线管道": "trunk",
    "支线管道": "branch",
    "trunk_pipelines": "trunk",
    "branch_pipelines": "branch",
    "管线": "general",
    "pipelines": "general"
}


def run_import(file_path: str, clear_db: bool = False):
    """
    从 Excel 导入数据
    
    参数:
        file_path: Excel 文件路径
        clear_db: 是否清空现有数据
    """
    if not os.path.exists(file_path):
        print(f"❌ 错误: 找不到文件 {file_path}")
        return
    
    print("=" * 60)
    print("🚀 SmartGas 多 Sheet Excel 导入工具")
    print("=" * 60)
    print(f"\n📂 正在解析 Excel: {file_path}")
    
    # 读取 Excel
    try:
        excel_data = pd.ExcelFile(file_path)
        print(f"  ✅ 找到 {len(excel_data.sheet_names)} 个工作表")
        print(f"  📋 工作表列表: {', '.join(excel_data.sheet_names)}\n")
    except Exception as e:
        print(f"❌ 读取失败: {e}")
        return
    
    # 创建数据库表
    create_db_and_tables()
    
    with Session(engine) as session:
        # 清空现有数据
        if clear_db:
            print("🗑️  清空现有数据...")
            session.query(Pipeline).delete()
            session.query(Station).delete()
            session.commit()
            print("  ✅ 已清空\n")
        
        # 统计
        stations_count = 0
        pipelines_count = 0
        station_name_to_id = {}  # 站场名称到ID的映射
        
        # 第一遍:只导入站场,建立名称映射
        print("📍 第一阶段: 导入站场数据\n")
        for sheet_name in excel_data.sheet_names:
            if sheet_name in FACILITY_TYPE_MAPPING:
                print(f"{'=' * 60}")
                print(f"📄 处理工作表: {sheet_name}")
                print(f"{'=' * 60}")
                
                try:
                    df = pd.read_excel(excel_data, sheet_name=sheet_name)
                    df.columns = [str(c).strip() for c in df.columns]
                    
                    print(f"  📊 数据行数: {len(df)}")
                    
                    count, name_map = import_as_stations(df, sheet_name, session)
                    stations_count += count
                    station_name_to_id.update(name_map)
                    print(f"  ✅ 导入 {count} 个站场\n")
                    
                except Exception as e:
                    print(f"  ❌ 处理失败: {e}\n")
                    continue
        
        session.commit()
        
        # 第二遍:导入管线,使用站场名称映射
        print("\n🔗 第二阶段: 导入管线数据\n")
        for sheet_name in excel_data.sheet_names:
            if sheet_name in PIPELINE_CATEGORY_MAPPING:
                print(f"{'=' * 60}")
                print(f"📄 处理工作表: {sheet_name}")
                print(f"{'=' * 60}")
                
                try:
                    df = pd.read_excel(excel_data, sheet_name=sheet_name)
                    df.columns = [str(c).strip() for c in df.columns]
                    
                    print(f"  📊 数据行数: {len(df)}")
                    
                    # 导入为管线,传入站场名称映射
                    count = import_as_pipelines(df, sheet_name, session, station_name_to_id)
                    pipelines_count += count
                    print(f"  ✅ 导入 {count} 条管线\n")
                    
                except Exception as e:
                    print(f"  ❌ 处理失败: {e}\n")
                    continue

        
        session.commit()
    
    print("=" * 60)
    print("🎉 导入任务全部完成!")
    print("=" * 60)
    print(f"  - 站场/设施: {stations_count} 个")
    print(f"  - 管线: {pipelines_count} 条")
    print()


def import_as_stations(df: pd.DataFrame, sheet_name: str, session):
    """将数据导入为站场,返回 (数量, 名称到ID映射)"""
    facility_type = FACILITY_TYPE_MAPPING[sheet_name]
    
    # 列名映射
    column_map = {
        '名称': 'name', 'name': 'name', '站场名称': 'name',
        '分输口名称': 'name', '储气库名称': 'name', '压缩机站名称': 'name',
        '经度': 'longitude', 'longitude': 'longitude', 'lon': 'longitude',
        '纬度': 'latitude', 'latitude': 'latitude', 'lat': 'latitude',
        '设计压力': 'pressure', '设计压力(MPa)': 'pressure',
        'design_pressure': 'pressure', 'pressure': 'pressure'
    }
    
    df.rename(columns=column_map, inplace=True)
    
    count = 0
    name_to_id = {}
    
    for idx, row in df.iterrows():
        try:
            # 跳过空行
            if pd.isna(row.get('name')):
                continue
            
            # 生成 ID
            station_id = f"{facility_type}-{idx+1:03d}"
            station_name = str(row['name'])
            
            # 创建站场对象
            station = Station(
                id=station_id,
                name=station_name,
                type=facility_type,
                longitude=float(row.get('longitude', 0)),
                latitude=float(row.get('latitude', 0)),
                design_pressure=float(row.get('pressure', 6.0))
            )
            
            session.add(station)
            name_to_id[station_name] = station_id
            count += 1
            
        except Exception as e:
            print(f"    ⚠️  行 {idx+2} 失败: {e}")
            continue
    
    return count, name_to_id


def import_as_pipelines(df: pd.DataFrame, sheet_name: str, session, name_to_id: dict) -> int:
    """将数据导入为管线,使用站场名称到ID的映射"""
    category = PIPELINE_CATEGORY_MAPPING[sheet_name]
    
    # 列名映射
    column_map = {
        '管道名称': 'name', '名称': 'name', 'name': 'name',
        '管径': 'diameter', '管径(mm)': 'diameter', 'diameter': 'diameter',
        '长度': 'length', '长度(km)': 'length', 'length': 'length',
        '起点': 'start', '起点站场': 'start', 'start_station': 'start',
        '终点': 'end', '终点站场': 'end', 'end_station': 'end'
    }
    
    df.rename(columns=column_map, inplace=True)
    
    count = 0
    for idx, row in df.iterrows():
        try:
            # 跳过空行
            if pd.isna(row.get('name')):
                continue
            
            # 生成 ID
            pipeline_id = f"{category}-{idx+1:03d}"
            
            # 起点终点:先尝试从名称映射获取ID,否则直接使用原值
            start_name = str(row.get('start', ''))
            end_name = str(row.get('end', ''))
            
            start_id = name_to_id.get(start_name, start_name)
            end_id = name_to_id.get(end_name, end_name)
            
            # 创建管线对象
            pipeline = Pipeline(
                id=pipeline_id,
                name=str(row['name']),
                start_station_id=start_id,
                end_station_id=end_id,
                diameter=int(row.get('diameter', 813)),
                length=float(row.get('length', 0)),
                category=category
            )
            
            session.add(pipeline)
            count += 1
            
        except Exception as e:
            print(f"    ⚠️  行 {idx+2} 失败: {e}")
            continue
    
    return count


def show_structure(file_path: str):
    """显示 Excel 文件结构"""
    print("=" * 60)
    print("📋 Excel 文件结构分析")
    print("=" * 60)
    
    try:
        excel_data = pd.ExcelFile(file_path)
        print(f"\n📂 文件: {file_path}")
        print(f"📊 工作表数量: {len(excel_data.sheet_names)}\n")
        
        for sheet_name in excel_data.sheet_names:
            print(f"{'=' * 60}")
            print(f"📄 工作表: {sheet_name}")
            
            # 判断类型
            if sheet_name in FACILITY_TYPE_MAPPING:
                print(f"  🏷️  类型: 站场/设施 ({FACILITY_TYPE_MAPPING[sheet_name]})")
            elif sheet_name in PIPELINE_CATEGORY_MAPPING:
                print(f"  🏷️  类型: 管线 ({PIPELINE_CATEGORY_MAPPING[sheet_name]})")
            else:
                print(f"  🏷️  类型: 未识别")
            
            print(f"{'=' * 60}")
            
            try:
                df = pd.read_excel(excel_data, sheet_name=sheet_name, nrows=3)
                df.columns = [str(c).strip() for c in df.columns]
                
                print(f"  📊 数据行数: {len(df)}")
                print(f"  📋 列名: {list(df.columns)}")
                print(f"\n  示例数据:")
                print(df.head(3).to_string(index=False))
                print()
            except Exception as e:
                print(f"  ❌ 读取失败: {e}\n")
    
    except Exception as e:
        print(f"❌ 文件读取失败: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SmartGas 多Sheet Excel 导入工具")
    parser.add_argument("--file", type=str, help="Excel文件路径")
    parser.add_argument("--clear", action="store_true", help="导入前清空现有数据")
    parser.add_argument("--show-structure", action="store_true", help="显示Excel结构")
    
    args = parser.parse_args()
    
    if args.show_structure:
        if args.file:
            show_structure(args.file)
        else:
            print("❌ 请指定文件路径 (--file)")
    elif args.file:
        # 确保数据库目录存在
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        run_import(args.file, args.clear)
    else:
        print("❌ 请指定文件路径 (--file)")
        print("\n使用方法:")
        print("  python scripts/import_ultimate.py --file your.xlsx --clear")
        print("  python scripts/import_ultimate.py --show-structure --file your.xlsx")
