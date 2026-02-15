# SmartGas Grid System Architecture

本文档展示了 SmartGas 系统的整体架构，涵盖前端展示、后端处理以及核心的管道全生命周期管理工作流。

## 系统架构图 (System Architecture)

```mermaid
graph TD
    %% ==========================================
    %% 核心用户与入口 (User & Entry)
    %% ==========================================
    User((👨‍✈️ 用户/调度员))
    
    subgraph Frontend [💻 前端应用 (React + Vite + TypeScript)]
        style Frontend fill:#e1f5fe,stroke:#01579b
        
        UI_Layer[用户交互层]
        Visualization_Layer[可视化渲染层]
        
        subgraph Components [核心组件]
            MapView[🗺️ MapView<br/>(地图主视图)]
            ClusterPanel[📦 ClusterDetailPanel<br/>(分层聚合详情)]
            ChatInterface[💬 ChatBox<br/>(自然语言指令)]
            UploadComponent[📂 Uploader<br/>(数据导入)]
        end
        
        subgraph Data_Store [前端数据存储]
            PipelineData[📄 PipelineData.ts<br/>(结构化管线数据)]
            StationData[📍 StationData<br/>(场站/阀室坐标)]
        end
    end

    %% ==========================================
    %% 后端服务与逻辑 (Backend)
    %% ==========================================
    subgraph Backend [⚙️ 后端服务 (Python + FastAPI)]
        style Backend fill:#fff3e0,stroke:#e65100
        
        APIGateway[📥 API Gateway<br/>(FastAPI Router)]
        
        subgraph Pipeline_Master_System [🚀 管道全生命周期管理系统 (Skill)]
            style Pipeline_Master_System fill:#e8f5e9,stroke:#2e7d32
            
            direction TB
            
            %% 阶段一：提取
            Extraction_Engine[🛠️ 拓扑提取器<br/>(extract_trunk_and_branches.py)]
            
            %% 阶段二：转换
            Transformation_Engine[🔄 数据转换器]
            Sorter[✨ 智能排序逻辑<br/>(干线/支线分离 & 地理排序)]
            
            %% 阶段三：渲染算法
            Render_Algo[🎨 智能分层聚合算法<br/>(Smart Layered Clustering)]
        end
        
        subgraph Data_Processing [通用数据处理]
            NLP_Parser[🧠 NLP 解析器<br/>(意图识别)]
            Excel_Parser[📊 Excel/CSV 解析器]
        end
    end

    %% ==========================================
    %% 数据存储层 (Data Layer)
    %% ==========================================
    subgraph Database [🗄️ 数据存储层]
        style Database fill:#f3e5f5,stroke:#4a148c
        
        DB_Master[(🛢️ SmartGas.db<br/>SQLite/PostgreSQL)]
        Raw_Files[📄 原始 JSON/CSV 文件]
    end

    %% ==========================================
    %% 数据流转 (Data Flow)
    %% ==========================================
    
    %% 1. 数据录入流
    User -- "上传/指令" --> UI_Layer
    UI_Layer --> APIGateway
    APIGateway --> Data_Processing
    Data_Processing --> DB_Master
    
    %% 2. 管道生成流 (Pipeline Master Workflow)
    DB_Master -- "原始管线数据" --> Extraction_Engine
    Extraction_Engine -- "pipeline_structure.json" --> Transformation_Engine
    Transformation_Engine -- "排序与坐标映射" --> Sorter
    Sorter -- "生成前端代码/JSON" --> PipelineData
    
    %% 3. 可视化渲染流
    PipelineData --> Render_Algo
    StationData --> Render_Algo
    Render_Algo -- "聚合/展开逻辑" --> Visualization_Layer
    Visualization_Layer --> MapView
    Visualization_Layer --> ClusterPanel
    
    %% 4. 用户交互
    MapView -- "查看/点击" --> User
    ClusterPanel -- "展开详情" --> User

```

## 核心模块说明

### 1. 管道全生命周期管理系统 (Pipeline Master System)
这是系统的核心处理大脑，负责将散乱的数据库记录转化为可视化的地图数据。
- **提取层 (Extraction)**: 智能识别干线与支线，解决原始数据中节点顺序错乱的问题。
- **转换层 (Transformation)**: 负责地理坐标映射、节点排序（尤其是跨段干线的正确排序）以及数据格式标准化。
- **渲染层 (Rendering)**: 前端实现的智能算法，解决高密集度站点的重叠显示问题（螺旋展开、分层聚合）。

### 2. 前端架构
- 基于 **React + Vite** 构建，追求高性能渲染。
- **MapView**: 核心地图组件，承载所有可视化元素。
- **ClusterDetailPanel**: 处理复杂交叉点的交互组件。

### 3. 后端架构
- 基于 **Python FastAPI**，提供数据接口与处理能力。
- 集成 **Pandas** 进行复杂数据清洗。
- 提供 NLP 接口支持自然语言查询。
