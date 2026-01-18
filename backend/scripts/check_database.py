"""
数据库验证脚本
用于检查数据库状态和数据完整性
"""
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session, select
from app.database import engine, DB_PATH
from app.models import Station, Pipeline

def check_database():
    """检查数据库状态"""
    
    # 检查数据库文件是否存在
    if not DB_PATH.exists():
        print("❌ 数据库文件不存在!")
        print(f"   预期路径: {DB_PATH}")
        print("\n💡 请先运行初始化脚本:")
        print("   python scripts/init_data.py")
        return
    
    print(f"✅ 数据库文件存在: {DB_PATH}")
    print(f"   文件大小: {DB_PATH.stat().st_size / 1024:.2f} KB\n")
    
    try:
        with Session(engine) as session:
            # 查询站场数据
            stations = session.exec(select(Station)).all()
            print(f"📍 站场总数: {len(stations)}")
            
            if stations:
                print("\n站场列表:")
                # 按类型分组统计
                source_count = sum(1 for s in stations if s.type == "source")
                compressor_count = sum(1 for s in stations if s.type == "compressor")
                distribution_count = sum(1 for s in stations if s.type == "distribution")
                
                print(f"  - 气源站: {source_count} 个")
                print(f"  - 压气站: {compressor_count} 个")
                print(f"  - 分输站: {distribution_count} 个")
                
                print("\n前 5 个站场:")
                for station in stations[:5]:
                    print(f"  - {station.name} ({station.type}) - 位置: ({station.longitude}, {station.latitude})")
            
            # 查询管线数据
            pipelines = session.exec(select(Pipeline)).all()
            print(f"\n🔗 管线总数: {len(pipelines)}")
            
            if pipelines:
                # 按类别分组统计
                categories = {}
                total_length = 0
                for p in pipelines:
                    categories[p.category] = categories.get(p.category, 0) + 1
                    total_length += p.length
                
                print("\n管线类别分布:")
                for category, count in categories.items():
                    print(f"  - {category}: {count} 条")
                
                print(f"\n管网总长度: {total_length:.2f} km")
                
                print("\n前 5 条管线:")
                for pipeline in pipelines[:5]:
                    print(f"  - {pipeline.name} ({pipeline.length}km, {pipeline.category})")
            
            # 数据完整性检查
            print("\n🔍 数据完整性检查:")
            
            # 检查管线的起点和终点站场是否存在
            station_ids = {s.id for s in stations}
            invalid_pipelines = []
            
            for pipeline in pipelines:
                if pipeline.start_station_id not in station_ids:
                    invalid_pipelines.append(f"{pipeline.name} - 起点站场不存在: {pipeline.start_station_id}")
                if pipeline.end_station_id not in station_ids:
                    invalid_pipelines.append(f"{pipeline.name} - 终点站场不存在: {pipeline.end_station_id}")
            
            if invalid_pipelines:
                print("  ⚠️  发现数据问题:")
                for issue in invalid_pipelines:
                    print(f"     - {issue}")
            else:
                print("  ✅ 所有管线的起点和终点站场都存在")
            
            # 检查坐标范围
            if stations:
                lngs = [s.longitude for s in stations]
                lats = [s.latitude for s in stations]
                print(f"\n📊 坐标范围:")
                print(f"  - 经度: {min(lngs):.2f} ~ {max(lngs):.2f}")
                print(f"  - 纬度: {min(lats):.2f} ~ {max(lats):.2f}")
            
            print("\n✅ 数据库检查完成!")
            
    except Exception as e:
        print(f"\n❌ 数据库查询失败: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    check_database()
