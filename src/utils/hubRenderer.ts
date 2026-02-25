/**
 * 枢纽节点渲染工具
 *
 * 用于在地图上渲染多端口节点及其内部连接关系
 */

import type { Coordinate } from '@/components/map-view/types'
import type {
  HubNode,
  NodePort,
  PortConnection,
  HubVisualConfig,
  PortClickEvent,
  ConnectionClickEvent
} from '@/types/hub'
import { PortDirection, DEFAULT_HUB_VISUAL_CONFIG } from '@/types/hub'

/**
 * 端口标记配置
 */
const PORT_MARKER_CONFIG = {
  SIZE: 10,
  COLORS: {
    [PortDirection.IN]: '#22c55e',    // 绿色 - 进气
    [PortDirection.OUT]: '#3b82f6',    // 蓝色 - 出气
    [PortDirection.BIDIRECTIONAL]: '#a855f7'  // 紫色 - 双向
  },
  BORDER_COLOR: '#ffffff',
  BORDER_WIDTH: 2
}

/**
 * 计算端口在节点周围的显示位置
 */
function calculatePortPosition(
  nodeCoord: Coordinate,
  portAngle: number,
  distance: number
): Coordinate {
  // 将角度转换为弧度
  const radians = (portAngle * Math.PI) / 180

  // 1度经度对应的公里数（近似）
  const lngPerDegree = 111.32 * Math.cos(nodeCoord.latitude * Math.PI / 180)
  const latPerDegree = 111.32

  return {
    longitude: nodeCoord.longitude + (distance * Math.cos(radians)) / lngPerDegree,
    latitude: nodeCoord.latitude + (distance * Math.sin(radians)) / latPerDegree
  }
}

/**
 * 创建端口标记SVG
 */
function createPortMarkerSVG(port: NodePort): string {
  const color = PORT_MARKER_CONFIG.COLORS[port.direction] || PORT_MARKER_CONFIG.COLORS[PortDirection.BIDIRECTIONAL]
  const size = PORT_MARKER_CONFIG.SIZE

  let directionPath = ''
  if (port.direction === PortDirection.IN) {
    // 进气口：向下箭头
    directionPath = `<path d="M0,-${size/2} L${size/2},${size/2} L-${size/2},${size/2} Z" fill="${color}"/>`
  } else if (port.direction === PortDirection.OUT) {
    // 出气口：向上箭头
    directionPath = `<path d="M0,${size/2} L${size/2},-${size/2} L-${size/2},-${size/2} Z" fill="${color}"/>`
  } else {
    // 双向：菱形
    directionPath = `<path d="M0,-${size/2} L${size/2},0 L0,${size/2} L-${size/2},0 Z" fill="${color}"/>`
  }

  return `
    <svg width="${size * 2}" height="${size * 2}" viewBox="${-size} ${-size} ${size * 2} ${size * 2}">
      <circle cx="0" cy="0" r="${size - 2}" fill="${color}" stroke="${PORT_MARKER_CONFIG.BORDER_COLOR}" stroke-width="${PORT_MARKER_CONFIG.BORDER_WIDTH}"/>
      ${directionPath}
    </svg>
  `
}

/**
 * 渲染端口标记
 */
export function renderPortMarker(
  map: any,
  node: HubNode,
  port: NodePort,
  config: HubVisualConfig = DEFAULT_HUB_VISUAL_CONFIG,
  onClick?: (event: PortClickEvent) => void
): any {
  if (!map || !config.showPorts) return null

  // 计算端口显示位置（距离中心一定距离）
  const portDistance = 25 // 像素距离
  const portCoord = calculatePortPosition(node.coordinate, port.displayAngle, portDistance / 111)

  // 创建标记
  const marker = new (window as any).AMap.Marker({
    position: [portCoord.longitude, portCoord.latitude],
    content: createPortMarkerSVG(port),
    offset: new (window as any).AMap.Pixel(-PORT_MARKER_CONFIG.SIZE, -PORT_MARKER_CONFIG.SIZE),
    zIndex: 100,
    clickable: true
  })

  // 点击事件
  if (onClick) {
    marker.on('click', (e: any) => {
      onClick({
        port,
        node,
        position: portCoord,
        originalEvent: e
      })
    })
  }

  map.add(marker)
  return marker
}

