"""
AI assistant chat router.
"""

from __future__ import annotations

import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.database import get_session
from app.models import Pipeline, PipelineSystem, Station
from app.services.ai_analysis_orchestrator import AiAnalysisOrchestrator, AssistantContext
from app.services.ai_client import AiServiceError, ai_client
from app.services.assistant_tools import build_tools_description, execute_tool
from app.services.raw_excel_ai_direct import (
    try_direct_count_reply as try_raw_excel_direct_count_reply,
    try_direct_entity_lookup as try_raw_excel_direct_entity_lookup,
    try_direct_list_reply as try_raw_excel_direct_list_reply,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-assistant", tags=["AI 对话助手"])
ai_analysis_orchestrator = AiAnalysisOrchestrator()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    context: AssistantContext | None = None
    analysis_mode: str | None = None


class ToolCallInfo(BaseModel):
    tool_name: str
    tool_args: dict
    tool_result: str


class ChatResponse(BaseModel):
    reply: str
    tool_calls: list[ToolCallInfo] = Field(default_factory=list)
    retrieval_log: list[str] = Field(default_factory=list)


SYSTEM_PROMPT = """你是 SmartGas Grid 的智能调度助手，既懂天然气管网业务，也会像一个靠谱同事那样和用户交流。
回复要求：
1. 全程使用自然、口语化但专业的中文，优先说人话，少用官话、套话、模板腔。
2. 先直接回答用户最关心的问题，再补充必要依据；不要一上来长篇铺垫。
3. 如果问题简单，也不要只给一句过短结论；要把当前能确认的关键信息一次说完整。
4. 除非用户明确要求，不要自我介绍，不要反复说“作为 AI 助手”。
5. 能明确判断用户意图时，直接执行或回答，不要机械追问。
6. 如果需要调用工具，请优先输出工具调用 JSON；拿到工具结果后，用自然、友好的语言总结，不要把原始推理过程暴露给用户。
7. 如果信息不足，直接指出缺什么；如果结论有前提，也要说清楚，不要装得很确定。
8. 用户明确要“列表/清单/全部/所有”时，直接给完整列表，用换行列表展示，不要只摘前几条，也不要说“要完整列表可以告诉我”。
9. 回答末尾补一行“完整性提示：是/否”，明确说明这次回答是不是完整回答；如果不是，要直接说原因。
表达风格：
- 多用短句，少用公文式表达。
- 尽量贴近用户原话风格；用户随意一点，你也可以自然一点。
- 避免“您好，您可以……”“根据您提供的信息……”这类生硬客服腔。
- 结尾只在合适时补一句下一步建议，不要每次都问候或反问。
{tools_description}
"""


@router.post("/chat")
async def chat(
    request: ChatRequest,
    session: Session = Depends(get_session),
):
    msg_clean = request.message.strip()
    if not msg_clean:
        raise HTTPException(status_code=400, detail="消息不能为空")

    greetings = {"你好", "您好", "hello", "hi", "在吗", "早上好", "中午好", "下午好", "晚上好"}
    if msg_clean.lower() in greetings:

        async def quick_gen():
            reply_text = "你好，我在。你直接说想查什么、分析什么，或者哪里看着不对，我帮你一起看。"
            yield f"[REPLY] {json.dumps(reply_text, ensure_ascii=False)}\n"

        return StreamingResponse(quick_gen(), media_type="text/event-stream")

    logger.info("AI assistant received message: %s", msg_clean[:100])

    direct_count_reply = try_raw_excel_direct_count_reply(msg_clean)
    if direct_count_reply:

        async def direct_count_gen():
            yield f"[REPLY] {json.dumps(direct_count_reply, ensure_ascii=False)}\n"

        return StreamingResponse(direct_count_gen(), media_type="text/event-stream")

    direct_list_reply = try_raw_excel_direct_list_reply(msg_clean)
    if direct_list_reply:

        async def direct_list_gen():
            yield f"[REPLY] {json.dumps(direct_list_reply, ensure_ascii=False)}\n"

        return StreamingResponse(direct_list_gen(), media_type="text/event-stream")

    direct_lookup_reply = try_raw_excel_direct_entity_lookup(msg_clean)
    if direct_lookup_reply:

        async def direct_gen():
            yield f"[REPLY] {json.dumps(direct_lookup_reply, ensure_ascii=False)}\n"

        return StreamingResponse(direct_gen(), media_type="text/event-stream")

    if ai_analysis_orchestrator.should_use_orchestration(request.context, request.analysis_mode):
        return StreamingResponse(
            _orchestrated_event_generator(request=request, session=session),
            media_type="text/event-stream",
        )

    return StreamingResponse(
        _legacy_event_generator(request=request, session=session),
        media_type="text/event-stream",
    )


async def generate_chat_response(request: ChatRequest, session: Session) -> ChatResponse:
    """
    给非流式入口复用 AI 助手能力。
    典型场景：飞书机器人、定时任务、外部 webhook。
    """
    msg_clean = request.message.strip()
    if not msg_clean:
        raise HTTPException(status_code=400, detail="消息不能为空")

    direct_reply = _resolve_direct_reply(msg_clean)
    if direct_reply is not None:
        return ChatResponse(reply=direct_reply)

    if ai_analysis_orchestrator.should_use_orchestration(request.context, request.analysis_mode):
        event_generator = _orchestrated_event_generator(request=request, session=session)
    else:
        event_generator = _legacy_event_generator(request=request, session=session)

    return await _collect_chat_response(event_generator)


def _resolve_direct_reply(message: str) -> str | None:
    msg_clean = message.strip()
    greetings = {"你好", "您好", "hello", "hi", "在吗", "早上好", "中午好", "下午好", "晚上好"}
    if msg_clean.lower() in greetings:
        return "你好，我在。你直接说想查什么、分析什么，或者哪里看着不对，我帮你一起看。"

    direct_count_reply = try_raw_excel_direct_count_reply(msg_clean)
    if direct_count_reply:
        return direct_count_reply

    direct_list_reply = try_raw_excel_direct_list_reply(msg_clean)
    if direct_list_reply:
        return direct_list_reply

    direct_lookup_reply = try_raw_excel_direct_entity_lookup(msg_clean)
    if direct_lookup_reply:
        return direct_lookup_reply

    return None


async def _collect_chat_response(event_generator) -> ChatResponse:
    reply_parts: list[str] = []
    retrieval_log: list[str] = []

    async for raw_event in event_generator:
        event = raw_event.strip()
        if not event:
            continue

        if event.startswith("[REPLY] "):
            payload = event[8:]
            try:
                parsed = json.loads(payload)
                reply_parts.append(parsed if isinstance(parsed, str) else payload)
            except json.JSONDecodeError:
                reply_parts.append(payload)
            continue

        if event.startswith("[LOG] "):
            retrieval_log.extend(part for part in event[6:].split(", ") if part)

    return ChatResponse(
        reply="".join(reply_parts).strip(),
        retrieval_log=retrieval_log,
    )


async def _legacy_event_generator(request: ChatRequest, session: Session):
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

        async for chunk in ai_client.chat_stream(
            messages=messages,
            temperature=0.7,
        ):
            full_first_response += chunk

            if not has_started_replying and not is_tool_call_likely:
                stripped = full_first_response.strip()
                if "{" in stripped or "```json" in stripped:
                    is_tool_call_likely = True
                else:
                    yield f"[REPLY] {json.dumps(chunk, ensure_ascii=False)}\n"
                    has_started_replying = True
            elif has_started_replying:
                yield f"[REPLY] {json.dumps(chunk, ensure_ascii=False)}\n"

        tool_call = _extract_tool_call(full_first_response)

        from app.services.pipeline_data_service import pipeline_data_service

        if tool_call:
            tool_name = tool_call["tool"]
            tool_args = tool_call.get("args", {})

            yield f"[TOOL] {tool_name}\n"

            logger.info("Executing assistant tool: %s", tool_name)
            tool_result = execute_tool(tool_name, tool_args, session)

            logs = getattr(pipeline_data_service, "accessed_files", [])
            if logs:
                yield f"[LOG] {', '.join(logs)}\n"

            messages.append({"role": "assistant", "content": full_first_response})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"工具 {tool_name} 的执行结果如下：\n\n{tool_result}\n\n"
                        "请根据以上结果，用自然、友好的语言回答用户的原始问题。"
                        "先给结论，再补充必要说明；避免客服腔和模板腔。"
                        "如果用户要列表，就直接给完整列表。"
                        "最后补一行“完整性提示：是/否 + 原因”。"
                    ),
                }
            )

            full_second_response = ""
            async for chunk in ai_client.chat_stream(
                messages=messages,
                temperature=0.75,
            ):
                full_second_response += chunk
                yield f"[REPLY] {json.dumps(chunk, ensure_ascii=False)}\n"

            suffix = _build_completeness_suffix(
                reply=full_second_response,
                user_message=request.message,
            )
            if suffix:
                yield f"[REPLY] {json.dumps(suffix, ensure_ascii=False)}\n"
        else:
            if not has_started_replying:
                cleaned = _strip_think_tags(full_first_response)
                yield f"[REPLY] {json.dumps(cleaned, ensure_ascii=False)}\n"
                suffix = _build_completeness_suffix(
                    reply=cleaned,
                    user_message=request.message,
                )
                if suffix:
                    yield f"[REPLY] {json.dumps(suffix, ensure_ascii=False)}\n"
            else:
                suffix = _build_completeness_suffix(
                    reply=full_first_response,
                    user_message=request.message,
                )
                if suffix:
                    yield f"[REPLY] {json.dumps(suffix, ensure_ascii=False)}\n"

            logs = getattr(pipeline_data_service, "accessed_files", [])
            if logs:
                yield f"[LOG] {', '.join(logs)}\n"

    except AiServiceError as exc:
        logger.warning("Legacy AI stream service error: %s", exc.message)
        yield f"[REPLY] {json.dumps(exc.message, ensure_ascii=False)}\n"
    except Exception as exc:
        logger.error("Legacy AI stream failed: %s", exc, exc_info=True)
        err_text = f"处理出错：{exc}"
        yield f"[REPLY] {json.dumps(err_text, ensure_ascii=False)}\n"


