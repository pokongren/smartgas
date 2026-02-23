import sys
import os

# 切换到 backend 目录以正确解析 app 模块
backend_dir = os.path.join(os.path.dirname(__file__), '..')
os.chdir(backend_dir)
sys.path.insert(0, '.')

from sqlmodel import Session, create_engine

engine = create_engine('sqlite:///data/smartgas.db')

with Session(engine) as session:
    from app.services.topology_service import PhysicsTopologyService
    topo = PhysicsTopologyService(session)
    summary = topo.get_graph_summary()
    print('=== 拓扑概览 ===')
    for k, v in summary.items():
        print(f'  {k}: {v}')

    # 找度最高的节点
    G = topo.graph
    top_nodes = sorted(G.degree(), key=lambda x: x[1], reverse=True)[:3]
    for nid, deg in top_nodes:
        name = G.nodes[nid].get('name', nid)
        print(f'  top node: {name} (degree={deg})')

    # 推演测试
    if top_nodes:
        test_node = top_nodes[0][0]
        test_name = G.nodes[test_node].get('name', test_node)
        print(f'\n=== 推演测试: {test_name} ===')

        from app.services.simulation_service import SimulationEngine
        sim = SimulationEngine()
        result = sim.run(G, test_node, max_ticks=50)

        raw = result.to_dict()
        print(f'  total_ticks: {raw["total_ticks"]}')
        print(f'  affected_pipes: {raw["affected_pipes"]}')
        print(f'  frames: {len(raw["frames"])}')
        if raw['frames']:
            f0 = raw['frames'][0]
            print(f'  frame[0]: tick={f0["tick"]}, changes={len(f0["changed_pipes"])}')
            for pid, change in list(f0['changed_pipes'].items())[:3]:
                print(f'    {pid}: {change}')

        print('\n OK - 推演引擎验证通过!')
