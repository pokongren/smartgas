"""
数据迁移脚本：将 Pipeline 表的旧字段迁移到新物理字段

迁移内容：
- diameter (int) → diameter_mm (float)
- length (float) → length_km (float)

执行方式：
    cd backend
    python scripts/migrate_pipeline_fields.py
"""

import sys
from pathlib import Path

# 添加项目根目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session, select
from app.database import engine
from app.models import Pipeline


def migrate_pipeline_data():
    """迁移管线数据到新字段"""
    print("=" * 60)
    print("开始迁移 Pipeline 表数据...")
    print("=" * 60)
    
    with Session(engine) as session:
        pipelines = session.exec(select(Pipeline)).all()
        
        migrated_count = 0
        skipped_count = 0
        
        for pipeline in pipelines:
            needs_update = False
            
            # 迁移 diameter → diameter_mm
            if pipeline.diameter and not pipeline.diameter_mm:
                pipeline.diameter_mm = float(pipeline.diameter)
                needs_update = True
                print(f"  [{pipeline.id}] diameter: {pipeline.diameter} → diameter_mm: {pipeline.diameter_mm}")
            
            # 迁移 length → length_km
            if pipeline.length and not pipeline.length_km:
                pipeline.length_km = pipeline.length
                needs_update = True
                print(f"  [{pipeline.id}] length: {pipeline.length} → length_km: {pipeline.length_km}")
            
            if needs_update:
                migrated_count += 1
                session.add(pipeline)
            else:
                skipped_count += 1
        
        session.commit()
        
        print("=" * 60)
        print(f"迁移完成: {migrated_count} 条记录已更新, {skipped_count} 条记录无需更新")
        print("=" * 60)
        
        # 验证结果
        print("\n验证样本（前5条）：")
        pipelines = session.exec(select(Pipeline).limit(5)).all()
        for p in pipelines:
            linepack = p.calculate_linepack_volume()
            delay = p.calculate_delay_ticks()
            print(f"  {p.id}: {p.diameter_mm}mm × {p.length_km}km → 管存:{linepack}m³ 延迟:{delay}ticks")


if __name__ == "__main__":
    migrate_pipeline_data()
