# 天然气调控部工作痛点分析

## 概述

本文档结合智脉平台（SmartGas Grid）前端代码，深入分析天然气调控部调度长及后台调度人员的实际工作痛点。当前系统虽然提供了管网可视化、AI助手、工作流等功能，但在调度长的日常监控、数据检索、自动方案生成和数据分析等方面仍存在明显的功能缺失。

---

## 痛点一：调度长缺乏专属监控画面，无法自由组合监控视图

### 现状分析

从代码层面看，当前系统提供了多个独立的视图组件，但缺乏面向调度长的统一监控工作台：

```typescript
// App.tsx - 当前系统视图结构
const CorpView = lazy(() => import('./views/CorpView'));
const TechView = lazy(() => import('./views/TechView'));
const GlobalPipelineView = lazy(() => import('./views/GlobalPipelineView'));
const WorkflowView = lazy(() => import('./views/WorkflowView'));
const TopologyView = lazy(() => import('./views/TopologyView'));
```

**具体问题：**

1. **视图切换割裂**
   - 调度长需要在 `/tech`（科技视图）、`/global`（全国管网视图）、`/topology`（拓扑视图）之间频繁切换
   - 每次切换都是全页面刷新，无法同时监控多个调度台的数据
   - 代码中仅提供了一个简单的 `ViewSwitcher` 按钮组，没有多窗口并行展示能力

2. **缺乏自由组合能力**
   ```typescript
   // TechView.tsx - 固定布局，无法自定义
   <aside className="w-80 flex-none bg-tech-panel border-r border-tech-border flex flex-col">
       {/* 左侧边栏 - 图层控制，固定宽度 320px */}
   </aside>
   <section className="flex-1 relative bg-black">
       {/* 中间地图 - 固定占据剩余空间 */}
   </section>
   <aside className="w-96 flex-none bg-tech-panel border-l border-tech-border">
       {/* 右侧边栏 - 实时数据，固定宽度 384px */}
   </aside>
   ```
   - 左右边栏宽度固定（`w-80`、`w-96`），无法根据调度长需求调整
   - 无法拖拽重组面板位置，无法保存个性化布局
   - 后台调度负责2-3个调度台时，无法在一个画面中同时展示多个调度台数据

3. **缺少调度长驾驶舱（Dashboard）**
   - 现有视图都是面向操作员的详细视图，没有面向调度长的概览视图
   - 缺乏关键指标（KPI）聚合展示：全系统健康度、各调度台负荷、异常汇总等
   - `CorpView.tsx` 虽然有概览标签页，但只是静态展示，无法自定义指标

### 业务影响

- **监控盲区**：调度长无法同时关注多个调度台，容易遗漏关键异常
- **响应延迟**：频繁切换视图导致异常发现和处理时间延长
- **工作负担**：后台调度需要记忆多个调度台的状态， cognitive load 过高

### 改进建议

1. **开发调度长驾驶舱（DispatchCommandCenter）**
   - 支持多窗口网格布局（2x2、3x3等）
   - 每个窗口可独立选择数据源（调度台A、调度台B、全网概览等）
   - 支持布局保存和快速切换

2. **实现可拖拽的模块化面板系统**
   ```typescript
   // 建议架构
   interface DashboardPanel {
       id: string;
       type: 'map' | 'scada' | 'topology' | 'alarm' | 'chart';
       dataSource: string; // 关联的调度台ID
       position: { x: number; y: number; w: number; h: number };
   }
   ```

---

## 痛点二：数据检索功能不完善

### 现状分析

当前系统的搜索功能非常基础，无法满足调度员快速定位信息的需求：

```typescript
// TechView.tsx - 当前搜索实现
<div className="hidden md:flex ml-8 relative group">
    <input
        className="block w-80 bg-[#111418] border border-tech-border text-slate-200 text-sm rounded-lg focus:ring-tech-primary focus:border-tech-primary pl-10 p-2.5 placeholder-slate-500 transition-all focus:w-96"
        placeholder="搜索管段、站场ID或区域"
        type="text"
    />
</div>
```

**具体问题：**

1. **搜索功能仅为UI占位符**
   - 输入框没有绑定任何搜索逻辑，只是视觉元素
   - 没有搜索建议、历史记录、模糊匹配等功能
   - 不支持多维度联合搜索（如：按区域+按站场类型+按运行状态）