async def _orchestrated_event_generator(request: ChatRequest, session: Session):
    tools_desc = build_tools_description()
    prompt_bundle = ai_analysis_orchestrator.prepare_messages(
        system_prompt_template=SYSTEM_PROMPT,
        tools_description=tools_desc,
        history=request.history,
        message=request.message,
        context=request.context,
        analysis_mode=request.analysis_mode,
    )

    from app.services.pipeline_data_service import pipeline_data_service

    try:
        conversation_messages = list(prompt_bundle.messages)
        first_response = await ai_client.chat_completion(
            messages=conversation_messages,
            temperature=0.7,
            max_tokens=2000,
        )

        tool_call = _extract_tool_call(first_response)
        tool_name: str | None = None
        tool_result: str | None = None

        if tool_call:
            tool_name = tool_call["tool"]
            tool_args = tool_call.get("args", {})
            yield f"[TOOL] {tool_name}\n"

            logger.info("Executing orchestrated assistant tool: %s", tool_name)
            tool_result = execute_tool(tool_name, tool_args, session)

            logs = getattr(pipeline_data_service, "accessed_files", [])
            if logs:
                yield f"[LOG] {', '.join(logs)}\n"

            conversation_messages.append({"role": "assistant", "content": first_response})
            conversation_messages.append(
                {
                    "role": "user",
                    "content": ai_analysis_orchestrator.build_tool_result_follow_up(
                        tool_name=tool_name,
                        tool_result=tool_result,
                        context_summary=prompt_bundle.context_summary,
                    ),
                }
            )
            draft_reply = await ai_client.chat_completion(
                messages=conversation_messages,
                temperature=0.75,
                max_tokens=2000,
            )
        else:
            draft_reply = _strip_think_tags(first_response)
            logs = getattr(pipeline_data_service, "accessed_files", [])
            if logs:
                yield f"[LOG] {', '.join(logs)}\n"

        validation_report = ai_analysis_orchestrator.validate_reply(
            user_message=request.message,
            reply=draft_reply,
            tool_name=tool_name,
            tool_result=tool_result,
            context_summary=prompt_bundle.context_summary,
        )

        final_reply = _salvage_user_facing_reply(draft_reply, first_response) or _strip_think_tags(draft_reply)
        if validation_report.requires_revision:
            conversation_messages.append({"role": "assistant", "content": draft_reply})
            conversation_messages.append(
                {
                    "role": "user",
                    "content": ai_analysis_orchestrator.build_repair_prompt(
                        original_question=request.message,
                        draft_reply=draft_reply,
                        validation_report=validation_report,
                    ),
                }
            )
            repaired_reply = await ai_client.chat_completion(
                messages=conversation_messages,
                temperature=0.45,
                max_tokens=2000,
            )
            repaired_validation = ai_analysis_orchestrator.validate_reply(
                user_message=request.message,
                reply=repaired_reply,
                tool_name=tool_name,
                tool_result=tool_result,
                context_summary=prompt_bundle.context_summary,
            )

            if repaired_validation.requires_revision:
                logger.warning("Orchestrated repair reply still failed validation")
                final_reply = _salvage_user_facing_reply(repaired_reply, draft_reply, first_response) or (
                    "抱歉，这次结果还不够稳定。"
                    "我先没法给你一个可靠结论。"
                    "你可以换个问法，或者告诉我当前页面和对象，我再重新分析。"
                )
            else:
                final_reply = _salvage_user_facing_reply(repaired_reply, draft_reply) or _strip_think_tags(repaired_reply)

        final_reply = _append_completeness_hint(final_reply, request.message)
        yield f"[REPLY] {json.dumps(final_reply, ensure_ascii=False)}\n"
    except AiServiceError as exc:
        logger.warning("Orchestrated AI flow service error: %s", exc.message)
        yield f"[REPLY] {json.dumps(_append_completeness_hint(exc.message, request.message), ensure_ascii=False)}\n"
    except Exception as exc:
        logger.error("Orchestrated AI flow failed: %s", exc, exc_info=True)
        err_text = f"处理出错：{exc}"
        yield f"[REPLY] {json.dumps(_append_completeness_hint(err_text, request.message), ensure_ascii=False)}\n"


