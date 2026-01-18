"""
数据格式修改和转换工具

支持:
1. 添加新字段到数据库模型
2. 转换不同格式的数据
3. 字段映射和重命名
4. 数据验证和清洗
"""
import sys
from pathlib import Path
import json
import csv
from typing import Dict, List, Any, Optional

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))


# ============================================
# 数据格式转换器
# ============================================

class DataConverter:
    """数据格式转换器"""
    
    @staticmethod
    def csv_to_json(csv_file: str, output_file: str = None, encoding: str = 'utf-8'):
        """
        将 CSV 文件转换为 JSON 格式
        
        参数:
            csv_file: CSV 文件路径
            output_file: 输出 JSON 文件路径（可选）
            encoding: 文件编码
        """
        print(f"📂 读取 CSV 文件: {csv_file}")
        
        data = []
        with open(csv_file, 'r', encoding=encoding) as f:
            reader = csv.DictReader(f)
            for row in reader:
                # 转换数据类型
                converted_row = {}
                for key, value in row.items():
                    # 尝试转换为数字
                    try:
                        if '.' in value:
                            converted_row[key] = float(value)
                        else:
                            converted_row[key] = int(value)
                    except (ValueError, AttributeError):
                        converted_row[key] = value
                
                data.append(converted_row)
        
        if output_file:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"✅ 已保存到: {output_file}")
        
        return data
    
    @staticmethod
    def json_to_csv(json_file: str, output_file: str = None, encoding: str = 'utf-8'):
        """
        将 JSON 文件转换为 CSV 格式
        
        参数:
            json_file: JSON 文件路径
            output_file: 输出 CSV 文件路径（可选）
            encoding: 文件编码
        """
        print(f"📂 读取 JSON 文件: {json_file}")
        
        with open(json_file, 'r', encoding=encoding) as f:
            data = json.load(f)
        
        # 如果是嵌套的 JSON（包含 stations 和 pipelines）
        if isinstance(data, dict) and ('stations' in data or 'pipelines' in data):
            print("检测到嵌套 JSON 格式")
            
            # 转换站场
            if 'stations' in data and data['stations']:
                stations_csv = output_file or 'stations_converted.csv'
                DataConverter._write_csv(data['stations'], stations_csv, encoding)
                print(f"✅ 站场数据已保存到: {stations_csv}")
            
            # 转换管线
            if 'pipelines' in data and data['pipelines']:
                pipelines_csv = output_file.replace('.csv', '_pipelines.csv') if output_file else 'pipelines_converted.csv'
                DataConverter._write_csv(data['pipelines'], pipelines_csv, encoding)
                print(f"✅ 管线数据已保存到: {pipelines_csv}")
        
        # 如果是数组格式
        elif isinstance(data, list):
            output_file = output_file or 'converted.csv'
            DataConverter._write_csv(data, output_file, encoding)
            print(f"✅ 已保存到: {output_file}")
        
        return data
    
    @staticmethod
    def _write_csv(data: List[Dict], output_file: str, encoding: str = 'utf-8'):
        """写入 CSV 文件"""
        if not data:
            return
        
        with open(output_file, 'w', encoding=encoding, newline='') as f:
            writer = csv.DictWriter(f, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)


# ============================================
# 字段映射器
# ============================================

class FieldMapper:
    """字段映射器 - 用于重命名和转换字段"""
    
    # 预定义的字段映射规则
    COMMON_MAPPINGS = {
        # 站场字段映射
        'station_id': 'id',
        'station_name': 'name',
        'station_type': 'type',
        'lng': 'longitude',
        'lon': 'longitude',
        'lat': 'latitude',
        'pressure': 'design_pressure',
        '设计压力': 'design_pressure',
        '经度': 'longitude',
        '纬度': 'latitude',
        '名称': 'name',
        '类型': 'type',
        '状态': 'status',
        
        # 管线字段映射
        'pipeline_id': 'id',
        'pipeline_name': 'name',
        'from_station': 'start_station_id',
        'to_station': 'end_station_id',
        'start_id': 'start_station_id',
        'end_id': 'end_station_id',
        '起点': 'start_station_id',
        '终点': 'end_station_id',
        '管径': 'diameter',
        '长度': 'length',
        '类别': 'category',
    }
    
    @staticmethod
    def map_fields(data: List[Dict], mapping: Dict[str, str] = None, use_common: bool = True) -> List[Dict]:
        """
        映射字段名称
        
        参数:
            data: 数据列表
            mapping: 自定义映射规则 {'旧字段名': '新字段名'}
            use_common: 是否使用预定义的常用映射
        """
        if not data:
            return data
        
        # 合并映射规则
        field_mapping = {}
        if use_common:
            field_mapping.update(FieldMapper.COMMON_MAPPINGS)
        if mapping:
            field_mapping.update(mapping)
        
        # 应用映射
        mapped_data = []
        for item in data:
            mapped_item = {}
            for old_key, value in item.items():
                new_key = field_mapping.get(old_key, old_key)
                mapped_item[new_key] = value
            mapped_data.append(mapped_item)
        
        print(f"✅ 已映射 {len(mapped_data)} 条记录")
        return mapped_data
    
    @staticmethod
    def add_default_fields(data: List[Dict], defaults: Dict[str, Any]) -> List[Dict]:
        """
        为数据添加默认字段
        
        参数:
            data: 数据列表
            defaults: 默认字段和值 {'字段名': '默认值'}
        """
        for item in data:
            for key, value in defaults.items():
                if key not in item:
                    item[key] = value
        
        print(f"✅ 已添加默认字段: {list(defaults.keys())}")
        return data


