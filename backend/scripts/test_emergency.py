"""
应急预案测试 - 无需 API Key
演示应急预案查询功能
"""
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.rag_enhanced import EnhancedRAGService


def test_emergency_knowledge():
    """测试应急预案功能(无需 API Key)"""
    print("=" * 60)
    print("🚨 应急预案查询演示 (无需 API Key)")
    print("=" * 60)
    
    # 初始化服务
    print("\n📦 初始化服务...")
    rag = EnhancedRAGService()
    print("  ✅ 服务初始化成功")
    
    # 测试问题
    questions = [
        "如何处理管线泄漏?",
        "压力下降怎么办?",
        "阀门故障应急措施",
        "供气不足怎么办?"
    ]
    
    print("\n" + "=" * 60)
    print("🔍 开始测试应急预案查询")
    print("=" * 60)
    
    for i, question in enumerate(questions, 1):
        print(f"\n{'=' * 60}")
        print(f"测试 {i}/{len(questions)}")
        print(f"问题: {question}")
        print("=" * 60)
        
        result = rag.query_emergency_knowledge(question)
        
        if result:
            print(f"\n✅ 找到应急预案!")
            print(f"\n💬 答案:\n{result['answer']}")
            print(f"\n📖 来源: {result['source']}")
            print(f"🎯 置信度: {result['confidence']}")
        else:
            print("\n⚠️  未找到相关应急预案")
    
    print("\n" + "=" * 60)
    print("✅ 测试完成!")
    print("=" * 60)
    print("\n💡 提示:")
    print("  - 应急预案查询不需要 API Key")
    print("  - 基于关键词匹配,响应速度极快")
    print("  - 可以在 rag_enhanced.py 中添加更多预案")


if __name__ == "__main__":
    test_emergency_knowledge()
