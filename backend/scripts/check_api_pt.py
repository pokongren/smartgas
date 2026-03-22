import urllib.request, json

resp = urllib.request.urlopen('http://localhost:8000/api/pipeline-packages')
data = json.loads(resp.read())

for pkg in data:
    layers_info = ', '.join([f"{l['name']}({l['type']}, {len(l['nodes'])}n/{len(l['lines'])}l)" for l in pkg['layers']])
    print(f"{pkg['id']}: {pkg['name']} -> {len(pkg['layers'])} layers: [{layers_info}]")
