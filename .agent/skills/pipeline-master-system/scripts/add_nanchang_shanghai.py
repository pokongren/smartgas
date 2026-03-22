"""
南昌-上海支干线 - 示例导入脚本

演示 Pipeline Master System 阶段二的完整流程：
1. 注册管线系统 → pipeline_systems 表
2. 写入站场 → stations 表
3. 写入管段 → pipelines 表
4. 执行坐标均分插值

管线走向: 南昌 → 景德镇 → 黄山 → 宣城 → 湖州 → 嘉兴 → 上海
全长约 780km，1016mm 管径
"""
import sqlite3
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = os.path.join(os.getcwd(), 'backend', 'data', 'smartgas.db')
if not os.path.exists(DB_PATH):
    # 回退到脚本相对路径
    DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'backend', 'data', 'smartgas.db')
SYSTEM_ID = 'ncsh'
SYSTEM_NAME = '南昌-上海支干线'
SYSTEM_COLOR = '#00BCD4'  # 青色
ID_PREFIX = 'NCSH'

# ============================================================
# 1. 站场数据
# ============================================================
# 锚点坐标来自真实管线地理位置
# 阀室坐标设为 (0, 0)，后续通过均分插值计算

TRUNK_STATIONS = [
    # (序号, 名称, 类型, 经度, 纬度)
    (1, '南昌压气站', 'compressor', 115.86, 28.68),
    (2, '南昌1#阀室', 'valve', 0, 0),
    (3, '南昌2#阀室', 'valve', 0, 0),
    (4, '余干分输站', 'distribution', 116.69, 28.70),
    (5, '余干1#阀室', 'valve', 0, 0),
    (6, '余干2#阀室', 'valve', 0, 0),
    (7, '景德镇分输站', 'distribution', 117.18, 29.27),
    (8, '景德镇1#阀室', 'valve', 0, 0),
    (9, '景德镇2#阀室', 'valve', 0, 0),
    (10, '黄山压气站', 'compressor', 118.31, 29.72),
    (11, '黄山1#阀室', 'valve', 0, 0),
    (12, '黄山2#阀室', 'valve', 0, 0),
    (13, '绩溪分输站', 'distribution', 118.60, 30.07),
    (14, '绩溪1#阀室', 'valve', 0, 0),
    (15, '宣城分输站', 'distribution', 118.76, 30.95),
    (16, '宣城1#阀室', 'valve', 0, 0),
    (17, '宣城2#阀室', 'valve', 0, 0),
    (18, '湖州压气站', 'compressor', 120.09, 30.87),
    (19, '湖州1#阀室', 'valve', 0, 0),
    (20, '湖州2#阀室', 'valve', 0, 0),
    (21, '嘉兴分输站', 'distribution', 120.76, 30.77),
    (22, '嘉兴1#阀室', 'valve', 0, 0),
    (23, '嘉兴2#阀室', 'valve', 0, 0),
    (24, '上海末站', 'distribution', 121.47, 31.23),
]

# 九江支线
BRANCH1_STATIONS = [
    (101, '景德镇分输站', 'distribution', 117.18, 29.27),  # 共享站
    (102, '浮梁阀室', 'valve', 0, 0),
    (103, '九江分输站', 'distribution', 116.00, 29.71),
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
            {"id_prefix": f"{ID_PREFIX}-B1", "name": "九江支线", "type": "branch", "visible": False},
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

    # 干线站场
    for seq, name, stype, lng, lat in TRUNK_STATIONS:
        sid = f"{ID_PREFIX}-{seq}"
        cur.execute("SELECT id FROM stations WHERE id = ?", (sid,))
        if not cur.fetchone():
            cur.execute("""
                INSERT INTO stations (id, name, type, longitude, latitude)
                VALUES (?, ?, ?, ?, ?)
            """, (sid, name, stype, lng, lat))
            station_count += 1

    # 支线站场（跳过共享站）
    for seq, name, stype, lng, lat in BRANCH1_STATIONS:
        sid = f"{ID_PREFIX}-B1-{seq}"
        # 共享站检查（景德镇分输站）
        if name == '景德镇分输站':
            continue  # 干线已有
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

    # 干线管段（相邻站场之间）
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

    # 支线管段
    branch1_ids = []
    for seq, name, stype, lng, lat in BRANCH1_STATIONS:
        if name == '景德镇分输站':
            branch1_ids.append(f"{ID_PREFIX}-7")  # 共享站使用干线 ID
        else:
            branch1_ids.append(f"{ID_PREFIX}-B1-{seq}")

    for i in range(len(branch1_ids) - 1):
        seg_id = f"{ID_PREFIX}-B1-T-{i + 1}"
        seg_name = f"九江支线-段{i + 1}"

        cur.execute("SELECT id FROM pipelines WHERE id = ?", (seg_id,))
        if not cur.fetchone():
            cur.execute("""
                INSERT INTO pipelines (id, name, start_station_id, end_station_id,
                                       diameter_mm, length_km, diameter, length, category)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (seg_id, seg_name, branch1_ids[i], branch1_ids[i + 1], 508, 0, 508, 0, SYSTEM_NAME))
            segment_count += 1

    print(f"✅ 写入管段: {segment_count} 条")
    conn.commit()

    # ============================================================
    # Step 4: 坐标均分插值
    # ============================================================
    # 获取干线的锚点和零坐标站
    trunk_ids = [f"{ID_PREFIX}-{s[0]}" for s in TRUNK_STATIONS]
    anchors = []
    for i, sid in enumerate(trunk_ids):
        cur.execute("SELECT longitude, latitude FROM stations WHERE id = ?", (sid,))
        r = cur.fetchone()
        if r and r[0] != 0 and r[1] != 0:
            anchors.append({'index': i, 'lng': r[0], 'lat': r[1]})

    # 在锚点之间均分
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

    # 支线也一样处理
    branch_sids = []
    for seq, name, stype, lng, lat in BRANCH1_STATIONS:
        if name == '景德镇分输站':
            branch_sids.append(f"{ID_PREFIX}-7")
        else:
            branch_sids.append(f"{ID_PREFIX}-B1-{seq}")

    b_anchors = []
    for i, sid in enumerate(branch_sids):
        cur.execute("SELECT longitude, latitude FROM stations WHERE id = ?", (sid,))
        r = cur.fetchone()
        if r and r[0] != 0 and r[1] != 0:
            b_anchors.append({'index': i, 'lng': r[0], 'lat': r[1]})

    for a in range(len(b_anchors) - 1):
        curr = b_anchors[a]
        nxt = b_anchors[a + 1]
        mid_count = nxt['index'] - curr['index'] - 1
        for k, j in enumerate(range(curr['index'] + 1, nxt['index']), start=1):
            ratio = k / (mid_count + 1)
            new_lng = round(curr['lng'] + (nxt['lng'] - curr['lng']) * ratio, 6)
            new_lat = round(curr['lat'] + (nxt['lat'] - curr['lat']) * ratio, 6)
            sid = branch_sids[j]
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

    conn.close()
    print(f"\n完成！刷新前端页面查看 '{SYSTEM_NAME}'")


if __name__ == '__main__':
    main()
