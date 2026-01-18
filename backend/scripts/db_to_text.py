"""
数据库文本化模块
将 SQLite 数据库记录转换为自然语言描述,用于 RAG 向量化
"""
import sys
from pathlib import Path
from typing import List, Dict

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session, select
from app.database import engine
from app.models import Station, Pipeline, EmergencyEvent


class DatabaseTextConverter:
    """数据库文本转换器"""
    
    def __init__(self):
        self.session = Session(engine)
    
    def station_to_text(self, station: Station) -> str:
        """
        将站场记录转换为自然语言描述
        
        参数:
            station: 站场对象
            
        返回:
            自然语言描述文本
        """
        # 站场类型中文映射
        type_map = {
            'source': '气源站',
            'compressor': '压气站',
            'distribution': '分输站'
        }
        
        type_cn = type_map.get(station.type, station.type)
        
        # 构建描述文本
        text = f"""站场: {station.name} (ID: {station.id})
- 类型: {type_cn}
- 位置: 经度 {station.longitude}\u00b0, 纬度 {station.latitude}\u00b0"""
        
        if station.design_pressure:
            text += f"\n- 设计压力: {station.design_pressure} MPa"
        
        # 添加元数据标签,便于检索
        text += f"\n- 标签: 站场, {type_cn}, {station.name}"
        
        return text
    
    def pipeline_to_text(self, pipeline: Pipeline) -> str:
        """
        将管线记录转换为自然语言描述
        
        参数:
            pipeline: 管线对象
            
        返回:
            自然语言描述文本
        """
        # 查询起点和终点站场名称
        start_station = self.session.get(Station, pipeline.start_station_id)
        end_station = self.session.get(Station, pipeline.end_station_id)
        
        start_name = start_station.name if start_station else pipeline.start_station_id
        end_name = end_station.name if end_station else pipeline.end_station_id
        
        # 构建描述文本
        text = f"""管线: {pipeline.name} (ID: {pipeline.id})
- 起点: {start_name} ({pipeline.start_station_id})
- 终点: {end_name} ({pipeline.end_station_id})
- 管径: {pipeline.diameter} mm
- 长度: {pipeline.length} km
- 类别: {pipeline.category}"""
        
        # 添加元数据标签
        text += f"\n- 标签: 管线, {pipeline.category}, {pipeline.name}, {start_name}, {end_name}"
        
        return text
    
    def event_to_text(self, event: EmergencyEvent) -> str:
        """
        将应急事件记录转换为自然语言描述
        
        参数:
            event: 应急事件对象
            
        返回:
            自然语言描述文本
        """
        # 事件类型中文映射
        type_map = {
            'pipeline_break': '管线断裂',
            'pressure_drop': '压力下降',
            'leak': '管线泄漏',
            'valve_failure': '阀门故障',
            'supply_shortage': '供气不足'
        }
        
        # 严重程度中文映射
        severity_map = {
            'critical': '特别重大',
            'high': '重大',
            'medium': '较大',
            'low': '一般'
        }
        
        # 状态中文映射
        status_map = {
            'active': '进行中',
            'resolved': '已解决',
            'monitoring': '监控中'
        }
        
        type_cn = type_map.get(event.event_type, event.event_type)
        severity_cn = severity_map.get(event.severity, event.severity)
        status_cn = status_map.get(event.status, event.status)
        
        # 构建描述文本
        text = f"""应急事件: {type_cn} (ID: {event.id})
- 位置: {event.location}
- 严重程度: {severity_cn}
- 状态: {status_cn}
- 发生时间: {event.created_at}"""
        
        if event.description:
            text += f"\n- 描述: {event.description}"
        
        # 添加元数据标签
        text += f"\n- 标签: 应急事件, {type_cn}, {severity_cn}, {event.location}"
        
        return text
    
    def get_all_stations_text(self) -> List[Dict[str, str]]:
        """
        获取所有站场的文本描述
        
        返回:
            包含 id, type, text 的字典列表
        """
        stations = self.session.exec(select(Station)).all()
        return [
            {
                'id': station.id,
                'type': 'station',
                'text': self.station_to_text(station),
                'metadata': {
                    'name': station.name,
                    'station_type': station.type,
                    'longitude': station.longitude,
                    'latitude': station.latitude
                }
            }
            for station in stations
        ]
    
    def get_all_pipelines_text(self) -> List[Dict[str, str]]:
        """
        获取所有管线的文本描述
        
        返回:
            包含 id, type, text 的字典列表
        """
        pipelines = self.session.exec(select(Pipeline)).all()
        return [
            {
                'id': pipeline.id,
                'type': 'pipeline',
                'text': self.pipeline_to_text(pipeline),
                'metadata': {
                    'name': pipeline.name,
                    'category': pipeline.category,
                    'length': pipeline.length,
                    'diameter': pipeline.diameter
                }
            }
            for pipeline in pipelines
        ]
    
    def get_all_events_text(self) -> List[Dict[str, str]]:
        """
        获取所有应急事件的文本描述
        
        返回:
            包含 id, type, text 的字典列表
        """
        events = self.session.exec(select(EmergencyEvent)).all()
        return [
            {
                'id': str(event.id),
                'type': 'event',
                'text': self.event_to_text(event),
                'metadata': {
                    'event_type': event.event_type,
                    'severity': event.severity,
                    'status': event.status,
                    'location': event.location
                }
            }
            for event in events
        ]
    
    def get_all_text(self) -> List[Dict[str, str]]:
        """
        获取所有数据的文本描述
        
        返回:
            包含所有站场、管线、事件的文本描述列表
        """
        all_text = []
        all_text.extend(self.get_all_stations_text())
        all_text.extend(self.get_all_pipelines_text())
        all_text.extend(self.get_all_events_text())
        return all_text
    
    def export_to_markdown(self, output_file: str = "database_knowledge.md"):
        """
        导出为 Markdown 文档
        
        参数:
            output_file: 输出文件路径
        """
        all_text = self.get_all_text()
        
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write("# SmartGas Grid 管网知识库\n\n")
            f.write(f"总计: {len(all_text)} 条记录\n\n")
            
            # 按类型分组
            f.write("## 站场信息\n\n")
            for item in all_text:
                if item['type'] == 'station':
                    f.write(item['text'] + "\n\n---\n\n")
            
            f.write("## 管线信息\n\n")
            for item in all_text:
                if item['type'] == 'pipeline':
                    f.write(item['text'] + "\n\n---\n\n")
            
            f.write("## 应急事件\n\n")
            for item in all_text:
                if item['type'] == 'event':
                    f.write(item['text'] + "\n\n---\n\n")
        
        print(f"✅ Markdown 文档已导出: {output_file}")
    
    def close(self):
        """关闭数据库连接"""
        self.session.close()


def main():
    """主函数 - 演示用法"""
    print("🚀 数据库文本化模块测试\n")
    
    converter = DatabaseTextConverter()
    
    # 获取所有文本
    all_text = converter.get_all_text()
    
    print(f"📊 总计: {len(all_text)} 条记录\n")
    
    # 显示前 3 条
    print("📝 示例输出:\n")
    for i, item in enumerate(all_text[:3], 1):
        print(f"--- 记录 {i} ({item['type']}) ---")
        print(item['text'])
        print()
    
    # 导出为 Markdown
    output_path = Path(__file__).parent.parent / "database_knowledge.md"
    converter.export_to_markdown(str(output_path))
    
    converter.close()
    
    print("\n✅ 测试完成!")


if __name__ == "__main__":
    main()
