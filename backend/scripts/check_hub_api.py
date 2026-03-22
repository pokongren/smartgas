"""验证 API 返回的 isHub 字段"""
import urllib.request, json, sys
sys.stdout.reconfigure(encoding='utf-8')

r = json.loads(urllib.request.urlopen('http://localhost:8000/api/pipeline-packages').read())
total_nodes = 0
total_hubs = 0

for pkg in r:
    nodes = [n for l in pkg['layers'] for n in l['nodes']]
    hubs = [n for n in nodes if n.get('isHub')]
    if hubs:
        print(f"\n{pkg['name']} ({pkg['id']}): {len(hubs)} 枢纽 / {len(nodes)} 节点")
        for h in hubs:
            info = h.get('hubInfo', {})
            junc = '🔷跨管线' if info.get('isJunction') else '⭐管内'
            jname = f" [{info.get('junctionName')}]" if info.get('junctionName') else ''
            print(f"  {junc} {h['name']} 度数={info.get('degree',0)}{jname}")
    total_nodes += len(nodes)
    total_hubs += len(hubs)

print(f"\n总计: {total_hubs} 枢纽 / {total_nodes} 节点")
