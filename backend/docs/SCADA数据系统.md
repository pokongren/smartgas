# SCADA 数据系统 — 操作说明

---

## 一、启动服务

```bash
# 启动后端
cd f:\smartgas-grid\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

后端启动后，打开 http://localhost:8000/docs 可以看到 Swagger 接口文档。

---

## 二、首次使用

### 第1步：初始化站场基准数据

在 Swagger 页面找到 `POST /api/scada/init`，点 **Try it out** → **Execute**。

或者命令行：
```powershell
Invoke-RestMethod -Uri http://localhost:8000/api/scada/init -Method POST
```

返回 `已初始化 24 个站场` 表示成功。

### 第2步：导入甪直站 Excel 历史数据

确保 Excel 文件在 `C:\Users\Administrator\Downloads\甪直站20262311-0312.xlsx`。

在 Swagger 页面找到 `POST /api/scada/import-excel`，点 **Try it out** → **Execute**。

或者命令行：
```powershell
Invoke-RestMethod -Uri http://localhost:8000/api/scada/import-excel -Method POST
```

返回 `甪直站导入完成：1440 条历史记录` 表示成功。

---

## 三、日常操作

### 查看数据

```powershell
# 查看西一线全部站场数据
Invoke-RestMethod -Uri http://localhost:8000/api/scada/full/we1

# 查看管线列表
Invoke-RestMethod -Uri http://localhost:8000/api/scada/pipelines
```

管线ID可选值：`we1`（西一线）、`we2`（西二线）、`cred`（中俄线）

### 模拟数据波动

```powershell
# 触发一次随机波动（所有站的压力温度随机变化）
Invoke-RestMethod -Uri http://localhost:8000/api/scada/simulate -Method POST
```

每调一次，所有站的压力 ±0.15 MPa，温度 ±0.5 ℃。

### 回放甪直站真实历史数据

```powershell
# 回放一步（推进6分钟，用真实PI数据）
Invoke-RestMethod -Uri http://localhost:8000/api/scada/playback/甪直分输站 -Method POST
```

每调一次推进一个时间点（6分钟），共240步，播完自动循环。

### 查看甪直站历史曲线数据

```powershell
# 西一线压力历史
Invoke-RestMethod -Uri "http://localhost:8000/api/scada/history/甪直分输站?pipeline_id=we1&metric_type=pressure"

# 西二线温度历史
Invoke-RestMethod -Uri "http://localhost:8000/api/scada/history/甪直分输站?pipeline_id=we2&metric_type=temperature"

# 中俄线压力历史
Invoke-RestMethod -Uri "http://localhost:8000/api/scada/history/甪直分输站?pipeline_id=cred&metric_type=pressure"
```

---

## 四、接口速查

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/scada/pipelines` | 管线列表 |
| GET | `/api/scada/full/{管线ID}` | 全部站场数据（表格+坡降线+告警用） |
| POST | `/api/scada/simulate` | 随机波动一次 |
| POST | `/api/scada/init` | 初始化基准数据（只需一次） |
| POST | `/api/scada/import-excel` | 导入甪直站Excel（只需一次） |
| POST | `/api/scada/playback/甪直分输站` | 用真实数据回放一步 |
| GET | `/api/scada/history/甪直分输站` | 查历史时序数据 |

---

## 五、Swagger 可视化操作

不想敲命令的话，直接打开 http://localhost:8000/docs：

1. 找到 **SCADA 数据** 分组
2. 点击想用的接口
3. 点 **Try it out**
4. 填参数（如果需要）
5. 点 **Execute**
6. 看返回结果