2. **AI助手检索能力有限**
   ```typescript
   // AiAssistant.tsx - 工具调用列表
   const TOOL_LABELS: Record<string, string> = {
       query_stations: '查询站场',
       query_pipelines: '查询管线',
       count_by_type: '统计数量',
       analyze_impact: '影响分析',
       find_routes: '路径搜索',
       get_topology_summary: '拓扑概览',
       simulate_failure: '断流推演',
   };
   ```
   - AI助手仅支持7个固定查询工具，覆盖场景有限
   - 不支持复杂条件组合查询（如：查找近24小时内压力波动超过10%的站场）
   - 检索结果无法导出或进一步分析

3. **缺乏高级检索功能**
   - 无时间范围筛选（历史数据回溯）
   - 无数值范围筛选（压力、流量区间）
   - 无地理空间检索（半径内站场、沿线管段）
   - 无保存搜索条件功能

4. **数据孤岛问题**
   ```typescript
   // api.ts - 各API独立，无统一检索接口
   export const stationAPI = {
       getAll: () => api.get('/api/stations'),
       getById: (id: string) => api.get(`/api/stations/${id}`),
   }
   export const pipelineAPI = {
       getAll: () => api.get('/api/pipelines'),
       getById: (id: string) => api.get(`/api/pipelines/${id}`),
   }
   ```
   - 站场、管线、设备数据分散在不同API
   - 无法一站式检索所有相关数据

### 业务影响

- **信息获取效率低**：调度员需要多次查询才能获取完整信息
- **应急响应慢**：紧急情况下无法快速定位受影响设备和区域
- **数据利用率低**：大量历史数据无法被有效检索和利用

### 改进建议

1. **开发统一检索中心（SearchHub）**
   - 支持全文检索、结构化检索、语义检索
   - 提供搜索建议、自动补全、搜索历史
   - 支持复杂查询语句（类SQL或自然语言）

2. **增强AI助手检索能力**
   - 增加时间序列查询工具
   - 支持多条件组合查询
   - 支持检索结果的可视化展示

---

## 痛点三：缺乏自动方案生成功能

### 现状分析

当前系统虽然提供了AI工作流功能，但缺乏针对调度场景的自动方案生成能力：

```typescript
// WorkflowEditor.tsx - 当前工作流为通用AI流程
const createEmptyStep = (order: number): Omit<WorkflowStep, 'id' | 'workflow_id'> => ({
    step_order: order,
    name: `步骤 ${order + 1}`,
    prompt_template: '',  // 需要用户手动编写提示词
    model: '',
    temperature: 0.7,
    max_tokens: 2000,
});
```

**具体问题：**

1. **工作流为通用AI工具，非专业调度方案**
   - 当前工作流是通用的AI Pipeline，需要用户自己编写提示词模板
   - 缺乏针对天然气调度场景的预设方案模板：
     - 故障应急处置方案
     - 气量调配优化方案
     - 检修计划协调方案
     - 保供方案生成

2. **缺乏规则引擎支持**
   ```typescript
   // workflow-api.ts - 仅支持AI模型调用，无规则引擎
   execute: async (id: string, inputText: string, onEvent: (event: ExecutionEvent) => void): Promise<void> => {
       const response = await fetch(`${API_BASE}/${id}/execute`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ input_text: inputText }),
       });
       // 仅返回AI生成结果，无业务规则校验
   }
   ```
   - 方案生成仅依赖AI模型，缺乏业务规则约束
   - 无法根据管网拓扑、设备状态、运行规程自动生成合规方案

3. **缺乏方案评估和优化**
   - 生成的方案没有仿真验证环节
   - 无法对比多个方案的优劣
   - 缺乏方案执行的跟踪和反馈机制

4. **缺乏预案库管理**
   - 没有历史方案的存储和复用机制
   - 无法基于相似场景推荐历史方案
   - 缺乏方案的版本管理和审批流程

### 业务影响

- **决策效率低**：调度员需要手动分析情况、制定方案，耗时较长
- **方案质量不稳定**：依赖个人经验，缺乏标准化和优化
- **应急响应能力不足**：紧急情况下无法快速生成可行方案

### 改进建议

1. **开发调度方案生成引擎（DispatchPlanEngine）**
   ```typescript
   interface PlanTemplate {
       id: string;
       name: string; // 如："压气站故障处置方案"
       triggerConditions: Condition[];
       generationRules: Rule[];
       validationConstraints: Constraint[];
   }
   ```

2. **集成管网仿真能力**
   - 方案生成后自动进行水力计算验证
   - 预测方案执行后的系统状态变化
   - 提供多方案对比分析

