from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import create_db_and_tables
from app.routers import basic, emergency, workflow, data_import, ai_assistant, topology_editor, topology_computation
from app.mcp_server import setup_mcp
# NOTE: 导入工作流模型以触发 SQLModel 建表
import app.workflow_models  # noqa: F401

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI 生命周期管理
    启动时：创建数据库表
    """
    create_db_and_tables()
    yield
    # 关闭时可补充资源释放逻辑

app = FastAPI(
    title="智脉平台 - 应急指挥系统",
    version="1.0.0",
    description="基于图算法和 RAG 的管网应急指挥系统",
    lifespan=lifespan
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# （原 startup 事件已通过 lifespan 管理替代）

@app.get("/")
def root():
    return {
        "message": "智脉平台 应急指挥系统 API",
        "version": "1.0.0",
        "docs": "/docs"
    }

@app.get("/health")
def health_check():
    return {"status": "healthy"}

# 注册路由
app.include_router(basic.router, prefix="/api", tags=["基础数据"])
app.include_router(emergency.router, prefix="/api/emergency", tags=["应急指挥"])
app.include_router(workflow.router)
app.include_router(data_import.router)
app.include_router(ai_assistant.router)
app.include_router(topology_editor.router)
app.include_router(topology_computation.router)

# 挂载 MCP Server（/mcp 端点）
setup_mcp(app)

