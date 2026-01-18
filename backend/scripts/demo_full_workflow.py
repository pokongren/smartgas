"""
完整数据流演示脚本
自动化执行: CSV → 数据库 → API → 前端
"""
import sys
import subprocess
import time
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))


def print_step(step_num, title):
    """打印步骤标题"""
    print("\n" + "=" * 60)
    print(f"步骤 {step_num}: {title}")
    print("=" * 60)


def run_command(cmd, cwd=None):
    """运行命令并显示输出"""
    print(f"\n💻 执行命令: {cmd}")
    result = subprocess.run(
        cmd,
        shell=True,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding='utf-8'
    )
    
    if result.stdout:
        print(result.stdout)
    if result.stderr and result.returncode != 0:
        print(f"⚠️  错误: {result.stderr}")
    
    return result.returncode == 0


def demo_full_workflow():
    """完整数据流演示"""
    print("=" * 60)
    print("🚀 SmartGas Grid 完整数据流演示")
    print("=" * 60)
    print("\n演示流程:")
    print("  CSV 表格 → SQLite 数据库 → FastAPI 后端 → React 前端")
    print()
    
    backend_dir = Path(__file__).parent.parent
    project_root = backend_dir.parent
    
    # 步骤 1: 检查演示数据
    print_step(1, "检查演示数据")
    
    stations_csv = backend_dir / "demo_stations.csv"
    pipelines_csv = backend_dir / "demo_pipelines.csv"
    
    if not stations_csv.exists():
        print(f"❌ 未找到演示数据: {stations_csv}")
        return False
    
    if not pipelines_csv.exists():
        print(f"❌ 未找到演示数据: {pipelines_csv}")
        return False
    
    print(f"✅ 站场数据: {stations_csv}")
    print(f"✅ 管线数据: {pipelines_csv}")
    
    # 显示数据预览
    print("\n📊 数据预览:")
    with open(stations_csv, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        print(f"\n站场数据 ({len(lines)-1} 条记录):")
        for line in lines[:3]:
            print(f"  {line.strip()}")
    
    with open(pipelines_csv, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        print(f"\n管线数据 ({len(lines)-1} 条记录):")
        for line in lines[:3]:
            print(f"  {line.strip()}")
    
    # 步骤 2: 导入数据库
    print_step(2, "导入数据到 SQLite 数据库")
    
    cmd = f'python scripts/import_custom_data.py --csv-stations demo_stations.csv --csv-pipelines demo_pipelines.csv --clear'
    
    if not run_command(cmd, cwd=backend_dir):
        print("❌ 数据导入失败")
        return False
    
    print("✅ 数据导入成功")
    
    # 步骤 3: 验证数据库
    print_step(3, "验证数据库")
    
    cmd = 'python scripts/check_database.py'
    if not run_command(cmd, cwd=backend_dir):
        print("⚠️  数据库验证失败,但继续执行")
    
    # 步骤 4: 启动后端服务
    print_step(4, "启动 FastAPI 后端服务")
    
    print("\n💡 提示: 后端服务将在后台运行")
    print("   访问 API 文档: http://localhost:8000/docs")
    print("   停止服务: Ctrl+C")
    print("\n⏳ 正在启动后端...")
    
    # 不自动启动,让用户手动启动
    print("\n📝 请在新终端运行:")
    print("   cd backend")
    print("   python run.py")
    
    # 步骤 5: 前端说明
    print_step(5, "启动 React 前端")
    
    print("\n💡 提示: 前端将显示管网拓扑图")
    print("   访问地址: http://localhost:5173")
    print("\n📝 请在新终端运行:")
    print(f"   cd {project_root}")
    print("   npm run dev")
    
    # 步骤 6: 验证说明
    print_step(6, "验证完整流程")
    
    print("\n✅ 数据已导入数据库")
    print("\n📝 接下来:")
    print("  1. 启动后端: cd backend && python run.py")
    print("  2. 启动前端: npm run dev")
    print("  3. 打开浏览器: http://localhost:5173")
    print("  4. 查看地图上的站场和管线")
    
    print("\n" + "=" * 60)
    print("✅ 演示准备完成!")
    print("=" * 60)
    
    return True


def quick_test():
    """快速测试 API"""
    print("\n🧪 快速测试 API 端点...")
    
    try:
        import requests
        
        # 测试站场 API
        response = requests.get('http://localhost:8000/api/stations', timeout=2)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ 站场 API: {len(data)} 条记录")
        else:
            print(f"⚠️  站场 API 返回: {response.status_code}")
    except Exception as e:
        print(f"⚠️  API 测试失败: {e}")
        print("   请确保后端服务已启动")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='完整数据流演示')
    parser.add_argument('--test-api', action='store_true', help='测试 API 端点')
    
    args = parser.parse_args()
    
    if args.test_api:
        quick_test()
    else:
        success = demo_full_workflow()
        if success:
            print("\n💡 提示: 使用 --test-api 参数可以测试 API 端点")
        sys.exit(0 if success else 1)
