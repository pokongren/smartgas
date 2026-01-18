# SmartGas Grid - 应急指挥系统后端

基于 FastAPI + SQLite + NetworkX 的轻量级管网应急指挥系统

## 快速启动

### 1. 安装依赖
```bash
pip install -r requirements.txt
```

### 2. 启动服务
```bash
python run.py
```

访问 http://localhost:8000/docs 查看 API 文档

## 核心功能

- ✅ **路径分析** - NetworkX 图算法寻找备用路径
- ✅ **影响范围** - 计算故障影响区域
- ✅ **RAG 知识库** - 应急预案智能问答
- ✅ **关键节点** - 识别管网关键站场

## 技术栈

- FastAPI - 高性能 Web 框架
- SQLModel - 数据库 ORM
- SQLite - 轻量级数据库
- NetworkX - 图算法库