def _messages_to_prompt(messages: list[dict]) -> str:
    prompt_parts = []
    for msg in messages:
        role_label = {"system": "[系统]", "user": "[用户]", "assistant": "[助手]"}.get(msg["role"], "")
        prompt_parts.append(f"{role_label} {msg['content']}")
    return "\n\n".join(prompt_parts)


async def _call_ai(messages: list[dict]) -> str:
    result = await ai_client.chat_completion(
        messages=messages,
        temperature=0.7,
        max_tokens=2000,
    )
    return result.strip()


def _extract_tool_call(response: str) -> dict | None:
    text = response.strip()

    try:
        data = json.loads(text)
        if isinstance(data, dict) and "tool" in data:
            return data
    except json.JSONDecodeError:
        pass

    if "```" in text:
        try:
            start = text.index("```")
            content_start = text.index("\n", start) + 1
            end = text.index("```", content_start)
            json_str = text[content_start:end].strip()
            data = json.loads(json_str)
            if isinstance(data, dict) and "tool" in data:
                return data
        except (ValueError, json.JSONDecodeError):
            pass

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
    cleaned = re.sub(r"<think>.*?</think>\s*", "", text, flags=re.DOTALL)
    return cleaned.strip()


def _salvage_user_facing_reply(*candidates: str | None) -> str | None:
    for candidate in candidates:
        cleaned = _clean_model_reply(candidate)
        if _is_usable_user_reply(cleaned):
            return cleaned
    return None


