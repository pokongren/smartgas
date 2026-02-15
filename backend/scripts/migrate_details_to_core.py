import sys
import os
import traceback
import sqlite3

# 获取当前脚本所在目录
script_dir = os.path.dirname(os.path.abspath(__file__))
# 获取项目根目录
project_root = os.path.abspath(os.path.join(script_dir, '../../'))
# 获取 db 路径
db_path = os.path.join(project_root, 'backend/data/smartgas.db')

print(f"DB Path: {db_path}")

def migrate_data():
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    try:
        print("开始数据迁移 (Raw SQL mode)...")
        
        # 0. 清理现有数据
        print("清理现有数据...")
        cursor.execute("DELETE FROM stations")
        cursor.execute("DELETE FROM pipelines")
        conn.commit()
        
        # 1. 迁移站场数据
        print("正在迁移站场数据...")
        cursor.execute("SELECT * FROM node_relation_details")
        nodes = cursor.fetchall()
        
        station_name_map = {} 
        count = 0
        skipped = 0
        
        for node in nodes:
            name = node['node_name']
            if not name:
                continue
                
            if name in station_name_map:
                continue
                
            node_id = node['id']
            station_id = f"node-{node_id}"
            
            # 确定类型
            node_type = "junction"
            if "压气" in name:
                node_type = "compressor"
            elif "分输" in name or "门站" in name:
                node_type = "distribution"
            elif "阀室" in name:
                node_type = "valve"
            
            # 经纬度暂无，设为0
            lng = 0.0
            lat = 0.0
            
            try:
                cursor.execute(
                    "INSERT INTO stations (id, name, type, longitude, latitude, properties) VALUES (?, ?, ?, ?, ?, ?)",
                    (station_id, name, node_type, lng, lat, "{}")
                )
                station_name_map[name] = True
                count += 1
            except sqlite3.IntegrityError:
                print(f"  跳过重复 ID: {station_id}")
                skipped += 1
            except Exception as e:
                print(f"  插入失败 {name}: {e}")
                skipped += 1
                
        print(f"  - 成功插入 {count} 个站场, 跳过 {skipped} 个")
        
        # 2. 迁移管线数据
        print("正在迁移管线数据 (Trunk)...")
        cursor.execute("SELECT * FROM trunk_pipeline_details")
        trunks = cursor.fetchall()
        t_count = 0
        
        for trunk in trunks:
            p_id = f"trunk-{trunk['id']}"
            name = trunk['name']
            length = trunk['length'] if isinstance(trunk['length'], (int, float)) else 0.0
            
            try:
                cursor.execute(
                    "INSERT INTO pipelines (id, name, start_station_id, end_station_id, length, category, properties) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (p_id, name, "unknown", "unknown", length, "干线", "{}")
                )
                t_count += 1
            except Exception as e:
                print(f"  干线插入失败 {name}: {e}")

        print("正在迁移管线数据 (Branch)...")
        cursor.execute("SELECT * FROM branch_pipeline_details")
        branches = cursor.fetchall()
        b_count = 0
        
        for branch in branches:
            p_id = f"branch-{branch['id']}"
            name = branch['name']
            length = branch['length'] if isinstance(branch['length'], (int, float)) else 0.0
            
            try:
                cursor.execute(
                    "INSERT INTO pipelines (id, name, start_station_id, end_station_id, length, category, properties) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (p_id, name, "unknown", "unknown", length, "支线", "{}")
                )
                b_count += 1
            except Exception as e:
                print(f"  支线插入失败 {name}: {e}")
                
        print(f"  - 成功插入 {t_count + b_count} 条管线")
        
        conn.commit()
        print("✅ 数据迁移完成！")
        
    except Exception as e:
        conn.rollback()
        print(f"❌ 迁移过程中断: {e}")
        traceback.print_exc()
    finally:
        conn.close()

if __name__ == "__main__":
    migrate_data()
