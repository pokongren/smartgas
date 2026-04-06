"""
从原始 Excel 重新导入陕京二线和陕京三线数据

步骤：
1. 删除数据库中所有 SJ2/SJ3 相关的站场、管段、管线系统
2. 从 Excel 的"管道站场阀室关系"sheet 读取原始数据
3. 使用地理编码（从地理位置文本推算坐标）写入数据库
4. 只导入干线数据（支线暂不导入）
"""
import sqlite3, sys, json, re
sys.stdout.reconfigure(encoding='utf-8')

try:
    import openpyxl
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'openpyxl', '-q'])
    import openpyxl

DB_PATH = r'F:\smartgas-grid\backend\data\smartgas.db'
XLSX_PATH = r'F:\smartgas-grid\backend\data\raw_csvs\数据库20251031.xlsx'

# ============================================================
# 已知站场坐标字典（从地理位置推算或公开资料获取）
# 格式: '站场名': (经度, 纬度)
# ============================================================
# 陕京二线干线坐标（西→东顺序）
SJ2_COORDS = {
    '西一靖边压气站': (108.79, 37.59),
    '榆林压气站': (109.73, 38.28),
    '榆阳分输站': (109.77, 38.26),
    '项家输气站': (109.80, 38.22),
    '兴县分输站': (111.13, 38.46),
    '兴县压气站': (111.14, 38.45),
    '岚县分输站': (111.67, 38.71),
    '阳曲压气站': (112.69, 38.08),
    '阳曲大盂站': (112.69, 38.08),
    '盂县分输站': (113.58, 37.87),
    '鹿泉分输站': (114.32, 38.09),
    '鹿泉华泽站': (114.32, 38.09),
    '鹿泉华电九期站': (114.32, 38.09),
    '正定分输站': (114.57, 38.15),
    '石家庄压气站': (114.68, 38.03),
    '石家庄华泽站': (114.68, 38.03),
    '石家庄潜能站': (114.68, 38.03),
    '安平压气站': (115.52, 38.23),
    '文安分输站': (116.46, 38.87),
    '霸州分输站': (116.39, 39.12),
    '顺达站': (116.49, 39.31),
    '永清压气站': (116.50, 39.32),
    '永清分输站': (116.49, 39.34),
    '采育分输站': (116.60, 39.62),
    '西集分输站': (116.93, 39.87),
    '通州东分输站': (116.76, 39.77),
}

# 陕京三线干线坐标
SJ3_COORDS = {
    '榆林压气站': (109.73, 38.28),
    '榆佳分输站': (110.09, 37.82),
    '八堡分输站': (110.72, 37.58),
    '雷家碛分输站': (110.87, 37.59),
    '临县压气站': (110.99, 37.97),
    '临县分输站': (110.99, 37.97),
    '阳曲压气站': (112.69, 38.08),
    '盂县西分输站': (113.52, 37.90),
    '井陉分输站': (114.14, 38.03),
    '鹿泉东分输站': (114.38, 38.08),
    '石家庄压气站': (114.68, 38.03),
    '深泽北分输站': (115.20, 38.18),
    '安平压气站': (115.52, 38.23),
    '高阳分输站': (115.78, 38.66),
    '陕京霸州分输站': (116.39, 39.12),
    '永清压气站': (116.50, 39.32),
    '永清分输站': (116.49, 39.34),
    '向阳五村分输站': (115.97, 39.49),
    '涿州东分输站': (115.97, 39.49),
    '琉璃河分输站': (116.00, 39.70),
    '良乡分输站': (116.13, 39.73),
    '大灰厂分输站': (116.12, 39.88),
    '潭柘寺分输站': (116.07, 39.92),
    '西沙屯分输站': (116.29, 40.07),
}


