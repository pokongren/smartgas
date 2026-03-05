"""
AI 工作流业务逻辑层
合并了原 workflow_service 和 workflow_repo 的功能
使用 SQLModel Session 适配 SmartGas 后端
"""
import logging
from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from app.workflow_models import AIWorkflow, AIWorkflowStep
from app.workflow_schemas import WorkflowCreate, WorkflowUpdate

logger = logging.getLogger(__name__)


class WorkflowService:
    """AI 工作流业务逻辑"""

    def __init__(self, session: Session):
        self.session = session

    def get_all_workflows(self) -> list[dict]:
        """
        获取所有工作流的列表摘要
        @returns 工作流列表，包含步骤数量
        """
        statement = select(AIWorkflow).order_by(AIWorkflow.updated_at.desc())
        workflows = self.session.exec(statement).all()
        return [
            {
                "id": w.id,
                "name": w.name,
                "description": w.description,
                "step_count": len(w.steps),
                "created_at": w.created_at,
                "updated_at": w.updated_at,
            }
            for w in workflows
        ]

    def get_workflow(self, workflow_id: str) -> Optional[AIWorkflow]:
        """
        获取单个工作流详情
        @param workflow_id 工作流 ID
        @returns 工作流对象或 None
        """
        return self.session.get(AIWorkflow, workflow_id)

    def create_workflow(self, data: WorkflowCreate) -> AIWorkflow:
        """
        创建新工作流
        @param data 工作流创建数据
        @returns 创建的工作流对象
        """
        workflow = AIWorkflow(
            name=data.name,
            description=data.description,
        )

        # 创建步骤
        for i, step_data in enumerate(data.steps):
            step = AIWorkflowStep(
                step_order=i,
                name=step_data.name,
                prompt_template=step_data.prompt_template,
                model=step_data.model,
                temperature=step_data.temperature,
                max_tokens=step_data.max_tokens,
            )
            workflow.steps.append(step)

        self.session.add(workflow)
        self.session.commit()
        self.session.refresh(workflow)
        logger.info(f"创建工作流: id={workflow.id}, name={workflow.name}")
        return workflow

    def update_workflow(self, workflow_id: str, data: WorkflowUpdate) -> Optional[AIWorkflow]:
        """
        更新工作流
        @param workflow_id 工作流 ID
        @param data 更新数据
        @returns 更新后的工作流对象或 None
        """
        workflow = self.session.get(AIWorkflow, workflow_id)
        if not workflow:
            return None

        if data.name is not None:
            workflow.name = data.name
        if data.description is not None:
            workflow.description = data.description

        # 如果传入了步骤数据，则替换所有步骤
        if data.steps is not None:
            # 删除旧步骤
            for step in list(workflow.steps):
                self.session.delete(step)

            workflow.steps = []
            for i, step_data in enumerate(data.steps):
                step = AIWorkflowStep(
                    workflow_id=workflow_id,
                    step_order=i,
                    name=step_data.name,
                    prompt_template=step_data.prompt_template,
                    model=step_data.model,
                    temperature=step_data.temperature,
                    max_tokens=step_data.max_tokens,
                )
                workflow.steps.append(step)

        workflow.updated_at = datetime.utcnow()
        self.session.commit()
        self.session.refresh(workflow)
        logger.info(f"更新工作流: id={workflow_id}")
        return workflow

    def delete_workflow(self, workflow_id: str) -> bool:
        """
        删除工作流
        @param workflow_id 工作流 ID
        @returns 是否删除成功
        """
        workflow = self.session.get(AIWorkflow, workflow_id)
        if not workflow:
            return False

        self.session.delete(workflow)
        self.session.commit()
        logger.info(f"删除工作流: id={workflow_id}")
        return True
