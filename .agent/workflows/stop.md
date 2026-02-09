---
description: 停止前后端服务
---

## 停止服务

### 停止所有 Node.js 进程（前端）
```bash
taskkill /F /IM node.exe
```

### 停止所有 Python 进程（后端）
```bash
taskkill /F /IM python.exe
```

### 停止指定端口的进程
```bash
# 查找占用端口的进程
netstat -ano | findstr :3000
netstat -ano | findstr :8000

# 根据 PID 结束进程
taskkill /F /PID <进程ID>
```
