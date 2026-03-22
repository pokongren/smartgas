---
name: pipeline-master-system
description: 天然气管网全生命周期管理系统，整合数据提取、拓扑分析、坐标映射、可视化渲染的完整工作流，提供一站式管线管理解决方案
---

# 管道全生命周期管理系统 (Pipeline Master System)

SmartGas 的核心处理引擎，将管线数据从录入到可视化渲染的完整闭环。

> **数据流**: 原始数据 → Python 脚本写入数据库 → 后端 API 输出 → 前端地图渲染

## 架构概览

```
┌─── 数据源 ───┐    ┌─── 后端数据库 ───┐    ┌─── API 层 ──┐    ┌── 前端渲染 ──┐
│ 网络搜索坐标  │    │ pipeline_systems │    │ GET /api/   │    │ 地图视图     │
│ structure.json│ →  │ stations         │ →  │  pipeline-  │ →  │ 管线目录     │
│ 手工数据录入  │    │ pipelines        │    │  packages   │    │ SCADA 面板   │
└──────────────┘    └────────────────┘    └────────────┘    └─────────────┘
```

## 数据库核心表

| 表名 | 说明 | 关键字段 |
|------|------|----------|
| `pipeline_systems` | 管线系统注册表 | `id`, `name`, `color`, `layers_config`, `sort_order` |
| `stations` | 站场表（节点） | `id`, `name`, `type`, `longitude`, `latitude` |
| `pipelines` | 管段表（边） | `id`, `name`, `start_station_id`, `end_station_id`, `diameter`, `length`, `category` |

**`layers_config` 格式**（JSON 数组）:
```json
[
  { "id_prefix": "NC", "name": "南昌-上海干线", "type": "trunk", "visible": true },
  { "id_prefix": "NC-B1", "name": "九江支线", "type": "branch", "visible": false }
]
```

**站场 ID 命名规则**: `{系统前缀}-{序号}`，如 `NC-1`, `NC-2`

**管段 ID 命名规则**: `{系统前缀}-T-{序号}`（干线）或 `{系统前缀}-B{支线号}-T-{序号}`

---

## 🚀 一站式接入工作流

当用户要求"接入新管线"、"绘制某条管线"时，严格按以下 3 个阶段执行。

### 阶段一: 数据探查 (Data Discovery)

**目标**: 从数据库查询该管线已有的站场和管段数据，确定需要补充的坐标。

> [!IMPORTANT]
> **必须先从 `smartgas.db` 查询！** 绝大多数管线的站场和管段已经存在于数据库中，只是缺少坐标或未注册为管线系统。

1. **查询数据库中已有数据**:
   ```sql
   -- 查看 node_relation_details 表中是否有该管线
   SELECT DISTINCT trunk_name, branch_name, COUNT(*) 
   FROM node_relation_details 
   WHERE trunk_name LIKE '%南昌%上海%' 
   GROUP BY trunk_name, branch_name;

   -- 查看 stations 表中是否有相关站场
   SELECT id, name, type, longitude, latitude 
   FROM stations 
   WHERE name LIKE '%南昌%' OR name LIKE '%上海%';

   -- 查看 trunk_pipeline_details 和 branch_pipeline_details
   SELECT * FROM trunk_pipeline_details WHERE trunk_name LIKE '%关键词%';
   ```

2. **评估数据完整性**:
   - ✅ 已有站场 → 只需补充坐标和注册管线系统
   - ⚠️ 部分有 → 需要用 `batch_extract.py` 提取并补充
   - ❌ 完全没有 → 需要手动创建（搜索坐标 + 编写导入脚本）

3. **收集缺失的站场坐标**:
   - **压气站/分输站（锚点）**: 根据站场名称中的**城市名**，使用 `search_web` 搜索该城市的默认经纬度作为站场坐标
     - 例如："南昌压气站" → 搜索 "南昌 经纬度" → 得到 (115.86, 28.68)
     - 例如："景德镇分输站" → 搜索 "景德镇 经纬度" → 得到 (117.18, 29.27)
   - **阀室**: 不需要搜索坐标，在**锚点之间均分插值**（等间距分配，不按里程比例）

3. **整理站场列表**:
   按里程顺序列出所有站场，格式：
   ```
   站场名 | 类型(compressor/distribution/valve) | 经度 | 纬度
   ```

### 阶段二: 数据库写入 (Database Ingestion)

**目标**: 将管线数据写入 3 张核心表。

使用 Python 脚本完成数据写入，脚本模板见 `scripts/examples/add_pipeline.py`。

**写入步骤（必须按顺序）**:

#### Step 1: 注册管线系统