/**
 * 渲染所有端口
 */
export function renderAllPorts(
  map: any,
  node: HubNode,
  config: HubVisualConfig = DEFAULT_HUB_VISUAL_CONFIG,
  onClick?: (event: PortClickEvent) => void
): any[] {
  if (!node.extension.isHub || !node.extension.ports) return []

  const markers: any[] = []

  for (const port of node.extension.ports) {
    const marker = renderPortMarker(map, node, port, config, onClick)
    if (marker) markers.push(marker)
  }

  return markers
}

/**
 * 渲染内部连接线
 */
export function renderInternalConnection(
  map: any,
  node: HubNode,
  connection: PortConnection,
  config: HubVisualConfig = DEFAULT_HUB_VISUAL_CONFIG,
  onClick?: (event: ConnectionClickEvent) => void
): any {
  if (!map || !config.showInternalConnections) return null

  // 类型守卫：确保是枢纽节点
  if (!node.extension.isHub || !node.extension.ports) return null

  // 找到对应的端口
  const fromPort = node.extension.ports.find(p => p.portId === connection.fromPort)
  const toPort = node.extension.ports.find(p => p.portId === connection.toPort)

  if (!fromPort || !toPort) return null

  // 计算端口位置
  const portDistance = 25
  const fromCoord = calculatePortPosition(node.coordinate, fromPort.displayAngle, portDistance / 111)
  const toCoord = calculatePortPosition(node.coordinate, toPort.displayAngle, portDistance / 111)

  // 创建连接线（虚线）
  const line = new (window as any).AMap.Polyline({
    path: [
      [fromCoord.longitude, fromCoord.latitude],
      [toCoord.longitude, toCoord.latitude]
    ],
    strokeColor: config.connectionLineColor,
    strokeWeight: config.connectionLineWidth,
    strokeStyle: 'dashed',
    strokeDasharray: [5, 5],
    zIndex: 50,
    clickable: true
  })

  // 添加流量比例标签
  if (connection.flowRatio > 0) {
    const midLng = (fromCoord.longitude + toCoord.longitude) / 2
    const midLat = (fromCoord.latitude + toCoord.latitude) / 2

    const label = new (window as any).AMap.Text({
      text: `${Math.round(connection.flowRatio * 100)}%`,
      position: [midLng, midLat],
      style: {
        'background-color': 'rgba(0,0,0,0.7)',
        'border-radius': '4px',
        'padding': '2px 6px',
        'font-size': '10px',
        'color': '#fff',
        'border': 'none'
      },
      zIndex: 51
    })

    map.add(label)
    map.add(line)

    return { line, label }
  }

  map.add(line)
  return line
}

/**
 * 渲染所有内部连接
 */
export function renderAllInternalConnections(
  map: any,
  node: HubNode,
  config: HubVisualConfig = DEFAULT_HUB_VISUAL_CONFIG,
  onClick?: (event: ConnectionClickEvent) => void
): any[] {
  if (!node.extension.isHub || !node.extension.internalConnections) return []

  const connections: any[] = []

  for (const conn of node.extension.internalConnections) {
    if (conn.isActive) {
      const visual = renderInternalConnection(map, node, conn, config, onClick)
      if (visual) connections.push(visual)
    }
  }

  return connections
}

/**
 * 渲染完整枢纽节点
 */
