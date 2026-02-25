"""
阶段2深度推演分析
测试各种边界情况和异常场景
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import time
import networkx as nx
from collections import defaultdict

from app.services.topology import TopologyService
from app.services.simulation_service import (
    OptimizedSimulationEngine, SimulationConfig, SimulationMode
)
from sqlmodel import Session
from app.database import engine


def analyze_graph_structure():
    """分析图结构特征"""
    print("=" * 70)
    print("Round 1: Graph Structure Analysis")
    print("=" * 70)
    
    session = Session(engine)
    topo = TopologyService(session)
    dg = topo.get_directed_graph()
    
    # 基础统计
    print(f"\n基础统计:")
    print(f"  总节点数: {len(dg.nodes)}")
    print(f"  总边数: {len(dg.edges)}")
    
    # 度分布
    in_degrees = [dg.in_degree(n) for n in dg.nodes()]
    out_degrees = [dg.out_degree(n) for n in dg.nodes()]
    
    print(f"\n入度分布:")
    print(f"  最大入度: {max(in_degrees)}")
    print(f"  平均入度: {sum(in_degrees)/len(in_degrees):.2f}")
    print(f"  入度为0: {sum(1 for d in in_degrees if d == 0)} 个")
    
    print(f"\n出度分布:")
    print(f"  最大出度: {max(out_degrees)}")
    print(f"  平均出度: {sum(out_degrees)/len(out_degrees):.2f}")
    print(f"  出度为0: {sum(1 for d in out_degrees if d == 0)} 个")
    
    # 节点类型
    sources = [n for n in dg.nodes() if dg.in_degree(n) == 0 and dg.out_degree(n) > 0]
    sinks = [n for n in dg.nodes() if dg.out_degree(n) == 0 and dg.in_degree(n) > 0]
    isolated = [n for n in dg.nodes() if dg.in_degree(n) == 0 and dg.out_degree(n) == 0]
    
    print(f"\n节点类型:")
    print(f"  源点(只有出边): {len(sources)} 个")
    print(f"  汇点(只有入边): {len(sinks)} 个")
    print(f"  孤立点: {len(isolated)} 个")
    
    # 环检测
    print(f"\n环检测:")
    try:
        cycles = list(nx.simple_cycles(dg))
        print(f"  环数量: {len(cycles)}")
        if cycles:
            cycle_lengths = [len(c) for c in cycles]
            print(f"  环长度分布: min={min(cycle_lengths)}, max={max(cycle_lengths)}, avg={sum(cycle_lengths)/len(cycle_lengths):.1f}")
    except Exception as e:
        print(f"  环检测失败: {e}")
    
    return dg


def test_edge_cases(dg):
    """测试边界情况"""
    print("\n" + "=" * 70)
    print("Round 2: Edge Case Testing")
    print("=" * 70)
    
    # 测试场景
    test_cases = [
        ("孤立节点", [n for n in dg.nodes() if dg.in_degree(n) == 0 and dg.out_degree(n) == 0][:1]),
        ("叶子节点", [n for n in dg.nodes() if dg.out_degree(n) == 0 and dg.in_degree(n) > 0][:1]),
        ("源点", [n for n in dg.nodes() if dg.in_degree(n) == 0 and dg.out_degree(n) > 0][:1]),
        ("高度数节点", sorted(dg.nodes(), key=lambda n: dg.out_degree(n), reverse=True)[:1]),
        ("不存在的节点", ["NON_EXISTENT_NODE"]),
        ("空列表", []),
    ]
    
    simulator = OptimizedSimulationEngine(dg)
    
    for name, failure_nodes in test_cases:
        if not failure_nodes:
            continue
            
        print(f"\n测试: {name}")
        print(f"  故障节点: {failure_nodes[0][:30] if failure_nodes else 'N/A'}...")
        
        start = time.perf_counter()
        try:
            result = simulator.simulate(failure_nodes, max_ticks=100)
            elapsed = (time.perf_counter() - start) * 1000
            
            print(f"  耗时: {elapsed:.2f}ms")
            print(f"  影响管线: {result.affected_pipes}")
            print(f"  帧数: {len(result.frames)}")
            print(f"  检测到环: {result.metrics.cycle_detected}")
            
            if result.metrics.cycle_detected:
                print(f"  环节点数: {len(result.metrics.cycle_nodes)}")
            
        except Exception as e:
            print(f"  错误: {e}")


def test_multi_failure(dg):
    """测试多故障源"""
    print("\n" + "=" * 70)
    print("Round 3: Multi-Failure Testing")
    print("=" * 70)
    
    # 找几个距离较远的源点
    sources = [n for n in dg.nodes() if dg.in_degree(n) == 0 and dg.out_degree(n) > 0]
    
    test_configs = [
        ("单故障", sources[:1]),
        ("双故障", sources[:2] if len(sources) >= 2 else sources[:1]),
        ("三故障", sources[:3] if len(sources) >= 3 else sources[:1]),
    ]
    
    simulator = OptimizedSimulationEngine(dg)
    
    for name, failure_nodes in test_configs:
        if not failure_nodes:
            continue
            
        print(f"\n{name}: {len(failure_nodes)} 个故障源")
        
        start = time.perf_counter()
        result = simulator.simulate(failure_nodes, max_ticks=500)
        elapsed = (time.perf_counter() - start) * 1000
        
        print(f"  耗时: {elapsed:.2f}ms")
        print(f"  影响管线: {result.affected_pipes}")
        print(f"  总 ticks: {result.total_ticks}")
        print(f"  传播路径数: {result.metrics.total_propagation_paths}")
        print(f"  最大并发: {result.metrics.max_concurrent_outages}")


def test_simulation_modes(dg):
    """测试不同仿真模式"""
    print("\n" + "=" * 70)
    print("Round 4: Simulation Mode Testing")
    print("=" * 70)
    
    # 找可能触发环的节点
    nodes_with_cycles = []
    try:
        cycles = list(nx.simple_cycles(dg))
        if cycles:
            nodes_with_cycles = cycles[0][:1]  # 取第一个环的第一个节点
    except:
        pass
    
    if not nodes_with_cycles:
        nodes_with_cycles = [n for n in dg.nodes() if dg.out_degree(n) > 0][:1]
    
    modes = [
        SimulationMode.STANDARD,
        SimulationMode.STRICT,
    ]
    
    for mode in modes:
        print(f"\n模式: {mode.value}")
        config = SimulationConfig(mode=mode, detect_cycles=True)
        simulator = OptimizedSimulationEngine(dg, config)
        
        start = time.perf_counter()
        result = simulator.simulate(nodes_with_cycles, max_ticks=200)
        elapsed = (time.perf_counter() - start) * 1000
        
        print(f"  耗时: {elapsed:.2f}ms")
        print(f"  影响管线: {result.affected_pipes}")
        print(f"  检测到环: {result.metrics.cycle_detected}")


def test_performance_stress(dg):
    """压力测试"""
    print("\n" + "=" * 70)
    print("Round 5: Performance Stress Testing")
    print("=" * 70)
    
    # 找最高度数的节点
    top_nodes = sorted(dg.nodes(), key=lambda n: dg.out_degree(n), reverse=True)[:5]
    
    print("\n单节点多次仿真（测试缓存效果）:")
    simulator = OptimizedSimulationEngine(dg)
    
    times = []
    for i in range(5):
        start = time.perf_counter()
        result = simulator.simulate([top_nodes[0]], max_ticks=1000)
        elapsed = (time.perf_counter() - start) * 1000
        times.append(elapsed)
        print(f"  第{i+1}次: {elapsed:.2f}ms (影响{result.affected_pipes}条)")
    
    print(f"\n  平均: {sum(times)/len(times):.2f}ms")
    print(f"  最快: {min(times):.2f}ms")
    print(f"  最慢: {max(times):.2f}ms")
    
    # 大图测试
    print("\n全量节点测试:")
    start = time.perf_counter()
    all_nodes = list(dg.nodes())[:10]  # 限制数量
    result = simulator.simulate(all_nodes, max_ticks=100)
    elapsed = (time.perf_counter() - start) * 1000
    print(f"  10节点同时故障: {elapsed:.2f}ms, 影响{result.affected_pipes}条")


def analyze_frame_distribution(dg):
    """分析帧分布"""
    print("\n" + "=" * 70)
    print("Round 6: Frame Distribution Analysis")
    print("=" * 70)
    
    # 找一个中等影响的节点
    nodes = list(dg.nodes())
    simulator = OptimizedSimulationEngine(dg)
    
    # 找一个能产生适中帧数的节点
    best_node = None
    best_frames = 0
    
    for node in nodes[:20]:  # 采样测试
        result = simulator.simulate([node], max_ticks=500)
        if 5 < len(result.frames) < 50:  # 找适中帧数的
            best_node = node
            best_frames = len(result.frames)
            break
    
    if best_node:
        result = simulator.simulate([best_node], max_ticks=1000)
        
        print(f"\n样本节点: {best_node[:30]}...")
        print(f"总帧数: {len(result.frames)}")
        
        # 分析每帧变化数
        changes_per_frame = [len(f.changed_pipes) for f in result.frames]
        print(f"\n每帧变化统计:")
        print(f"  最小: {min(changes_per_frame)}")
        print(f"  最大: {max(changes_per_frame)}")
        print(f"  平均: {sum(changes_per_frame)/len(changes_per_frame):.1f}")
        
        # 变化类型分布
        normal_to_dep = 0
        dep_to_outage = 0
        
        for frame in result.frames:
            for change in frame.changed_pipes.values():
                if change['from'] == 'normal' and change['to'] == 'depressurizing':
                    normal_to_dep += 1
                elif change['from'] == 'depressurizing' and change['to'] == 'outage':
                    dep_to_outage += 1
        
        print(f"\n状态跃迁统计:")
        print(f"  normal → depressurizing: {normal_to_dep}")
        print(f"  depressurizing → outage: {dep_to_outage}")
        
        # 时间分布
        if len(result.frames) > 5:
            print(f"\n关键时间点:")
            print(f"  Tick 0 (初始): {len(result.frames[0].changed_pipes)} 条变化")
            print(f"  Tick {len(result.frames)//2} (中期): {len(result.frames[len(result.frames)//2].changed_pipes)} 条变化")
            print(f"  Tick {result.total_ticks} (结束): 推演完成")


def main():
    print("Stage 2 Deep Analysis & Stress Testing")
    print("=" * 70)
    
    dg = analyze_graph_structure()
    test_edge_cases(dg)
    test_multi_failure(dg)
    test_simulation_modes(dg)
    test_performance_stress(dg)
    analyze_frame_distribution(dg)
    
    print("\n" + "=" * 70)
    print("Analysis Complete")
    print("=" * 70)


if __name__ == "__main__":
    main()
