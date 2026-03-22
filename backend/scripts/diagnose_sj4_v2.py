import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 查看 SJ4 站场 ID 样本
cur.execute("SELECT id, name, type, longitude, latitude FROM stations WHERE id LIKE 'SJ4%' ORDER BY id LIMIT 20")
print("=== SJ4 站场 ID 样本 ===")
for r in cur.fetchall():
    print(f"  {r[0]}: {r[1]} ({r[2]}) [{r[3]:.4f}, {r[4]:.4f}]")

print()

# 查看 SJ4 管段 ID 样本
cur.execute("SELECT id, name, start_station_id, end_station_id FROM pipelines WHERE id LIKE 'SJ4%' ORDER BY id LIMIT 20")
print("=== SJ4 管段 ID 样本 ===")
for r in cur.fetchall():
    print(f"  {r[0]}: start={r[2]}, end={r[3]}")

print()

# 查看 SJ4 站场 ID 前缀分布
cur.execute("SELECT id FROM stations WHERE id LIKE 'SJ4%'")
ids = [r[0] for r in cur.fetchall()]
prefixes = {}
for sid in ids:
    # 提取前缀（去掉最后的数字）
    parts = sid.rsplit('-', 1)
    prefix = parts[0] if len(parts) > 1 else sid
    prefixes[prefix] = prefixes.get(prefix, 0) + 1

print("=== ID 前缀分布 ===")
for p, cnt in sorted(prefixes.items()):
    print(f"  {p}: {cnt} 个")

# 管段也一样
cur.execute("SELECT id FROM pipelines WHERE id LIKE 'SJ4%'")
pids = [r[0] for r in cur.fetchall()]
pprefixes = {}
for pid in pids:
    parts = pid.rsplit('-', 1)
    prefix = parts[0] if len(parts) > 1 else pid
    pprefixes[prefix] = pprefixes.get(prefix, 0) + 1

print("\n=== 管段 ID 前缀分布 ===")
for p, cnt in sorted(pprefixes.items()):
    print(f"  {p}: {cnt} 个")

conn.close()
