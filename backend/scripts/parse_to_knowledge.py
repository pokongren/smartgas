import os
import glob
import logging
from pathlib import Path
from typing import List, Dict

import chromadb
from chromadb.config import Settings
import google.generativeai as genai

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 数据目录
BASE_DIR = Path(__file__).parent.parent
KNOWLEDGE_BASE_DIR = BASE_DIR / "data" / "knowledge_base"
CHROMA_DB_DIR = BASE_DIR / "data" / "chroma_db"

def init_services():
    """初始化 ChromaDB 和 Gemini"""
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / ".env")
    
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("未找到 GEMINI_API_KEY，请检查 .env。")
        
    genai.configure(api_key=api_key)
    
    # 确保存储目录存在
    CHROMA_DB_DIR.mkdir(parents=True, exist_ok=True)
    
    client = chromadb.PersistentClient(
        path=str(CHROMA_DB_DIR),
        settings=Settings(anonymized_telemetry=False)
    )
    
    # 获取或创建专门用于复杂文档的集合
    collection = client.get_or_create_collection(
        name="smartgas_knowledge_docs",
        metadata={"description": "天然气管网操作规程与应急预案"}
    )
    
    return collection

def extract_pdf_content(pdf_path: str) -> str:
    """使用 pdfplumber 深度提取 PDF（含表格）内容"""
    try:
        import pdfplumber
    except ImportError:
        logger.error("请先安装 pdfplumber: pip install pdfplumber")
        return ""

    logger.info(f"正在解析 PDF: {Path(pdf_path).name}")
    content = []
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for i, page in enumerate(pdf.pages):
                # 1. 尝试提取此页的文本
                text = page.extract_text()
                if text:
                    content.append(text)
                
                # 2. 尝试提取表格并将其转化为 Markdown 格式
                tables = page.extract_tables()
                if tables:
                    for table in tables:
                        if not table: continue
                        
                        # 把 None 替换为空字符串，并处理换行符
                        cleaned_table = []
                        for row in table:
                            cleaned_row = []
                            for cell in row:
                                if cell is None:
                                    cleaned_row.append("")
                                else:
                                    # 将单元格内的换行替换为空格，避免破坏 Markdown 表格格式
                                    cleaned_row.append(str(cell).replace('\n', ' '))
                            cleaned_table.append(cleaned_row)
                        
                        # 第一代如果是空，可以跳过，或生成 Markdown 表头
                        if len(cleaned_table) > 0:
                            header = cleaned_table[0]
                            # 生成 Markdown 表头隔离线
                            separator = ['---'] * len(header)
                            
                            md_table = []
                            md_table.append('| ' + ' | '.join(header) + ' |')
                            md_table.append('| ' + ' | '.join(separator) + ' |')
                            
                            # 生成后面的行
                            for row in cleaned_table[1:]:
                                # 补齐列数或者截断
                                row = row + [''] * max(0, len(header) - len(row))
                                row = row[:len(header)]
                                md_table.append('| ' + ' | '.join(row) + ' |')
                            
                            content.append('\n' + '\n'.join(md_table) + '\n')
                            
    except Exception as e:
        logger.error(f"解析 PDF 失败 {pdf_path}: {e}")
        
    return "\n".join(content)

