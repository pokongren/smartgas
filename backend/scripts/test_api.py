import requests
import json

def test_api():
    """测试后端API是否正常返回数据"""
    try:
        # 测试站点接口
        resp = requests.get('http://localhost:8000/api/stations')
        if resp.status_code == 200:
            stations = resp.json()
            print(f"✅ 站点API正常")
            print(f"   总数: {len(stations)}")
            print(f"   前3个: {[s['name'] for s in stations[:3]]}")
            
            # 检查是否有西四线站点
            line4_stations = [s for s in stations if '西四' in s['name'] or s['name'] in ['吐鲁番压气站', '中卫压气站']]
            print(f"   西四线站点数: {len(line4_stations)}")
        else:
            print(f"❌ 站点API返回错误: {resp.status_code}")
        
        # 测试管线接口
        resp = requests.get('http://localhost:8000/api/pipelines')
        if resp.status_code == 200:
            pipelines = resp.json()
            print(f"\n✅ 管线API正常")
            print(f"   总数: {len(pipelines)}")
            
            # 检查西四线管段
            line4_pipes = [p for p in pipelines if p['id'].startswith('LINE4-SEG')]
            print(f"   西四线管段数: {len(line4_pipes)}")
            if line4_pipes:
                print(f"   示例: {line4_pipes[0]['name']} ({line4_pipes[0]['start_station_id']} → {line4_pipes[0]['end_station_id']})")
        else:
            print(f"❌ 管线API返回错误: {resp.status_code}")
            
    except requests.exceptions.ConnectionError:
        print("❌ 无法连接到后端服务器 (http://localhost:8000)")
        print("   请检查后端是否在运行：python run.py")
    except Exception as e:
        print(f"❌ 发生错误: {e}")

if __name__ == "__main__":
    test_api()
