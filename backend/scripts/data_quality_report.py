"""
数据质量综合检查报告
评估场站和管线的物理参数完整性、拓扑连通性
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session, select
from app.database import engine
from app.models import Station, Pipeline
from app.services.topology import TopologyService
import networkx as nx


def check_station_quality():
    """检查场站数据质量"""
    print("=" * 70)
    print("1. 场站表 (stations) 数据质量")
    print("=" * 70)
    
    with Session(engine) as session:
        stations = session.exec(select(Station)).all()
        total = len(stations)
        
        print(f"\n总记录数: {total}")
        
        # 基础字段
        has_name = sum(1 for s in stations if s.name)
        has_type = sum(1 for s in stations if s.type)
        has_coords = sum(1 for s in stations if s.longitude != 0 and s.latitude != 0)
        
        print("\n基础字段:")
        print(f"  有名称:     {has_name:5d}/{total} ({has_name/total*100:5.1f}%)")
        print(f"  有类型:     {has_type:5d}/{total} ({has_type/total*100:5.1f}%)")
        print(f"  有坐标:     {has_coords:5d}/{total} ({has_coords/total*100:5.1f}%)")
        
        # 物理参数字段（本次新增）
        has_design_p = sum(1 for s in stations if s.design_pressure)
        has_op_in = sum(1 for s in stations if s.operating_pressure_in)
        has_op_out = sum(1 for s in stations if s.operating_pressure_out)
        has_temp_in = sum(1 for s in stations if s.operating_temp_in)
        has_temp_out = sum(1 for s in stations if s.operating_temp_out)
        has_capacity = sum(1 for s in stations if s.capacity)
        
        print("\n物理参数（本次新增）:")
        print(f"  设计压力:   {has_design_p:5d}/{total} ({has_design_p/total*100:5.1f}%)  {'OK' if has_design_p==total else 'MISSING'}")
        print(f"  进站压力:   {has_op_in:5d}/{total} ({has_op_in/total*100:5.1f}%)  {'OK' if has_op_in==total else 'MISSING'}")
        print(f"  出站压力:   {has_op_out:5d}/{total} ({has_op_out/total*100:5.1f}%)  {'OK' if has_op_out==total else 'MISSING'}")
        print(f"  进站温度:   {has_temp_in:5d}/{total} ({has_temp_in/total*100:5.1f}%)  {'OK' if has_temp_in==total else 'MISSING'}")
        print(f"  出站温度:   {has_temp_out:5d}/{total} ({has_temp_out/total*100:5.1f}%)  {'OK' if has_temp_out==total else 'MISSING'}")
        print(f"  处理能力:   {has_capacity:5d}/{total} ({has_capacity/total*100:5.1f}%)  (仅功能站需要)")
        
        # 按类型统计
        from collections import defaultdict
        by_type = defaultdict(list)
        for s in stations:
            by_type[s.type].append(s)
        
        print("\n按类型分布:")
        for t, ss in sorted(by_type.items(), key=lambda x: len(x[1]), reverse=True):
            p_count = sum(1 for s in ss if s.design_pressure)
            print(f"  {t:15s}: {len(ss):4d} 个 | 有压力参数: {p_count:4d} ({p_count/len(ss)*100:5.1f}%)")
        
        return stations


def check_pipeline_quality():
    """检查管线数据质量"""
    print("\n" + "=" * 70)
    print("2. 管线表 (pipelines) 数据质量")
    print("=" * 70)
    
    with Session(engine) as session:
        pipelines = session.exec(select(Pipeline)).all()
        total = len(pipelines)
        
        print(f"\n总记录数: {total}")
        
        # 基础字段
        has_name = sum(1 for p in pipelines if p.name)
        has_start = sum(1 for p in pipelines if p.start_station_id)
        has_end = sum(1 for p in pipelines if p.end_station_id)
        has_category = sum(1 for p in pipelines if p.category)
        
        print("\n基础字段:")
        print(f"  有名称:         {has_name:5d}/{total} ({has_name/total*100:5.1f}%)")
        print(f"  有起点站ID:     {has_start:5d}/{total} ({has_start/total*100:5.1f}%)")
        print(f"  有终点站ID:     {has_end:5d}/{total} ({has_end/total*100:5.1f}%)")
        print(f"  有类别:         {has_category:5d}/{total} ({has_category/total*100:5.1f}%)")
        
        # 物理参数
        has_diameter = sum(1 for p in pipelines if p.diameter_mm)
        has_length = sum(1 for p in pipelines if p.length_km > 0)
        has_pressure = sum(1 for p in pipelines if p.design_pressure_mpa)
        
        print("\n物理参数:")
        print(f"  有管径(mm):     {has_diameter:5d}/{total} ({has_diameter/total*100:5.1f}%)")
        print(f"  有管长(km):     {has_length:5d}/{total} ({has_length/total*100:5.1f}%)")
        print(f"  有设计压力:     {has_pressure:5d}/{total} ({has_pressure/total*100:5.1f}%)")
        
        # 计算管存覆盖率
        can_calculate_linepack = sum(1 for p in pipelines 
                                     if p.diameter_mm and p.length_km > 0 and p.design_pressure_mpa)
        
        print(f"\n  可计算管存:     {can_calculate_linepack:5d}/{total} ({can_calculate_linepack/total*100:5.1f}%)")
        
        # 按类别统计
        from collections import defaultdict
        by_cat = defaultdict(list)
        for p in pipelines:
            by_cat[p.category].append(p)
        
        print("\n按类别分布:")
        for cat, ps in sorted(by_cat.items(), key=lambda x: len(x[1]), reverse=True):
            dia_count = sum(1 for p in ps if p.diameter_mm)
            len_count = sum(1 for p in ps if p.length_km > 0)
            print(f"  {cat:10s}: {len(ps):3d} 条 | 有管径: {dia_count:3d} | 有管长: {len_count:3d}")
        
        return pipelines


def check_topology_quality(stations, pipelines):
    """检查拓扑连通性质量"""
    print("\n" + "=" * 70)
    print("3. 拓扑连通性质量")
    print("=" * 70)
    
    session = Session(engine)
    topo = TopologyService(session)
    dg = topo.get_directed_graph()
    
    print(f"\n图结构统计:")
    print(f"  节点数: {len(dg.nodes)}")
    print(f"  边数:   {len(dg.edges)}")
    
    # 连通性分析
    in_degrees = [dg.in_degree(n) for n in dg.nodes()]
    out_degrees = [dg.out_degree(n) for n in dg.nodes()]
    
    isolated = [n for n in dg.nodes() if dg.in_degree(n) == 0 and dg.out_degree(n) == 0]
    sources = [n for n in dg.nodes() if dg.in_degree(n) == 0 and dg.out_degree(n) > 0]
    sinks = [n for n in dg.nodes() if dg.out_degree(n) == 0 and dg.in_degree(n) > 0]
    connected = [n for n in dg.nodes() if dg.in_degree(n) > 0 and dg.out_degree(n) > 0]
    
    print(f"\n连通性分布:")
    print(f"  孤立节点 (无连接):  {len(isolated):5d} ({len(isolated)/len(dg.nodes)*100:5.1f}%)  {'WARNING' if len(isolated)>1000 else 'OK'}")
    print(f"  源点 (只有出边):    {len(sources):5d} ({len(sources)/len(dg.nodes)*100:5.1f}%)")
    print(f"  汇点 (只有入边):    {len(sinks):5d} ({len(sinks)/len(dg.nodes)*100:5.1f}%)")
    print(f"  连通节点 (双向):    {len(connected):5d} ({len(connected)/len(dg.nodes)*100:5.1f}%)")
    
    # 检查孤立节点详情
    if isolated:
        isolated_with_station = [n for n in isolated if n in [s.id for s in stations]]
        print(f"\n  其中场站表中有记录的孤立节点: {len(isolated_with_station)}")
        
        # 抽样检查
        sample_isolated = isolated[:3]
        print(f"\n  孤立节点样本:")
        for node_id in sample_isolated:
            station = next((s for s in stations if s.id == node_id), None)
            if station:
                print(f"    {node_id[:20]:20s} - {station.name[:20]:20s} ({station.type})")
    
    # 检查管线连接的节点是否存在
    station_ids = {s.id for s in stations}
    missing_start = [p for p in pipelines if p.start_station_id not in station_ids]
    missing_end = [p for p in pipelines if p.end_station_id not in station_ids]
    
    print(f"\n数据一致性:")
    print(f"  管线起点不存在于场站表: {len(missing_start)} 条")
    print(f"  管线终点不存在于场站表: {len(missing_end)} 条")
    
    # 环检测
    try:
        cycles = list(nx.simple_cycles(dg))
        print(f"\n  图中环数量: {len(cycles)} 个")
    except Exception as e:
        print(f"\n  环检测失败: {e}")
    
    return {
        'total_nodes': len(dg.nodes),
        'total_edges': len(dg.edges),
        'isolated': len(isolated),
        'connected_ratio': len(connected) / len(dg.nodes) * 100
    }


def calculate_overall_score(station_stats, pipeline_stats, topo_stats):
    """计算综合数据质量评分"""
    print("\n" + "=" * 70)
    print("4. 综合数据质量评分")
    print("=" * 70)
    
    scores = []
    
    # 场站评分 (40%)
    station_score = 0
    if station_stats['design_pressure'] == station_stats['total']:
        station_score += 25  # 压力参数完整
    if station_stats['operating_temp_out'] == station_stats['total']:
        station_score += 15  # 温度参数完整
    scores.append(('场站物理参数', station_score, 40))
    
    # 管线评分 (30%)
    pipeline_score = 0
    linepack_ratio = station_stats.get('can_calculate_linepack', 0) / max(station_stats['total'], 1)
    pipeline_score += linepack_ratio * 30
    scores.append(('管线物理参数', pipeline_score, 30))
    
    # 拓扑评分 (30%)
    topo_score = 0
    if topo_stats['connected_ratio'] > 80:
        topo_score = 30
    elif topo_stats['connected_ratio'] > 50:
        topo_score = 20
    elif topo_stats['connected_ratio'] > 20:
        topo_score = 10
    else:
        topo_score = 5
    scores.append(('拓扑连通性', topo_score, 30))
    
    print("\n分项评分:")
    total_score = 0
    for name, score, weight in scores:
        weighted = score / 100 * weight
        total_score += weighted
        print(f"  {name:20s}: {score:5.1f}/100 × {weight}% = {weighted:5.1f}")
    
    print(f"\n{'='*50}")
    print(f"  综合评分: {total_score:.1f}/100")
    print(f"{'='*50}")
    
    # 评级
    if total_score >= 90:
        grade = "A (优秀)"
    elif total_score >= 80:
        grade = "B (良好)"
    elif total_score >= 60:
        grade = "C (及格)"
    else:
        grade = "D (需改进)"
    
    print(f"  评级: {grade}")
    print(f"{'='*50}")
    
    return total_score


def main():
    print("=" * 70)
    print("数据质量综合检查报告")
    print("=" * 70)
    print(f"检查时间: 2026-02-23")
    print()
    
    stations = check_station_quality()
    pipelines = check_pipeline_quality()
    topo_stats = check_topology_quality(stations, pipelines)
    
    # 汇总统计
    station_stats = {
        'total': len(stations),
        'design_pressure': sum(1 for s in stations if s.design_pressure),
        'operating_temp_out': sum(1 for s in stations if s.operating_temp_out),
        'can_calculate_linepack': sum(1 for p in pipelines 
                                      if p.diameter_mm and p.length_km > 0 and p.design_pressure_mpa)
    }
    
    score = calculate_overall_score(station_stats, {}, topo_stats)
    
    print("\n" + "=" * 70)
    print("关键问题与建议")
    print("=" * 70)
    
    issues = []
    
    if topo_stats['isolated'] > 1000:
        issues.append(("HIGH", f"孤立节点过多: {topo_stats['isolated']} 个 ({topo_stats['isolated']/topo_stats['total_nodes']*100:.1f}%)", 
                      "需要补充管线连接数据或清理无效节点"))
    
    if station_stats['design_pressure'] < station_stats['total']:
        issues.append(("MEDIUM", f"场站压力参数缺失: {station_stats['total'] - station_stats['design_pressure']} 个",
                      "运行数据修复脚本"))
    
    pipeline_can_calc = sum(1 for p in pipelines 
                           if p.diameter_mm and p.length_km > 0 and p.design_pressure_mpa)
    if pipeline_can_calc < len(pipelines) * 0.8:
        issues.append(("MEDIUM", f"管线物理参数不完整: 仅 {pipeline_can_calc}/{len(pipelines)} 可计算管存",
                      "补充管径、管长数据"))
    
    if not issues:
        print("\n✅ 未发现严重问题")
    else:
        for severity, issue, suggestion in issues:
            icon = "🔴" if severity == "HIGH" else "🟡"
            print(f"\n{icon} [{severity}] {issue}")
            print(f"   建议: {suggestion}")
    
    print("\n" + "=" * 70)
    print("报告结束")
    print("=" * 70)


if __name__ == "__main__":
    main()
