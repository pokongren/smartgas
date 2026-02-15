# 高德地图加载性能优化分析

## 一、原代码性能瓶颈

### 1.1 关键问题分析

```
┌─────────────────────────────────────────────────────────────────┐
│                     原代码加载流程 (约 2-3s)                      │
├─────────────────────────────────────────────────────────────────┤
│  0ms    ├─ 加载 SDK + 5个插件 (同步阻塞 200-500ms)               │
│  500ms  ├─ 初始化地图 (100-200ms)                                │
│  700ms  ├─ 查询行政区划数据 (DistrictSearch 300-800ms)           │
│  1200ms ├─ 创建 34 个省份 Text 覆盖物 (同步 DOM 操作 200-400ms)   │
│  1500ms ├─ 添加控件 Scale/ToolBar/ControlBar (100-200ms)         │
│  1700ms └─ 地图可交互                                           │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 具体问题

| 序号 | 问题 | 影响 | 耗时 |
|------|------|------|------|
| 1 | 插件一次性加载 | 阻塞主线程 | 200-500ms |
| 2 | DistrictSearch 实时查询 | 网络请求 + 数据处理 | 300-800ms |
| 3 | 34 个省份 Text 同步创建 | 大量 DOM 操作阻塞渲染 | 200-400ms |
| 4 | 控件同步添加 | 阻塞地图首次渲染 | 100-200ms |
| 5 | 无加载进度反馈 | 用户感知等待时间长 | - |

## 二、优化方案

### 2.1 分阶段加载架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     优化后加载流程 (约 0.8s 可交互)               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  【第一阶段】核心地图 (用户感知时间)                              │
│  0ms    ├─ 加载 SDK (无插件)         ───────────┐  300-500ms    │
│  400ms  ├─ 初始化地图               ────────────┤  200-300ms    │
│  700ms  └─ ✅ 地图可交互，通知 onLoad            │               │
│                                                 │               │
│  【第二阶段】后台加载 (不影响交互)                │               │
│  700ms  ├─ 异步加载控件 (并行)     ─────────────┤  100-200ms    │
│  700ms  ├─ 异步加载行政区划 (分批) ─────────────┤  300-500ms    │
│  1200ms └─ ✅ 全部资源加载完成                   │               │
│                                                 │               │
│  用户感知加载时间: 0.7s (改善 60%+)               │               │
│  完整加载时间: 1.2s (与原来相当，但体验更好)     │               │
│                                                 │               │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 具体优化措施

#### 1) 插件按需加载
```typescript
// 优化前：一次性加载所有插件
AMapLoader.load({
    plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.ControlBar', 
              'AMap.DistrictSearch', 'AMap.DistrictLayer'],
})

// 优化后：先加载核心，其他按需
const AMap = await AMapLoader.load({
    key: amapKey,
    version: '2.0',
    plugins: [], // 先不加载插件
})
// 控件和行政区划在地图可交互后再加载
```

#### 2) 静态数据替代实时查询
```typescript
// 优化前：实时查询（每次 300-800ms）
const districtSearch = new AMap.DistrictSearch({...})
districtSearch.search('中国', (status, result) => {
    // 处理结果
})

// 优化后：静态数据（0ms）
const PROVINCE_DATA = [
    { name: '北京市', center: [116.407526, 39.90403] },
    // ... 34 个省份
]
```

#### 3) 分批异步渲染
```typescript
// 优化前：同步创建 34 个 Text
provinces.forEach((prov) => {
    new AMap.Text({...}) // 阻塞渲染
})

// 优化后：分批异步（每批 5 个，使用 requestAnimationFrame）
const batchSize = 5
for (let i = 0; i < PROVINCE_DATA.length; i += batchSize) {
    const batch = PROVINCE_DATA.slice(i, i + batchSize)
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            batch.forEach((prov) => {
                new AMap.Text({...})
            })
            resolve()
        })
    })
    // 留出时间片
    if (i + batchSize < PROVINCE_DATA.length) {
        await new Promise(r => setTimeout(r, 16))
    }
}
```

#### 4) 异步控件加载
```typescript
// 使用 requestIdleCallback 在浏览器空闲时加载
const loadControl = (ControlClass: any, condition: boolean) => {
    return new Promise<void>((resolve) => {
        const addControl = () => {
            map.addControl(new ControlClass())
            resolve()
        }
        if ('requestIdleCallback' in window) {
            requestIdleCallback(addControl, { timeout: 100 })
        } else {
            setTimeout(addControl, 50)
        }
    })
}

// 并行加载
await Promise.all([
    loadControl(AMap.Scale, mapConfig.showScale),
    loadControl(AMap.ToolBar, mapConfig.zoomControl),
    loadControl(AMap.ControlBar, mapConfig.showCompass),
])
```

## 三、加载进度指示

### 3.1 分阶段状态管理

```typescript
type LoadingPhase = 
    | 'sdk'        // 加载 SDK (10%)
    | 'map'        // 初始化地图 (30%)
    | 'controls'   // 加载控件 (50%)
    | 'district'   // 加载行政区划 (75%)
    | 'data'       // 加载业务数据 (90%)
    | 'complete'   // 完成 (100%)

interface LoadingState {
    phase: LoadingPhase
    progress: number
    message: string
}
```

### 3.2 用户感知改善

- **优化前**: 白屏 2-3s，用户不知道在加载什么
- **优化后**: 
  - 0-0.7s: 显示 "初始化地图..." + 进度条
  - 0.7s+: 地图可交互，后台继续加载
  - 1.2s: 全部完成

## 四、预期效果对比

| 指标 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| **可交互时间 (TTI)** | 2-3s | 0.7-0.8s | **70%+** |
| **首屏加载时间 (FCP)** | 0.5s | 0.5s | - |
| **完整加载时间** | 2-3s | 1.2s | **50%** |
| **主线程阻塞时间** | 800-1200ms | 300-500ms | **60%** |
| **用户感知等待** | 长，无反馈 | 短，有进度 | **大幅改善** |

## 五、进一步优化建议

### 5.1 高级优化（可选）

1. **SDK 预加载**
   ```html
   <!-- 在 index.html 中预加载 -->
   <link rel="preconnect" href="https://webapi.amap.com">
   <link rel="dns-prefetch" href="https://webapi.amap.com">
   ```

2. **Service Worker 缓存**
   - 缓存高德地图 SDK
   - 缓存静态省份数据

3. **虚拟滚动（大数据量时）**
   - 只在可视区域渲染管线和站点

4. **Web Worker 处理数据**
   - 聚类计算放在 Worker 中

### 5.2 监控指标

```typescript
// 添加性能监控
const perfMetrics = {
    sdkLoadTime: 0,
    mapInitTime: 0,
    controlsLoadTime: 0,
    districtLoadTime: 0,
    totalTime: 0,
}

// 上报到监控系统
reportMetrics(perfMetrics)
```

## 六、文件清单

| 文件 | 说明 |
|------|------|
| `MapView.optimized.tsx` | 优化后的地图组件 |
| `MapView.module.optimized.css` | 加载进度样式 |
| `map-optimization-analysis.md` | 本文档 |

## 七、迁移指南

1. 备份原 `MapView.tsx`
2. 将 `MapView.optimized.tsx` 重命名为 `MapView.tsx`
3. 合并 CSS 样式到 `MapView.module.css`
4. 测试验证
