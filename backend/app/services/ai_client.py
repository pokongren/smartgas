"""
AI API 客户端封装，支持 OpenAI 兼容格式的 API
适配 SmartGas 后端环境变量读取方式
"""
import os
import json
import logging

import httpx
from dotenv import load_dotenv
from pathlib import Path

# 确保环境变量被加载，显式指向 backend/.env
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

logger = logging.getLogger(__name__)

# NOTE: 从环境变量读取 AI 配置，与 SmartGas 的方式保持一致
AI_API_KEY = os.getenv("AI_API_KEY", "")
AI_BASE_URL = os.getenv("AI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
AI_DEFAULT_MODEL = os.getenv("AI_DEFAULT_MODEL", "gpt-3.5-turbo")


class AiClient:
    """
    AI API 客户端
    兼容 OpenAI 格式的 API（如 OpenAI、DeepSeek、Minimax 等）
    """

    def __init__(self):
        self.api_key = AI_API_KEY
        self.base_url = AI_BASE_URL
        self.default_model = AI_DEFAULT_MODEL
        self._client: httpx.AsyncClient | None = None

    @property
    def client(self) -> httpx.AsyncClient:
        # NOTE: 使用惰性初始化，确保客户端在 FastAPI 的 asyncio 事件循环中被正确创建
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=120.0)
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def chat_completion(
        self,
        prompt: str,
        model: str = "",
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ) -> str:
        """
        调用 AI API 获取完整回复
        """
        use_model = model if model else self.default_model

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": use_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        logger.info(f"调用 AI API: model={use_model}, prompt长度={len(prompt)}")

        response = await self.client.post(
            f"{self.base_url}/chat/completions",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

        result = data["choices"][0]["message"]["content"]
        logger.info(f"AI API 响应成功: 回复长度={len(result)}")
        return result

    async def chat_stream(
        self,
        prompt: str,
        model: str = "",
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ):
        """
        流式调用 AI API
        """
        use_model = model if model else self.default_model

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": use_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        logger.info(f"流式调用 AI API: model={use_model}, prompt长度={len(prompt)}")
        logger.info(f"DEBUG: base_url={self.base_url}")
        
        async with self.client.stream(
            "POST",
            f"{self.base_url}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                logger.info(f"DEBUG_RAW_LINE: {repr(line)}")
                if not line or not line.startswith("data: "):
                    continue
                
                data_str = line[6:]
                if data_str == "[DONE]":
                    break
                
                try:
                    data = json.loads(data_str)
                    content = data["choices"][0]["delta"].get("content", "")
                    if content:
                        yield content
                except Exception as e:
                    logger.warning(f"流解析错误: {e}, 原始行: {line}")



# 全局单例
ai_client = AiClient()
