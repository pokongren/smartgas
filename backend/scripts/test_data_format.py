"""
数据格式转换测试脚本
演示如何使用数据格式修改工具
"""
import sys
from pathlib import Path
import json

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.modify_data_format import DataConverter, FieldMapper, DataValidator


def test_conversion():
    """测试格式转换"""
    print("=" * 60)
    print("测试 1: CSV 转 JSON")
    print("=" * 60)
    
    # CSV 转 JSON
    data = DataConverter.csv_to_json('test_chinese_stations.csv', 'test_converted.json')
    print(f"✅ 转换完成，共 {len(data)} 条记录\n")


def test_field_mapping():
    """测试字段映射"""
    print("=" * 60)
    print("测试 2: 字段映射")
    print("=" * 60)
    
    # 读取数据
    with open('test_converted.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    print(f"原始字段: {list(data[0].keys())}")
    
    # 自定义映射
    custom_mapping = {
        '编号': 'id',
        '站场名称': 'name',
        '站场类型': 'type'
    }
    
    # 应用映射（使用预定义映射 + 自定义映射）
    mapped_data = FieldMapper.map_fields(data, custom_mapping, use_common=True)
    
    print(f"映射后字段: {list(mapped_data[0].keys())}")
    
    # 保存结果
    with open('test_mapped.json', 'w', encoding='utf-8') as f:
        json.dump(mapped_data, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 字段映射完成\n")
    
    # 显示第一条记录
    print("第一条记录:")
    print(json.dumps(mapped_data[0], ensure_ascii=False, indent=2))
    print()


def test_validation():
    """测试数据验证"""
    print("=" * 60)
    print("测试 3: 数据验证")
    print("=" * 60)
    
    # 读取映射后的数据
    with open('test_mapped.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 验证数据
    valid_data, errors = DataValidator.validate_stations(data)
    
    print(f"总数: {len(data)}")
    print(f"有效: {len(valid_data)}")
    print(f"错误: {len(errors)}")
    
    if errors:
        print("\n❌ 错误列表:")
        for error in errors:
            print(f"  - {error}")
    else:
        print("\n✅ 所有数据验证通过!")
    
    print()


def test_add_defaults():
    """测试添加默认字段"""
    print("=" * 60)
    print("测试 4: 添加默认字段")
    print("=" * 60)
    
    # 读取数据
    with open('test_mapped.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    print(f"原始字段: {list(data[0].keys())}")
    
    # 添加默认字段
    data_with_defaults = FieldMapper.add_default_fields(data, {
        'region': '华北地区',
        'operator': '中国石油'
    })
    
    print(f"添加后字段: {list(data_with_defaults[0].keys())}")
    
    # 保存结果
    with open('test_final.json', 'w', encoding='utf-8') as f:
        json.dump(data_with_defaults, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 默认字段添加完成\n")


def test_complete_workflow():
    """完整工作流测试"""
    print("\n" + "=" * 60)
    print("完整工作流演示")
    print("=" * 60)
    print()
    
    # 1. CSV 转 JSON
    print("步骤 1: CSV 转 JSON")
    data = DataConverter.csv_to_json('test_chinese_stations.csv')
    
    # 2. 字段映射
    print("\n步骤 2: 字段映射")
    mapped_data = FieldMapper.map_fields(data, {
        '编号': 'id',
        '站场名称': 'name',
        '站场类型': 'type'
    })
    
    # 3. 添加默认字段
    print("\n步骤 3: 添加默认字段")
    complete_data = FieldMapper.add_default_fields(mapped_data, {
        'region': '华北地区'
    })
    
    # 4. 验证数据
    print("\n步骤 4: 验证数据")
    valid_data, errors = DataValidator.validate_stations(complete_data)
    
    if errors:
        print(f"❌ 发现 {len(errors)} 个错误:")
        for error in errors:
            print(f"  - {error}")
    else:
        print(f"✅ 所有 {len(valid_data)} 条数据验证通过!")
        
        # 5. 保存最终数据
        final_output = {
            'stations': valid_data
        }
        
        with open('test_workflow_result.json', 'w', encoding='utf-8') as f:
            json.dump(final_output, f, ensure_ascii=False, indent=2)
        
        print(f"\n✅ 最终数据已保存到: test_workflow_result.json")
        print(f"   可以使用以下命令导入数据库:")
        print(f"   python scripts/import_custom_data.py --json test_workflow_result.json")


if __name__ == "__main__":
    print("\n🚀 数据格式修改工具测试\n")
    
    # 运行所有测试
    test_conversion()
    test_field_mapping()
    test_validation()
    test_add_defaults()
    test_complete_workflow()
    
    print("\n" + "=" * 60)
    print("✅ 所有测试完成!")
    print("=" * 60)
