# SmartGas Grid —— 这项目到底长啥样？（说人话版）

> 如果你刚接手这个项目，或者三天后忘了它怎么组织的，看这篇就够了。
> 不用背，混个眼熟就行。

---

## 一句话概括

这是一个**智慧燃气管网的应急指挥平台**。简单说就是：
- **前端**：一张大地图 + 一堆数据图表 + 一个 AI 聊天框
- **后端**：管数据库、算拓扑、调 AI 接口、给飞书发消息

---

## 项目根目录 —— 像个刚搬完家的客厅

打开 `F:\smartgas-grid`，你会看到一片狼藉。东西是有的，但堆得有点随意：

```
smartgas-grid/
├── src/                ← 前端代码，正经东西
├── backend/            ← 后端代码，也是正经东西
├── backend/scripts/    ← 一大堆一次性脚本（像用完没扔的快递盒）
├── docs/               ← 几百篇开发记录和总结（项目日记本）
├── recovery/           ← 代码备份（Git：你礼貌吗？）
├── dist/               ← 前端打包出来的东西
├── node_modules/       ← 前端依赖（不应该出现在 Git 里！！）
├── .venv/              ← Python 虚拟环境（根目录有一份，backend里还有一份，很迷）
├── .tmp_frames/        ← 运行时截图垃圾（像浏览器缓存图片）
└── [散落一地的临时文件]  ← tmp_xxx.py、analyze_xxx.py、各种.log、各种.md
```

### 根目录吐槽时间

| 看到的东西 | 我的评价 |
|-----------|---------|
| `tmp_*.py` 一堆 | 临时脚本跑完就扔啊，留着过年？ |
| `tsc_errors.txt` 有 1GB | TypeScript 报错日志比电影还大，震撼 |
| `analyze_aqi.py` 等分析脚本 | 跟燃气管网有啥关系？像走错片场的 |
| `recovery/` 目录 | Git 就是用来干这个的，手动备份 1136 个文件是图啥 |
| `.venv` 两套 | 一套就够，两套除了占磁盘没别的用 |

**建议**：找个时间把根目录收拾一下，临时文件该删删，该归类归类。

---

## 前端 (`src/`) —— 用户看到的长这样

前端用 **React + TypeScript + Vite** 写的，你可以理解为：现代、有类型检查、打包快。

### 文件们都在干嘛？

```
src/
├── App.tsx              ← 老大，管路由和页面布局
├── main.tsx             ← 程序入口，把 React 挂到网页上
│
├── components/          ← 各种 UI 零件（像乐高积木）
│   ├── ai-assistant/    ← 右下角的 AI 聊天框
│   ├── map-view/        ← 高德地图（API Key 直接写死在代码里了！）
│   ├── scada/           ← 历史数据曲线图（压力、流量什么的）
│   ├── topology/        ← 管网拓扑图（管子连来连去那种）
│   ├── workflow/        ← 工作流：画图 → 执行 → 看结果
│   └── EmergencyPanel.tsx  ← 应急指挥面板（出事了这个红）
│
├── views/               ← 完整页面（把上面的积木拼起来）
│   ├── GlobalPipelineView.tsx   ← 全局管网总览
│   ├── MapTopologyView.tsx      ← 地图+拓扑联动（最复杂的页面之一）
│   ├── TopologyView.tsx         ← 纯拓扑视图
│   └── ...
│
├── data/                ← 静态数据（管网结构写死在代码里的部分）
│   └── pipelines/       ← 各条管线的数据：西一线、西二线、中贵线、中缅线...
│
├── services/            ← 和后端打电话的模块（发请求、拿数据）
│   ├── api.ts           ← 主要接口都在这里
│   └── apiBase.ts       ← Axios 配置（请求超时、错误处理之类）
│
├── hooks/               ← React 的自定义钩子（复用逻辑）
│   ├── useSimulation.ts ← 仿真状态管理
│   └── useTopology.ts   ← 拓扑数据管理
│
├── types/               ← TypeScript 类型定义（告诉编译器这是啥）
├── utils/               ← 工具函数（数学计算、坐标转换、数据校验）
└── styles/              ← CSS 样式文件
```

### 前端重点页面速记

| 页面 | 干啥的 | 对应文件 |
|------|--------|---------|
| 大地图 | 看场站在哪、管线怎么走 | `components/map-view/MapView.tsx` |
| 拓扑图 | 管子连来连去的逻辑关系 | `views/MapTopologyView.tsx` |
| AI 助手 | 跟 AI 问问题、查数据 | `components/ai-assistant/AiAssistant.tsx` |
| 应急指挥 | 模拟爆管、算影响范围 | `components/EmergencyPanel.tsx` |
| 工作流 | 拖拽节点、自动执行 | `components/workflow/` |

