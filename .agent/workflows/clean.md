---
description: 清理项目缓存和临时文件
---

## 清理操作

### 清理 Node 缓存
// turbo
```bash
rd /s /q node_modules\.cache 2>nul
```

### 清理构建产物
// turbo
```bash
rd /s /q dist 2>nul
```

### 清理 Python 缓存
// turbo
```bash
rd /s /q backend\__pycache__ 2>nul
rd /s /q backend\app\__pycache__ 2>nul
```

### 完全重装依赖
```bash
rd /s /q node_modules
npm install
```
