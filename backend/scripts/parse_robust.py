import os
import glob
import json
import time
import logging
from pathlib import Path
from typing import List, Dict

import chromadb
from chromadb.config import Settings
import google.generativeai as genai
from google.generativeai.types import generation_types

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent
KNOWLEDGE_BASE_DIR = BASE_DIR / "data" / "knowledge_base"
CHROMA_DB_DIR = BASE_DIR / "data" / "chroma_db"
CACHE_FILE = BASE_DIR / "data" / "extracted_docs_cache.json"

def init_services():
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / ".env")
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    CHROMA_DB_DIR.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(CHROMA_DB_DIR), settings=Settings(anonymized_telemetry=False))
    return client.get_or_create_collection("smartgas_knowledge_docs")

def get_cached_docs() -> List[Dict]:
    """如果之前提取因为大模型挂了，尝试从缓存直接拿，避免重复等待半小时解析 PDF"""
    if CACHE_FILE.exists():
        logger.info("发现本地文档切片缓存，直接加载...")
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []

def embed_with_retry(texts, max_retries=3):
    """带指数退避重试的 Embed API 调用"""
    for attempt in range(max_retries):
        try:
            result = genai.embed_content(
                model="models/embedding-001",
                content=texts,
                task_type="retrieval_document"
            )
            return result['embedding']
        except Exception as e:
            wait_time = (attempt + 1) * 5
            logger.warning(f"  [API Error] 第 {attempt+1} 次失败: {e}. 等待 {wait_time} 秒后重试...")
            time.sleep(wait_time)
    raise Exception("API 请求达到最大重试次数，仍失败。")

def embed_and_store(collection, docs: List[Dict]):
    if not docs:
        return

    BATCH_SIZE = 20  # 针对国内直连网络，降低单轮负荷
    total_batches = (len(docs) + BATCH_SIZE - 1) // BATCH_SIZE
    
    logger.info(f"开始分 {total_batches} 批入库，每批 {BATCH_SIZE} 条...")
    
    success_count = 0
    for i in range(total_batches):
        batch = docs[i*BATCH_SIZE : (i+1)*BATCH_SIZE]
        texts = [doc["text"] for doc in batch]
        ids = [doc["id"] for doc in batch]
        metadatas = [doc["metadata"] for doc in batch]
        
        logger.info(f"-> 提交第 {i+1}/{total_batches} 批次 ({len(texts)} chunks)...")
        try:
            embeddings = embed_with_retry(texts)
            collection.add(
                ids=ids,
                embeddings=embeddings,
                documents=texts,
                metadatas=metadatas
            )
            success_count += len(texts)
            logger.info("   入库成功！睡眠 2 秒冷却...")
            time.sleep(2)
        except Exception as e:
            logger.error(f"❌ 第 {i+1} 批次彻底失败，跳过。原因: {e}")

if __name__ == "__main__":
    try:
        collection = init_services()
        docs = get_cached_docs()
        
        if not docs:
            # 如果没缓存，代表上次脚本连 cache 都没来得及写。
            # 这里调用上一个脚本中的 process_documents 来生成
            from parse_to_knowledge import process_documents
            logger.info("无缓存，开始重新解析本地文档（可能耗时较长）...")
            docs = process_documents()
            # 写入缓存
            with open(CACHE_FILE, 'w', encoding='utf-8') as f:
                json.dump(docs, f, ensure_ascii=False)
                
        # 因为我们只是追加库，所以不需要清库
        embed_and_store(collection, docs)
        logger.info(f"\n🎉 最终结束。集合中总记录数: {collection.count()}")
        
    except Exception as e:
        logger.error(f"致命错误: {e}")
