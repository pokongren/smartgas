# 数据库 RAG 化使用指南

## 🎯 快速开始

### 前置条件

1. **安装依赖**
```bash
cd backend
pip install -r requirements.txt
```

2. **获取 Gemini API Key**
   - 访问 [Google AI Studio](https://makersuite.google.com/app/apikey)
   - 创建 API Key
   - 设置环境变量:
     ```bash
     # Windows
     set GEMINI_API_KEY=your_api_key_here
     
     # Linux/Mac
     export GEMINI_API_KEY=your_api_key_here
     ```

---

## 📋 使用流程

### 步骤 1: 同步数据库到向量数据库

首次使用或数据更新后,需要同步数据库:

```bash
cd backend
python scripts/sync_to_rag.py
```

**可选参数**:
- `--clear`: 清空现有向量数据后重新同步
- `--api-key YOUR_KEY`: 指定 API Key(不使用环境变量时)

**示例**:
```bash
# 清空并重新同步
python scripts/sync_to_rag.py --clear

# 指定 API Key
python scripts/sync_to_rag.py --api-key YOUR_API_KEY
```

---

### 步骤 2: 使用 RAG 查询

#### 方式 1: 通过 API

启动后端服务:
```bash
python run.py
```

调用 RAG API:
```bash
curl -X POST http://localhost:8000/api/emergency/knowledge \
  -H "Content-Type: application/json" \
  -d "{\"question\": \"贵阳压气站的设计压力是多少?\"}"
```

#### 方式 2: 在代码中使用

```python
from app.services.rag_enhanced import EnhancedRAGService

# 初始化服务
rag = EnhancedRAGService()

# 查询
result = rag.query("贵阳压气站的设计压力是多少?")

print(f"答案: {result['answer']}")
print(f"来源: {result['source']}")
print(f"方法: {result['method']}")
print(f"置信度: {result['confidence']}")
```

---

## 🔍 查询类型

### 1. 精确查询 (Text-to-SQL)

适用于需要精确数据的问题:

**示例问题**:
- "贵阳压气站的设计压力是多少?"
- "中贵干线连接哪些站场?"
- "所有压气站的列表"
- "管径大于 1000mm 的管线有哪些?"

**特点**:
- ✅ 数据精确
- ✅ 实时查询
- ✅ 支持复杂条件

---

### 2. 语义查询 (向量搜索)

适用于需要理解语义的问题:

**示例问题**:
- "找出西南地区的站场"
- "长距离输送管线"
- "高压力等级的设施"

**特点**:
- ✅ 语义理解
- ✅ 模糊匹配
- ✅ 相关性排序

---

### 3. 应急预案查询

适用于应急处置问题:

**示例问题**:
- "如何处理管线泄漏?"
- "压力下降怎么办?"
- "阀门故障应急措施"

**特点**:
- ✅ 响应最快
- ✅ 专业预案
- ✅ 操作指导

---

## 🛠️ 高级功能

### 导出数据库为 Markdown

```bash
cd backend
python scripts/db_to_text.py
```

生成 `database_knowledge.md` 文件,包含所有数据的自然语言描述。

---

### 查看向量数据库统计

```python
from scripts.sync_to_rag import VectorDBManager

vector_db = VectorDBManager()
stats = vector_db.get_stats()
print(f"总文档数: {stats['total_documents']}")
```

---

### 测试向量搜索

```python
from scripts.sync_to_rag import VectorDBManager

vector_db = VectorDBManager()
results = vector_db.query("贵阳压气站", n_results=5)

for i, doc in enumerate(results['documents'], 1):
    print(f"--- 结果 {i} ---")
    print(doc)
    print()
```

---

## 📊 查询方法对比

| 查询方法 | 适用场景 | 优点 | 缺点 | 响应时间 |
|---------|---------|------|------|---------|
| **应急预案** | 应急处置 | 最快,专业 | 覆盖有限 | < 0.1s |
| **Text-to-SQL** | 精确数据 | 准确,实时 | 需要结构化问题 | 1-2s |
| **向量搜索** | 语义理解 | 灵活,智能 | 需要同步数据 | 2-3s |

---

## ⚠️ 注意事项

### 1. 数据同步

- 数据库更新后需要重新同步向量数据库
- 建议在数据导入后自动触发同步

### 2. API Key 安全

- 不要将 API Key 提交到代码仓库
- 使用环境变量或配置文件管理

### 3. 向量数据库存储

- 向量数据库存储在 `backend/data/chroma_db/`
- 可以备份该目录以保存向量数据

---

## 🔄 自动同步

### 在数据导入后自动同步

修改 `scripts/import_custom_data.py`,在导入完成后调用同步:

```python
# 在导入完成后添加
from scripts.sync_to_rag import sync_database_to_vector_db

# 导入数据...
import_from_json(args.json, clear_existing=args.clear)

# 自动同步到向量数据库
print("\n🔄 同步到向量数据库...")
sync_database_to_vector_db()
```

---

## 💡 最佳实践

1. **首次使用**: 运行 `sync_to_rag.py --clear` 初始化向量数据库
2. **数据更新**: 每次导入新数据后运行 `sync_to_rag.py`
3. **定期同步**: 使用定时任务(cron/Windows 任务计划)定期同步
4. **测试查询**: 使用多种问题测试 RAG 效果

---

## 🐛 故障排除

### 问题 1: "未找到 Gemini API Key"

**解决方案**:
```bash
# 设置环境变量
set GEMINI_API_KEY=your_api_key

# 或在命令中指定
python scripts/sync_to_rag.py --api-key your_api_key
```

### 问题 2: "ChromaDB 未安装"

**解决方案**:
```bash
pip install chromadb google-generativeai
```

### 问题 3: 向量搜索无结果

**原因**: 向量数据库未同步或为空

**解决方案**:
```bash
python scripts/sync_to_rag.py --clear
```

---

## 📞 常见问题

**Q: 向量数据库多大?**
A: 约 1000 条记录占用 10-20 MB 存储空间

**Q: 同步需要多久?**
A: 取决于数据量,约 100 条/分钟(受 API 限制)

**Q: 可以使用其他嵌入模型吗?**
A: 可以,修改 `sync_to_rag.py` 中的 `generate_embedding` 方法

**Q: 支持离线使用吗?**
A: 向量搜索支持离线,但 Text-to-SQL 和答案生成需要 API

---

## 🎉 完成!

现在你已经掌握了数据库 RAG 化的使用方法,开始体验智能问答吧! 🚀
