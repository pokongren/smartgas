/**
 * 枢纽节点示例数据
 *
 * 展示多端口节点的数据结构，以中卫站为例
 */

import type { HubNode } from '@/types/hub'
import { PortDirection, DistributionStrategy } from '@/types/hub'

/**
 * 中卫压气站 - 典型的多管线枢纽
 *
 * 连接：中贵线(进气) → 西气东输一线(出气)
 *       中贵线(进气) → 西气东输二线(出气)
 *       西气东输一线(反向) ↔ 西气东输二线
 */
export const zhongweiHubNode: HubNode = {
  id: 'S-676567',
  name: '中卫压气站',
  type: 'compressor',
  coordinate: {
    longitude: 105.19,
    latitude: 37.51
  },
  designPressure: 10.0,
  operatingPressure: 9.5,
  capacity: 2000,
  extension: {
    isHub: true,
    hubLevel: 1,  // 国家级枢纽
    distributionStrategy: DistributionStrategy.CAPACITY_BASED,
    ports: [
      // 中贵线进气口
      {
        portId: 'zhongwei-zhonggui-in',
        pipelineId: 'P-zhonggui',
        pipelineName: '中贵线',
        direction: PortDirection.IN,
        pressureRange: [6.0, 10.0],
        flowCapacity: 2000,
        displayAngle: -90,  // 上方
        status: 'active'
      },
      // 西气东输一线出气口
      {
        portId: 'zhongwei-xiyi-out',
        pipelineId: 'P-xiyi',
        pipelineName: '西气东输一线',
        direction: PortDirection.OUT,
        pressureRange: [8.0, 12.0],
        flowCapacity: 3000,
        displayAngle: 90,  // 下方
        status: 'active'
      },
      // 西气东输二线出气口
      {
        portId: 'zhongwei-xier-out',
        pipelineId: 'P-xier',
        pipelineName: '西气东输二线',
        direction: PortDirection.OUT,
        pressureRange: [8.0, 12.0],
        flowCapacity: 2500,
        displayAngle: 0,  // 右侧
        status: 'active'
      },
      // 西气东输一线反向进气（接收下游气源）
      {
        portId: 'zhongwei-xiyi-in',
        pipelineId: 'P-xiyi',
        pipelineName: '西气东输一线',
        direction: PortDirection.IN,
        pressureRange: [4.0, 8.0],
        flowCapacity: 1500,
        displayAngle: 180,  // 左侧
        status: 'active'
      }
    ],
    internalConnections: [
      // 中贵线 → 西气东输一线（60%流量）
      {
        fromPort: 'zhongwei-zhonggui-in',
        toPort: 'zhongwei-xiyi-out',
        flowRatio: 0.6,
        isActive: true,
        priority: 1,
        remark: '主供气通道'
      },
      // 中贵线 → 西气东输二线（40%流量）
      {
        fromPort: 'zhongwei-zhonggui-in',
        toPort: 'zhongwei-xier-out',
        flowRatio: 0.4,
        isActive: true,
        priority: 2,
        remark: '备用通道'
      }
    ]
  }
}

/**
 * 简化的中卫站（适合演示）
 * 实际连接：西气东输一线、西气东输二线、中贵线
 */
export const zhongweiHubNodeSimple: HubNode = {
  id: 'S-676567',
  name: '中卫压气站',
  type: 'compressor',
  coordinate: {
    longitude: 105.19,
    latitude: 37.51
  },
  designPressure: 10.0,
  operatingPressure: 9.5,
  capacity: 2000,
  extension: {
    isHub: true,
    hubLevel: 1,
    distributionStrategy: DistributionStrategy.PROPORTIONAL,
    ports: [
      // 中贵线进气口（来自西南方向）
      {
        portId: 'zhongwei-zg-in',
        pipelineId: 'P-zg',
        pipelineName: '中贵线',
        direction: PortDirection.IN,
        pressureRange: [6.0, 10.0],
        flowCapacity: 2000,
        displayAngle: 180,  // 左侧 - 来自西南
        status: 'active'
      },
      // 西气东输一出气口（向东输送）
      {
        portId: 'zhongwei-we1-out',
        pipelineId: 'P-we1',
        pipelineName: '西气东输一线',
        direction: PortDirection.OUT,
        pressureRange: [8.0, 12.0],
        flowCapacity: 3000,
        displayAngle: 90,  // 下方 - 向东
        status: 'active'
      },
      // 西气东输二线出气口（向东输送）
      {
        portId: 'zhongwei-we2-out',
        pipelineId: 'P-we2',
        pipelineName: '西气东输二线',
        direction: PortDirection.OUT,
        pressureRange: [8.0, 12.0],
        flowCapacity: 2500,
        displayAngle: 0,  // 右侧 - 向东
        status: 'active'
      }
    ],
    internalConnections: [
      // 中贵线 → 西气东输一线（60%流量）
      {
        fromPort: 'zhongwei-zg-in',
        toPort: 'zhongwei-we1-out',
        flowRatio: 0.6,
        isActive: true,
        remark: '主供气通道'
      },
      // 中贵线 → 西气东输二线（40%流量）
      {
        fromPort: 'zhongwei-zg-in',
        toPort: 'zhongwei-we2-out',
        flowRatio: 0.4,
        isActive: true,
        remark: '备用通道'
      }
    ]
  }
}

