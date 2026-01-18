# 数据导入方法说明

本文档介绍如何向 SmartGas Grid 数据库中导入数据。

---

## 方法1: 使用初始化脚本 (推荐用于初始数据)

### 使用方式

```bash
cd backend
python scripts/init_data.py
```

### 特点
- ✅ 一次性导入所有基础数据
- ✅ 自动清空旧数据
- ✅ 适合初始化或重置数据库

### 修改数据

编辑 `backend/scripts/init_data.py` 文件:

```python
stations = [
    Station(id="node-013", name="重庆", type="distribution", 
            longitude=106.55, latitude=29.56, design_pressure=6.0),
    # 添加更多站场...
]

pipelines = [
    Pipeline(id="line-012", name="重庆支线", 
             start_station_id="node-003", end_station_id="node-013",
             diameter=508, length=320, category="其他"),
    # 添加更多管线...
]
```

---

## 方法2: 使用 API 接口 (推荐用于动态添加)

### 2.1 单个添加站场

**接口**: `POST /api/stations`

**示例 (curl)**:
```bash
curl -X POST http://localhost:8000/api/stations \
  -H "Content-Type: application/json" \
  -d '{
    "id": "node-013",
    "name": "重庆",
    "type": "distribution",
    "longitude": 106.55,
    "latitude": 29.56,
    "design_pressure": 6.0
  }'
```

**示例 (Python)**:
```python
import requests

data = {
    "id": "node-013",
    "name": "重庆",
    "type": "distribution",
    "longitude": 106.55,
    "latitude": 29.56,
    "design_pressure": 6.0
}

response = requests.post('http://localhost:8000/api/stations', json=data)
print(response.json())
```

### 2.2 单个添加管线

**接口**: `POST /api/pipelines`

**示例**:
```bash
curl -X POST http://localhost:8000/api/pipelines \
  -H "Content-Type: application/json" \
  -d '{
    "id": "line-012",
    "name": "重庆支线",
    "start_station_id": "node-003",
    "end_station_id": "node-013",
    "diameter": 508,
    "length": 320,
    "category": "其他"
  }'
```

### 2.3 批量导入

**接口**: `POST /api/stations/batch`

**示例**:
```python
import requests

stations = [
    {
        "id": "node-013",
        "name": "重庆",
        "type": "distribution",
        "longitude": 106.55,
        "latitude": 29.56,
        "design_pressure": 6.0
    },
    {
        "id": "node-014",
        "name": "成都",
        "type": "compressor",
        "longitude": 104.07,
        "latitude": 30.67,
        "design_pressure": 8.5
    }
]

response = requests.post('http://localhost:8000/api/stations/batch', json=stations)
print(response.json())
# 输出: {"created": 2, "station_ids": ["node-013", "node-014"]}
```

---

## 方法3: 直接操作 SQLite 数据库

### 3.1 使用 SQLite 命令行

```bash
cd backend/data
sqlite3 smartgas.db

# 插入站场
INSERT INTO stations (id, name, type, longitude, latitude, design_pressure)
VALUES ('node-013', '重庆', 'distribution', 106.55, 29.56, 6.0);

# 查询验证
SELECT * FROM stations WHERE id = 'node-013';

# 退出
.quit
```

### 3.2 使用 Python SQLite3

```python
import sqlite3

conn = sqlite3.connect('backend/data/smartgas.db')
cursor = conn.cursor()

# 插入数据
cursor.execute('''
    INSERT INTO stations (id, name, type, longitude, latitude, design_pressure)
    VALUES (?, ?, ?, ?, ?, ?)
''', ('node-013', '重庆', 'distribution', 106.55, 29.56, 6.0))

conn.commit()
conn.close()
```

---

## 方法4: 从 Excel/CSV 导入

### 创建导入脚本

```python
# backend/scripts/import_from_excel.py
import pandas as pd
from sqlmodel import Session
from app.database import engine
from app.models import Station, Pipeline

def import_stations_from_excel(file_path):
    """从 Excel 导入站场数据"""
    df = pd.read_excel(file_path)
    
    with Session(engine) as session:
        for _, row in df.iterrows():
            station = Station(
                id=row['id'],
                name=row['name'],
                type=row['type'],
                longitude=row['longitude'],
                latitude=row['latitude'],
                design_pressure=row['design_pressure']
            )
            session.add(station)
        
        session.commit()
        print(f"成功导入 {len(df)} 个站场")

# 使用
import_stations_from_excel('stations.xlsx')
```

**Excel 格式示例**:

| id | name | type | longitude | latitude | design_pressure |
|----|------|------|-----------|----------|-----------------|
| node-013 | 重庆 | distribution | 106.55 | 29.56 | 6.0 |
| node-014 | 成都 | compressor | 104.07 | 30.67 | 8.5 |

---

## 推荐使用场景

| 场景 | 推荐方法 | 原因 |
|------|----------|------|
| 初始化数据库 | 方法1 (脚本) | 快速、可重复 |
| 添加单个数据 | 方法2 (API) | 有验证、安全 |
| 批量导入 | 方法4 (Excel) | 方便编辑 |
| 测试调试 | 方法3 (SQLite) | 直接、灵活 |
| 生产环境 | 方法2 (API) | 有日志、可追溯 |

---

## 数据验证

添加数据后,可以通过以下方式验证:

### 1. API 查询
```bash
curl http://localhost:8000/api/stations
```

### 2. Swagger UI
访问 http://localhost:8000/docs,使用 GET /api/stations 测试

### 3. 前端查看
访问 http://localhost:3000/#/map-demo,查看地图上是否显示新站场

---

## 常见问题

### Q: 如何删除数据?

A: 目前没有 DELETE 接口,可以:
1. 重新运行 `init_data.py` (会清空所有数据)
2. 直接操作 SQLite: `DELETE FROM stations WHERE id = 'node-013';`

### Q: 如何修改数据?

A: 可以添加 PUT 接口或直接操作数据库:
```sql
UPDATE stations SET name = '新名称' WHERE id = 'node-013';
```

### Q: 数据库文件在哪里?

A: `backend/data/smartgas.db`

### Q: 如何备份数据?

A: 复制 SQLite 文件:
```bash
cp backend/data/smartgas.db backend/data/smartgas_backup.db
```