def _clean_model_reply(text: str | None) -> str:
    if not text:
        return ""

    cleaned = _strip_think_tags(text)
    cleaned = re.sub(
        r"```(?:json)?\s*([\s\S]*?)```",
        lambda match: _strip_tool_block(match.group(1)),
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\{[\s\S]*?\"tool\"\s*:\s*\"[^\"]+\"[\s\S]*?\}", "", cleaned)

    filtered_lines: list[str] = []
    for raw_line in cleaned.splitlines():
        line = raw_line.strip()
        if not line:
            filtered_lines.append("")
            continue

        if _looks_like_tool_payload_fragment(line):
            continue

        filtered_lines.append(raw_line)

    cleaned = "\n".join(filtered_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip("` \n\t")


def _strip_tool_block(block: str) -> str:
    content = block.strip()
    if _looks_like_raw_tool_payload(content):
        return ""
    return content


def _looks_like_tool_payload_fragment(line: str) -> bool:
    stripped = line.strip().strip(",")
    if not stripped:
        return False

    fragment_markers = (
        '"tool"',
        '"args"',
        "```json",
        "```",
        "调用工具",
        "工具调用",
        "call_tool",
    )
    if any(marker in stripped for marker in fragment_markers):
        return True

    return stripped in {"{", "}", "[", "]"}


def _is_usable_user_reply(text: str) -> bool:
    if not text or len(text) < 6:
        return False
    if "<think>" in text or "</think>" in text:
        return False
    if _looks_like_raw_tool_payload(text):
        return False

    meta_only_patterns = (
        "我来调用",
        "先调用",
        "让我调用",
        "我先查一下",
        "正在调用",
    )
    return not any(pattern in text and len(text) <= 18 for pattern in meta_only_patterns)


def _looks_like_raw_tool_payload(text: str) -> bool:
    content = (text or "").strip()
    if not content:
        return False

    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        payload = None

    if isinstance(payload, dict) and "tool" in payload:
        return True

    return '"tool"' in content and content.lstrip().startswith("{")


def _append_completeness_hint(
    reply: str,
    user_message: str,
    *,
    is_complete: bool | None = None,
    reason: str | None = None,
) -> str:
    if not reply:
        return reply
    if "完整性提示：" in reply:
        return reply

    resolved_is_complete = is_complete
    resolved_reason = reason
    if resolved_is_complete is None:
        resolved_is_complete, resolved_reason = _infer_completeness(reply, user_message)

    status = "是" if resolved_is_complete else "否"
    detail = resolved_reason or ("已给出完整回答。" if resolved_is_complete else "当前回答还不够完整。")
    return f"{reply.rstrip()}\n\n完整性提示：{status}，{detail}"


def _build_completeness_suffix(reply: str, user_message: str) -> str:
    if not reply or "完整性提示：" in reply:
        return ""
    is_complete, reason = _infer_completeness(reply, user_message)
    status = "是" if is_complete else "否"
    return f"\n\n完整性提示：{status}，{reason}"


def _infer_completeness(reply: str, user_message: str) -> tuple[bool, str]:
    content = (reply or "").strip()
    if not content:
        return False, "当前没有生成有效内容。"

    incomplete_markers = (
        "抱歉，这次结果还不够稳定",
        "我先没法给你一个可靠结论",
        "要完整列表可以告诉我",
        "只显示前",
        "仅显示前",
        "还有 ",
        "未显示",
        "可以继续往下查",
        "可以继续补充",
        "你如果说的是其中一个",
    )
    if any(marker in content for marker in incomplete_markers):
        return False, "当前回复里仍有省略或待补充项。"

    if _user_asks_for_list(user_message) and not _reply_has_list(content):
        return False, "你这次问的是列表，但回复里没有按列表完整展开。"

    if "AI 服务" in content or "处理出错" in content:
        return False, "当前链路报错，没法确认回答完整。"

    return True, "按当前数据和上下文，未检测到明显缺项。"


def _user_asks_for_list(message: str) -> bool:
    text = re.sub(r"\s+", "", message or "")
    if not text:
        return False
    keywords = ("列表", "清单", "列出", "全部", "所有", "有哪些")
    return any(keyword in text for keyword in keywords)


def _user_asks_for_count(message: str) -> bool:
    text = re.sub(r"\s+", "", message or "")
    if not text:
        return False
    keywords = ("多少", "几座", "几个", "几条", "几处")
    return any(keyword in text for keyword in keywords)


def _reply_has_list(reply: str) -> bool:
    lines = [line.strip() for line in (reply or "").splitlines() if line.strip()]
    if len(lines) < 2:
        return False
    return any(
        re.match(r"^(?:[-*•]\s+|\d+\.\s+)", line)
        for line in lines
    )


def _try_direct_count_reply(message: str, session: Session) -> str | None:
    count_request = _parse_direct_collection_request(message, session)
    if not count_request or not _user_asks_for_count(message):
        return None

    if count_request["kind"] == "stations":
        stations = _query_station_collection(session, count_request)
        return _format_station_count_reply(
            stations=stations,
            label=count_request["label"],
            scope_label=count_request.get("scope_label"),
            user_message=message,
        )

    pipelines = _query_pipeline_collection(session, count_request)
    return _format_pipeline_count_reply(
        pipelines=pipelines,
        label=count_request["label"],
        scope_label=count_request.get("scope_label"),
        session=session,
        user_message=message,
    )


def _try_direct_list_reply(message: str, session: Session) -> str | None:
    list_request = _parse_direct_collection_request(message, session)
    if not list_request:
        return None

    kind = list_request["kind"]
    label = list_request["label"]

    if kind == "stations":
        stations = _query_station_collection(session, list_request)
        return _format_station_list_reply(
            stations=stations,
            label=label,
            include_type=list_request.get("station_type") is None,
            scope_label=list_request.get("scope_label"),
            user_message=message,
        )

    pipelines = _query_pipeline_collection(session, list_request)
    return _format_pipeline_list_reply(
        pipelines=pipelines,
        label=label,
        session=session,
        scope_label=list_request.get("scope_label"),
        user_message=message,
    )


def _parse_direct_collection_request(message: str, session: Session) -> dict[str, str] | None:
    if not (_user_asks_for_list(message) or _user_asks_for_count(message)):
        return None

    normalized = re.sub(r"\s+", "", message or "")
    scope = _extract_pipeline_scope(normalized, session)

    station_patterns = [
        ("compressor", "压气站"),
        ("distribution", "分输站"),
        ("source", "气源站"),
        ("valve", "阀室"),
    ]
    for station_type, label in station_patterns:
        if label in normalized:
            request = {"kind": "stations", "station_type": station_type, "label": label}
            if scope:
                request.update(scope)
            return request

    if "站场" in normalized or "站点" in normalized:
        request = {"kind": "stations", "label": "站场"}
        if scope:
            request.update(scope)
        return request

    pipeline_patterns = [
        ("trunk", "干线"),
        ("branch", "支线"),
    ]
    for category, label in pipeline_patterns:
        if label in normalized:
            request = {"kind": "pipelines", "category": category, "label": label}
            if scope:
                request.update(scope)
            return request

    if "管线" in normalized or "管道" in normalized:
        request = {"kind": "pipelines", "label": "管线"}
        if scope:
            request.update(scope)
        return request

    return None


def _format_station_list_reply(
    *,
    stations: list[Station],
    label: str,
    include_type: bool,
    scope_label: str | None,
    user_message: str,
) -> str:
    scoped_label = f"{scope_label}{label}" if scope_label else label
    if not stations:
        return _append_completeness_hint(
            f"当前业务库里没有查到{scoped_label}列表。",
            user_message,
            is_complete=True,
            reason="已按当前业务库完整检索，但没有匹配结果。",
        )

    type_map = {
        "source": "气源站",
        "compressor": "压气站",
        "distribution": "分输站",
        "valve": "阀室",
        "other": "站场",
    }
    lines = [f"{scoped_label}完整列表如下，共 {len(stations)} 座：", ""]
    lines.append("| 序号 | 名称 | ID | 类型 | 设计压力(MPa) |")
    lines.append("| --- | --- | --- | --- | --- |")
    for index, station in enumerate(stations, start=1):
        type_label = type_map.get(station.type, station.type)
        pressure = f"{station.design_pressure:.2f}" if station.design_pressure is not None else "未知"
        lines.append(f"| {index} | {station.name} | {station.id} | {type_label if include_type else label} | {pressure} |")

    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"已按当前业务库返回完整列表，共 {len(stations)} 座。",
    )


def _format_pipeline_list_reply(
    *,
    pipelines: list[Pipeline],
    label: str,
    session: Session,
    scope_label: str | None,
    user_message: str,
) -> str:
    scoped_label = f"{scope_label}{label}" if scope_label else label
    if not pipelines:
        return _append_completeness_hint(
            f"当前业务库里没有查到{scoped_label}列表。",
            user_message,
            is_complete=True,
            reason="已按当前业务库完整检索，但没有匹配结果。",
        )

    station_ids = {pipeline.start_station_id for pipeline in pipelines} | {pipeline.end_station_id for pipeline in pipelines}
    station_map = {
        station.id: station.name
        for station in session.exec(select(Station).where(Station.id.in_(station_ids))).all()
    }
    lines = [f"{scoped_label}完整列表如下，共 {len(pipelines)} 条：", ""]
    lines.append("| 序号 | 名称 | ID | 连接关系 | 长度(km) | 管径(mm) |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for index, pipeline in enumerate(pipelines, start=1):
        start_name = station_map.get(pipeline.start_station_id, pipeline.start_station_id)
        end_name = station_map.get(pipeline.end_station_id, pipeline.end_station_id)
        length = f"{pipeline.length_km:.2f}" if pipeline.length_km else "未知"
        diameter = pipeline.diameter_mm or pipeline.diameter
        diameter_text = f"{float(diameter):.0f}" if diameter else "未知"
        lines.append(
            f"| {index} | {pipeline.name} | {pipeline.id} | {start_name} -> {end_name} | {length} | {diameter_text} |"
        )

    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"已按当前业务库返回完整列表，共 {len(pipelines)} 条。",
    )


def _format_station_count_reply(
    *,
    stations: list[Station],
    label: str,
    scope_label: str | None,
    user_message: str,
) -> str:
    scoped_label = f"{scope_label}{label}" if scope_label else label
    if not stations:
        return _append_completeness_hint(
            f"{scoped_label}共 0 座，当前业务库里没有匹配结果。",
            user_message,
            is_complete=True,
            reason="已按当前业务库完整检索，但没有匹配结果。",
        )

    lines = [f"{scoped_label}共 {len(stations)} 座。", ""]
    lines.append("| 序号 | 名称 | ID | 设计压力(MPa) |")
    lines.append("| --- | --- | --- | --- |")
    for index, station in enumerate(stations, start=1):
        pressure = f"{station.design_pressure:.2f}" if station.design_pressure is not None else "未知"
        lines.append(f"| {index} | {station.name} | {station.id} | {pressure} |")

    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"已按当前业务库返回完整统计和明细，共 {len(stations)} 座。",
    )


