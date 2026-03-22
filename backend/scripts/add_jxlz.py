"""
嘉兴-甪直联络线 - 数据库导入脚本

管线走向: 嘉兴 → 嘉善 → 吴江 → 苏州(甪直)
全长约 120km
属于西二线体系的联络线

坐标获取策略:
- 压气站/分输站: 按站场所在城市名，搜索默认经纬度
- 阀室: 锚点之间均分插值
"""
import sqlite3
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = os.path.join(os.getcwd(), 'backend', 'data', 'smartgas.db')
if not os.path.exists(DB_PATH):
    DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'smartgas.db')

# ============================================================
# 管线基本信息
# ============================================================
SYSTEM_ID = 'jxlz'
SYSTEM_NAME = '嘉兴-甪直联络线'
SYSTEM_COLOR = '#26C6DA'  # 青蓝色
ID_PREFIX = 'JXLZ'

# ============================================================
# 站场数据
# 坐标来源: 按站场所在城市名搜索默认经纬度
# ============================================================
# 嘉兴: 120.76, 30.77 (数据库 NCSH-21 已有)
# 嘉善: 120.92, 30.85 (搜索: 嘉善县经纬度)
# 吴江: 120.64, 31.16 (搜索: 吴江区经纬度)
# 甪直: 120.86, 31.27 (搜索: 甪直镇经纬度，数据库 WE1-179 已有)

