import pandas as pd
import sys
import os
from pathlib import Path
from sqlmodel import Session, select, text
import json
import numpy as np

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import engine, create_db_and_tables
from app.models import (
    Station, Pipeline, 
    TrunkPipelineDetail, BranchPipelineDetail, NodeRelationDetail,
    DistributionPointDetail, CompressorDetail, StorageDetail, DispatchConsoleDetail
)

FILE_PATH = "data/raw_csvs/数据库20251031.xlsx"

def clean_val(val):
    if pd.isna(val): return None
    # Handle numpy types
    if hasattr(val, 'item'): val = val.item()
    if isinstance(val, (int, float)):
        if pd.isna(val): return None
        return val
    return str(val).strip().replace('\n', ' ')

def clean_num(val):
    """Convert to float or None, handles NaN"""
    try:
        if pd.isna(val): return None
        v = float(val)
        if not np.isfinite(v): return None
        return v
    except (ValueError, TypeError):
        return None

def get_col(df, keyword):
    """Find a column that matches the keyword (case-insensitive, ignoring spacing/newlines)"""
    target = keyword.lower().strip().replace(' ', '').replace('\n', '')
    for col in df.columns:
        c_clean = str(col).lower().strip().replace(' ', '').replace('\n', '')
        if target in c_clean:
            return col
    return None