def _format_pipeline_count_reply(
    *,
    pipelines: list[Pipeline],
    label: str,
    scope_label: str | None,
    session: Session,
    user_message: str,
) -> str:
    scoped_label = f"{scope_label}{label}" if scope_label else label
    if not pipelines:
        return _append_completeness_hint(
            f"{scoped_label}共 0 条，当前业务库里没有匹配结果。",
            user_message,
            is_complete=True,
            reason="已按当前业务库完整检索，但没有匹配结果。",
        )

    station_ids = {pipeline.start_station_id for pipeline in pipelines} | {pipeline.end_station_id for pipeline in pipelines}
    station_map = {
        station.id: station.name
        for station in session.exec(select(Station).where(Station.id.in_(station_ids))).all()
    }
    lines = [f"{scoped_label}共 {len(pipelines)} 条。", ""]
    lines.append("| 序号 | 名称 | ID | 连接关系 |")
    lines.append("| --- | --- | --- | --- |")
    for index, pipeline in enumerate(pipelines, start=1):
        start_name = station_map.get(pipeline.start_station_id, pipeline.start_station_id)
        end_name = station_map.get(pipeline.end_station_id, pipeline.end_station_id)
        lines.append(f"| {index} | {pipeline.name} | {pipeline.id} | {start_name} -> {end_name} |")

    return _append_completeness_hint(
        "\n".join(lines),
        user_message,
        is_complete=True,
        reason=f"已按当前业务库返回完整统计和明细，共 {len(pipelines)} 条。",
    )


