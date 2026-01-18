"""
API Key 配置和网络诊断
"""
import os
from pathlib import Path

print("=" * 60)
print("🔍 API Key 配置诊断")
print("=" * 60)

# 1. 检查 .env 文件
print("\n📋 步骤 1: 检查 .env 文件")
env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    print(f"  ✅ .env 文件存在: {env_file}")
    with open(env_file, 'r') as f:
        content = f.read()
        if 'GEMINI_API_KEY' in content:
            # 提取 API Key
            for line in content.split('\n'):
                if line.strip() and 'GEMINI_API_KEY' in line:
                    key, value = line.strip().split('=', 1)
                    os.environ[key] = value
                    print(f"  ✅ API Key 已加载: {value[:10]}...{value[-4:]}")
        else:
            print("  ⚠️  .env 文件中未找到 GEMINI_API_KEY")
else:
    print(f"  ❌ .env 文件不存在: {env_file}")

# 2. 检查环境变量
print("\n📋 步骤 2: 检查环境变量")
api_key = os.getenv("GEMINI_API_KEY")
if api_key:
    print(f"  ✅ GEMINI_API_KEY: {api_key[:10]}...{api_key[-4:]}")
    print(f"  📏 长度: {len(api_key)} 字符")
else:
    print("  ❌ 环境变量未设置")

# 3. 检查依赖
print("\n📋 步骤 3: 检查依赖包")
try:
    import google.generativeai as genai
    print("  ✅ google-generativeai 已安装")
except ImportError:
    print("  ❌ google-generativeai 未安装")
    print("  运行: pip install google-generativeai")

try:
    import chromadb
    print("  ✅ chromadb 已安装")
except ImportError:
    print("  ❌ chromadb 未安装")

# 4. 网络连接测试
print("\n📋 步骤 4: 网络连接测试")
try:
    import urllib.request
    print("  🔍 测试连接 Google AI...")
    urllib.request.urlopen('https://generativelanguage.googleapis.com', timeout=5)
    print("  ✅ 网络连接正常")
except Exception as e:
    print(f"  ⚠️  网络连接问题: {e}")
    print("\n  可能的原因:")
    print("    - 需要代理设置")
    print("    - 防火墙阻止")
    print("    - 网络不稳定")

# 5. 配置总结
print("\n" + "=" * 60)
print("📊 配置总结")
print("=" * 60)

if api_key:
    print("\n✅ API Key 已配置!")
    print(f"   密钥: {api_key}")
    print("\n💡 使用方法:")
    print("   方法 1: 在代码中加载 .env")
    print("   ```python")
    print("   from pathlib import Path")
    print("   import os")
    print("   env_file = Path('backend/.env')")
    print("   with open(env_file) as f:")
    print("       for line in f:")
    print("           if 'GEMINI_API_KEY' in line:")
    print("               key, value = line.strip().split('=', 1)")
    print("               os.environ[key] = value")
    print("   ```")
    print("\n   方法 2: 手动设置环境变量")
    print("   PowerShell:")
    print(f'   $env:GEMINI_API_KEY="{api_key}"')
    print("\n   CMD:")
    print(f'   set GEMINI_API_KEY={api_key}')
    
    print("\n📝 下一步:")
    print("   1. 同步数据库: python scripts/sync_to_rag.py --clear")
    print("   2. 交互式问答: python scripts/quick_demo.py --interactive")
else:
    print("\n❌ API Key 未配置")
    print("\n请设置 API Key:")
    print("   1. 获取: https://aistudio.google.com/apikey")
    print("   2. 保存到 .env 文件")

print("\n" + "=" * 60)
