import { PipelinePackage } from './types'
import { NodeType } from '../../types'
import { generateStations, generatePipelines } from './utils'

// 陕京四线核心坐标字典
const COORDS: Record<string, { lng: number; lat: number }> = {
    '陕京靖边首站': { lng: 108.79, lat: 37.59 },
    '红墩界压气站': { lng: 109.11, lat: 37.95 },
    '鄂尔多斯压气站': { lng: 109.99, lat: 39.81 },
    '托克托压气站': { lng: 111.19, lat: 40.27 },
    '呼和浩特分输站': { lng: 111.75, lat: 40.84 },
    '乌兰察布压气站': { lng: 113.11, lat: 41.03 },
    '兴和分输站': { lng: 113.83, lat: 40.87 },
    '张家口压气站': { lng: 114.88, lat: 40.81 },
    '怀来首站': { lng: 115.51, lat: 40.4 },
    '延庆分输站': { lng: 115.98, lat: 40.45 },
    '高丽营分输站': { lng: 116.53, lat: 40.14 },
    '安家堡分输站': { lng: 114.74, lat: 40.76 },
    '下花园首站': { lng: 115.28, lat: 40.49 },
    '张家堡分输站': { lng: 115.2, lat: 40.2 },
    '涿鹿末站': { lng: 115.21, lat: 40.38 },
    '巴克什营首站': { lng: 117.2, lat: 40.7 },
    '密云分输站': { lng: 116.84, lat: 40.37 },
    '木林分输站': { lng: 116.78, lat: 40.19 },
    '宝坻分输站': { lng: 117.3, lat: 39.7 },
    '苑家庄门站': { lng: 117.2, lat: 39.75 },
    '香河分输站': { lng: 117.0, lat: 39.76 },
    '钱旺分输站': { lng: 116.9, lat: 39.8 },
    '西集分输站': { lng: 116.75, lat: 39.8 },
    '马坊分输站': { lng: 117.03, lat: 40.05 },
    '三河分输站': { lng: 117.07, lat: 39.98 },
    '尚义支线首站': { lng: 114.1, lat: 40.9 },
    '尚义末站': { lng: 113.97, lat: 41.07 },
    '应张末站': { lng: 114.8, lat: 40.7 },
    '南山分输站': { lng: 114.5, lat: 40.6 },
    '左卫分输站': { lng: 114.4, lat: 40.5 },
    '怀安末站': { lng: 114.38, lat: 40.4 },
    '怀来末站': { lng: 115.55, lat: 40.45 },
    '香屯分输站': { lng: 116.4, lat: 40.2 },
    '西沙屯分输站': { lng: 116.3, lat: 40.16 },
}

