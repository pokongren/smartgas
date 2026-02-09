---
description: 备份和恢复数据库
---

## 数据库备份

### 备份数据库
// turbo
```bash
copy backend\data\smartgas.db backend\data\smartgas_backup_%date:~0,4%%date:~5,2%%date:~8,2%.db
```

### 查看备份文件
// turbo
```bash
dir backend\data\*.db
```

## 恢复数据库

### 从备份恢复
```bash
copy backend\data\smartgas_backup_YYYYMMDD.db backend\data\smartgas.db
```

### 重新初始化数据库（慎用）
```bash
python backend/scripts/init_db.py
```
