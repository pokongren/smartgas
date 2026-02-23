"""
测试仿真引擎
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
    
    # 找一个节点作为故障源
    stations = list(topo.graph.nodes(data=True))
    failure_node = stations[0][0]
    failure_name = stations[0][1].get('name', failure_node)
    
    print(f"故障源节点: {failure_node[:30] if len(failure_node) > 30 else failure_node}")
    print(f"故障源名称: {failure_name}")
    print()
    
    # 运行仿真
    print("开始仿真推演...")
    result = run_simulation(topo, failure_node, tick_minutes=10)
    
    print("\n仿真结果:")
    print(f"  总 Ticks: {result.total_ticks}")
    print(f"  影响管线数: {result.affected_pipes}")
    print(f"  帧数: {len(result.frames)}")
    print()
    print(f"AI摘要: {result.ai_summary_context}")
    print()
    
    print("前5帧变化详情:")
    for i, frame in enumerate(result.frames[:5]):
        print(f"  Tick {frame.tick}: {len(frame.changed_pipes)} 条管线变化")
        for pipe_id, change in list(frame.changed_pipes.items())[:3]:
            from_status = change.get('from', '?')
            to_status = change.get('to', '?')
            print(f"    - {pipe_id}: {from_status} -> {to_status}")
        if len(frame.changed_pipes) > 3:
            print(f"    ... 还有 {len(frame.changed_pipes) - 3} 条管线")
    
    if len(result.frames) > 5:
        print(f"  ... 还有 {len(result.frames) - 5} 帧")
    
    print("\n" + "=" * 60)
    print("测试完成!")
    print("=" * 60)


if __name__ == "__main__":
    test_simulation()
