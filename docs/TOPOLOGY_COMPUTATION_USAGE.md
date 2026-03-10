# 拓扑计算方案使用指南

## 快速开始

### 1. 后端配置

将拓扑计算路由添加到 FastAPI 应用：

```python
# backend/app/main.py
from app.routers import topology_computation

app.include_router(topology_computation.router)
```

### 2. 前端配置

确保 API 基础 URL 配置正确：

```env
# .env.local
VITE_API_BASE_URL=http://localhost:8000/api
```

### 3. 基本使用

```tsx
import { TopoViewer } from '@/components/topology'
import { useTopology } from '@/hooks/useTopology'

// 方式1: 使用 TopoViewer 组件（推荐）
function PipelineAnalysisPage() {
    const { nodes, lines } = usePipelineData('west_east_2')
    
    return (
        <TopoViewer
            pipelineName="west_east_2"
            nodes={nodes}
            lines={lines}
            showMetrics={true}
            showControls={true}
            onNodeClick={(id, name) => console.log('Clicked:', name)}
            onPathSelect={(path) => console.log('Path:', path)}
        />
    )
}

// 方式2: 使用 useTopology Hook 自定义界面
function CustomAnalysis() {
    const {
        loadFromPipeline,
        findPath,
        analyzeTopology,
        metrics,
        analysis,
        loading
    } = useTopology()
    
    useEffect(() => {
        loadFromPipeline('pipeline_name', { nodes, lines })
    }, [])
    
    const handleFindPath = async () => {
        const result = await findPath('node_a', 'node_b')
        console.log(result)
    }
    
    return (
        <div>
            {metrics && (
                <div>节点数: {metrics.node_count}</div>
            )}
            <button onClick={handleFindPath}>查找路径</button>
        </div>
    )
}
```

## API 接口

### 构建图

```http
POST /api/topology/build
Content-Type: application/json

{
  "name": "pipeline_graph",
  "directed": true,
  "nodes": [
    {
      "id": "node_1",
      "name": "霍尔果斯压气站",
      "type": "compressor",
      "longitude": 80.41,
      "latitude": 44.21
    }
  ],
  "edges": [
    {
      "id": "edge_1",
      "source": "node_1",
      "target": "node_2",
      "length_km": 150.5,
      "diameter_mm": 1016
    }
  ]
}
```

### 查找路径

```http
POST /api/topology/path
Content-Type: application/json

{
  "graph_name": "pipeline_graph",
  "source": "node_1",
  "target": "node_10",
  "algorithm": "dijkstra"
}

Response:
{
  "found": true,
  "path": ["node_1", "node_2", "node_5", "node_10"],
  "path_names": ["霍尔果斯", "精河", "中卫", "上海"],
  "total_length": 4892.5,
  "total_delay": 156,
  "edge_count": 3
}
```

### 拓扑分析

```http
GET /api/topology/analyze/pipeline_graph

Response:
{
  "metrics": {
    "node_count": 156,
    "edge_count": 189,
    "density": 0.0156,
    "avg_degree": 2.42,
    "connected_components": 1,
    "cycle_count": 12,
    "diameter": 28,
    "avg_shortest_path": 8.5
  },
  "centrality": {
    "top_betweenness": [
      {"node_id": "node_5", "name": "中卫压气站", "score": 0.4521}
    ]
  },
  "connected_components": [...],
  "cycles": {
    "count": 12,
    "examples": [["node_1", "node_2", "node_3", "node_1"]]
  }
}
```

## 功能特性

### 1. 路径计算

- **最短路径**: Dijkstra、A*、Bellman-Ford 算法
- **备选路径**: 查找多条不重复路径
- **路径排除**: 支持排除特定节点或边

### 2. 拓扑分析

- **基础指标**: 节点数、边数、密度、平均度
- **连通性**: 连通分量识别
- **环检测**: 识别管网中的环路结构
- **中心性**: 介数、度、接近度、特征向量中心性

### 3. 最小生成树

计算管网的最小生成树，用于：
- 简化管网结构
- 识别关键连接
- 优化管网设计

### 4. 可视化

- **拓扑图**: SVG 渲染管网结构
- **路径高亮**: 可视化显示计算路径
- **MST 展示**: 显示最小生成树边
- **环显示**: 高亮环路节点

## 性能优化

### 缓存策略

```tsx
const { analyzeTopology } = useTopology({ enableCache: true })

// 结果会自动缓存，重复调用返回缓存数据
const result1 = await analyzeTopology() // 实际计算
const result2 = await analyzeTopology() // 返回缓存
```

### 手动清除缓存

```tsx
const { clearCache } = useTopology()

// 清除所有缓存
clearCache()
```

## 错误处理

```tsx
const { error, loading, findPath } = useTopology()

// 在 UI 中显示错误
{error && <div className="error">{error}</div>}

// 或 try-catch
const handleFindPath = async () => {
    const result = await findPath('a', 'b')
    if (!result) {
        // 处理无路径情况
    }
}
```

## 扩展开发

### 添加新算法

在 `topology_computation.py` 中添加：

```python
def custom_algorithm(self, graph: TopologyGraph, **params) -> Dict:
    # 实现算法
    result = {...}
    return result
```

### 自定义可视化

基于 `TopoViewer` 扩展：

```tsx
function CustomTopoViewer(props) {
    return (
        <TopoViewer
            {...props}
            renderCustomOverlay={(svg) => (
                // 自定义 SVG 覆盖层
            )}
        />
    )
}
```

## 示例场景

### 场景1: 故障影响分析

```tsx
function FailureAnalysis() {
    const { findAlternativePaths, analysis } = useTopology()
    
    const analyzeImpact = async (failedNode: string) => {
        // 查找绕过故障节点的路径
        const paths = await findAlternativePaths('source', 'target', 5)
        
        // 分析关键节点
        const criticalNodes = analysis?.centrality.top_betweenness || []
        
        return { paths, criticalNodes }
    }
}
```

### 场景2: 路由规划

```tsx
function RoutePlanning() {
    const { findPath, metrics } = useTopology()
    
    const planRoute = async (source: string, targets: string[]) => {
        const routes = await Promise.all(
            targets.map(target => findPath(source, target))
        )
        
        // 选择最优路径
        const optimal = routes
            .filter(r => r?.found)
            .sort((a, b) => a!.total_length - b!.total_length)[0]
        
        return optimal
    }
}
```

### 场景3: 管网优化

```tsx
function NetworkOptimization() {
    const { analyzeTopology, findMST } = useTopology()
    
    const optimize = async () => {
        const analysis = await analyzeTopology()
        const mst = await findMST()
        
        // 识别冗余边
        const redundantEdges = edges.filter(
            e => !mst.edge_ids.includes(e.id)
        )
        
        return { analysis, mst, redundantEdges }
    }
}
```
