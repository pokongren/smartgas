"""
陕京三线 (SJ3) - 数据库写入脚本

按 Pipeline Master System 工作流阶段二执行：
1. 注册管线系统 → pipeline_systems 表
2. 写入站场 → stations 表
3. 写入管段 → pipelines 表
4. 执行坐标均分插值

管线走向: 榆林 → 临县 → 阳曲(太原) → 石家庄 → 安平 → 永清 → 良乡 → 西沙屯(北京)
全长约 860km，1016mm 管径
"""
import sqlite3
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = os.path.join(os.getcwd(), 'backend', 'data', 'smartgas.db')
if not os.path.exists(DB_PATH):
    DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'backend', 'data', 'smartgas.db')
SYSTEM_ID = 'sj3'
SYSTEM_NAME = '陕京三线'
SYSTEM_COLOR = '#78909C'  # 蓝灰色
ID_PREFIX = 'SJ3'

# ============================================================
# 1. 站场数据
# ============================================================
# 锚点坐标来自真实管线地理位置（搜索城市坐标获得）
# 阀室坐标设为 (0, 0)，后续通过均分插值计算

TRUNK_STATIONS = [
    # (序号, 名称, 类型, 经度, 纬度)
    (1,  '榆林首站',       'compressor',    109.73, 38.28),
    (2,  '陕三1#阀室',     'valve',         0, 0),
    (3,  '陕三2#阀室',     'valve',         0, 0),
    (4,  '榆林压气站',     'compressor',    109.75, 38.30),
    (5,  '陕三3#阀室',     'valve',         0, 0),
    (6,  '陕三4#阀室',     'valve',         0, 0),
    (7,  '米脂分输站',     'distribution',  110.18, 37.76),
    (8,  '陕三5#阀室',     'valve',         0, 0),
    (9,  '陕三6#阀室',     'valve',         0, 0),
    (10, '绥德分输站',     'distribution',  110.26, 37.50),
    (11, '陕三7#阀室',     'valve',         0, 0),
    (12, '陕三8#阀室',     'valve',         0, 0),
    (13, '吴堡分输站',     'distribution',  110.74, 37.45),
    (14, '陕三9#阀室',     'valve',         0, 0),
    (15, '陕三10#阀室',    'valve',         0, 0),
    (16, '临县压气站',     'compressor',    110.99, 37.95),
    (17, '陕三11#阀室',    'valve',         0, 0),
    (18, '陕三12#阀室',    'valve',         0, 0),
    (19, '离石分输站',     'distribution',  111.15, 37.52),
    (20, '陕三13#阀室',    'valve',         0, 0),
    (21, '陕三14#阀室',    'valve',         0, 0),
    (22, '交城分输站',     'distribution',  112.16, 37.55),
    (23, '陕三15#阀室',    'valve',         0, 0),
    (24, '陕三16#阀室',    'valve',         0, 0),
    (25, '太原分输站',     'distribution',  112.55, 37.87),
    (26, '陕三17#阀室',    'valve',         0, 0),
    (27, '阳曲压气站',     'compressor',    112.67, 38.06),
    (28, '陕三18#阀室',    'valve',         0, 0),
    (29, '陕三19#阀室',    'valve',         0, 0),
    (30, '忻州分输站',     'distribution',  112.73, 38.42),
    (31, '陕三20#阀室',    'valve',         0, 0),
    (32, '陕三21#阀室',    'valve',         0, 0),
    (33, '阳泉分输站',     'distribution',  113.58, 37.87),
    (34, '陕三22#阀室',    'valve',         0, 0),
    (35, '陕三23#阀室',    'valve',         0, 0),
    (36, '石家庄分输站',   'distribution',  114.51, 38.04),
    (37, '陕三24#阀室',    'valve',         0, 0),
    (38, '陕三25#阀室',    'valve',         0, 0),
    (39, '安平分输站',     'distribution',  115.52, 38.23),
    (40, '陕三26#阀室',    'valve',         0, 0),
    (41, '陕三27#阀室',    'valve',         0, 0),
    (42, '衡水分输站',     'distribution',  115.67, 37.74),
    (43, '陕三28#阀室',    'valve',         0, 0),
    (44, '陕三29#阀室',    'valve',         0, 0),
    (45, '永清压气站',     'compressor',    116.50, 39.32),
    (46, '陕三30#阀室',    'valve',         0, 0),
    (47, '陕三31#阀室',    'valve',         0, 0),
    (48, '固安分输站',     'distribution',  116.30, 39.44),
    (49, '陕三32#阀室',    'valve',         0, 0),
    (50, '良乡分输站',     'distribution',  116.13, 39.73),
    (51, '陕三33#阀室',    'valve',         0, 0),
    (52, '陕三34#阀室',    'valve',         0, 0),
    (53, '西沙屯末站',     'distribution',  116.23, 40.22),
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

    # ============================================================
    # Step 3: 写入管段
    # ============================================================
    segment_count = 0

    for i in range(len(TRUNK_STATIONS) - 1):
        seg_id = f"{ID_PREFIX}-T-{i + 1}"
        start_id = f"{ID_PREFIX}-{TRUNK_STATIONS[i][0]}"
        end_id = f"{ID_PREFIX}-{TRUNK_STATIONS[i + 1][0]}"
        seg_name = f"{SYSTEM_NAME}干线-段{i + 1}"

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

    # ============================================================
    # 验证
    # ============================================================
    cur.execute("SELECT COUNT(*) FROM stations WHERE id LIKE ?", (f"{ID_PREFIX}%",))
    total_stations = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM pipelines WHERE id LIKE ?", (f"{ID_PREFIX}-T%",))
    total_segments = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM stations WHERE id LIKE ? AND (longitude = 0 OR latitude = 0)", (f"{ID_PREFIX}%",))
    zero_coords = cur.fetchone()[0]

    print(f"\n=== 验证 ===")
    print(f"  站场总数: {total_stations}")
    print(f"  管段总数: {total_segments}")
    print(f"  零坐标:   {zero_coords}")

    conn.close()
    print(f"\n🎉 完成！刷新前端页面查看 '{SYSTEM_NAME}'")


if __name__ == '__main__':
    main()
