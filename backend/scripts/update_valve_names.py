"""
更新阀室名称：去除"西四"前缀
"""
import sqlite3

def update_valve_names():
    conn = sqlite3.connect('backend/data/smartgas.db')
    cursor = conn.cursor()
    
    # 查询当前阀室名称
    cursor.execute("SELECT id, name FROM stations WHERE name LIKE '%阀室%'")
    valves = cursor.fetchall()
    
    updated = 0
    for id, name in valves:
        if name.startswith('西四'):
            new_name = name.replace('西四', '')
            cursor.execute("UPDATE stations SET name = ? WHERE id = ?", (new_name, id))
            print(f"✅ {name} -> {new_name}")
            updated += 1
    
    conn.commit()
    conn.close()
    print(f"\n共更新 {updated} 条记录")

if __name__ == "__main__":
    update_valve_names()
