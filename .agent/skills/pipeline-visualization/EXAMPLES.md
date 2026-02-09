# 使用 Pipeline Visualization Generator Skill 的快速示例

## 示例:为西气东输一线创建可视化

### 1. 告诉 AI 使用 skill

```
请使用 Pipeline Visualization Generator skill 为西气东输一线创建可视化
```

### 2. AI 会自动执行以下步骤:

1. **提取数据库节点**
   - 查询 `node_relation_details` 表
   - 提取所有压气站、分输站和阀室

2. **搜索坐标**
   - 为每个压气站搜索百度地图坐标
   - 为主要分输站搜索坐标

3. **生成数据文件**
   - 创建 `src/data/line1Data.ts`
   - 包含所有设施和自动生成的阀室

4. **创建视图组件**
   - 创建 `src/views/Line1View.tsx`
   - 配置地图显示

5. **更新路由和颜色**
   - 在 `App.tsx` 添加路由
   - 在 `mapRenderer.ts` 添加颜色

## 其他管线示例

### 西气东输三线
```
使用 Pipeline Visualization Generator skill 为西气东输三线创建可视化,
使用紫色作为管线颜色
```

### 中缅线
```
使用 Pipeline Visualization Generator skill 为中缅线创建可视化,
使用红色作为管线颜色
```

## 自定义参数

### 调整阀室密度
```
使用 Pipeline Visualization Generator skill 为XX管线创建可视化,
阀室密度设置为每50km一个
```

### 指定管径
```
使用 Pipeline Visualization Generator skill 为XX管线创建可视化,
管径为1016mm
```

## Skill 文件位置

`f:\smartgas-grid\.agent\skills\pipeline-visualization\SKILL.md`
