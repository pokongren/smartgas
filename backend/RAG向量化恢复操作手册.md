# RAG 文档向量化恢复操作手册

> 适用场景：已完成本地文档解析（存在缓存），但因网络抖动或 API 限频导致向量化入库中途失败，需要从断点恢复的情况。

---

## 📋 当前状态确认

在恢复前，先确认当前进度，执行以下命令：

```powershell
cd f:\smartgas-grid\backend

# 查看缓存文件（本地解析的文本切片数量）
.venv\Scripts\python.exe -c "import json; docs = json.load(open('data/extracted_docs_cache.json', encoding='utf-8')); print(f'待入库切片数: {len(docs)}')"

# 查看向量数据库当前记录数
.venv\Scripts\python.exe -c "import chromadb; from chromadb.config import Settings; c = chromadb.PersistentClient(path='data/chroma_db', settings=Settings(anonymized_telemetry=False)); col = c.get_collection('smartgas_knowledge_docs'); print(f'已入库记录数: {col.count()}')"
```

**正常结果示例：**
```
待入库切片数: 3145
已入库记录数: 3   （← 说明大量切片尚未入库，需要执行恢复）
```

---

## ✅ 前提条件检查

### 1. 确认缓存文件存在

```
backend/
└── data/
    └── extracted_docs_cache.json   ← 必须存在（约 5MB）
```

> ⚠️ 如果缓存不存在，脚本会重新从原始 PDF 解析，耗时将显著增加（约 30-60 分钟）。

### 2. 确认 Gemini API Key 已配置

检查 `backend/.env` 文件中是否包含：

```env
GEMINI_API_KEY=your_api_key_here
```

---

## 🚀 方案二：使用容错脚本恢复入库

### 脚本说明

`scripts/parse_robust.py` 相比普通入库脚本具备以下能力：

| 特性 | 说明 |
|------|------|
| **自动读取缓存** | 跳过耗时的 PDF 解析，直接从缓存继续 |
| **API 失败重试** | 自动指数退避，最多重试 3 次，避免一次失败就退出 |
| **分批提交** | 每批 20 条，批次间冷却 2 秒，降低 API 频率限制风险 |
| **部分失败跳过** | 单批失败只记录日志，不会中断整体任务 |

### 执行步骤

```powershell
# 第一步：进入后端目录
cd f:\smartgas-grid\backend

# 第二步：执行容错向量化脚本
.venv\Scripts\python.exe scripts/parse_robust.py
```

### 执行过程参考输出

```
发现本地文档切片缓存，直接加载...
开始分 158 批入库，每批 20 条...
-> 提交第 1/158 批次 (20 chunks)...
   入库成功！睡眠 2 秒冷却...
-> 提交第 2/158 批次 (20 chunks)...
   入库成功！睡眠 2 秒冷却...
...
🎉 最终结束。集合中总记录数: 3145
```

### 预计耗时

| 阶段 | 时间 |
|------|------|
| 加载缓存 | < 5 秒 |
| 向量化并入库（3145 条） | 约 15-20 分钟（受网络和 API 速率影响） |

---

## 🛡️ 中途再次中断的处理

脚本具备**幂等性**——ChromaDB 会自动跳过已经存在的 ID，**直接重新运行脚本**即可，不会产生重复数据：

```powershell
# 重新运行，会自动跳过已入库部分，继续写入未完成部分
.venv\Scripts\python.exe scripts/parse_robust.py
```

> ℹ️ ChromaDB 的 `collection.add()` 在遇到重复 ID 时会忽略该条目，不会报错也不会重复写入。

---

## 🔍 验证入库结果

任务完成后，执行以下命令验证：

```powershell
# 查询记录总数，应与缓存切片数一致
.venv\Scripts\python.exe -c "
import chromadb
from chromadb.config import Settings
c = chromadb.PersistentClient(path='data/chroma_db', settings=Settings(anonymized_telemetry=False))
col = c.get_collection('smartgas_knowledge_docs')
print(f'向量库总记录数: {col.count()}')
# 做一条简单查询测试
r = col.query(query_texts=['管线泄漏处理'], n_results=2)
print('测试查询结果:')
for doc in r['documents'][0]:
    print(f'  - {doc[:80]}...')
"
```

---

## 🐛 常见问题处理

### API Key 无效 / 未配置
```
AuthenticationError: GEMINI_API_KEY not found
```
**解决**：检查 `backend/.env` 中的 `GEMINI_API_KEY` 配置是否正确。

### API 频率限制（429 Too Many Requests）
```
[API Error] 第 1 次失败: 429. 等待 5 秒后重试...
```
**说明**：脚本会自动等待并重试，**无需人工干预**。如果频繁出现，说明当前 Gemini API Key 的免费配额可能已接近上限，等待约 1 分钟后自动恢复。

### ChromaDB 模块未安装
```
ModuleNotFoundError: No module named 'chromadb'
```
**解决**：
```powershell
.venv\Scripts\pip.exe install chromadb
```
