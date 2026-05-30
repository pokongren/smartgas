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
 * 中卫站阀组（前端可展开）
 *
 * 表达站内阀组把上游来气、下游外输和跨线调配关系接在一起。
 * 这里是前端展示模型，管线 ID 尽量贴近现有样板数据：WE1-T-75 / WE2-T-87 / ZG-T-1。
 */
export const zhongweiHubNodeSimple: HubNode = {
  id: 'WE1-76',
  name: '中卫站阀组',
  type: 'junction',
  coordinate: {
    longitude: 105.19,
    latitude: 37.51
  },
  designPressure: 12.0,
  operatingPressure: 9.5,
  capacity: 3000,
  extension: {
    isHub: true,
    hubLevel: 1,
    distributionStrategy: DistributionStrategy.PRIORITY,
    processFlow: {
      summary: '站内流程：西一线干线贯通，西二线跨站联络，中贵线从中卫枢纽外输',
      valves: [
        {
          id: 'zw101',
          label: 'ZW101',
          name: '西一线上游进站阀',
          x: 31,
          y: 30,
          angle: 0,
          cutoffAction: {
            stage: 'we1',
            label: '中卫西一线截断',
            description: '关闭中卫站西一线上游进站阀，外部地图同步展示西一线中卫节点前后拓扑断开。'
          }
        },
        {
          id: 'zw102',
          label: 'ZW102',
          name: '西一线下游出站阀',
          x: 74,
          y: 30,
          angle: 0,
          cutoffAction: {
            stage: 'we1',
            label: '中卫西一线出站截断',
            description: '关闭中卫站西一线下游出站阀，外部地图同步高亮中卫至下游方向停流段。'
          }
        },
        {
          id: 'zw201',
          label: 'ZW201',
          name: '西二线上游联络阀',
          x: 31,
          y: 62,
          angle: 0,
          cutoffAction: {
            stage: 'we2',
            label: '中卫西二线截断',
            description: '关闭中卫站西二线联络阀，外部地图同步展示西二线接入中卫的截断段。'
          }
        },
        {
          id: 'zw202',
          label: 'ZW202',
          name: '西二线下游联络阀',
          x: 74,
          y: 62,
          angle: 0,
          cutoffAction: {
            stage: 'we2',
            label: '中卫西二线外输截断',
            description: '关闭中卫站西二线下游联络阀，外部地图同步展示西二线中卫外输方向停流。'
          }
        },
        {
          id: 'zw301',
          label: 'ZW301',
          name: '中贵线外输阀',
          x: 56,
          y: 75,
          angle: 90,
          cutoffAction: {
            stage: 'zg',
            label: '中卫中贵线截断',
            description: '关闭中卫站中贵线外输阀，外部地图同步展示中贵线从中卫枢纽脱开的拓扑影响。'
          }
        },
      ],
      connectionValveMap: {
        'zhongwei-we1-upstream-in->zhongwei-we1-downstream-out': ['zw101', 'zw102'],
        'zhongwei-we2-upstream-in->zhongwei-we2-downstream-out': ['zw201', 'zw202'],
        'zhongwei-we2-upstream-in->zhongwei-zg-downstream-out': ['zw201', 'zw301'],
      },
    },
    ports: [
      // 西一线上游来气
      {
        portId: 'zhongwei-we1-upstream-in',
        pipelineId: 'WE1-T-75',
        pipelineName: '西气东输一线 上游段',
        direction: PortDirection.IN,
        pressureRange: [6.5, 12.0],
        flowCapacity: 3000,
        displayAngle: 180,
        status: 'active',
        valveGroupName: '西一线上游阀组',
        connectionSide: 'upstream',
        currentThroughput: 1650,
        currentPressure: 9.3,
        currentTemperature: 28.6,
        diagramPosition: { x: 10, y: 30, labelX: 4, labelY: 19 }
      },
      // 西二线上游来气
      {
        portId: 'zhongwei-we2-upstream-in',
        pipelineId: 'WE2-T-87',
        pipelineName: '西气东输二线 上游段',
        direction: PortDirection.IN,
        pressureRange: [7.0, 12.0],
        flowCapacity: 2500,
        displayAngle: 180,
        status: 'active',
        valveGroupName: '西二线上游阀组',
        connectionSide: 'upstream',
        currentThroughput: 760,
        currentPressure: 9.0,
        currentTemperature: 27.9,
        diagramPosition: { x: 10, y: 62, labelX: 4, labelY: 67 }
      },
      // 西一线下游外输
      {
        portId: 'zhongwei-we1-downstream-out',
        pipelineId: 'WE1-T-76',
        pipelineName: '西气东输一线 下游段',
        direction: PortDirection.OUT,
        pressureRange: [8.0, 12.0],
        flowCapacity: 3000,
        displayAngle: 0,
        status: 'active',
        valveGroupName: '西一线下游阀组',
        connectionSide: 'downstream',
        currentThroughput: 2410,
        currentPressure: 9.1,
        currentTemperature: 29.2,
        diagramPosition: { x: 90, y: 30, labelX: 69, labelY: 19 }
      },
      // 西二线下游外输
      {
        portId: 'zhongwei-we2-downstream-out',
        pipelineId: 'WE2-T-88',
        pipelineName: '西气东输二线 下游段',
        direction: PortDirection.OUT,
        pressureRange: [7.0, 12.0],
        flowCapacity: 2500,
        displayAngle: 0,
        status: 'active',
        valveGroupName: '西二线下游阀组',
        connectionSide: 'downstream',
        currentThroughput: 760,
        currentPressure: 9.0,
        currentTemperature: 28.1,
        diagramPosition: { x: 90, y: 62, labelX: 69, labelY: 51 }
      },
      // 中贵线外输/调配
      {
        portId: 'zhongwei-zg-downstream-out',
        pipelineId: 'ZG-T-1',
        pipelineName: '中贵线 外输段',
        direction: PortDirection.OUT,
        pressureRange: [6.0, 10.0],
        flowCapacity: 2000,
        displayAngle: -90,
        status: 'active',
        valveGroupName: '中贵线外输阀组',
        connectionSide: 'downstream',
        currentThroughput: 520,
        currentPressure: 8.6,
        currentTemperature: 28.1,
        diagramPosition: { x: 56, y: 88, labelX: 58, labelY: 78 }
      }
    ],
    internalConnections: [
      // 西一线上游 → 西一线下游
      {
        fromPort: 'zhongwei-we1-upstream-in',
        toPort: 'zhongwei-we1-downstream-out',
        flowRatio: 0.55,
        isActive: true,
        priority: 3,
        remark: '西一线主流程贯通',
        currentThroughput: 1650,
        currentPressure: 9.2,
        currentTemperature: 28.9
      },
      // 西二线上游 → 西二线下游
      {
        fromPort: 'zhongwei-we2-upstream-in',
        toPort: 'zhongwei-we2-downstream-out',
        flowRatio: 0.35,
        isActive: true,
        priority: 2,
        remark: '西二线主流程贯通',
        currentThroughput: 760,
        currentPressure: 9.0,
        currentTemperature: 28.4
      },
      // 西二线上游 → 中贵线外输
      {
        fromPort: 'zhongwei-we2-upstream-in',
        toPort: 'zhongwei-zg-downstream-out',
        flowRatio: 0.15,
        isActive: true,
        priority: 1,
        remark: '西二线转供中贵线通道',
        currentThroughput: 520,
        currentPressure: 8.7,
        currentTemperature: 28.2
      }
    ]
  }
}

