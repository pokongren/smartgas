"""
AI 工作流 API 路由
合并了原项目的 workflow CRUD 和 execute SSE 两个路由模块
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.database import get_session
from app.workflow_schemas import (
    WorkflowCreate,
    WorkflowUpdate,
    WorkflowResponse,
    WorkflowListResponse,
    ExecuteRequest,
)
from app.services.workflow_service import WorkflowService
from app.services.execution_engine import execution_engine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workflow", tags=["AI 工作流"])


@router.get("/list", response_model=list[WorkflowListResponse])
def list_workflows(session: Session = Depends(get_session)):
    """获取所有工作流列表"""
    service = WorkflowService(session)
    return service.get_all_workflows()


@router.get("/{workflow_id}", response_model=WorkflowResponse)
def get_workflow(workflow_id: str, session: Session = Depends(get_session)):
    """获取单个工作流详情"""
    service = WorkflowService(session)
    workflow = service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="工作流不存在")
    return workflow


@router.post("", response_model=WorkflowResponse, status_code=201)
def create_workflow(data: WorkflowCreate, session: Session = Depends(get_session)):
    """创建新工作流"""
    service = WorkflowService(session)
    return service.create_workflow(data)


@router.put("/{workflow_id}", response_model=WorkflowResponse)
def update_workflow(
    workflow_id: str,
    data: WorkflowUpdate,
    session: Session = Depends(get_session),
):
    """更新工作流"""
    service = WorkflowService(session)
    workflow = service.update_workflow(workflow_id, data)
    if not workflow:
        raise HTTPException(status_code=404, detail="工作流不存在")
    return workflow


@router.delete("/{workflow_id}", status_code=204)
def delete_workflow(workflow_id: str, session: Session = Depends(get_session)):
    """删除工作流"""
    service = WorkflowService(session)
    if not service.delete_workflow(workflow_id):
        raise HTTPException(status_code=404, detail="工作流不存在")


@router.post("/{workflow_id}/execute")
async def execute_workflow(
    workflow_id: str,
    data: ExecuteRequest,
    session: Session = Depends(get_session),
):
    """
    执行工作流，通过 SSE 流式返回每步执行结果
    前端可通过 fetch 读取流式数据
    """
    service = WorkflowService(session)
    workflow = service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="工作流不存在")

    if not workflow.steps:
        raise HTTPException(status_code=400, detail="工作流没有配置任何步骤")

    async def event_stream():
        """生成 SSE 事件流"""
        async for event in execution_engine.execute_workflow(workflow, data.input_text, session=session):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
