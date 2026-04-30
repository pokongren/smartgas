# SmartGas Grid - 项目代码结构说明

> **智脉平台 - 智慧燃气管网应急指挥系统**
>
> 本文档描述项目的目录结构、技术栈及核心模块职责。

---

## 一、技术栈概览

| 层级 | 技术 | 版本 |
|------|------|------|
| **前端** | React + TypeScript + Vite | React 19, Vite 6 |
| **前端样式** | Tailwind CSS | v4 |
| **前端地图** | 高德地图 JS API | 2.0 |
| **前端图表** | ECharts | v5 |
| **后端** | Python + FastAPI | Python 3.12 |
| **ORM** | SQLModel | - |
| **数据库** | SQLite + ChromaDB | - |
| **AI 服务** | Google Gemini / MiniMax / OpenAI Compatible | - |
| **消息推送** | 飞书机器人 Webhook | - |

---

## 二、顶层目录结构

```
smartgas-grid/
├── src/                          # 前端源码
├── backend/                      # 后端源码
├── backend/scripts/              # 数据导入/修复脚本（一次性）
├── docs/                         # 项目文档与开发记录
├── recovery/                     # 代码历史备份（应移除）
├── dist/                         # 前端构建产物
├── node_modules/                 # 前端依赖（不应提交到 Git）
├── .venv/                        # Python 虚拟环境（冗余，应移除）
├── .tmp_frames/                  # 运行时临时截图（应清理）
├── index.html                    # 前端入口 HTML
├── package.json                  # 前端依赖配置
├── vite.config.ts                # Vite 构建配置
├── tsconfig.json                 # TypeScript 配置
└── [根目录散落文件]              # 临时脚本、日志、总结（待整理）
```

> ⚠️ **注意**：根目录存在大量临时文件（`analyze_*.py`、`tmp_*.py`、日志文件、`.md` 总结），建议统一迁移至 `tools/` 或归档处理。

---

## 三、前端结构 (`src/`)

