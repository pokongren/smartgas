from typing import Dict

class RAGService:
    """RAG 知识库服务 (模拟实现)"""
    
    def __init__(self):
        self.knowledge_base = {
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
    
    def query(self, question: str) -> Dict:
        """基于关键词匹配的知识问答"""
        for scenario, data in self.knowledge_base.items():
            if any(kw in question for kw in data["keywords"]):
                return {
                    "answer": data["answer"],
                    "source": data["source"],
                    "confidence": 0.9
                }
        
        return {
            "answer": "未找到相关应急预案。建议:\n1. 联系调度中心\n2. 查阅完整应急手册\n3. 咨询技术专家",
            "source": None,
            "confidence": 0.0
        }
