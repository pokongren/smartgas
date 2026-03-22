import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 从前端 TS 文件确认的正确名称
CORRECT_NAMES = {
    'we1':  '西气东输一线',
    'we2':  '西气东输二线',
    'cred': '中俄东线',
    'pt':   '平泰支干线',
    'zg':   '中贵线',
    'zm':   '中缅线',
    'gn':   '广南支干线',
    'gs':   '广深支干线',
    'sj4':  '陕京四线',
}

# 当前名称
cur.execute("SELECT id, name FROM pipeline_systems ORDER BY sort_order")
print("=== 修正前 ===")
changes = []
for r in cur.fetchall():
    correct = CORRECT_NAMES.get(r[0], r[1])
    if correct != r[1]:
        print(f"  {r[0]}: '{r[1]}' → '{correct}' ⚠️")
        changes.append((correct, r[0]))
    else:
        print(f"  {r[0]}: '{r[1]}' ✓")

# 执行修正
for name, sys_id in changes:
    cur.execute("UPDATE pipeline_systems SET name = ? WHERE id = ?", (name, sys_id))

conn.commit()

# 同步更新 layers_config 中的名称
for sys_id, correct_name in CORRECT_NAMES.items():
    cur.execute("SELECT layers_config FROM pipeline_systems WHERE id = ?", (sys_id,))
    row = cur.fetchone()
    if row:
        layers = json.loads(row[0])
        updated = False
        for layer in layers:
            if layer['type'] == 'trunk':
                old_name = layer['name']
                new_name = correct_name + '干线'
                if old_name != new_name:
                    layer['name'] = new_name
                    updated = True
        if updated:
            cur.execute("UPDATE pipeline_systems SET layers_config = ? WHERE id = ?", 
                       (json.dumps(layers, ensure_ascii=False), sys_id))
            print(f"  [layers_config] {sys_id}: 干线名称已更新")

conn.commit()

# 验证
cur.execute("SELECT id, name, sort_order FROM pipeline_systems ORDER BY sort_order")
print("\n=== 修正后 ===")
for r in cur.fetchall():
    print(f"  sort={r[2]} {r[0]}: {r[1]}")

conn.close()
print("\n完成！")