// 陕京四线干线节点数据
const TRUNK_NODES = [
    { name: '陕京靖边首站', mileage: 0.0, type: 'distribution' as const },
    { name: '陕四1#阀室', mileage: 16.1817, type: 'valve' as const },
    { name: '红墩界压气站', mileage: 32.817, type: 'compressor' as const },
    { name: '陕四2#阀室', mileage: 49.6618, type: 'valve' as const },
    { name: '陕四3#阀室', mileage: 70.4776, type: 'valve' as const },
    { name: '陕四4#阀室', mileage: 97.7754, type: 'valve' as const },
    { name: '陕四5#阀室', mileage: 125.7656, type: 'valve' as const },
    { name: '陕四6#阀室', mileage: 159.295, type: 'valve' as const },
    { name: '陕四7#阀室', mileage: 186.7906, type: 'valve' as const },
    { name: '陕四8#阀室', mileage: 217.9787, type: 'valve' as const },
    { name: '陕四9#阀室', mileage: 242.8049, type: 'valve' as const },
    { name: '鄂尔多斯压气站', mileage: 262.932, type: 'compressor' as const },
    { name: '陕四10#阀室', mileage: 282.549, type: 'valve' as const },
    { name: '陕四11#阀室', mileage: 304.6096, type: 'valve' as const },
    { name: '陕四12#阀室', mileage: 320.8, type: 'valve' as const },
    { name: '陕四13#阀室', mileage: 341.0243, type: 'valve' as const },
    { name: '陕四14#阀室', mileage: 364.8143, type: 'valve' as const },
    { name: '陕四15#阀室', mileage: 375.6589, type: 'valve' as const },
    { name: '陕四16#阀室', mileage: 395.2495, type: 'valve' as const },
    { name: '陕四17#阀室', mileage: 422.0779, type: 'valve' as const },
    { name: '陕四18#阀室', mileage: 445.5804, type: 'valve' as const },
    { name: '陕四19#阀室', mileage: 453.1744, type: 'valve' as const },
    { name: '托克托压气站', mileage: 475.307, type: 'compressor' as const },
    { name: '陕四20#阀室', mileage: 495.7698, type: 'valve' as const },
    { name: '陕四21#阀室', mileage: 521.807, type: 'valve' as const },
    { name: '呼和浩特分输站', mileage: 521.807, type: 'distribution' as const },
    { name: '陕四22#阀室', mileage: 546.2252, type: 'valve' as const },
    { name: '陕四23#阀室', mileage: 564.4157, type: 'valve' as const },
    { name: '陕四24#阀室', mileage: 584.5206, type: 'valve' as const },
    { name: '陕四25#阀室', mileage: 613.4413, type: 'valve' as const },
    { name: '陕四26#阀室', mileage: 628.7272, type: 'valve' as const },
    { name: '陕四27#阀室', mileage: 640.2749, type: 'valve' as const },
    { name: '乌兰察布压气站', mileage: 674.0071, type: 'compressor' as const },
    { name: '陕四28#阀室', mileage: 695.2214, type: 'valve' as const },
    { name: '陕四29#阀室', mileage: 711.0278, type: 'valve' as const },
    { name: '陕四29-1#阀室', mileage: 738.7193, type: 'valve' as const },
    { name: '兴和分输站', mileage: 738.7193, type: 'distribution' as const },
    { name: '陕四30#阀室', mileage: 758.8452, type: 'valve' as const },
    { name: '陕四31#阀室', mileage: 786.6636, type: 'valve' as const },
    { name: '陕四32#阀室', mileage: 807.6179, type: 'valve' as const },
    { name: '陕四33#阀室', mileage: 829.9179, type: 'valve' as const },
    { name: '陕四34#阀室', mileage: 848.1179, type: 'valve' as const },
    { name: '张家口压气站', mileage: 855.5179, type: 'compressor' as const },
    { name: '陕四35#阀室', mileage: 871.3243, type: 'valve' as const },
    { name: '陕四36#阀室', mileage: 892.2996, type: 'valve' as const },
    { name: '陕四37#阀室', mileage: 903.7188, type: 'valve' as const },
    { name: '陕四38#阀室', mileage: 921.7179, type: 'valve' as const },
    { name: '怀来首站', mileage: 935.4179, type: 'distribution' as const },
    { name: '陕四40#阀室', mileage: 945.8106, type: 'valve' as const },
    { name: '陕四41#阀室', mileage: 967.5533, type: 'valve' as const },
    { name: '延庆分输站', mileage: 981.4179, type: 'distribution' as const },
    { name: '陕四42#阀室', mileage: 1001.8894, type: 'valve' as const },
    { name: '陕四43#阀室', mileage: 1023.4961, type: 'valve' as const },
    { name: '陕四44#阀室', mileage: 1046.2444, type: 'valve' as const },
    { name: '陕四45#阀室', mileage: 1063.0937, type: 'valve' as const },
    { name: '高丽营分输站', mileage: 1071.2478, type: 'distribution' as const },
] as const

// 支线: 万全支线 节点数据
const BRANCH_0_NODES = [
    { name: '陕四33#阀室', mileage: 0.0, type: 'valve' as const },
    { name: '安家堡分输站', mileage: 0.55, type: 'distribution' as const },
] as const

// 支线: 下花园支线 节点数据
const BRANCH_1_NODES = [
    { name: '陕四38#阀室', mileage: 0.0, type: 'valve' as const },
    { name: '下花园首站', mileage: 3.0, type: 'distribution' as const },
    { name: '张家堡分输站', mileage: 21.0, type: 'distribution' as const },
    { name: '涿鹿末站', mileage: 28.0, type: 'distribution' as const },
] as const

// 支线: 大唐煤制气管道 节点数据
const BRANCH_2_NODES = [
    { name: '巴克什营首站', mileage: 0.0, type: 'distribution' as const },
    { name: '大唐1#阀室', mileage: 15.6447, type: 'valve' as const },
    { name: '大唐2#阀室', mileage: 37.0879, type: 'valve' as const },
    { name: '密云分输站', mileage: 59.0, type: 'distribution' as const },
    { name: '大唐3#阀室', mileage: 66.9227, type: 'valve' as const },
    { name: '大唐4#阀室', mileage: 72.8351, type: 'valve' as const },
    { name: '大唐5#阀室', mileage: 81.5683, type: 'valve' as const },
    { name: '大唐6#阀室', mileage: 87.5, type: 'valve' as const },
    { name: '木林分输站', mileage: 87.5, type: 'distribution' as const },
    { name: '大唐7#阀室', mileage: 95.9318, type: 'valve' as const },
    { name: '大唐8#阀室', mileage: 102.0742, type: 'valve' as const },
    { name: '高丽营分输站', mileage: 110.0, type: 'distribution' as const },
] as const

