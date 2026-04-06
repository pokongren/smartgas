# 拓扑计算使用说明

这份文档只讲现在项目里真实可用的拓扑计算链路。

## 当前口径

- 后端端口：`8080`
- 前端开发端口：`5173`
- `useTopology` 默认直连：`/topology/...`
- 普通 API 仍然可能走：`/api/...`

`.env.local` 建议：

```env
VITE_API_BASE_URL=http://localhost:8080/api
```

这会让：

- `API_BASE_URL = http://localhost:8080/api`
- `BACKEND_BASE_URL = http://localhost:8080`

## 1. 用 `TopoViewer`

```tsx
import { TopoViewer } from '@/components/topology'

function PipelineAnalysisPage() {
    const { nodes, lines } = usePipelineData('west_east_2')

    return (
        <TopoViewer
            pipelineName="west_east_2"
            nodes={nodes}
            lines={lines}
            showMetrics={true}
            showControls={true}
        />
    )
}
```

## 2. 用 `useTopology`

```tsx
import { useEffect } from 'react'
import { useTopology } from '@/hooks/useTopology'

function CustomAnalysis({ nodes, lines }: { nodes: any[]; lines: any[] }) {
    const {
        loadFromPipeline,
        findPath,
        analyzeTopology,
        metrics,
    } = useTopology()

    useEffect(() => {
        void loadFromPipeline('pipeline_graph', { nodes, lines })
    }, [loadFromPipeline, nodes, lines])

    const handleFindPath = async () => {
        const result = await findPath('node_a', 'node_b')
        console.log(result)
    }

    return (
        <div>
            <button onClick={handleFindPath}>查路径</button>
            <button onClick={() => void analyzeTopology()}>做分析</button>
            {metrics && <div>节点数：{metrics.node_count}</div>}
        </div>
    )
}
```

## 3. `useTopology` 现在实际调用的接口

这条 Hook 现在走的是直连后端的拓扑计算接口：

- `POST /topology/build`
- `POST /topology/path`
- `POST /topology/paths`
- `GET /topology/analyze/{graph_name}`
- `GET /topology/cycles/{graph_name}`
- `GET /topology/mst/{graph_name}`

对应文件：

- `src/hooks/useTopology.ts`
- `backend/app/routers/topology_computation.py`

## 4. 请求示例

### 构建图

```http
POST /topology/build
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

### 查路径

```http
POST /topology/path
Content-Type: application/json

{
  "graph_name": "pipeline_graph",
  "source": "node_1",
  "target": "node_10",
  "algorithm": "dijkstra"
}
```

### 做拓扑分析

```http
GET /topology/analyze/pipeline_graph
```

## 5. 常见用途

### 路径计算

- 找最短路径
- 找备选路径
- 排除指定节点后重算

### 拓扑分析

- 看节点数、边数、密度
- 看连通分量
- 看环路
- 看关键节点

### 最小生成树

适合拿来做骨架结构观察，不适合直接当业务展示图。

## 6. 常见坑

### 1) 为什么我以为应该走 `/api/topology/...`

因为仓库里现在同时存在两套风格：

- 拓扑编辑器相关接口更多还是 `/api/topology/...`
- `useTopology` 这条计算链已经走 `/topology/...`

如果你在排查 Hook，不要再拿旧文档里的 `/api/topology/...` 去套。

### 2) 为什么端口不是 `8000`

现在项目默认已经切到 `8080`。如果你还按 `8000` 跑，前后端联调很容易直接错位。

### 3) 怎么确认自己打到的是对的接口

先看调用方：

- `useTopology.ts`：优先查 `/topology/...`
- `topologyEditorApi.ts`：优先查 `/api/topology/...`
- `api.ts`：既有 `/api/...`，也有少量直连 `/topology/...`
