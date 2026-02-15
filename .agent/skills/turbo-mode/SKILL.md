---
name: turbo-mode
description: SmartGas 全自动加速模式。整合所有操作能力（服务管理、管线绘制、数据查询、Git、构建），所有终端命令自动执行，文件自动修改，无需用户确认。输入指令即出成果。
---

# ⚡ SmartGas 全自动加速模式 (Turbo Mode)

> **核心原则**: 用户说什么就做什么，不问不等不停。所有终端命令设置 `SafeToAutoRun: true`，文件直接创建/修改，全流程一气呵成。

## 自动化规则

1. **终端命令**: 全部 `SafeToAutoRun: true`，不等用户确认
2. **文件操作**: 直接创建、修改、覆盖，不问"是否确认"
3. **研究调查**: 直接查文件、查数据库、搜索代码，不等指示
4. **多步任务**: 自动推进每一步，在最终结果处汇报
5. **错误处理**: 遇到错误自动尝试修复，修不了再报告

---

## 🔧 操作能力一览

### 一、服务管理

#### 启动全部服务
```bash
# 后端
cd f:\smartgas-grid\backend && python run.py
# 前端
cd f:\smartgas-grid && npm run dev
```

#### 停止全部服务
```bash
taskkill /F /IM node.exe 2>$null
taskkill /F /IM python.exe 2>$null
```

#### 查看运行状态
```bash
netstat -ano | findstr ":3000 :8000"
```

---

### 二、管线绘制（全流程自动化）

当用户说"画XX线"或"绘制XX管线"时，自动执行以下全部步骤：

#### Step 1: 提取拓扑数据
```bash
cd f:\smartgas-grid && python backend/scripts/extract_pipeline.py "管线名称"
```
- 自动从 `backend/data/smartgas.db` 提取
- 输出到 `backend/data/{pipeline}_structure.json`

#### Step 2: 查找站场坐标
- 使用 `search_web` 搜索每个压气站、分输站的经纬度
- 搜索关键词: "{站名} 经纬度" 或 "{站名所在城市} 天然气 坐标"
- 自动录入 COORDS 对象

#### Step 3: 生成 TypeScript 数据文件
- 创建 `src/data/pipelines/{pipelineId}.ts`
- 包含: COORDS + TRUNK_NODES + BRANCH_X_NODES
- 使用 `generateStations` / `generatePipelines` 工具函数
- 在 `src/data/pipelines/index.ts` 注册导出

#### Step 4: 创建视图组件
- 创建 `src/views/{Pipeline}View.tsx`
- 导入数据文件，配置地图中心点和缩放级别
- 参考 `src/views/GlobalPipelineView.tsx` 的模式

#### Step 5: 集成到系统
- 在 `src/App.tsx` 添加路由
- 配置管线颜色映射

#### Step 6: 验证
```bash
cd f:\smartgas-grid && npm run dev
```
- 启动服务并确认无编译错误

**现有管线数据文件参考**:
| 管线 | 数据文件 | 视图 |
|-----|---------|------|
| 西一线 | `src/data/pipelines/we1.ts` | `GlobalPipelineView.tsx` |
| 西二线 | `src/data/pipelines/we2.ts` | `GlobalPipelineView.tsx` |
| 中俄东线 | `src/data/pipelines/cred.ts` | `GlobalPipelineView.tsx` |

---

### 三、数据库操作

#### 查看所有管线列表
```bash
cd f:\smartgas-grid && python -c "import sqlite3; conn=sqlite3.connect('backend/data/smartgas.db'); c=conn.cursor(); c.execute('SELECT DISTINCT trunk_name FROM node_relation_details ORDER BY trunk_name'); [print(r[0]) for r in c.fetchall()]"
```

#### 查看指定管线的节点数
```bash
cd f:\smartgas-grid && python -c "import sqlite3; conn=sqlite3.connect('backend/data/smartgas.db'); c=conn.cursor(); c.execute(\"SELECT trunk_name, COUNT(*) FROM node_relation_details GROUP BY trunk_name ORDER BY COUNT(*) DESC\"); [print(f'{r[0]}: {r[1]}条') for r in c.fetchall()]"
```

#### 查看表结构
```bash
cd f:\smartgas-grid && python -c "import sqlite3; conn=sqlite3.connect('backend/data/smartgas.db'); c=conn.cursor(); c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\"); tables=[r[0] for r in c.fetchall()]; [print(f'{t}: {c.execute(f\"SELECT COUNT(*) FROM {t}\").fetchone()[0]}条') for t in tables]"
```