def _extract_pipeline_scope(normalized_message: str, session: Session) -> dict[str, str] | None:
    system = _match_pipeline_system(normalized_message, session)
    if not system:
        return None

    return {
        "system_id": str(system["id"]),
        "scope_label": str(system["name"]),
        "system_prefixes": ",".join(str(prefix) for prefix in system["prefixes"]),
    }


def _match_pipeline_system(normalized_message: str, session: Session) -> dict[str, str | list[str]] | None:
    message = normalized_message.replace("线", "线")
    systems = session.exec(select(PipelineSystem).order_by(PipelineSystem.sort_order)).all()
    best_match: dict[str, str | list[str]] | None = None
    best_score = -1

    for system in systems:
        candidate_names = {
            re.sub(r"\s+", "", system.name or ""),
            re.sub(r"\s+", "", (system.id or "").upper()),
        }

        for alias in _build_pipeline_system_aliases(system):
            candidate_names.add(alias)

        matching_names = [candidate for candidate in candidate_names if candidate and candidate in message]
        if not matching_names:
            continue

        longest_match = max(len(name) for name in matching_names)
        if longest_match <= best_score:
            continue

        best_score = longest_match
        best_match = {
            "id": system.id,
            "name": system.name,
            "prefixes": _extract_pipeline_prefixes(system),
        }

    return best_match


def _build_pipeline_system_aliases(system: PipelineSystem) -> set[str]:
    aliases = {re.sub(r"\s+", "", system.name or "")}
    normalized_name = re.sub(r"\s+", "", system.name or "")

    replacements = {
        "西气东输一线": {"西一线", "西气东输1线"},
        "西气东输二线": {"西二线", "西气东输2线"},
        "西气东输三线": {"西三线", "西气东输3线"},
        "陕京二线": {"陕二线", "陕京2线"},
        "陕京三线": {"陕三线", "陕京3线"},
        "陕京四线": {"陕四线", "陕京4线"},
    }
    aliases.update(replacements.get(normalized_name, set()))
    return aliases


