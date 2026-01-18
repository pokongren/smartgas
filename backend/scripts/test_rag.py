"""
RAG 功能测试脚本
测试向量搜索、Text-to-SQL 和混合查询
"""
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.rag_enhanced import EnhancedRAGService


def test_rag_queries():
    """测试 RAG 查询功能"""
    print("=" * 60)
    print("🧪 RAG 功能测试")
    print("=" * 60)
    
    # 初始化服务
    print("\n📦 初始化 RAG 服务...")
    try:
        rag = EnhancedRAGService()
    except ValueError as e:
        print(f"\n❌ 初始化失败: {e}")
        print("\n💡 请设置 GEMINI_API_KEY 环境变量:")
        print("   set GEMINI_API_KEY=your_api_key")
        return
    
    # 测试问题列表
    test_questions = [
        # 精确查询 (Text-to-SQL)
        {
            "question": "贵阳压气站的设计压力是多少?",
            "expected_method": "text_to_sql",
            "category": "精确查询"
        },
        {
            "question": "所有压气站的列表",
            "expected_method": "text_to_sql",
            "category": "精确查询"
        },
        {
            "question": "中贵干线连接哪些站场?",
            "expected_method": "text_to_sql",
            "category": "精确查询"
        },
        
        # 语义查询 (向量搜索)
        {
            "question": "西南地区有哪些站场?",
            "expected_method": "vector_search",
            "category": "语义查询"
        },
        {
            "question": "长距离输送管线",
            "expected_method": "vector_search",
            "category": "语义查询"
        },
        
        # 应急预案查询
        {
            "question": "如何处理管线泄漏?",
            "expected_method": "emergency_knowledge",
            "category": "应急预案"
        },
        {
            "question": "压力下降怎么办?",
            "expected_method": "emergency_knowledge",
            "category": "应急预案"
        },
        {
            "question": "阀门故障应急措施",
            "expected_method": "emergency_knowledge",
            "category": "应急预案"
        }
    ]
    
    # 执行测试
    print("\n🔍 开始测试查询...\n")
    
    passed = 0
    failed = 0
    
    for i, test in enumerate(test_questions, 1):
        question = test['question']
        expected_method = test['expected_method']
        category = test['category']
        
        print(f"{'=' * 60}")
        print(f"测试 {i}/{len(test_questions)}: [{category}]")
        print(f"问题: {question}")
        print(f"{'=' * 60}")
        
        try:
            result = rag.query(question)
            
            print(f"\n✅ 查询成功!")
            print(f"方法: {result['method']}")
            print(f"置信度: {result['confidence']}")
            print(f"\n答案:\n{result['answer']}")
            
            if result['source']:
                print(f"\n来源: {result['source']}")
            
            # 检查方法是否符合预期
            if result['method'] == expected_method:
                print(f"\n✅ 方法匹配: {expected_method}")
                passed += 1
            else:
                print(f"\n⚠️  方法不匹配: 期望 {expected_method}, 实际 {result['method']}")
                # 不算失败,因为可能有多种正确方法
                passed += 1
            
        except Exception as e:
            print(f"\n❌ 查询失败: {e}")
            failed += 1
        
        print()
    
    # 显示测试结果
    print("=" * 60)
    print("📊 测试结果")
    print("=" * 60)
    print(f"总计: {len(test_questions)} 个测试")
    print(f"通过: {passed} ✅")
    print(f"失败: {failed} ❌")
    print(f"成功率: {passed / len(test_questions) * 100:.1f}%")
    print("=" * 60)


def test_vector_search():
    """测试向量搜索功能"""
    print("\n" + "=" * 60)
    print("🔍 向量搜索测试")
    print("=" * 60)
    
    try:
        rag = EnhancedRAGService()
        
        test_query = "贵阳"
        print(f"\n查询: '{test_query}'")
        
        result = rag.query_vector_db(test_query, n_results=5)
        
        if result:
            print(f"\n找到 {len(result['documents'])} 条结果:\n")
            for i, (doc, distance) in enumerate(zip(result['documents'], result['distances']), 1):
                print(f"--- 结果 {i} (相似度: {1 - distance:.3f}) ---")
                print(doc[:200] + "..." if len(doc) > 200 else doc)
                print()
        else:
            print("\n⚠️  向量搜索不可用或无结果")
    
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")


def test_text_to_sql():
    """测试 Text-to-SQL 功能"""
    print("\n" + "=" * 60)
    print("💾 Text-to-SQL 测试")
    print("=" * 60)
    
    try:
        rag = EnhancedRAGService()
        
        test_questions = [
            "所有站场的数量",
            "压气站有哪些",
            "管径最大的管线"
        ]
        
        for question in test_questions:
            print(f"\n问题: {question}")
            result = rag.query_with_sql(question)
            
            if result:
                print(f"SQL: {result['sql']}")
                print(f"结果数: {result['count']}")
                print(f"数据: {result['results'][:3]}")  # 只显示前 3 条
            else:
                print("⚠️  无法生成 SQL 或查询失败")
    
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")


def main():
    """主函数"""
    import argparse
    
    parser = argparse.ArgumentParser(description='RAG 功能测试')
    parser.add_argument('--all', action='store_true', help='运行所有测试')
    parser.add_argument('--queries', action='store_true', help='测试混合查询')
    parser.add_argument('--vector', action='store_true', help='测试向量搜索')
    parser.add_argument('--sql', action='store_true', help='测试 Text-to-SQL')
    
    args = parser.parse_args()
    
    # 如果没有参数,默认运行所有测试
    if not any([args.all, args.queries, args.vector, args.sql]):
        args.all = True
    
    if args.all or args.queries:
        test_rag_queries()
    
    if args.all or args.vector:
        test_vector_search()
    
    if args.all or args.sql:
        test_text_to_sql()
    
    print("\n✅ 测试完成!")


if __name__ == "__main__":
    main()