// 支线: 宝香西联络线 节点数据
const BRANCH_3_NODES = [
    { name: '宝坻分输站', mileage: 0.0, type: 'distribution' as const },
    { name: '宝香西1#阀室', mileage: 35.3603, type: 'valve' as const },
    { name: '苑家庄门站', mileage: 35.3603, type: 'distribution' as const },
    { name: '宝香西2#阀室', mileage: 44.975945, type: 'valve' as const },
    { name: '香河分输站', mileage: 51.497445, type: 'distribution' as const },
    { name: '钱旺分输站', mileage: 51.497445, type: 'distribution' as const },
    { name: '宝香西3#阀室', mileage: 64.282945, type: 'valve' as const },
    { name: '西集分输站', mileage: 83.197445, type: 'distribution' as const },
] as const

// 支线: 密马香联络线 节点数据
const BRANCH_4_NODES = [
    { name: '密云分输站', mileage: 0.0, type: 'distribution' as const },
    { name: '密马段1#阀室', mileage: 7.76, type: 'valve' as const },
    { name: '密马段2#阀室', mileage: 15.6424, type: 'valve' as const },
    { name: '密马段3#阀室', mileage: 23.0436, type: 'valve' as const },
    { name: '密马段4#阀室', mileage: 31.491, type: 'valve' as const },
    { name: '马坊分输站', mileage: 39.0, type: 'distribution' as const },
    { name: '马香2#阀室', mileage: 43.8119, type: 'valve' as const },
    { name: '三河分输站', mileage: 53.3418, type: 'distribution' as const },
    { name: '马香1#阀室', mileage: 69.5614, type: 'valve' as const },
    { name: '香河分输站', mileage: 77.0, type: 'distribution' as const },
] as const

// 支线: 尚义支线 节点数据
const BRANCH_5_NODES = [
    { name: '陕四31#阀室', mileage: 0.0, type: 'valve' as const },
    { name: '尚义支线首站', mileage: 2.3, type: 'distribution' as const },
    { name: '1#阀室', mileage: 20.3, type: 'valve' as const },
    { name: '尚义末站', mileage: 36.9, type: 'distribution' as const },
] as const

// 支线: 应张联络线 节点数据
const BRANCH_6_NODES = [
    { name: '张家口压气站', mileage: 0.0, type: 'compressor' as const },
    { name: '应张末站', mileage: 11.0, type: 'distribution' as const },
] as const

// 支线: 怀安支线 节点数据
const BRANCH_7_NODES = [
    { name: '陕四34#阀室', mileage: 0.0, type: 'valve' as const },
    { name: '南山分输站', mileage: 0.75, type: 'distribution' as const },
    { name: '左卫分输站', mileage: 18.85, type: 'distribution' as const },
    { name: '怀安末站', mileage: 43.7, type: 'distribution' as const },
] as const

// 支线: 怀来支线 节点数据
const BRANCH_8_NODES = [
    { name: '怀来首站', mileage: 0.0, type: 'distribution' as const },
    { name: '怀来末站', mileage: 3.0, type: 'distribution' as const },
] as const

// 支线: 高西联络线 节点数据
const BRANCH_9_NODES = [
    { name: '高丽营分输站', mileage: 0.0, type: 'distribution' as const },
    { name: '高西1#阀室', mileage: 6.6082, type: 'valve' as const },
    { name: '高西2#阀室', mileage: 12.8, type: 'valve' as const },
    { name: '香屯分输站', mileage: 12.8, type: 'distribution' as const },
    { name: '高西3#阀室', mileage: 20.2372, type: 'valve' as const },
    { name: '高西4#阀室', mileage: 26.3095, type: 'valve' as const },
    { name: '西沙屯分输站', mileage: 29.8, type: 'distribution' as const },
] as const

// -----------------------------------------------------------------------------
// 数据生成与合并
// -----------------------------------------------------------------------------

// 生成干线数据
const trunkStations = generateStations(TRUNK_NODES, COORDS, '陕京四线', 'SJ4_TRUNK', 40)
const trunkPipelines = generatePipelines(trunkStations, '陕京四线', 'SJ4_TRUNK', '#00d4ff')

