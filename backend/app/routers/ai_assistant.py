"""
AI 对话助手路由
接收用户自然语言消息，通过 AI + 工具调用完成查询和分析操作。
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from app.database import get_session
from app.services.ai_client import ai_client
from app.services.assistant_tools import (
    build_tools_description,
    execute_tool,
    TOOL_DEFINITIONS,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-assistant", tags=["AI 对话助手"])


# ============ 请求/响应模型 ============

class ChatMessage(BaseModel):
    """单条对话消息"""
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    """对话请求"""
    message: str
    history: list[ChatMessage] = []


class ToolCallInfo(BaseModel):
    """工具调用信息（用于前端展示）"""
    tool_name: str
    tool_args: dict
    tool_result: str


class ChatResponse(BaseModel):
    """对话响应"""
    reply: str
    tool_calls: list[ToolCallInfo] = []


# ============ System Prompt ============

# NOTE: 系统 Prompt 定义 AI 助手的角色和工具使用规则
SYSTEM_PROMPT = """你是 SmartGas Grid 智慧管网系统的 AI 助手。你的职责是帮助用户查询管网数据、分析故障影响、执行推演模拟。

你的回答风格：
1. 简洁、专业、友好
2. 使用中文回复
3. 当回复包含数据列表时，用清晰的格式展示
4. 如果用户的问题不需要查询数据（如闲聊、打招呼），直接回复即可，不要调用工具

重要行为规则：
- 当用户的意图与工具能力匹配时，必须立即调用工具，不要反问用户
- 例如用户问「有多少个压气站」，直接调用 count_by_type 工具，不要追问
- 例如用户问「列出管线」，直接调用 query_pipelines 工具
- 只输出工具调用 JSON 或自然语言回复，不要输出任何思考过程

{tools_description}
"""


# ============ API 端点 ============

@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    session: Session = Depends(get_session),
):
    """
    AI 对话接口
    支持多轮对话，自动识别用户意图并调用对应的内部工具。
    """
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="消息不能为空")

    logger.info(f"AI 助手收到消息: {request.message[:100]}")

    tool_calls: list[ToolCallInfo] = []

    try:
        # 构建完整的 System Prompt（含工具描述）
        tools_desc = build_tools_description()
        system_prompt = SYSTEM_PROMPT.format(tools_description=tools_desc)

        # 构建消息历史
        messages = [{"role": "system", "content": system_prompt}]
        for msg in request.history[-10:]:  # 只保留最近 10 条历史
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": request.message})

        # 第一次 AI 调用：判断意图
        first_response = await _call_ai(messages)

        # 检测是否包含工具调用指令
        tool_call = _extract_tool_call(first_response)

        if tool_call:
            tool_name = tool_call["tool"]
            tool_args = tool_call.get("args", {})

            logger.info(f"AI 决定调用工具: {tool_name}, 参数: {tool_args}")

            # 执行工具
            tool_result = execute_tool(tool_name, tool_args, session)

            tool_calls.append(ToolCallInfo(
                tool_name=tool_name,
                tool_args=tool_args,
                tool_result=tool_result,
            ))

            # 第二次 AI 调用：基于工具结果生成自然语言回复
            messages.append({"role": "assistant", "content": first_response})
            messages.append({
                "role": "user",
                "content": f"工具 {tool_name} 的执行结果如下：\n\n{tool_result}\n\n请根据以上结果，用自然、友好的语言回答用户的原始问题。",
            })

            final_response = await _call_ai(messages)

            # 防止二次工具调用陷入递归
            if _extract_tool_call(final_response):
                final_response = tool_result

            return ChatResponse(reply=final_response, tool_calls=tool_calls)
        else:
            # 不需要工具调用，直接返回 AI 回复
            return ChatResponse(reply=first_response, tool_calls=[])

    except Exception as e:
        logger.error(f"AI 助手处理失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"AI 处理失败: {str(e)}")


# ============ 内部工具函数 ============

async def _call_ai(messages: list[dict]) -> str:
    """
    调用 AI API
    将 messages 格式转为单一 prompt 发送给 ai_client
    """
    # 拼接所有消息为单一 prompt（当前 ai_client 只支持单 prompt）
    prompt_parts = []
    for msg in messages:
        role_label = {"system": "[系统]", "user": "[用户]", "assistant": "[助手]"}.get(msg["role"], "")
        prompt_parts.append(f"{role_label} {msg['content']}")

    full_prompt = "\n\n".join(prompt_parts)

    result = await ai_client.chat_completion(
        prompt=full_prompt,
        temperature=0.3,
        max_tokens=2000,
    )

    # 过滤掉某些模型（如 Minimax）输出的 <think> 思考过程标签
    return _strip_think_tags(result)


def _extract_tool_call(response: str) -> dict | None:
    """
    从 AI 响应中提取工具调用指令。
    支持 AI 输出的 JSON 被 markdown 代码块包裹的情况。
    """
    text = response.strip()

    # 尝试直接解析
    try:
        data = json.loads(text)
        if isinstance(data, dict) and "tool" in data:
            return data
    except json.JSONDecodeError:
        pass

    # 尝试从 markdown 代码块中提取
    if "```" in text:
        try:
            start = text.index("```")
            # 跳过语言标识行
            content_start = text.index("\n", start) + 1
            end = text.index("```", content_start)
            json_str = text[content_start:end].strip()
            data = json.loads(json_str)
            if isinstance(data, dict) and "tool" in data:
                return data
        except (ValueError, json.JSONDecodeError):
            pass

    # 尝试用正则找到内嵌的 JSON 对象
    import re
    pattern = r'\{[^{}]*"tool"\s*:\s*"[^"]+?"[^{}]*\}'
    match = re.search(pattern, text)
    if match:
        try:
            data = json.loads(match.group())
            if "tool" in data:
                return data
        except json.JSONDecodeError:
            pass

    return None


def _strip_think_tags(text: str) -> str:
    """
    过滤掉 AI 输出中的 <think>...</think> 思考过程标签。
    某些模型（如 Minimax）会在回复中包含思考过程，不应暴露给用户。
    """
    import re
    # 移除 <think>...</think> 及其内容（支持多行）
    cleaned = re.sub(r'<think>.*?</think>\s*', '', text, flags=re.DOTALL)
    return cleaned.strip()
