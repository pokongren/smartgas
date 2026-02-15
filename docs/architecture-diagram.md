# SmartGas Grid 智慧管网系统 - 完整架构图

## 系统架构概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SmartGas Grid 架构图                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌───────────┐                                                         │
│   │   User    │                                                         │
│   │ 用户/调度员 │                                                        │
│   └─────┬─────┘                                                         │
│         │                                                               │
│         ▼                                                               │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                      Frontend Layer                             │  │
│   │                   React 19 + Vite 6 + TypeScript                │  │
│   ├─────────────────────────────────────────────────────────────────┤  │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │  │
│   │  │   Router    │  │    Views    │  │       Components        │  │  │
│   │  │ HashRouter  │──│ CorpView    │──│ MapView.tsx             │  │  │
│   │  │  Routes     │  │ TechView    │  │ ClusterDetailPanel      │  │  │
│   │  │  Suspense   │  │ GlobalView  │  │ EmergencyPanel          │  │  │
│   │  └─────────────┘  └─────────────┘  └─────────────────────────┘  │  │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │  │
│   │  │   Utils     │  │    Data     │  │       Hooks             │  │  │
│   │  │ mapRenderer │  │ PipelineData│  │ useState/useEffect      │  │  │
│   │  │ dataLoader  │  │ StationData │  │ useRef/useCallback      │  │  │
│   │  └─────────────┘  └─────────────┘  └─────────────────────────┘  │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                      Map SDK Layer                              │  │
│   │                     高德地图 JS API 2.0                          │  │
│   ├─────────────────────────────────────────────────────────────────┤  │
│   │  AMapLoader → AMap.Map → DistrictLayer → Markers/Polylines     │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                      Backend Layer                              │  │
│   │                  FastAPI + Python + NetworkX                    │  │
│   ├─────────────────────────────────────────────────────────────────┤  │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │  │
│   │  │   Routers   │  │  Services   │  │        Models           │  │  │
│   │  │  basic.py   │  │PipelineSvc  │  │  Station (SQLModel)     │  │  │
│   │  │emergency.py │  │TopologySvc  │  │  Pipeline (SQLModel)    │  │  │
│   │  │pipelines.py │  │   RAGSvc    │  │  Emergency (Pydantic)   │  │  │
│   │  └─────────────┘  └─────────────┘  └─────────────────────────┘  │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                     Database Layer                              │  │
│   │                  SQLite + SQLModel + ChromaDB                   │  │
│   ├─────────────────────────────────────────────────────────────────┤  │
│   │  stations ↔ pipelines ↔ valves + details + emergency_events    │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 详细架构图 (Mermaid)

