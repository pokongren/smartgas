"""
AI API client wrapper for OpenAI-compatible endpoints.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

logger = logging.getLogger(__name__)

AI_API_KEY = os.getenv("AI_API_KEY", "")
AI_BASE_URL = os.getenv("AI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
AI_DEFAULT_MODEL = os.getenv("AI_DEFAULT_MODEL", "gpt-3.5-turbo")
AI_PROVIDER = os.getenv("AI_PROVIDER", "openai_compatible").strip().lower()
MINIMAX_API_KEY = os.getenv("MINIMAX_API_KEY", "").strip()
MINIMAX_BASE_URL = os.getenv("MINIMAX_BASE_URL", "https://api.minimax.chat/v1").rstrip("/")
MINIMAX_DEFAULT_MODEL = os.getenv("MINIMAX_DEFAULT_MODEL", "").strip()


class AiServiceError(Exception):
    def __init__(self, message: str, *, status_code: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.retryable = retryable


class AiClient:
    def __init__(self):
        self.provider = "openai_compatible"
        self.api_key = ""
        self.base_url = ""
        self.default_model = ""
        self._client: httpx.AsyncClient | None = None
        self.max_retries = 1
        self.reload_settings()

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=120.0, trust_env=False)
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    def reload_settings(self) -> None:
        provider = os.getenv("AI_PROVIDER", AI_PROVIDER or "openai_compatible").strip().lower()
        if provider not in {"openai_compatible", "minimax"}:
            logger.warning("Unknown AI_PROVIDER=%s, fallback to openai_compatible", provider)
            provider = "openai_compatible"

        ai_api_key = os.getenv("AI_API_KEY", AI_API_KEY).strip()
        ai_base_url = os.getenv("AI_BASE_URL", AI_BASE_URL).strip() or "https://api.openai.com/v1"
        ai_default_model = os.getenv("AI_DEFAULT_MODEL", AI_DEFAULT_MODEL).strip() or "gpt-3.5-turbo"
        minimax_api_key = os.getenv("MINIMAX_API_KEY", MINIMAX_API_KEY).strip()
        minimax_base_url = os.getenv("MINIMAX_BASE_URL", MINIMAX_BASE_URL).strip() or "https://api.minimax.chat/v1"
        minimax_default_model = os.getenv("MINIMAX_DEFAULT_MODEL", MINIMAX_DEFAULT_MODEL).strip()

        if provider == "minimax":
            api_key = minimax_api_key or ai_api_key
            base_url = minimax_base_url
            default_model = minimax_default_model or ai_default_model or "minimax-m2.5"
        else:
            api_key = ai_api_key
            base_url = ai_base_url
            default_model = ai_default_model

        self.provider = provider
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.default_model = default_model
        logger.info(
            "AI client configured: provider=%s, base_url=%s, default_model=%s",
            self.provider,
            self.base_url,
            self.default_model,
        )

    async def chat_completion(
        self,
        prompt: str = "",
        messages: list[dict[str, Any]] | None = None,
        model: str = "",
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ) -> str:
        self.reload_settings()
        if not self.api_key or self.api_key == "your_api_key_here":
            raise AiServiceError(
                f"{self._provider_label()} 未配置有效 API Key，请检查后端 `.env`。",
                status_code=401,
            )

        use_model = model if model else self.default_model
        headers = self._build_headers()
        chat_messages = messages if messages is not None else [{"role": "user", "content": prompt}]

        payload = {
            "model": use_model,
            "messages": chat_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        logger.info(
            "Calling AI API: provider=%s, model=%s, messages=%s",
            self.provider,
            use_model,
            len(chat_messages),
        )
        data = await self._post_json("/chat/completions", headers=headers, payload=payload)

        result = self._extract_completion_text(data)
        logger.info("AI completion succeeded: length=%s", len(result))
        return result

    async def chat_stream(
        self,
        prompt: str = "",
        messages: list[dict[str, Any]] | None = None,
        model: str = "",
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ):
        self.reload_settings()
        if not self.api_key or self.api_key == "your_api_key_here":
            logger.warning("%s API key is missing, returning fallback message", self._provider_label())
            yield (
                f"当前 {self._provider_label()} 还没有正确配置 API Key，暂时不能调用大模型。"
                "请检查后端 `.env` 里的模型配置。"
            )
            return

        use_model = model if model else self.default_model
        headers = self._build_headers()
        chat_messages = messages if messages is not None else [{"role": "user", "content": prompt}]

        payload = {
            "model": use_model,
            "messages": chat_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        logger.info(
            "Streaming AI API: provider=%s, model=%s, messages=%s",
            self.provider,
            use_model,
            len(chat_messages),
        )

        attempts = self.max_retries + 1
        for attempt in range(1, attempts + 1):
            try:
                async with self.client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                ) as response:
                    if response.status_code >= 400:
                        error_text = (await response.aread()).decode("utf-8", errors="ignore")
                        self._raise_ai_error(
                            status_code=response.status_code,
                            response_text=error_text,
                            retry_after=response.headers.get("Retry-After"),
                        )

                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue

                        data_str = line[6:]
                        if data_str == "[DONE]":
                            break

                        try:
                            data = json.loads(data_str)
                            content = self._extract_stream_chunk(data)
                            if content:
                                yield content
                        except Exception as exc:
                            logger.warning("AI stream parse error: %s", exc)
                    return
            except AiServiceError as exc:
                if exc.status_code == 429 and attempt < attempts:
                    wait_seconds = min(2 * attempt, 4)
                    logger.warning("AI stream rate-limited, retrying in %ss", wait_seconds)
                    await asyncio.sleep(wait_seconds)
                    continue
                raise
            except httpx.HTTPError as exc:
                raise self._wrap_transport_error(exc) from exc

    def _build_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _provider_label(self) -> str:
        return "MiniMax" if self.provider == "minimax" else "AI 服务"

    def _extract_completion_text(self, data: dict[str, Any]) -> str:
        try:
            choices = data.get("choices")
            if not isinstance(choices, list) or not choices:
                raise ValueError("choices missing")
            message = choices[0].get("message")
            if not isinstance(message, dict):
                raise ValueError("message missing")
            content = message.get("content")
            return self._normalize_content(content)
        except Exception as exc:
            raise AiServiceError(f"{self._provider_label()} 返回内容解析失败：{exc}") from exc

    def _extract_stream_chunk(self, data: dict[str, Any]) -> str:
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            return ""
        delta = choices[0].get("delta")
        if not isinstance(delta, dict):
            return ""
        content = delta.get("content")
        return self._normalize_content(content)

    def _normalize_content(self, content: Any) -> str:
        if content is None:
            return ""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, str):
                    parts.append(item)
                    continue
                if not isinstance(item, dict):
                    continue
                text_value = item.get("text")
                if isinstance(text_value, str):
                    parts.append(text_value)
                    continue
                if isinstance(item.get("content"), str):
                    parts.append(str(item.get("content")))
            return "".join(parts)
        if isinstance(content, dict):
            for key in ("text", "content"):
                value = content.get(key)
                if isinstance(value, str):
                    return value
        return str(content)

    async def _post_json(
        self,
        path: str,
        *,
        headers: dict[str, str],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        attempts = self.max_retries + 1
        for attempt in range(1, attempts + 1):
            try:
                response = await self.client.post(
                    f"{self.base_url}{path}",
                    headers=headers,
                    json=payload,
                )
                if response.status_code >= 400:
                    self._raise_ai_error(
                        status_code=response.status_code,
                        response_text=response.text,
                        retry_after=response.headers.get("Retry-After"),
                    )
                return response.json()
            except AiServiceError as exc:
                if exc.status_code == 429 and attempt < attempts:
                    wait_seconds = min(2 * attempt, 4)
                    logger.warning("AI completion rate-limited, retrying in %ss", wait_seconds)
                    await asyncio.sleep(wait_seconds)
                    continue
                raise
            except httpx.HTTPError as exc:
                raise self._wrap_transport_error(exc) from exc

    def _raise_ai_error(
        self,
        *,
        status_code: int,
        response_text: str = "",
        retry_after: str | None = None,
    ) -> None:
        if status_code == 429:
            hint = f"建议等待 {retry_after} 秒后再试。" if retry_after else "请稍等 10 到 30 秒后再试。"
            raise AiServiceError(
                f"AI 服务当前请求太频繁，已被限流。{hint}",
                status_code=status_code,
                retryable=True,
            )

        if status_code in {401, 403}:
            raise AiServiceError(
                f"{self._provider_label()} 鉴权失败，请检查后端模型配置。",
                status_code=status_code,
            )

        if status_code >= 500:
            raise AiServiceError(
                "AI 服务暂时不可用，请稍后重试。",
                status_code=status_code,
                retryable=True,
            )

        compact_text = response_text.strip().replace("\n", " ")
        if len(compact_text) > 160:
            compact_text = compact_text[:157] + "..."
        suffix = f" 详情: {compact_text}" if compact_text else ""
        raise AiServiceError(
            f"AI 服务请求失败（HTTP {status_code}）。{suffix}",
            status_code=status_code,
        )

    def _wrap_transport_error(self, exc: httpx.HTTPError) -> AiServiceError:
        if isinstance(exc, httpx.TimeoutException):
            return AiServiceError("AI 服务响应超时，请稍后重试。", retryable=True)
        return AiServiceError(f"AI 服务连接失败：{exc}")


ai_client = AiClient()
