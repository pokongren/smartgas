"""
西气东输三线 (WE3) - 局部数据写入脚本

只画出用户要求的 永清 → 琉璃河 → 高丽营 段（北京南部环线）。
西三线全长约 7378km (西段+东段)，管径 1219mm。
本脚本仅写入北京周边段，约 120km。

管线走向: 永清(河北) → 琉璃河(房山) → 良乡 → 长阳 → 高丽营(顺义)
"""
import sqlite3
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = os.path.join(os.getcwd(), 'backend', 'data', 'smartgas.db')
SYSTEM_ID = 'we3'
SYSTEM_NAME = '西气东输三线'
SYSTEM_COLOR = '#26A69A'  # 青绿色
ID_PREFIX = 'WE3'

# ============================================================
# 站场数据（永清-琉璃河-高丽营段）
# ============================================================
TRUNK_STATIONS = [
    # (序号, 名称, 类型, 经度, 纬度)
    (1,  '西三永清压气站',     'compressor',    116.50, 39.32),
    (2,  '西三1#阀室',         'valve',         0, 0),
    (3,  '西三2#阀室',         'valve',         0, 0),
    (4,  '固安分输站',         'distribution',  116.30, 39.44),
    (5,  '西三3#阀室',         'valve',         0, 0),
    (6,  '西三4#阀室',         'valve',         0, 0),
    (7,  '琉璃河分输站',       'distribution',  116.00, 39.60),
    (8,  '西三5#阀室',         'valve',         0, 0),
    (9,  '西三6#阀室',         'valve',         0, 0),
    (10, '良乡分输站',         'distribution',  116.13, 39.73),
    (11, '西三7#阀室',         'valve',         0, 0),
    (12, '西三8#阀室',         'valve',         0, 0),
    (13, '长阳分输站',         'distribution',  116.18, 39.85),
    (14, '西三9#阀室',         'valve',         0, 0),
    (15, '西三10#阀室',        'valve',         0, 0),
    (16, '西沙屯分输站',       'distribution',  116.23, 40.02),
    (17, '西三11#阀室',        'valve',         0, 0),
    (18, '西三12#阀室',        'valve',         0, 0),
    (19, '高丽营压气站',       'compressor',    116.53, 40.18),
]


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 清理旧数据
    cur.execute("DELETE FROM pipeline_systems WHERE id = ?", (SYSTEM_ID,))
    cur.execute("DELETE FROM pipelines WHERE id LIKE ?", (f"{ID_PREFIX}%",))
    cur.execute("DELETE FROM stations WHERE id LIKE ?", (f"{ID_PREFIX}%",))

    # 注册管线系统
    cur.execute("SELECT MAX(sort_order) FROM pipeline_systems")
    max_sort = cur.fetchone()[0] or 0

    layers_config = json.dumps([
        {"id_prefix": ID_PREFIX, "name": f"{SYSTEM_NAME}（局部）", "type": "trunk", "visible": True},
    ], ensure_ascii=False)

    cur.execute("""
        INSERT INTO pipeline_systems (id, name, color, sort_order, layers_config)
        VALUES (?, ?, ?, ?, ?)
    """, (SYSTEM_ID, SYSTEM_NAME, SYSTEM_COLOR, max_sort + 1, layers_config))
    print(f"✅ 注册管线系统: {SYSTEM_NAME} (sort={max_sort + 1})")

    # 写入站场
    for seq, name, stype, lng, lat in TRUNK_STATIONS:
        sid = f"{ID_PREFIX}-{seq}"
        cur.execute("""
            INSERT INTO stations (id, name, type, longitude, latitude)
            VALUES (?, ?, ?, ?, ?)
        """, (sid, name, stype, lng, lat))
    print(f"✅ 写入站场: {len(TRUNK_STATIONS)} 个")

    # 写入管段
    for i in range(len(TRUNK_STATIONS) - 1):
        seg_id = f"{ID_PREFIX}-T-{i + 1}"
        start_id = f"{ID_PREFIX}-{TRUNK_STATIONS[i][0]}"
        end_id = f"{ID_PREFIX}-{TRUNK_STATIONS[i + 1][0]}"
        seg_name = f"{SYSTEM_NAME}（局部）-段{i + 1}"
        cur.execute("""
            INSERT INTO pipelines (id, name, start_station_id, end_station_id,
                                   diameter_mm, length_km, diameter, length, category)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (seg_id, seg_name, start_id, end_id, 1219, 0, 1219, 0, SYSTEM_NAME))
    print(f"✅ 写入管段: {len(TRUNK_STATIONS) - 1} 条")
    conn.commit()

    # 坐标均分插值
    trunk_ids = [f"{ID_PREFIX}-{s[0]}" for s in TRUNK_STATIONS]
    anchors = []
    for i, sid in enumerate(trunk_ids):
        cur.execute("SELECT longitude, latitude FROM stations WHERE id = ?", (sid,))
        r = cur.fetchone()
        if r and r[0] != 0 and r[1] != 0:
            anchors.append({'index': i, 'lng': r[0], 'lat': r[1]})

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

    # 验证
    cur.execute("SELECT COUNT(*) FROM stations WHERE id LIKE ? AND (longitude = 0 OR latitude = 0)", (f"{ID_PREFIX}%",))
    zero = cur.fetchone()[0]
    print(f"\n=== 验证: 零坐标={zero} ===")

    for seq, name, *_ in TRUNK_STATIONS:
        sid = f"{ID_PREFIX}-{seq}"
        cur.execute("SELECT longitude, latitude FROM stations WHERE id = ?", (sid,))
        r = cur.fetchone()
        print(f"  {sid}: {name:<18} ({r[0]:.4f}, {r[1]:.4f})")

    conn.close()
    print(f"\n🎉 完成！刷新前端页面查看 '{SYSTEM_NAME}'")


if __name__ == '__main__':
    main()
