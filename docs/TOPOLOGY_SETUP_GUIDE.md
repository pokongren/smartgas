# 拓扑计算系统 - 操作说明文档

## 目录
1. [快速启动](#快速启动)
2. [后端配置](#后端配置)
3. [前端配置](#前端配置)
4. [功能使用](#功能使用)
5. [验证测试](#验证测试)
6. [常见问题](#常见问题)

---

## 快速启动

### 步骤 1: 启动后端服务

```bash
# 进入后端目录
cd backend

# 激活虚拟环境（Windows）
.venv\Scripts\activate

# 启动服务
python -m uvicorn app.main:app --reload --port 8000
```

看到以下输出表示启动成功：
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

### 步骤 2: 启动前端服务

```bash
# 在项目根目录
npm run dev
```

看到以下输出表示启动成功：
```
VITE v5.x.x  ready in xxx ms
➜  Local:   http://localhost:5173/
```

### 步骤 3: 验证安装

打开浏览器访问：
- 前端页面：`http://localhost:5173/`
- API 文档：`http://localhost:8000/docs`

---

## 后端配置

### 1. 注册路由（必须）

打开 `backend/app/main.py`，添加以下代码：

```python
# 在文件顶部导入
from app.routers import topology_computation

# 在 app = FastAPI() 之后添加
app.include_router(topology_computation.router)
```

**完整示例：**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 导入路由
from app.routers import basic, workflow, topology_computation  # 添加 topology_computation

app = FastAPI(title="SmartGas API")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(basic.router)
app.include_router(workflow.router)
app.include_router(topology_computation.router)  # 添加这一行
```

### 2. 重启后端服务

修改代码后，按 `Ctrl+C` 停止服务，然后重新启动：

```bash
python -m uvicorn app.main:app --reload --port 8000
```

### 3. 验证 API

打开浏览器访问：`http://localhost:8000/docs`

应该能看到以下 API 端点：
- `POST /api/topology/build`
- `POST /api/topology/path`
- `GET /api/topology/analyze/{graph_name}`
- ...

---

## 前端配置

### 1. 确认环境变量

检查 `.env.local` 文件是否存在，内容应为：

```env
VITE_API_BASE_URL=http://localhost:8000/api
```

如果不存在，创建该文件：

```bash
echo "VITE_API_BASE_URL=http://localhost:8000/api" > .env.local
```

### 2. 确认组件导出

检查 `src/components/topology/index.ts` 是否存在（已创建）。

### 3. 在页面中使用

#### 方式 A: 直接嵌入现有页面

打开您要添加拓扑分析的页面文件（例如 `src/views/SomePipelineView.tsx`），添加：

```tsx
import { TopoViewer } from '@/components/topology'

// 在组件中使用
function SomePipelineView() {
    // 假设您已有 nodes 和 lines 数据
    const nodes = [...]  // PipelineNode[]
    const lines = [...]  // PipelineLine[]
    
    return (
        <div>
            <h1>管线拓扑分析</h1>
            
            {/* 添加拓扑查看器 */}
            <TopoViewer
                pipelineName="your_pipeline_name"
                nodes={nodes}
                lines={lines}
                showMetrics={true}
                showControls={true}
                onNodeClick={(id, name) => console.log('点击节点:', name)}
                onPathSelect={(path) => console.log('选中路径:', path)}
            />
        </div>
    )
}
```

#### 方式 B: 创建独立拓扑分析页面

创建新文件 `src/views/TopologyAnalysisView.tsx`：

```tsx
import React, { useEffect, useState } from 'react'
import { TopoViewer } from '@/components/topology'
import type { PipelineNode, PipelineLine } from '@/types'

// 导入您的数据
import { allStations, allPipelines } from '@/data/multiPipelineData'

export const TopologyAnalysisView: React.FC = () => {
    const [nodes, setNodes] = useState<PipelineNode[]>([])
    const [lines, setLines] = useState<PipelineLine[]>([])
    
    useEffect(() => {
        // 转换数据格式
        const convertedNodes: PipelineNode[] = allStations.map(s => ({
            id: s.id,
            name: s.name,
            type: 'junction' as const,
            coordinate: s.coordinate,
            pressureLevel: 'high' as const,
            status: 'normal' as const
        }))
        
        const convertedLines: PipelineLine[] = allPipelines.map(p => ({
            id: p.id,
            name: p.name,
            startNodeId: p.startNodeId,
            endNodeId: p.endNodeId,
            path: p.path,
            diameter: 1016,
            material: 'steel',
            pressureLevel: 'high' as const,
            length: p.length || 0,
            status: 'normal' as const
        }))
        
        setNodes(convertedNodes)
        setLines(convertedLines)
    }, [])
    
    if (nodes.length === 0) {
        return <div>加载中...</div>
    }
    
    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold text-white mb-6">管网拓扑分析</h1>
            <TopoViewer
                pipelineName="multi_pipeline"
                nodes={nodes}
                lines={lines}
                showMetrics={true}
                showControls={true}
            />
        </div>
    )
}

export default TopologyAnalysisView
```

然后在路由中添加：

```tsx
// src/App.tsx 或路由配置文件
import { TopologyAnalysisView } from '@/views/TopologyAnalysisView'

// 在路由中添加
<Route path="/topology" element={<TopologyAnalysisView />} />
```

---

## 功能使用

### 1. 路径查找

**操作步骤：**
1. 在"起点"下拉框选择起始站场
2. 在"终点"下拉框选择目标站场
3. 点击"查找路径"按钮
4. 查看高亮显示的路径

**预期结果：**
- 路径在图上以蓝色高亮显示
- 起点显示为绿色，终点显示为红色
- 下方显示路径详情（距离、经过站点）

### 2. 查找备选路径

**操作步骤：**
1. 选择起点和终点
2. 点击"备选路径"按钮
3. 查看多条路径列表
4. 点击列表中的路径切换显示

### 3. 显示最小生成树

**操作步骤：**
1. 点击"最小生成树"按钮
2. 查看以绿色高亮的MST边

**用途：**
- 识别管网骨架结构
- 发现冗余连接

### 4. 检测环路

**操作步骤：**
1. 点击"检测环路"按钮
2. 查看高亮的环路节点

**用途：**
- 识别调度优化点
- 分析供气可靠性

### 5. 查看拓扑指标

在"拓扑指标"面板查看：
- 节点数、边数
- 连通分量数
- 环数
- 图密度、平均度
- 直径、平均最短路径

### 6. 查看关键节点

在"关键节点"面板查看介数中心性Top5节点：
- 分数越高表示节点越关键
- 这些节点故障影响范围最大

---

## 验证测试

### 测试 1: API 连通性

```bash
# 测试构建图 API
curl -X POST http://localhost:8000/api/topology/build \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test_graph",
    "directed": true,
    "nodes": [
      {"id": "a", "name": "站A", "type": "compressor", "longitude": 100, "latitude": 30},
      {"id": "b", "name": "站B", "type": "distribution", "longitude": 101, "latitude": 31}
    ],
    "edges": [
      {"id": "e1", "source": "a", "target": "b", "length_km": 100, "diameter_mm": 500}
    ]
  }'
```

预期返回：
```json
{
  "success": true,
  "graph_name": "test_graph",
  "node_count": 2,
  "edge_count": 1,
  "message": "Successfully built graph 'test_graph'"
}
```

### 测试 2: 路径计算

```bash
# 测试路径查找
curl -X POST http://localhost:8000/api/topology/path \
  -H "Content-Type: application/json" \
  -d '{
    "graph_name": "test_graph",
    "source": "a",
    "target": "b",
    "algorithm": "dijkstra"
  }'
```

预期返回：
```json
{
  "found": true,
  "path": ["a", "b"],
  "path_names": ["站A", "站B"],
  "total_length": 100,
  "total_delay": 1,
  "edge_count": 1
}
```

### 测试 3: 拓扑分析

```bash
# 测试拓扑分析
curl http://localhost:8000/api/topology/analyze/test_graph
```

预期返回包含 metrics、centrality 等字段的 JSON。

---

## 常见问题

### Q1: 后端启动报错 "No module named 'networkx'"

**解决：**
```bash
cd backend
.venv\Scripts\activate
pip install networkx
```

### Q2: 前端报错 "Cannot find module '@/components/topology'"

**解决：**
检查 `src/components/topology/index.ts` 是否存在，如果不存在创建：

```bash
mkdir -p src/components/topology
echo 'export { TopoViewer } from "./TopoViewer"' > src/components/topology/index.ts
```

### Q3: API 请求 404

**解决：**
1. 确认后端路由已注册（见"后端配置"第1步）
2. 确认后端服务已重启
3. 检查请求 URL 是否正确（应为 `/api/topology/xxx`）

### Q4: 跨域错误 (CORS)

**解决：**
确认 `backend/app/main.py` 中已配置 CORS：

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # 前端地址
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Q5: 拓扑图不显示

**解决：**
1. 检查浏览器控制台是否有错误
2. 确认 nodes 和 lines 数据已正确传入
3. 检查数据格式是否正确（id、coordinate 等字段）

---

## 下一步

系统已就绪，您可以：

1. **接入真实数据** - 从数据库读取站场和管线数据
2. **添加更多功能** - 如批量路径计算、历史对比等
3. **优化性能** - 大数据量时使用分页或 Web Worker
4. **扩展算法** - 添加流量分配、压力计算等

如需帮助，请查看：
- 架构设计：`docs/TOPOLOGY_COMPUTATION_SCHEME.md`
- 使用指南：`docs/TOPOLOGY_COMPUTATION_USAGE.md`
