"""
数据库 RAG 化快速演示脚本
演示如何使用 RAG 功能进行智能问答
"""
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))


def demo_basic_usage():
    """演示基本用法"""
    print("=" * 60)
    print("📚 数据库 RAG 化快速演示")
    print("=" * 60)
    
    # 检查依赖
    print("\n🔍 检查依赖...")
    try:
        import chromadb
        import google.generativeai as genai
        print("  ✅ chromadb 已安装")
        print("  ✅ google-generativeai 已安装")
    except ImportError as e:
        print(f"  ❌ 缺少依赖: {e}")
        print("\n请先安装依赖:")
        print("  pip install chromadb google-generativeai")
        return
    
    # 检查 API Key
    import os
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("\n⚠️  未设置 GEMINI_API_KEY 环境变量")
        print("\n请设置 API Key:")
        print("  set GEMINI_API_KEY=your_api_key")
        print("\n获取 API Key: https://makersuite.google.com/app/apikey")
        return
    
    print(f"  ✅ API Key 已设置 ({api_key[:10]}...)")
    
    # 初始化 RAG 服务
    print("\n📦 初始化 RAG 服务...")
    try:
        from app.services.rag_enhanced import EnhancedRAGService
        rag = EnhancedRAGService()
        print("  ✅ RAG 服务初始化成功")
    except Exception as e:
        print(f"  ❌ 初始化失败: {e}")
        return
    
    # 演示查询
    print("\n" + "=" * 60)
    print("🔍 演示查询")
    print("=" * 60)
    
    demo_questions = [
        "如何处理管线泄漏?",  # 应急预案
        "贵阳压气站的设计压力是多少?",  # Text-to-SQL
        "西南地区有哪些站场?",  # 向量搜索
    ]
    
    for i, question in enumerate(demo_questions, 1):
        print(f"\n{'=' * 60}")
        print(f"问题 {i}: {question}")
        print("=" * 60)
        
        try:
            result = rag.query(question)
            
            print(f"\n✅ 查询成功!")
            print(f"📊 方法: {result['method']}")
            print(f"🎯 置信度: {result['confidence']}")
            print(f"\n💬 答案:")
            print(result['answer'])
            
            if result.get('source'):
                print(f"\n📖 来源: {result['source']}")
            
        except Exception as e:
            print(f"\n❌ 查询失败: {e}")
    
    print("\n" + "=" * 60)
    print("✅ 演示完成!")
    print("=" * 60)
    print("\n💡 提示:")
    print("  - 修改 demo_questions 列表可以测试其他问题")
    print("  - 查看 test_rag.py 了解更多测试用例")
    print("  - 阅读 数据库RAG化使用指南.md 了解详细用法")


def demo_vector_sync():
    """演示向量数据库同步"""
    print("\n" + "=" * 60)
    print("🔄 向量数据库同步演示")
    print("=" * 60)
    
    print("\n如果向量数据库未初始化,请运行:")
    print("  python scripts/sync_to_rag.py --clear")
    print("\n这将:")
    print("  1. 读取数据库中的所有记录")
    print("  2. 转换为自然语言描述")
    print("  3. 生成向量嵌入")
    print("  4. 存储到 ChromaDB")
    print("\n预计耗时: 约 1-2 分钟(取决于数据量)")


def interactive_mode():
    """交互式问答模式"""
    print("\n" + "=" * 60)
    print("💬 交互式问答模式")
    print("=" * 60)
    
    # 检查依赖和 API Key
    import os
    if not os.getenv("GEMINI_API_KEY"):
        print("\n⚠️  请先设置 GEMINI_API_KEY 环境变量")
        return
    
    try:
        from app.services.rag_enhanced import EnhancedRAGService
        rag = EnhancedRAGService()
    except Exception as e:
        print(f"\n❌ 初始化失败: {e}")
        return
    
    print("\n✅ RAG 服务已就绪!")
    print("\n💡 提示:")
    print("  - 输入问题后按回车查询")
    print("  - 输入 'quit' 或 'exit' 退出")
    print("  - 输入 'help' 查看示例问题")
    print()
    
    while True:
        try:
            question = input("\n❓ 请输入问题: ").strip()
            
            if not question:
                continue
            
            if question.lower() in ['quit', 'exit', 'q']:
                print("\n👋 再见!")
                break
            
            if question.lower() == 'help':
                print("\n📝 示例问题:")
                print("  1. 贵阳压气站的设计压力是多少?")
                print("  2. 中贵干线连接哪些站场?")
                print("  3. 所有压气站的列表")
                print("  4. 如何处理管线泄漏?")
                print("  5. 压力下降怎么办?")
                continue
            
            print("\n🔍 查询中...")
            result = rag.query(question)
            
            print(f"\n✅ 查询完成!")
            print(f"📊 方法: {result['method']} | 置信度: {result['confidence']}")
            print(f"\n💬 答案:\n{result['answer']}")
            
            if result.get('source'):
                print(f"\n📖 来源: {result['source']}")
            
        except KeyboardInterrupt:
            print("\n\n👋 再见!")
            break
        except Exception as e:
            print(f"\n❌ 查询失败: {e}")


def main():
    """主函数"""
    import argparse
    
    parser = argparse.ArgumentParser(description='数据库 RAG 化快速演示')
    parser.add_argument('--demo', action='store_true', help='运行演示查询')
    parser.add_argument('--sync-help', action='store_true', help='显示同步帮助')
    parser.add_argument('--interactive', action='store_true', help='交互式问答模式')
    
    args = parser.parse_args()
    
    if args.sync_help:
        demo_vector_sync()
    elif args.interactive:
        interactive_mode()
    elif args.demo:
        demo_basic_usage()
    else:
        # 默认显示所有演示
        demo_basic_usage()
        demo_vector_sync()
        
        print("\n" + "=" * 60)
        print("🎮 更多选项")
        print("=" * 60)
        print("\n运行交互式问答:")
        print("  python scripts/quick_demo.py --interactive")
        print("\n运行完整测试:")
        print("  python scripts/test_rag.py")


if __name__ == "__main__":
    main()
