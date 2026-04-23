import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import type { MapViewProps, MapConfig } from './types'
import styles from './MapView.module.css'
import { renderPipelineLines, renderPipelineNodesWithClustering, renderPipelineDevices, clearMapOverlays, clearClusterCache, clearDragMappings } from '@/utils/mapRenderer'
import { renderHubNode, clearHubNodeRender } from '@/utils/hubRenderer'
import { ClusterDetailPanel } from '../ClusterDetailPanel'
import { HubDetailPanel } from '../HubDetailPanel'
import type { ClusterGroup, ClusterClickEvent } from '@/types/cluster'
import type { HubNode } from '@/types/hub'
import { DEFAULT_HUB_VISUAL_CONFIG } from '@/types/hub'

/**
 * 默认地图配置
 */
const DEFAULT_CONFIG: MapConfig = {
    center: {
        longitude: 105.0,
        latitude: 36.0,
    },
    zoom: 4,
    zoomControl: true,
    draggable: true,
    theme: 'light',
    minZoom: 3,
    maxZoom: 18,
    showScale: true,
    showCompass: true,
    viewMode: 'auto',
    showProvinceLabels: true,
    showDistrictLayer: true,
    maxRenderNodes: 1200,
    maxRenderLines: 1800,
}

/**
 * Demo 枢纽节点开关（默认关闭）
 * 仅开发环境下，并且手动设置 window.__SMARTGAS_SHOW_DEMO_HUB_NODES__ = true 才会生效
 */
const shouldEnableDemoHubNodes = (): boolean => {
    if (!import.meta.env.DEV) return false
    if (typeof window === 'undefined') return false
    return (window as any).__SMARTGAS_SHOW_DEMO_HUB_NODES__ === true
}

/**
 * 静态省份数据
 */
const PROVINCE_DATA = [
    { name: '北京市', center: [116.407526, 39.90403] },
    { name: '天津市', center: [117.200983, 39.084158] },
    { name: '河北省', center: [114.530235, 38.037431] },
    { name: '山西省', center: [112.562398, 37.873531] },
    { name: '内蒙古自治区', center: [111.765617, 43.81746] },
    { name: '辽宁省', center: [123.42944, 41.835441] },
    { name: '吉林省', center: [125.32599, 43.896536] },
    { name: '黑龙江省', center: [126.661669, 45.742347] },
    { name: '上海市', center: [121.473701, 31.230416] },
    { name: '江苏省', center: [118.763232, 32.061707] },
    { name: '浙江省', center: [120.153576, 30.287459] },
    { name: '安徽省', center: [117.284922, 31.861184] },
    { name: '福建省', center: [119.295144, 26.099912] },
    { name: '江西省', center: [115.857941, 28.68202] },
    { name: '山东省', center: [117.020359, 36.66853] },
    { name: '河南省', center: [113.769102, 34.229567] },
    { name: '湖北省', center: [114.341745, 30.546557] },
    { name: '湖南省', center: [112.9834, 28.1121] },
    { name: '广东省', center: [113.264434, 23.129162] },
    { name: '广西壮族自治区', center: [108.327546, 22.815478] },
    { name: '海南省', center: [110.349228, 20.017377] },
    { name: '重庆市', center: [106.551556, 29.563009] },
    { name: '四川省', center: [104.066541, 30.572269] },
    { name: '贵州省', center: [106.630154, 26.647661] },
    { name: '云南省', center: [102.832891, 24.880095] },
    { name: '西藏自治区', center: [91.117212, 29.646923] },
    { name: '陕西省', center: [108.954347, 34.265472] },
    { name: '甘肃省', center: [103.826308, 36.059421] },
    { name: '青海省', center: [101.780199, 36.620901] },
    { name: '宁夏回族自治区', center: [106.258754, 38.471317] },
    { name: '新疆维吾尔自治区', center: [87.627704, 43.793026] },
    { name: '台湾省', center: [121.509062, 25.044332] },
    { name: '香港特别行政区', center: [114.173355, 22.320048] },
    { name: '澳门特别行政区', center: [113.54909, 22.198951] },
]

