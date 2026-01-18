
import pandas as pd
import re
import sys
import os
from pathlib import Path
from sqlmodel import Session, select, text

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import engine, create_db_and_tables
from app.models import Station, Pipeline

def clean_name(name):
    """Clean station names by removing special characters and newlines"""
    if pd.isna(name):
        return None
    name = str(name).strip()
    name = name.replace('\n', '')
    # Remove symbols ● ★ ▲
    name = re.sub(r'[●★▲]', '', name)
    return name

def import_data(file_path):
    print(f"🚀 Starting import for {file_path}")
    create_db_and_tables()
    
    with Session(engine) as session:
        # Clear existing
        print("🗑️ Clearing existing data...")
        session.exec(text("DELETE FROM pipelines"))
        session.exec(text("DELETE FROM stations"))
        session.commit()
        
        station_names = set()
        
        # 1. Import Compressors (压缩机)
        try:
            df = pd.read_excel(file_path, sheet_name='压缩机')
            count = 0
            for _, row in df.iterrows():
                # Column: [原始]站场
                # Find column starting with [原始]站场
                col = next((c for c in df.columns if '[原始]站场' in str(c)), None)
                if col:
                    name = clean_name(row[col])
                    if name and name not in station_names:
                        station = Station(
                            id=f"comp-{len(station_names)+1:04d}", 
                            name=name, 
                            type='compressor',
                            longitude=0, latitude=0 # No coords in this sheet?
                        )
                        session.add(station)
                        station_names.add(name)
                        count += 1
            print(f"✅ Imported {count} compressors")
        except Exception as e:
            print(f"⚠️ Failed to import Compressors: {e}")

        # 2. Import Storages (储气库)
        try:
            df = pd.read_excel(file_path, sheet_name='储气库')
            count = 0
            for _, row in df.iterrows():
                # Column: Unnamed: 2 (based on inspection)
                name = clean_name(row.iloc[2]) # Unnamed: 2 is index 2
                if name and name not in station_names:
                    station = Station(
                        id=f"stor-{len(station_names)+1:04d}",
                        name=name,
                        type='source',
                        longitude=0, latitude=0
                    )
                    session.add(station)
                    station_names.add(name)
                    count += 1
            print(f"✅ Imported {count} storages")
        except Exception as e:
            print(f"⚠️ Failed to import Storages: {e}")

        # 3. Import Distribution (分输口)
        try:
            df = pd.read_excel(file_path, sheet_name='分输口')
            count = 0
            for _, row in df.iterrows():
                # Column: [原始]\n分输口 -> contains '分输口'
                col = next((c for c in df.columns if '分输口' in str(c) and '原始' in str(c)), None)
                if col:
                    name = clean_name(row[col])
                    if name and name not in station_names:
                        station = Station(
                            id=f"dist-{len(station_names)+1:04d}",
                            name=name,
                            type='distribution',
                            longitude=0, latitude=0
                        )
                        session.add(station)
                        station_names.add(name)
                        count += 1
            print(f"✅ Imported {count} distribution points")
        except Exception as e:
            print(f"⚠️ Failed to import Distribution: {e}")
            
        session.commit()
        
        # Build Name -> ID map
        name_to_id = {s.name: s.id for s in session.exec(select(Station)).all()}
        
        # 4. Import Branch Lines (支线管道)
        try:
            df = pd.read_excel(file_path, sheet_name='支线管道')
            count = 0
            # Cols: [原始]支线管道, [原始]起点, [原始]终点, [计算]长度/km, [原始]管径/mm
            col_name = next((c for c in df.columns if '支线管道' in str(c) and '原始' in str(c)), None)
            col_start = next((c for c in df.columns if '起点' in str(c) and '原始' in str(c)), None)
            col_end = next((c for c in df.columns if '终点' in str(c) and '原始' in str(c)), None)
            col_len = next((c for c in df.columns if '长度' in str(c)), None)
            col_dia = next((c for c in df.columns if '管径' in str(c)), None)

            for _, row in df.iterrows():
                name = clean_name(row[col_name]) if col_name else f"branch-{count}"
                start = clean_name(row[col_start]) if col_start else None
                end = clean_name(row[col_end]) if col_end else None
                
                # Auto-create stations if missing?
                start_id = name_to_id.get(start, start)
                end_id = name_to_id.get(end, end)
                
                # If IDs are names (not in map), creates placeholders?
                # For now, if missing, we just use the name as ID (foreign key issue? SQLite assumes text)
                
                pipeline = Pipeline(
                    id=f"branch-{count+1:04d}",
                    name=name,
                    start_station_id=start_id or 'unknown',
                    end_station_id=end_id or 'unknown',
                    length=float(row[col_len]) if col_len and pd.notna(row[col_len]) else 0,
                    diameter=int(row[col_dia]) if col_dia and pd.notna(row[col_dia]) and str(row[col_dia]).isdigit() else 0,
                    category='branch'
                )
                session.add(pipeline)
                count += 1
            print(f"✅ Imported {count} branch lines")
        except Exception as e:
            print(f"⚠️ Failed to import Branch Lines: {e}")

        # 5. Import Trunk Topology (管道站场阀室关系)
        try:
            df = pd.read_excel(file_path, sheet_name='管道站场阀室关系')
            count = 0
            # Group by Pipeline
            col_pipe = next((c for c in df.columns if '支线管道' in str(c) and '关联' in str(c)), None) # [关联]支线管道
            col_node = next((c for c in df.columns if '站场阀室' in str(c) and '计算' in str(c)), None) # [计算]站场阀室
            col_mile = next((c for c in df.columns if '里程' in str(c)), None)
            
            if col_pipe and col_node:
                # Iterate rows
                prev_pipe = None
                prev_node = None
                prev_mile = 0
                
                for _, row in df.iterrows():
                    curr_pipe = clean_name(row[col_pipe])
                    curr_node_name = clean_name(row[col_node])
                    curr_mile = float(row[col_mile]) if col_mile and pd.notna(row[col_mile]) else 0
                    
                    if pd.isna(curr_pipe) or pd.isna(curr_node_name):
                        continue
                        
                    # Create station if missing (Valves, Junctions in trunk)
                    if curr_node_name not in name_to_id:
                         # Infer type: Valve or Junction
                         st_type = 'distribution' # Default
                         if '阀室' in curr_node_name: st_type = 'valve' # Logic? Station model type is limited
                         
                         station = Station(
                            id=f"trunk-node-{len(name_to_id)+1:05d}",
                            name=curr_node_name,
                            type=st_type,
                            longitude=0, latitude=0
                         )
                         session.add(station)
                         name_to_id[curr_node_name] = station.id
                    
                    curr_node_id = name_to_id[curr_node_name]
                    
                    # Create segment if same pipeline
                    if curr_pipe == prev_pipe and prev_node:
                        length = abs(curr_mile - prev_mile)
                        if length > 0.001: # Skip zero length
                            pipeline = Pipeline(
                                id=f"trunk-{count+1:05d}",
                                name=f"{curr_pipe}-{count}", # Unique name
                                start_station_id=prev_node,
                                end_station_id=curr_node_id,
                                length=length,
                                diameter=1016, # Default trunk diameter
                                category='trunk'
                            )
                            session.add(pipeline)
                            count += 1
                            
                    prev_pipe = curr_pipe
                    prev_node = curr_node_id
                    prev_mile = curr_mile
                    
            print(f"✅ Imported {count} trunk segments")
        except Exception as e:
            print(f"⚠️ Failed to import Trunk Topology: {e}")
            import traceback
            traceback.print_exc()

        session.commit()
        print("🎉 Import finished!")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("file", help="Path to Excel file")
    args = parser.parse_args()
    
    if os.path.exists(args.file):
        import_data(args.file)
    else:
        print(f"❌ File not found: {args.file}")