# ============================================
# 数据验证器
# ============================================

class DataValidator:
    """数据验证器"""
    
    # 站场必填字段
    STATION_REQUIRED_FIELDS = ['id', 'name', 'type', 'longitude', 'latitude']
    
    # 管线必填字段
    PIPELINE_REQUIRED_FIELDS = ['id', 'name', 'start_station_id', 'end_station_id', 'diameter', 'length', 'category']
    
    # 站场类型枚举
    STATION_TYPES = ['source', 'compressor', 'distribution']
    
    # 状态枚举
    STATUSES = ['normal', 'maintenance', 'fault', 'disabled']
    
    @staticmethod
    def validate_stations(stations: List[Dict]) -> tuple[List[Dict], List[str]]:
        """
        验证站场数据
        
        返回: (有效数据, 错误信息列表)
        """
        valid_data = []
        errors = []
        
        for i, station in enumerate(stations):
            # 检查必填字段
            missing_fields = [f for f in DataValidator.STATION_REQUIRED_FIELDS if f not in station or station[f] is None]
            if missing_fields:
                errors.append(f"站场 {i+1}: 缺少必填字段 {missing_fields}")
                continue
            
            # 验证站场类型
            if station['type'] not in DataValidator.STATION_TYPES:
                errors.append(f"站场 {station.get('name', i+1)}: 无效的类型 '{station['type']}'，应为 {DataValidator.STATION_TYPES}")
                continue
            
            # 验证坐标范围
            if not (-180 <= station['longitude'] <= 180):
                errors.append(f"站场 {station.get('name', i+1)}: 经度超出范围 (-180~180)")
                continue
            
            if not (-90 <= station['latitude'] <= 90):
                errors.append(f"站场 {station.get('name', i+1)}: 纬度超出范围 (-90~90)")
                continue
            
            # 验证状态（如果存在）
            if 'status' in station and station['status'] not in DataValidator.STATUSES:
                errors.append(f"站场 {station.get('name', i+1)}: 无效的状态 '{station['status']}'")
                continue
            
            valid_data.append(station)
        
        return valid_data, errors
    
    @staticmethod
    def validate_pipelines(pipelines: List[Dict], station_ids: set = None) -> tuple[List[Dict], List[str]]:
        """
        验证管线数据
        
        参数:
            pipelines: 管线数据列表
            station_ids: 有效的站场 ID 集合（可选）
        
        返回: (有效数据, 错误信息列表)
        """
        valid_data = []
        errors = []
        
        for i, pipeline in enumerate(pipelines):
            # 检查必填字段
            missing_fields = [f for f in DataValidator.PIPELINE_REQUIRED_FIELDS if f not in pipeline or pipeline[f] is None]
            if missing_fields:
                errors.append(f"管线 {i+1}: 缺少必填字段 {missing_fields}")
                continue
            
            # 验证站场 ID（如果提供了站场 ID 集合）
            if station_ids:
                if pipeline['start_station_id'] not in station_ids:
                    errors.append(f"管线 {pipeline.get('name', i+1)}: 起点站场 '{pipeline['start_station_id']}' 不存在")
                    continue
                
                if pipeline['end_station_id'] not in station_ids:
                    errors.append(f"管线 {pipeline.get('name', i+1)}: 终点站场 '{pipeline['end_station_id']}' 不存在")
                    continue
            
            # 验证数值范围
            if pipeline['diameter'] <= 0:
                errors.append(f"管线 {pipeline.get('name', i+1)}: 管径必须大于 0")
                continue
            
            if pipeline['length'] <= 0:
                errors.append(f"管线 {pipeline.get('name', i+1)}: 长度必须大于 0")
                continue
            
            # 验证状态（如果存在）
            if 'status' in pipeline and pipeline['status'] not in DataValidator.STATUSES:
                errors.append(f"管线 {pipeline.get('name', i+1)}: 无效的状态 '{pipeline['status']}'")
                continue
            
            valid_data.append(pipeline)
        
        return valid_data, errors


# ============================================
# 命令行工具
# ============================================

