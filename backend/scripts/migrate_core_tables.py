"""
数据迁移脚本：从明细表填充 pipelines/stations 核心表

数据流:
- node_relation_details → stations (站场)
- branch_pipeline_details → pipelines (管线)
- trunk_pipeline_details → pipelines (干线, 无管径)

同时执行 DB Schema 迁移:
- ALTER TABLE pipelines ADD COLUMN diameter_mm REAL
- ALTER TABLE pipelines ADD COLUMN length_km REAL
"""
import sqlite3
import sys
import os
import logging

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'smartgas.db')


def classify_node_type(name: str, node_type_2025: str | None) -> str:
    """
    根据节点名称和 2025 分类字段推断站场类型

    分类优先级: 名称关键词 > node_type_2025 字段
    """
    if '压气站' in name:
        return 'compressor'
    elif '分输站' in name or '门站' in name or '末站' in name or '首站' in name:
        return 'distribution'
    elif '阀室' in name or '阀门' in name or '#' in name:
        return 'valve'
    elif node_type_2025:
        t = node_type_2025.strip()
        if '压气' in t:
            return 'compressor'
        elif '分输' in t or '门站' in t:
            return 'distribution'
        elif '阀' in t:
            return 'valve'
    return 'other'


def migrate_schema(cursor: sqlite3.Cursor) -> None:
    """迁移 DB Schema: 添加 diameter_mm 和 length_km 列"""
    existing_cols = {row[1] for row in cursor.execute('PRAGMA table_info(pipelines)')}

    if 'diameter_mm' not in existing_cols:
        cursor.execute('ALTER TABLE pipelines ADD COLUMN diameter_mm REAL')
        logger.info('  [Schema] 新增 pipelines.diameter_mm 列')

    if 'length_km' not in existing_cols:
        cursor.execute('ALTER TABLE pipelines ADD COLUMN length_km REAL')
        logger.info('  [Schema] 新增 pipelines.length_km 列')


def migrate_stations(cursor: sqlite3.Cursor) -> int:
    """
    从 node_relation_details 提取唯一站场 → 写入 stations 表

    去重策略: 以 node_name 为唯一键
    """
    cursor.execute('''
        SELECT DISTINCT node_name, node_type_2025
        FROM node_relation_details
        WHERE node_name IS NOT NULL AND node_name != ''
    ''')
    rows = cursor.fetchall()

    count = 0
    for name, node_type in rows:
        station_type = classify_node_type(name, node_type)
        station_id = f"S-{abs(hash(name)) % 1000000:06d}"

        # UPSERT: 不覆盖已有坐标
        cursor.execute('''
            INSERT OR IGNORE INTO stations (id, name, type, longitude, latitude)
            VALUES (?, ?, ?, 0.0, 0.0)
        ''', (station_id, name, station_type))

        if cursor.rowcount > 0:
            count += 1

    return count


def migrate_pipelines(cursor: sqlite3.Cursor) -> int:
    """
    从 branch_pipeline_details 提取管线 → 写入 pipelines 表

    策略:
    - start_point / end_point → start_station_id / end_station_id
    - diameter → diameter_mm (单位已确认为 mm)
    - length → length_km (单位已确认为 km)
    """
    cursor.execute('''
        SELECT id, name, trunk_link, start_point, end_point,
               length, diameter, design_pressure
        FROM branch_pipeline_details
        WHERE name IS NOT NULL AND name != ''
    ''')
    rows = cursor.fetchall()

    # 预建站名→ID映射
    cursor.execute('SELECT id, name FROM stations')
    station_map = {name: sid for sid, name in cursor.fetchall()}

    count = 0
    for row_id, name, trunk_link, start_point, end_point, length, diameter, _ in rows:
        # 查找或创建起终点站 ID
        start_id = station_map.get(start_point, f"S-{abs(hash(start_point or '')) % 1000000:06d}")
        end_id = station_map.get(end_point, f"S-{abs(hash(end_point or '')) % 1000000:06d}")

        pipe_id = f"P-{row_id:04d}"
        diameter_mm = float(diameter) if diameter else None
        length_km = float(length) if length else 0.0

        # 推断 category
        category = 'trunk' if trunk_link and trunk_link == name else 'branch'

        cursor.execute('''
            INSERT OR REPLACE INTO pipelines
            (id, name, start_station_id, end_station_id, diameter, length, category, diameter_mm, length_km)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (pipe_id, name, start_id, end_id,
              diameter if diameter else 0, length_km, category,
              diameter_mm, length_km))

        count += 1

    return count


def main() -> None:
    """执行完整迁移"""
    logger.info('=' * 60)
    logger.info('SmartGas 数据迁移: 明细表 → 核心表')
    logger.info('=' * 60)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Step 1: Schema 迁移
        logger.info('\n[Step 1] DB Schema 迁移...')
        migrate_schema(cursor)

        # Step 2: 站场迁移
        logger.info('\n[Step 2] 迁移站场数据...')
        station_count = migrate_stations(cursor)
        logger.info(f'  写入 {station_count} 个站场到 stations 表')

        # Step 3: 管线迁移
        logger.info('\n[Step 3] 迁移管线数据...')
        pipeline_count = migrate_pipelines(cursor)
        logger.info(f'  写入 {pipeline_count} 条管线到 pipelines 表')

        conn.commit()

        # 验证
        logger.info('\n[验证]')
        cursor.execute('SELECT COUNT(*) FROM stations')
        logger.info(f'  stations: {cursor.fetchone()[0]} rows')
        cursor.execute('SELECT COUNT(*) FROM pipelines')
        logger.info(f'  pipelines: {cursor.fetchone()[0]} rows')
        cursor.execute('SELECT COUNT(*) FROM pipelines WHERE diameter_mm > 0')
        logger.info(f'  pipelines with diameter: {cursor.fetchone()[0]} rows')

        logger.info('\n✅ 迁移完成!')

    except Exception as e:
        conn.rollback()
        logger.error(f'\n❌ 迁移失败: {e}')
        sys.exit(1)
    finally:
        conn.close()


if __name__ == '__main__':
    main()
