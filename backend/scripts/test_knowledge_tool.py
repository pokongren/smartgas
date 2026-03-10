import os
import asyncio
from sqlmodel import Session
from app.database import engine
from app.services.assistant_tools import execute_tool, TOOL_HANDLERS

async def test_search():
    print("====== 开始测试知识库工具 ======")
    with Session(engine) as session:
        # 伪造大模型触发工具的 args
        args = {"query": "压缩机异常停机 怎么处理"}
        print(f"模拟 AI 发送搜索指令: {args}")
        
        # 直接调用底层的 Handler 不走 LLM 也可以测
        if "search_knowledge_base" in TOOL_HANDLERS:
            result = TOOL_HANDLERS["search_knowledge_base"](args, session)
            print("====== 模拟获取到的最终搜索结果片段 ======")
            print(result)
        else:
            print("❌ 未找到 search_knowledge_base 工具挂载！")

if __name__ == "__main__":
    asyncio.run(test_search())
