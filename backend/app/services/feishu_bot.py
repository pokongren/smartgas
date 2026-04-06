"""
飞书机器人接入服务。

当前目标只做最小可用闭环：
1. 校验飞书事件 token
2. 解析文本消息
3. 获取 tenant_access_token
4. 主动发文本消息回复
5. 维护轻量会话历史，给 AI 助手续上下文

暂不支持 encrypt 加密事件和富文本卡片。
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections import deque
from pathlib import Path

import httpx
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


class FeishuBotService:
    def __init__(self) -> None:
        self.base_url = os.getenv("FEISHU_BASE_URL", "https://open.feishu.cn/open-apis").rstrip("/")
        self.app_id = os.getenv("FEISHU_APP_ID", "").strip()
        self.app_secret = os.getenv("FEISHU_APP_SECRET", "").strip()
        self.verification_token = os.getenv("FEISHU_VERIFICATION_TOKEN", "").strip()
        self.reply_prefix = os.getenv("FEISHU_REPLY_PREFIX", "").strip()
        self.history_limit = max(int(os.getenv("FEISHU_HISTORY_LIMIT", "10")), 1)
        self.message_chunk_size = max(int(os.getenv("FEISHU_MESSAGE_CHUNK_SIZE", "1500")), 200)
        self._tenant_access_token = ""
        self._tenant_access_token_expire_at = 0.0
        self._client: httpx.AsyncClient | None = None
        self._history_store: dict[str, deque[dict[str, str]]] = {}
        self._event_seen_at: dict[str, float] = {}

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    def is_configured(self) -> bool:
        return bool(self.app_id and self.app_secret)

    def verify_event_token(self, token: str | None) -> bool:
        if not self.verification_token:
            return True
        return bool(token) and token == self.verification_token

    def extract_text(self, content: str | None) -> str:
        if not content:
            return ""

        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            logger.warning("飞书消息内容不是合法 JSON: %s", content)
            return ""

        text = str(payload.get("text", "")).strip()
        return text

    def get_history(self, session_key: str) -> list[dict[str, str]]:
        if not session_key:
            return []
        history = self._history_store.get(session_key)
        if not history:
            return []
        return list(history)

    def append_history(self, session_key: str, user_message: str, assistant_reply: str) -> None:
        if not session_key:
            return

        history = self._history_store.setdefault(session_key, deque(maxlen=self.history_limit * 2))
        history.append({"role": "user", "content": user_message})
        history.append({"role": "assistant", "content": assistant_reply})

    def mark_event_seen(self, event_id: str | None) -> bool:
        """
        返回 True 表示是重复事件。
        """
        if not event_id:
            return False

        now = time.time()
        expired_ids = [key for key, seen_at in self._event_seen_at.items() if now - seen_at > 3600]
        for key in expired_ids:
            self._event_seen_at.pop(key, None)

        if event_id in self._event_seen_at:
            return True

        self._event_seen_at[event_id] = now
        return False

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def send_text_message(self, receive_id: str, text: str, *, receive_id_type: str = "chat_id") -> None:
        if not self.is_configured():
            raise RuntimeError("飞书机器人未配置 FEISHU_APP_ID / FEISHU_APP_SECRET")

        normalized_text = (text or "").strip()
        if not normalized_text:
            normalized_text = "收到消息了，但当前没有生成有效回复。"

        if self.reply_prefix:
            normalized_text = f"{self.reply_prefix}\n{normalized_text}"

        token = await self._get_tenant_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        }

        for chunk in self._split_message(normalized_text):
            payload = {
                "receive_id": receive_id,
                "msg_type": "text",
                "content": json.dumps({"text": chunk}, ensure_ascii=False),
            }
            response = await self.client.post(
                f"{self.base_url}/im/v1/messages",
                params={"receive_id_type": receive_id_type},
                headers=headers,
                json=payload,
            )
            response.raise_for_status()

            data = response.json()
            if data.get("code") not in (0, None):
                raise RuntimeError(f"飞书发消息失败: {data}")

    async def _get_tenant_access_token(self) -> str:
        now = time.time()
        if self._tenant_access_token and now < self._tenant_access_token_expire_at:
            return self._tenant_access_token

        response = await self.client.post(
            f"{self.base_url}/auth/v3/tenant_access_token/internal",
            json={
                "app_id": self.app_id,
                "app_secret": self.app_secret,
            },
        )
        response.raise_for_status()

        data = response.json()
        if data.get("code") not in (0, None):
            raise RuntimeError(f"获取飞书 tenant_access_token 失败: {data}")

        token = str(data.get("tenant_access_token", "")).strip()
        if not token:
            raise RuntimeError("飞书 tenant_access_token 返回为空")

        expire = int(data.get("expire", 7200))
        self._tenant_access_token = token
        self._tenant_access_token_expire_at = now + max(expire - 60, 60)
        return token

    def _split_message(self, text: str) -> list[str]:
        if len(text) <= self.message_chunk_size:
            return [text]

        chunks: list[str] = []
        remaining = text
        while remaining:
            if len(remaining) <= self.message_chunk_size:
                chunks.append(remaining)
                break

            cut_index = remaining.rfind("\n", 0, self.message_chunk_size)
            if cut_index < self.message_chunk_size // 2:
                cut_index = self.message_chunk_size

            chunks.append(remaining[:cut_index].rstrip())
            remaining = remaining[cut_index:].lstrip()

        return chunks


feishu_bot_service = FeishuBotService()
