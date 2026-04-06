import urllib.request, json, time

start = time.time()
try:
    r = urllib.request.urlopen('http://localhost:8080/api/pipeline-packages', timeout=15)
    data = json.loads(r.read())
    elapsed = time.time() - start
    print(f'OK ({elapsed:.1f}s): {len(data)} packages')
    for pkg in data[:3]:
        nodes = sum(len(layer.get('nodes', [])) for layer in pkg.get('layers', []))
        print(f"  {pkg['name']}: {len(pkg['layers'])} layers, {nodes} nodes")
except Exception as e:
    print(f'ERROR ({time.time()-start:.1f}s):', e)
