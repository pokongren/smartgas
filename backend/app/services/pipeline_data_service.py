import json
import os
import logging
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)

class PipelineDataService:
    """
    管网数据服务
    从项目内置的 JSON 结构文件读取拓扑数据，提供极速检索。
    """
    
    def __init__(self, data_dir: str = None):
        if data_dir is None:
            # 默认指向 src/data
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            self.data_dir = os.path.join(base_dir, "..", "src", "data")
        else:
            self.data_dir = data_dir
            
        self._cache: Dict[str, Any] = {}
        self.accessed_files: List[str] = []

    def reset_logs(self):
        """清除访问日志"""
        self.accessed_files = []

    def _load_json(self, filename: str) -> Optional[Dict]:
        """按需加载 JSON 文件"""
        self.accessed_files.append(filename)
        if filename in self._cache:
            return self._cache[filename]
            
        file_path = os.path.join(self.data_dir, filename)
        if not os.path.exists(file_path):
            # 尝试在子目录查找 (如 pipelines/)
            file_path = os.path.join(self.data_dir, "pipelines", filename)
            if not os.path.exists(file_path):
                logger.warning(f"文件未找到: {filename}")
                return None
        
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self._cache[filename] = data
                return data
        except Exception as e:
            logger.error(f"读取 {filename} 失败: {e}")
            return None

    def get_pipeline_summary(self, pipeline_code: str) -> str:
        """获取指定管线的极简拓扑摘要"""
        filename = f"{pipeline_code}_structure.json"
        data = self._load_json(filename)
        if not data:
            return f"未找到管线 {pipeline_code} 的结构数据。"
            
        name = data.get("pipeline_name", pipeline_code)
        trunk = data.get("trunk", [])
        branches = data.get("branches", [])
        
        summary = f"【{name} 核心结构】\n"
        summary += f"- 干线节点数: {len(trunk)}\n"
        
        # 提取关键节点 (压气站、分输站、末站)
        critical_nodes = [n for n in trunk if n.get("type") in ["compressor", "distribution", "terminal"]]
        summary += "- 关键站场: " + ", ".join([n["name"] for n in critical_nodes[:15]])
        if len(critical_nodes) > 15:
            summary += f" 等共 {len(critical_nodes)} 个站场"
            
        summary += f"\n- 支线数量: {len(branches)}\n"
        for br in branches[:5]:
            nodes = br.get("nodes", [])
            summary += f"  * {br.get('name', '未知支线')}: {len(nodes)} 个节点\n"
            
        return summary

    def get_all_pipelines_overview(self) -> str:
        """获取全网管线概览"""
        structure_files = [
            "we1_structure.json", "zg_structure.json", "zm_structure.json",
            "pt_structure.json", "gs_structure.json", "gn_structure.json"
        ]
        
        overview = "【全网管网拓扑概览 (文件检索模式)】\n"
        for f in structure_files:
            data = self._load_json(f)
            if data:
                name = data.get("pipeline_name", "未知")
                trunk_len = len(data.get("trunk", []))
                branch_count = len(data.get("branches", []))
                overview += f"- {name}: 干线 {trunk_len} 节点, {branch_count} 条支线\n"
                
        return overview

# 全局单例
pipeline_data_service = PipelineDataService()
