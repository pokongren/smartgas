"""
检查数据库中南部调度台管道之间的转供点
"""
import sqlite3
from collections import defaultdict

# 南部调度台45条管道完整列表
SOUTH_PIPELINES = [
    # 西气东输二线
    '西二线干线吉安-广州段',
    # 西气东输三线
    '西三线干线东段', '西三德化联络线', '西三福州联络线', '闽粤支干线',
    # LNG管道
    '漳州LNG外输管道', '深圳LNG外输管道', '深圳LNG深圳燃气联络线', '西二线深圳LNG联络线',
    # 中贵线
    '中贵线干线', '天水支线', '陇南支线', '陇西支线', '重燃安坪支线', '广元燃机工程供气管道',
    # 中缅线
    '中缅线（国内段）', '玉溪支线', '都匀支线', '钦州支线', '中缅线桂林支线',
    '防城港支线', '河池支线', '丽江支线', '独山支线', '平塘支线',
    '福泉支线', '荔波支线', '三都支线', '长顺支线',
    # 广南支干线
    '广南广东段', '广南广西段', '珊瑚支线', '苍梧-贺州支线', '南宁-百色支线',
    '贵港-玉林支线', '南宁-凭祥支线', '广西管道与广南支干线南宁联络线',
    # 广深支干线
    '广深支干线', '樟木头支线',
    # 香港支线
    '香港支线',
    # 广西管道
    '广西管道干线', '柳州支线', '粤西支线', '广西管道桂林支线',
]

# 也包含上级干线名称（用于模糊匹配）
SOUTH_TRUNKS = [
    '西气东输二线', '西气东输三线', '中贵线', '中缅线', '广南支干线', 
    '广深支干线', '香港支线', '广西管道', '漳州LNG', '深圳LNG', '闽粤',
    '海西', '西二线', '西三线'
]

def is_south_pipeline(name):
    """检查是否为南部调度台管道"""
    if name in SOUTH_PIPELINES:
        return True
    for trunk in SOUTH_TRUNKS:
        if trunk in name:
            return True
    return False

def check_south_junctions():
    conn = sqlite3.connect('backend/data/smartgas.db')
    cursor = conn.cursor()
    
    # 查询所有节点及其所属管线
    cursor.execute("""
        SELECT node_name, trunk_name 
        FROM node_relation_details 
        WHERE node_name IS NOT NULL AND trunk_name IS NOT NULL
    """)
    rows = cursor.fetchall()
    
    node_pipelines = defaultdict(set)
    for node_name, trunk_name in rows:
        node_pipelines[node_name].add(trunk_name)
    
    # 只保留连接多条管道的节点
    junctions = {n: list(p) for n, p in node_pipelines.items() if len(p) > 1}
    
    # 筛选：所有连接的管道都属于南部调度台
    pure_south_junctions = {}
    mixed_junctions = {}
    
    for node, pipelines in junctions.items():
        south_pipes = [p for p in pipelines if is_south_pipeline(p)]
        if len(south_pipes) >= 2:  # 至少两条南部管道交汇
            all_south = all(is_south_pipeline(p) for p in pipelines)
            if all_south:
                pure_south_junctions[node] = pipelines
            else:
                mixed_junctions[node] = pipelines
    
    print("=" * 70)
    print("【南部调度台内部转供点】（仅连接南部管道）")
    print("=" * 70)
    if pure_south_junctions:
        for node, pipes in sorted(pure_south_junctions.items()):
            print(f"{node}\t{' / '.join(pipes)}")
    else:
        print("未找到纯南部调度台内部转供点")
    
    print(f"\n共 {len(pure_south_junctions)} 个\n")
    
    print("=" * 70)
    print("【南部调度台与其他区域交汇点】（南部管道与其他管道交汇）")
    print("=" * 70)
    for node, pipes in sorted(mixed_junctions.items()):
        south = [p for p in pipes if is_south_pipeline(p)]
        other = [p for p in pipes if not is_south_pipeline(p)]
        print(f"{node}")
        print(f"  南部: {' / '.join(south)}")
        print(f"  其他: {' / '.join(other)}")
    
    print(f"\n共 {len(mixed_junctions)} 个")
    
    conn.close()

if __name__ == "__main__":
    check_south_junctions()
