"""
向量化与同步模块
将数据库文本化后生成向量嵌入,存储到 ChromaDB
"""
import sys
from pathlib import Path
from typing import List, Dict, Optional
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

# 自动加载 .env 文件
env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    with open(env_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                if key and value:
                    os.environ[key] = value
                    print(f"✅ 从 .env 加载: {key}")


try:
    import chromadb
    from chromadb.config import Settings
except ImportError:
    print("❌ 错误: 未安装 chromadb")
    print("请运行: pip install chromadb")
    sys.exit(1)

try:
    import google.generativeai as genai
except ImportError:
    print("❌ 错误: 未安装 google-generativeai")
    print("请运行: pip install google-generativeai")
    sys.exit(1)

from scripts.db_to_text import DatabaseTextConverter


class VectorDBManager:
    """向量数据库管理器"""
    
    def __init__(self, api_key: Optional[str] = None, collection_name: str = "smartgas_knowledge"):
        """
        初始化向量数据库管理器
        
        参数:
            api_key: Gemini API Key (如果不提供,从环境变量读取)
            collection_name: ChromaDB 集合名称
        """
        # 配置 Gemini API
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("未找到 Gemini API Key,请设置环境变量 GEMINI_API_KEY 或传入 api_key 参数")
        
        genai.configure(api_key=self.api_key)
        
        # 初始化 ChromaDB
        db_path = Path(__file__).parent.parent / "data" / "chroma_db"
        db_path.mkdir(exist_ok=True)
        
        self.client = chromadb.PersistentClient(
            path=str(db_path),
            settings=Settings(anonymized_telemetry=False)
        )
        
        # 获取或创建集合
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"description": "SmartGas Grid 管网知识库"}
        )
        
        print(f"✅ ChromaDB 已初始化: {db_path}")
        print(f"📦 集合名称: {collection_name}")
    
    def generate_embedding(self, text: str) -> List[float]:
        """
        使用 Gemini API 生成文本嵌入向量
        
        参数:
            text: 输入文本
            
        返回:
            嵌入向量 (768 维)
        """
        try:
            result = genai.embed_content(
                model="models/embedding-001",
                content=text,
                task_type="retrieval_document"
            )
            return result['embedding']
        except Exception as e:
            print(f"⚠️  生成嵌入失败: {e}")
            # 返回零向量作为后备
            return [0.0] * 768
    
    def add_documents(self, documents: List[Dict[str, any]], batch_size: int = 10):
        """
        批量添加文档到向量数据库
        
        参数:
            documents: 文档列表,每个文档包含 id, text, metadata
            batch_size: 批处理大小
        """
        total = len(documents)
        print(f"\n🚀 开始向量化 {total} 条记录...")
        
        for i in range(0, total, batch_size):
            batch = documents[i:i + batch_size]
            
            # 生成嵌入向量
            embeddings = []
            ids = []
            texts = []
            metadatas = []
            
            for doc in batch:
                try:
                    embedding = self.generate_embedding(doc['text'])
                    embeddings.append(embedding)
                    ids.append(doc['id'])
                    texts.append(doc['text'])
                    metadatas.append(doc.get('metadata', {}))
                except Exception as e:
                    print(f"  ⚠️  处理失败: {doc['id']} - {e}")
                    continue
            
            # 添加到 ChromaDB
            if embeddings:
                self.collection.add(
                    embeddings=embeddings,
                    documents=texts,
                    ids=ids,
                    metadatas=metadatas
                )
            
            print(f"  ✅ 已处理 {min(i + batch_size, total)}/{total} 条记录")
        
        print(f"\n✅ 向量化完成! 总计: {self.collection.count()} 条记录")
    
    def query(self, query_text: str, n_results: int = 5) -> Dict:
        """
        查询向量数据库
        
        参数:
            query_text: 查询文本
            n_results: 返回结果数量
            
        返回:
            查询结果
        """
        # 生成查询向量
        query_embedding = self.generate_embedding(query_text)
        
        # 查询 ChromaDB
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results
        )
        
        return {
            'documents': results['documents'][0],
            'metadatas': results['metadatas'][0],
            'distances': results['distances'][0],
            'ids': results['ids'][0]
        }
    
    def clear_collection(self):
        """清空集合"""
        self.client.delete_collection(self.collection.name)
        self.collection = self.client.create_collection(
            name=self.collection.name,
            metadata={"description": "SmartGas Grid 管网知识库"}
        )
        print("🗑️  集合已清空")
    
    def get_stats(self) -> Dict:
        """获取统计信息"""
        return {
            'total_documents': self.collection.count(),
            'collection_name': self.collection.name
        }


def sync_database_to_vector_db(api_key: Optional[str] = None, clear_existing: bool = False):
    """
    同步数据库到向量数据库
    
    参数:
        api_key: Gemini API Key
        clear_existing: 是否清空现有数据
    """
    print("=" * 60)
    print("🔄 SmartGas Grid 数据库同步到向量数据库")
    print("=" * 60)
    
    # 1. 初始化文本转换器
    print("\n📖 步骤 1: 读取数据库...")
    converter = DatabaseTextConverter()
    all_text = converter.get_all_text()
    print(f"  ✅ 读取 {len(all_text)} 条记录")
    
    # 2. 初始化向量数据库
    print("\n🗄️  步骤 2: 初始化向量数据库...")
    vector_db = VectorDBManager(api_key=api_key)
    
    # 3. 清空现有数据(可选)
    if clear_existing:
        print("\n🗑️  步骤 3: 清空现有数据...")
        vector_db.clear_collection()
    
    # 4. 向量化并添加文档
    print("\n🔢 步骤 4: 向量化文档...")
    vector_db.add_documents(all_text)
    
    # 5. 显示统计信息
    print("\n📊 同步完成! 统计信息:")
    stats = vector_db.get_stats()
    print(f"  - 总文档数: {stats['total_documents']}")
    print(f"  - 集合名称: {stats['collection_name']}")
    
    # 6. 测试查询
    print("\n🔍 测试查询...")
    test_query = "贵阳压气站"
    results = vector_db.query(test_query, n_results=3)
    print(f"\n查询: '{test_query}'")
    print(f"返回 {len(results['documents'])} 条结果:\n")
    for i, (doc, distance) in enumerate(zip(results['documents'], results['distances']), 1):
        print(f"--- 结果 {i} (相似度: {1 - distance:.3f}) ---")
        print(doc[:200] + "..." if len(doc) > 200 else doc)
        print()
    
    converter.close()
    
    print("\n" + "=" * 60)
    print("✅ 同步完成!")
    print("=" * 60)


def main():
    """主函数"""
    import argparse
    
    parser = argparse.ArgumentParser(description='SmartGas Grid 向量数据库同步工具')
    parser.add_argument('--api-key', type=str, help='Gemini API Key (可选,默认从环境变量读取)')
    parser.add_argument('--clear', action='store_true', help='清空现有数据')
    
    args = parser.parse_args()
    
    try:
        sync_database_to_vector_db(
            api_key=args.api_key,
            clear_existing=args.clear
        )
    except ValueError as e:
        print(f"\n❌ 错误: {e}")
        print("\n💡 提示:")
        print("  1. 设置环境变量: set GEMINI_API_KEY=your_api_key")
        print("  2. 或使用参数: python sync_to_rag.py --api-key your_api_key")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 同步失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
