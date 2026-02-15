---
name: 管道全生命周期管理系统 (Pipeline Master System)
description: 集成管道拓扑提取、可视化生成与智能分层渲染的一站式解决方案，用于处理复杂管线交叉、共享站点及前端可视化。
---

# 管道全生命周期管理系统 (Pipeline Master System)

本 Skill 是 `pipeline-extraction` (拓扑提取)、`pipeline-visualization` (可视化生成) 和 `pipeline-crossing-solution` (智能分层渲染) 的终极融合版本。它提供了一套完整的端到端工作流，用于从零构建一个新的管道可视化系统，并完美解决复杂交叉点的渲染问题。

## 核心架构

系统分为三个核心阶段：

1.  **数据提取层 (Extraction)**: 从数据库智能提取拓扑结构，自动分离干线与支线。
2.  **数据转换层 (Transformation)**: 将提取的拓扑数据映射到地理坐标，生成前端所需的 TypeScript 数据文件。
3.  **智能渲染层 (Smart Rendering)**: 在前端应用分层聚合算法，解决同坐标站点（合建站、交叉点）的重叠问题，并支持螺旋展开交互。

---

## 阶段一：数据提取 (Extraction)

**目标**: 解决原始数据库中干线与支线混杂、里程重置等问题，生成结构化的 JSON 拓扑数据。

**核心逻辑**:
-   **干支线识别**: 基于 `branch_name` 字段。
    -   包含 "干线" -> **干线**
    -   其他 -> **支线**
-   **自动分组**: 支线按名称自动归类。

> [!CAUTION]
> **干线节点排序陷阱**: 提取出的 `trunk` 数组中，不同段（如新疆段、甘肃段、中卫-吉安段）的节点可能**交错排列**，而非按地理顺序排列。例如 "中卫-吉安段" 的 `黄州分输站`（mileage: 0.0）可能出现在数组起始位置，插到了新疆段节点之间。
> **这会导致后续坐标插值时出现跨越数千公里的错误连线（如霍尔果斯直连黄冈）。**
> 必须在阶段二进行排序预处理。

**操作步骤**:

1.  **执行提取命令**:
    ```bash
    python backend/scripts/extract_trunk_and_branches.py "管线名称" --out "backend/data/pipeline_structure.json"
    ```

2.  **验证输出**: 检查生成的 JSON 结构包含 `trunk`、`branches`、`branch_names` 字段。
3.  **检查干线段名**: 确认 `trunk` 中所有 `branch_name` 的取值，记录段名列表及其地理顺序。

---

## 阶段二：数据转换 (Transformation)

**目标**: 将结构化 JSON 转换为前端可用的 `src/data/{Pipeline}Data.ts` 文件，并补全坐标。

**操作步骤**:

1.  **⚠️ 干线节点排序（必做）**: 在调用 `generateLayerData()` 之前，**必须**对干线节点进行排序预处理：
    -   定义段序数组，按地理方向排列（如西→东：`['新疆段', '甘肃段', '中卫-吉安段', '吉安-广州段']`）
    -   按 `段序 + mileage` 双重排序
    -   参考实现：
    ```typescript
    const TRUNK_SEGMENT_ORDER = ['XX干线新疆段', 'XX干线甘肃段', ...]
    function sortTrunkNodes(nodes: RawNode[]): RawNode[] {
        return [...nodes].sort((a, b) => {
            const orderA = TRUNK_SEGMENT_ORDER.indexOf(a.branch_name)
            const orderB = TRUNK_SEGMENT_ORDER.indexOf(b.branch_name)
            if (orderA !== orderB) return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB)
            return a.mileage - b.mileage
        })
    }
    ```
2.  **收集坐标**: 为主要场站（压气站、分输站）查找经纬度。
3.  **生成数据文件**: 创建 `src/data/pipelines/myPipeline.ts`，使用真实坐标 + 阀室线性插值。
4.  **配置颜色**: 干线深色，支线浅色。干线 3px，支线 2px。

---

## 阶段三：智能渲染 (Smart Rendering)

**目标**: 解决多条管线在同一坐标（合建站）产生的视觉重叠问题。

**核心算法 (Smart Layered Clustering)**:
1.  **高精度聚合**: 基于 6 位小数坐标自动分组。
2.  **分层策略**: Zoom < 12 显示聚合标记, Zoom >= 12 螺旋展开。
3.  **交互增强**: 点击聚合点弹出 `ClusterDetailPanel`。

---

## 完整工作流清单

1.  [ ] 运行 `extract_trunk_and_branches.py` 获取管线结构
2.  [ ] 检查干线 `trunk` 中的 `branch_name` 段名，记录地理顺序
3.  [ ] **排序预处理**：按段序 + 里程排序干线节点（防止跨段节点错位）
4.  [ ] 创建 `.ts` 数据文件，录入关键点坐标
5.  [ ] 在 `mapRenderer.ts` 中注册管线颜色
6.  [ ] 创建视图组件，集成 `MapView` 和 `ClusterDetailPanel`
7.  [ ] 验证交叉点与合建站聚合渲染
8.  [ ] **验证连线连续性**：确认干线从起点到终点无跳跃连线