def _extract_pipeline_prefixes(system: PipelineSystem) -> list[str]:
    prefixes: list[str] = []
    if system.layers_config:
        try:
            payload = json.loads(system.layers_config)
        except json.JSONDecodeError:
            payload = []
        if isinstance(payload, list):
            for item in payload:
                prefix = str(item.get("id_prefix", "")).strip() if isinstance(item, dict) else ""
                if prefix:
                    prefixes.append(prefix)

    if not prefixes:
        prefixes.append(system.id.upper())

    return list(dict.fromkeys(prefixes))


def _query_station_collection(session: Session, request: dict[str, str]) -> list[Station]:
    stmt = select(Station)
    station_type = request.get("station_type")
    if station_type:
        stmt = stmt.where(Station.type == station_type)

    stations = session.exec(stmt).all()
    prefixes = _resolve_scope_prefixes(request)
    if prefixes:
        stations = [station for station in stations if _matches_prefixes(station.id, prefixes)]

    return sorted(stations, key=lambda station: _natural_sort_key(station.id))


def _query_pipeline_collection(session: Session, request: dict[str, str]) -> list[Pipeline]:
    stmt = select(Pipeline)
    category = request.get("category")
    if category:
        stmt = stmt.where(Pipeline.category == category)

    pipelines = session.exec(stmt).all()
    prefixes = _resolve_scope_prefixes(request)
    if prefixes:
        pipelines = [pipeline for pipeline in pipelines if _matches_prefixes(pipeline.id, prefixes)]

    return sorted(pipelines, key=lambda pipeline: _natural_sort_key(pipeline.id))


def _resolve_scope_prefixes(request: dict[str, str]) -> list[str]:
    raw_prefixes = request.get("system_prefixes")
    if raw_prefixes:
        return [prefix.strip() for prefix in raw_prefixes.split(",") if prefix.strip()]

    system_id = request.get("system_id")
    if system_id:
        return [system_id.upper()]

    return []


def _matches_prefixes(identifier: str, prefixes: list[str]) -> bool:
    normalized_identifier = (identifier or "").upper()
    return any(normalized_identifier.startswith(f"{prefix.upper()}-") for prefix in prefixes)


def _natural_sort_key(value: str) -> list[object]:
    parts = re.split(r"(\d+)", value or "")
    key: list[object] = []
    for part in parts:
        if part.isdigit():
            key.append(int(part))
        else:
            key.append(part)
    return key


def _try_direct_entity_lookup(message: str, session: Session) -> str | None:
    entity_name = _extract_entity_lookup_name(message)
    if not entity_name:
        return None

    stations = _find_station_candidates(entity_name, session)
    if stations:
        best_station = _pick_best_station_candidate(entity_name, stations)
        if best_station:
            return _append_completeness_hint(
                _build_station_lookup_reply(best_station),
                message,
                is_complete=True,
                reason="已按当前业务库返回该对象的完整基础信息。",
            )
        names = "、".join(station.name for station in stations[:5])
        return _append_completeness_hint(
            f"我先查了本地业务库，和“{entity_name}”接近的站场有：{names}。",
            message,
            is_complete=False,
            reason="当前只给了候选项，还没法确认你具体指的是哪一个。",
        )

    pipelines = _find_pipeline_candidates(entity_name, session)
    if pipelines:
        if len(pipelines) == 1:
            return _append_completeness_hint(
                _build_pipeline_lookup_reply(pipelines[0]),
                message,
                is_complete=True,
                reason="已按当前业务库返回该对象的完整基础信息。",
            )
        names = "、".join(pipeline.name for pipeline in pipelines[:5])
        return _append_completeness_hint(
            f"我查到几个接近的管线名称：{names}。",
            message,
            is_complete=False,
            reason="当前只给了候选项，还没法确认你具体指的是哪一条。",
        )

    return _append_completeness_hint(
        f"我先查了本地业务库，当前没找到“{entity_name}”对应的站场或管线。"
        "如果你说的是简称、别名，或者少了“分输站/压气站”这类后缀，可以发完整名称我再查。",
        message,
        is_complete=True,
        reason="已按当前业务库完整检索，但没有找到匹配对象。",
    )


def _extract_entity_lookup_name(message: str) -> str | None:
    normalized = re.sub(r"[？?。！，,\s]+", "", message or "")
    if not normalized or len(normalized) > 24:
        return None

    prefix_pattern = r"^(?:帮我)?(?:看下|看看|查下|查查|说说|介绍下|介绍一下|请问)?"
    core = re.sub(prefix_pattern, "", normalized)

    patterns = [
        r"^(?P<name>.+?)(?:是什么站|是什么|是啥|啥意思|做什么的|是干什么的)$",
        r"^(?:介绍下|介绍一下|说说)(?P<name>.+)$",
    ]
    for pattern in patterns:
        match = re.match(pattern, core)
        if match:
            name = match.group("name")
            return _normalize_entity_name(name)

    return None


