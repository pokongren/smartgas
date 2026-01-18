"""
快速验证演示数据
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session, select
from app.database import engine
from app.models import Station, Pipeline

print("=" * 60)
print("🔍 演示数据验证")
print("=" * 60)

with Session(engine) as session:
    # 查询站场
    stations = session.exec(select(Station)).all()
    print(f"\n📍 站场数量: {len(stations)}")
    for station in stations:
        print(f"  - {station.name} ({station.type})")
        print(f"    位置: ({station.longitude}, {station.latitude})")
        print(f"    压力: {station.design_pressure} MPa")
    
    # 查询管线
    pipelines = session.exec(select(Pipeline)).all()
    print(f"\n🔗 管线数量: {len(pipelines)}")
    for pipeline in pipelines:
        start = session.get(Station, pipeline.start_station_id)
        end = session.get(Station, pipeline.end_station_id)
        print(f"  - {pipeline.name}")
        print(f"    {start.name} → {end.name}")
        print(f"    长度: {pipeline.length}km, 管径: {pipeline.diameter}mm")

print("\n" + "=" * 60)
print("✅ 数据验证完成!")
print("=" * 60)
print("\n💡 下一步:")
print("  1. 打开浏览器: http://localhost:3001")
print("  2. 查看地图上的站场和管线")
print("  3. 访问 API 文档: http://localhost:8000/docs")
