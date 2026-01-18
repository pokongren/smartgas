"""
批量导入多个 CSV 文件到数据库
支持合并干线/支线管道,整合多种设施节点
"""
import sys
from pathlib import Path
import pandas as pd
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session
from app.database import engine, create_db_and_tables
from app.models import Station, Pipeline


# 配置部分
DB_PATH = Path(__file__).parent.parent / "data" / "smartgas.db"
CSV_DIR = Path(__file__).parent.parent / "data" / "raw_csvs"


def import_all_tables(clear_existing: bool = False):
    """
    批量导入所有 CSV 文件
    
    参数:
        clear_existing: 是否清空现有数据
    """
    print("=" * 60)
    print("🚀 批量导入 CSV 数据")
    print("=" * 60)
    
    # 创建表
    create_db_and_tables()
    
    with Session(engine) as session:
        # 清空现有数据
        if clear_existing:
            print("\n🗑️  清空现有数据...")
            session.query(Pipeline).delete()
            session.query(Station).delete()
            session.commit()
        
        # 1. 导入站场/设施节点
        stations_count = import_stations(session)
        
        # 2. 导入管线(干线+支线)
        pipelines_count = import_pipelines(session)
        
        # 3. 处理拓扑关系
        topology_count = import_topology_relations(session)
    
    print("\n" + "=" * 60)
    print("✅ 批量导入完成!")
    print("=" * 60)
    print(f"  - 站场/设施: {stations_count} 个")
    print(f"  - 管线: {pipelines_count} 条")
    print(f"  - 拓扑关系: {topology_count} 条")


def import_stations(session):
    """导入站场和设施节点"""
    print("\n📍 步骤 1: 导入站场和设施节点...")
    
    # 设施文件配置
    facility_files = {
        "分输口.csv": {
            "type": "distribution",
            "name_col": "分输口名称",
            "lon_col": "经度",
            "lat_col": "纬度",
            "pressure_col": "设计压力(MPa)"
        },
        "储气库.csv": {
            "type": "source",
            "name_col": "储气库名称",
            "lon_col": "经度",
            "lat_col": "纬度",
            "pressure_col": "设计压力(MPa)"
        },
        "压缩机.csv": {
            "type": "compressor",
            "name_col": "压缩机站名称",
            "lon_col": "经度",
            "lat_col": "纬度",
            "pressure_col": "设计压力(MPa)"
        }
    }
    
    count = 0
    station_id_map = {}  # 名称 -> ID 映射
    
    for filename, config in facility_files.items():
        file_path = CSV_DIR / filename
        
        if not file_path.exists():
            print(f"  ⚠️  文件不存在: {filename}")
            continue
        
        try:
            # 读取 CSV (尝试 UTF-8 和 GBK)
            try:
                df = pd.read_csv(file_path, encoding='utf-8')
            except UnicodeDecodeError:
                df = pd.read_csv(file_path, encoding='gbk')
            
            print(f"  📂 处理文件: {filename} ({len(df)} 条记录)")
            
            # 清理列名
            df.columns = [c.strip() for c in df.columns]
            
            # 导入每一行
            for idx, row in df.iterrows():
                try:
                    # 生成 ID
                    station_id = f"{config['type']}-{count+1:03d}"
                    
                    # 获取名称
                    name = str(row.get(config['name_col'], f"未命名{count+1}"))
                    
                    # 获取坐标
                    longitude = float(row.get(config['lon_col'], 0))
                    latitude = float(row.get(config['lat_col'], 0))
                    
                    # 获取压力
                    pressure = float(row.get(config['pressure_col'], 6.0))
                    
                    # 创建站场对象
                    station = Station(
                        id=station_id,
                        name=name,
                        type=config['type'],
                        longitude=longitude,
                        latitude=latitude,
                        design_pressure=pressure
                    )
                    
                    session.add(station)
                    station_id_map[name] = station_id
                    count += 1
                    
                except Exception as e:
                    print(f"    ⚠️  行 {idx+1} 导入失败: {e}")
                    continue
            
        except Exception as e:
            print(f"  ❌ 文件读取失败: {filename} - {e}")
            continue
    
    session.commit()
    print(f"  ✅ 成功导入 {count} 个站场/设施")
    
    # 保存映射关系供后续使用
    session.info['station_id_map'] = station_id_map
    
    return count


