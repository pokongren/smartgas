import { useEffect, useRef, useState, useCallback } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import type { MapViewProps, MapConfig } from './types'
import styles from './MapView.module.css'
import { renderPipelineLines, renderPipelineNodesWithClustering, renderPipelineDevices, clearMapOverlays } from '@/utils/mapRenderer'
import { sourceNodes as defaultSourceNodes, compressorStations as defaultCompressorStations } from '@/data'
import { ClusterDetailPanel } from '../ClusterDetailPanel'
import type { ClusterGroup, ClusterClickEvent } from '@/types/cluster'

const DEFAULT_CONFIG: MapConfig = {
    center: { longitude: 105.0, latitude: 36.0 },
    zoom: 4,
    zoomControl: true,
    draggable: true,
    theme: 'light',
    minZoom: 3,
    maxZoom: 20,
    showScale: true,
    showCompass: true,
}

// 加载阶段定义
type LoadingPhase = 
    | 'sdk'        // 加载 SDK
    | 'map'        // 初始化地图
    | 'controls'   // 加载控件
    | 'district'   // 加载行政区划
    | 'data'       // 加载业务数据
    | 'complete'   // 完成

interface LoadingState {
    phase: LoadingPhase
    progress: number
    message: string
}

const PHASE_PROGRESS: Record<LoadingPhase, number> = {
    sdk: 10,
    map: 30,
    controls: 50,
    district: 75,
    data: 90,
    complete: 100,
}

