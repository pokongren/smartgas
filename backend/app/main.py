from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import create_db_and_tables
from app.routers import basic, emergency, workflow, ai_assistant, topology_editor, topology_computation, scada, pipeline_packages, feishu
from app.mcp import setup_mcp
# NOTE: 导入模型以触发 SQLModel 建表
import app.workflow_models  # noqa: F401
import app.scada_models     # noqa: F401

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI 生命周期管理
    启动时：创建数据库表
    """
    create_db_and_tables()
    yield
    # 关闭时可补充资源释放逻辑

from fastapi.openapi.docs import get_swagger_ui_html

app = FastAPI(
    title="智脉平台 - 应急指挥系统",
    version="1.0.0",
    description="基于图算法和 RAG 的管网应急指挥系统",
    lifespan=lifespan,
    docs_url=None,  # 禁用默认文档路由
    redoc_url=None
)

@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html():
    return get_swagger_ui_html(
        openapi_url=app.openapi_url,
        title=app.title + " - API 文档",
        oauth2_redirect_url=app.swagger_ui_oauth2_redirect_url,
        swagger_ui_parameters={"defaultModelsExpandDepth": -1}, # 隐藏底部的 Schemas 或者不隐藏都可以
        swagger_js_url="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js",
        swagger_css_url="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css",
    )

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://localhost:5173", "http://127.0.0.1:3002", "http://127.0.0.1:3000"],
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
        "docs": "/docs",
        "说明": "API 服务运行正常"
    }

@app.get("/health", summary="健康检查接口")
def health_check():
    return {"status": "服务运行正常", "healthy": True}

# 注册路由
app.include_router(basic.router, prefix="/api", tags=["基础数据：站场与管线"])
app.include_router(emergency.router, prefix="/api/emergency", tags=["应急指挥：事件与推演"])
app.include_router(workflow.router, tags=["工作流自动化"])
app.include_router(ai_assistant.router, tags=["人工智能助手"])
app.include_router(topology_editor.router, tags=["拓扑网络：可视化编辑器"])
app.include_router(topology_computation.router, tags=["拓扑网络：计算分析与溯源"])
app.include_router(scada.router, tags=["SCADA：实时监测与数据集成"])
app.include_router(pipeline_packages.router, tags=["管线数据包：分组与图层"])
app.include_router(feishu.router, tags=["飞书集成"])

# 挂载 MCP Server（/mcp 端点）
setup_mcp(app)