```
src/
├── App.tsx                      # 根组件，路由与全局布局
├── main.tsx                     # 应用入口，ReactDOM 渲染
├── index.css                    # 全局样式
├── vite-env.d.ts                # Vite 环境类型声明
│
├── components/                  # UI 组件层
│   ├── ai-assistant/           # AI 智能助手组件
│   │   ├── AiAssistant.tsx     # 主组件：AI 对话面板
│   │   ├── useAiAssistantChat.ts   # 聊天逻辑 Hook
│   │   ├── useAiAssistantPageContext.ts  # 页面上下文 Hook
│   │   ├── runtimeAssistantContext.ts    # 运行时上下文
│   │   └── ai-assistant.css    # 样式
│   ├── map-view/               # 高德地图视图组件
│   │   ├── MapView.tsx         # 主地图组件（含硬编码 API Key，需修复）
│   │   ├── MapView.optimized.tsx   # 优化版地图组件
│   │   ├── types.ts            # 地图类型定义
│   │   └── *.css               # 地图样式
│   ├── scada/                  # SCADA 历史数据组件
│   │   ├── ScadaHistoryChart.tsx       # 历史趋势图表
│   │   ├── ScadaHistoryChartCompat.tsx # 兼容版图表
│   │   ├── StationHistoryPanel.tsx     # 场站历史面板
│   │   └── LuzhiHistoryPanel.tsx       # 鹿邑历史面板
│   ├── topology/               # 拓扑可视化组件
│   │   ├── TopoViewer.tsx      # 拓扑图查看器
│   │   ├── SimPanel.tsx        # 仿真控制面板
│   │   └── SimParamEditor.tsx  # 仿真参数编辑器
│   ├── workflow/               # 工作流组件
│   │   ├── WorkflowEditor.tsx  # 工作流图形编辑器
│   │   └── WorkflowRunner.tsx  # 工作流执行器
│   ├── ui/                     # 通用基础组件
│   │   └── Icon.tsx            # 图标组件
│   ├── ClusterDetailPanel.tsx  # 管网簇详情面板
│   ├── EmergencyPanel.tsx      # 应急指挥面板
│   └── HubDetailPanel.tsx      # 枢纽节点详情面板
│
├── views/                       # 页面视图层
│   ├── global-pipeline/        # 全局管网视图
│   │   ├── ScadaFloatingPanel.tsx  # SCADA 浮动面板
│   │   └── scadaConfig.ts      # SCADA 配置
│   ├── GlobalPipelineView.tsx  # 全局管网总览（标准版）
│   ├── GlobalPipelineView.optimized.tsx  # 优化版
│   ├── MapTopologyView.tsx     # 地图拓扑联动视图
│   ├── TopologyView.tsx        # 纯拓扑视图
│   ├── TopologyDemoView.tsx    # 拓扑演示视图
│   ├── TechView.tsx            # 技术参数视图
│   ├── CorpView.tsx            # 企业信息视图
│   ├── MapDemo.tsx             # 地图演示页
│   └── PipelineEditorOverlay.tsx   # 管线编辑遮罩层
│
├── data/                        # 静态数据与管道结构定义
│   ├── pipelines/              # 各管线数据模块
│   │   ├── index.ts            # 统一导出
│   │   ├── types.ts            # 管线类型定义
│   │   ├── utils.ts            # 数据处理工具
│   │   ├── transform.ts        # 数据转换逻辑
│   │   ├── cred.ts             # 储气库管线 (CRED)
│   │   ├── gn.ts               # 国内管线 (GN)
│   │   ├── gs.ts               # 干线管线 (GS)
│   │   ├── pt.ts               # 西气东输管线 (PT)
│   │   ├── sj4.ts              # 苏焦四线 (SJ4)
│   │   ├── we1.ts              # 西一线 (WE1)
│   │   ├── we2.ts              # 西二线 (WE2)
│   │   ├── zg.ts               # 中贵线 (ZG)
│   │   └── zm.ts               # 中缅线 (ZM)
│   ├── *_structure.json        # 各管线 JSON 结构定义
│   ├── hubNodes.ts             # 枢纽节点数据
│   ├── southernPipelineData.ts # 南方管网数据
│   └── luzhiHistoryData.ts     # 鹿邑历史数据
│
├── services/                    # API 服务层（HTTP 请求封装）
│   ├── api.ts                  # 主 API 接口集合
│   ├── apiBase.ts              # Axios 基础配置
│   ├── topologyEditorApi.ts    # 拓扑编辑器 API
│   └── workflow-api.ts         # 工作流 API
│
├── hooks/                       # 自定义 React Hooks
│   ├── use-execution.ts        # 执行器 Hook
│   ├── use-workflows.ts        # 工作流管理 Hook
│   ├── useSimulation.ts        # 仿真状态 Hook
│   ├── useTopology.ts          # 拓扑数据 Hook
│   └── useNewWindow.ts         # 新窗口管理 Hook
│
├── types/                       # 全局 TypeScript 类型
│   ├── index.ts                # 统一导出
│   ├── pipeline.ts             # 管线相关类型
│   ├── hub.ts                  # 枢纽节点类型
│   ├── cluster.ts              # 管网簇类型
│   ├── simulation.ts           # 仿真相关类型
│   └── workflow.ts             # 工作流类型
│
├── utils/                       # 工具函数库
│   ├── dataLoader.ts           # 数据加载器
│   ├── mapRenderer.ts          # 地图渲染器
│   ├── hubRenderer.ts          # 枢纽渲染器
│   ├── hierarchyRenderer.ts    # 层级渲染器
│   ├── topology-validator.ts   # 拓扑数据校验
│   ├── cutoff-simulator.ts     # 截断仿真计算
│   ├── geoOffset.ts            # 地理坐标偏移计算
│   ├── pipelineDomain.ts       # 管线领域逻辑
│   ├── swarmAnalysis.ts        # 集群分析
│   ├── simulationOverlayMapping.ts     # 仿真覆盖映射
│   └── simulationShowcaseSync.ts       # 仿真展示同步
│
└── styles/                      # 样式文件
    ├── index.css               # 全局基础样式
    └── topology-view.css       # 拓扑视图专用样式
```

### 前端关键文件说明