// 生成支线: 万全支线 数据
const branch0Stations = generateStations(BRANCH_0_NODES, COORDS, '万全支线', 'SJ4_B0', 30)
const branch0Pipelines = generatePipelines(branch0Stations, '万全支线', 'SJ4_B0', '#8bc34a')

// 生成支线: 下花园支线 数据
const branch1Stations = generateStations(BRANCH_1_NODES, COORDS, '下花园支线', 'SJ4_B1', 30)
const branch1Pipelines = generatePipelines(branch1Stations, '下花园支线', 'SJ4_B1', '#8bc34a')

// 生成支线: 大唐煤制气管道 数据
const branch2Stations = generateStations(BRANCH_2_NODES, COORDS, '大唐煤制气管道', 'SJ4_B2', 30)
const branch2Pipelines = generatePipelines(branch2Stations, '大唐煤制气管道', 'SJ4_B2', '#8bc34a')

// 生成支线: 宝香西联络线 数据
const branch3Stations = generateStations(BRANCH_3_NODES, COORDS, '宝香西联络线', 'SJ4_B3', 30)
const branch3Pipelines = generatePipelines(branch3Stations, '宝香西联络线', 'SJ4_B3', '#8bc34a')

// 生成支线: 密马香联络线 数据
const branch4Stations = generateStations(BRANCH_4_NODES, COORDS, '密马香联络线', 'SJ4_B4', 30)
const branch4Pipelines = generatePipelines(branch4Stations, '密马香联络线', 'SJ4_B4', '#8bc34a')

// 生成支线: 尚义支线 数据
const branch5Stations = generateStations(BRANCH_5_NODES, COORDS, '尚义支线', 'SJ4_B5', 30)
const branch5Pipelines = generatePipelines(branch5Stations, '尚义支线', 'SJ4_B5', '#8bc34a')

// 生成支线: 应张联络线 数据
const branch6Stations = generateStations(BRANCH_6_NODES, COORDS, '应张联络线', 'SJ4_B6', 30)
const branch6Pipelines = generatePipelines(branch6Stations, '应张联络线', 'SJ4_B6', '#8bc34a')

// 生成支线: 怀安支线 数据
const branch7Stations = generateStations(BRANCH_7_NODES, COORDS, '怀安支线', 'SJ4_B7', 30)
const branch7Pipelines = generatePipelines(branch7Stations, '怀安支线', 'SJ4_B7', '#8bc34a')

// 生成支线: 怀来支线 数据
const branch8Stations = generateStations(BRANCH_8_NODES, COORDS, '怀来支线', 'SJ4_B8', 30)
const branch8Pipelines = generatePipelines(branch8Stations, '怀来支线', 'SJ4_B8', '#8bc34a')

// 生成支线: 高西联络线 数据
const branch9Stations = generateStations(BRANCH_9_NODES, COORDS, '高西联络线', 'SJ4_B9', 30)
const branch9Pipelines = generatePipelines(branch9Stations, '高西联络线', 'SJ4_B9', '#8bc34a')

// 组装完整的包
export const sj4Package: PipelinePackage = {
    id: 'sj4',
    name: '陕京四线',
    color: '#00d4ff',
    layers: [
        {
            name: '陕京四线干线',
            type: 'trunk',
            nodes: trunkStations,
            lines: trunkPipelines
        },
        {
            name: '万全支线',
            type: 'branch',
            nodes: branch0Stations,
            lines: branch0Pipelines
        },
        {
            name: '下花园支线',
            type: 'branch',
            nodes: branch1Stations,
            lines: branch1Pipelines
        },
        {
            name: '大唐煤制气管道',
            type: 'branch',
            nodes: branch2Stations,
            lines: branch2Pipelines
        },
        {
            name: '宝香西联络线',
            type: 'branch',
            nodes: branch3Stations,
            lines: branch3Pipelines
        },
        {
            name: '密马香联络线',
            type: 'branch',
            nodes: branch4Stations,
            lines: branch4Pipelines
        },
        {
            name: '尚义支线',
            type: 'branch',
            nodes: branch5Stations,
            lines: branch5Pipelines
        },
        {
            name: '应张联络线',
            type: 'branch',
            nodes: branch6Stations,
            lines: branch6Pipelines
        },
        {
            name: '怀安支线',
            type: 'branch',
            nodes: branch7Stations,
            lines: branch7Pipelines
        },
        {
            name: '怀来支线',
            type: 'branch',
            nodes: branch8Stations,
            lines: branch8Pipelines
        },
        {
            name: '高西联络线',
            type: 'branch',
            nodes: branch9Stations,
            lines: branch9Pipelines
        },
    ]
}
