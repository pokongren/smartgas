import sys
import os
import sqlite3
from collections import defaultdict

# 获取当前脚本所在目录
script_dir = os.path.dirname(os.path.abspath(__file__))
# 获取项目根目录
project_root = os.path.abspath(os.path.join(script_dir, '../../'))
# 获取 db 路径
db_path = os.path.join(project_root, 'backend/data/smartgas.db')

def analyze_shared_stations():
    print(f"正在分析数据库: {db_path} ...")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    try:
        # 查询所有节点信息
        cursor.execute("SELECT node_name, trunk_name, branch_name, node_type_2025 FROM node_relation_details")
        rows = cursor.fetchall()
        
        station_pipelines = defaultdict(set)
        station_types = defaultdict(set)
        
        for row in rows:
            name = row['node_name']
            if not name:
                continue
                
            # 记录该站点所属的管线 (干线 + 支线)
            trunk = row['trunk_name']
            branch = row['branch_name']
            
            pipeline_info = f"{trunk}"
            if branch and branch != trunk:
                pipeline_info += f" -> {branch}"
                
            station_pipelines[name].add(pipeline_info)
            
            if row['node_type_2025']:
                station_types[name].add(row['node_type_2025'])
            
        # 筛选出属于多条管线的站点 (合建站候选)
        shared_stations = {k: v for k, v in station_pipelines.items() if len(v) > 1}
        
        # 将结果写入文件 (UTF-8)
        report_path = os.path.join(script_dir, '../../shared_station_report_utf8.txt')
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(f"=== 合建站分析报告 ===\n")
            f.write(f"总站点数 (按名称去重): {len(station_pipelines)}\n")
            f.write(f"合建站/多线共用站数量: {len(shared_stations)}\n")
            f.write("-" * 30 + "\n")
            
            # 按关联管线数量排序
            sorted_stations = sorted(shared_stations.items(), key=lambda x: len(x[1]), reverse=True)
            
            for name, pipelines in sorted_stations:
                f.write(f"\n站点: {name}\n")
                types_str = ', '.join(station_types[name]) if station_types[name] else "Unknown"
                f.write(f"  类型: {types_str}\n")
                f.write(f"  关联管线数: {len(pipelines)}\n")
                for p in pipelines:
                    f.write(f"    - {p}\n")
                    
        print(f"✅ 报告已生成: {report_path}")
                
    except Exception as e:
        print(f"❌ 分析失败: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    analyze_shared_stations()
