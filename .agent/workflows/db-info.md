---
description: 查看数据库内容和统计信息
---

## 查看数据库

### 导出数据库为文本
// turbo
```bash
python backend/scripts/db_to_text.py
```

### 查看所有表结构
// turbo
```bash
python -c "import sqlite3; conn=sqlite3.connect('backend/data/smartgas.db'); cursor=conn.cursor(); cursor.execute(\"SELECT name FROM sqlite_master WHERE type='table'\"); print([r[0] for r in cursor.fetchall()])"
```

### 统计各表记录数
// turbo
```bash
python -c "import sqlite3; conn=sqlite3.connect('backend/data/smartgas.db'); cursor=conn.cursor(); cursor.execute(\"SELECT name FROM sqlite_master WHERE type='table'\"); tables=[r[0] for r in cursor.fetchall()]; [print(f'{t}: {cursor.execute(f\"SELECT COUNT(*) FROM {t}\").fetchone()[0]} 条') for t in tables]"
```