// 简化省份数据（可缓存，避免实时查询）
const PROVINCE_DATA = [
    { name: '北京市', center: [116.407526, 39.90403] },
    { name: '天津市', center: [117.200983, 39.084158] },
    { name: '河北省', center: [114.530235, 38.037431] },
    { name: '山西省', center: [112.562398, 37.873531] },
    { name: '内蒙古', center: [111.765617, 43.817153] },
    { name: '辽宁省', center: [123.42944, 41.835441] },
    { name: '吉林省', center: [125.32599, 43.896536] },
    { name: '黑龙江', center: [126.661669, 45.742347] },
    { name: '上海市', center: [121.473701, 31.230416] },
    { name: '江苏省', center: [118.763232, 32.061707] },
    { name: '浙江省', center: [120.153576, 30.287459] },
    { name: '安徽省', center: [117.284922, 31.861184] },
    { name: '福建省', center: [119.295144, 26.099712] },
    { name: '江西省', center: [115.854004, 28.675697] },
    { name: '山东省', center: [117.020359, 36.66853] },
    { name: '河南省', center: [113.665412, 34.757975] },
    { name: '湖北省', center: [114.305393, 30.593099] },
    { name: '湖南省', center: [112.938814, 28.228209] },
    { name: '广东省', center: [113.264435, 23.129163] },
    { name: '广西', center: [108.327546, 22.815478] },
    { name: '海南省', center: [110.349228, 20.017377] },
    { name: '重庆市', center: [106.551556, 29.563009] },
    { name: '四川省', center: [104.065735, 30.659462] },
    { name: '贵州省', center: [106.630154, 26.647661] },
    { name: '云南省', center: [102.832891, 24.880095] },
    { name: '西藏', center: [91.117212, 29.646923] },
    { name: '陕西省', center: [108.93977, 34.341574] },
    { name: '甘肃省', center: [103.826308, 36.059421] },
    { name: '青海省', center: [101.780199, 36.620901] },
    { name: '宁夏', center: [106.258754, 38.471317] },
    { name: '新疆', center: [87.627704, 43.793026] },
    { name: '台湾省', center: [121.509062, 25.044332] },
    { name: '香港', center: [114.171203, 22.277468] },
    { name: '澳门', center: [113.543028, 22.186835] },
]

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
    const mapInstanceRef = useRef<any>(null)
    const AMapRef = useRef<any>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [loadingState, setLoadingState] = useState<LoadingState>({
        phase: 'sdk',
        progress: 0,
        message: '加载地图 SDK...',
    })
    const [error, setError] = useState<string | null>(null)
    const isInitializedRef = useRef(false)
    const lineOverlaysRef = useRef<any[]>([])
    const nodeOverlaysRef = useRef<any[]>([])
    const [renderTrigger, setRenderTrigger] = useState(0)
    const [selectedCluster, setSelectedCluster] = useState<ClusterGroup | null>(null)
    const [isClusterPanelVisible, setIsClusterPanelVisible] = useState(false)
    const mapConfig = { ...DEFAULT_CONFIG, ...config }
    const districtLayerRef = useRef<any>(null)
    const provinceLabelsRef = useRef<any[]>([])

    // 更新加载状态
    const updateLoadingState = useCallback((phase: LoadingPhase, message: string) => {
        setLoadingState({
            phase,
            progress: PHASE_PROGRESS[phase],
            message,
        })
    }, [])

    // 阶段 1: 加载核心 SDK
    const loadCoreSDK = useCallback(async () => {
        updateLoadingState('sdk', '加载地图 SDK...')
        
        const amapKey = import.meta.env.VITE_AMAP_KEY || 'f60a02b69a072cb6b93d7cc4c6b0a42c';
        (window as any)._AMapSecurityConfig = {
            securityJsCode: import.meta.env.VITE_AMAP_SECRET || 'f33664d5ca92eb775080e76db01f379f',
        }

        // 只加载核心插件，控件和行政区划插件延迟加载
        const AMap = await AMapLoader.load({
            key: amapKey,
            version: '2.0',
            plugins: [], // 先不加载插件，按需加载
        })
        
        AMapRef.current = AMap
        return AMap
    }, [updateLoadingState])

    // 阶段 2: 初始化地图
    const initMap = useCallback((AMap: any) => {
        updateLoadingState('map', '初始化地图...')
        
        const map = new AMap.Map(mapContainerRef.current, {
            center: [mapConfig.center.longitude, mapConfig.center.latitude],
            zoom: mapConfig.zoom,
            mapStyle: 'amap://styles/dark',
            features: ['bg', 'road'],
            viewMode: '3D',
            pitch: 0,
            skyColor: '#1f263a',
        })

        mapInstanceRef.current = map
        
        // 绑定点击事件
        map.on('click', (e: any) => {
            if (onClick) {
                onClick({
                    longitude: e.lnglat.getLng(),
                    latitude: e.lnglat.getLat(),
                })
            }
            setIsClusterPanelVisible(false)
        })

        map.on('zoomend', () => {
            setRenderTrigger(prev => prev + 1)
        })

        return map
    }, [mapConfig, onClick, updateLoadingState])

    // 阶段 3: 异步加载控件
    const loadControls = useCallback(async () => {
        updateLoadingState('controls', '加载地图控件...')
        
        const AMap = AMapRef.current
        const map = mapInstanceRef.current
        if (!AMap || !map) return

        // 使用 requestIdleCallback 在浏览器空闲时加载
        const loadControl = (ControlClass: any, condition: boolean) => {
            return new Promise<void>((resolve) => {
                if (!condition) {
                    resolve()
                    return
                }
                
                const addControl = () => {
                    try {
                        map.addControl(new ControlClass())
                    } catch (e) {
                        console.warn('控件加载失败:', e)
                    }
                    resolve()
                }

                // 使用 requestIdleCallback 或 setTimeout 延迟执行
                if ('requestIdleCallback' in window) {
                    requestIdleCallback(addControl, { timeout: 100 })
                } else {
                    setTimeout(addControl, 50)
                }
            })
        }

        // 并行加载控件
        await Promise.all([
            loadControl(AMap.Scale, mapConfig.showScale),
            loadControl(AMap.ToolBar, mapConfig.zoomControl),
            loadControl(AMap.ControlBar, mapConfig.showCompass),
        ])
    }, [mapConfig, updateLoadingState])

    // 阶段 4: 异步加载行政区划（延迟到地图可交互后）
    const loadDistrictLayer = useCallback(async () => {
        updateLoadingState('district', '加载行政区划...')
        
        const AMap = AMapRef.current
        const map = mapInstanceRef.current
        if (!AMap || !map) return

        // 延迟加载行政区划插件
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 100) // 确保地图已可交互
        })

        try {
            // 添加省界图层
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
            districtLayerRef.current = disCountry

            // 使用静态数据添加省份标注（避免实时查询）
            // 分批添加，避免阻塞
            const batchSize = 5
            for (let i = 0; i < PROVINCE_DATA.length; i += batchSize) {
                const batch = PROVINCE_DATA.slice(i, i + batchSize)
                
                await new Promise<void>((resolve) => {
                    requestAnimationFrame(() => {
                        batch.forEach((prov) => {
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
                            provinceLabelsRef.current.push(text)
                        })
                        resolve()
                    })
                })

                // 每批之间留出时间片
                if (i + batchSize < PROVINCE_DATA.length) {
                    await new Promise(r => setTimeout(r, 16))
                }
            }
        } catch (e) {
            console.warn('行政区划加载失败:', e)
        }
    }, [updateLoadingState])

    // 主初始化流程
    useEffect(() => {
        if (isInitializedRef.current || !mapContainerRef.current) {
            return
        }
        isInitializedRef.current = true

        const init = async () => {
            try {
                // 阶段 1: 加载 SDK
                const AMap = await loadCoreSDK()
                
                // 阶段 2: 初始化地图
                const map = initMap(AMap)
                
                // 地图已可交互，通知外部
                setIsLoading(false)
                onLoad?.(map)
                console.log('✅ 高德地图核心初始化成功')

                // 阶段 3 & 4: 后台加载控件和行政区划
                // 使用 Promise.all 并行加载
                await Promise.all([
                    loadControls(),
                    loadDistrictLayer(),
                ])

                updateLoadingState('complete', '加载完成')
                console.log('✅ 地图全部资源加载完成')

            } catch (err: any) {
                console.error('❌ 高德地图加载失败:', err)
                setError('地图加载失败: ' + (err.message || String(err)))
                setIsLoading(false)
                isInitializedRef.current = false
            }
        }

        init()

        return () => {
            if (mapInstanceRef.current) {
                try {
                    clearMapOverlays(mapInstanceRef.current, lineOverlaysRef.current)
                    clearMapOverlays(mapInstanceRef.current, nodeOverlaysRef.current)
                    
                    // 清理行政区划图层
                    if (districtLayerRef.current) {
                        districtLayerRef.current.setMap(null)
                    }
                    provinceLabelsRef.current.forEach(label => {
                        label.setMap(null)
                    })
                    provinceLabelsRef.current = []
                    
                    mapInstanceRef.current.destroy()
                    mapInstanceRef.current = null
                } catch (error) {
                    console.error('销毁地图实例失败:', error)
                }
            }
            isInitializedRef.current = false
        }
    }, [])

    // 渲染进度指示器
    const renderLoadingIndicator = () => {
        if (!isLoading && loadingState.phase === 'complete') return null
        
        return (
            <div className={styles.loadingOverlay}>
                <div className={styles.loadingContent}>
                    <div className={styles.loadingSpinner} />
                    <div className={styles.loadingText}>{loadingState.message}</div>
                    <div className={styles.progressBar}>
                        <div 
                            className={styles.progressFill} 
                            style={{ width: `${loadingState.progress}%` }}
                        />
                    </div>
                    <div className={styles.progressText}>{loadingState.progress}%</div>
                </div>
            </div>
        )
    }

    // ... 其他渲染逻辑

    return (
        <div 
            ref={mapContainerRef} 
            className={`${styles.mapContainer} ${className}`}
            style={style}
        >
            {renderLoadingIndicator()}
            {error && (
                <div className={styles.errorOverlay}>
                    <div className={styles.errorContent}>
                        <div className={styles.errorIcon}>⚠️</div>
                        <div className={styles.errorText}>{error}</div>
                        <button 
                            className={styles.retryButton}
                            onClick={() => window.location.reload()}
                        >
                            重新加载
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default MapView
