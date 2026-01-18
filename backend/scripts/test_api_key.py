"""
快速测试 Gemini API Key
"""
import os

# 从 .env 文件读取
from pathlib import Path
env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    with open(env_file, 'r') as f:
        for line in f:
            if line.strip() and not line.startswith('#'):
                key, value = line.strip().split('=', 1)
                os.environ[key] = value
                print(f"✅ 从 .env 加载: {key} = {value[:10]}...{value[-4:]}")

# 测试 API Key
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    print("❌ API Key 未设置")
    exit(1)

print(f"\n🔑 API Key: {api_key[:10]}...{api_key[-4:]}")

# 测试 API 调用
print("\n🧪 测试 API 调用...")
try:
    import google.generativeai as genai
    
    genai.configure(api_key=api_key)
    
    # 测试嵌入生成
    print("  📝 测试嵌入生成...")
    result = genai.embed_content(
        model="models/embedding-001",
        content="测试文本:贵阳压气站",
        task_type="retrieval_document"
    )
    
    if result and 'embedding' in result:
        print(f"  ✅ 成功! 向量维度: {len(result['embedding'])}")
        print(f"  📊 前5个值: {result['embedding'][:5]}")
    else:
        print("  ❌ API 响应异常")
        
except Exception as e:
    print(f"  ❌ 测试失败: {e}")
    exit(1)

print("\n✅ API Key 配置成功!")
print("\n💡 下一步:")
print("  1. 同步数据库: python scripts/sync_to_rag.py --clear")
print("  2. 交互式问答: python scripts/quick_demo.py --interactive")