def extract_md_content(md_path: str) -> str:
    """提取 Markdown 文件"""
    logger.info(f"正在读取 Markdown: {Path(md_path).name}")
    try:
        with open(md_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        logger.error(f"读取 MD 失败 {md_path}: {e}")
        return ""

def process_documents() -> List[Dict]:
    """遍历知识库，提取所有文件并分块"""
    try:
        from langchain_text_splitters import RecursiveCharacterTextSplitter
    except ImportError:
        logger.error("请先安装 langchain_text_splitters: pip install langchain-text-splitters")
        return []

    # 配置切割器
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=150,
        length_function=len,
        separators=["\n\n", "\n", "。", "！", "？", " ", ""]
    )
    
    docs_to_embed = []
    
    # 查找所有文档
    search_paths = [
        str(KNOWLEDGE_BASE_DIR / "操作规程" / "**" / "*.*"),
        str(KNOWLEDGE_BASE_DIR / "应急预案" / "**" / "*.*")
    ]
    
    all_files = []
    for pattern in search_paths:
        # 使用 recursive=True 查找子目录
        files = glob.glob(pattern, recursive=True)
        all_files.extend(files)
        
    # 去重
    all_files = list(set(all_files))
    logger.info(f"共找到 {len(all_files)} 个文档需要处理。")
    
    for file_path in all_files:
        path_obj = Path(file_path)
        # 忽略可能的临时文件或无关文件
        if path_obj.suffix.lower() not in ['.pdf', '.md', '.txt']:
            continue
            
        source_name = path_obj.name
        doctype = path_obj.parent.name
        
        full_text = ""
        if path_obj.suffix.lower() == '.pdf':
            full_text = extract_pdf_content(file_path)
        elif path_obj.suffix.lower() in ['.md', '.txt']:
            full_text = extract_md_content(file_path)
            
        if not full_text.strip():
            logger.warning(f"跳过空文件: {source_name}")
            continue
            
        # 切片
        chunks = text_splitter.split_text(full_text)
        logger.info(f"文件 {source_name} 切分为 {len(chunks)} 个段落。")
        
        for i, chunk in enumerate(chunks):
            # 将一些元数据组装进去以指导大模型，这是可选增强
            chunk_content = f"来源：【{doctype} - {source_name}】\n\n{chunk}"
            docs_to_embed.append({
                "id": f"{path_obj.stem}_chunk_{i}",
                "text": chunk_content,
                "metadata": {
                    "source": source_name,
                    "type": doctype,
                    "chunk": i
                }
            })
            
    return docs_to_embed

def embed_and_store(collection, docs: List[Dict]):
    """使用 Gemini Embedding 向量化并存入 Chroma"""
    if not docs:
        logger.warning("没有需要入库的文档。")
        return

    logger.info(f"开始向量化 {len(docs)} 个文本块...")
    
    # 批量处理（如果文档超多，应当分批发包。此处做简单按批处理）
    BATCH_SIZE = 100
    total_batches = (len(docs) + BATCH_SIZE - 1) // BATCH_SIZE
    
    for i in range(total_batches):
        batch = docs[i*BATCH_SIZE : (i+1)*BATCH_SIZE]
        texts = [doc["text"] for doc in batch]
        ids = [doc["id"] for doc in batch]
        metadatas = [doc["metadata"] for doc in batch]
        
        try:
            logger.info(f"提交第 {i+1}/{total_batches} 批次到 Gemini...")
            result = genai.embed_content(
                model="models/embedding-001",
                content=texts,
                task_type="retrieval_document"
            )
            embeddings = result['embedding']
            
            # 写入 Chroma
            collection.add(
                ids=ids,
                embeddings=embeddings,
                documents=texts,
                metadatas=metadatas
            )
            logger.info(f"第 {i+1} 批次 ({len(batch)} 个切片) 入库成功。")
            
        except Exception as e:
            logger.error(f"第 {i+1} 批次入库失败: {e}")

if __name__ == "__main__":
    logger.info("=== 智脉系统知识库向量化工具 ===")
    try:
        collection = init_services()
        
        # 为了演示和测试，清空旧数据
        count = collection.count()
        if count > 0:
            logger.info(f"此集合当前已有 {count} 条记录。这里不清空，执行增量或覆盖插入。")
            
        docs = process_documents()
        embed_and_store(collection, docs)
        
        logger.info(f"=== 成功！集合中当前有 {collection.count()} 条记录 ===")
        
    except Exception as e:
        logger.error(f"执行中断: {e}", exc_info=True)
