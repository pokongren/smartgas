"""
AI API 客户端封装，支持 OpenAI 兼容格式的 API
适配 SmartGas 后端环境变量读取方式
"""
import os
import logging

import httpx

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

    async def chat_completion(
        self,
        prompt: str,
        model: str = "",
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ) -> str:
        """
        调用 AI API 获取完整回复
        @param prompt 完整的提示词内容
        @param model 模型名称，留空使用默认模型
        @param temperature 温度参数
        @param max_tokens 最大 token 数
        @returns AI 回复文本
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

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        result = data["choices"][0]["message"]["content"]
        logger.info(f"AI API 响应成功: 回复长度={len(result)}")
        return result


# 全局单例
ai_client = AiClient()