```python
import sqlite3, json

conn = sqlite3.connect('backend/data/smartgas.db')
cur = conn.cursor()

# 获取当前最大 sort_order
cur.execute("SELECT MAX(sort_order) FROM pipeline_systems")
max_sort = cur.fetchone()[0] or 0

# layers_config: 定义干线和支线图层
layers_config = json.dumps([
    {"id_prefix": "NC", "name": "南昌-上海干线", "type": "trunk", "visible": True},
    {"id_prefix": "NC-B1", "name": "九江支线", "type": "branch", "visible": False},
], ensure_ascii=False)

cur.execute("""
    INSERT INTO pipeline_systems (id, name, color, sort_order, layers_config)
    VALUES (?, ?, ?, ?, ?)
""", ('nc', '南昌-上海支干线', '#00BCD4', max_sort + 1, layers_config))

conn.commit()
```

#### Step 2: 写入站场

```python
# 站场数据（锚点需真实坐标，阀室可后续均分插值）
stations = [
    # (id, name, type, longitude, latitude)
    ('NC-1', '南昌压气站', 'compressor', 115.86, 28.68),
    ('NC-2', '南昌1#阀室', 'valve', 0, 0),  # 坐标后续插值
    ('NC-3', '景德镇分输站', 'distribution', 117.18, 29.27),
    # ... 更多站场
]

for s in stations:
    cur.execute("""
        INSERT OR IGNORE INTO stations (id, name, type, longitude, latitude)
        VALUES (?, ?, ?, ?, ?)
    """, s)

conn.commit()
```

#### Step 3: 写入管段

```python
# 管段数据（每两个相邻站场之间一条管段）
segments = [
    # (id, name, start_station_id, end_station_id, diameter, length, category)
    ('NC-T-1', '南昌-上海干线-段1', 'NC-1', 'NC-2', 1016, 45.0, '南昌-上海支干线'),
    ('NC-T-2', '南昌-上海干线-段2', 'NC-2', 'NC-3', 1016, 52.0, '南昌-上海支干线'),
    # ... 更多管段
]

for s in segments:
    cur.execute("""
        INSERT OR IGNORE INTO pipelines (id, name, start_station_id, end_station_id, 
                                         diameter, length, category)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, s)

conn.commit()
```

#### Step 4: 坐标均分插值

对零坐标的阀室执行均分插值：

```python
# 获取干线站场列表（按管段连接顺序）
# 找到有坐标的锚点，在锚点之间均分中间节点
from fix_station_coords_equal import compute_equal_spacing
# ... 或直接内联插值逻辑
```

### 阶段三: 验证与渲染 (Verification & Rendering)

**目标**: 确认数据正确，前端自动渲染。

1. **API 验证**:
   ```bash
   # 检查管线包是否正确返回
   curl http://localhost:8000/api/pipeline-packages | python -m json.tool | grep "南昌"
   ```

2. **前端验证**:
   - 打开 `http://localhost:3000/#/global`
   - 在管线目录中找到新管线
   - 确认勾选后地图上正确渲染

3. **注意**: 前端有缓存，可能需要**硬刷新** (Ctrl+Shift+R) 清除 API 缓存

> [!IMPORTANT]
> 前端 `src/data/pipelines/index.ts` 中的 `filterLayers()` 函数有**白名单过滤**。
> 如果新支线需要在管线目录中显示，必须将支线名添加到 `keepList` 数组中：
> ```typescript
> const keepList = ['甪直联络线', '广深支干线', '广南支干线', '南昌-上海支干线']  // ← 添加新支线
> ```

---

## 📁 关键文件索引

| 文件 | 说明 |
|------|------|
| `backend/data/smartgas.db` | SQLite 数据库 |
| `backend/app/routers/pipeline_packages.py` | 管线数据 API（自动从 3 张表组装） |
| `backend/app/routers/basic.py` | 拓扑图 API + CRUD 接口 |
| `backend/scripts/batch_extract.py` | 从 `node_relation_details` 表提取拓扑结构 |
| `backend/scripts/fix_station_coords_equal.py` | 均分插值坐标修复脚本 |
| `src/data/pipelines/index.ts` | 前端管线加载入口（含图层过滤 + 去重） |
| `src/views/GlobalPipelineView.tsx` | 全国管网统一视图（地图 + SCADA） |

---

## ⚠️ 注意事项

1. **坐标有效性**: 中国境内坐标范围 70°~140° E, 15°~55° N。零坐标会导致管线汇聚到非洲海域
2. **ID 唯一性**: 站场 ID 和管段 ID 必须全局唯一，建议使用 `{系统前缀}-{序号}` 格式
3. **图层过滤**: 前端 `filterLayers()` 默认只保留 trunk 类型 + 白名单支线
4. **名称匹配**: SCADA 面板呼出按钮依赖 `pkg.name` 精确匹配，添加新管线的 SCADA 需要在 `GlobalPipelineView.tsx` 中添加对应条件
5. **数据缓存**: 前端有内存缓存，修改数据库后需要刷新页面