#### 查看指定管线的分支结构
```bash
cd f:\smartgas-grid && python -c "import sqlite3; conn=sqlite3.connect('backend/data/smartgas.db'); c=conn.cursor(); c.execute(\"SELECT branch_name, COUNT(*) FROM node_relation_details WHERE trunk_name LIKE '%管线名称%' GROUP BY branch_name ORDER BY branch_name\"); [print(f'{r[0]}: {r[1]}个节点') for r in c.fetchall()]"
```

---

### 四、Git 版本管理

#### 保存代码
```bash
cd f:\smartgas-grid && & "F:\Program Files\Git\bin\git.exe" add .
cd f:\smartgas-grid && & "F:\Program Files\Git\bin\git.exe" commit -m "自动提交: 描述内容"
```

#### 查看状态
```bash
cd f:\smartgas-grid && & "F:\Program Files\Git\bin\git.exe" status
```

#### 查看最近提交
```bash
cd f:\smartgas-grid && & "F:\Program Files\Git\bin\git.exe" log -n 5 --oneline
```

---

### 五、构建与部署

#### 构建生产版本
```bash
cd f:\smartgas-grid && npm install && npm run build
```

#### 预览构建结果
```bash
cd f:\smartgas-grid && npm run preview
```

---

### 六、代码调试

#### 检查 TypeScript 编译错误
```bash
cd f:\smartgas-grid && npx tsc --noEmit 2>&1 | Select-Object -First 50
```

#### 检查 ESLint
```bash
cd f:\smartgas-grid && npx eslint src/ --ext .ts,.tsx 2>&1 | Select-Object -First 50
```

---

## 📂 项目目录速查

```
f:\smartgas-grid\
├── backend/
│   ├── data/smartgas.db          # SQLite 数据库
│   ├── data/*.json               # 提取的拓扑数据
│   ├── scripts/                  # Python 工具脚本
│   │   ├── extract_pipeline.py   # 通用管线提取
│   │   ├── extract_cred.py       # 中俄东线专用提取
│   │   └── analyze_shared_stations.py  # 共享站分析
│   ├── app/                      # FastAPI 后端应用
│   └── run.py                    # 后端启动入口
├── src/
│   ├── App.tsx                   # 路由配置
│   ├── data/
│   │   ├── pipelines/            # 管线数据（核心）
│   │   │   ├── index.ts          # 管线注册导出
│   │   │   ├── types.ts          # 类型定义
│   │   │   ├── we1.ts            # 西一线
│   │   │   ├── we2.ts            # 西二线
│   │   │   └── cred.ts           # 中俄东线
│   │   └── southernPipelineData.ts
│   ├── views/                    # 页面视图
│   │   ├── GlobalPipelineView.tsx
│   │   ├── CorpView.tsx
│   │   ├── TechView.tsx
│   │   └── MapDemo.tsx
│   ├── components/               # 可复用组件
│   │   ├── map-view/MapView.tsx  # 地图核心组件
│   │   └── ClusterDetailPanel.tsx
│   ├── utils/                    # 工具函数
│   │   ├── mapRenderer.ts        # 地图渲染+聚合
│   │   └── swarmAnalysis.ts      # 蜂群布局算法
│   └── types/                    # TypeScript 类型
│       └── cluster.ts            # 聚合类型
├── docs/                         # 项目文档
└── package.json
```

## 🎯 常用指令速查

| 你说 | 我做 |
|-----|------|
| "启动" / "start" | 启动前后端服务 |
| "停止" / "stop" | 停止所有服务 |
| "画XX线" / "绘制XX管线" | 全流程: 提取→坐标→数据→视图→路由 |
| "查数据库" / "有哪些管线" | 查询数据库并列出 |
| "保存" / "提交" | Git add + commit |
| "构建" / "打包" | npm run build |
| "检查错误" | TypeScript + ESLint 检查 |
| "看XX文件" | 直接打开并分析 |
| "改XX" / "修复XX" | 直接修改代码 |
| "分析XX管线结构" | 查数据库 + 输出分支统计 |

---

## ⚠️ 注意事项

- 数据库路径: `backend/data/smartgas.db`
- Git 路径: `F:\Program Files\Git\bin\git.exe`（Windows 环境）
- 前端端口: 3000 | 后端端口: 8000
- 所有 Python 脚本工作目录: `f:\smartgas-grid`
- Python 虚拟环境: `backend/.venv`
