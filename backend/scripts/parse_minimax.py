"""
使用 MiniMax embo-01 模型对文档切片进行向量化，写入 ChromaDB。

流程：
  1. 从 .env 读取 AI_API_KEY 和 AI_BASE_URL（项目已有配置）
  2. 删除旧的 smartgas_knowledge_docs 集合（避免维度冲突）
  3. 读取本地缓存 extracted_docs_cache.json（跳过耗时的 PDF 解析）
  4. 分批调用 MiniMax /v1/embeddings 接口（embo-01，type=db）
  5. 将向量写入 ChromaDB

MiniMax embo-01 输出维度：1536维（与 Gemini 768维不同，必须重建集合）
"""

import os
import json
import time
import logging
import requests
from pathlib import Path
from typing import List, Dict

import chromadb
from chromadb.config import Settings
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent
CHROMA_DB_DIR = BASE_DIR / "data" / "chroma_db"
CACHE_FILE = BASE_DIR / "data" / "extracted_docs_cache.json"
COLLECTION_NAME = "smartgas_knowledge_docs"

# MiniMax 每批最多 10 条（控制单次请求大小）
BATCH_SIZE = 10
# 批次间冷却秒数，避免触发限速
SLEEP_BETWEEN_BATCH = 1.5


def init_services():
    """初始化 ChromaDB 和 MiniMax 配置"""
    load_dotenv(BASE_DIR / ".env")

    api_key = os.getenv("AI_API_KEY")
    base_url = os.getenv("AI_BASE_URL", "https://api.minimax.chat/v1")

    if not api_key:
        raise RuntimeError("未找到 AI_API_KEY，请检查 backend/.env 配置")

    logger.info(f"✅ 已加载 AI_API_KEY，Base URL: {base_url}")

    CHROMA_DB_DIR.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(
        path=str(CHROMA_DB_DIR),
        settings=Settings(anonymized_telemetry=False)
    )

    # 删除旧集合（避免 Gemini 768维 与 MiniMax 1536维 冲突）
    try:
        client.delete_collection(COLLECTION_NAME)
        logger.info(f"🗑️  已删除旧集合 '{COLLECTION_NAME}'（清理旧维度数据）")
    except Exception:
        logger.info(f"ℹ️  旧集合不存在，直接新建")

    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"}  # 使用余弦相似度
    )
    logger.info(f"✅ 集合 '{COLLECTION_NAME}' 创建成功")

    return collection, api_key, base_url


def embed_with_minimax(texts: List[str], api_key: str, base_url: str,
                       embed_type: str = "db", max_retries: int = 3) -> List[List[float]]:
    """
    调用 MiniMax /v1/embeddings 接口生成向量。
    
    embed_type:
        "db"    - 用于存储文档（入库时使用）
        "query" - 用于查询（搜索时使用）
    """
    url = base_url.rstrip("/") + "/embeddings"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "embo-01",
        "texts": texts,
        "type": embed_type
    }

    for attempt in range(max_retries):
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            # MiniMax Embedding 返回格式：{"vectors": [[...], [...]], "base_resp": {...}}
            if data.get("base_resp", {}).get("status_code", 0) != 0:
                raise RuntimeError(f"API 业务错误: {data['base_resp']}")
            return data["vectors"]
        except Exception as e:
            wait = (attempt + 1) * 5
            logger.warning(f"  [API 重试 {attempt+1}/{max_retries}] 失败: {e}，等待 {wait}s...")
            time.sleep(wait)

    raise RuntimeError(f"MiniMax API 连续失败 {max_retries} 次，放弃本批次")


def load_cache() -> List[Dict]:
    """读取本地已生成的文档切片缓存"""
    if not CACHE_FILE.exists():
        raise FileNotFoundError(
            f"缓存文件不存在：{CACHE_FILE}\n"
            "请先运行 parse_to_knowledge.py 生成文档切片缓存。"
        )
    logger.info(f"📂 读取缓存文件：{CACHE_FILE}")
    with open(CACHE_FILE, "r", encoding="utf-8") as f:
        docs = json.load(f)
    logger.info(f"✅ 缓存加载完成，共 {len(docs)} 个切片")
    return docs


def embed_and_store(collection, docs: List[Dict], api_key: str, base_url: str):
    """分批向量化并写入 ChromaDB"""
    total = len(docs)
    total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    success_count = 0

    logger.info(f"\n开始向量化入库：共 {total} 条，分 {total_batches} 批，每批 {BATCH_SIZE} 条")

    for i in range(total_batches):
        batch = docs[i * BATCH_SIZE: (i + 1) * BATCH_SIZE]
        texts = [doc["text"] for doc in batch]
        ids = [doc["id"] for doc in batch]
        metadatas = [doc["metadata"] for doc in batch]

        logger.info(f"→ 第 {i+1}/{total_batches} 批（{len(texts)} 条）...")
        try:
            embeddings = embed_with_minimax(texts, api_key, base_url, embed_type="db")
            collection.add(
                ids=ids,
                embeddings=embeddings,
                documents=texts,
                metadatas=metadatas
            )
            success_count += len(texts)
            logger.info(f"  ✅ 入库成功（累计 {success_count}/{total}），冷却 {SLEEP_BETWEEN_BATCH}s")
            time.sleep(SLEEP_BETWEEN_BATCH)
        except Exception as e:
            logger.error(f"  ❌ 第 {i+1} 批失败，跳过。原因: {e}")

    return success_count


if __name__ == "__main__":
    try:
        collection, api_key, base_url = init_services()
        docs = load_cache()
        success = embed_and_store(collection, docs, api_key, base_url)
        total_in_db = collection.count()
        logger.info(f"\n🎉 完成！成功写入 {success} 条，集合中总记录数: {total_in_db}")
    except Exception as e:
        logger.error(f"💥 致命错误: {e}")
        raise
