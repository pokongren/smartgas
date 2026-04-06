import sqlite3
import json

def get_db_coords():
    with open('src/data/we1_structure.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    stations = set()
    for n in data.get('trunk', []):
        if n.get('type') != 'valve':
            stations.add(n['name'])
            
    for b in data.get('branches', []):
        for n in b:
            if n.get('type') != 'valve':
                stations.add(n['name'])
                
    stations_list = list(stations)
    
    conn = sqlite3.connect('backend/data/smartgas.db')
    cur = conn.cursor()
    
    cur.execute("PRAGMA table_info('stations')")
    cols = [r[1] for r in cur.fetchall()]
    
    x_col = 'lng' if 'lng' in cols else ('longitude' if 'longitude' in cols else 'x')
    y_col = 'lat' if 'lat' in cols else ('latitude' if 'latitude' in cols else 'y')
    
    query = f"SELECT name, {x_col}, {y_col} FROM stations WHERE name IN ({','.join(['?']*len(stations_list))})"
    cur.execute(query, stations_list)
    results = cur.fetchall()
    
    found = {r[0]: {"lng": r[1], "lat": r[2]} for r in results if r[1] and r[2]}
    
    with open('tmp_coords.json', 'w', encoding='utf-8') as out:
        json.dump(found, out, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    get_db_coords()