| 文件 | 职责 |
|------|------|
| `App.tsx` | 定义全局路由（HashRouter）、布局框架、全局状态 |
| `main.tsx` | 应用挂载点，初始化 React 根节点 |
| `services/api.ts` | 封装所有后端 API 调用（管网数据、应急、SCADA、拓扑、工作流） |
| `data/pipelines/` | 各国家级管网线的结构化数据（场站、管段、物理参数） |
| `components/map-view/MapView.tsx` | 核心地图组件，集成高德地图、覆盖物绘制、事件交互 |
| `views/MapTopologyView.tsx` | 地图与拓扑联动视图，支持 GIS 坐标与拓扑图同步 |

---

## 四、后端结构 (`backend/`)

```
backend/
├── main.py                      # FastAPI 应用入口
├── run.py                       # 开发服务器启动脚本
├── check_db.py                  # 数据库检查工具
├── requirements.txt             # Python 依赖列表
├── .env / .env.example          # 环境变量配置
├── .venv/                       # Python 虚拟环境
│
├── app/                         # 核心应用包
│   ├── __init__.py
│   ├── main.py                  # FastAPI 实例创建与中间件注册
│   ├── database.py              # SQLModel 数据库引擎与 Session
│   ├── models.py                # 核心数据模型（SQLModel）
│   ├── schemas.py               # Pydantic 请求/响应 Schema
│   ├── scada_models.py          # SCADA 专用数据模型
│   ├── workflow_models.py       # 工作流数据模型
│   ├── workflow_schemas.py      # 工作流 Schema
│   │
│   ├── routers/                 # API 路由层（按业务域划分）
│   │   ├── __init__.py
│   │   ├── basic.py             # 基础接口（健康检查、系统信息）
│   │   ├── emergency.py         # 应急指挥 API（⚠️ 含 FIXME 模拟数据）
│   │   ├── ai_assistant.py      # AI 助手 API（对话、分析、工具调用）
│   │   ├── scada.py             # SCADA 数据查询 API
│   │   ├── topology_computation.py  # 拓扑计算 API（⚠️ 含裸 except）
│   │   ├── topology_editor.py   # 拓扑编辑 API
│   │   ├── topology_simulation.py   # 拓扑仿真 API
│   │   ├── workflow.py          # 工作流管理 API
│   │   ├── pipeline_packages.py # 管线数据包 API
│   │   └── feishu.py           # 飞书机器人 Webhook API
│   │
│   ├── services/                # 业务逻辑层
│   │   ├── __init__.py
│   │   ├── ai_client.py         # AI 大模型客户端（Gemini / MiniMax）
│   │   ├── ai_analysis_orchestrator.py  # AI 分析编排器
│   │   ├── ai_sim_evaluator.py  # AI 仿真评估器
│   │   ├── assistant_tools.py   # AI 助手工具集
│   │   ├── execution_engine.py  # 工作流执行引擎
│   │   ├── topology.py          # 拓扑数据服务
│   │   ├── topology_computation.py  # 拓扑计算核心算法（⚠️ 含裸 except）
│   │   ├── topology_simulation.py   # 拓扑仿真服务
│   │   ├── topology_correction.py   # 拓扑纠错服务
│   │   ├── pipeline_data_service.py # 管线数据查询服务
│   │   ├── simulation_service.py    # 仿真计算服务
│   │   ├── workflow_service.py      # 工作流业务逻辑
│   │   ├── rag_enhanced.py          # RAG 增强检索服务
│   │   ├── rag_mock.py              # RAG Mock 服务
│   │   ├── feishu_bot.py            # 飞书机器人服务
│   │   ├── junction_groups.py       # 交汇编组管理
│   │   ├── position_commit.py       # 位置提交服务
│   │   ├── fix_task_router.py       # 修复任务路由
│   │   ├── analysis_validator.py    # 分析结果校验器
│   │   ├── raw_excel_ai_index.py    # Excel 原始数据 AI 索引
│   │   ├── raw_excel_ai_direct.py   # Excel 原始数据 AI 直连
│   │   ├── we1_pilot_service.py     # WE1 试点业务服务
│   │   ├── we1_solver_input_service.py      # WE1 求解器输入服务
│   │   ├── we1_steady_validation_service.py # WE1 稳态验证服务
│   │   ├── we1_result_snapshot_service.py   # WE1 结果快照服务
│   │   └── we1_data_alignment_service.py    # WE1 数据对齐服务
│   │
│   └── mcp/                     # MCP (Model Context Protocol) 模块
│       ├── __init__.py
│       ├── server.py            # MCP 服务器实现
│       ├── core.py              # MCP 核心逻辑
│       ├── tools.py             # MCP 工具定义
│       ├── resources.py         # MCP 资源定义
│       └── prompts.py           # MCP 提示词模板
│
├── data/                        # 运行时数据（不应提交）
│   ├── smartgas.db              # SQLite 主数据库（⚠️ 空文件，不应提交）
│   ├── scada_history.db         # SCADA 历史数据库
│   ├── raw_excel_index.db       # Excel 索引数据库
│   ├── chroma_db/               # ChromaDB 向量数据库
│   ├── knowledge_base/          # 知识库文档
│   ├── ai_cache/                # AI 响应缓存
│   ├── ai_traces/               # AI 调用追踪
│   ├── raw_csvs/                # 原始 CSV 数据
│   ├── pilots/                  # 试点项目数据
│   ├── we1_snapshots/           # WE1 快照归档
│   └── *_structure.json         # 管线结构快照
│
├── docs/                        # 后端文档
│   ├── data_import_guide.md     # 数据导入指南
│   ├── AI_OPTIMIZATION_REPORT.md    # AI 优化报告
│   └── ...
│
└── scripts/                     # 数据操作脚本（一次性/运维）
    ├── build_national_network.py    # 构建全国管网
    ├── extract_pipeline.py          # 管线数据提取
    ├── fix_station_coords.py        # 场站坐标修复
    ├── fix_station_coords_v2.py     # 坐标修复 v2
    ├── fix_station_coords_v3.py     # 坐标修复 v3
    ├── rebuild_junctions.py         # 交汇点重建
    ├── migrate_*.py                 # 数据库迁移脚本（多个）
    ├── verify_*.py                  # 数据验证脚本（多个）
    ├── check_*.py                   # 数据检查脚本（多个）
    ├── add_*.py                     # 数据添加脚本（多个）
    ├── test_*.py                    # 测试脚本（多个）
    └── ... (共 90+ 个脚本)
```

