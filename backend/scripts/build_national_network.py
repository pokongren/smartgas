"""
联合拓扑图构建服务

从数据库加载全量站场 + 管段 + 联络组，构建全国联合拓扑图。
支持 find_path + exclude_nodes 进行截断推演。
"""
import sqlite3
import json
import sys
import os

# 添加项目根目录到 path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.services.topology_computation import (
    TopologyGraph, TopoNode, TopoEdge,
    NodeType, EdgeType, PathAlgorithm
)


def build_national_network(db_path: str = 'backend/data/smartgas.db') -> TopologyGraph:
    """
    构建全国联合拓扑图（含跨管线联络边）
    
    流程:
    1. 加载全量站场 → TopologyGraph 节点
    2. 加载全量管段 → TopologyGraph 边
    3. 加载 junction_groups → 添加虚拟互联边
    
    Returns:
        TopologyGraph (无向图，用于连通性分析和路径查找)
    """
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    
    # 使用无向图（截断推演需要双向路径搜索）
    graph = TopologyGraph(directed=False)
    
    # 1. 加载站场
    cur.execute("SELECT id, name, type, longitude, latitude FROM stations WHERE longitude != 0 AND latitude != 0")
    stations = cur.fetchall()
    
    type_map = {
        'source': NodeType.SOURCE,
        'compressor': NodeType.COMPRESSOR,
        'distribution': NodeType.DISTRIBUTION,
        'valve': NodeType.VALVE,
        'storage': NodeType.STORAGE,
    }
    
    for sid, name, stype, lng, lat in stations:
        node = TopoNode(
            id=sid,
            name=name,
            node_type=type_map.get(stype, NodeType.JUNCTION),
            longitude=lng,
            latitude=lat,
        )
        graph.add_node(node)
    
    # 2. 加载管段
    cur.execute("""
        SELECT id, name, start_station_id, end_station_id, 
               COALESCE(diameter_mm, diameter, 1016), 
               COALESCE(length_km, length/1000.0, 0),
               COALESCE(design_pressure_mpa, 10.0),
               category
        FROM pipelines
    """)
    pipelines = cur.fetchall()
    
    for pid, name, start_id, end_id, diameter, length, pressure, category in pipelines:
        # 跳过端点不在图中的管段
        if start_id not in [n[0] for n in stations] or end_id not in [n[0] for n in stations]:
            continue
            
        edge = TopoEdge(
            id=pid,
            source=start_id,
            target=end_id,
            name=name,
            edge_type=EdgeType.TRUNK if 'trunk' in (category or '').lower() or '-T-' in pid else EdgeType.BRANCH,
            length_km=length if length else 0.0,
            diameter_mm=diameter if diameter else 1016.0,
            design_pressure_mpa=pressure if pressure else 10.0,
        )
        graph.add_edge(edge)
    
    # 3. 加载联络组，添加虚拟互联边
    cur.execute("SELECT id, name, station_ids FROM junction_groups")
    junctions = cur.fetchall()
    
    junction_edges = 0
    for jid, jname, ids_json in junctions:
        ids = json.loads(ids_json)
        # 在组内所有站场之间添加虚拟互联边
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                if ids[i] in graph._nodes and ids[j] in graph._nodes:
                    edge = TopoEdge(
                        id=f"JUNCTION-{jid}-{i}-{j}",
                        source=ids[i],
                        target=ids[j],
                        name=f"{jname}互联",
                        edge_type=EdgeType.INTERCONNECT,
                        length_km=0.1,  # 虚拟短边
                        diameter_mm=1016.0,
                        design_pressure_mpa=10.0,
                    )
                    graph.add_edge(edge)
                    junction_edges += 1
    
    conn.close()
    
    return graph, {
        'stations': len(stations),
        'pipelines': len(pipelines),
        'junction_groups': len(junctions),
        'junction_edges': junction_edges,
        'graph_nodes': graph.node_count,
        'graph_edges': graph.edge_count,
    }


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    
    print("=" * 60)
    print("构建全国联合拓扑图")
    print("=" * 60)
    
    graph, stats = build_national_network()
    
    print(f"\n📊 统计:")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    
    # 检查连通性
    import networkx as nx
    components = list(nx.connected_components(graph.graph))
    print(f"\n🔗 连通分量: {len(components)}")
    for i, comp in enumerate(sorted(components, key=len, reverse=True)[:5]):
        print(f"  分量 #{i+1}: {len(comp)} 节点")
    
    # ============================================================
    # 验证: find_path + exclude_nodes = 靖边 → 观察绕行
    # ============================================================
    print(f"\n{'='*60}")
    print("🧪 截断推演验证: 靖边截断")
    print("="*60)
    
    # 靖边相关站场
    jingbian_nodes = ['SJ4-1022', 'WE1-92']  # 陕京靖边首站, 西一靖边压气站
    
    # 选择源和目标
    source = 'SJ4-1022'  # 陕京靖边首站
    target = 'SJ4-1077'  # 高丽营分输站（SJ4 末站）
    
    # 截断前
    print(f"\n📍 源: {source} (陕京靖边首站)")
    print(f"📍 目标: {target} (高丽营分输站)")
    
    result = graph.find_path(source, target)
    if result:
        print(f"\n✅ 截断前路径: {result.total_length:.1f} km, {len(result.path)} 节点")
        print(f"  路径: {' → '.join(result.path_names[:8])}{'...' if len(result.path_names) > 8 else ''}")
    else:
        print(f"\n❌ 截断前无路径")
    
    # 截断后（排除靖边相关节点）
    # 创建排除节点后的子图
    print(f"\n🔴 截断节点: {jingbian_nodes}")
    
    # NetworkX 直接操作：移除节点后查找路径
    import copy
    g_copy = graph.graph.copy()
    for node in jingbian_nodes:
        if node in g_copy:
            g_copy.remove_node(node)
    
    try:
        path_after = nx.shortest_path(g_copy, source=target, target=source, weight='weight')
        # 这里 source 被删了，所以直接查找其他替代路径
    except:
        pass
    
    # 更好的测试：从 SJ4 的鄂尔多斯到高丽营
    alt_source = 'SJ4-1033'  # 鄂尔多斯压气站
    print(f"\n📍 替代源: {alt_source} (鄂尔多斯压气站)")
    print(f"📍 目标: {target} (高丽营分输站)")
    
    # 截断前
    result_before = graph.find_path(alt_source, target)
    if result_before:
        print(f"\n✅ 截断前: {result_before.total_length:.1f} km, {len(result_before.path)} 节点")
        print(f"  {' → '.join(result_before.path_names[:10])}{'...' if len(result_before.path_names) > 10 else ''}")
    
    # 截断后
    try:
        path_after = nx.shortest_path(g_copy, alt_source, target, weight='weight')
        length_after = sum(g_copy[path_after[i]][path_after[i+1]].get('weight', 0) for i in range(len(path_after)-1))
        names_after = [graph._nodes[n].name if n in graph._nodes else n for n in path_after]
        print(f"\n🟢 截断后绕行: {length_after:.1f} km, {len(path_after)} 节点")
        print(f"  {' → '.join(names_after[:10])}{'...' if len(names_after) > 10 else ''}")
        
        if result_before:
            extra = length_after - result_before.total_length
            print(f"\n📊 额外里程: +{extra:.1f} km")
    except nx.NetworkXNoPath:
        print(f"\n❌ 截断后无替代路径! 完全断供")
    except nx.NodeNotFound as e:
        print(f"\n⚠️ 节点不在子图中: {e}")
    
    print(f"\n{'='*60}")
    print("验证完成!")