/**
 * 甪直分输站（点进去工艺流程页）
 *
 * 基于现有台账关系表达：嘉甪联络线进站，西一线干线东段贯通，并向甪宝支线外输。
 * 压力/温度取当前前端 SCADA 展示口径；流量为演示展示值，不代表实时调度量。
 */
export const luzhiProcessHubNode: HubNode = {
  id: 'WE1-179',
  name: '甪直分输站',
  type: 'distribution',
  coordinate: {
    longitude: 120.87,
    latitude: 31.27
  },
  designPressure: 10.0,
  operatingPressure: 5.1,
  capacity: 1000,
  extension: {
    isHub: true,
    hubLevel: 2,
    distributionStrategy: DistributionStrategy.PRIORITY,
    processFlow: {
      summary: '站内流程：嘉甪联络线进站，西一线干线贯通，并向甪宝支线外输',
      valves: [
        {
          id: 'lz101',
          label: 'LZ101',
          name: '嘉甪联络线进站阀',
          x: 31,
          y: 30,
          angle: 0,
          cutoffAction: {
            stage: 'jxlz',
            label: '甪直嘉甪联络线截断',
            description: '关闭甪直站嘉甪联络线进站阀，外部地图同步展示嘉兴-甪直联络线接入点截断。'
          }
        },
        {
          id: 'lz102',
          label: 'LZ102',
          name: '西一线下游阀',
          x: 74,
          y: 30,
          angle: 0,
          cutoffAction: {
            stage: 'we1',
            label: '甪直西一线下游截断',
            description: '关闭甪直站西一线下游阀，外部地图同步展示昆山/白鹤方向拓扑断开。'
          }
        },
        {
          id: 'lz201',
          label: 'LZ201',
          name: '西一线干线进站阀',
          x: 31,
          y: 62,
          angle: 0,
          cutoffAction: {
            stage: 'we1',
            label: '甪直西一线进站截断',
            description: '关闭甪直站西一线干线进站阀，外部地图同步展示甪直上游侧断开。'
          }
        },
        {
          id: 'lz202',
          label: 'LZ202',
          name: '西一线干线出站阀',
          x: 74,
          y: 62,
          angle: 0,
          cutoffAction: {
            stage: 'we1',
            label: '甪直西一线出站截断',
            description: '关闭甪直站西一线干线出站阀，外部地图同步展示甪直下游侧停流。'
          }
        },
        {
          id: 'lz301',
          label: 'LZ301',
          name: '甪宝支线外输阀',
          x: 56,
          y: 75,
          angle: 90,
          cutoffAction: {
            stage: 'lubao',
            label: '甪直甪宝支线截断',
            description: '关闭甪直站甪宝支线外输阀，外部地图同步展示甪宝支线脱开和支线停流范围。'
          }
        },
      ],
      connectionValveMap: {
        'luzhi-jxlz-in->luzhi-we1-downstream-out': ['lz101', 'lz102'],
        'luzhi-we1-upstream-in->luzhi-we1-downstream-out': ['lz201', 'lz202'],
        'luzhi-we1-upstream-in->luzhi-lubao-out': ['lz201', 'lz301'],
      },
    },
    ports: [
      {
        portId: 'luzhi-jxlz-in',
        pipelineId: 'RAW-PL-0003',
        pipelineName: '西二西一嘉甪联络线',
        direction: PortDirection.IN,
        pressureRange: [4.0, 10.0],
        flowCapacity: 1000,
        displayAngle: 180,
        status: 'active',
        valveGroupName: '嘉甪联络线上游',
        connectionSide: 'upstream',
        currentThroughput: 420,
        currentPressure: 5.1,
        currentTemperature: 7.9,
        diagramPosition: { x: 10, y: 30, labelX: 4, labelY: 19 }
      },
      {
        portId: 'luzhi-we1-upstream-in',
        pipelineId: 'WE1-T-178',
        pipelineName: '西气东输一线 干线东段上游',
        direction: PortDirection.IN,
        pressureRange: [4.0, 10.0],
        flowCapacity: 1800,
        displayAngle: 180,
        status: 'active',
        valveGroupName: '西一线干线上游',
        connectionSide: 'upstream',
        currentThroughput: 860,
        currentPressure: 5.1,
        currentTemperature: 7.9,
        diagramPosition: { x: 10, y: 62, labelX: 4, labelY: 67 }
      },
      {
        portId: 'luzhi-we1-downstream-out',
        pipelineId: 'WE1-T-179',
        pipelineName: '西气东输一线 昆山/白鹤方向',
        direction: PortDirection.OUT,
        pressureRange: [4.0, 10.0],
        flowCapacity: 1800,
        displayAngle: 0,
        status: 'active',
        valveGroupName: '西一线下游阀组',
        connectionSide: 'downstream',
        currentThroughput: 980,
        currentPressure: 5.1,
        currentTemperature: 7.9,
        diagramPosition: { x: 90, y: 30, labelX: 69, labelY: 19 }
      },
      {
        portId: 'luzhi-lubao-out',
        pipelineId: 'RAW-PL-0358',
        pipelineName: '甪宝支线 浏河方向',
        direction: PortDirection.OUT,
        pressureRange: [3.0, 4.0],
        flowCapacity: 610,
        displayAngle: -90,
        status: 'active',
        valveGroupName: '甪宝支线外输',
        connectionSide: 'downstream',
        currentThroughput: 300,
        currentPressure: 5.1,
        currentTemperature: 7.9,
        diagramPosition: { x: 56, y: 88, labelX: 58, labelY: 78 }
      }
    ],
    internalConnections: [
      {
        fromPort: 'luzhi-jxlz-in',
        toPort: 'luzhi-we1-downstream-out',
        flowRatio: 0.35,
        isActive: true,
        priority: 2,
        remark: '嘉甪联络线来气并入西一线下游',
        currentThroughput: 420,
        currentPressure: 5.1,
        currentTemperature: 7.9
      },
      {
        fromPort: 'luzhi-we1-upstream-in',
        toPort: 'luzhi-we1-downstream-out',
        flowRatio: 0.45,
        isActive: true,
        priority: 3,
        remark: '西一线干线主流程贯通',
        currentThroughput: 680,
        currentPressure: 5.1,
        currentTemperature: 7.9
      },
      {
        fromPort: 'luzhi-we1-upstream-in',
        toPort: 'luzhi-lubao-out',
        flowRatio: 0.20,
        isActive: true,
        priority: 1,
        remark: '甪宝支线外输通道',
        currentThroughput: 300,
        currentPressure: 5.1,
        currentTemperature: 7.9
      }
    ]
  }
}