def show_usage():
    """显示使用说明"""
    print("""
╔══════════════════════════════════════════════════════════════╗
║          SmartGas Grid - 数据格式修改工具                    ║
╚══════════════════════════════════════════════════════════════╝

功能:
1. 格式转换 (CSV ↔ JSON)
2. 字段映射和重命名
3. 数据验证和清洗
4. 添加默认字段

使用方法:

📋 格式转换
-----------
# CSV 转 JSON
python scripts/modify_data_format.py convert --input data.csv --output data.json

# JSON 转 CSV
python scripts/modify_data_format.py convert --input data.json --output data.csv

🔄 字段映射
-----------
# 使用预定义映射
python scripts/modify_data_format.py map --input old_format.json --output new_format.json

# 自定义映射
python scripts/modify_data_format.py map --input data.json --output mapped.json --mapping '{"旧字段":"新字段"}'

✅ 数据验证
-----------
# 验证站场数据
python scripts/modify_data_format.py validate --input stations.json --type stations

# 验证管线数据
python scripts/modify_data_format.py validate --input pipelines.json --type pipelines

示例:
----
# 转换 Excel 导出的 CSV 为标准格式
python scripts/modify_data_format.py convert --input excel_export.csv --output standard.json

# 映射字段并验证
python scripts/modify_data_format.py map --input raw_data.json --output clean_data.json
python scripts/modify_data_format.py validate --input clean_data.json --type stations
""")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='数据格式修改工具')
    subparsers = parser.add_subparsers(dest='command', help='命令')
    
    # 转换命令
    convert_parser = subparsers.add_parser('convert', help='格式转换')
    convert_parser.add_argument('--input', required=True, help='输入文件')
    convert_parser.add_argument('--output', help='输出文件')
    convert_parser.add_argument('--encoding', default='utf-8', help='文件编码')
    
    # 映射命令
    map_parser = subparsers.add_parser('map', help='字段映射')
    map_parser.add_argument('--input', required=True, help='输入文件')
    map_parser.add_argument('--output', required=True, help='输出文件')
    map_parser.add_argument('--mapping', help='自定义映射 JSON 字符串')
    map_parser.add_argument('--no-common', action='store_true', help='不使用预定义映射')
    
    # 验证命令
    validate_parser = subparsers.add_parser('validate', help='数据验证')
    validate_parser.add_argument('--input', required=True, help='输入文件')
    validate_parser.add_argument('--type', choices=['stations', 'pipelines'], required=True, help='数据类型')
    
    args = parser.parse_args()
    
    if not args.command:
        show_usage()
        sys.exit(0)
    
    # 执行命令
    if args.command == 'convert':
        input_file = args.input
        output_file = args.output
        
        if input_file.endswith('.csv'):
            DataConverter.csv_to_json(input_file, output_file, args.encoding)
        elif input_file.endswith('.json'):
            DataConverter.json_to_csv(input_file, output_file, args.encoding)
        else:
            print("❌ 不支持的文件格式，请使用 .csv 或 .json")
    
    elif args.command == 'map':
        # 读取数据
        with open(args.input, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 解析自定义映射
        custom_mapping = None
        if args.mapping:
            custom_mapping = json.loads(args.mapping)
        
        # 应用映射
        if isinstance(data, list):
            mapped_data = FieldMapper.map_fields(data, custom_mapping, not args.no_common)
        elif isinstance(data, dict):
            mapped_data = {}
            if 'stations' in data:
                mapped_data['stations'] = FieldMapper.map_fields(data['stations'], custom_mapping, not args.no_common)
            if 'pipelines' in data:
                mapped_data['pipelines'] = FieldMapper.map_fields(data['pipelines'], custom_mapping, not args.no_common)
        
        # 保存结果
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(mapped_data, f, ensure_ascii=False, indent=2)
        
        print(f"✅ 已保存到: {args.output}")
    
    elif args.command == 'validate':
        # 读取数据
        with open(args.input, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 验证数据
        if args.type == 'stations':
            if isinstance(data, dict) and 'stations' in data:
                data = data['stations']
            
            valid_data, errors = DataValidator.validate_stations(data)
            
            print(f"\n📊 验证结果:")
            print(f"  总数: {len(data)}")
            print(f"  有效: {len(valid_data)}")
            print(f"  错误: {len(errors)}")
            
            if errors:
                print(f"\n❌ 错误列表:")
                for error in errors:
                    print(f"  - {error}")
            else:
                print(f"\n✅ 所有数据验证通过!")
        
        elif args.type == 'pipelines':
            if isinstance(data, dict) and 'pipelines' in data:
                data = data['pipelines']
            
            valid_data, errors = DataValidator.validate_pipelines(data)
            
            print(f"\n📊 验证结果:")
            print(f"  总数: {len(data)}")
            print(f"  有效: {len(valid_data)}")
            print(f"  错误: {len(errors)}")
            
            if errors:
                print(f"\n❌ 错误列表:")
                for error in errors:
                    print(f"  - {error}")
            else:
                print(f"\n✅ 所有数据验证通过!")
