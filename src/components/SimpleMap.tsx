import { useEffect, useRef, useState } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import type { PipelineData } from '@/types'

interface SimpleMapProps {
    center: { longitude: number; latitude: number }
    zoom: number
    pipelineData?: PipelineData
    className?: string
}

/**
 * 简化的地图组件，专门用于Line4显示
 */
export default function SimpleMap({ center, zoom, pipelineData, className }: SimpleMapProps) {
    const mapContainerRef = useRef<HTMLDivElement>(null)
    const mapInstanceRef = useRef<any>(null)
    const [isLoading, setIsLoading] = useState(true)
    const isInitializedRef = useRef(false)

    // 初始化地图
    useEffect(() => {
        if (isInitializedRef.current || !mapContainerRef.current) return
        isInitializedRef.current = true

        const amapKey = import.meta.env.VITE_AMAP_KEY || 'f60a02b69a072cb6b93d7cc4c6b0a42c'

        AMapLoader.load({
            key: amapKey,
            version: '2.0',
            plugins: ['AMap.Scale'],
        })
            .then((AMap) => {
                const map = new AMap.Map(mapContainerRef.current, {
                    center: [center.longitude, center.latitude],
                    zoom: zoom,
                    mapStyle: 'amap://styles/dark',
                    zoomEnable: true,
                })

                map.addControl(new AMap.Scale())
                mapInstanceRef.current = map
                setIsLoading(false)
                console.log('✅ 地图初始化成功')
            })
            .catch((error) => {
                console.error('❌ 地图加载失败:', error)
                setIsLoading(false)
            })

        return () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.destroy()
                mapInstanceRef.current = null
            }
            isInitializedRef.current = false
        }
    }, [])

    // 渲染管线和站点
    useEffect(() => {
        if (!mapInstanceRef.current || !pipelineData) return

        const AMap = (window as any).AMap
        if (!AMap) return

        console.log('🎨 开始渲染数据...')
        console.log('📍 站点数:', pipelineData.nodes?.length || 0)
        console.log('🔗 管线数:', pipelineData.lines?.length || 0)

        // 渲染管线
        if (pipelineData.lines && pipelineData.lines.length > 0) {
            console.log('🎨 渲染管线...')
            pipelineData.lines.forEach((line, index) => {
                if (!line.path || line.path.length < 2) {
                    console.warn(`管线 ${line.name} 缺少path数组`)
                    return
                }

                if (index === 0) {
                    console.log(`第一条管线示例:`, line.name)
                    console.log(`  起点: (${line.path[0].longitude}, ${line.path[0].latitude})`)
                    console.log(`  终点: (${line.path[line.path.length - 1].longitude}, ${line.path[line.path.length - 1].latitude})`)
                }

                const polyline = new AMap.Polyline({
                    path: line.path.map(p => [p.longitude, p.latitude]),
                    strokeColor: '#a855f7',  // 紫色
                    strokeWeight: 4,
                    strokeOpacity: 0.9,
                    zIndex: 50,
                })

                mapInstanceRef.current.add(polyline)
            })
            console.log(`✅ 已添加 ${pipelineData.lines.length} 条管线到地图`)
        }

        // 渲染站点
        if (pipelineData.nodes && pipelineData.nodes.length > 0) {
            console.log('🎨 渲染站点...')
            pipelineData.nodes.forEach((node, index) => {
                if (index === 0) {
                    console.log(`第一个站点示例: ${node.name} (${node.coordinate.longitude}, ${node.coordinate.latitude})`)
                }

                const marker = new AMap.CircleMarker({
                    center: [node.coordinate.longitude, node.coordinate.latitude],
                    radius: 6,
                    fillColor: node.name.includes('压气站') ? '#ef4444' : '#8b5cf6',
                    fillOpacity: 0.9,
                    strokeColor: '#ffffff',
                    strokeWeight: 2,
                    zIndex: 100,
                })

                mapInstanceRef.current.add(marker)
            })
            console.log(`✅ 已添加 ${pipelineData.nodes.length} 个站点到地图`)
        }

        console.log('🎉 数据渲染完成!')
    }, [pipelineData])

    return (
        <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
            {isLoading && (
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: 'white'
                }}>
                    加载地图中...
                </div>
            )}
        </div>
    )
}
