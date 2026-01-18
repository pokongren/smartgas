"""
增强版 RAG 服务
支持向量搜索和 Text-to-SQL 混合查询
"""
from typing import Dict, List, Optional
import os
from pathlib import Path

try:
    import chromadb
    from chromadb.config import Settings
    CHROMADB_AVAILABLE = True
except ImportError:
    CHROMADB_AVAILABLE = False
    print("⚠️  ChromaDB 未安装,向量搜索功能不可用")

try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False
    print("⚠️  Google Generative AI 未安装,AI 功能不可用")

from sqlmodel import Session, select
from app.database import engine
from app.models import Station, Pipeline


class EnhancedRAGService:
    """增强版 RAG 服务"""
    
    def __init__(self, api_key: Optional[str] = None):
        """
        初始化 RAG 服务
        
        参数:
            api_key: Gemini API Key (可选,从环境变量读取)
        """
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        
        # 初始化向量数据库(如果可用)
        self.vector_db = None
        if CHROMADB_AVAILABLE:
            try:
                db_path = Path(__file__).parent.parent.parent / "data" / "chroma_db"
                if db_path.exists():
                    client = chromadb.PersistentClient(
                        path=str(db_path),
                        settings=Settings(anonymized_telemetry=False)
                    )
                    self.vector_db = client.get_collection("smartgas_knowledge")
                    print("✅ 向量数据库已加载")
            except Exception as e:
                print(f"⚠️  向量数据库加载失败: {e}")
        
        # 初始化 Gemini API(如果可用)
        if GENAI_AVAILABLE and self.api_key:
            genai.configure(api_key=self.api_key)
            self.model = genai.GenerativeModel('gemini-pro')
            print("✅ Gemini API 已初始化")
        else:
            self.model = None
        
        # 应急预案知识库(保留原有功能)
        self.emergency_knowledge = {
            "压力下降": {
                "keywords": ["压力", "下降", "降低", "减少"],
                "answer": """应急处理步骤:
1. 立即关闭上游阀门,隔离故障段
2. 启动备用气源,保障下游供气
3. 派遣巡线人员排查泄漏点
4. 通知下游用户降低用气量
5. 启动应急预案,调配周边管网资源""",
                "source": "应急预案手册 3.2.1"
            },
            "管线断裂": {
                "keywords": ["断裂", "破裂", "泄漏", "爆管"],
                "answer": """紧急处置流程:
1. 启动一级响应,疏散周边人员
2. 关闭两端阀门,切断气源
3. 联系消防部门现场警戒
4. 启动备用管线,恢复供气
5. 组织抢修队伍,评估损失""",
                "source": "应急预案手册 2.1.3"
            },
            "阀门故障": {
                "keywords": ["阀门", "无法", "关闭", "卡死"],
                "answer": """阀门故障应对:
1. 尝试手动操作备用阀门
2. 降低上游压力,减少泄漏
3. 启用旁路管线
4. 联系设备厂商技术支持
5. 准备更换阀门方案""",
                "source": "设备维护手册 5.3"
            },
            "供气不足": {
                "keywords": ["供气", "不足", "短缺", "需求"],
                "answer": """供气保障措施:
1. 优先保障居民用气
2. 协调上游增加供应
3. 启用储气库调峰
4. 限制工业用户用气
5. 启动应急气源""",
                "source": "供气保障预案 4.1"
            }
        }
    
    def query_vector_db(self, question: str, n_results: int = 3) -> Optional[Dict]:
        """
        使用向量数据库进行语义搜索
        
        参数:
            question: 用户问题
            n_results: 返回结果数量
            
        返回:
            搜索结果
        """
        if not self.vector_db or not GENAI_AVAILABLE:
            return None
        
        try:
            # 生成查询向量
            result = genai.embed_content(
                model="models/embedding-001",
                content=question,
                task_type="retrieval_query"
            )
            query_embedding = result['embedding']
            
            # 查询向量数据库
            results = self.vector_db.query(
                query_embeddings=[query_embedding],
                n_results=n_results
            )
            
            return {
                'documents': results['documents'][0],
                'metadatas': results['metadatas'][0],
                'distances': results['distances'][0]
            }
        except Exception as e:
            print(f"⚠️  向量搜索失败: {e}")
            return None
    
    def query_with_sql(self, question: str) -> Optional[Dict]:
        """
        使用 Text-to-SQL 查询数据库
        
        参数:
            question: 用户问题
            
        返回:
            查询结果
        """
        if not self.model:
            return None
        
        # 数据库 schema 描述
        schema_description = """
数据库包含以下表:

1. stations (站场表):
   - id: 站场 ID
   - name: 站场名称
   - type: 站场类型 (source=气源站, compressor=压气站, distribution=分输站)
   - longitude: 经度
   - latitude: 纬度
   - design_pressure: 设计压力 (MPa)

2. pipelines (管线表):
   - id: 管线 ID
   - name: 管线名称
   - start_station_id: 起点站场 ID
   - end_station_id: 终点站场 ID
   - diameter: 管径 (mm)
   - length: 长度 (km)
   - category: 管线类别
"""
        
        # 构建 prompt
        prompt = f"""你是一个 SQL 查询专家。根据用户问题生成 SQLite 查询语句。

{schema_description}

用户问题: {question}

请生成 SQL 查询语句。只返回 SQL 语句,不要有其他解释。
如果问题无法用 SQL 回答,返回 "CANNOT_ANSWER"。
"""
        
        try:
            response = self.model.generate_content(prompt)
            sql = response.text.strip()
            
            # 检查是否可以回答
            if "CANNOT_ANSWER" in sql:
                return None
            
            # 清理 SQL (移除 markdown 代码块标记)
            sql = sql.replace("```sql", "").replace("```", "").strip()
            
            # 执行 SQL 查询
            with Session(engine) as session:
                result = session.exec(sql)
                rows = result.all()
                
                return {
                    'sql': sql,
                    'results': [dict(row) if hasattr(row, '__dict__') else row for row in rows],
                    'count': len(rows)
                }
        except Exception as e:
            print(f"⚠️  SQL 查询失败: {e}")
            return None
    
    def query_emergency_knowledge(self, question: str) -> Optional[Dict]:
        """
        查询应急预案知识库(基于关键词)
        
        参数:
            question: 用户问题
            
        返回:
            应急预案
        """
        for scenario, data in self.emergency_knowledge.items():
            if any(kw in question for kw in data["keywords"]):
                return {
                    "answer": data["answer"],
                    "source": data["source"],
                    "confidence": 0.9
                }
        return None
    
    def hybrid_query(self, question: str) -> Dict:
        """
        混合查询策略
        
        参数:
            question: 用户问题
            
        返回:
            综合答案
        """
        # 1. 尝试应急预案知识库(最高优先级)
        emergency_result = self.query_emergency_knowledge(question)
        if emergency_result:
            return {
                'answer': emergency_result['answer'],
                'source': emergency_result['source'],
                'method': 'emergency_knowledge',
                'confidence': emergency_result['confidence']
            }
        
        # 2. 尝试 Text-to-SQL(精确查询)
        sql_result = self.query_with_sql(question)
        if sql_result and sql_result['count'] > 0:
            # 使用 Gemini 生成自然语言答案
            if self.model:
                try:
                    answer_prompt = f"""根据以下查询结果回答用户问题。

用户问题: {question}

查询结果: {sql_result['results']}

请用简洁的中文回答,包含具体数据。"""
                    
                    response = self.model.generate_content(answer_prompt)
                    return {
                        'answer': response.text,
                        'source': f"数据库查询 (SQL: {sql_result['sql']})",
                        'method': 'text_to_sql',
                        'confidence': 0.85,
                        'data': sql_result['results']
                    }
                except Exception as e:
                    print(f"⚠️  生成答案失败: {e}")
        
        # 3. 尝试向量搜索(语义查询)
        vector_result = self.query_vector_db(question)
        if vector_result and vector_result['documents']:
            # 使用检索到的文档生成答案
            if self.model:
                try:
                    context = "\n\n".join(vector_result['documents'][:3])
                    answer_prompt = f"""根据以下知识库内容回答用户问题。

用户问题: {question}

相关知识:
{context}

请用简洁的中文回答。"""
                    
                    response = self.model.generate_content(answer_prompt)
                    return {
                        'answer': response.text,
                        'source': "向量知识库",
                        'method': 'vector_search',
                        'confidence': 0.75,
                        'references': vector_result['documents'][:3]
                    }
                except Exception as e:
                    print(f"⚠️  生成答案失败: {e}")
        
        # 4. 无法回答
        return {
            'answer': "抱歉,我无法回答这个问题。建议:\n1. 联系调度中心\n2. 查阅完整应急手册\n3. 咨询技术专家",
            'source': None,
            'method': 'fallback',
            'confidence': 0.0
        }
    
    def query(self, question: str) -> Dict:
        """
        统一查询接口(保持向后兼容)
        
        参数:
            question: 用户问题
            
        返回:
            查询结果
        """
        return self.hybrid_query(question)


# 向后兼容: 保留原有的 RAGService 类名
RAGService = EnhancedRAGService
