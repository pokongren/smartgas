"""
计算方法反复推演验证
验证管存计算、延迟权重、消耗速率的准确性
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import math
from app.models import Pipeline


def verify_linepack_calculation():
    """验证管存计算公式"""
    print("=" * 70)
    print("Round 1: 管存计算 (Linepack) 验证")
    print("=" * 70)
    
    test_cases = [
        # (diameter_mm, length_km, pressure_mpa, description)
        (1016, 100, 10.0, "典型干线管 (1m直径, 100km)"),
        (813, 50, 10.0, "中型管线 (0.8m直径, 50km)"),
        (508, 20, 8.0, "支线管 (0.5m直径, 20km)"),
        (323, 10, 6.0, "小型支线 (0.3m直径, 10km)"),
        (1016, 100, 12.0, "高压干线 (12MPa)"),
        (1016, 100, 6.0, "低压干线 (6MPa)"),
    ]
    
    print("\n测试用例:")
    print(f"{'描述':<30} {'管径(mm)':<10} {'管长(km)':<10} {'压力(MPa)':<10} {'管存(m³)':<15} {'备注'}")
    print("-" * 100)
    
    for dia, length, pressure, desc in test_cases:
        p = Pipeline(diameter_mm=dia, length_km=length, design_pressure_mpa=pressure)
        
        # 无压力系数
        vol_no_p = p.calculate_linepack_volume(pressure_factor=False)
        # 有压力系数
        vol_with_p = p.calculate_linepack_volume(pressure_factor=True)
        
        # 手工验算
        d_m = dia / 1000
        l_m = length * 1000
        r_m = d_m / 2
        manual_vol = math.pi * (r_m ** 2) * l_m
        manual_vol_with_pressure = manual_vol * (pressure / 10.0)
        
        print(f"{desc:<30} {dia:<10} {length:<10} {pressure:<10.1f} {vol_with_p:<15.1f}", end="")
        
        # 验证
        if abs(vol_no_p - manual_vol) > 1:
            print(f"  ERROR: 无压力计算不匹配")
        elif abs(vol_with_p - manual_vol_with_pressure) > 1:
            print(f"  ERROR: 有压力计算不匹配")
        else:
            print(f"  OK")
    
    # 边界情况
    print("\n边界情况:")
    edge_cases = [
        (None, 100, 10.0, "无管径"),
        (1016, 0, 10.0, "零管长"),
        (1016, -10, 10.0, "负管长"),
        (0, 100, 10.0, "零管径"),
    ]
    
    for dia, length, pressure, desc in edge_cases:
        p = Pipeline(diameter_mm=dia, length_km=length, design_pressure_mpa=pressure)
        vol = p.calculate_linepack_volume()
        print(f"  {desc}: 管存={vol:.1f} m³ (应为0) {'OK' if vol == 0 else 'ERROR'}")


def verify_delay_calculation():
    """验证延迟权重计算"""
    print("\n" + "=" * 70)
    print("Round 2: 延迟权重 (Delay Ticks) 验证")
    print("=" * 70)
    
    test_cases = [
        # (diameter_mm, length_km, pressure, consumption, desc)
        (1016, 100, 10.0, 1000, "标准消耗率"),
        (1016, 100, 10.0, 2000, "2倍消耗率"),
        (1016, 100, 10.0, 500, "0.5倍消耗率"),
        (1016, 100, 12.0, 1000, "高压影响"),
        (1016, 100, 6.0, 1000, "低压影响"),
    ]
    
    print("\n测试用例:")
    print(f"{'描述':<20} {'管存(m³)':<15} {'消耗率':<10} {'延迟Ticks':<10} {'现实时间':<15}")
    print("-" * 80)
    
    for dia, length, pressure, consumption, desc in test_cases:
        p = Pipeline(diameter_mm=dia, length_km=length, design_pressure_mpa=pressure)
        volume = p.calculate_linepack_volume()
        delay = p.calculate_delay_ticks(consumption_rate=consumption)
        real_time = delay * 10  # 10分钟/tick
        
        hours = real_time / 60
        time_str = f"{hours:.1f}小时" if hours >= 1 else f"{real_time}分钟"
        
        print(f"{desc:<20} {volume:<15.0f} {consumption:<10.0f} {delay:<10} {time_str:<15}")
    
    # 验证计算正确性
    print("\n验证计算:")
    p = Pipeline(diameter_mm=1016, length_km=100, design_pressure_mpa=10.0)
    volume = p.calculate_linepack_volume()
    delay = p.calculate_delay_ticks(consumption_rate=1000)
    
    expected_delay = max(1, int(volume / 1000))
    print(f"  管存: {volume:.0f} m³")
    print(f"  消耗率: 1000 m³/tick")
    print(f"  预期延迟: {expected_delay} ticks")
    print(f"  实际延迟: {delay} ticks")
    print(f"  验证: {'OK' if delay == expected_delay else 'ERROR'}")


def verify_consumption_rate():
    """验证动态消耗速率"""
    print("\n" + "=" * 70)
    print("Round 3: 动态消耗速率验证")
    print("=" * 70)
    
    p = Pipeline(diameter_mm=1016, length_km=100)
    
    # 季节变化
    print("\n季节影响 (12:00, 居民用户):")
    seasons = [
        (1, "冬季 (1月)"),
        (4, "春季 (4月)"),
        (7, "夏季 (7月)"),
        (10, "秋季 (10月)"),
    ]
    
    print(f"{'季节':<15} {'消耗率':<10} {'相对变化':<15}")
    print("-" * 40)
    base_rate = None
    for month, desc in seasons:
        rate = p.get_consumption_rate(hour_of_day=12, month=month, user_type='residential')
        if base_rate is None:
            base_rate = rate
            change = "基准"
        else:
            change = f"{rate/base_rate:.1f}x"
        print(f"{desc:<15} {rate:<10.0f} {change:<15}")
    
    # 时段变化
    print("\n时段影响 (7月, 居民用户):")
    hours = [
        (3, "凌晨 (3:00)"),
        (8, "早高峰 (8:00)"),
        (12, "中午 (12:00)"),
        (19, "晚高峰 (19:00)"),
        (23, "深夜 (23:00)"),
    ]
    
    print(f"{'时段':<15} {'消耗率':<10} {'相对变化':<15}")
    print("-" * 40)
    base_rate = None
    for hour, desc in hours:
        rate = p.get_consumption_rate(hour_of_day=hour, month=7, user_type='residential')
        if base_rate is None:
            base_rate = rate
            change = "基准"
        else:
            change = f"{rate/base_rate:.1f}x"
        print(f"{desc:<15} {rate:<10.0f} {change:<15}")
    
    # 用户类型
    print("\n用户类型影响 (12:00, 7月):")
    users = [
        ('residential', "居民用户"),
        ('industrial', "工业用户"),
        ('power_plant', "电厂"),
        ('city_gate', "城市门站"),
    ]
    
    print(f"{'用户类型':<15} {'消耗率':<10} {'相对变化':<15}")
    print("-" * 40)
    base_rate = None
    for user_type, desc in users:
        rate = p.get_consumption_rate(hour_of_day=12, month=7, user_type=user_type)
        if base_rate is None:
            base_rate = rate
            change = "基准"
        else:
            change = f"{rate/base_rate:.1f}x"
        print(f"{desc:<15} {rate:<10.0f} {change:<15}")
    
    # 综合场景
    print("\n综合场景对比:")
    scenarios = [
        (12, 7, 'residential', "夏季中午居民"),
        (19, 1, 'residential', "冬季晚高峰居民"),
        (12, 7, 'industrial', "夏季中午工业"),
        (8, 1, 'city_gate', "冬季早高峰城市门站"),
    ]
    
    print(f"{'场景':<25} {'消耗率':<10} {'延迟Ticks*':<12}")
    print("-" * 50)
    for hour, month, user, desc in scenarios:
        rate = p.get_consumption_rate(hour, month, user)
        delay = p.calculate_delay_ticks(consumption_rate=rate)
        print(f"{desc:<25} {rate:<10.0f} {delay:<12}")
    print("* 基于1016mm×100km管线计算")


def verify_real_database():
    """验证实际数据库中的计算"""
    print("\n" + "=" * 70)
    print("Round 4: 实际数据库验证")
    print("=" * 70)
    
    from sqlmodel import Session, select
    from app.database import engine
    
    with Session(engine) as session:
        pipelines = session.exec(select(Pipeline)).all()
        
        # 筛选可计算的管线
        valid_pipelines = [p for p in pipelines 
                          if p.diameter_mm and p.length_km > 0]
        
        print(f"\n总管线数: {len(pipelines)}")
        print(f"可计算管存: {len(valid_pipelines)}")
        
        # 计算分布
        volumes = []
        delays = []
        
        for p in valid_pipelines[:50]:  # 取前50个
            vol = p.calculate_linepack_volume()
            delay = p.calculate_delay_ticks()
            volumes.append(vol)
            delays.append(delay)
        
        if volumes:
            print(f"\n管存分布 (前50条):")
            print(f"  最小: {min(volumes):.0f} m³")
            print(f"  最大: {max(volumes):.0f} m³")
            print(f"  平均: {sum(volumes)/len(volumes):.0f} m³")
            
            print(f"\n延迟分布:")
            print(f"  最小: {min(delays)} ticks ({min(delays)*10}分钟)")
            print(f"  最大: {max(delays)} ticks ({max(delays)*10/60:.1f}小时)")
            print(f"  平均: {sum(delays)/len(delays):.0f} ticks")
            
            # 分组统计
            short = sum(1 for d in delays if d <= 5)
            medium = sum(1 for d in delays if 5 < d <= 50)
            long = sum(1 for d in delays if d > 50)
            
            print(f"\n延迟分组:")
            print(f"  短延迟 (≤5ticks): {short} 条 ({short/len(delays)*100:.1f}%)")
            print(f"  中延迟 (6-50ticks): {medium} 条 ({medium/len(delays)*100:.1f}%)")
            print(f"  长延迟 (>50ticks): {long} 条 ({long/len(delays)*100:.1f}%)")
        
        # 显示样本
        print("\n样本管线计算:")
        print(f"{'ID':<12} {'名称':<25} {'管径':<8} {'管长':<8} {'管存':<12} {'延迟':<8}")
        print("-" * 80)
        for p in valid_pipelines[:10]:
            vol = p.calculate_linepack_volume()
            delay = p.calculate_delay_ticks()
            name = p.name[:23] if p.name else 'N/A'
            print(f"{p.id:<12} {name:<25} {str(p.diameter_mm)+'mm':<8} {str(p.length_km)+'km':<8} {vol:<12.0f} {delay:<8}")


def verify_formula_correctness():
    """验证公式数学正确性"""
    print("\n" + "=" * 70)
    print("Round 5: 公式数学正确性验证")
    print("=" * 70)
    
    print("\n管存公式: V = π × (D/2)² × L × (P/10)")
    print("验证步骤:")
    
    # 标准测试：1m直径，1km长，10MPa
    D = 1.0  # m
    L = 1000  # m
    P = 10.0  # MPa
    
    # 步骤分解
    print(f"\n  输入: D={D}m, L={L}m, P={P}MPa")
    print(f"  步骤1: 半径 r = D/2 = {D/2}m")
    print(f"  步骤2: 截面积 A = π × r² = {math.pi * (D/2)**2:.4f} m²")
    print(f"  步骤3: 几何体积 V_geom = A × L = {math.pi * (D/2)**2 * L:.0f} m³")
    print(f"  步骤4: 压力修正 V = V_geom × (P/10) = {math.pi * (D/2)**2 * L * (P/10):.0f} m³")
    
    # 与模型计算对比
    p = Pipeline(diameter_mm=1000, length_km=1, design_pressure_mpa=10.0)
    model_vol = p.calculate_linepack_volume()
    print(f"\n  模型计算结果: {model_vol:.0f} m³")
    print(f"  手工计算结果: {math.pi * (D/2)**2 * L * (P/10):.0f} m³")
    print(f"  差异: {abs(model_vol - math.pi * (D/2)**2 * L * (P/10)):.2f} m³")
    print(f"  验证: {'OK' if abs(model_vol - math.pi * (D/2)**2 * L * (P/10)) < 0.1 else 'ERROR'}")
    
    # 延迟公式验证
    print("\n延迟公式: T = max(1, int(V / R))")
    V = 78540  # m³ (约100km×1m管线)
    R = 1000  # m³/tick
    
    expected = max(1, int(V / R))
    print(f"\n  输入: V={V}m³, R={R}m³/tick")
    print(f"  计算: V/R = {V/R:.1f}")
    print(f"  取整: int({V/R:.1f}) = {int(V/R)}")
    print(f"  最大: max(1, {int(V/R)}) = {expected}")
    print(f"  预期延迟: {expected} ticks")
    
    p = Pipeline(diameter_mm=1000, length_km=100, design_pressure_mpa=10.0)
    model_delay = p.calculate_delay_ticks(consumption_rate=1000)
    print(f"  模型延迟: {model_delay} ticks")
    print(f"  验证: {'OK' if model_delay == expected else 'ERROR'}")


def main():
    print("=" * 70)
    print("计算方法反复推演验证")
    print("=" * 70)
    
    verify_linepack_calculation()
    verify_delay_calculation()
    verify_consumption_rate()
    verify_real_database()
    verify_formula_correctness()
    
    print("\n" + "=" * 70)
    print("验证完成")
    print("=" * 70)


if __name__ == "__main__":
    main()