/**
 * 防抖函数
 */
function debounce<T extends (...args: any[]) => void>(func: T, wait: number): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | null = null
    const debounced = (...args: Parameters<T>) => {
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => func(...args), wait)
    }
        // 添加 cancel 方法
        ; (debounced as any).cancel = () => {
            if (timeout) clearTimeout(timeout)
        }
    return debounced
}

/**
 * 地图显示组件 - 修复无限循环版
 */
function MapView({
    config,
    className = '',
    style,
    pipelineData,
    layerConfig,
    onLoad,
    onClick,
    onNodeClick,
    onLineClick,
    onDeviceClick,
}: MapViewProps) {
    const mapContainerRef = useRef<HTMLDivElement>(null)
    const [mapInstance, setMapInstance] = useState<any>(null)
    const mapInstanceRef = useRef<any>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [loadingStage, setLoadingStage] = useState<string>('初始化中...')
    const [error, setError] = useState<string | null>(null)
    const isInitializedRef = useRef(false)
    const lineOverlaysRef = useRef<any[]>([])
    const nodeOverlaysRef = useRef<any[]>([])
    const [renderTrigger, setRenderTrigger] = useState(0)
    const [selectedCluster, setSelectedCluster] = useState<ClusterGroup | null>(null)
    const [isClusterPanelVisible, setIsClusterPanelVisible] = useState(false)

    // 枢纽节点相关状态
    const [selectedHubNode, setSelectedHubNode] = useState<HubNode | null>(null)
    const hubRenderRef = useRef<{ ports: any[]; connections: any[] }[]>([])

    const mapConfig = { ...DEFAULT_CONFIG, ...config }
    const showDemoHubNodes = useMemo(() => shouldEnableDemoHubNodes(), [])
    const effectivePipelineData = useMemo(() => {
        if (!pipelineData) return pipelineData

        const maxNodes = Math.max(0, mapConfig.maxRenderNodes ?? DEFAULT_CONFIG.maxRenderNodes ?? 0)
        const maxLines = Math.max(0, mapConfig.maxRenderLines ?? DEFAULT_CONFIG.maxRenderLines ?? 0)

        const nodes = Array.isArray(pipelineData.nodes)
            ? pipelineData.nodes.slice(0, maxNodes)
            : pipelineData.nodes
        const lines = Array.isArray(pipelineData.lines)
            ? pipelineData.lines.slice(0, maxLines)
            : pipelineData.lines

        if (
            Array.isArray(pipelineData.nodes) &&
            Array.isArray(pipelineData.lines) &&
            (pipelineData.nodes.length > maxNodes || pipelineData.lines.length > maxLines)
        ) {
            console.warn(
                `[MapView] render budget applied: nodes ${pipelineData.nodes.length} -> ${nodes.length}, lines ${pipelineData.lines.length} -> ${lines.length}`,
            )
        }

        return {
            ...pipelineData,
            nodes,
            lines,
        }
    }, [mapConfig.maxRenderLines, mapConfig.maxRenderNodes, pipelineData])

    // 使用 ref 存储所有回调函数，避免 useEffect 依赖它们
    const callbacksRef = useRef({
        onLoad,
        onClick,
        onNodeClick,
        onLineClick,
        onDeviceClick,
    })

    // 保持回调引用最新
    useEffect(() => {
        callbacksRef.current = {
            onLoad,
            onClick,
            onNodeClick,
            onLineClick,
            onDeviceClick,
        }
    }, [onLoad, onClick, onNodeClick, onLineClick, onDeviceClick])

    // 稳定的防抖函数
    const debouncedZoomEnd = useMemo(() => debounce(() => {
        setRenderTrigger(prev => prev + 1)
    }, 300), [])

    // 稳定的回调函数
    const loadControls = useCallback((AMap: any, map: any) => {
        if (!map) return
        try {
            if (mapConfig.showScale) map.addControl(new AMap.Scale())
            if (mapConfig.zoomControl) map.addControl(new AMap.ToolBar({ position: 'RB' }))
            if (mapConfig.showCompass) map.addControl(new AMap.ControlBar({ position: 'RB' }))
        } catch (err) {
            // 控件加载失败
        }
    }, [mapConfig.showScale, mapConfig.zoomControl, mapConfig.showCompass])

    const loadDistrictLayer = useCallback((AMap: any, map: any) => {
        if (!map) return
        try {
            const disCountry = new AMap.DistrictLayer.Country({
                zIndex: 9,
                SOC: 'CHN',
                depth: 1,
                styles: {
                    'nation-stroke': '#666666',
                    'coastline-stroke': '#666666',
                    'province-stroke': 'rgba(255, 255, 255, 0.3)',
                    'fill': 'rgba(0,0,0,0)'
                }
            })
            disCountry.setMap(map)
        } catch (err) {
            // 图层加载失败
        }
    }, [])

    const loadProvinceLabels = useCallback((AMap: any, map: any) => {
        if (!map) return
        const batchSize = 5
        const batches = Math.ceil(PROVINCE_DATA.length / batchSize)

        const renderBatch = (batchIndex: number) => {
            if (batchIndex >= batches) return

            const start = batchIndex * batchSize
            const end = Math.min(start + batchSize, PROVINCE_DATA.length)
            const batch = PROVINCE_DATA.slice(start, end)

            requestAnimationFrame(() => {
                batch.forEach((prov) => {
                    try {
                        const text = new AMap.Text({
                            text: prov.name,
                            position: prov.center,
                            style: {
                                'background-color': 'transparent',
                                'text-align': 'center',
                                'border': 'none',
                                'color': 'rgba(255, 255, 255, 0.5)',
                                'font-size': '12px',
                                'font-weight': 'normal',
                                'text-shadow': '1px 1px 2px black'
                            },
                            zIndex: 10,
                        })
                        text.setMap(map)
                    } catch (err) {
                        // 标注创建失败
                    }
                })
                setTimeout(() => renderBatch(batchIndex + 1), 50)
            })
        }
        renderBatch(0)
    }, [])

    // 处理聚合点击 - 使用 useCallback 保持引用稳定
    const handleClusterClick = useCallback((event: ClusterClickEvent) => {
        setSelectedCluster(event.cluster)
        setIsClusterPanelVisible(true)

        if (mapInstanceRef.current) {
            mapInstanceRef.current.panTo([
                event.position.longitude,
                event.position.latitude
            ])
        }
    }, [])

    useEffect(() => {
        if (!selectedCluster && !isClusterPanelVisible) return
        setSelectedCluster(null)
        setIsClusterPanelVisible(false)
    }, [pipelineData, renderTrigger])

    /**
     * 初始化地图 - 修复无限循环
     * 注意：依赖数组只包含真正需要监听的值
     */
    useEffect(() => {
        if (isInitializedRef.current || !mapContainerRef.current) return
        isInitializedRef.current = true

        const initMap = async () => {
            try {
                setLoadingStage('加载地图 SDK...')
                const amapKey = import.meta.env.VITE_AMAP_KEY

                if (!amapKey) {
                    throw new Error('VITE_AMAP_KEY 环境变量未设置')
                }

                ; (window as any)._AMapSecurityConfig = {
                    securityJsCode: import.meta.env.VITE_AMAP_SECRET || '',
                }

                // 预加载必要的插件
                const loadAMapWithRetry = async () => {
                    const maxAttempts = 3
                    const attemptTimeoutMs = 12000
                    let lastError: unknown = null
                    const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
                        return await new Promise<T>((resolve, reject) => {
                            const timer = setTimeout(() => {
                                reject(new Error(`AMap SDK load timeout (${timeoutMs}ms)`))
                            }, timeoutMs)

                            promise
                                .then(result => {
                                    clearTimeout(timer)
                                    resolve(result)
                                })
                                .catch(error => {
                                    clearTimeout(timer)
                                    reject(error)
                                })
                        })
                    }

                    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                        try {
                            return await withTimeout(
                                AMapLoader.load({
                                    key: amapKey,
                                    version: '2.0',
                                    plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.ControlBar', 'AMap.DistrictLayer'],
                                }),
                                attemptTimeoutMs,
                            )
                        } catch (error) {
                            lastError = error
                            if (attempt < maxAttempts) {
                                setLoadingStage(`地图 SDK 加载失败，正在第 ${attempt + 1} 次重试...`)
                                await new Promise(resolve => setTimeout(resolve, attempt * 500))
                            }
                        }
                    }

                    throw (lastError instanceof Error ? lastError : new Error(String(lastError)))
                }

                const AMap = await loadAMapWithRetry()

                setLoadingStage('初始化地图...')

                // 确保容器有明确的高度
                if (mapContainerRef.current) {
                    mapContainerRef.current.style.width = '100%'
                    mapContainerRef.current.style.height = '100%'
                }

                const createMap = (viewMode: '2D' | '3D') => {
                    const options: Record<string, unknown> = {
                        center: [mapConfig.center.longitude, mapConfig.center.latitude],
                        zoom: mapConfig.zoom,
                        mapStyle: 'amap://styles/dark',
                        viewMode,
                    }

                    if (viewMode === '3D') {
                        options.pitch = 0
                        options.skyColor = '#1f263a'
                    }

                    return new AMap.Map(mapContainerRef.current, options)
                }

                const desiredViewMode = mapConfig.viewMode ?? 'auto'
                let map: any

                if (desiredViewMode === '2D') {
                    map = createMap('2D')
                } else if (desiredViewMode === '3D') {
                    map = createMap('3D')
                } else {
                    try {
                        map = createMap('3D')
                    } catch (error) {
                        console.warn('[MapView] 3D map init failed, fallback to 2D.', error)
                        setLoadingStage('3D 初始化失败，已切换 2D 渲染...')
                        map = createMap('2D')
                    }
                }

                // 设置中国边界限制 - 只显示中国区域
                // 中国区域大致范围：经度 73°E - 135°E，纬度 18°N - 54°N
                const chinaBounds = new AMap.Bounds(
                    [73.5, 18.0],   // 西南角：新疆西部、南海
                    [135.0, 54.0]   // 东北角：黑龙江东部、漠河
                )
                map.setLimitBounds(chinaBounds)

                // 绑定点击事件 - 使用 ref 获取最新回调
                map.on('click', (e: any) => {
                    const { onClick } = callbacksRef.current
                    if (onClick) {
                        onClick({
                            longitude: e.lnglat.getLng(),
                            latitude: e.lnglat.getLat(),
                        })
                    }
                    setIsClusterPanelVisible(false)
                })

                // 防抖的缩放事件
                map.on('zoomend', debouncedZoomEnd)

                mapInstanceRef.current = map
                setMapInstance(map)
                setIsLoading(false)
                setLoadingStage('')

                // 通过 ref 调用 onLoad，避免触发重新渲染
                callbacksRef.current.onLoad?.(map)

                // 后台异步加载非关键资源
                const loadNonCriticalResources = () => {
                    loadControls(AMap, map)
                    if (mapConfig.showDistrictLayer) {
                        loadDistrictLayer(AMap, map)
                    }
                }

                if ('requestIdleCallback' in window) {
                    ; (window as any).requestIdleCallback(loadNonCriticalResources, { timeout: 2000 })
                } else {
                    setTimeout(loadNonCriticalResources, 100)
                }

                const loadLabels = () => {
                    if (mapConfig.showProvinceLabels) {
                        loadProvinceLabels(AMap, map)
                    }
                }

                if ('requestIdleCallback' in window) {
                    ; (window as any).requestIdleCallback(loadLabels, { timeout: 3000 })
                } else {
                    setTimeout(loadLabels, 500)
                }

            } catch (err: any) {
                setError('地图加载失败: ' + (err.message || String(err)))
                setIsLoading(false)
                isInitializedRef.current = false
            }
        }

        initMap()

        return () => {
            // 清理防抖
            ; (debouncedZoomEnd as any).cancel?.()

            if (mapInstanceRef.current) {
                try {
                    clearMapOverlays(mapInstanceRef.current, lineOverlaysRef.current)
                    clearMapOverlays(mapInstanceRef.current, nodeOverlaysRef.current)
                    mapInstanceRef.current.destroy()
                    mapInstanceRef.current = null
                } catch (error) {
                    // 销毁失败
                }
            }
            isInitializedRef.current = false
            clearClusterCache()
            clearDragMappings()
        }
        // 注意：只依赖稳定的值，回调函数通过 ref 访问
    }, [mapConfig.center.longitude, mapConfig.center.latitude, mapConfig.zoom, mapConfig.showDistrictLayer, mapConfig.showProvinceLabels, debouncedZoomEnd, loadControls, loadDistrictLayer, loadProvinceLabels])

    /**
     * 管线渲染
     */
    useEffect(() => {
        if (!mapInstance || !effectivePipelineData) return

        // NOTE: 使用 AbortController 取消旧渲染，防止竞态导致覆盖物泄漏
        const abortController = new AbortController()

        // 清除旧的拖拽映射，防止拖拽指向已销毁的 polyline
        clearDragMappings()

        const renderLines = async () => {
            clearMapOverlays(mapInstanceRef.current, lineOverlaysRef.current)
            lineOverlaysRef.current = []

            try {
                if (effectivePipelineData.lines && effectivePipelineData.lines.length > 0 && !abortController.signal.aborted) {
                    const { onLineClick } = callbacksRef.current
                    const lineOverlays = await renderPipelineLines(
                        mapInstanceRef.current,
                        effectivePipelineData.lines,
                        onLineClick ? (e) => onLineClick({
                            type: 'line',
                            targetId: e.line.id,
                            data: e.line,
                            originalEvent: e
                        }) : undefined,
                        abortController.signal
                    )
                    if (!abortController.signal.aborted) {
                        lineOverlaysRef.current = lineOverlays
                    } else {
                        // 及时清理由于 abort 遗留在地图上的覆盖物
                        clearMapOverlays(mapInstanceRef.current, lineOverlays)
                    }
                }

                if (effectivePipelineData.devices && effectivePipelineData.devices.length > 0 && !abortController.signal.aborted) {
                    const { onDeviceClick } = callbacksRef.current
                    const deviceOverlays = await renderPipelineDevices(
                        mapInstanceRef.current,
                        effectivePipelineData.devices,
                        onDeviceClick ? (e) => onDeviceClick({
                            type: 'device',
                            targetId: e.device.id,
                            data: e.device,
                            originalEvent: e
                        }) : undefined
                    )
                    if (!abortController.signal.aborted) {
                        lineOverlaysRef.current.push(...deviceOverlays)
                    } else {
                        clearMapOverlays(mapInstanceRef.current, deviceOverlays)
                    }
                }
            } catch (error) {
                // 渲染失败
            }
        }

        renderLines()

        return () => {
            abortController.abort()
        }
    }, [effectivePipelineData, mapInstance])

    /**
     * 节点渲染
     */
    useEffect(() => {
        if (!mapInstance || !effectivePipelineData) return

        // NOTE: 使用 AbortController 取消旧渲染，防止竞态导致覆盖物泄漏
        const abortController = new AbortController()

        const renderNodes = async () => {
            // 清除旧覆盖物和缓存
            clearMapOverlays(mapInstanceRef.current, nodeOverlaysRef.current)
            nodeOverlaysRef.current = []

            // 清除旧的枢纽节点渲染
            hubRenderRef.current.forEach(renderResult => {
                clearHubNodeRender(mapInstanceRef.current, renderResult)
            })
            hubRenderRef.current = []

            clearClusterCache()

            try {
                if (effectivePipelineData.nodes && effectivePipelineData.nodes.length > 0 && !abortController.signal.aborted) {
                    const { onNodeClick } = callbacksRef.current
                    const nodeOverlays = await renderPipelineNodesWithClustering(
                        mapInstanceRef.current,
                        effectivePipelineData.nodes,
                        onNodeClick ? (e) => onNodeClick({
                            type: 'node',
                            targetId: e.node.id,
                            data: e.node,
                            originalEvent: e
                        }) : undefined,
                        handleClusterClick,
                        abortController.signal
                    )
                    if (!abortController.signal.aborted) {
                        nodeOverlaysRef.current = nodeOverlays
                    } else {
                        // 如果被提前取消，立即清理遗留节点的覆盖物
                        clearMapOverlays(mapInstanceRef.current, nodeOverlays)
                    }
                }

                // 渲染枢纽节点
                if (hubNodesSample.length > 0 && !abortController.signal.aborted) {
                    hubNodesSample.forEach(hubNode => {
                        const renderResult = renderHubNode(
                            mapInstanceRef.current,
                            hubNode,
                            DEFAULT_HUB_VISUAL_CONFIG,
                            {
                                onPortClick: (event) => {
                                    console.log('点击端口:', event.port)
                                },
                                onConnectionClick: (event) => {
                                    console.log('点击连接:', event.connection)
                                },
                                onNodeClick: (event) => {
                                    setSelectedHubNode(event.node)
                                }
                            }
                        )
                        if (renderResult) {
                            hubRenderRef.current.push(renderResult)
                        }
                    })
                }
            } catch (error) {
                // 渲染失败
            }
        }

        renderNodes()

        return () => {
            abortController.abort()
        }
    }, [effectivePipelineData, mapInstance, renderTrigger, handleClusterClick])

    return (
        <div className={`${styles.mapContainer} ${className}`} style={style}>
            <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

            {isLoading && (
                <div className={styles.mapLoading}>
                    <div className={styles.loadingSpinner} />
                    <span>{loadingStage}</span>
                </div>
            )}

            {error && (
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    padding: '20px',
                    background: 'rgba(255,0,0,0.8)',
                    color: 'white',
                    borderRadius: '8px',
                    maxWidth: '80%',
                    textAlign: 'center'
                }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>错误</div>
                    <div>{error}</div>
                </div>
            )}

            <ClusterDetailPanel
                cluster={selectedCluster}
                visible={isClusterPanelVisible}
                onClose={() => setIsClusterPanelVisible(false)}
                onNodeSelect={(node) => {
                    if (mapInstanceRef.current) {
                        const currentZoom = mapInstanceRef.current.getZoom?.() ?? 10
                        const nextZoom = Math.max(currentZoom, 14)
                        mapInstanceRef.current.setZoomAndCenter?.(
                            nextZoom,
                            [node.coordinate.longitude, node.coordinate.latitude]
                        )
                    }
                    const { onNodeClick } = callbacksRef.current
                    if (onNodeClick) {
                        onNodeClick({
                            type: 'node',
                            targetId: node.id,
                            data: node,
                            originalEvent: null
                        })
                    }
                }}
            />

            {/* 枢纽节点详情面板 */}
            <HubDetailPanel
                node={selectedHubNode}
                visible={!!selectedHubNode}
                onClose={() => setSelectedHubNode(null)}
                onPortClick={(portId) => {
                    console.log('点击端口:', portId)
                }}
                onPipelineClick={(pipelineId) => {
                    console.log('点击管线:', pipelineId)
                }}
            />
        </div>
    )
}

export default MapView
