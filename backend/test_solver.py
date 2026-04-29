import json, sys
sys.path.insert(0, 'f:/smartgas-grid/backend')
from app.services.topology_simulation import SteadyStateSolver, _apply_scenario

seed = json.load(open('f:/smartgas-grid/backend/data/pilots/we1_mainline_zhongwei_jingbian_seed.json', 'r', encoding='utf-8'))
s = SteadyStateSolver(seed=seed, pilot_id='test')

nodes, edges, valves = _apply_scenario(
    s._base_nodes, s._base_edges, s._base_valves,
    {'id': 'steady_base', 'node_overrides': [], 'edge_overrides': [], 'compressor_overrides': []}
)

segs = s._build_station_segments(nodes, edges)
print(f"segments: {len(segs)}")
for seg in segs:
    print(f"  {seg['upstream_id']} -> {seg['downstream_id']}: edges={len(seg['edge_ids'])} L={seg['total_length_km']}km status={seg['status']}")
    print(f"    first 3 edges: {seg['edge_ids'][:3]}")

print("\n=== All 4 scenarios ===")
for scenario_id in ['steady_base', 'zhongwei_compressor_offline', 'zhongwei_trunk_break', 'yanchi_jingbian_limited']:
    r = s.solve(scenario_id)
    print(f"\n--- {scenario_id} ---  status={r.solver_status} iters={r.iterations}")
    for n in r.nodes:
        delta = n.pressure_mpa - n.pressure_in_mpa
        print(f"  {n.node_id}: Pin={n.pressure_in_mpa:.3f} Pout={n.pressure_mpa:.3f} delta={delta:+.3f} alert={n.alert_level}")
    edge_sample = [e for e in r.edges if e.flow_rate > 0][:3]
    for e in edge_sample:
        print(f"  edge {e.edge_id}: flow={e.flow_rate:.1f} util={e.utilization:.3f}")
    print(f"  summary: supply={r.summary['total_supply']:.1f} demand={r.summary['total_demand']:.1f} unserved={r.summary['unserved_demand']:.1f} alerts={r.summary['alert_count']}")
