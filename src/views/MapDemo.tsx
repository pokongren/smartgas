import { useState, useMemo, useRef } from 'react'
import MapView from '@/components/map-view/MapView'
import EmergencyPanel from '@/components/EmergencyPanel'
import { southernPipelineData } from '@/data'
import type { PipelineData, PipelineNode } from '@/types'
import './MapDemo.css'

/**
 * 管线分类定义
 */
const pipelineCategories = [
  { name: '中贵线', color: '#00d4ff', icon: '▼' },
  { name: '中缅线', color: '#ff4444', icon: '▼' },
  { name: '西二线', color: '#ff9800', icon: '▼' },
  { name: '陕二线', color: '#4caf50', icon: '▼' },
  { name: '阿拉支干线', color: '#00bcd4', icon: '▼' },
  { name: '广南/广西', color: '#ff00ff', icon: '▼' },
  { name: '海南', color: '#00ff00', icon: '▼' },
  { name: 'LNG外输', color: '#ffff00', icon: '▼' },
  { name: '其他', color: '#999999', icon: '▼' },
]

function MapDemo() {
  // 地图实例引用
  const mapInstanceRef = useRef<any>(null)

  // 搜索相关状态
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PipelineNode[]>([])
  const [showSearchResults, setShowSearchResults] = useState(false)

  // 应急面板状态
  const [showEmergencyPanel, setShowEmergencyPanel] = useState(false)

  // 控制哪些管线分类可见
  const [visibleCategories, setVisibleCategories] = useState<Set<string>>(
    new Set(pipelineCategories.map(c => c.name))
  )

  // 控制哪些分类面板展开
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  )

  // 过滤后的管网数据
  const filteredData = useMemo<PipelineData>(() => {
    return {
      ...southernPipelineData,
      lines: southernPipelineData.lines.filter(line => {
        const category = (line.properties?.category as string) || '其他'
        return visibleCategories.has(category)
      })
    }
  }, [visibleCategories])

  // 切换分类可见性
  const toggleCategory = (categoryName: string) => {
    setVisibleCategories(prev => {
      const next = new Set(prev)
      if (next.has(categoryName)) {
        next.delete(categoryName)
      } else {
        next.add(categoryName)
      }
      return next
    })
  }

  // 切换分类展开状态
  const toggleExpand = (categoryName: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(categoryName)) {
        next.delete(categoryName)
      } else {
        next.add(categoryName)
      }
      return next
    })
  }

  // 获取每个分类的管线数量
  const getCategoryLineCount = (categoryName: string) => {
    return southernPipelineData.lines.filter(line => {
      const category = (line.properties?.category as string) || '其他'
      return category === categoryName
    }).length
  }

  // 搜索站场
  const handleSearch = (query: string) => {
    setSearchQuery(query)

    if (query.trim() === '') {
      setSearchResults([])
      setShowSearchResults(false)
      return
    }

    // 模糊搜索站场
    const results = southernPipelineData.nodes.filter(node =>
      node.name.toLowerCase().includes(query.toLowerCase())
    )

    setSearchResults(results)
    setShowSearchResults(true)
  }

  // 定位到站场
  const flyToStation = (node: PipelineNode) => {
    if (!mapInstanceRef.current) return

    const map = mapInstanceRef.current

    // 平滑飞行到目标位置
    map.setZoomAndCenter(8, [node.coordinate.longitude, node.coordinate.latitude], false, 500)

    // 关闭搜索结果
    setShowSearchResults(false)
    setSearchQuery('')

    // 可选: 弹出该站场的信息窗口
    console.log('已定位到站场:', node.name)
  }

  // 地图加载完成回调
  const handleMapLoad = (map: any) => {
    console.log('地图加载完成', map)

    // 保存地图实例引用
    mapInstanceRef.current = map


    // 自动调整视野以显示所有管网数据
    if (southernPipelineData.nodes.length > 0) {
      const lngs = southernPipelineData.nodes.map(n => n.coordinate.longitude)
      const lats = southernPipelineData.nodes.map(n => n.coordinate.latitude)
      const AMap = (window as any).AMap
      if (AMap) {
        const bounds = new AMap.Bounds(
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)]
        )
        map.setBounds(bounds)
      }
    }
  }

  return (
    <div className="map-demo-container">
      {/* 顶部标题栏 */}
      <header className="map-demo-header">
        <h1 className="map-demo-title">南部管网运行监测系统 (增强版)</h1>
        <button
          className="emergency-button"
          onClick={() => setShowEmergencyPanel(!showEmergencyPanel)}
        >
          🚨 应急指挥
        </button>
      </header>

      <div className="map-demo-content">
        {/* 左侧控制面板 */}
        <aside className="control-panel">
          {/* 搜索框 */}
          <div className="search-container">
            <input
              type="text"
              className="search-input"
              placeholder="搜索站场 (如: 贵阳)"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => searchQuery && setShowSearchResults(true)}
            />
            {showSearchResults && searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map(node => (
                  <div
                    key={node.id}
                    className="search-result-item"
                    onClick={() => flyToStation(node)}
                  >
                    <span className="result-name">{node.name}</span>
                    <span className="result-type">
                      {node.properties?.isSource ? '气源站' :
                        node.properties?.isCompressor ? '压气站' : '分输站'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {pipelineCategories.map(category => {
            const lineCount = getCategoryLineCount(category.name)
            const isVisible = visibleCategories.has(category.name)
            const isExpanded = expandedCategories.has(category.name)

            return (
              <div key={category.name} className="category-item">
                <div className="category-header">
                  <button
                    className="category-toggle"
                    onClick={() => toggleExpand(category.name)}
                  >
                    <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>
                      {category.icon}
                    </span>
                  </button>
                  <label className="category-label">
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={() => toggleCategory(category.name)}
                      className="category-checkbox"
                    />
                    <span
                      className="category-color-indicator"
                      style={{ backgroundColor: category.color }}
                    />
                    <span className="category-name">{category.name}</span>
                    <span className="category-count">({lineCount})</span>
                  </label>
                </div>

                {/* 展开内容区域 */}
                {isExpanded && (
                  <div className="category-content">
                    {southernPipelineData.lines
                      .filter(line => {
                        const cat = (line.properties?.category as string) || '其他'
                        return cat === category.name
                      })
                      .map(line => (
                        <div key={line.id} className="line-item">
                          <span className="line-name">{line.name}</span>
                          <span className="line-length">{line.length}km</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )
          })}
        </aside>

        {/* 地图区域 */}
        <main className="map-container">
          <MapView
            config={{
              center: { longitude: 102.0, latitude: 25.0 },
              zoom: 7,
              theme: 'dark',
              draggable: true,
              zoomControl: true,
            }}
            pipelineData={filteredData}
            onLoad={handleMapLoad}
          />
        </main>
      </div>

      {/* 应急指挥面板 */}
      {showEmergencyPanel && (
        <EmergencyPanel onClose={() => setShowEmergencyPanel(false)} />
      )}
    </div>
  )
}

export default MapDemo