def _normalize_entity_name(name: str) -> str:
    normalized = re.sub(r"(的情况|这个|这个站)$", "", name.strip())
    generic_names = {"站", "站场", "分输站", "压气站", "阀室", "清管站", "天然气站"}
    if normalized in generic_names:
        return ""
    return normalized


def _find_station_candidates(entity_name: str, session: Session) -> list[Station]:
    variants = _build_station_name_variants(entity_name)
    stations: list[Station] = []
    seen_ids: set[str] = set()

    for variant in variants:
        for station in session.exec(select(Station).where(Station.name == variant)).all():
            if station.id not in seen_ids:
                seen_ids.add(station.id)
                stations.append(station)

    for variant in variants:
        stmt = select(Station).where(Station.name.contains(variant))
        for station in session.exec(stmt).all():
            if station.id not in seen_ids:
                seen_ids.add(station.id)
                stations.append(station)
            if len(stations) >= 5:
                return stations

    return stations


def _build_station_name_variants(entity_name: str) -> list[str]:
    base = entity_name.strip()
    if not base:
        return []

    variants = [base]
    suffixes = ["分输站", "压气站", "清管站", "阀室", "站场", "站"]
    root = base
    for suffix in suffixes:
        if base.endswith(suffix) and len(base) > len(suffix):
            root = base[: -len(suffix)]
            variants.append(root)
            break

    for prefix in dict.fromkeys([base, root]):
        for suffix in suffixes:
            if not prefix.endswith(suffix):
                variants.append(f"{prefix}{suffix}")

    return list(dict.fromkeys(filter(None, variants)))


def _pick_best_station_candidate(entity_name: str, stations: list[Station]) -> Station | None:
    if not stations:
        return None
    if len(stations) == 1:
        return stations[0]

    ranked = sorted(stations, key=lambda station: _score_station_candidate(entity_name, station))
    if len(ranked) == 1:
        return ranked[0]

    best_score = _score_station_candidate(entity_name, ranked[0])
    second_score = _score_station_candidate(entity_name, ranked[1])
    return ranked[0] if best_score < second_score else None


def _score_station_candidate(entity_name: str, station: Station) -> tuple[int, int, int]:
    lookup_key = _entity_lookup_key(entity_name)
    station_key = _entity_lookup_key(station.name)

    if station_key == lookup_key:
        name_score = 0
    elif station.name.startswith(lookup_key):
        name_score = 1
    elif lookup_key in station.name:
        name_score = 2
    else:
        name_score = 3

    type_priority = {"distribution": 0, "compressor": 0, "source": 0, "other": 1, "valve": 2}
    return (name_score, type_priority.get(station.type, 1), len(station.name))


def _entity_lookup_key(name: str) -> str:
    key = name.strip()
    for suffix in ["分输站", "压气站", "清管站", "阀室", "联络站", "站场", "站"]:
        if key.endswith(suffix) and len(key) > len(suffix):
            return key[: -len(suffix)]
    return key


def _build_station_lookup_reply(station: Station) -> str:
    type_map = {
        "source": "气源站",
        "compressor": "压气站",
        "distribution": "分输站",
        "valve": "阀室",
        "other": "站场",
    }
    station_type = type_map.get(station.type, station.type or "站场")
    details: list[str] = [
        f"{station.name}是库里登记的一个{station_type}。",
        f"站点 ID 是 {station.id}。",
    ]

    if station.design_pressure is not None:
        details.append(f"设计压力 {station.design_pressure:.2f} MPa。")

    if station.operating_pressure_in is not None or station.operating_pressure_out is not None:
        in_pressure = _format_optional_number(station.operating_pressure_in, "MPa")
        out_pressure = _format_optional_number(station.operating_pressure_out, "MPa")
        details.append(f"当前静态资料里的进出站压力分别是 {in_pressure} / {out_pressure}。")

    if station.capacity is not None:
        details.append(f"处理能力 {station.capacity:.2f} 万方/天。")

    details.append(f"坐标在 ({station.longitude:.4f}, {station.latitude:.4f})。")
    return "".join(details)


def _find_pipeline_candidates(entity_name: str, session: Session) -> list[Pipeline]:
    pipelines = session.exec(
        select(Pipeline).where(Pipeline.name.contains(entity_name))
    ).all()
    return pipelines[:5]


def _build_pipeline_lookup_reply(pipeline: Pipeline) -> str:
    category_map = {"trunk": "干线", "branch": "支线"}
    category = category_map.get(pipeline.category, pipeline.category or "管线")
    details = [f"{pipeline.name}是库里登记的一条{category}。", f"管线 ID 是 {pipeline.id}。"]

    if pipeline.length_km:
        details.append(f"长度约 {pipeline.length_km:.2f} km。")

    diameter = pipeline.diameter_mm or pipeline.diameter
    if diameter:
        details.append(f"管径约 {float(diameter):.0f} mm。")

    details.append(f"连接站点是 {pipeline.start_station_id} -> {pipeline.end_station_id}。")
    return "".join(details)


def _format_optional_number(value: float | None, unit: str) -> str:
    if value is None:
        return f"未知{unit}"
    return f"{value:.2f} {unit}"
