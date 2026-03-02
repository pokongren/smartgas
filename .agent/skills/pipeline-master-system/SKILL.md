---
name: pipeline-master-system
description: 天然气管网全生命周期管理系统，整合数据提取、拓扑分析、坐标映射、可视化渲染的完整工作流，提供一站式管线管理解决方案
---

# 管道全生命周期管理系统 (Pipeline Master System)

这是 SmartGas 系统的**核心处理大脑**，负责将散乱的数据库记录转化为可视化的屏幕资产。它打通了从底层 SQLite 库提取数据，经由清洗与坐标系映射，转化为 React 驱动的可视化呈现模型的完整闭环。

> **设计理念**: 数据(SQLite) → 提取(Python) → 转换(AI/TS) → 渲染(React) → 智能决策(AI/QA) 的完整闭环

## 🚀 AI 代理指令 (执行工作流)

当 USER 要求你“绘制某条新管线”、“提取并展示”、“接入全生命周期管理”时，请**严格遵循**以下《一站式接入清单》执行，每完成一步请在你的思维链及对外输出中明确标记进度。

### 阶段一: 提取层 (Extraction Layer)

原始数据库中，干线和支线数据混在一起，且在关系表中里程字段往往会在支线起点发生重置。

**要求动作**: 
使用后端的提取脚本，从 `smartgas.db` 提取出这根管线的标准层级结构。

- **推荐方案**: 使用 `backend/scripts/batch_extract.py`。
  1. 使用相关搜索工具或查看文件，往 `PIPELINES` 数组中挂载本次需要提取的管线配置。
  2. 运行脚本：
     ```bash
     python backend/scripts/batch_extract.py
     ```
  3. 检查输出目录下是否成功生成了对应的 `xxx_structure.json` 文件（它应该是包含了 `trunk` 和 `branches` 分野的拓扑结构）。

### 阶段二: 转换层 (Transformation Layer) / 数据孪生

你需要将上一步生成的 `xxx_structure.json` 洗练转换为前端可用的 TypeScript 数据模块（通常存放于 `src/data/pipelines/` 目录下）。

**要求动作**:
1. 读取 `xxx_structure.json` 的内容（如果节点很多，可以通过 `jq` 或 Python 辅助分析提取只含有 `compressor` 或 `distribution` 的重要节点）。
2. 利用网络搜索功能 (或已知的先验坐标) 查找该管线上所有**主要站场**的真实经纬度。这是可视化点亮的基础！
3. 创建新的 TypeScript 数据文件（例：`src/data/pipelines/xinqi.ts`）。
   - 文件需要对外暴露出 `allStations` 和 `allPipelines` 两个集合。
   - 依赖 `src/utils/mapRenderer.ts` 里的工厂方法，生成虚拟阀室（默认间距可视情况调整为 30-40 KM）。

*数据代码沙盘模板*:
```typescript
import { generateStations, generatePipelines } from '../utils/mapRenderer';

// 1. 设置核心站场坐标字典
const COORDS: Record<string, { lng: number; lat: number }> = {
    '首站名称': { lng: 116.4, lat: 39.9 },
    // 录入查找到的所有真实坐标...
};

// 2. 拷贝提取到的骨干节点
const TRUNK_NODES = [
    { name: '首站名称', mileage: 0, type: 'compressor' },
    // ...
] as const;

// 3. 经过转换工厂
export const trunkStations = generateStations(TRUNK_NODES, '设定干线名称', 'TRUNK', 40, COORDS);
export const trunkPipelines = generatePipelines(trunkStations, '设定干线名称', 'TRUNK', '#4caf50'); // 配置对应色系

// 4. 对外挂载暴露
export const allStations = [...trunkStations]; // 如果存在支路可使用 spread 重组合并
export const allPipelines = [...trunkPipelines];
```

### 阶段三: 前端渲染视图集成 (Rendering Layer)

转换好了数据，需要呈现在操作员的大屏上。

**要求动作**:
1. **聚合注册**：如果你在 `src/data/pipelines/` 创建了新的管线文件，不要忘记在 `src/data/pipelines/index.ts` 中注册并合并它，这样全局视图 (`GlobalPipelineView`) 才能一并显示。
2. **专属看板**：如果指令倾向于做单管线特写图，可以创建如 `src/views/XxxView.tsx` 并将其挂载到 `src/App.tsx` 的路由以及全局切换悬浮器（`ViewSwitcher`）当中。

---

## 🏗️ 核心算法套件及集成组件特性参考

为了你更好地配合项目特性扩展代码，了解当前系统拥有的前沿技术能力至关重要：

### 1. 智能分层防重叠与蜂群聚合 (Swarm Analysis)
由于管道密集区往往会有上百个虚拟阀室或分输站，在前端 `ClusterDetailPanel.tsx` 与相关 utils 中已经提供了基于缩放因子的聚合与发散策略。当你配置新的管道层展现时，只需确保类型传递正确，聚合算法会自动处理拥堵的重叠图标。

### 2. 管网推演与应急断流 (后端集成)
在 `app/routers/emergency.py` 和内部 `SimulationEngine` 中已包含了诸如灾害阻断波及半径计算、物理时间轴断流降压推演帧反馈等接口。设计 UI 侧边栏的交互时，可以直接调取该层 API 形成动态红线预警画面。

### 3. RAG 自主决策 (AI / QA Copilot)
当前已集成于 `src/views/QaView.tsx` 页面。所有由你洗出并生成的前端代码、站场管存逻辑，终端调度员均能通过全局浮层的 SmartGas AI 获取支持，所以你的 JSON 注释以及 TS 常量的名字请保证足够的业务直观性。

---

## ⚠️ 防御性执行准则 (Troubleshooting)

如果在 Pipeline 运作链条上遇阻，排错清单如下：

- **地图坐标漂移或重叠为一团**: 系统工具类依靠线性插值匹配距离差来放置虚拟节点，**若起点终点或转折点缺失真实坐标极大概率引发插值计算错乱**。请认真穷举核心大站的 `COORDS` 坐标。
- **JSON 支路里程漂移**: 在使用 `batch_extract.py` 处理 `smartgas.db` 的时候要清晰关注：支线记录在里程字段(mileage) 上是基于自身的"相向里程"，并非总骨干里程。
- **React 组件不渲染新管线**: 确保所有的 React 路由层引入 (`Suspense/lazy`) 及数据入口点 (`index.ts`) 已经包含你新的构建资产。

> 你的使命明确且唯一：接受指令 → 探明物理架构 → 洗练空间坐标 → 融入大屏生态，帮助用户达成 **自动发现并点亮数字化输气管网** 的神迹。