### 后端关键文件说明

| 文件 | 职责 |
|------|------|
| `app/main.py` | FastAPI 应用实例，注册所有 Router 和中间件 |
| `app/database.py` | SQLModel 数据库连接池、Session 依赖注入 |
| `app/models.py` | 核心 ORM 模型：Pipeline、Station、Junction、Hub 等 |
| `app/routers/emergency.py` | 应急指挥核心 API，计算影响人口、供气缺口（⚠️ 当前使用模拟数据） |
| `app/services/topology_computation.py` | 管网拓扑图构建、连通性分析、最短路径计算 |
| `app/services/ai_client.py` | 统一封装 Google Gemini / MiniMax API 调用 |
| `app/services/rag_enhanced.py` | 基于 ChromaDB 的 RAG 检索增强生成 |
| `app/mcp/server.py` | MCP 协议服务器，暴露数据库查询和拓扑工具给 AI Agent |

---

## 五、数据流向

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户交互层                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ 地图视图     │  │ 拓扑视图     │  │ AI 助手面板  │              │
│  │ MapView     │  │ TopoViewer  │  │ AiAssistant │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
└─────────┼────────────────┼────────────────┼─────────────────────┘
          │                │                │
          └────────────────┴────────────────┘
                           │
                    ┌──────┴──────┐
                    │  src/services/api.ts
                    │  (前端 API 层)
                    └──────┬──────┘
                           │ HTTP / REST