/**
 * 西一靖边压气站（点进去工艺流程页）
 *
 * 表达中靖支干线/西三中靖联络来气在靖边汇集，并向西一线下游、陕京二线和靖边联络线外输。
 * 压力/温度参考当前前端 SCADA 展示口径；流量为演示展示值，不代表实时调度量。
 */
export const jingbianProcessHubNode: HubNode = {
  id: 'WE1-92',
  name: '西一靖边压气站',
  type: 'compressor',
  coordinate: {
    longitude: 108.79,
    latitude: 37.59
  },
  designPressure: 10.0,
  operatingPressure: 8.9,
  capacity: 1580,
  extension: {
    isHub: true,
    hubLevel: 1,
    distributionStrategy: DistributionStrategy.CAPACITY_BASED,
    processFlow: {
      summary: '站内流程：中靖支干线进站提压，西三中靖联络补充，并向西一线与陕京方向外输',
      valves: [
        {
          id: 'jb101',
          label: 'JB101',
          name: '中靖支干线进站阀',
          x: 31,
          y: 30,
          angle: 0,
          cutoffAction: {
            stage: 'we1',
            label: '中靖进站截断',
            description: '关闭中靖支干线进站方向，外部地图同步展示靖边西一线关联截断'
          }
        },
        {
          id: 'jb102',
          label: 'JB102',
          name: '西一线下游出站阀',
          x: 74,
          y: 30,
          angle: 0,
          cutoffAction: {
            stage: 'we1',
            label: '西一线截断',
            description: '关闭西一线转供/出站方向，外部地图同步展示西一线截断前后路径'
          }
        },
        {
          id: 'jb201',
          label: 'JB201',
          name: '西三中靖联络进站阀',
          x: 31,
          y: 62,
          angle: 0,
          cutoffAction: {
            stage: 'sj2',
            label: '西三联络进站截断',
            description: '关闭西三中靖联络进站方向，外部地图同步展示陕京方向停流影响'
          }
        },
        {
          id: 'jb202',
          label: 'JB202',
          name: '陕京二线外输阀',
          x: 74,
          y: 62,
          angle: 0,
          cutoffAction: {
            stage: 'sj2',
            label: '陕京二线截断',
            description: '关闭陕京二线外输方向，外部地图同步停流陕京二线'
          }
        },
        {
          id: 'jb301',
          label: 'JB301',
          name: '靖边联络线外输阀',
          x: 56,
          y: 75,
          angle: 90,
          cutoffAction: {
            stage: 'sj4',
            label: '联络线截断',
            description: '关闭靖边联络线外输方向，外部地图同步停流陕京靖边首站方向'
          }
        },
      ],
      connectionValveMap: {
        'jingbian-zhongjing-in->jingbian-we1-out': ['jb101', 'jb102'],
        'jingbian-we3-in->jingbian-sj2-out': ['jb201', 'jb202'],
        'jingbian-zhongjing-in->jingbian-sj-link-out': ['jb101', 'jb301'],
      },
    },
    ports: [
      {
        portId: 'jingbian-zhongjing-in',
        pipelineId: 'RAW-PL-0047',
        pipelineName: '中靖支干线 中卫方向',
        direction: PortDirection.IN,
        pressureRange: [6.0, 10.0],
        flowCapacity: 1450,
        displayAngle: 180,
        status: 'active',
        valveGroupName: '中靖支干线进站',
        connectionSide: 'upstream',
        currentThroughput: 1180,
        currentPressure: 6.7,
        currentTemperature: 5.7,
        diagramPosition: { x: 10, y: 30, labelX: 4, labelY: 19 }
      },
      {
        portId: 'jingbian-we3-in',
        pipelineId: 'RAW-PL-0376',
        pipelineName: '西三线中靖联络线',
        direction: PortDirection.IN,
        pressureRange: [7.0, 12.0],
        flowCapacity: 1580,
        displayAngle: 180,
        status: 'active',
        valveGroupName: '西三中靖联络进站',
        connectionSide: 'upstream',
        currentThroughput: 520,
        currentPressure: 8.9,
        currentTemperature: 34.9,
        diagramPosition: { x: 10, y: 62, labelX: 4, labelY: 67 }
      },
      {
        portId: 'jingbian-we1-out',
        pipelineId: 'WE1-T-92',
        pipelineName: '西气东输一线 下游段',
        direction: PortDirection.OUT,
        pressureRange: [7.0, 10.0],
        flowCapacity: 1450,
        displayAngle: 0,
        status: 'active',
        valveGroupName: '西一线下游出站',
        connectionSide: 'downstream',
        currentThroughput: 980,
        currentPressure: 8.9,
        currentTemperature: 34.9,
        diagramPosition: { x: 90, y: 30, labelX: 69, labelY: 19 }
      },
      {
        portId: 'jingbian-sj2-out',
        pipelineId: 'RAW-PL-0451',
        pipelineName: '陕京二线 通州东方向',
        direction: PortDirection.OUT,
        pressureRange: [7.0, 10.0],
        flowCapacity: 1450,
        displayAngle: 0,
        status: 'active',
        valveGroupName: '陕京二线外输',
        connectionSide: 'downstream',
        currentThroughput: 520,
        currentPressure: 8.9,
        currentTemperature: 34.9,
        diagramPosition: { x: 90, y: 62, labelX: 69, labelY: 51 }
      },
      {
        portId: 'jingbian-sj-link-out',
        pipelineId: 'RAW-PL-0452',
        pipelineName: '靖边联络线 陕京靖边首站',
        direction: PortDirection.OUT,
        pressureRange: [7.0, 12.0],
        flowCapacity: 800,
        displayAngle: -90,
        status: 'active',
        valveGroupName: '靖边联络线外输',
        connectionSide: 'downstream',
        currentThroughput: 260,
        currentPressure: 8.9,
        currentTemperature: 34.9,
        diagramPosition: { x: 56, y: 88, labelX: 58, labelY: 78 }
      }
    ],
    internalConnections: [
      {
        fromPort: 'jingbian-zhongjing-in',
        toPort: 'jingbian-we1-out',
        flowRatio: 0.55,
        isActive: true,
        priority: 3,
        remark: '中靖支干线进站提压后送入西一线下游',
        currentThroughput: 980,
        currentPressure: 8.9,
        currentTemperature: 34.9
      },
      {
        fromPort: 'jingbian-we3-in',
        toPort: 'jingbian-sj2-out',
        flowRatio: 0.30,
        isActive: true,
        priority: 2,
        remark: '西三中靖联络补充后外输陕京二线',
        currentThroughput: 520,
        currentPressure: 8.9,
        currentTemperature: 34.9
      },
      {
        fromPort: 'jingbian-zhongjing-in',
        toPort: 'jingbian-sj-link-out',
        flowRatio: 0.15,
        isActive: true,
        priority: 1,
        remark: '靖边联络线送陕京靖边首站',
        currentThroughput: 260,
        currentPressure: 8.9,
        currentTemperature: 34.9
      }
    ]
  }
}

