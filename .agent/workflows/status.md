---
description: 查看项目运行状态
---

## 状态检查

### 检查前端是否运行
// turbo
```bash
netstat -ano | findstr :3000
```

### 检查后端是否运行
// turbo
```bash
netstat -ano | findstr :8000
```

### 检查所有 Node 进程
// turbo
```bash
tasklist | findstr node
```

### 检查所有 Python 进程
// turbo
```bash
tasklist | findstr python
```

## 快速健康检查
```bash
curl -s http://localhost:3000 > nul && echo 前端正常 || echo 前端异常
curl -s http://localhost:8000/docs > nul && echo 后端正常 || echo 后端异常
```