### 前端已知坑

1. **高德地图 Key 裸奔**：`MapView.tsx` 第 292 行，Key 和密码直接写在代码里，谁都能抄走刷你的额度
2. **Gemini API Key 被打包进前端**：`vite.config.ts` 把密钥塞进了前端代码，打开浏览器 F12 就能看到
3. **TypeScript 不严格**：`tsconfig.json` 没开严格模式，编译器对你很宽容，但运行时可能炸

---

## 后端 (`backend/`) —— 幕后打工人

后端用 **Python + FastAPI**，数据库是 **SQLite**，向量库用 **ChromaDB**（给 AI 查资料用的）。

### 后端文件组织

```
backend/
├── main.py              ← 启动入口，跑起来就听 HTTP 请求
├── requirements.txt     ← Python 包装了哪些依赖
├── .env                 ← 密钥、数据库地址（这个别提交到 Git！）
├── .venv/               ← Python 虚拟环境（只留这一个就够了）
│
├── app/                 ← 核心代码（正经业务都在这里）
│   ├── main.py          ← FastAPI 本体，注册所有接口
│   ├── database.py      ← 连数据库的
│   ├── models.py        ← 数据库表长什么样（场站、管线、交汇点...）
│   ├── schemas.py       ← 接口的入参和出参格式
│   │
│   ├── routers/         ← API 接口（URL 路由）
│   │   ├── basic.py     ← 健康检查（"还活着吗？""活着。"）
│   │   ├── emergency.py ← 应急指挥（影响人口是瞎算的：场站数x50万）
│   │   ├── ai_assistant.py  ← AI 聊天接口
│   │   ├── scada.py     ← SCADA 历史数据查询
│   │   ├── topology_computation.py  ← 拓扑计算（管子连没连通）
│   │   ├── topology_editor.py       ← 拓扑编辑（改管子连接关系）
│   │   ├── workflow.py              ← 工作流增删改查
│   │   └── feishu.py                ← 飞书机器人（推消息到群）
│   │
│   ├── services/        ← 真正的业务逻辑（路由只是门面，这里才是厨房）
│   │   ├── topology_computation.py  ← 算拓扑的核心算法
│   │   ├── ai_client.py             ← 调 Gemini / MiniMax 的大模型客户端
│   │   ├── rag_enhanced.py          ← RAG（AI 查资料回答问题）
│   │   ├── simulation_service.py    ← 管网仿真计算
│   │   ├── workflow_service.py      ← 工作流执行逻辑
│   │   ├── feishu_bot.py            ← 飞书消息推送
│   │   └── we1_*.py                 ← 一堆 WE1（西一线）专项服务
│   │
│   └── mcp/             ← MCP 协议模块（让外部 AI Agent 能查你的数据库）
│       ├── server.py    ← MCP 服务器
│       ├── tools.py     ← 暴露给 AI 的工具（比如"查某条管线的压力"）
│       └── prompts.py   ← 给 AI 的系统提示词
│
├── data/                ← 数据库文件和运行时数据
│   ├── smartgas.db      ← 主数据库（空的，不该提交）
│   ├── scada_history.db ← SCADA 历史数据
│   ├── chroma_db/       ← AI 向量数据库（存文档、知识库）
│   └── ...              ← 各种 JSON 快照、缓存、CSV
│
└── scripts/             ← 脚本大杂烩（90+ 个文件）
    ├── build_national_network.py    ← 构建全国管网
    ├── extract_pipeline.py          ← 从 Excel/CSV 提数据
    ├── fix_station_coords_v*.py     ← 修坐标（修了三版还没修完？）
    ├── migrate_*.py                 ← 数据库迁移（多个版本）
    ├── verify_*.py                  ← 数据验证（各种验证）
    └── ...                          ← 还有很多，一次性脚本居多
```

### 后端速查表

| 想看什么 | 去哪找 |
|---------|--------|
| 数据库表定义 | `app/models.py` |
| 新加 API 接口 | `app/routers/` 里加，然后去 `app/main.py` 注册 |
| AI 怎么调的大模型 | `app/services/ai_client.py` |
| 拓扑连通性怎么算的 | `app/services/topology_computation.py` |
| 应急指挥的影响人口怎么来的 | `app/routers/emergency.py` 第 76 行 FIXME（现在是瞎算的） |
| 飞书消息怎么发的 | `app/services/feishu_bot.py` |
| AI 怎么查文档回答问题的 | `app/services/rag_enhanced.py` |

### 后端已知坑