/**
 * 西一线古浪站
 */
export const we1GulangHubNode: HubNode = {
  id: 'S-we1-gulang',
  name: '西一线古浪压气站',
  type: 'compressor',
  coordinate: {
    longitude: 103.52,
    latitude: 37.48
  },
  designPressure: 10.0,
  operatingPressure: 9.0,
  capacity: 1800,
  extension: {
    isHub: true,
    hubLevel: 2,
    distributionStrategy: DistributionStrategy.PROPORTIONAL,
    ports: [
      {
        portId: 'gulang-we1-in',
        pipelineId: 'P-we1',
        pipelineName: '西气东输一线',
        direction: PortDirection.IN,
        pressureRange: [5.0, 9.0],
        flowCapacity: 1800,
        displayAngle: 180, // 左侧
        status: 'active'
      },
      {
        portId: 'gulang-we1-out',
        pipelineId: 'P-we1',
        pipelineName: '西气东输一线',
        direction: PortDirection.OUT,
        pressureRange: [7.0, 11.0],
        flowCapacity: 1800,
        displayAngle: 0, // 右侧
        status: 'active'
      }
    ],
    internalConnections: [
      {
        fromPort: 'gulang-we1-in',
        toPort: 'gulang-we1-out',
        flowRatio: 1.0,
        isActive: true,
        remark: '干线直通'
      }
    ]
  }
}

/**
 * 西二线古浪站
 */
export const we2GulangHubNode: HubNode = {
  id: 'S-we2-gulang',
  name: '西二线古浪压气站',
  type: 'compressor',
  coordinate: {
    longitude: 103.00,
    latitude: 37.60
  },
  designPressure: 12.0,
  operatingPressure: 10.5,
  capacity: 2500,
  extension: {
    isHub: true,
    hubLevel: 2,
    distributionStrategy: DistributionStrategy.PROPORTIONAL,
    ports: [
      {
        portId: 'gulang-we2-in',
        pipelineId: 'P-we2',
        pipelineName: '西气东输二线',
        direction: PortDirection.IN,
        pressureRange: [7.0, 11.0],
        flowCapacity: 2500,
        displayAngle: 180,
        status: 'active'
      },
      {
        portId: 'gulang-we2-out',
        pipelineId: 'P-we2',
        pipelineName: '西气东输二线',
        direction: PortDirection.OUT,
        pressureRange: [9.0, 12.0],
        flowCapacity: 2500,
        displayAngle: 0,
        status: 'active'
      }
    ],
    internalConnections: [
      {
        fromPort: 'gulang-we2-in',
        toPort: 'gulang-we2-out',
        flowRatio: 1.0,
        isActive: true,
        remark: '干线直通'
      }
    ]
  }
}

/**
 * 多个枢纽节点示例
 */
export const hubNodesSample: HubNode[] = [
  zhongweiHubNodeSimple,
  we1GulangHubNode,
  we2GulangHubNode
]

/**
 * 判断节点是否为枢纽节点
 */
export function isHubNode(node: any): node is HubNode {
  return node?.extension?.isHub === true
}

/**
 * 从普通节点列表中筛选出枢纽节点
 */
export function filterHubNodes(nodes: any[]): HubNode[] {
  return nodes.filter(isHubNode)
}