3. **建立预案知识库**
   - 存储历史处置方案
   - 支持基于案例的推理（CBR）
   - 方案效果评估和持续优化

---

## 痛点四：缺乏数据分析功能

### 现状分析

当前系统的数据展示以实时监控为主，缺乏深度的数据分析能力：

```typescript
// TechView.tsx - 仅展示实时数据，无分析功能
<div className="space-y-3">
    <div className="flex items-center justify-between">
        <h4 className="text-sm text-white font-medium">消耗趋势 (24h)</h4>
        <span className="text-xs text-slate-400">平均: 41k m³</span>
    </div>
    <div className="h-32 w-full bg-[#111418] rounded-lg border border-tech-border p-4">
        {/* 静态SVG图表，无交互和分析功能 */}
        <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 300 100">
            <path d="M0,80 L30,70..." fill="url(#chartGradient)"></path>
        </svg>
    </div>
</div>
```

**具体问题：**

1. **仅有数据展示，无分析功能**
   - 图表为静态SVG，无下钻、筛选、对比功能
   - 只有24小时趋势，缺乏日、周、月、年多时间维度分析
   - 无异常检测、趋势预测等智能分析

2. **缺乏多维度数据关联分析**
   ```typescript
   // GlobalPipelineView.tsx - SCADA数据仅展示，无分析
   const REAL_SCADA_DATA: Record<string, { inP: number, outP: number, inT?: number, outT?: number }> = {
       '中卫压气站': { inP: 6.391, outP: 7.856, inT: 7.7, outT: 30.8 },
       // ... 仅展示原始数据
   }
   ```
   - 压力、温度、流量数据独立展示，无关联分析
   - 无法分析站场间的相互影响关系
   - 缺乏能效分析、瓶颈识别等高级功能

3. **缺乏报表和数据导出功能**
   - `CorpView.tsx` 中有"生成报表"按钮，但仅为UI占位符
   - 无法自定义报表模板
   - 不支持定时报表生成和自动推送

4. **AI助手分析能力有限**
   ```typescript
   // AiAssistant.tsx - 工具调用以查询为主
   const TOOL_LABELS: Record<string, string> = {
       query_stations: '查询站场',
       query_pipelines: '查询管线',
       count_by_type: '统计数量',
       analyze_impact: '影响分析',  // 唯一分析类工具
       // ... 缺乏趋势分析、对比分析、预测分析等
   };
   ```
   - AI助手主要提供查询功能，分析功能单一
   - 无法进行自然语言驱动的数据分析（如："对比本月和上月各站场能耗"）

5. **缺乏数据质量监控**
   - 无数据完整性检查
   - 无异常值识别和处理
   - 无数据质量报告

### 业务影响

- **决策依据不足**：缺乏数据支撑，决策依赖经验判断
- **问题发现滞后**：无法通过数据分析提前发现潜在问题
- **优化方向不明**：缺乏系统性能分析和优化建议

### 改进建议

1. **开发数据分析中心（AnalyticsCenter）**
   - 提供多维度数据透视分析
   - 支持自定义分析模型和指标
   - 集成机器学习模型进行异常检测和预测

2. **增强AI数据分析能力**
   - 支持自然语言数据分析查询
   - 自动生成数据洞察报告
   - 支持"假设分析"（What-if Analysis）

3. **建立报表中心（ReportCenter）**
   - 提供丰富的报表模板
   - 支持自定义报表设计
   - 定时生成和自动推送

---

## 总结

### 痛点优先级排序

| 优先级 | 痛点 | 业务影响 | 技术实现难度 |
|--------|------|----------|--------------|
| P0 | 缺乏调度长专属画面 | 监控盲区、响应延迟 | 中 |
| P1 | 数据检索功能不完善 | 信息获取效率低 | 低 |
| P1 | 缺乏自动方案功能 | 决策效率低 | 高 |
| P2 | 缺乏数据分析功能 | 决策依据不足 | 中 |

### 建议实施路径

**第一阶段（1-2个月）**：
- 开发调度长驾驶舱基础版，支持多窗口布局
- 完善搜索功能，实现站场、管线的快速检索

**第二阶段（3-4个月）**：
- 建立预案库，开发方案生成模板
- 增强数据分析功能，提供基础报表

**第三阶段（5-6个月）**：
- 集成管网仿真，实现方案自动验证
- 开发高级分析功能，支持预测和优化

---

*文档版本：v1.0*  
*更新日期：2026-03-11*  
*作者：基于智脉平台代码分析*