1. **except: 裸捕获**：很多地方写 `except:`，不管什么错都吞掉，包括你按 Ctrl+C 想终止程序都可能被拦截
2. **应急数据是模拟的**：`emergency.py` 里影响人口 = 受影响场站数 x 50 万，工业用户数也是拍脑袋的，生产环境用这玩意就完了
3. **scripts/ 太膨胀**：90 多个脚本跟主代码混在一起，很多是一次性的，跑完就没用了

---

## 数据怎么流动的？（白话版）

你在网页上点了一下"查看西一线拓扑"
        ↓
前端：services/api.ts 给后端发请求："喂，西一线的拓扑数据"
        ↓
后端：routers/topology_computation.py 接到电话
        ↓
后端：services/topology_computation.py 开始算（从数据库拿管子、场站，算连通性）
        ↓
后端：算好了，JSON 打包发回去
        ↓
前端：utils/topology-validator.ts 检查一下数据有没有问题
        ↓
前端：components/topology/TopoViewer.tsx 画出来给你看

如果是 AI 功能：

你在 AI 聊天框问："西一线最近压力正常吗？"
        ↓
前端：发给 routers/ai_assistant.py
        ↓
后端：services/ai_client.py 调 Gemini/MiniMax
        ↓
AI 说："让我查查数据库"
        ↓
后端通过 MCP 协议，把数据库查询工具暴露给 AI
        ↓
AI 查到数据，组织语言，返回结果
        ↓
前端：显示在聊天窗口

---

## 配置文件——这些文件管着项目的"脾气"

### 前端配置

| 文件 | 管什么 | 现在啥情况 |
|------|--------|-----------|
| vite.config.ts | 怎么打包前端 | 把 GEMINI_API_KEY 塞进去了，密钥会泄漏 |
| tsconfig.json | TypeScript 规则 | 没开严格模式，代码很"松散" |
| package.json | 装什么依赖 | React 19、Vite 6、Tailwind v4，挺新的 |
| .env.local | 本地密钥 | 高德 Key、API 地址，这个文件别提交到 Git |

### 后端配置

| 文件 | 管什么 | 现在啥情况 |
|------|--------|-----------|
| requirements.txt | Python 包装什么 | 版本约束很松（>=），不同环境可能装到不一样的版本 |
| backend/.env | 数据库地址、AI Key、飞书 Token | 绝对不能提交到 Git |
| app/database.py | 连哪个数据库 | 默认 SQLite，文件在 data/smartgas.db |

---

## 项目的优点和槽点

### 做得不错的地方

- **前后端分离清晰**：前端管展示，后端管数据，职责分得开
- **模块划分合理**：按业务域分 routers、services，找东西不算太难
- **AI 集成度深**：不只是聊天，还能查数据库、调工具、走工作流
- **数据层有规划**：每条管线（WE1/WE2/ZG/SJ4 等）都有独立的数据模块

### 急需收拾的地方

| 优先级 | 问题 | 影响 |
|--------|------|------|
| 🔴 马上 | node_modules 和 .venv 在 Git 里 | 仓库巨大，克隆慢死 |
| 🔴 马上 | API Key 硬编码在前端 | 谁都能偷走刷你的额度 |
| 🟡 本周 | 根目录像垃圾堆 | 找东西费劲，看着糟心 |
| 🟡 本周 | 应急指挥用假数据 | 真出事这数据会误导决策 |
| 🟢 本月 | scripts/ 90+ 个文件 | 跟核心代码混在一起，越来越乱 |
| 🟢 本月 | 没 Dockerfile | 部署全靠手动，很原始 |

---

## 新人上手速查

"我要改 XXX，该去哪找？"

| 我要... | 去看这个文件 |
|---------|-------------|
| 加一个新页面 | src/App.tsx 加路由 → src/views/ 写页面 |
| 改地图上的标记样式 | src/components/map-view/MapView.tsx |
| 改 AI 聊天的界面 | src/components/ai-assistant/AiAssistant.tsx |
| 加一个新的 API 接口 | backend/app/routers/ 新建或修改 → backend/app/main.py 注册 |
| 改数据库表结构 | backend/app/models.py |
| 改拓扑计算逻辑 | backend/app/services/topology_computation.py |
| 加一条新管线的数据 | src/data/pipelines/ 下新建文件 → src/data/index.ts 导出 |
| 调 AI 的提示词 | backend/app/mcp/prompts.py 或 backend/app/services/ai_client.py |
| 发飞书消息 | backend/app/services/feishu_bot.py |

---

## 最后一句

这个项目**业务上挺复杂的**（涉及 GIS、管网拓扑、流体力学仿真、AI Agent），但**代码组织上还能救**。先把根目录收拾干净、密钥从代码里抠出来、Git 里的依赖目录清掉，后面的活就好干多了。

有问题直接问，别硬啃代码。祝你好运
