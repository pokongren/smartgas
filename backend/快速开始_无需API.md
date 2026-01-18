# 快速开始 - 无需 API Key 演示

如果你暂时没有 Gemini API Key,可以先体验以下功能:

## 1️⃣ 查看数据库文本化结果

```bash
cd backend
python scripts/db_to_text.py
```

这会生成 `database_knowledge.md` 文件,包含所有数据的自然语言描述。

**示例输出**:
```
站场: 贵阳压气站 (ID: node-004)
- 类型: 压气站
- 位置: 经度 106.71°, 纬度 26.57°
- 设计压力: 8.5 MPa
- 标签: 站场, 压气站, 贵阳压气站

管线: 中贵干线 中卫-广元 (ID: line-001)
- 起点: 中卫 (node-001)
- 终点: 广元 (node-003)
- 管径: 1016 mm
- 长度: 580.0 km
- 类别: 中贵线
```

---

## 2️⃣ 测试应急预案功能 (无需 API)

应急预案查询不需要 API Key,可以直接测试:

创建测试文件 `test_emergency.py`:

```python
from app.services.rag_enhanced import EnhancedRAGService

# 初始化服务(应急预案不需要 API Key)
rag = EnhancedRAGService()

# 测试应急预案查询
questions = [
    "如何处理管线泄漏?",
    "压力下降怎么办?",
    "阀门故障应急措施",
    "供气不足怎么办?"
]

for question in questions:
    print(f"\n问题: {question}")
    result = rag.query_emergency_knowledge(question)
    if result:
        print(f"答案:\n{result['answer']}")
        print(f"来源: {result['source']}")
    else:
        print("未找到相关应急预案")
```

运行:
```bash
python test_emergency.py
```

---

## 3️⃣ 获取免费 API Key

访问以下任一地址获取免费 API Key:

**Google AI Studio (推荐)**:
```
https://aistudio.google.com/apikey
```

**旧版地址**:
```
https://makersuite.google.com/app/apikey
```

**免费额度**:
- 每分钟 60 次请求
- 每天 1500 次请求
- 完全免费,无需信用卡

---

## 4️⃣ 设置 API Key 后的完整功能

获取 API Key 后,设置环境变量:

```powershell
# PowerShell
$env:GEMINI_API_KEY="你的API密钥"

# 或 CMD
set GEMINI_API_KEY=你的API密钥
```

然后就可以使用完整功能:

1. **同步数据库**:
   ```bash
   python scripts/sync_to_rag.py --clear
   ```

2. **交互式问答**:
   ```bash
   python scripts/quick_demo.py --interactive
   ```

3. **完整测试**:
   ```bash
   python scripts/test_rag.py
   ```

---

## 📝 示例问题 (需要 API Key)

设置 API Key 后可以问这些问题:

**精确查询**:
- "贵阳压气站的设计压力是多少?"
- "所有压气站的列表"
- "中贵干线连接哪些站场?"
- "管径大于 1000mm 的管线有哪些?"

**语义查询**:
- "西南地区有哪些站场?"
- "长距离输送管线"
- "高压力等级的设施"

**应急预案** (无需 API Key):
- "如何处理管线泄漏?"
- "压力下降怎么办?"
- "阀门故障应急措施"

---

## 🎯 下一步

1. ✅ 先运行 `python scripts/db_to_text.py` 查看文本化结果
2. ✅ 测试应急预案功能(无需 API)
3. 🔑 获取免费 Gemini API Key
4. 🚀 体验完整的 RAG 智能问答功能!
