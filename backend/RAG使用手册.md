# 数据库 RAG 化 - 手动触发使用指南

## 🎯 核心流程

### 步骤 1: 导入/更新数据
```bash
cd backend
python scripts/import_custom_data.py --json your_data.json
```

### 步骤 2: 手动同步到向量数据库
```bash
python scripts/sync_to_rag.py --clear
```

### 步骤 3: 使用 RAG 功能
```bash
# 交互式问答
python scripts/quick_demo.py --interactive

# 或在代码中使用
python your_app.py
```

---

## 📝 常用命令

### 数据管理
```bash
# 导入 JSON 数据
python scripts/import_custom_data.py --json data.json --clear

# 导入 CSV 数据
python scripts/import_custom_data.py --csv-stations stations.csv --csv-pipelines pipelines.csv

# 查看数据库
python scripts/check_database.py
```

### RAG 同步
```bash
# 完全重建向量数据库
python scripts/sync_to_rag.py --clear

# 增量同步(不清空)
python scripts/sync_to_rag.py
```

### 测试验证
```bash
# 测试应急预案(无需网络)
python scripts/test_emergency.py

# 测试完整 RAG 功能(需要网络)
python scripts/test_rag.py

# 数据库文本化
python scripts/db_to_text.py
```

---

## ⚙️ 配置检查

```bash
# 诊断配置状态
python scripts/diagnose.py

# 测试 API Key
python scripts/setup_api_key.py --test

# 查看配置
python scripts/setup_api_key.py --status
```

---

## 💡 最佳实践

### 1. 数据导入后立即同步
```bash
python scripts/import_custom_data.py --json data.json && python scripts/sync_to_rag.py --clear
```

### 2. 定期备份
```bash
# 备份数据库
copy backend\data\smartgas.db backend\data\smartgas_backup.db

# 备份向量数据库
xcopy /E /I backend\data\chroma_db backend\data\chroma_db_backup
```

### 3. 验证同步结果
```bash
python scripts/sync_to_rag.py --clear
python scripts/test_rag.py
```

---

## 🔧 故障排除

### 网络问题
如遇网络超时,稍后重试:
```bash
python scripts/sync_to_rag.py --clear
```

### API Key 问题
检查 `.env` 文件:
```bash
cat backend/.env
```

### 向量数据库问题
删除并重建:
```bash
rmdir /S backend\data\chroma_db
python scripts/sync_to_rag.py --clear
```

---

## 📊 当前状态

- ✅ API Key: 已配置在 `backend/.env`
- ✅ 依赖: chromadb, google-generativeai
- ⏳ 向量数据库: 待网络恢复后同步

---

## 🚀 快速开始

```bash
# 1. 确保 API Key 已配置
cat backend/.env

# 2. 同步数据库(需要网络)
python scripts/sync_to_rag.py --clear

# 3. 开始使用
python scripts/quick_demo.py --interactive
```

---

## 📞 获取帮助

- 📖 详细文档: `数据库RAG化使用指南.md`
- 🔍 诊断工具: `python scripts/diagnose.py`
- 💬 交互演示: `python scripts/quick_demo.py --demo`
