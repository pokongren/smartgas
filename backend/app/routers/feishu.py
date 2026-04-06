"""
飞书机器人 webhook。

设计取舍：
- 飞书回调先快速返回 200，避免等待 AI 结果导致超时重试。
- 真正的 AI 处理和回复消息放到后台任务执行。
- 当前只支持未加密的文本消息事件。
"""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from sqlmodel import Session

from app.database import engine
from app.routers.ai_assistant import ChatMessage, ChatRequest, generate_chat_response
from app.services.feishu_bot import feishu_bot_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/integrations/feishu", tags=["飞书集成"])


@router.get("/status")
async def get_feishu_status():
    return {
        "configured": feishu_bot_service.is_configured(),
        "app_id_configured": bool(feishu_bot_service.app_id),
        "app_secret_configured": bool(feishu_bot_service.app_secret),
        "verification_token_configured": bool(feishu_bot_service.verification_token),
        "supports_encrypt_events": False,
        "supports_message_types": ["text"],
    }


@router.post("/webhook")
async def feishu_webhook(request: Request, background_tasks: BackgroundTasks):
    payload = await request.json()

    if payload.get("encrypt"):
        raise HTTPException(status_code=400, detail="当前飞书接入只支持未加密事件，请先关闭 Encrypt Key")

    if payload.get("type") == "url_verification":
        token = payload.get("token")
        if not feishu_bot_service.verify_event_token(token):
            raise HTTPException(status_code=401, detail="飞书 verification token 校验失败")
        return {"challenge": payload.get("challenge", "")}

    header = payload.get("header") or {}
    token = header.get("token") or payload.get("token")
    if not feishu_bot_service.verify_event_token(token):
        raise HTTPException(status_code=401, detail="飞书 verification token 校验失败")

    event_type = header.get("event_type")
    if event_type != "im.message.receive_v1":
        return {"code": 0, "msg": f"ignored event: {event_type or 'unknown'}"}

    event_id = header.get("event_id")
    if feishu_bot_service.mark_event_seen(event_id):
        return {"code": 0, "msg": "duplicate event"}

    event = payload.get("event") or {}
    message = event.get("message") or {}
    if message.get("message_type") != "text":
        return {"code": 0, "msg": "ignored non-text message"}

    background_tasks.add_task(_process_message_event, event)
    return {"code": 0, "msg": "ok"}


async def _process_message_event(event: dict) -> None:
    message = event.get("message") or {}
    sender = event.get("sender") or {}
    chat_id = str(message.get("chat_id", "")).strip()
    session_key = chat_id or str(sender.get("sender_id", {}).get("open_id", "")).strip()
    raw_text = feishu_bot_service.extract_text(message.get("content"))
    user_text = _normalize_user_message(raw_text)

    if not chat_id or not user_text:
        logger.info("飞书消息缺少 chat_id 或文本内容，跳过处理")
        return

    try:
        history = [ChatMessage.model_validate(item) for item in feishu_bot_service.get_history(session_key)]
        ai_request = ChatRequest(
            message=user_text,
            history=history,
            analysis_mode="subagents",
        )

        with Session(engine) as session:
            response = await generate_chat_response(ai_request, session)

        reply_text = response.reply.strip() or "我收到消息了，但这次没生成出有效回复。你可以换个问法再试一次。"
        await feishu_bot_service.send_text_message(chat_id, reply_text, receive_id_type="chat_id")
        feishu_bot_service.append_history(session_key, user_text, reply_text)
    except Exception as exc:
        logger.error("处理飞书消息失败: %s", exc, exc_info=True)
        try:
            await feishu_bot_service.send_text_message(
                chat_id,
                "这次处理失败了。先检查后端 `FEISHU_APP_ID / FEISHU_APP_SECRET` 和 AI 配置，再重试。",
                receive_id_type="chat_id",
            )
        except Exception:
            logger.exception("飞书失败兜底消息发送也失败了")


def _normalize_user_message(text: str) -> str:
    normalized = re.sub(r"<at\s+user_id=\"[^\"]+\">.*?</at>", "", text or "", flags=re.IGNORECASE)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()
