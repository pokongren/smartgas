from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import create_db_and_tables

app = FastAPI(
    title="SmartGas Grid - 应急指挥系统",
    version="1.0.0",
    description="基于图算法和 RAG 的管网应急指挥系统"
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    """启动时创建数据库表"""
    create_db_and_tables()

@app.get("/")
def root():
    return {
        "message": "SmartGas Grid 应急指挥系统 API",
        "version": "1.0.0",
        "docs": "/docs"
    }

@app.get("/health")
def health_check():
    return {"status": "healthy"}

# 注册路由
from app.routers import basic, emergency
app.include_router(basic.router, prefix="/api", tags=["基础数据"])
app.include_router(emergency.router, prefix="/api/emergency", tags=["应急指挥"])

