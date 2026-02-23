"""
测试仿真引擎 - 选择有出边的节点
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.topology import TopologyService
from app.services.simulation_service import run_simulation
from sqlmodel import Session
from app.database import engine


def test_simulation():
    print("=" * 60)
    print("测试仿真推演引擎")
    print("=" * 60)
    
    session = Session(engine)
    topo = TopologyService(session)
    dg = topo.get_directed_graph()
    
    # 找出度最大的节点作为故障源
    nodes_by_out_degree = sorted(
        [(n, dg.out_degree(n), dg.nodes[n].get('name', n)) 
         for n in dg.nodes()],
        key=lambda x: x[1],
        reverse=True
    )
    
    print("\n出度最大的5个节点:")
    for node, out_deg, name in nodes_by_out_degree[:5]:
        print(f"  {name[:20]:20} (出度={out_deg})")
    
    # 选择第一个有出边的节点
    failure_node = nodes_by_out_degree[0][0]
    failure_name = nodes_by_out_degree[0][2]
    
    print(f"\n选择故障源: {failure_name}")
    print(f"节点ID: {failure_node[:40] if len(failure_node) > 40 else failure_node}")
    
    # 显示该节点的下游边
    print("\n下游管线:")
    for _, v, data in list(dg.out_edges(failure_node, data=True))[:5]:
        print(f"  -> {dg.nodes[v].get('name', v)[:20]:20} "
              f"(管径={data.get('diameter_mm')}mm, "
              f"管长={data.get('length_km')}km, "
              f"延迟={data.get('delay_ticks')}ticks)")
    
    # 运行仿真
    print("\n开始仿真推演...")
    result = run_simulation(topo, failure_node, tick_minutes=10)
    
    print("\n仿真结果:")
    print(f"  总 Ticks: {result.total_ticks}")
    print(f"  影响管线数: {result.affected_pipes}")
    print(f"  帧数: {len(result.frames)}")
    print()
    print(f"AI摘要: {result.ai_summary_context}")
    print()
    
    if result.frames:
        print("前10帧变化详情:")
        for frame in result.frames[:10]:
            print(f"\n  Tick {frame.tick}: {len(frame.changed_pipes)} 条管线变化")
            for pipe_id, change in list(frame.changed_pipes.items())[:5]:
                from_status = change.get('from', '?')
                to_status = change.get('to', '?')
                print(f"    - {pipe_id}: {from_status} -> {to_status}")
            if len(frame.changed_pipes) > 5:
                print(f"    ... 还有 {len(frame.changed_pipes) - 5} 条管线")
        
        if len(result.frames) > 10:
            print(f"\n  ... 还有 {len(result.frames) - 10} 帧")
    else:
        print("没有状态变化帧（可能没有下游管线）")
    
    print("\n" + "=" * 60)
    print("测试完成!")
    print("=" * 60)


if __name__ == "__main__":
    test_simulation()
