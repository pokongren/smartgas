---
description: 导入数据到 SmartGas 数据库
---

## 数据导入方式

### 方式一：导入 Excel 文件
```bash
cd backend && python scripts/import_excel.py <excel文件路径>
```

### 方式二：导入多 Sheet Excel
```bash
cd backend && python scripts/import_multi_sheet.py <excel文件路径>
```

### 方式三：导入 CSV 文件
```bash
cd backend && python scripts/import_batch_csv.py <csv文件路径>
```

## 验证数据
// turbo
```bash
cd backend && python scripts/verify_and_clean.py
```

## 导出数据库为文本
// turbo
```bash
cd backend && python scripts/db_to_text.py
```
