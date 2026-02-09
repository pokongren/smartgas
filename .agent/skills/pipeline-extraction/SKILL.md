---
name: 管道拓扑提取器
description: 自动分析数据库中的复杂管线数据，识别并分离主干线与支线，生成结构化拓扑文件
---

# 管道拓扑提取器 Skill

这个 Skill 专注于从数据库中提取和分析复杂的管线网络结构，特别是针对包含多条支线的管网（如中缅线）。它能解决"干线与支线数据混杂"的问题。

> **数据源**: `backend/data/smartgas.db` 数据库中的 `node_relation_details` 表

## 核心判断逻辑

**干支线识别规则**（基于 `branch_name` 字段）：
- `branch_name` 包含 **"干线"** 字样 → 归类为 **干线**
- 其他所有情况 → 归类为 **支线**

## 核心功能

1. **自动提取**: 根据 `trunk_name` 字段模式匹配所有节点。
2. **精确分类**: 使用 `branch_name` 字段区分干线和支线。
3. **分组输出**: 支线按 `branch_name` 自动分组。
4. **结构化输出**: 生成包含分类节点列表的 JSON 文件。

## 使用方法

### 方式 1: 使用 Slash Command (推荐)

直接在聊天中输入：
```bash
/extract-branches
```
*这会默认提取 "中缅线"。*

### 方式 2: 使用 Python 脚本 (自定义管线)

如果您需要提取其他管线（例如 "西气东输二线"），请运行：

```bash
python backend/scripts/extract_trunk_and_branches.py "西气东输二线" --out "backend/data/we2_structure.json"
```

### 方式 3: 在代码中集成

您可以在其他 Python 脚本中导入此功能：

```python
from scripts.extract_trunk_and_branches import extract_pipelines

extract_pipelines(
    db_path='backend/data/smartgas.db',
    trunk_name_pattern='中缅线', 
    output_file='backend/data/output.json'
)
```

## 输出文件格式

生成的 JSON 文件结构如下：

```json
{
  "pipeline_name": "中缅线",
  "trunk": [
    { "id": 1, "name": "起点", "mileage": 0.0, "type": "valve", "branch_name": "中缅干线" }
  ],
  "branches": [
    [
      { "id": 100, "name": "支线起点", "mileage": 0.0, "type": "distribution", "branch_name": "丽江支线" }
    ]
  ],
  "branch_names": ["丽江支线", "玉溪支线", ...]
}
```