export function renderHubNode(
  map: any,
  node: HubNode,
  config: HubVisualConfig = DEFAULT_HUB_VISUAL_CONFIG,
  callbacks?: {
    onPortClick?: (event: PortClickEvent) => void
    onConnectionClick?: (event: ConnectionClickEvent) => void
    onNodeClick?: (event: { node: HubNode; position: Coordinate }) => void
  }
): { centerMarker: any; ports: any[]; connections: any[] } {
  // 1. 渲染中心节点标记
  const centerMarker = renderHubCenterMarker(map, node, callbacks?.onNodeClick)

  // 2. 渲染端口
  const ports = renderAllPorts(map, node, config, callbacks?.onPortClick)

  // 3. 渲染内部连接
  const connections = renderAllInternalConnections(map, node, config, callbacks?.onConnectionClick)

  return { centerMarker, ports, connections }
}

/**
 * 渲染枢纽中心节点标记
 */
function renderHubCenterMarker(
  map: any,
  node: HubNode,
  onClick?: (event: { node: HubNode; position: Coordinate }) => void
): any {
  if (!map) return null

  // 根据节点类型选择颜色
  const typeColors: Record<string, string> = {
    'compressor': '#f59e0b',   // 橙色 - 压气站
    'distribution': '#eab308',  // 黄色 - 分输站
    'source': '#22c55e',       // 绿色 - 气源
    'junction': '#3b82f6'      // 蓝色 - 枢纽
  }

  const color = typeColors[node.type] || '#f59e0b'

  // 创建SVG标记 - 圆形带边框
  const svgContent = `
    <svg width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="12" fill="${color}" stroke="#fff" stroke-width="2"/>
      <text x="16" y="20" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold">枢纽</text>
    </svg>
  `

  const marker = new (window as any).AMap.Marker({
    position: [node.coordinate.longitude, node.coordinate.latitude],
    content: svgContent,
    offset: new (window as any).AMap.Pixel(-16, -16),
    zIndex: 200,
    clickable: true,
    title: node.name  // 鼠标悬停显示名称
  })

  // 点击事件
  if (onClick) {
    marker.on('click', (e: any) => {
      onClick({
        node,
        position: node.coordinate
      })
    })
  }

  map.add(marker)
  return marker
}

/**
 * 清除枢纽节点渲染
 */
export function clearHubNodeRender(map: any, renderResult: { centerMarker?: any; ports: any[]; connections: any[] }): void {
  if (!map || !renderResult) return

  // 清除中心标记
  if (renderResult.centerMarker) {
    map.remove(renderResult.centerMarker)
  }

  // 清除端口标记
  for (const port of renderResult.ports) {
    map.remove(port)
  }

  // 清除连接线
  for (const conn of renderResult.connections) {
    if (conn.line) map.remove(conn.line)
    if (conn.label) map.remove(conn.label)
  }
}

/**
 * 根据节点连接的管线自动分配端口角度
 */
export function autoAssignPortAngles(node: HubNode): HubNode {
  if (!node.extension.isHub || !node.extension.ports) return node

  const ports = node.extension.ports
  const pipelineNames = [...new Set(ports.map(p => p.pipelineName))]

  // 为每条管线分配角度
  const pipelineAngles: Record<string, number> = {}
  const angleStep = 360 / Math.max(pipelineNames.length, 1)

  pipelineNames.forEach((name, index) => {
    // 按顺时针方向分配角度，从上方开始
    pipelineAngles[name] = -90 + index * angleStep
  })

  // 为每个端口设置角度
  const updatedPorts = ports.map(port => ({
    ...port,
    displayAngle: pipelineAngles[port.pipelineName] || 0
  }))

  return {
    ...node,
    extension: {
      ...node.extension,
      ports: updatedPorts
    }
  }
}

/**
 * 获取端口状态颜色
 */
export function getPortStatusColor(status: NodePort['status']): string {
  switch (status) {
    case 'active':
      return '#22c55e'
    case 'inactive':
      return '#6b7280'
    case 'maintenance':
      return '#eab308'
    default:
      return '#6b7280'
  }
}
