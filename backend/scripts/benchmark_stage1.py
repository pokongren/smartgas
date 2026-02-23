"""
阶段一性能基准测试
用于识别性能瓶颈
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import time
from sqlmodel import Session
from app.database import engine
from app.services.topology import TopologyService
from app.services.simulation_service import OptimizedSimulationEngine, run_simulation


def benchmark_topology_build():
    """测试拓扑图构建性能"""
    print("=" * 60)
    print("Benchmark 1: Topology Graph Building")
    print("=" * 60)
    
    session = Session(engine)
    
    # 测试无向图构建
    start = time.perf_counter()
    topo = TopologyService(session)
    _ = topo.graph
    elapsed = time.perf_counter() - start
    print(f"  Undirected Graph: {elapsed*1000:.2f} ms")
    
    # 测试有向图构建
    start = time.perf_counter()
    dg = topo.get_directed_graph()
    elapsed = time.perf_counter() - start
    print(f"  Directed Graph:   {elapsed*1000:.2f} ms")
    
    print(f"  Nodes: {len(dg.nodes)}, Edges: {len(dg.edges)}")
    
    return topo


def benchmark_simulation(topo, iterations=5):
    """测试仿真性能"""
    print("\n" + "=" * 60)
    print("Benchmark 2: Simulation Engine")
    print("=" * 60)
    
    dg = topo.get_directed_graph()
    
    # 找几个不同出度的节点
    nodes_by_degree = sorted(
        [(n, dg.out_degree(n)) for n in dg.nodes()],
        key=lambda x: x[1], reverse=True
    )
    
    test_nodes = [
        nodes_by_degree[0],   # 高度数
        nodes_by_degree[len(nodes_by_degree)//2],  # 中度数
        nodes_by_degree[-1],  # 低度数
    ]
    
    for node, degree in test_nodes:
        times = []
        for _ in range(iterations):
            start = time.perf_counter()
            result = run_simulation(topo, node, tick_minutes=10)
            elapsed = time.perf_counter() - start
            times.append(elapsed)
        
        avg_time = sum(times) / len(times) * 1000
        print(f"  Node {node[:20]:20} (out-degree={degree:2}): {avg_time:8.2f} ms")
        print(f"    -> Affected pipes: {result.affected_pipes}, Frames: {len(result.frames)}")


def benchmark_memory():
    """测试内存使用"""
    print("\n" + "=" * 60)
    print("Benchmark 3: Memory Usage (approximate)")
    print("=" * 60)
    
    import sys
    session = Session(engine)
    topo = TopologyService(session)
    dg = topo.get_directed_graph()
    
    # 估算图大小
    node_size = sys.getsizeof(dg.nodes)
    edge_size = sys.getsizeof(dg.edges)
    
    # 采样估算边数据大小
    sample_edges = list(dg.edges(data=True))[:10]
    avg_edge_data_size = sum(sys.getsizeof(d) for _, _, d in sample_edges) / len(sample_edges)
    total_edge_data_size = avg_edge_data_size * len(dg.edges)
    
    total_size = node_size + edge_size + total_edge_data_size
    
    print(f"  Nodes structure:     {node_size/1024:.2f} KB")
    print(f"  Edges structure:     {edge_size/1024:.2f} KB")
    print(f"  Edge data (avg):     {avg_edge_data_size:.0f} bytes/edge")
    print(f"  Edge data (total):   {total_edge_data_size/1024:.2f} KB")
    print(f"  Estimated total:     {total_size/1024:.2f} KB")


def main():
    print("Stage 1 Performance Benchmark")
    print("=" * 60)
    
    topo = benchmark_topology_build()
    benchmark_simulation(topo)
    benchmark_memory()
    
    print("\n" + "=" * 60)
    print("Benchmark Complete")
    print("=" * 60)


if __name__ == "__main__":
    main()