def import_all():
    print(f"🚀 Starting Full Excel Import: {FILE_PATH}")
    
    # 1. Initialize tables (Drop and recreate to ensure schema match)
    from sqlmodel import SQLModel
    print("🧹 Dropping existing tables to refresh schema...")
    SQLModel.metadata.drop_all(engine)
    create_db_and_tables()
    
    with Session(engine) as session:
        # Clear all
        print("🗑️ Clearing all tables (just in case)...")
        tables = [
            "stations", "pipelines", 
            "trunk_pipeline_details", "branch_pipeline_details", "node_relation_details",
            "distribution_point_details", "compressor_details", "storage_details", "dispatch_console_details"
        ]
        for t in tables:
            session.exec(text(f"DELETE FROM {t}"))
        session.commit()

        xl = pd.ExcelFile(FILE_PATH)
        
        # ---------------------------------------------------------
        # 2. Import Dispatch Consoles (调度台)
        # ---------------------------------------------------------
        if '调度台' in xl.sheet_names:
            df = pd.read_excel(xl, '调度台')
            col_name = get_col(df, '[原始]调度台')
            count = 0
            for _, row in df.iterrows():
                name = clean_val(row.get(col_name))
                if name:
                    console = DispatchConsoleDetail(name=name)
                    session.add(console)
                    count += 1
            print(f"✅ Imported {count} dispatch consoles")

        # ---------------------------------------------------------
        # 3. Import Storages (储气库)
        # ---------------------------------------------------------
        if '储气库' in xl.sheet_names:
            df = pd.read_excel(xl, '储气库')
            c_name = get_col(df, '[原始]名称')
            c_type = get_col(df, '[原始]类型')
            c_date = get_col(df, '[原始]投产时间')
            c_cap = get_col(df, '工作气量')
            c_ext = get_col(df, '最大采气能力')
            c_inj = get_col(df, '最大注气能力')
            c_corp = get_col(df, '所属企业')
            
            count = 0
            for _, row in df.iterrows():
                name = clean_val(row.get(c_name))
                if name:
                    storage = StorageDetail(
                        name=name,
                        storage_type=clean_val(row.get(c_type)),
                        commission_date=clean_val(row.get(c_date)),
                        working_capacity=clean_num(row.get(c_cap)),
                        daily_extract_max=clean_num(row.get(c_ext)),
                        daily_inject_max=clean_num(row.get(c_inj)),
                        company=clean_val(row.get(c_corp))
                    )
                    session.add(storage)
                    session.add(Station(id=f"STOR-{count+1:03d}", name=name, type='source'))
                    count += 1
            print(f"✅ Imported {count} storages")

        # ---------------------------------------------------------
        # 4. Import Compressors (压缩机)
        # ---------------------------------------------------------
        if '压缩机' in xl.sheet_names:
            df = pd.read_excel(xl, '压缩机')
            c_sname = get_col(df, '[关联]站场')
            c_tname = get_col(df, '[计算]干线管道')
            c_bname = get_col(df, '[计算]支线管道')
            c_config = get_col(df, '[原始]机组配置')
            c_uuid = get_col(df, '机组编号')
            c_drive = get_col(df, '驱动方式')
            c_maker = get_col(df, '压缩机厂商')
            c_model = get_col(df, '压缩机型号')
            c_power = get_col(df, '额定功率')
            c_state = get_col(df, '机组投产情况')
            
            count = 0
            for _, row in df.iterrows():
                s_name = clean_val(row.get(c_sname))
                if s_name:
                    comp = CompressorDetail(
                        station_name=s_name,
                        trunk_name=clean_val(row.get(c_tname)),
                        branch_name=clean_val(row.get(c_bname)),
                        unit_config=clean_val(row.get(c_config)),
                        unit_id=clean_val(row.get(c_uuid)),
                        drive_type=clean_val(row.get(c_drive)),
                        manufacturer=clean_val(row.get(c_maker)),
                        model=clean_val(row.get(c_model)),
                        power=clean_num(row.get(c_power)),
                        commission_status=clean_val(row.get(c_state))
                    )
                    session.add(comp)
                    count += 1
            print(f"✅ Imported {count} Compressor units")

        # ---------------------------------------------------------
        # 5. Import Trunk Pipelines (干线管道)
        # ---------------------------------------------------------
        if '干线管道' in xl.sheet_names:
            df = pd.read_excel(xl, '干线管道')
            c_name = get_col(df, '干线管道')
            c_lvl = get_col(df, '调控级别')
            c_len = get_col(df, '长度')
            c_cap = get_col(df, '物理管容')
            c_st = get_col(df, '站场')
            c_vl = get_col(df, '阀室')
            c_cp = get_col(df, '压气站')
            
            count = 0
            for _, row in df.iterrows():
                name = clean_val(row.get(c_name))
                if name:
                    trunk = TrunkPipelineDetail(
                        name=name,
                        control_level=clean_val(row.get(c_lvl)),
                        length=clean_num(row.get(c_len)) or 0.0,
                        capacity=clean_num(row.get(c_cap)),
                        station_count=int(clean_num(row.get(c_st)) or 0),
                        valve_count=int(clean_num(row.get(c_vl)) or 0),
                        compressor_count=int(clean_num(row.get(c_cp)) or 0)
                    )
                    session.add(trunk)
                    count += 1
            print(f"✅ Imported {count} trunk pipeline records")

        # ---------------------------------------------------------
        # 6. Import Branch Pipelines (支线管道)
        # ---------------------------------------------------------
        if '支线管道' in xl.sheet_names:
            df = pd.read_excel(xl, '支线管道')
            c_name = get_col(df, '支线管道')
            c_trunk = get_col(df, '关联]干线管道')
            c_start = get_col(df, '起点')
            c_end = get_col(df, '终点')
            c_len = get_col(df, '长度/km')
            c_dia = get_col(df, '管径/mm')
            c_thick = get_col(df, '主要壁厚')
            c_pres = get_col(df, '设计压力')
            c_flow = get_col(df, '设计输量')
            c_date = get_col(df, '投产时间')
            c_cons = get_col(df, '调度台')
            
            count = 0
            for _, row in df.iterrows():
                name = clean_val(row.get(c_name))
                if name:
                    branch = BranchPipelineDetail(
                        name=name,
                        trunk_link=clean_val(row.get(c_trunk)),
                        start_point=clean_val(row.get(c_start)),
                        end_point=clean_val(row.get(c_end)),
                        length=clean_num(row.get(c_len)) or 0.0,
                        diameter=int(clean_num(row.get(c_dia)) or 0),
                        thickness=clean_num(row.get(c_thick)),
                        design_pressure=clean_num(row.get(c_pres)),
                        design_flow=clean_num(row.get(c_flow)),
                        commission_date=clean_val(row.get(c_date)),
                        dispatch_console=clean_val(row.get(c_cons))
                    )
                    session.add(branch)
                    count += 1
            print(f"✅ Imported {count} branch pipeline records")

        # ---------------------------------------------------------
        # 7. Import Distribution Points (分输口)
        # ---------------------------------------------------------
        if '分输口' in xl.sheet_names:
            df = pd.read_excel(xl, '分输口')
            c_name = get_col(df, '[原始]分输口')
            c_trunk = get_col(df, '关联]干线管道')
            c_node = get_col(df, '站场/阀室/干线开口')
            c_abbr = get_col(df, '站场简称')
            c_cons = get_col(df, '调度台')
            c_meter = get_col(df, '计量设备')
            c_reg = get_col(df, '调压设备')
            c_date = get_col(df, '投产时间')
            
            count = 0
            for _, row in df.iterrows():
                name = clean_val(row.get(c_name))
                if name:
                    dist = DistributionPointDetail(
                        name=name,
                        trunk_name=clean_val(row.get(c_trunk)),
                        node_link=clean_val(row.get(c_node)),
                        station_abbr=clean_val(row.get(c_abbr)),
                        dispatch_console=clean_val(row.get(c_cons)),
                        metering_info=clean_val(row.get(c_meter)),
                        pressure_reg_info=clean_val(row.get(c_reg)),
                        commission_date=clean_val(row.get(c_date))
                    )
                    session.add(dist)
                    session.add(Station(id=f"DIST-{count+1:04d}", name=name, type='distribution'))
                    count += 1
            print(f"✅ Imported {count} distribution points")

        # ---------------------------------------------------------
        # 8. Import Node Relations (管道站场阀室关系)
        # ---------------------------------------------------------
        if '管道站场阀室关系' in xl.sheet_names:
            df = pd.read_excel(xl, '管道站场阀室关系')
            c_node = get_col(df, '[原始]站场阀室')
            c_calc = get_col(df, '[计算]站场阀室')
            c_trunk = get_col(df, '关联]干线管道')
            c_branch = get_col(df, '关联]支线管道')
            c_comp = get_col(df, '区域公司')
            c_area = get_col(df, '作业区')
            c_mile = get_col(df, '里程')
            c_space = get_col(df, '站间距')
            c_elev = get_col(df, '高程')
            c_type = get_col(df, '2025年类型')
            c_loc = get_col(df, '地理位置')
            
            count = 0
            for _, row in df.iterrows():
                node_name = clean_val(row.get(c_node))
                if node_name:
                    relation = NodeRelationDetail(
                        trunk_name=clean_val(row.get(c_trunk)),
                        branch_name=clean_val(row.get(c_branch)),
                        node_name=node_name,
                        node_name_calc=clean_val(row.get(c_calc)),
                        company=clean_val(row.get(c_comp)),
                        work_area=clean_val(row.get(c_area)),
                        mileage=clean_num(row.get(c_mile)) or 0.0,
                        spacing=clean_num(row.get(c_space)) or 0.0,
                        elevation=clean_num(row.get(c_elev)) or 0.0,
                        node_type_2025=clean_val(row.get(c_type)),
                        location_desc=clean_val(row.get(c_loc))
                    )
                    session.add(relation)
                    
                    st_type = 'valve' if '阀室' in node_name else 'distribution'
                    session.add(Station(id=f"NODE-{count+1:05d}", name=node_name, type=st_type))
                    count += 1
            print(f"✅ Imported {count} node relations")

        try:
            session.commit()
            print("🎉 Full Import Completed!")
        except Exception as e:
            print(f"❌ Commit failed: {e}")
            session.rollback()

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", help="Path to Excel file", default=FILE_PATH)
    args = parser.parse_args()
    
    if os.path.exists(args.file):
        import_all()
    else:
        print(f"❌ File not found: {args.file}")
