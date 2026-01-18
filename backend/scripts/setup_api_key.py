"""
Gemini API Key 配置助手
帮助用户轻松配置 API Key
"""
import os
import sys
from pathlib import Path


def check_api_key():
    """检查 API Key 是否已设置"""
    api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        print(f"✅ API Key 已设置: {api_key[:10]}...{api_key[-4:]}")
        return True
    else:
        print("❌ API Key 未设置")
        return False


def set_api_key_interactive():
    """交互式设置 API Key"""
    print("\n" + "=" * 60)
    print("🔑 Gemini API Key 配置助手")
    print("=" * 60)
    
    # 检查当前状态
    print("\n📋 步骤 1: 检查当前配置")
    if check_api_key():
        response = input("\n是否要更新 API Key? (y/n): ").strip().lower()
        if response != 'y':
            print("\n✅ 保持当前配置")
            return
    
    # 获取 API Key
    print("\n📋 步骤 2: 获取 API Key")
    print("\n请访问以下地址获取免费 API Key:")
    print("  🌐 https://aistudio.google.com/apikey")
    print("\n或使用旧版地址:")
    print("  🌐 https://makersuite.google.com/app/apikey")
    
    print("\n💡 提示:")
    print("  - 完全免费,无需信用卡")
    print("  - 每分钟 60 次请求")
    print("  - 每天 1500 次请求")
    
    # 输入 API Key
    print("\n📋 步骤 3: 输入 API Key")
    api_key = input("\n请粘贴你的 API Key: ").strip()
    
    if not api_key:
        print("\n❌ API Key 不能为空")
        return
    
    # 验证格式
    if len(api_key) < 20:
        print("\n⚠️  API Key 格式可能不正确(长度太短)")
        response = input("是否继续? (y/n): ").strip().lower()
        if response != 'y':
            return
    
    # 设置环境变量
    print("\n📋 步骤 4: 设置环境变量")
    os.environ["GEMINI_API_KEY"] = api_key
    print("  ✅ 当前会话已设置")
    
    # 生成配置命令
    print("\n📋 步骤 5: 永久保存配置")
    print("\n⚠️  当前设置仅在本次会话有效,关闭终端后会失效")
    print("\n要永久保存,请执行以下命令之一:\n")
    
    print("方法 1: PowerShell (推荐)")
    print("-" * 60)
    print(f'$env:GEMINI_API_KEY="{api_key}"')
    print("\n永久保存到用户配置:")
    print('[System.Environment]::SetEnvironmentVariable("GEMINI_API_KEY", ')
    print(f'"{api_key}", "User")')
    print("-" * 60)
    
    print("\n方法 2: CMD")
    print("-" * 60)
    print(f'set GEMINI_API_KEY={api_key}')
    print("\n永久保存:")
    print(f'setx GEMINI_API_KEY "{api_key}"')
    print("-" * 60)
    
    print("\n方法 3: 使用 .env 文件")
    print("-" * 60)
    env_file = Path(__file__).parent.parent / ".env"
    print(f"在 {env_file} 中添加:")
    print(f'GEMINI_API_KEY={api_key}')
    
    response = input("\n是否自动创建 .env 文件? (y/n): ").strip().lower()
    if response == 'y':
        try:
            with open(env_file, 'a', encoding='utf-8') as f:
                f.write(f'\nGEMINI_API_KEY={api_key}\n')
            print(f"  ✅ 已创建 {env_file}")
            print("\n💡 提示: 需要安装 python-dotenv 并在代码中加载")
        except Exception as e:
            print(f"  ❌ 创建失败: {e}")
    print("-" * 60)
    
    # 测试 API Key
    print("\n📋 步骤 6: 测试 API Key")
    response = input("\n是否测试 API Key? (y/n): ").strip().lower()
    if response == 'y':
        test_api_key()
    
    print("\n" + "=" * 60)
    print("✅ 配置完成!")
    print("=" * 60)
    print("\n💡 下一步:")
    print("  1. 同步数据库: python scripts/sync_to_rag.py --clear")
    print("  2. 开始使用: python scripts/quick_demo.py --interactive")


def test_api_key():
    """测试 API Key 是否有效"""
    print("\n🧪 测试 API Key...")
    
    try:
        import google.generativeai as genai
        
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            print("  ❌ API Key 未设置")
            return
        
        genai.configure(api_key=api_key)
        
        # 测试生成嵌入
        print("  🔍 测试嵌入生成...")
        result = genai.embed_content(
            model="models/embedding-001",
            content="测试文本",
            task_type="retrieval_document"
        )
        
        if result and 'embedding' in result:
            print(f"  ✅ API Key 有效! (向量维度: {len(result['embedding'])})")
        else:
            print("  ⚠️  API 响应异常")
    
    except ImportError:
        print("  ❌ 未安装 google-generativeai")
        print("  请运行: pip install google-generativeai")
    except Exception as e:
        print(f"  ❌ 测试失败: {e}")
        print("\n可能的原因:")
        print("  - API Key 无效或已过期")
        print("  - 网络连接问题")
        print("  - API 配额用尽")


def show_current_config():
    """显示当前配置"""
    print("\n" + "=" * 60)
    print("📊 当前配置状态")
    print("=" * 60)
    
    # 检查 API Key
    print("\n🔑 API Key:")
    check_api_key()
    
    # 检查依赖
    print("\n📦 依赖包:")
    try:
        import chromadb
        print("  ✅ chromadb 已安装")
    except ImportError:
        print("  ❌ chromadb 未安装")
    
    try:
        import google.generativeai
        print("  ✅ google-generativeai 已安装")
    except ImportError:
        print("  ❌ google-generativeai 未安装")
    
    # 检查向量数据库
    print("\n💾 向量数据库:")
    db_path = Path(__file__).parent.parent / "data" / "chroma_db"
    if db_path.exists():
        print(f"  ✅ 已初始化: {db_path}")
        try:
            import chromadb
            from chromadb.config import Settings
            client = chromadb.PersistentClient(
                path=str(db_path),
                settings=Settings(anonymized_telemetry=False)
            )
            collection = client.get_collection("smartgas_knowledge")
            print(f"  📊 文档数量: {collection.count()}")
        except Exception as e:
            print(f"  ⚠️  无法读取: {e}")
    else:
        print("  ❌ 未初始化")
        print("  运行: python scripts/sync_to_rag.py --clear")
    
    print("\n" + "=" * 60)


def main():
    """主函数"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Gemini API Key 配置助手')
    parser.add_argument('--set', action='store_true', help='交互式设置 API Key')
    parser.add_argument('--test', action='store_true', help='测试 API Key')
    parser.add_argument('--status', action='store_true', help='显示当前配置状态')
    
    args = parser.parse_args()
    
    if args.test:
        test_api_key()
    elif args.status:
        show_current_config()
    elif args.set:
        set_api_key_interactive()
    else:
        # 默认显示状态并提供设置选项
        show_current_config()
        print("\n💡 提示:")
        print("  设置 API Key: python scripts/setup_api_key.py --set")
        print("  测试 API Key: python scripts/setup_api_key.py --test")


if __name__ == "__main__":
    main()
