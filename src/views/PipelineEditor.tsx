
import React, { useEffect, useRef, useState } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import { useNavigate } from 'react-router-dom'

// 类型定义
type EditMode = 'view' | 'draw-point' | 'draw-line'
type PointType = 'station' | 'valve' | 'distribution'
type OverlayData = {
    id: string
    type: 'marker' | 'polyline'
    overlay: any // AMap object
    properties?: any // 自定义属性
}

const PipelineEditor: React.FC = () => {
    const navigate = useNavigate()
    const mapContainerRef = useRef<HTMLDivElement>(null)
    const mapInstanceRef = useRef<any>(null)
    const mouseToolRef = useRef<any>(null)
    const overlaysRef = useRef<OverlayData[]>([]) // 使用 ref 存储以便在回调中访问最新值

    // 状态
    const [mode, setMode] = useState<EditMode>('view')
    const [pointType, setPointType] = useState<PointType>('station')
    const [statusMsg, setStatusMsg] = useState('一般视图模式')
    const [overlayCount, setOverlayCount] = useState(0)

    // 配置
    const amapKey = import.meta.env.VITE_AMAP_KEY || 'f60a02b69a072cb6b93d7cc4c6b0a42c'
    const amapSecret = import.meta.env.VITE_AMAP_SECRET || 'f33664d5ca92eb775080e76db01f379f'

    useEffect(() => {
        // 设置安全密钥
        (window as any)._AMapSecurityConfig = {
            securityJsCode: amapSecret,
        }

        AMapLoader.load({
            key: amapKey,
            version: '2.0',
            plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.MouseTool', 'AMap.PolyEditor'],
        }).then((AMap) => {
            if (!mapContainerRef.current) return

            // 初始化地图
            const map = new AMap.Map(mapContainerRef.current, {
                center: [108.9, 34.2], // 西安中心
                zoom: 5,
                mapStyle: 'amap://styles/dark',
                viewMode: '3D',
            })
            mapInstanceRef.current = map

            // 基础控件
            map.add(new AMap.Scale())
            map.add(new AMap.ToolBar())

            // 初始化鼠标工具
            const mouseTool = new AMap.MouseTool(map)
            mouseToolRef.current = mouseTool

            // 监听绘制完成事件
            mouseTool.on('draw', (e: any) => {
                const overlay = e.obj
                const type = overlay.CLASS_NAME === 'AMap.Marker' ? 'marker' : 'polyline'

                // 暂时存储些属性
                let props = {}
                if (type === 'marker') {
                    // 无法直接获取当前React状态中的 pointType，因为闭包问题
                    // 但我们可以通过 ref 或者 data 属性
                    // 这里简化，假设只能绘制 marker
                }

                const newOverlay: OverlayData = {
                    id: `draw-${Date.now()}`,
                    type,
                    overlay,
                    properties: props
                }

                overlaysRef.current.push(newOverlay)
                setOverlayCount(overlaysRef.current.length)

                // 如果是 polyline，开启编辑模式?
                // if (type === 'polyline') {
                //      const polyEditor = new AMap.PolyEditor(map, overlay)
                //      polyEditor.open() 
                // }
            })

            console.log("Map initialized")
        }).catch(e => {
            console.error(e)
        })

        return () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.destroy()
            }
        }
    }, [])

    // 切换模式
    const switchMode = (newMode: EditMode, pType?: PointType) => {
        setMode(newMode)
        if (pType) setPointType(pType)

        const mouseTool = mouseToolRef.current
        if (!mouseTool) return

        mouseTool.close(false) // 保留覆盖物

        let msg = ''

        if (newMode === 'draw-point') {
            msg = `正在绘制: ${pType === 'station' ? '站场' : pType === 'valve' ? '阀室' : '分输站'}`

            // 根据类型设置图标
            let iconContent = ''
            let offset = new (window as any).AMap.Pixel(-10, -10)

            if (pType === 'station') {
                // 简单的圆点
                iconContent = '<div style="width:12px;height:12px;background:red;border-radius:50%;border:2px solid white;"></div>'
                offset = new (window as any).AMap.Pixel(-6, -6)
            } else if (pType === 'valve') {
                iconContent = '<div style="width:10px;height:10px;background:yellow;transform:rotate(45deg);border:1px solid black;"></div>'
                offset = new (window as any).AMap.Pixel(-5, -5)
            } else {
                iconContent = '<div style="width:14px;height:14px;background:blue;border:2px solid white;"></div>'
                offset = new (window as any).AMap.Pixel(-7, -7)
            }

            mouseTool.marker({
                content: iconContent,
                offset: offset,
                anchor: 'center'
            })
        } else if (newMode === 'draw-line') {
            msg = '正在绘制管线 (左键点击添加节点，双击结束)'
            mouseTool.polyline({
                strokeColor: "#3366FF",
                strokeOpacity: 1,
                strokeWeight: 4,
                strokeStyle: "solid",
            })
        } else {
            msg = '一般视图模式 (可拖拽地图)'
        }
        setStatusMsg(msg)
    }

    const clearAll = () => {
        if (mouseToolRef.current) {
            mouseToolRef.current.close(true)
        }
        if (mapInstanceRef.current) {
            mapInstanceRef.current.clearMap()
        }
        overlaysRef.current = []
        setOverlayCount(0)
        setStatusMsg('已清空画布')
    }

    const undoLast = () => {
        const last = overlaysRef.current.pop()
        if (last) {
            last.overlay.setMap(null)
            setOverlayCount(overlaysRef.current.length)
        }
    }

    const exportData = () => {
        const data = overlaysRef.current.map(item => {
            if (item.type === 'marker') {
                return {
                    type: 'point',
                    position: item.overlay.getPosition(),
                    props: item.properties
                }
            } else {
                return {
                    type: 'line',
                    path: item.overlay.getPath(),
                    props: item.properties
                }
            }
        })
        console.log("Exported Data:", data)
        alert(`已在控制台导出 ${data.length} 个对象数据`)
    }

    return (
        <div className="relative w-full h-screen bg-gray-900 text-white overflow-hidden">
            {/* 顶部工具栏 */}
            <div className="absolute top-4 left-4 right-4 h-16 bg-gray-800/90 backdrop-blur rounded-xl shadow-2xl z-10 flex items-center px-6 gap-4 border border-gray-700">
                <div className="font-bold text-xl text-blue-400 mr-4">管网绘图工具</div>

                <div className="h-8 w-px bg-gray-600 mx-2"></div>

                <div className="flex gap-2">
                    <button
                        onClick={() => switchMode('view')}
                        className={`px-4 py-2 rounded-lg transition-colors ${mode === 'view' ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}
                    >
                        <span className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-sm">pan_tool</span> 浏览
                        </span>
                    </button>

                    <button
                        onClick={() => switchMode('draw-point', 'station')}
                        className={`px-4 py-2 rounded-lg transition-colors ${mode === 'draw-point' && pointType === 'station' ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}
                    >
                        <span className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-sm">location_on</span> 站场
                        </span>
                    </button>

                    <button
                        onClick={() => switchMode('draw-point', 'valve')}
                        className={`px-4 py-2 rounded-lg transition-colors ${mode === 'draw-point' && pointType === 'valve' ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}
                    >
                        <span className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-sm">radio_button_checked</span> 阀室
                        </span>
                    </button>

                    <button
                        onClick={() => switchMode('draw-line')}
                        className={`px-4 py-2 rounded-lg transition-colors ${mode === 'draw-line' ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}
                    >
                        <span className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-sm">timeline</span> 管线
                        </span>
                    </button>
                </div>

                <div className="flex-1"></div>

                <div className="text-gray-400 text-sm mr-4">{statusMsg} | 对象数: {overlayCount}</div>

                <button
                    onClick={undoLast}
                    className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-blue-300 transition-colors"
                >
                    撤销
                </button>

                <button
                    onClick={exportData}
                    className="px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white transition-colors"
                >
                    导出
                </button>

                <button
                    onClick={clearAll}
                    className="px-4 py-2 rounded-lg bg-red-900/50 hover:bg-red-900 text-red-300 border border-red-800 transition-colors"
                >
                    清空
                </button>

                <button
                    onClick={() => navigate('/')}
                    className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                >
                    退出
                </button>
            </div>

            {/* 地图容器 */}
            <div ref={mapContainerRef} className="w-full h-full z-0" />
        </div>
    )
}

export default PipelineEditor
