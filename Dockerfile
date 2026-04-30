# SmartGas Grid - 智慧燃气管网应急指挥平台
# 多阶段构建：前端构建 + 后端运行

# ========== 阶段1：前端构建 ==========
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

# ========== 阶段2：后端运行 ==========
FROM python:3.12-slim AS backend
WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# 安装Python依赖
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# 复制后端代码
COPY backend/ ./backend/

# 复制前端构建产物到后端静态目录
COPY --from=frontend-builder /app/frontend/dist ./backend/static

# 创建数据目录
RUN mkdir -p /app/backend/data

# 暴露端口
EXPOSE 8081

# 工作目录
WORKDIR /app/backend

# 启动命令
CMD ["python", "main.py"]