def import_pipelines(session):
    """导入管线(合并干线和支线)"""
    print("\n🔗 步骤 2: 导入管线数据...")
    
    pipeline_files = {
        "干线管道.csv": "trunk",
        "支线管道.csv": "branch"
    }
    
    count = 0
    
    for filename, category in pipeline_files.items():
        file_path = CSV_DIR / filename
        
        if not file_path.exists():
            print(f"  ⚠️  文件不存在: {filename}")
            continue
        
        try:
            # 读取 CSV
            try:
                df = pd.read_csv(file_path, encoding='utf-8')
            except UnicodeDecodeError:
                df = pd.read_csv(file_path, encoding='gbk')
            
            print(f"  📂 处理文件: {filename} ({len(df)} 条记录)")
            
            # 清理列名
            df.columns = [c.strip() for c in df.columns]
            
            # 列名映射
            column_mapping = {
                '管道名称': 'name',
                '管径(mm)': 'diameter',
                '长度(km)': 'length',
                '起点': 'start_station',
                '终点': 'end_station',
                '设计压力(MPa)': 'pressure'
            }
            
            df.rename(columns=column_mapping, inplace=True)
            
            # 导入每一行
            for idx, row in df.iterrows():
                try:
                    pipeline_id = f"{category}-{count+1:03d}"
                    
                    # 基本信息
                    name = str(row.get('name', f"未命名管线{count+1}"))
                    diameter = int(row.get('diameter', 813))
                    length = float(row.get('length', 0))
                    
                    # 起点终点(需要从拓扑关系表获取,这里先用占位符)
                    start_station_id = row.get('start_station', 'unknown-start')
                    end_station_id = row.get('end_station', 'unknown-end')
                    
                    pipeline = Pipeline(
                        id=pipeline_id,
                        name=name,
                        start_station_id=str(start_station_id),
                        end_station_id=str(end_station_id),
                        diameter=diameter,
                        length=length,
                        category=category
                    )
                    
                    session.add(pipeline)
                    count += 1
                    
                except Exception as e:
                    print(f"    ⚠️  行 {idx+1} 导入失败: {e}")
                    continue
        
        except Exception as e:
            print(f"  ❌ 文件读取失败: {filename} - {e}")
            continue
    
    session.commit()
    print(f"  ✅ 成功导入 {count} 条管线")
    
    return count


def import_topology_relations(session):
    """处理拓扑关系表"""
    print("\n🔀 步骤 3: 处理拓扑关系...")
    
    rel_file = CSV_DIR / "管道站场阀室关系.csv"
    
    if not rel_file.exists():
        print(f"  ⚠️  拓扑关系文件不存在,跳过")
        return 0
    
    try:
        # 读取关系表
        try:
            df = pd.read_csv(rel_file, encoding='utf-8')
        except UnicodeDecodeError:
            df = pd.read_csv(rel_file, encoding='gbk')
        
        print(f"  📂 处理拓扑关系表 ({len(df)} 条记录)")
        
        # 清理列名
        df.columns = [c.strip() for c in df.columns]
        
        # 根据关系表更新管线的起点终点
        # 这里需要根据实际的表结构调整
        print(f"  💡 提示: 拓扑关系表列名: {list(df.columns)}")
        
        # TODO: 根据实际表结构实现关系映射
        
        return len(df)
        
    except Exception as e:
        print(f"  ❌ 处理失败: {e}")
        return 0


def show_csv_structure():
    """显示 CSV 文件结构,帮助调试"""
    print("=" * 60)
    print("📋 CSV 文件结构分析")
    print("=" * 60)
    
    if not CSV_DIR.exists():
        print(f"❌ 目录不存在: {CSV_DIR}")
        return
    
    csv_files = list(CSV_DIR.glob("*.csv"))
    
    if not csv_files:
        print(f"⚠️  目录下没有 CSV 文件: {CSV_DIR}")
        return
    
    for csv_file in csv_files:
        print(f"\n📄 {csv_file.name}")
        try:
            # 尝试读取
            try:
                df = pd.read_csv(csv_file, encoding='utf-8', nrows=2)
            except UnicodeDecodeError:
                df = pd.read_csv(csv_file, encoding='gbk', nrows=2)
            
            print(f"  列名: {list(df.columns)}")
            print(f"  行数: {len(df)}")
            print(f"  示例数据:")
            print(df.head(2).to_string(index=False))
            
        except Exception as e:
            print(f"  ❌ 读取失败: {e}")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='批量导入 CSV 数据')
    parser.add_argument('--clear', action='store_true', help='清空现有数据')
    parser.add_argument('--show-structure', action='store_true', help='显示 CSV 文件结构')
    
    args = parser.parse_args()
    
    if args.show_structure:
        show_csv_structure()
    else:
        import_all_tables(clear_existing=args.clear)
