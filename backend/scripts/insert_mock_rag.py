import os
from pathlib import Path

import chromadb
from chromadb.config import Settings
import logging

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent
CHROMA_DB_DIR = BASE_DIR / "data" / "chroma_db"

def init_mock_data():
    """灌入不需要连网 Google API 求 Embeddings 的测试伪数据
    Chroma 自带的 sentence-transformers/all-MiniLM-L6-v2 会在本地进行轻量级运算（虽然有点慢，但不会被墙）
    这里为了最快，我们给之前新建的 smartgas_knowledge_docs 加几条固定数据用于功能证明。
    
    注意：由于原本是用 Gemini embedding 存的，但现在我们混入了其他维度的本地 embedding 可能会报错
    为了展示目的，如果原来使用 google model 创建的报错，我们这里临时使用默认方法。
    """
    CHROMA_DB_DIR.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(CHROMA_DB_DIR), settings=Settings(anonymized_telemetry=False))
    
    # 我们故意建一个全新的临时测试集合
    collection_name = "smartgas_knowledge_docs"
    try:
        # 为了避免跟原先的维度冲突，干脆重新删建
        client.delete_collection(collection_name)
    except Exception:
        pass
        
    collection = client.create_collection(name=collection_name)
    
    mock_docs = [
        "【来源：操作规程 - 压缩机异常处理方案.pdf】\n当压缩机发生异常停机时：1. 调度员立即下发停机指令；2. 现场人员2分钟内关闭进气口电动球阀；3. 隔离异常单元，观察主压力表，如果压力仍然从 6.0MPa 掉落至 4.5MPa 以下，立即汇报调度长启动备用压气站。",
        "【来源：应急预案 - 分输站低压应急手册.md】\n关于分输站低压问题：一旦压力低于 1.2MPa，自动触发放空点燃程序。站长需在 10 分钟内佩戴防爆面具前往3号阀区手动切断隔离管网。",
        "【来源：操作规程 - 西气东输一线参数表.pdf】\n干线压站工艺参数：\n| 站名 | 温度阈值 | 最小压力 | 最大压力 | \n|---|---|---|---|\n| 轮南 | 55℃ | 6.5MPa | 10.0MPa |\n|鄯善 | 50℃ | 4.0MPa | 8.5MPa |"
    ]
    
    mock_ids = ["mock_1", "mock_2", "mock_3"]
    mock_metas = [{"source": "压缩机异常处理方案.pdf"}, {"source": "分输站低压应急手册.md"}, {"source": "西气东输一线参数表.pdf"}]
    
    logger.info("开始使用纯本地 Chroma 生成 Embedding（首次会自动下载很小的一个模型，几十MB）...")
    collection.add(
        documents=mock_docs,
        ids=mock_ids,
        metadatas=mock_metas
    )
    logger.info("离线测试数据灌入完成！现在可以通过 test_knowledge_tool.py 的本地代码验证工具逻辑了！")

if __name__ == "__main__":
    init_mock_data()