/**
 * 广州压气站（点进去工艺流程页）
 *
 * 表达西气东输二线吉安方向来气在广州站增压后，向广南支干线、广深支干线及广东省网外输。
 * 压力/温度参考当前前端 SCADA 展示口径；流量为演示展示值，不代表实时调度量。
 */
export const guangzhouProcessHubNode: HubNode = {
  id: 'GZ-PROCESS-HUB',
  name: '广州压气站',
  type: 'compressor',
  coordinate: {
    longitude: 113.26,
    latitude: 23.13
  },
  designPressure: 10.0,
  operatingPressure: 9.2,
  capacity: 2600,
  extension: {
    isHub: true,
    hubLevel: 1,
    distributionStrategy: DistributionStrategy.PRIORITY,
    processFlow: {
      summary: '站内流程：西二线吉安方向来气进站，经压缩机组增压后分输广南、广深及广东省网',
      valves: [
        { id: 'gz101', label: 'GZ101', name: '西二线进站阀', x: 31, y: 30, angle: 0 },
        { id: 'gz102', label: 'GZ102', name: '压缩机出口母管阀', x: 52, y: 30, angle: 0 },
        { id: 'gz201', label: 'GZ201', name: '广南支干线外输阀', x: 74, y: 30, angle: 0 },
        { id: 'gz301', label: 'GZ301', name: '广深支干线外输阀', x: 74, y: 62, angle: 0 },
        { id: 'gz401', label: 'GZ401', name: '广东省网外输阀', x: 56, y: 75, angle: 90 },
      ],
      connectionValveMap: {
        'guangzhou-we2-in->guangzhou-gn-out': ['gz101', 'gz102', 'gz201'],
        'guangzhou-we2-in->guangzhou-gs-out': ['gz101', 'gz102', 'gz301'],
        'guangzhou-we2-in->guangzhou-city-out': ['gz101', 'gz102', 'gz401'],
      },
    },
    ports: [
      {
        portId: 'guangzhou-we2-in',
        pipelineId: 'WE2-GZ-IN',
        pipelineName: '西气东输二线 吉安-广州段',
        direction: PortDirection.IN,
        pressureRange: [6.0, 10.0],
        flowCapacity: 2600,
        displayAngle: 180,
        status: 'active',
        valveGroupName: '西二线进站阀组',
        connectionSide: 'upstream',
        currentThroughput: 2120,
        currentPressure: 6.66,
        currentTemperature: 22.6,
        diagramPosition: { x: 10, y: 30, labelX: 4, labelY: 19 }
      },
      {
        portId: 'guangzhou-backup-in',
        pipelineId: 'GD-NET-BACKUP',
        pipelineName: '广东省网回供/备用接口',
        direction: PortDirection.IN,
        pressureRange: [4.0, 8.0],
        flowCapacity: 900,
        displayAngle: 180,
        status: 'inactive',
        valveGroupName: '省网备用接口',
        connectionSide: 'upstream',
        currentThroughput: 0,
        currentPressure: 6.1,
        currentTemperature: 24.0,
        diagramPosition: { x: 10, y: 62, labelX: 4, labelY: 67 }
      },
      {
        portId: 'guangzhou-gn-out',
        pipelineId: 'GN-T-1',
        pipelineName: '广南支干线 南宁方向',
        direction: PortDirection.OUT,
        pressureRange: [7.0, 10.0],
        flowCapacity: 1600,
        displayAngle: 0,
        status: 'active',
        valveGroupName: '广南外输阀组',
        connectionSide: 'downstream',
        currentThroughput: 1180,
        currentPressure: 9.17,
        currentTemperature: 47.7,
        diagramPosition: { x: 90, y: 30, labelX: 69, labelY: 19 }
      },
      {
        portId: 'guangzhou-gs-out',
        pipelineId: 'GS-T-1',
        pipelineName: '广深支干线 深圳方向',
        direction: PortDirection.OUT,
        pressureRange: [7.0, 10.0],
        flowCapacity: 1100,
        displayAngle: 0,
        status: 'active',
        valveGroupName: '广深外输阀组',
        connectionSide: 'downstream',
        currentThroughput: 720,
        currentPressure: 9.05,
        currentTemperature: 46.8,
        diagramPosition: { x: 90, y: 62, labelX: 69, labelY: 51 }
      },
      {
        portId: 'guangzhou-city-out',
        pipelineId: 'GD-CITY-GATE',
        pipelineName: '广东省网/城市门站',
        direction: PortDirection.OUT,
        pressureRange: [4.0, 8.0],
        flowCapacity: 900,
        displayAngle: -90,
        status: 'active',
        valveGroupName: '省网外输阀组',
        connectionSide: 'downstream',
        currentThroughput: 220,
        currentPressure: 7.2,
        currentTemperature: 36.5,
        diagramPosition: { x: 56, y: 88, labelX: 58, labelY: 78 }
      }
    ],
    internalConnections: [
      {
        fromPort: 'guangzhou-we2-in',
        toPort: 'guangzhou-gn-out',
        flowRatio: 0.56,
        isActive: true,
        priority: 3,
        remark: '西二线来气增压后主供广南支干线',
        currentThroughput: 1180,
        currentPressure: 9.17,
        currentTemperature: 47.7
      },
      {
        fromPort: 'guangzhou-we2-in',
        toPort: 'guangzhou-gs-out',
        flowRatio: 0.34,
        isActive: true,
        priority: 2,
        remark: '分输广深支干线，支撑珠三角南部用气',
        currentThroughput: 720,
        currentPressure: 9.05,
        currentTemperature: 46.8
      },
      {
        fromPort: 'guangzhou-we2-in',
        toPort: 'guangzhou-city-out',
        flowRatio: 0.10,
        isActive: true,
        priority: 1,
        remark: '小流量外输广东省网/城市门站',
        currentThroughput: 220,
        currentPressure: 7.2,
        currentTemperature: 36.5
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
  luzhiProcessHubNode,
  jingbianProcessHubNode,
  guangzhouProcessHubNode,
  we1GulangHubNode,
  we2GulangHubNode
]

export const processHubNodes: HubNode[] = [
  zhongweiHubNodeSimple,
  luzhiProcessHubNode,
  jingbianProcessHubNode,
  guangzhouProcessHubNode
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