TRUNK_STATIONS = [
    # (序号, 名称, 类型, 经度, 纬度)
    (1,  '嘉兴分输站',   'distribution', 120.76, 30.77),
    (2,  '嘉兴甪直1#阀室', 'valve',     0, 0),
    (3,  '嘉兴甪直2#阀室', 'valve',     0, 0),
    (4,  '嘉善分输站',   'distribution', 120.92, 30.85),
    (5,  '嘉兴甪直3#阀室', 'valve',     0, 0),
    (6,  '嘉兴甪直4#阀室', 'valve',     0, 0),
    (7,  '嘉兴甪直5#阀室', 'valve',     0, 0),
    (8,  '吴江分输站',   'distribution', 120.64, 31.16),
    (9,  '嘉兴甪直6#阀室', 'valve',     0, 0),
    (10, '嘉兴甪直7#阀室', 'valve',     0, 0),
    (11, '甪直联络站',   'distribution', 120.86, 31.27),
]


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # ============================================================
    # Step 1: 注册管线系统
    # ============================================================
    cur.execute("SELECT id FROM pipeline_systems WHERE id = ?", (SYSTEM_ID,))
    if cur.fetchone():
        print(f"⚠️  管线系统 '{SYSTEM_ID}' 已存在，跳过注册")
    else:
        cur.execute("SELECT MAX(sort_order) FROM pipeline_systems")
        max_sort = cur.fetchone()[0] or 0

        layers_config = json.dumps([
            {"id_prefix": ID_PREFIX, "name": f"{SYSTEM_NAME}干线", "type": "trunk", "visible": True},
        ], ensure_ascii=False)

        cur.execute("""
            INSERT INTO pipeline_systems (id, name, color, sort_order, layers_config)
            VALUES (?, ?, ?, ?, ?)
        """, (SYSTEM_ID, SYSTEM_NAME, SYSTEM_COLOR, max_sort + 1, layers_config))
        print(f"✅ 注册管线系统: {SYSTEM_NAME} (sort={max_sort + 1})")

    conn.commit()

    # ============================================================
    # Step 2: 写入站场
    # ============================================================
    station_count = 0
    for seq, name, stype, lng, lat in TRUNK_STATIONS:
        sid = f"{ID_PREFIX}-{seq}"
        cur.execute("SELECT id FROM stations WHERE id = ?", (sid,))
        if not cur.fetchone():
            cur.execute("""
                INSERT INTO stations (id, name, type, longitude, latitude)
                VALUES (?, ?, ?, ?, ?)
            """, (sid, name, stype, lng, lat))
            station_count += 1
    print(f"✅ 写入站场: {station_count} 个")
    conn.commit()

    # ============================================================
    # Step 3: 写入管段
    # ============================================================
    segment_count = 0
    for i in range(len(TRUNK_STATIONS) - 1):
        seg_id = f"{ID_PREFIX}-T-{i + 1}"
        start_id = f"{ID_PREFIX}-{TRUNK_STATIONS[i][0]}"
        end_id = f"{ID_PREFIX}-{TRUNK_STATIONS[i + 1][0]}"
        seg_name = f"{SYSTEM_NAME}-段{i + 1}"

        cur.execute("SELECT id FROM pipelines WHERE id = ?", (seg_id,))
        if not cur.fetchone():
            cur.execute("""
                INSERT INTO pipelines (id, name, start_station_id, end_station_id,
                                       diameter_mm, length_km, diameter, length, category)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (seg_id, seg_name, start_id, end_id, 1016, 0, 1016, 0, SYSTEM_NAME))
            segment_count += 1

    print(f"✅ 写入管段: {segment_count} 条")
    conn.commit()

    # ============================================================
    # Step 4: 坐标均分插值
    # ============================================================
    trunk_ids = [f"{ID_PREFIX}-{s[0]}" for s in TRUNK_STATIONS]

    # 收集锚点
    anchors = []
    for i, sid in enumerate(trunk_ids):
        cur.execute("SELECT longitude, latitude FROM stations WHERE id = ?", (sid,))
        r = cur.fetchone()
        if r and r[0] != 0 and r[1] != 0:
            anchors.append({'index': i, 'lng': r[0], 'lat': r[1]})

    # 均分插值
    fixed = 0
    for a in range(len(anchors) - 1):
        curr = anchors[a]
        nxt = anchors[a + 1]
        mid_count = nxt['index'] - curr['index'] - 1
        if mid_count <= 0:
            continue
        for k, j in enumerate(range(curr['index'] + 1, nxt['index']), start=1):
            ratio = k / (mid_count + 1)
            new_lng = round(curr['lng'] + (nxt['lng'] - curr['lng']) * ratio, 6)
            new_lat = round(curr['lat'] + (nxt['lat'] - curr['lat']) * ratio, 6)
            sid = trunk_ids[j]
            cur.execute("UPDATE stations SET longitude = ?, latitude = ? WHERE id = ? AND longitude = 0",
                        (new_lng, new_lat, sid))
            if cur.rowcount > 0:
                fixed += 1

    conn.commit()
    print(f"✅ 坐标均分插值: {fixed} 个")

    # ============================================================
    # 验证
    # ============================================================
    cur.execute("SELECT COUNT(*) FROM stations WHERE id LIKE ?", (f"{ID_PREFIX}%",))
    total_stations = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM pipelines WHERE id LIKE ?", (f"{ID_PREFIX}%",))
    total_segments = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM stations WHERE id LIKE ? AND (longitude = 0 OR latitude = 0)", (f"{ID_PREFIX}%",))
    zero_coords = cur.fetchone()[0]

    print(f"\n=== 验证 ===")
    print(f"  站场总数: {total_stations}")
    print(f"  管段总数: {total_segments}")
    print(f"  零坐标:   {zero_coords}")

    # 显示所有站场坐标
    print(f"\n=== 站场坐标 ===")
    cur.execute("SELECT id, name, type, longitude, latitude FROM stations WHERE id LIKE ? ORDER BY id", (f"{ID_PREFIX}%",))
    for r in cur.fetchall():
        marker = '📍' if r[2] != 'valve' else '  '
        print(f"  {marker} {r[0]}: {r[1]} ({r[2]}) [{r[3]:.4f}, {r[4]:.4f}]")

    conn.close()
    print(f"\n完成！刷新前端页面查看 '{SYSTEM_NAME}'")


if __name__ == '__main__':
    main()
