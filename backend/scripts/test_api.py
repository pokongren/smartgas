"""快速验证 pipeline-packages API"""
import urllib.request
import json

url = "http://localhost:8000/api/pipeline-packages"
try:
    with urllib.request.urlopen(url) as resp:
        data = json.loads(resp.read())
    print(f"Total systems: {len(data)}")
    for pkg in data:
        total_nodes = sum(len(l.get("nodes",[])) for l in pkg["layers"])
        total_lines = sum(len(l.get("lines",[])) for l in pkg["layers"])
        print(f"  {pkg['name']} ({pkg['id']}): {len(pkg['layers'])} layers, {total_nodes} nodes, {total_lines} lines")
    if data and data[0]["layers"] and data[0]["layers"][0]["nodes"]:
        n = data[0]["layers"][0]["nodes"][0]
        print(f"\nSample node: {json.dumps(n, ensure_ascii=False)[:200]}")
    if data and data[0]["layers"] and data[0]["layers"][0]["lines"]:
        l = data[0]["layers"][0]["lines"][0]
        print(f"Sample line: {json.dumps(l, ensure_ascii=False)[:200]}")
except Exception as e:
    print(f"Error: {e}")
