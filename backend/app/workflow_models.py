"""
AI 工作流 - ORM 数据模型（SQLModel 格式）
与 SmartGas 现有模型保持 ORM 一致性
"""
import uuid
from datetime import datetime
from typing import Optional, List

from sqlmodel import SQLModel, Field, Relationship


def generate_uuid() -> str:
    """生成 UUID 字符串"""
    return str(uuid.uuid4())


class AIWorkflowStep(SQLModel, table=True):
    """AI 工作流步骤表"""
    __tablename__ = "ai_workflow_steps"

    id: str = Field(default_factory=generate_uuid, primary_key=True)
    workflow_id: str = Field(foreign_key="ai_workflows.id", index=True)
    step_order: int = Field(default=0)
    name: str = Field(default="未命名步骤", max_length=100)
    prompt_template: str = Field(default="")
    model: str = Field(default="", max_length=50)
    temperature: float = Field(default=0.7)
    max_tokens: int = Field(default=2000)

    # 关联
    workflow: Optional["AIWorkflow"] = Relationship(back_populates="steps")


class AIWorkflow(SQLModel, table=True):
    """AI 工作流主表"""
    __tablename__ = "ai_workflows"

    id: str = Field(default_factory=generate_uuid, primary_key=True)
    name: str = Field(max_length=100, index=True)
    description: str = Field(default="")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # 关联步骤
    steps: List[AIWorkflowStep] = Relationship(
        back_populates="workflow",
        sa_relationship_kwargs={
            "cascade": "all, delete-orphan",
            "order_by": "AIWorkflowStep.step_order",
        },
    )