def read_excel_stations(xlsx_path, pipeline_name, branch_name):
    """从 Excel 读取指定管线的站场数据"""
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb['管道站场阀室关系']
    
    stations = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue  # 跳过表头
        
        p_name = str(row[0]).strip() if row[0] else ''
        b_name = str(row[1]).strip() if row[1] else ''
        station = str(row[2]).strip() if row[2] else ''
        mileage = row[6] if row[6] is not None else 0
        symbol = str(row[13]).strip() if row[13] else ''
        type_2024 = str(row[14]).strip() if row[14] else ''
        location = str(row[16]).strip() if row[16] else ''
        
        if p_name == pipeline_name and b_name == branch_name:
            # 确定站场类型
            if '压气站' in station:
                stype = 'compressor'
            elif '分输站' in station or '末站' in station or '首站' in station:
                stype = 'distribution'
            elif '阀室' in station:
                stype = 'valve'
            elif '输气站' in station or '代管' in type_2024:
                stype = 'distribution'
            else:
                stype = 'distribution'
            
            stations.append({
                'name': station,
                'type': stype,
                'mileage': float(mileage) if mileage else 0,
                'symbol': symbol,
                'type_2024': type_2024,
                'location': location,
            })
    
    wb.close()
    return stations


def interpolate_coords(stations, coord_dict):
    """为有坐标的站定位，没坐标的用线性插值"""
    # 先给已知坐标的站赋值
    for s in stations:
        if s['name'] in coord_dict:
            s['lng'], s['lat'] = coord_dict[s['name']]
        else:
            s['lng'], s['lat'] = 0, 0
    
    # 找锚点（有坐标的站）
    anchors = [(i, s) for i, s in enumerate(stations) if s['lng'] != 0]
    
    # 在锚点之间做线性插值
    for a in range(len(anchors) - 1):
        idx1, s1 = anchors[a]
        idx2, s2 = anchors[a + 1]
        gap = idx2 - idx1
        if gap <= 1:
            continue
        for k in range(1, gap):
            ratio = k / gap
            stations[idx1 + k]['lng'] = round(s1['lng'] + (s2['lng'] - s1['lng']) * ratio, 6)
            stations[idx1 + k]['lat'] = round(s1['lat'] + (s2['lat'] - s1['lat']) * ratio, 6)
    
    return stations


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    print("=" * 60)
    print("从 Excel 重新导入陕京二线和陕京三线")
    print("=" * 60)
    
    # ========== Step 1: 清除旧数据 ==========
    print("\n【Step 1】清除旧数据...")
    
    # 清除 junction_groups 中涉及 SJ2/SJ3 的记录
    cur.execute("SELECT id, station_ids FROM junction_groups")
    for row in cur.fetchall():
        ids = json.loads(row[1]) if row[1] else []
        if any(sid.startswith('SJ2') or sid.startswith('SJ3') for sid in ids):
            cur.execute("DELETE FROM junction_groups WHERE id = ?", (row[0],))
            print(f"  删除 junction_group [{row[0]}]")
    
    for prefix in ['SJ2', 'SJ3']:
        cur.execute("DELETE FROM pipelines WHERE id LIKE ?", (f"{prefix}%",))
        print(f"  删除 {prefix} 管段: {cur.rowcount} 条")
        cur.execute("DELETE FROM stations WHERE id LIKE ?", (f"{prefix}%",))
        print(f"  删除 {prefix} 站场: {cur.rowcount} 条")
    
    cur.execute("DELETE FROM pipeline_systems WHERE id IN ('sj2', 'sj3')")
    print(f"  删除管线系统: {cur.rowcount} 条")
    
    conn.commit()
    
    # ========== Step 2: 读取 Excel 数据 ==========
    print("\n【Step 2】从 Excel 读取数据...")
    
    sj2_stations = read_excel_stations(XLSX_PATH, '陕京二线', '陕京二线干线')
    sj3_stations = read_excel_stations(XLSX_PATH, '陕京三线', '陕京三线干线')
    
    print(f"  陕京二线干线: {len(sj2_stations)} 个站场")
    print(f"  陕京三线干线: {len(sj3_stations)} 个站场")
    
    # 坐标插值
    sj2_stations = interpolate_coords(sj2_stations, SJ2_COORDS)
    sj3_stations = interpolate_coords(sj3_stations, SJ3_COORDS)
    
    # ========== Step 3: 写入数据库 ==========
    print("\n【Step 3】写入数据库...")
    
    # 注册管线系统
    cur.execute("SELECT MAX(sort_order) FROM pipeline_systems")
    max_sort = cur.fetchone()[0] or 0
    
    for sys_id, sys_name, color, sort in [
        ('sj2', '陕京二线', '#8D6E63', max_sort + 1),
        ('sj3', '陕京三线', '#78909C', max_sort + 2),
    ]:
        prefix = sys_id.upper()
        layers = json.dumps([
            {"id_prefix": prefix, "name": f"{sys_name}干线", "type": "trunk", "visible": True}
        ], ensure_ascii=False)
        cur.execute("""
            INSERT INTO pipeline_systems (id, name, color, sort_order, layers_config)
            VALUES (?, ?, ?, ?, ?)
        """, (sys_id, sys_name, color, sort, layers))
    
    print("  注册管线系统: sj2, sj3")
    
    # 写入站场和管段
    for prefix, sys_name, stations in [
        ('SJ2', '陕京二线', sj2_stations),
        ('SJ3', '陕京三线', sj3_stations),
    ]:
        station_count = 0
        for i, s in enumerate(stations, 1):
            sid = f"{prefix}-{i}"
            cur.execute("""
                INSERT INTO stations (id, name, type, longitude, latitude)
                VALUES (?, ?, ?, ?, ?)
            """, (sid, s['name'], s['type'], s['lng'], s['lat']))
            station_count += 1
        
        # 写入管段（相邻站之间连线）
        seg_count = 0
        for i in range(len(stations) - 1):
            seg_id = f"{prefix}-T-{i + 1}"
            start_id = f"{prefix}-{i + 1}"
            end_id = f"{prefix}-{i + 2}"
            cur.execute("""
                INSERT INTO pipelines (id, name, start_station_id, end_station_id,
                                       diameter_mm, length_km, diameter, length, category)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (seg_id, f"{sys_name}干线", start_id, end_id, 1016, 0, 1016, 0, "trunk"))
            seg_count += 1
        
        print(f"  {sys_name}: {station_count} 个站场, {seg_count} 条管段")
    
    conn.commit()
    
    # ========== Step 4: 验证 ==========
    print("\n【Step 4】验证...")
    
    for prefix, sys_name in [('SJ2', '陕京二线'), ('SJ3', '陕京三线')]:
        cur.execute("SELECT COUNT(*) FROM stations WHERE id LIKE ?", (f"{prefix}%",))
        s_cnt = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM pipelines WHERE id LIKE ?", (f"{prefix}%",))
        p_cnt = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM stations WHERE id LIKE ? AND (longitude = 0 OR latitude = 0)", (f"{prefix}%",))
        zero = cur.fetchone()[0]
        cur.execute(
            "SELECT COUNT(*) FROM pipelines WHERE id LIKE ? AND category NOT IN ('trunk','branch')",
            (f"{prefix}%",),
        )
        non_standard_category = cur.fetchone()[0]
        print(f"  {sys_name}: 站场={s_cnt} 管段={p_cnt} 零坐标={zero} 非标准category={non_standard_category}")
    
    # 打印完整坐标链
    for prefix, sys_name in [('SJ2', '陕京二线'), ('SJ3', '陕京三线')]:
        print(f"\n  === {sys_name} 坐标链 ===")
        cur.execute("SELECT id, name, type, longitude, latitude FROM stations WHERE id LIKE ? ORDER BY CAST(REPLACE(id, ?, '') AS INTEGER)", (f"{prefix}%", f"{prefix}-"))
        for r in cur.fetchall():
            coord_mark = "✓" if r[3] != 0 else "✗"
            print(f"    {r[0]:10s} | {r[1]:18s} | {r[2]:12s} | ({r[3]:>10.4f}, {r[4]:>8.4f}) {coord_mark}")
    
    conn.close()
    print("\n✅ 导入完成！重启后端并刷新前端查看效果。")


if __name__ == '__main__':
    main()
