import sqlite3
import json

conn = sqlite3.connect('data/smartgas.db')
c = conn.cursor()

result = {}

# 表结构
c.execute('PRAGMA table_info(node_relation_details)')
result['schema'] = [{'cid': r[0], 'name': r[1], 'type': r[2]} for r in c.fetchall()]

# 示例数据
c.execute("SELECT * FROM node_relation_details WHERE trunk_name = '中俄东线' LIMIT 5")
cols = [desc[0] for desc in c.description]
result['columns'] = cols
rows = c.fetchall()
result['sample_rows'] = [dict(zip(cols, r)) for r in rows]

# branch_name 列表
c.execute("SELECT DISTINCT branch_name FROM node_relation_details WHERE trunk_name = '中俄东线' ORDER BY branch_name")
result['branch_names'] = [r[0] for r in c.fetchall()]

# 总节点数
c.execute("SELECT COUNT(*) FROM node_relation_details WHERE trunk_name = '中俄东线'")
result['total_count'] = c.fetchone()[0]

with open('scripts/cred_info.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print("done")
conn.close()
