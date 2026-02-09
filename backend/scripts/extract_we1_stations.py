"""
提取西一线主要站场并为其搜索坐标
"""
import json

# 读取拓扑数据
with open('backend/data/we1_structure.json', encoding='utf-8') as f:
    data = json.load(f)

# 提取干线中的压气站和分输站
trunk_stations = [n for n in data['trunk'] if n['type'] in ['compressor', 'distribution']]

print("=" * 60)
print("西气东输一线 干线主要站场")
print("=" * 60)
for s in trunk_stations:
    print(f"  {s['name']:20s} ({s['type']:12s}) - {s['mileage']:.1f} km")

print(f"\n共 {len(trunk_stations)} 个主要站场")
print(f"\n支线列表: {data['branch_names']}")

# 生成坐标模板
print("\n" + "=" * 60)
print("坐标模板 (需要搜索填充)")
print("=" * 60)
print("const WE1_COORDS: Record<string, { lng: number; lat: number }> = {")
for s in trunk_stations:
    print(f"    '{s['name']}': {{ lng: 0, lat: 0 }},")
print("}")
