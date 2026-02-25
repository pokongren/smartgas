"""
场站物理参数数据修复脚本

为每个场站添加合理的压力、温度、处理能力参数
根据场站类型和管网层级智能分配
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import random
from sqlmodel import Session, select
from app.database import engine
from app.models import Station, Pipeline


# 场站类型参数配置
STATION_TYPE_CONFIG = {
    'compressor': {
        # 压气站：高压，大温差（压缩生热）
        'design_pressure': (10.0, 12.0),      # 设计压力范围 MPa
        'pressure_drop': (0.5, 1.5),           # 压降 MPa
        'temp_in': (15.0, 25.0),               # 进站温度 °C
        'temp_out': (40.0, 60.0),              # 出站温度 °C（压缩升温）
        'capacity': (500, 2000),               # 处理能力 万方/天
        'default_ratio': 0.9,                  # 默认运行压力/设计压力
    },
    'distribution': {
        # 分输站：中高压，调压后温度降低
        'design_pressure': (8.0, 10.0),
        'pressure_drop': (2.0, 4.0),           # 分输压降较大
        'temp_in': (20.0, 30.0),
        'temp_out': (10.0, 20.0),              # 调压降温
        'capacity': (100, 500),
        'default_ratio': 0.8,
    },
    'valve': {
        # 阀室：与管线一致，轻微压降
        'design_pressure': (8.0, 12.0),        # 根据干线/支线不同
        'pressure_drop': (0.05, 0.2),          # 阀室压降很小
        'temp_in': (15.0, 25.0),
        'temp_out': (15.0, 25.0),              # 温度基本不变
        'capacity': (0, 0),                    # 阀室无处理能力
        'default_ratio': 0.75,
    },
    'source': {
        # 气源地：最高压力
        'design_pressure': (12.0, 15.0),
        'pressure_drop': (0.0, 0.0),           # 源头无压降
        'temp_in': (20.0, 30.0),
        'temp_out': (20.0, 30.0),
        'capacity': (1000, 5000),
        'default_ratio': 0.95,
    },
    'other': {
        # 其他类型：默认参数
        'design_pressure': (8.0, 10.0),
        'pressure_drop': (0.5, 1.0),
        'temp_in': (15.0, 25.0),
        'temp_out': (15.0, 25.0),
        'capacity': (50, 200),
        'default_ratio': 0.8,
    }
}


def generate_station_params(station: Station, connected_pipelines: list) -> dict:
    """
    根据场站类型和连接管线生成物理参数
    
    Args:
        station: 场站对象
        connected_pipelines: 连接的管线列表
    
    Returns:
        参数字典
    """
    station_type = station.type if station.type in STATION_TYPE_CONFIG else 'other'
    config = STATION_TYPE_CONFIG[station_type]
    
    # 如果有连接管线，从中提取压力参考
    pipeline_pressure = None
    if connected_pipelines:
        pressures = [p.design_pressure_mpa for p in connected_pipelines if p.design_pressure_mpa]
        if pressures:
            pipeline_pressure = sum(pressures) / len(pressures)
    
    # 生成参数
    params = {}
    
    # 设计压力：优先使用连接管线的压力，否则按类型默认
    if pipeline_pressure:
        params['design_pressure'] = round(pipeline_pressure, 2)
    else:
        params['design_pressure'] = round(random.uniform(*config['design_pressure']), 2)
    
    # 运行压力
    default_ratio = config['default_ratio']
    pressure_drop = random.uniform(*config['pressure_drop'])
    
    if station_type == 'source':
        # 气源地：只有出站压力
        params['operating_pressure_in'] = None
        params['operating_pressure_out'] = round(params['design_pressure'] * default_ratio, 2)
    elif station_type == 'compressor':
        # 压气站：出站压力 > 进站压力
        params['operating_pressure_in'] = round(params['design_pressure'] * default_ratio - pressure_drop, 2)
        params['operating_pressure_out'] = round(params['design_pressure'] * default_ratio, 2)
    else:
        # 其他：出站压力 < 进站压力
        params['operating_pressure_in'] = round(params['design_pressure'] * default_ratio, 2)
        params['operating_pressure_out'] = round(params['operating_pressure_in'] - pressure_drop, 2)
    
    # 温度
    params['operating_temp_in'] = round(random.uniform(*config['temp_in']), 1)
    params['operating_temp_out'] = round(random.uniform(*config['temp_out']), 1)
    
    # 处理能力
    if config['capacity'][0] > 0:
        params['capacity'] = round(random.uniform(*config['capacity']), 1)
    else:
        params['capacity'] = None
    
    return params


def enrich_station_data():
    """主函数：修复场站数据"""
    print("=" * 70)
    print("场站物理参数数据修复")
    print("=" * 70)
    
    with Session(engine) as session:
        # 1. 获取所有场站
        stations = session.exec(select(Station)).all()
        print(f"\n总场站数: {len(stations)}")
        
        # 2. 获取所有管线（用于关联压力）
        pipelines = session.exec(select(Pipeline)).all()
        print(f"总管线数: {len(pipelines)}")
        
        # 3. 构建场站-管线连接关系
        station_pipelines = {s.id: [] for s in stations}
        for pipe in pipelines:
            if pipe.start_station_id in station_pipelines:
                station_pipelines[pipe.start_station_id].append(pipe)
            if pipe.end_station_id in station_pipelines:
                station_pipelines[pipe.end_station_id].append(pipe)
        
        # 4. 按类型统计
        type_count = {}
        for s in stations:
            type_count[s.type] = type_count.get(s.type, 0) + 1
        
        print(f"\n场站类型分布:")
        for t, c in sorted(type_count.items(), key=lambda x: x[1], reverse=True):
            print(f"  {t}: {c} 个")
        
        # 5. 生成参数并更新
        print(f"\n开始生成物理参数...")
        updated_count = 0
        
        for station in stations:
            connected = station_pipelines.get(station.id, [])
            params = generate_station_params(station, connected)
            
            # 更新场站
            station.design_pressure = params['design_pressure']
            station.operating_pressure_in = params['operating_pressure_in']
            station.operating_pressure_out = params['operating_pressure_out']
            station.operating_temp_in = params['operating_temp_in']
            station.operating_temp_out = params['operating_temp_out']
            station.capacity = params['capacity']
            
            session.add(station)
            updated_count += 1
            
            if updated_count % 500 == 0:
                print(f"  已处理: {updated_count}/{len(stations)}")
        
        # 6. 提交事务
        session.commit()
        print(f"\n完成! 共更新 {updated_count} 个场站")
        
        # 7. 验证结果
        print("\n" + "=" * 70)
        print("验证结果")
        print("=" * 70)
        
        # 重新查询验证
        stations = session.exec(select(Station)).all()
        
        # 按类型统计压力分布
        print("\n各类型场站压力分布:")
        for station_type in ['compressor', 'distribution', 'valve', 'source', 'other']:
            type_stations = [s for s in stations if s.type == station_type]
            if not type_stations:
                continue
            
            pressures = [s.design_pressure for s in type_stations if s.design_pressure]
            temps_out = [s.operating_temp_out for s in type_stations if s.operating_temp_out]
            
            if pressures:
                print(f"\n  {station_type} ({len(type_stations)}个):")
                print(f"    设计压力: {min(pressures):.1f} - {max(pressures):.1f} MPa (avg: {sum(pressures)/len(pressures):.1f})")
            if temps_out:
                print(f"    出站温度: {min(temps_out):.1f} - {max(temps_out):.1f} °C (avg: {sum(temps_out)/len(temps_out):.1f})")
        
        # 显示样本
        print("\n样本数据:")
        for station in stations[:5]:
            print(f"  {station.name[:20]:20} | {station.type:12} | P={station.design_pressure:.1f}MPa | T={station.operating_temp_out:.1f}°C")


def verify_data_quality():
    """验证数据质量"""
    print("\n" + "=" * 70)
    print("数据质量验证")
    print("=" * 70)
    
    with Session(engine) as session:
        stations = session.exec(select(Station)).all()
        
        # 检查缺失值
        missing_pressure = sum(1 for s in stations if not s.design_pressure)
        missing_temp = sum(1 for s in stations if not s.operating_temp_out)
        
        print(f"\n缺失值统计:")
        print(f"  无设计压力: {missing_pressure}/{len(stations)}")
        print(f"  无出站温度: {missing_temp}/{len(stations)}")
        
        # 检查异常值
        high_pressure = [s for s in stations if s.design_pressure and s.design_pressure > 20]
        low_pressure = [s for s in stations if s.design_pressure and s.design_pressure < 1]
        
        if high_pressure:
            print(f"\n  异常高压 (>20MPa): {len(high_pressure)} 个")
        if low_pressure:
            print(f"\n  异常低压 (<1MPa): {len(low_pressure)} 个")
        
        # 数据完整度评分
        complete = len(stations) - missing_pressure
        score = (complete / len(stations)) * 100
        print(f"\n数据完整度: {score:.1f}%")


if __name__ == "__main__":
    enrich_station_data()
    verify_data_quality()
