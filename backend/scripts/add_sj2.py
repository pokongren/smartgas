"""
陕京二线 (SJ2) - 局部数据写入脚本

只画出用户要求的 西沙屯 → 琉璃河 → 永清 段。
陕京二线全长约 935km，管径 1016mm。
本脚本仅写入北京南部段（西沙屯末站—琉璃河分输站—永清压气站），约 80km。

管线走向: 西沙屯(北京大兴) → 琉璃河 → 永清(河北)
"""
import sqlite3
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = str(Path(__file__).resolve().parents[1] / 'data' / 'smartgas.db')

SYSTEM_ID = 'sj2'
SYSTEM_NAME = '陕京二线'
SYSTEM_COLOR = '#8D6E63'  # 棕色
ID_PREFIX = 'SJ2'

# ============================================================
# 1. 站场数据（西沙屯-琉璃河-永清段）
# ============================================================
# 坐标来自真实地理位置
TRUNK_STATIONS = [
    # (序号, 名称, 类型, 经度, 纬度)
    # NOTE: 长阳分输站已确认不存在于陕京二线，已移除
    (1,  '西沙屯末站',     'distribution',  116.23, 40.22),   # 北京大兴，与 SJ3 共用
    (2,  '陕二1#阀室',     'valve',         0, 0),
    (3,  '陕二2#阀室',     'valve',         0, 0),
    (4,  '陕二3#阀室',     'valve',         0, 0),
    (5,  '陕二4#阀室',     'valve',         0, 0),
    (6,  '琉璃河分输站',   'distribution',  116.00, 39.60),   # 房山区琉璃河
    (7,  '陕二5#阀室',     'valve',         0, 0),
    (8,  '陕二6#阀室',     'valve',         0, 0),
    (9,  '固安分输站',     'distribution',  116.30, 39.44),   # 河北固安
    (10, '陕二7#阀室',     'valve',         0, 0),
    (11, '陕二8#阀室',     'valve',         0, 0),
    (12, '永清压气站',     'compressor',    116.50, 39.32),   # 河北永清
]


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    print(f"DB_PATH = {DB_PATH}")

    # ============================================================
    # Step 0: 清理旧数据（重复运行安全）
    # ============================================================
    cur.execute("DELETE FROM pipeline_systems WHERE id = ?", (SYSTEM_ID,))
    cur.execute("DELETE FROM pipelines WHERE id LIKE ?", (f"{ID_PREFIX}%",))
    cur.execute("DELETE FROM stations WHERE id LIKE ?", (f"{ID_PREFIX}%",))

    # ============================================================
    # Step 1: 注册管线系统
    # ============================================================
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

    # ============================================================
    # Step 2: 写入站场
    # ============================================================
    station_count = 0
    for seq, name, stype, lng, lat in TRUNK_STATIONS:
        sid = f"{ID_PREFIX}-{seq}"
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
        seg_name = f"{SYSTEM_NAME}（局部）-段{i + 1}"

        cur.execute("""
            INSERT INTO pipelines (id, name, start_station_id, end_station_id,
                                   diameter_mm, length_km, diameter, length, category)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (seg_id, seg_name, start_id, end_id, 1016, 0, 1016, 0, "trunk"))
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
    cur.execute("SELECT COUNT(*) FROM pipeline_systems WHERE id = ?", (SYSTEM_ID,))
    sys_count = cur.fetchone()[0]
    cur.execute(
        "SELECT COUNT(*) FROM pipelines WHERE id LIKE ? AND category NOT IN ('trunk','branch')",
        (f"{ID_PREFIX}%",),
    )
    non_standard_category = cur.fetchone()[0]

    print(f"\n=== 验证 ===")
    print(f"  pipeline_systems[{SYSTEM_ID}] count: {sys_count}")
    print(f"  站场总数: {total_stations}")
    print(f"  管段总数: {total_segments}")
    print(f"  零坐标:   {zero_coords}")
    print(f"  非标准 category 管段: {non_standard_category}")

    # 打印完整坐标链
    print(f"\n=== 坐标链 ===")
    for seq, name, stype, _, _ in TRUNK_STATIONS:
        sid = f"{ID_PREFIX}-{seq}"
        cur.execute("SELECT longitude, latitude FROM stations WHERE id = ?", (sid,))
        r = cur.fetchone()
        print(f"  {sid}: {name:<15} ({r[0]:.4f}, {r[1]:.4f})")

    conn.close()
    print(f"\n🎉 完成！刷新前端页面查看 '{SYSTEM_NAME}（西沙屯-琉璃河-永清段）'")


if __name__ == '__main__':
    main()
