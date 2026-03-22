"""
阶段一：数据探查 - 嘉兴-甪直支线
从 smartgas.db 和 we2_full_structure.json 中查找已有数据
"""
import sqlite3, json, sys, os
sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = 'backend/data/smartgas.db'
conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

# 1. 查 stations 表中是否有嘉兴/甪直相关站场
print("=== stations 表中嘉兴/甪直相关 ===")
cur.execute("""
    SELECT id, name, type, longitude, latitude 
    FROM stations 
    WHERE name LIKE '%嘉兴%' OR name LIKE '%甪直%' OR name LIKE '%嘉善%'
       OR name LIKE '%苏州%' OR name LIKE '%昆山%' OR name LIKE '%太仓%'
""")
for r in cur.fetchall():
    print(f"  {r[0]}: {r[1]} ({r[2]}) [{r[3]}, {r[4]}]")

# 2. 查 node_relation_details
print("\n=== node_relation_details 中甪直/嘉兴相关 ===")
cur.execute("""
    SELECT node_name, mileage, trunk_name, branch_name
    FROM node_relation_details
    WHERE branch_name LIKE '%嘉兴%' OR branch_name LIKE '%甪直%'
       OR node_name LIKE '%甪直%' OR node_name LIKE '%嘉兴%'
    ORDER BY mileage
""")
rows = cur.fetchall()
for r in rows:
    print(f"  {r[0]}: mile={r[1]}, trunk={r[2]}, branch={r[3]}")
print(f"  共 {len(rows)} 条")

# 3. 查 trunk_pipeline_details 和 branch_pipeline_details
print("\n=== trunk/branch_pipeline_details 中嘉兴/甪直相关 ===")
for table in ['trunk_pipeline_details', 'branch_pipeline_details']:
    cur.execute(f"SELECT * FROM {table} LIMIT 0")
    cols = [d[0] for d in cur.description]
    print(f"\n  {table} 列: {cols}")
    
    # 搜索
    for col in cols:
        try:
            cur.execute(f"SELECT * FROM {table} WHERE {col} LIKE '%甪直%' OR {col} LIKE '%嘉兴%甪直%'")
            for r in cur.fetchall():
                print(f"  -> {dict(zip(cols, r))}")
        except:
            pass

# 4. 查 we2_full_structure.json
print("\n=== we2_full_structure.json ===")
struct_path = 'backend/data/we2_full_structure.json'
if os.path.exists(struct_path):
    with open(struct_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 看结构
    print(f"  顶层 keys: {list(data.keys())}")
    
    # 搜索甪直/嘉兴
    def search_json(obj, keywords, path=""):
        results = []
        if isinstance(obj, dict):
            for k, v in obj.items():
                for kw in keywords:
                    if isinstance(v, str) and kw in v:
                        results.append((f"{path}.{k}", v))
                results.extend(search_json(v, keywords, f"{path}.{k}"))
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                results.extend(search_json(item, keywords, f"{path}[{i}]"))
        return results
    
    hits = search_json(data, ['甪直', '嘉兴'])
    print(f"  包含'甪直'或'嘉兴'的字段: {len(hits)} 个")
    for path, val in hits[:20]:
        print(f"    {path}: {val}")
else:
    # 也查 src/data/
    for alt in ['src/data/we2_full_structure.json', 'src/data/we2_structure.json']:
        if os.path.exists(alt):
            print(f"  找到: {alt}")
            with open(alt, 'r', encoding='utf-8') as f:
                data = json.load(f)
            branch_names = data.get('branch_names', [])
            for i, name in enumerate(branch_names):
                if '甪直' in name or '嘉兴' in name:
                    branch = data['branches'][i]
                    print(f"  B{i+1}: {name} ({len(branch)} 节点)")
                    for node in branch[:5]:
                        print(f"    {node['name']}: mile={node['mileage']}, type={node['type']}")
                    if len(branch) > 5:
                        print(f"    ... 还有 {len(branch)-5} 个节点")

conn.close()
