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
    retrieval_log: list[str] = []


# ============ System Prompt ============

# NOTE: 系统 Prompt 定义 AI 助手的角色和工具使用规则，强化逻辑思考
SYSTEM_PROMPT = """你是 SmartGas Grid 智慧管网系统的高级 AI 调度专家。你的职责是基于实时的管网拓扑数据和应急预案，为用户提供精确的分析和查询。

你的分析与回答规范：
1. **按需思考 (Conditional CoT)**：
   - 如果用户的问题涉及数据查询、拓扑分析、断流推演等复杂任务，请务必先在 `<think>` 标签内进行逻辑推理。
   - 如果只是简单的打招呼、闲聊或通用咨询，请无需使用 `<think>` 标签，直接快速回答。
2. **深度分析**：在进行故障影响分析时，请检索并比对 `database_context` 中的连接关系。
3. **专业与简洁**：最终回复应专业、直截了当，使用中文。
4. **意图识别**：若意图匹配下方工具，请优先生成工具调用 JSON。

重要规则：
- **禁止反问**：意图清晰时直接执行。
- **保留思维过程**：复杂的推理逻辑请完整保留在 `<think>` 标签内。

{tools_description}
"""


# ============ API 端点 ============

@router.post("/chat")
async def chat(
    request: ChatRequest,
    session: Session = Depends(get_session),
):
    """
    AI 对话接口 (流式版)
    """
    from fastapi.responses import StreamingResponse
    msg_clean = request.message.strip()
    if not msg_clean:
        raise HTTPException(status_code=400, detail="消息不能为空")

    # 快捷回复：针对简单的问候语直接返回，秒级响应
    greetings = {"你好", "您好", "hello", "hi", "在吗", "早上好", "中午好", "下午好", "晚上好"}
    if msg_clean.lower() in greetings:
        async def quick_gen():
            reply_text = "您好！我是 SmartGas Grid AI 调度辅助专家。您可以问我关于管网数据查询、拓扑分析或断流推演的问题，我会为您提供专业的解答。"
            yield f"[REPLY] {json.dumps(reply_text, ensure_ascii=False)}\n"
        return StreamingResponse(quick_gen(), media_type="text/event-stream")

    logger.info(f"AI 助手收到消息 (流式): {msg_clean[:100]}")

    async def event_generator():
        tools_desc = build_tools_description()
        system_prompt = SYSTEM_PROMPT.format(tools_description=tools_desc)

        messages = [{"role": "system", "content": system_prompt}]
        for msg in request.history[-10:]:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": request.message})

        try:
            full_first_response = ""
            is_tool_call_likely = False
            has_started_replying = False

            # 第一步：意图识别 (改为流式，以支持快速闲聊)
            async for chunk in ai_client.chat_stream(
                prompt=_messages_to_prompt(messages),
                temperature=0.3
            ):
                full_first_response += chunk
                
                # 启发式判断：如果开头像 JSON，则可能是工具调用，先不流式输出给用户
                if not has_started_replying and not is_tool_call_likely:
                    stripped = full_first_response.strip()
                    # 如果包含 { 或 ```json，可能是工具调用
                    if '{' in stripped or '```json' in stripped:
                        is_tool_call_likely = True
                    else:
                        # 确定是闲聊，开始流式输出
                        yield f"[REPLY] {json.dumps(chunk, ensure_ascii=False)}\n"
                        has_started_replying = True
                elif has_started_replying:
                    yield f"[REPLY] {json.dumps(chunk, ensure_ascii=False)}\n"

            # 第一步结束，解析是否有工具调用
            tool_call = _extract_tool_call(full_first_response)
            from app.services.pipeline_data_service import pipeline_data_service
            
            if tool_call:
                tool_name = tool_call["tool"]
                tool_args = tool_call.get("args", {})
                
                yield f"[TOOL] {tool_name}\n"
                
                logger.info(f"执行工具: {tool_name}")
                tool_result = execute_tool(tool_name, tool_args, session)
                
                logs = getattr(pipeline_data_service, 'accessed_files', [])
                if logs:
                    yield f"[LOG] {', '.join(logs)}\n"

                # 第二步：基于工具结果生成流式回复
                messages.append({"role": "assistant", "content": full_first_response})
                messages.append({
                    "role": "user",
                    "content": f"工具 {tool_name} 的执行结果如下：\n\n{tool_result}\n\n请根据以上结果，用自然、友好的语言回答用户的原始问题。",
                })

                async for chunk in ai_client.chat_stream(
                    prompt=_messages_to_prompt(messages),
                    temperature=0.3
                ):
                    yield f"[REPLY] {json.dumps(chunk, ensure_ascii=False)}\n"
            else:
                # 已经流式输出过了，或者是 tool_call 误判但最终不是 tool_call
                if not has_started_replying:
                    # 如果之前因为怀疑是工具调用而没输出，现在补上
                    cleaned = _strip_think_tags(full_first_response)
                    yield f"[REPLY] {json.dumps(cleaned, ensure_ascii=False)}\n"
                
                logs = getattr(pipeline_data_service, 'accessed_files', [])
                if logs:
                    yield f"[LOG] {', '.join(logs)}\n"

        except Exception as e:
            logger.error(f"流式处理失败: {e}", exc_info=True)
            err_text = f"❌ 处理出错: {str(e)}"
            yield f"[REPLY] {json.dumps(err_text, ensure_ascii=False)}\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


def _messages_to_prompt(messages: list[dict]) -> str:
    """将消息列表转为单提示词"""
    prompt_parts = []
    for msg in messages:
        role_label = {"system": "[系统]", "user": "[用户]", "assistant": "[助手]"}.get(msg["role"], "")
        prompt_parts.append(f"{role_label} {msg['content']}")
    return "\n\n".join(prompt_parts)


# ============ 内部工具函数 ============

async def _call_ai(messages: list[dict]) -> str:
    """
    调用 AI API (完整版)
    """
    full_prompt = _messages_to_prompt(messages)

    result = await ai_client.chat_completion(
        prompt=full_prompt,
        temperature=0.3,
        max_tokens=2000,
    )

    # 正常返回结果，不再过滤思考过程，以便显示逻辑
    return result.strip()


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
