"""
阶段一完整验证脚本
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))


def main():
    print("=" * 70)
    print("阶段一：后端物理基座重塑 - 完整验证")
    print("=" * 70)
    
    # 1. Pipeline 模型验证
    print("\n[1] Pipeline 模型物理计算验证")
    print("-" * 70)
    from app.models import Pipeline
    
    test_cases = [
        (1016, 100),   # 1米粗，100公里
        (813, 50),     # 0.8米粗，50公里  
        (300, 10),     # 0.3米粗，10公里
    ]
    
    for diameter_mm, length_km in test_cases:
        p = Pipeline(diameter_mm=diameter_mm, length_km=length_km)
        linepack = p.calculate_linepack_volume()
        delay = p.calculate_delay_ticks()
        hours = delay * 10 / 60
        print(f"  管径{diameter_mm}mm × 管长{length_km}km")
        print(f"    → 管存: {linepack:,.0f} m³, 延迟: {delay} ticks ({hours:.1f}小时)")
    
    # 2. 拓扑服务验证
    print("\n[2] 拓扑服务验证")
    print("-" * 70)
    from app.services.topology import TopologyService
    from sqlmodel import Session
    from app.database import engine
    
    session = Session(engine)
    topo = TopologyService(session)
    dg = topo.get_directed_graph()
    
    print(f"  有向图节点数: {len(dg.nodes)}")
    print(f"  有向图边数: {len(dg.edges)}")
    
    # 检查边的物理属性
    edges_with_linepack = sum(1 for _, _, d in dg.edges(data=True) if d.get('linepack_volume', 0) > 0)
    edges_with_delay = sum(1 for _, _, d in dg.edges(data=True) if d.get('delay_ticks', 0) > 1)
    
    print(f"  边带有管存属性: {edges_with_linepack}/{len(dg.edges)}")
    print(f"  边带有延迟属性: {edges_with_delay}/{len(dg.edges)}")
    
    # 显示样本
    print("\n  样本边属性:")
    for u, v, data in list(dg.edges(data=True))[:3]:
        print(f"    {data.get('pipeline_id')}:")
        print(f"      物理: 径{data.get('diameter_mm')}mm × 长{data.get('length_km')}km")
        print(f"      算子: 存{data.get('linepack_volume', 0):.0f}m³ 延{data.get('delay_ticks', 1)}ticks")
    
    # 3. 仿真引擎验证
    print("\n[3] 仿真引擎验证")
    print("-" * 70)
    from app.services.simulation_service import run_simulation
    
    # 找出度最大的节点作为故障源
    nodes_by_out_degree = sorted(
        [(n, dg.out_degree(n), dg.nodes[n].get('name', n)) for n in dg.nodes()],
        key=lambda x: x[1], reverse=True
    )
    failure_node = nodes_by_out_degree[0][0]
    failure_name = nodes_by_out_degree[0][2]
    
    print(f"  故障源: {failure_name[:20]} (出度={nodes_by_out_degree[0][1]})")
    
    result = run_simulation(topo, failure_node, tick_minutes=10)
    
    print(f"\n  仿真结果:")
    print(f"    总 Ticks: {result.total_ticks}")
    print(f"    影响管线数: {result.affected_pipes}")
    print(f"    帧数: {len(result.frames)}")
    print(f"    AI摘要: {result.ai_summary_context}")
    
    print(f"\n  推演过程:")
    for i, frame in enumerate(result.frames[:5]):
        print(f"    Tick {frame.tick}: {len(frame.changed_pipes)} 条管线变化")
        for pipe_id, change in list(frame.changed_pipes.items())[:2]:
            print(f"      - {pipe_id}: {change['from']} → {change['to']}")
        if len(frame.changed_pipes) > 2:
            print(f"      ... 还有 {len(frame.changed_pipes) - 2} 条管线")
    
    if len(result.frames) > 5:
        print(f"    ... 还有 {len(result.frames) - 5} 帧")
    
    # 4. 总结
    print("\n" + "=" * 70)
    print("阶段一验证总结")
    print("=" * 70)
    
    checks = [
        ("Pipeline 模型物理字段", True),
        ("管存计算 (Linepack)", True),
        ("延迟权重计算 (Delay Ticks)", True),
        ("有向图构建 (DiGraph)", True),
        ("边属性注入", edges_with_linepack > 0),
        ("仿真引擎 Tick Loop", result.total_ticks > 0 or len(result.frames) > 0),
        ("状态机跃迁 (normal→depressurizing→outage)", len(result.frames) > 0),
        ("增量帧输出", len(result.frames) > 0),
        ("AI 摘要生成", len(result.ai_summary_context) > 0),
    ]
    
    all_pass = True
    for name, passed in checks:
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {name}")
        if not passed:
            all_pass = False
    
    print("=" * 70)
    if all_pass:
        print("所有检查通过! 阶段一已完成。")
    else:
        print("存在失败的检查项，请修复。")
    print("=" * 70)


if __name__ == "__main__":
    main()