┌──────────────────────────┼──────────────────────────────────────┐
│                          │                                       │
│  ┌───────────────────────┴───────────────────────┐               │
│  │            FastAPI Routers                     │               │
│  │  emergency / topology / ai_assistant / scada  │               │
│  └───────────────────────┬───────────────────────┘               │
│                          │                                       │
│  ┌───────────────────────┴───────────────────────┐               │
│  │            Services 业务逻辑层                 │               │
│  │  topology_computation / ai_client / rag_...   │               │
│  └───────────────────────┬───────────────────────┘               │
│                          │                                       │
│  ┌──────────┬────────────┼────────────┬──────────┐               │
│  │          │            │            │          │               │
│  ▼          ▼            ▼            ▼          ▼               │
│ SQLite   ChromaDB    高德地图 API   Gemini API   飞书 Webhook   │
│ (主数据)  (向量检索)   (GIS 服务)   (AI 服务)    (消息推送)      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 六、关键配置文件

### 前端配置

| 文件 | 用途 |
|------|------|
| `vite.config.ts` | Vite 构建配置（⚠️ 当前通过 `define` 注入 `GEMINI_API_KEY`，会泄漏到前端） |
| `tsconfig.json` | TypeScript 编译配置（⚠️ 未启用 `"strict": true`） |
| `package.json` | 依赖管理（React 19, Vite 6, Tailwind v4, ECharts, 高德地图） |
| `tailwind.config.js` | Tailwind CSS 自定义配置 |
| `.env.local` | 本地环境变量（高德 Key、API Base URL 等） |

### 后端配置

| 文件 | 用途 |
|------|------|
| `backend/requirements.txt` | Python 依赖（FastAPI, SQLModel, ChromaDB, Google Generative AI） |
| `backend/.env` | 后端环境变量（数据库 URL、AI API Keys、飞书 Token） |
| `backend/app/database.py` | 数据库连接配置（SQLite 默认路径 `./data/smartgas.db`） |

---

## 七、模块依赖关系

```
views/                    # 页面层，组合多个组件
  └─> components/         # 组件层，复用 UI
       └─> hooks/         # 状态与副作用逻辑
       └─> services/      # 远程 API 调用
       └─> utils/         # 纯函数工具
       └─> data/          # 静态数据与类型
       └─> types/         # TypeScript 类型定义

routers/                  # API 路由层，校验输入输出
  └─> services/           # 业务逻辑层，编排数据访问
       └─> models.py      # ORM 模型，定义表结构
       └─> database.py    # 数据库连接与 Session
       └─> mcp/           # MCP 工具暴露给外部 AI Agent
```

---

## 八、已知结构问题

| 问题 | 位置 | 建议 |
|------|------|------|
| 虚拟环境冗余 | 根目录 `.venv/` + `backend/.venv/` | 删除根目录 `.venv`，统一使用 `backend/.venv` |
| 依赖目录被 Git 跟踪 | `node_modules/`、`backend/.venv/` | 执行 `git rm -r --cached` 并确保 `.gitignore` 生效 |
| 脚本目录膨胀 | `backend/scripts/` (90+ 文件) | 一次性脚本迁移至独立仓库或 `tools/` 目录 |
| 根目录杂乱 | 大量 `tmp_*.py`、日志、总结文件 | 建立 `tools/` 和 `logs/` 目录分类存放 |
| 备份目录 | `recovery/` (1,136 文件) | 删除，依赖 Git 进行版本管理 |
| 临时文件 | `.tmp_frames/` | 清空并加入 `.gitignore` |
| 数据库文件提交 | `backend/data/*.db` | 删除并加入 `.gitignore` |
| 缺少容器化 | 无 Dockerfile/docker-compose | 添加容器化配置便于部署 |

---

## 九、快速导航

| 需求 | 入口文件 |
|------|----------|
| 查看前端路由 | `src/App.tsx` |
| 修改地图组件 | `src/components/map-view/MapView.tsx` |
| 修改应急指挥逻辑 | `backend/app/routers/emergency.py` |
| 修改拓扑计算 | `backend/app/services/topology_computation.py` |
| 修改 AI 助手 | `src/components/ai-assistant/AiAssistant.tsx` + `backend/app/routers/ai_assistant.py` |
| 添加新 API 接口 | `backend/app/routers/*.py` → `backend/app/main.py` |
| 修改数据库模型 | `backend/app/models.py` |
| 添加管线数据 | `src/data/pipelines/*.ts` |

---

*文档生成时间：2026-04-30*
*项目版本：基于当前工作目录快照*
