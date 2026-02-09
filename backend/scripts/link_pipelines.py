"""
通用管道链接脚本
根据 node_relation_details 中的里程顺序,为指定的干线生成 pipelines 数据
"""
import sqlite3
from typing import List, Tuple

# 配置:线路名称到参数的映射
LINE_CONFIGS = {
    '西气东输一线': {
        'id_prefix': 'LINE1',
        'name_prefix': '西一线',
        'diameter': 1016,  # 西一线管径为1016mm
        'category': 'trunk'
    },
    '西气东输二线': {
        'id_prefix': 'LINE2',
        'name_prefix': '西二线',
        'diameter': 1219,  # 西二线管径为1219mm
        'category': 'trunk'
    },
    '西气东输三线': {
        'id_prefix': 'LINE3',
        'name_prefix': '西三线',
        'diameter': 1219,  # 西三线管径为1219mm
        'category': 'trunk'
    },
    '西气东输四线': {
        'id_prefix': 'LINE4',
        'name_prefix': '西四线',
        'diameter': 1219,
        'category': 'trunk'
    }
}

def link_pipeline(conn: sqlite3.Connection, trunk_name: str, config: dict) -> int:
    """
    为指定干线生成管道段
    
    Args:
        conn: 数据库连接
        trunk_name: 干线名称(在 node_relation_details 中的 trunk_name)
        config: 配置字典,包含 id_prefix, name_prefix, diameter, category
    
    Returns:
        生成的管道段数量
    """
    cursor = conn.cursor()
    
    # 获取该干线的所有节点,按里程排序
    cursor.execute("""
        SELECT node_name, mileage 
        FROM node_relation_details 
        WHERE trunk_name LIKE ? 
        ORDER BY mileage
    """, (f'%{trunk_name}%',))
    nodes = cursor.fetchall()
    
    if len(nodes) < 2:
        print(f"警告: {trunk_name} 节点数量不足 ({len(nodes)} 个),跳过")
        return 0
    
    # 获取所有站点的名称到ID映射
    cursor.execute("SELECT id, name FROM stations")
    name_to_id = {row[1]: row[0] for row in cursor.fetchall()}
    
    pipeline_count = 0
    skipped_count = 0
    
    # 连接相邻节点
    for i in range(len(nodes) - 1):
        start_node_name, start_mile = nodes[i]
        end_node_name, end_mile = nodes[i+1]
        
        start_id = name_to_id.get(start_node_name)
        end_id = name_to_id.get(end_node_name)
        
        if start_id and end_id:
            length = abs(end_mile - start_mile)
            pipeline_id = f"{config['id_prefix']}-SEG-{i+1:03d}"
            pipeline_name = f"{config['name_prefix']}-{i+1}"
            
            cursor.execute("""
                INSERT OR REPLACE INTO pipelines 
                (id, name, start_station_id, end_station_id, length, category, diameter)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                pipeline_id, 
                pipeline_name, 
                start_id, 
                end_id, 
                length, 
                config['category'], 
                config['diameter']
            ))
            pipeline_count += 1
        else:
            skipped_count += 1
            missing = []
            if not start_id:
                missing.append(f"起点:{start_node_name}")
            if not end_id:
                missing.append(f"终点:{end_node_name}")
            print(f"  跳过段 {i+1}: {', '.join(missing)} 在 stations 表中未找到")
    
    if skipped_count > 0:
        print(f"  注意: {trunk_name} 有 {skipped_count} 个段因站点缺失而跳过")
    
    return pipeline_count

def main():
    """主函数:为西一线、西二线、西三线生成管道数据"""
    conn = sqlite3.connect('data/smartgas.db')
    
    try:
        total_count = 0
        
        # 只处理西一线、西二线、西三线
        target_lines = ['西气东输一线', '西气东输二线', '西气东输三线']
        
        for trunk_name in target_lines:
            config = LINE_CONFIGS[trunk_name]
            print(f"\n正在处理: {trunk_name}")
            print(f"  配置: ID前缀={config['id_prefix']}, 管径={config['diameter']}mm, 类别={config['category']}")
            
            count = link_pipeline(conn, trunk_name, config)
            total_count += count
            
            print(f"  ✓ 成功生成 {count} 个管道段")
        
        conn.commit()
        print(f"\n{'='*60}")
        print(f"总计生成 {total_count} 个管道段")
        print(f"{'='*60}")
        
    except Exception as e:
        conn.rollback()
        print(f"错误: {e}")
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    main()
