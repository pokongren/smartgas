"""
工作流执行引擎
负责按步骤顺序执行工作流，支持步骤间变量传递
"""
import logging
from typing import AsyncGenerator

from app.workflow_models import AIWorkflow
from app.services.ai_client import ai_client

logger = logging.getLogger(__name__)


class ExecutionEngine:
    """
    工作流执行引擎
    核心逻辑：按步骤顺序执行，每步的输出可作为下一步的输入
    """

    @staticmethod
    def render_template(template: str, variables: dict[str, str]) -> str:
        """
        渲染提示词模板，将 {{变量名}} 替换为实际值
        @param template 提示词模板
        @param variables 变量字典
        @returns 替换后的提示词
        """
        result = template
        for key, value in variables.items():
            # 支持 {{input}}、{{prev_output}}、{{step_N_output}} 格式
            result = result.replace(f"{{{{{key}}}}}", value)
        return result

    async def execute_workflow(
        self,
        workflow: AIWorkflow,
        input_text: str,
        session=None,
    ) -> AsyncGenerator[dict, None]:
        """
        执行完整工作流，逐步返回结果（SSE 流式）
        @param workflow 工作流对象
        @param input_text 用户输入内容
        @returns 异步生成器，逐步返回执行结果
        """
        steps = sorted(workflow.steps, key=lambda s: s.step_order)
        if not steps:
            yield {
                "type": "error",
                "message": "工作流没有配置任何步骤",
            }
            return

        # 存储每步输出，用于变量传递
        step_outputs: dict[str, str] = {}
        prev_output = ""

        yield {
            "type": "start",
            "workflow_name": workflow.name,
            "total_steps": len(steps),
        }

        # 构建知识库和数据库上下文
        database_context = "暂无数据库信息"
        rag_context = "暂无业务知识"

        if session is not None:
            try:
                from app.services.topology import TopologyService
                topo = TopologyService(session)
                summary = topo.get_graph_summary()
                critical_nodes = topo.find_critical_nodes()
                
                db_info = f"【管网拓扑概览】\n"
                db_info += f"总站场数: {summary.get('node_count')}\n"
                db_info += f"总管段数: {summary.get('edge_count')}\n"
                db_info += f"全网总管存预测: {summary.get('total_linepack')} 万标方\n\n"
                
                if critical_nodes:
                    db_info += "【当前全网排名前 5 的关键枢纽(瓶颈)节点】\n"
                    for node, score in critical_nodes.items():
                        db_info += f"- {node} (介数得分: {score})\n"
                        
                database_context = db_info
            except Exception as e:
                logger.error(f"提取数据库上下文失败: {e}")

        try:
            from app.services.rag_mock import RAGService
            rag = RAGService()
            rag_res = rag.query(input_text)
            if rag_res and rag_res.get("answer"):
                rag_context = f"【匹配到的规程/预案/知识】\n{rag_res.get('answer')}\n(来源: {rag_res.get('source', '未知')})"
        except Exception as e:
            logger.error(f"提取 RAG 上下文失败: {e}")

        # 将构建好的上下文信息发送给前端
        yield {
            "type": "context_ready",
            "database_context": database_context,
            "rag_context": rag_context,
        }

        for i, step in enumerate(steps):
            step_name = step.name or f"步骤 {i + 1}"

            yield {
                "type": "step_start",
                "step_order": i,
                "step_name": step_name,
            }

            try:
                # 构造变量映射
                variables = {
                    "input": input_text,
                    "prev_output": prev_output,
                    "database_context": database_context,
                    "rag_context": rag_context,
                }
                # 添加所有已执行步骤的输出
                variables.update(step_outputs)

                # 渲染模板
                prompt = self.render_template(step.prompt_template, variables)

                if not prompt.strip():
                    # 如果模板为空，直接传递输入
                    output = input_text if i == 0 else prev_output
                else:
                    # 调用 AI API
                    output = await ai_client.chat_completion(
                        prompt=prompt,
                        model=step.model,
                        temperature=step.temperature,
                        max_tokens=step.max_tokens,
                    )

                # 记录输出
                step_outputs[f"step_{i + 1}_output"] = output
                prev_output = output

                yield {
                    "type": "step_complete",
                    "step_order": i,
                    "step_name": step_name,
                    "output": output,
                }

            except Exception as e:
                logger.error(f"步骤 {step_name} 执行失败: {e}")
                yield {
                    "type": "step_error",
                    "step_order": i,
                    "step_name": step_name,
                    "error": str(e),
                }
                return

        yield {
            "type": "complete",
            "final_output": prev_output,
        }


# 全局单例
execution_engine = ExecutionEngine()
