import json

d = json.load(open('src/data/gn_structure.json', encoding='utf-8'))

# 按里程重新排序干线
d['trunk'].sort(key=lambda n: n['mileage'])

with open('src/data/gn_structure.json', 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

for n in d['trunk']:
    tag = '*' if n['type'] in ('compressor', 'distribution') else ' '
    print(f"{tag} {n['mileage']:>8.1f}  {n['name']}")
