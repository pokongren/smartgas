# 拓扑计算系统 - 快速开始

## 启动步骤

### 1. 双击启动（推荐）

直接双击运行 `start_topology_demo.bat`

等待自动打开浏览器，访问 `http://localhost:5173/`

### 2. 手动启动

**后端：**
```bash
cd backend
.venv\Scripts\activate
python -m uvicorn app.main:app --reload --port 8000
```

**前端（新开终端）：**
```bash
npm run dev
```

**访问：**
- 前端页面：`http://localhost:5173/topology-demo`
- API 文档：`http://localhost:8000/docs`

---

## 功能验证

### 测试 1: 查看演示页面
1. 打开 `http://localhost:5173/topology-demo`
2. 应该看到拓扑分析界面
3. 选择起点和终点，点击"查找路径"

### 测试 2: API 测试
1. 打开 `http://localhost:8000/docs`
2. 找到 `POST /api/topology/build`
3. 点击 "Try it out"
4. 输入测试数据：
```json
{
  "name": "test",
  "directed": true,
  "nodes": [
    {"id": "a", "name": "站A", "type": "compressor", "longitude": 100, "latitude": 30},
    {"id": "b", "name": "站B", "type": "distribution", "longitude": 101, "latitude": 31}
  ],
  "edges": [
    {"id": "e1", "source": "a", "target": "b", "length_km": 100, "diameter_mm": 500}
  ]
}
```
5. 点击 "Execute"，应该返回成功响应

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `start_topology_demo.bat` | 一键启动脚本 |
| `src/views/TopologyDemoView.tsx` | 演示页面 |
| `src/components/topology/TopoViewer.tsx` | 拓扑组件 |
| `src/hooks/useTopology.ts` | 拓扑 Hook |
| `backend/app/services/topology_computation.py` | 后端服务 |
| `backend/app/routers/topology_computation.py` | API 路由 |
| `docs/TOPOLOGY_SETUP_GUIDE.md` | 详细文档 |

---

## 常见问题

**Q: 端口被占用**
- 启动脚本会自动释放端口，或手动关闭占用 8000/5173 的程序

**Q: 后端启动失败**
- 检查 `backend/app/main.py` 是否已导入 `topology_computation`

**Q: 页面空白**
- 按 F12 打开控制台查看错误
- 确认后端服务已启动

---

## 下一步

1. **接入真实数据** - 替换演示数据为数据库数据
2. **集成到现有页面** - 在其他视图中使用 TopoViewer
3. **扩展功能** - 添加更多图算法

详细文档见 `docs/TOPOLOGY_SETUP_GUIDE.md`
