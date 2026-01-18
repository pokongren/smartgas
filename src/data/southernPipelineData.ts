import type { PipelineData } from '@/types'
import { NodeType, PipelineStatus, PressureLevel, DeviceType } from '@/types'

/**
 * 南部管网系统示例数据(简化版)
 */

// 气源/首站列表
export const sourceNodes = [
    '瑞丽', '中卫', '深圳LNG', '北海LNG'
]

// 压气站列表
export const compressorStations = [
    '贵阳', '广州', '梧州'
]

// 南部管网示例数据
export const southernPipelineData: PipelineData = {
    nodes: [
        // 中缅线主要站场
        {
            id: 'node-001',
            name: '瑞丽',
            type: NodeType.VALVE,
            coordinate: { longitude: 97.85, latitude: 24.01 },
            status: PipelineStatus.NORMAL,
            pressureLevel: PressureLevel.HIGH,
            properties: { pressureIn: 9.5, pressureOut: 9.2, isSource: true }
        },
        {
            id: 'node-002',
            name: '保山',
            type: NodeType.REGULATOR,
            coordinate: { longitude: 99.17, latitude: 25.11 },
            status: PipelineStatus.NORMAL,
            pressureLevel: PressureLevel.HIGH,
            properties: { pressureIn: 8.8, pressureOut: 9.5, isCompressor: true }
        },
        {
            id: 'node-003',
            name: '昆明东站',
            type: NodeType.JUNCTION,
            coordinate: { longitude: 102.85, latitude: 24.95 },
            status: PipelineStatus.NORMAL,
            pressureLevel: PressureLevel.HIGH,
            properties: { pressureIn: 8.2, pressureOut: 8.0 }
        },
        {
            id: 'node-004',
            name: '贵阳',
            type: NodeType.REGULATOR,
            coordinate: { longitude: 106.71, latitude: 26.57 },
            status: PipelineStatus.NORMAL,
            pressureLevel: PressureLevel.HIGH,
            properties: { pressureIn: 7.5, pressureOut: 8.8, isCompressor: true }
        },
        {
            id: 'node-005',
            name: '贵港',
            type: NodeType.JUNCTION,
            coordinate: { longitude: 109.60, latitude: 23.09 },
            status: PipelineStatus.NORMAL,
            pressureLevel: PressureLevel.MEDIUM_HIGH,
            properties: { pressureIn: 6.8, pressureOut: 6.5 }
        },

        // 中贵线主要站场
        {
            id: 'node-006',
            name: '中卫',
            type: NodeType.VALVE,
            coordinate: { longitude: 106.0, latitude: 37.51 },
            status: PipelineStatus.NORMAL,
            pressureLevel: PressureLevel.HIGH,
            properties: { pressureIn: 9.6, pressureOut: 11.25, isSource: true }
        },
        {
            id: 'node-007',
            name: '广元',
            type: NodeType.REGULATOR,
            coordinate: { longitude: 106.0, latitude: 32.43 },
            status: PipelineStatus.NORMAL,
            pressureLevel: PressureLevel.HIGH,
            properties: { pressureIn: 8.5, pressureOut: 9.2, isCompressor: true }
        },

        // 西二线主要站场
        {
            id: 'node-008',
            name: '广州',
            type: NodeType.REGULATOR,
            coordinate: { longitude: 113.38, latitude: 23.22 },
            status: PipelineStatus.NORMAL,
            pressureLevel: PressureLevel.HIGH,
            properties: { pressureIn: 7.8, pressureOut: 8.5, isCompressor: true }
        },
        {
            id: 'node-009',
            name: '深圳',
            type: NodeType.JUNCTION,
            coordinate: { longitude: 114.08, latitude: 22.54 },
            status: PipelineStatus.NORMAL,
            pressureLevel: PressureLevel.MEDIUM_HIGH,
            properties: { pressureIn: 7.2, pressureOut: 7.0 }
        },
        {
            id: 'node-010',
            name: '深圳LNG',
            type: NodeType.VALVE,
            coordinate: { longitude: 114.43, latitude: 22.60 },
            status: PipelineStatus.NORMAL,
            pressureLevel: PressureLevel.HIGH,
            properties: { pressureIn: 8.5, pressureOut: 8.2, isSource: true }
        },

        // 广南/广西主要站场
        {
            id: 'node-011',
            name: '梧州',
            type: NodeType.REGULATOR,
            coordinate: { longitude: 111.29, latitude: 23.48 },
            status: PipelineStatus.NORMAL,
            pressureLevel: PressureLevel.HIGH,
            properties: { pressureIn: 7.5, pressureOut: 8.2, isCompressor: true }
        },
        {
            id: 'node-012',
            name: '北海LNG',
            type: NodeType.VALVE,
            coordinate: { longitude: 109.12, latitude: 21.30 },
            status: PipelineStatus.NORMAL,
            pressureLevel: PressureLevel.HIGH,
            properties: { pressureIn: 8.8, pressureOut: 8.5, isSource: true }
        },
    ],

    lines: [
        // 中缅干线
        {
            id: 'line-001',
            name: '中缅干线(瑞丽-保山)',
            startNodeId: 'node-001',
            endNodeId: 'node-002',
            path: [
                { longitude: 97.85, latitude: 24.01 },
                { longitude: 99.17, latitude: 25.11 }
            ],
            diameter: 1016,
            material: '钢管',
            length: 180,
            pressureLevel: PressureLevel.HIGH,
            status: PipelineStatus.NORMAL,
            properties: { category: '中缅线', type: 'trunk' }
        },
        {
            id: 'line-002',
            name: '中缅干线(保山-昆明)',
            startNodeId: 'node-002',
            endNodeId: 'node-003',
            path: [
                { longitude: 99.17, latitude: 25.11 },
                { longitude: 102.85, latitude: 24.95 }
            ],
            diameter: 1016,
            material: '钢管',
            length: 320,
            pressureLevel: PressureLevel.HIGH,
            status: PipelineStatus.NORMAL,
            properties: { category: '中缅线', type: 'trunk' }
        },
        {
            id: 'line-003',
            name: '中缅干线(昆明-贵阳)',
            startNodeId: 'node-003',
            endNodeId: 'node-004',
            path: [
                { longitude: 102.85, latitude: 24.95 },
                { longitude: 106.71, latitude: 26.57 }
            ],
            diameter: 1016,
            material: '钢管',
            length: 420,
            pressureLevel: PressureLevel.HIGH,
            status: PipelineStatus.NORMAL,
            properties: { category: '中缅线', type: 'trunk' }
        },
        {
            id: 'line-004',
            name: '中缅干线(贵阳-贵港)',
            startNodeId: 'node-004',
            endNodeId: 'node-005',
            path: [
                { longitude: 106.71, latitude: 26.57 },
                { longitude: 109.60, latitude: 23.09 }
            ],
            diameter: 1016,
            material: '钢管',
            length: 480,
            pressureLevel: PressureLevel.HIGH,
            status: PipelineStatus.NORMAL,
            properties: { category: '中缅线', type: 'trunk' }
        },

        // 中贵干线
        {
            id: 'line-005',
            name: '中贵干线(中卫-广元)',
            startNodeId: 'node-006',
            endNodeId: 'node-007',
            path: [
                { longitude: 106.0, latitude: 37.51 },
                { longitude: 106.0, latitude: 32.43 }
            ],
            diameter: 1016,
            material: '钢管',
            length: 580,
            pressureLevel: PressureLevel.HIGH,
            status: PipelineStatus.NORMAL,
            properties: { category: '中贵线', type: 'trunk' }
        },
        {
            id: 'line-006',
            name: '中贵干线(广元-贵阳)',
            startNodeId: 'node-007',
            endNodeId: 'node-004',
            path: [
                { longitude: 106.0, latitude: 32.43 },
                { longitude: 106.71, latitude: 26.57 }
            ],
            diameter: 1016,
            material: '钢管',
            length: 680,
            pressureLevel: PressureLevel.HIGH,
            status: PipelineStatus.NORMAL,
            properties: { category: '中贵线', type: 'trunk' }
        },

        // 西二线
        {
            id: 'line-007',
            name: '广深干线',
            startNodeId: 'node-008',
            endNodeId: 'node-009',
            path: [
                { longitude: 113.38, latitude: 23.22 },
                { longitude: 114.08, latitude: 22.54 }
            ],
            diameter: 1016,
            material: '钢管',
            length: 120,
            pressureLevel: PressureLevel.HIGH,
            status: PipelineStatus.NORMAL,
            properties: { category: '西二线', type: 'trunk' }
        },
        {
            id: 'line-008',
            name: '深圳LNG外输',
            startNodeId: 'node-010',
            endNodeId: 'node-009',
            path: [
                { longitude: 114.43, latitude: 22.60 },
                { longitude: 114.08, latitude: 22.54 }
            ],
            diameter: 610,
            material: '钢管',
            length: 35,
            pressureLevel: PressureLevel.MEDIUM_HIGH,
            status: PipelineStatus.NORMAL,
            properties: { category: 'LNG外输', type: 'branch' }
        },

        // 广南/广西
        {
            id: 'line-009',
            name: '广南广东段',
            startNodeId: 'node-008',
            endNodeId: 'node-011',
            path: [
                { longitude: 113.38, latitude: 23.22 },
                { longitude: 111.29, latitude: 23.48 }
            ],
            diameter: 1016,
            material: '钢管',
            length: 220,
            pressureLevel: PressureLevel.HIGH,
            status: PipelineStatus.NORMAL,
            properties: { category: '广南/广西', type: 'trunk' }
        },
        {
            id: 'line-010',
            name: '广南广西段',
            startNodeId: 'node-011',
            endNodeId: 'node-005',
            path: [
                { longitude: 111.29, latitude: 23.48 },
                { longitude: 109.60, latitude: 23.09 }
            ],
            diameter: 1016,
            material: '钢管',
            length: 180,
            pressureLevel: PressureLevel.HIGH,
            status: PipelineStatus.NORMAL,
            properties: { category: '广南/广西', type: 'trunk' }
        },
        {
            id: 'line-011',
            name: '北海LNG上载',
            startNodeId: 'node-012',
            endNodeId: 'node-005',
            path: [
                { longitude: 109.12, latitude: 21.30 },
                { longitude: 109.60, latitude: 23.09 }
            ],
            diameter: 610,
            material: '钢管',
            length: 200,
            pressureLevel: PressureLevel.MEDIUM_HIGH,
            status: PipelineStatus.NORMAL,
            properties: { category: '广南/广西', type: 'branch' }
        },
    ],

    devices: [
        {
            id: 'device-001',
            name: '贵阳压力传感器-001',
            type: DeviceType.PRESSURE_SENSOR,
            coordinate: { longitude: 106.72, latitude: 26.58 },
            nodeId: 'node-004',
            status: PipelineStatus.NORMAL,
            online: true,
            currentValue: 8.8,
            unit: 'MPa',
            properties: { reading: 8.8 }
        },
        {
            id: 'device-002',
            name: '广州流量传感器-001',
            type: DeviceType.FLOW_SENSOR,
            coordinate: { longitude: 113.39, latitude: 23.23 },
            nodeId: 'node-008',
            status: PipelineStatus.NORMAL,
            online: true,
            currentValue: 1250,
            unit: 'm³/h',
            properties: { reading: 1250 }
        },
    ]
}
