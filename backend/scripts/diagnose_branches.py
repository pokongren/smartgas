import json, os, re

pipelines = [
    ('zg', 'src/data/zg_structure.json', 'src/data/pipelines/zg.ts'),
    ('zm', 'src/data/zm_structure.json', 'src/data/pipelines/zm.ts'),
    ('gn', 'src/data/gn_structure.json', 'src/data/pipelines/gn.ts'),
    ('gs', 'src/data/gs_structure.json', 'src/data/pipelines/gs.ts'),
]

broken = 0
for pid, jp, tp in pipelines:
    if not os.path.exists(jp): continue
    coords = set()
    with open(tp, 'r', encoding='utf-8') as f:
        for m in re.finditer(r"'([^']+)':\s*\{\s*lng:", f.read()):
            coords.add(m.group(1))
    data = json.load(open(jp, encoding='utf-8'))
    for i, branch in enumerate(data.get('branches', [])):
        bn = data['branch_names'][i]
        anchors = [n for n in branch if n['name'] in coords]
        if len(anchors) < 2:
            broken += 1
            all_names = [n['name'] for n in branch]
            missing = [n for n in all_names if n not in coords]
            print(f"BROKEN: {pid} | {bn}")
            print(f"  all nodes: {all_names}")
            print(f"  missing coords: {missing}")
            print(f"  has coords: {[n for n in all_names if n in coords]}")

if broken == 0:
    print("ALL BRANCHES OK - no broken branches!")
else:
    print(f"\nTotal broken: {broken}")
