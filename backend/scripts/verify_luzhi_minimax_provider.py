"""
甪直站 MiniMax provider 接入校验脚本：
1. provider 切换逻辑正确；
2. MiniMax 配置回落策略正确；
3. 内容解析兼容 string/list/dict。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.append(str(ROOT / "backend"))

from app.services.ai_client import AiClient  # noqa: E402


def main() -> int:
    backup = {k: os.getenv(k) for k in (
        "AI_PROVIDER",
        "AI_API_KEY",
        "AI_BASE_URL",
        "AI_DEFAULT_MODEL",
        "MINIMAX_API_KEY",
        "MINIMAX_BASE_URL",
        "MINIMAX_DEFAULT_MODEL",
    )}
    try:
        os.environ["AI_PROVIDER"] = "openai_compatible"
        os.environ["AI_API_KEY"] = "openai-key"
        os.environ["AI_BASE_URL"] = "https://api.openai.com/v1"
        os.environ["AI_DEFAULT_MODEL"] = "gpt-4o-mini"
        os.environ["MINIMAX_API_KEY"] = ""
        os.environ["MINIMAX_BASE_URL"] = "https://api.minimax.chat/v1"
        os.environ["MINIMAX_DEFAULT_MODEL"] = ""

        client = AiClient()
        assert client.provider == "openai_compatible", "默认 provider 异常"
        assert client.base_url == "https://api.openai.com/v1", "openai base_url 异常"
        assert client.default_model == "gpt-4o-mini", "openai default_model 异常"

        os.environ["AI_PROVIDER"] = "minimax"
        os.environ["MINIMAX_API_KEY"] = "minimax-key"
        os.environ["MINIMAX_BASE_URL"] = "https://api.minimax.chat/v1"
        os.environ["MINIMAX_DEFAULT_MODEL"] = "minimax-m2.5"
        client.reload_settings()
        assert client.provider == "minimax", "minimax provider 切换失败"
        assert client.api_key == "minimax-key", "minimax api_key 异常"
        assert client.base_url == "https://api.minimax.chat/v1", "minimax base_url 异常"
        assert client.default_model == "minimax-m2.5", "minimax default_model 异常"

        # 清空 minimax key，验证回落 AI_API_KEY
        os.environ["MINIMAX_API_KEY"] = ""
        os.environ["AI_API_KEY"] = "fallback-key"
        client.reload_settings()
        assert client.api_key == "fallback-key", "minimax key 回落 AI_API_KEY 失败"

        # 内容解析兼容性
        assert client._normalize_content("abc") == "abc", "string 解析失败"
        assert client._normalize_content([{"text": "a"}, {"content": "b"}, "c"]) == "abc", "list 解析失败"
        assert client._normalize_content({"text": "x"}) == "x", "dict(text) 解析失败"
        assert client._normalize_content({"content": "y"}) == "y", "dict(content) 解析失败"

    finally:
        for key, value in backup.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    print("verify_luzhi_minimax_provider: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
