# 拓扑功能接入说明

这份文档只写当前项目里真实在用的口径。

- 后端默认端口：`8080`
- 前端开发端口：`5173`
- Swagger 文档：`http://localhost:8080/docs`
- 当前前端会同时用到两类拓扑路径：
  - 代理风格：`/api/topology/...`
  - 直连后端风格：`/topology/...`

## 1. 快速启动

### 启动后端

```bash
cd backend
.venv\Scripts\activate
python -m uvicorn app.main:app --reload --port 8080
```

看到下面这行，说明后端起来了：

```text
INFO:     Uvicorn running on http://127.0.0.1:8080
```

### 启动前端

```bash
npm run dev
```

前端默认会跑在：

```text
http://localhost:5173/
```

### 启动后先看这几个地址

- 前端页面：`http://localhost:5173/`
- 后端文档：`http://localhost:8080/docs`
- OpenAPI：`http://localhost:8080/openapi.json`

## 2. 环境变量

`.env.local` 里现在建议这样写：

```env
VITE_API_BASE_URL=http://localhost:8080/api
```

原因是现在代码里已经把两层地址拆开了：

- `src/services/apiBase.ts` 会从 `VITE_API_BASE_URL` 推出：
  - `API_BASE_URL=http://localhost:8080/api`
  - `BACKEND_BASE_URL=http://localhost:8080`
- 普通 REST 数据接口继续走 `/api/...`
- 一部分拓扑计算 / 拓扑纠偏接口直接走 `/topology/...`

## 3. 现在到底该走哪种路径

这块最容易混。先直接说结论：

- 如果你在看普通数据接口，比如站点、管线、数据包，继续按 `/api/...` 理解。
- 如果你在看 `useTopology` 这一类拓扑计算链路，要按 `/topology/...` 理解。
- 如果你在看拓扑编辑器相关接口，比如枢纽、点位提交，它们现在还在 `/api/topology/...` 下面。

### 代码里的真实落点

- `src/services/api.ts`
  - `getGraph()` / `getStats()` 这类还在走 `/api/topology/...`
  - 拓扑纠偏这类直接走 `/topology/correct/...`
- `src/hooks/useTopology.ts`
  - 直接拼 `BACKEND_BASE_URL + /topology/...`
- `src/services/topologyEditorApi.ts`
  - 走 `/api/topology/junctions`
  - 走 `/api/topology/positions/...`
- `vite.config.ts`
  - 已经把 `/api`、`/topology`、`/docs`、`/openapi.json` 都代理到 `http://localhost:8080`

所以现在不是“全都只有一种前缀”，而是项目正在收口中。文档要把这件事说清楚，不能再假装全是旧的 `/api/topology/...`。

## 4. 常见启动链路

### 链路 A：拓扑编辑器

这条链现在主要走：

- `GET /api/topology/graph`
- `GET /api/topology/junctions`
- `POST /api/topology/junctions`
- `DELETE /api/topology/junctions/{id}`
- `POST /api/topology/positions/preview`
- `PUT /api/topology/positions/commit`

### 链路 B：拓扑计算 Hook

这条链现在主要走：

- `POST /topology/build`
- `POST /topology/path`
- `POST /topology/paths`
- `GET /topology/analyze/{graph_name}`
- `GET /topology/cycles/{graph_name}`
- `GET /topology/mst/{graph_name}`

## 5. curl 验证

### 验证拓扑计算接口

```bash
curl -X POST http://localhost:8080/topology/build ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"test_graph\",\"directed\":true,\"nodes\":[{\"id\":\"a\",\"name\":\"站A\",\"type\":\"compressor\",\"longitude\":100,\"latitude\":30}],\"edges\":[]}"
```

### 验证拓扑编辑器接口

```bash
curl http://localhost:8080/api/topology/graph
```

## 6. 常见问题

### 1) 为什么有的接口走 `/api/topology/...`，有的走 `/topology/...`

因为现在代码还在收口中，不是所有拓扑链路都完成了统一前缀改造。

当前真实情况就是：

- 拓扑编辑器更多走 `/api/topology/...`
- 拓扑计算 Hook 和部分纠偏逻辑已经直连 `/topology/...`

这不是你看错，是代码现状。

### 2) 为什么文档和旧笔记里还写 `8000`

那是旧口径。当前运行配置已经切到 `8080`：

- `backend/run.py`
- `vite.config.ts`
- `src/services/apiBase.ts`

以后排查时，默认按 `8080` 看。

### 3) 请求 404 怎么查

先按这个顺序看：

1. 后端是不是跑在 `8080`
2. 前端 `.env.local` 是不是 `VITE_API_BASE_URL=http://localhost:8080/api`
3. 你调的是编辑器接口，还是拓扑计算接口
4. 如果是编辑器接口，优先检查 `/api/topology/...`
5. 如果是 `useTopology` 链路，优先检查 `/topology/...`

## 7. 相关文件

- `backend/run.py`
- `backend/app/main.py`
- `backend/app/routers/topology_editor.py`
- `backend/app/routers/topology_computation.py`
- `src/services/apiBase.ts`
- `src/services/api.ts`
- `src/services/topologyEditorApi.ts`
- `src/hooks/useTopology.ts`
- `vite.config.ts`