```mermaid
graph TB
    %% ==================== 样式定义 ====================
    classDef frontend fill:#1c2430,stroke:#137fec,stroke-width:2px,color:#fff
    classDef backend fill:#2d3b4e,stroke:#D0BB95,stroke-width:2px,color:#fff
    classDef database fill:#1d1a15,stroke:#D0BB95,stroke-width:2px,color:#fff
    classDef map fill:#0f1419,stroke:#ef4444,stroke-width:2px,color:#fff
    classDef external fill:#101922,stroke:#666,stroke-width:1px,color:#aaa

    %% ==================== 用户层 ====================
    User([User])

    %% ==================== 前端层 ====================
    subgraph Frontend[Frontend Layer React 19 + Vite 6]
        direction TB
        
        subgraph FE_Entry[Entry]
            App[App.tsx HashRouter + Suspense]
            LazyRoutes[Lazy Routes]
            App --> LazyRoutes
        end
        
        subgraph FE_Views[Views]
            CorpView[CorpView]
            TechView[TechView]
            GlobalView[GlobalPipelineView]
            LazyRoutes -.-> CorpView
            LazyRoutes -.-> TechView
            LazyRoutes -.-> GlobalView
        end
        
        subgraph FE_Components[Components]
            MapView[MapView.tsx]
            ClusterPanel[ClusterDetailPanel]
            EmergencyPanel[EmergencyPanel]
        end
        
        GlobalView --> MapView
        MapView --> ClusterPanel
        MapView --> EmergencyPanel
    end

    %% ==================== 地图层 ====================
    subgraph MapSDK[Map SDK Layer AMap JS API 2.0]
        direction TB
        
        AMapLoader[AMapLoader]
        AMap[AMap.Map]
        DistrictLayer[DistrictLayer]
        Overlays[Markers Polylines]
        
        AMapLoader --> AMap
        AMap --> DistrictLayer
        AMap --> Overlays
    end

    %% ==================== 后端层 ====================
    subgraph Backend[Backend Layer FastAPI]
        direction TB
        
        subgraph BE_Routers[Routers]
            BasicRouter[basic.py]
            EmergencyRouter[emergency.py]
            PipelineRouter[pipelines.py]
        end
        
        subgraph BE_Services[Services]
            PipelineSvc[PipelineService]
            TopologySvc[TopologyService]
            RAGSvc[RAGService]
        end
        
        subgraph BE_Models[Models]
            StationModel[Station]
            PipelineModel[Pipeline]
        end
        
        EmergencyRouter --> TopologySvc
        PipelineRouter --> PipelineSvc
        TopologySvc --> StationModel
        PipelineSvc --> PipelineModel
    end

    %% ==================== 数据库层 ====================
    subgraph Database[Database Layer SQLite]
        direction TB
        
        Stations[(stations)]
        Pipelines[(pipelines)]
        Valves[(valves)]
        Emergency[(emergency_events)]
        
        Stations --> Pipelines
        Pipelines --> Valves
    end

    %% ==================== 连接 ====================
    User --> Frontend
    MapView --> MapSDK
    Frontend -.->|HTTP API| Backend
    Backend --> Database

    %% ==================== 样式应用 ====================
    class Frontend frontend
    class Backend backend
    class Database database
    class MapSDK map
```

---

## 前端 React 架构特征

### 1. React 18+ Root API
```tsx
// main.tsx
import { createRoot } from 'react-dom/client'
const root = createRoot(rootElement)
root.render(<App />)
```

### 2. 函数组件 + Hooks
```tsx
// App.tsx
const App: React.FC = () => { ... }
const [state, setState] = useState(null)
useEffect(() => { ... }, [])
useCallback(() => { ... }, [])
```

### 3. React.lazy + Suspense 代码分割
```tsx
const CorpView = lazy(() => import('./views/CorpView'))
<Suspense fallback={<PageLoader />}>
  <Routes>...</Routes>
</Suspense>
```

### 4. React Router v6
```tsx
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom'
<HashRouter>
  <Route path="/" element={<CorpView />} />
</HashRouter>
```

---

## 后端 FastAPI 架构

### 分层结构
```
main.py (FastAPI App)
├── api/
│   ├── basic.py (CRUD API)
│   ├── emergency.py (Emergency API)
│   └── pipelines.py (Pipeline API)
├── services/
│   ├── pipeline_service.py
│   ├── topology_service.py (NetworkX)
│   └── rag_service.py (ChromaDB + Gemini)
├── models/
│   ├── station.py (SQLModel)
│   └── pipeline.py (SQLModel)
└── db/
    └── session.py
```

---

## 数据库架构

### ER 关系
```
stations (1:N) pipelines
pipelines (1:N) node_relations
trunk_details (1:N) branch_details
```

### 核心表
- `stations` - 站场基础信息
- `pipelines` - 管线基础信息
- `valves` - 阀室信息
- `emergency_events` - 应急事件

---

## 数据流示例

### 场景: 路径分析
```
User Click 
  -> Frontend (React State)
  -> POST /api/emergency/route-analysis
  -> Backend (TopologyService)
  -> NetworkX Graph Build
  -> Dijkstra Shortest Path
  -> JSON Response
  -> Frontend Update Map
```

---

*Generated: 2026-02-14*
