"""
AI 工作流相关的 Pydantic 请求/响应模型
"""
from typing import Optional
from datetime import datetime

from pydantic import BaseModel, Field


# ============ 步骤 Schema ============

class WorkflowStepBase(BaseModel):
    """步骤基础字段"""
    name: str = Field(default="未命名步骤", description="步骤名称")
    prompt_template: str = Field(default="", description="提示词模板，支持 {{input}} 和 {{prev_output}} 变量")
    model: str = Field(default="", description="使用的 AI 模型，留空则使用默认模型")
    temperature: float = Field(default=0.7, ge=0, le=2, description="温度参数")
    max_tokens: int = Field(default=2000, ge=1, le=100000, description="最大 token 数")


class WorkflowStepCreate(WorkflowStepBase):
    """创建步骤的请求模型"""
    step_order: int = Field(default=0, description="步骤排序")


class WorkflowStepResponse(WorkflowStepBase):
    """步骤响应模型"""
    id: str
    workflow_id: str
    step_order: int

    class Config:
        from_attributes = True


# ============ 工作流 Schema ============

class WorkflowBase(BaseModel):
    """工作流基础字段"""
    name: str = Field(..., min_length=1, max_length=100, description="工作流名称")
    description: str = Field(default="", description="工作流描述")


class WorkflowCreate(WorkflowBase):
    """创建工作流的请求模型"""
    steps: list[WorkflowStepCreate] = Field(default_factory=list, description="工作流步骤列表")


class WorkflowUpdate(BaseModel):
    """更新工作流的请求模型"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    steps: Optional[list[WorkflowStepCreate]] = None


class WorkflowResponse(WorkflowBase):
    """工作流响应模型"""
    id: str
    created_at: datetime
    updated_at: datetime
    steps: list[WorkflowStepResponse] = []

    class Config:
        from_attributes = True


class WorkflowListResponse(BaseModel):
    """工作流列表响应"""
    id: str
    name: str
    description: str
    step_count: int
    created_at: datetime
    updated_at: datetime


# ============ 执行相关 Schema ============

class ExecuteRequest(BaseModel):
    """执行工作流的请求模型"""
    input_text: str = Field(..., min_length=1, description="用户输入内容")
