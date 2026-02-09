---
description: 查看 API 接口文档
---

## API 文档

### 访问 Swagger 文档
后端启动后访问：http://localhost:8000/docs

### 查看所有路由
// turbo
```bash
python -c "from app.main import app; [print(f'{r.methods} {r.path}') for r in app.routes]"
```

## 常用 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/pipelines | 获取管道列表 |
| GET | /api/stations | 获取站点列表 |
| GET | /api/pipelines/{id} | 获取单条管道详情 |
| GET | /api/stations/{id} | 获取单个站点详情 |

## 测试 API
```bash
curl http://localhost:8000/api/pipelines
```
