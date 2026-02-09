import { useEffect, useRef, useState } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import type { MapViewProps, MapConfig } from './types'
import styles from './MapView.module.css'
import { renderPipelineLines, renderPipelineNodes, renderPipelineDevices, clearMapOverlays } from '@/utils/mapRenderer'
import { sourceNodes as defaultSourceNodes, compressorStations as defaultCompressorStations } from '@/data'

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
    maxZoom: 20,
    showScale: true,
    showCompass: true,
}

/**
 * 地图显示组件
 * 
 * 集成高德地图 SDK,提供基础的地图显示和交互功能
 * 支持管网数据可视化
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
    const [error, setError] = useState<string | null>(null)
    const isInitializedRef = useRef(false)
    const overlaysRef = useRef<any[]>([])

    const mapConfig = { ...DEFAULT_CONFIG, ...config }

    useEffect(() => {
        if (isInitializedRef.current || !mapContainerRef.current) {
            return
        }

        isInitializedRef.current = true

        const amapKey = import.meta.env.VITE_AMAP_KEY || 'f60a02b69a072cb6b93d7cc4c6b0a42c';

        // 设置安全密钥
        (window as any)._AMapSecurityConfig = {
            securityJsCode: import.meta.env.VITE_AMAP_SECRET || 'f33664d5ca92eb775080e76db01f379f',
        };

        AMapLoader.load({
            key: amapKey,
            version: '2.0',
            plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.ControlBar', 'AMap.DistrictSearch', 'AMap.DistrictLayer'],
        })
            .then((AMap) => {
                const map = new AMap.Map(mapContainerRef.current, {
                    center: [mapConfig.center.longitude, mapConfig.center.latitude],
                    zoom: mapConfig.zoom,
                    mapStyle: 'amap://styles/dark', // 强制深色
                    features: ['bg', 'road'], // 只显示背景和道路
                    viewMode: '3D',
                    pitch: 0,
                    skyColor: '#1f263a',
                })

                // 添加省界图层 (只显示边界，不填充颜色)
                const disCountry = new AMap.DistrictLayer.Country({
                    zIndex: 9,
                    SOC: 'CHN',
                    depth: 1, // 深度1表示显示到省
                    styles: {
                        'nation-stroke': '#666666',
                        'coastline-stroke': '#666666',
                        'province-stroke': 'rgba(255, 255, 255, 0.3)', // 省界颜色：半透明白
                        'fill': 'rgba(0,0,0,0)' // 填充透明
                    }
                })
                disCountry.setMap(map)

                // 添加省份名称注记
                const districtSearch = new AMap.DistrictSearch({
                    level: 'country',
                    subdistrict: 1,
                    extensions: 'base'
                })

                districtSearch.search('中国', (status: string, result: any) => {
                    if (status === 'complete' && result.districtList.length > 0) {
                        const provinces = result.districtList[0].districtList
                        provinces.forEach((prov: any) => {
                            const text = new AMap.Text({
                                text: prov.name,
                                position: prov.center,
                                style: {
                                    'background-color': 'transparent',
                                    'text-align': 'center',
                                    'border': 'none',
                                    'color': 'rgba(255, 255, 255, 0.5)', // 半透明白色文字
                                    'font-size': '12px',
                                    'font-weight': 'normal',
                                    'text-shadow': '1px 1px 2px black'
                                },
                                zIndex: 10,
                                map: map
                            })
                        })
                    }
                })

                if (mapConfig.showScale) {
                    map.addControl(new AMap.Scale())
                }
                if (mapConfig.zoomControl) {
                    map.addControl(new AMap.ToolBar())
                }
                if (mapConfig.showCompass) {
                    map.addControl(new AMap.ControlBar())
                }

                map.on('click', (e: any) => {
                    if (onClick) {
                        onClick({
                            longitude: e.lnglat.getLng(),
                            latitude: e.lnglat.getLat(),
                        })
                    }
                })

                mapInstanceRef.current = map
                setMapInstance(map)
                setIsLoading(false)
                onLoad?.(map)
                console.log('✅ 高德地图初始化成功')
            })
            .catch((err) => {
                console.error('❌ 高德地图加载失败:', err)
                setError('地图加载失败: ' + (err.message || String(err)))
                setIsLoading(false)
                isInitializedRef.current = false
            })

        return () => {
            if (mapInstanceRef.current) {
                try {
                    clearMapOverlays(mapInstanceRef.current, overlaysRef.current)
                    mapInstanceRef.current.destroy()
                    mapInstanceRef.current = null
                } catch (error) {
                    console.error('销毁地图实例失败:', error)
                }
            }
            isInitializedRef.current = false
        }
    }, [])

    useEffect(() => {
        if (!mapInstance) return

        try {
            mapInstance.setCenter([
                mapConfig.center.longitude,
                mapConfig.center.latitude,
            ])
            mapInstance.setZoom(mapConfig.zoom)
        } catch (error) {
            console.error('更新地图配置失败:', error)
        }
    }, [mapInstance, mapConfig.center.longitude, mapConfig.center.latitude, mapConfig.zoom])

    useEffect(() => {
        if (!mapInstance || !pipelineData) return

        console.log('🎨 ========== 开始渲染管网数据 ==========')

        clearMapOverlays(mapInstanceRef.current, overlaysRef.current)
        overlaysRef.current = []

        try {
            // 1. 渲染管线
            if (pipelineData.lines && pipelineData.lines.length > 0) {
                const lineOverlays = renderPipelineLines(
                    mapInstanceRef.current,
                    pipelineData.lines,
                    onLineClick ? (e) => onLineClick({
                        type: 'line',
                        targetId: e.line.id,
                        data: e.line,
                        originalEvent: e
                    }) : undefined
                )
                overlaysRef.current.push(...lineOverlays)
            }

            // 2. 渲染节点
            if (pipelineData.nodes && pipelineData.nodes.length > 0) {
                const nodeOverlays = renderPipelineNodes(
                    mapInstanceRef.current,
                    pipelineData.nodes,
                    defaultSourceNodes,
                    defaultCompressorStations,
                    onNodeClick ? (e) => onNodeClick({
                        type: 'node',
                        targetId: e.node.id,
                        data: e.node,
                        originalEvent: e
                    }) : undefined
                )
                overlaysRef.current.push(...nodeOverlays)
            }

            // 3. 渲染设备
            if (pipelineData.devices && pipelineData.devices.length > 0) {
                const deviceOverlays = renderPipelineDevices(
                    mapInstanceRef.current,
                    pipelineData.devices,
                    onDeviceClick ? (e) => onDeviceClick({
                        type: 'device',
                        targetId: e.device.id,
                        data: e.device,
                        originalEvent: e
                    }) : undefined
                )
                overlaysRef.current.push(...deviceOverlays)
            }

            console.log('✅ 管网数据渲染完成')
        } catch (error) {
            console.error('渲染管网数据失败:', error)
        }
    }, [mapInstance, pipelineData, onNodeClick, onLineClick, onDeviceClick])

    return (
        <div className={`${styles.mapContainer} ${className}`} style={style}>
            <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
            {isLoading && (
                <div className={styles.mapLoading}>
                    地图加载中...
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
                    <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>❌ 错误</div>
                    <div>{error}</div>
                </div>
            )}
        </div>
    )
}

export default MapView
