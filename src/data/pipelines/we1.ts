import { generateStations, generatePipelines } from './utils'

// 西一线坐标字典
const COORDS: Record<string, { lng: number; lat: number }> = {
  '东桥分输站': { lng: 120.5, lat: 31.4 },
  '中卫压气站': { lng: 105.19, lat: 37.51 },
  '临汾分输站': { lng: 111.52, lat: 36.09 },
  '丹阳分输站': { lng: 119.6, lat: 32.0 },
  '刘巷子分输站': { lng: 116.9, lat: 32.7 },
  '利辛分输站': { lng: 116.21, lat: 32.9 },
  '南京分输站': { lng: 118.8, lat: 32.06 },
  '南京末站': { lng: 118.85, lat: 32.1 },
  '南渡分输站': { lng: 119.7, lat: 32.275 },
  '博爱分输站': { lng: 112.852, lat: 35.156 },
  '古浪分输站': { lng: 103.0, lat: 37.6 },
  '古浪压气站': { lng: 103.52, lat: 37.48 },
  '合肥末站': { lng: 117.98, lat: 32.62 },
  '周市分输站': { lng: 120.97, lat: 31.3 },
  '哈密压气站': { lng: 93.52, lat: 42.82 },
  '四道班压气站': { lng: 88.0, lat: 42.3 },
  '太仓分输站': { lng: 121.02, lat: 31.315 },
  '太和分输站': { lng: 115.62, lat: 33.17 },
  '子长分输站': { lng: 109.84, lat: 37.06 },
  '孔雀河压气站': { lng: 86.17, lat: 41.73 },
  '定远压气站': { lng: 117.68, lat: 32.53 },
  '宜兴分输站': { lng: 120.4, lat: 31.71 },
  '山丹压气站': { lng: 101.09, lat: 38.78 },
  '巴城分输站': { lng: 120.92, lat: 31.285 },
  '常州分输站': { lng: 119.98, lat: 31.81 },
  '延川压气站': { lng: 110.19, lat: 36.88 },
  '延川西分输站': { lng: 110.4175, lat: 36.7625 },
  '扬子扬巴末站': { lng: 118.88, lat: 32.255 },
  '无锡分输站': { lng: 120.31, lat: 31.49 },
  '昆山分输站': { lng: 121.004719, lat: 31.292312 },
  '望亭分输站': { lng: 120.55, lat: 31.415 },
  '柳园压气站': { lng: 96.0, lat: 41.0 },
  '武进分输站': { lng: 120.3, lat: 31.68 },
  '江宁分输站': { lng: 118.95, lat: 32.105 },
  '沁水压气站': { lng: 112.18, lat: 35.69 },
  '浏河分输站': { lng: 121.12, lat: 31.345 },
  '淮阳压气站': { lng: 114.88, lat: 33.73 },
  '滁州分输站': { lng: 118.32, lat: 32.3 },
  '煤层气端氏首站': { lng: 112.18, lat: 35.69 },
  '玉门压气站': { lng: 97.04, lat: 40.27 },
  '甪直分输站': { lng: 120.87, lat: 31.27 },
  '白鹤末站': { lng: 121.155917, lat: 31.239172 },
  '红柳压气站': { lng: 95.5, lat: 41.8 },
  '芙蓉分输站': { lng: 120.2, lat: 31.65 },
  '芜湖末站': { lng: 119.2, lat: 32.18 },
  '苏州分输站': { lng: 120.65034, lat: 31.349236 },
  '蒲县压气站': { lng: 111.1, lat: 36.41 },
  '薛店分输站': { lng: 113.72, lat: 34.46 },
  '西一盐池压气站': { lng: 107.4, lat: 37.78 },
  '西一靖边压气站': { lng: 108.79, lat: 37.59 },
  '轮南压气站': { lng: 84.25, lat: 41.78 },
  '郑州压气站': { lng: 113.3, lat: 34.8 },
  '鄯善压气站': { lng: 90.21, lat: 42.86 },
  '酒泉压气站': { lng: 98.49, lat: 39.73 },
  '金坛分输站': { lng: 119.55, lat: 32.23 },
  '金昌压气站': { lng: 102.06, lat: 38.37 },
  '金石路分输站': { lng: 121.17, lat: 31.36 },
  '镇江分输站': { lng: 119.45, lat: 32.2 },
  '长兴末站': { lng: 120.55, lat: 31.755 },
  '长铝末站': { lng: 113.35, lat: 34.815 },
  '雅满苏压气站': { lng: 94.8, lat: 42.5 },
  '青山分输站': { lng: 119.05, lat: 32.2 },
  '马鞍山分输站': { lng: 119.05, lat: 32.135 },
  '龙池分输站': { lng: 118.83, lat: 32.24 },
  '龙潭分输站': { lng: 119.1, lat: 32.18 },
}

// ============== 干线节点 ==============
const TRUNK_NODES = [
  { name: '轮南压气站', mileage: 0.0, type: 'compressor' },
  { name: '西一1#阀室', mileage: 32.5005, type: 'valve' },
  { name: '西一2#阀室', mileage: 62.5294, type: 'valve' },
  { name: '西一3#阀室', mileage: 95.5411, type: 'valve' },
  { name: '西一4#阀室', mileage: 128.5829, type: 'valve' },
  { name: '西一5#阀室', mileage: 159.4256, type: 'valve' },
  { name: '孔雀河压气站', mileage: 178.5865, type: 'compressor' },
  { name: '西一6#阀室', mileage: 205.8962, type: 'valve' },
  { name: '西一7#阀室', mileage: 231.7165, type: 'valve' },
  { name: '西一8#阀室', mileage: 258.4479, type: 'valve' },
  { name: '西一9#阀室', mileage: 283.6799, type: 'valve' },
  { name: '四道班压气站', mileage: 315.9608, type: 'compressor' },
  { name: '西一10#阀室', mileage: 347.4971, type: 'valve' },
  { name: '西一11#阀室', mileage: 378.0201, type: 'valve' },
  { name: '西一11A#阀室', mileage: 398.0201, type: 'valve' },
  { name: '西一12#阀室', mileage: 405.859, type: 'valve' },
  { name: '西一13#阀室', mileage: 435.7706, type: 'valve' },
  { name: '西一14#阀室', mileage: 466.1453, type: 'valve' },
  { name: '鄯善压气站', mileage: 494.5473, type: 'compressor' },
  { name: '西一15#阀室', mileage: 525.2838, type: 'valve' },
  { name: '西一16#阀室', mileage: 552.4161, type: 'valve' },
  { name: '西一17#阀室', mileage: 583.6908, type: 'valve' },
  { name: '西一18#阀室', mileage: 614.4744, type: 'valve' },
  { name: '西一19#阀室', mileage: 645.242, type: 'valve' },
  { name: '哈密压气站', mileage: 659.3964, type: 'compressor' },
  { name: '西一20#阀室', mileage: 688.8259, type: 'valve' },
  { name: '西一21#阀室', mileage: 718.7445, type: 'valve' },
  { name: '西一22#阀室', mileage: 760.9221, type: 'valve' },
  { name: '西一23#阀室', mileage: 793.3765, type: 'valve' },
  { name: '雅满苏压气站', mileage: 824.2455, type: 'compressor' },
  { name: '西一25#阀室', mileage: 860.244, type: 'valve' },
  { name: '西一26#阀室', mileage: 892.2669, type: 'valve' },
  { name: '西一27#阀室', mileage: 923.5386, type: 'valve' },
  { name: '西一28#阀室', mileage: 954.9577, type: 'valve' },
  { name: '红柳压气站', mileage: 961.6198, type: 'compressor' },
  { name: '西一29#阀室', mileage: 995.5445, type: 'valve' },
  { name: '西一30#阀室', mileage: 1025.5133, type: 'valve' },
  { name: '西一31#阀室', mileage: 1057.029, type: 'valve' },
  { name: '西一32#阀室', mileage: 1087.6116, type: 'valve' },
  { name: '柳园压气站', mileage: 1119.4368, type: 'compressor' },
  { name: '西一33#阀室', mileage: 1144.5195, type: 'valve' },
  { name: '西一34#阀室', mileage: 1174.4132, type: 'valve' },
  { name: '西一35#阀室', mileage: 1195.3798, type: 'valve' },
  { name: '西一36#阀室', mileage: 1223.312, type: 'valve' },
  { name: '西一37#阀室', mileage: 1247.3234, type: 'valve' },
  { name: '玉门压气站', mileage: 1276.59, type: 'compressor' },
  { name: '西一38#阀室', mileage: 1300.6421, type: 'valve' },
  { name: '西一39#阀室', mileage: 1325.8184, type: 'valve' },
  { name: '西一40#阀室', mileage: 1352.5837, type: 'valve' },
  { name: '西一41#阀室', mileage: 1382.9014, type: 'valve' },
  { name: '西一42#阀室', mileage: 1407.5662, type: 'valve' },
  { name: '西一43#阀室', mileage: 1438.1382, type: 'valve' },
  { name: '酒泉压气站', mileage: 1467.1574, type: 'compressor' },
  { name: '西一44#阀室', mileage: 1490.8222, type: 'valve' },
  { name: '西一45#阀室', mileage: 1513.7232, type: 'valve' },
  { name: '西一46#阀室', mileage: 1536.8368, type: 'valve' },
  { name: '西一47#阀室', mileage: 1559.856, type: 'valve' },
  { name: '西一48#阀室', mileage: 1588.311, type: 'valve' },
  { name: '山丹压气站', mileage: 1610.083, type: 'compressor' },
  { name: '西一49#阀室', mileage: 1642.0544, type: 'valve' },
  { name: '西一50#阀室', mileage: 1667.1571, type: 'valve' },
  { name: '西一51#阀室', mileage: 1689.1253, type: 'valve' },
  { name: '金昌压气站', mileage: 1719.0686, type: 'compressor' },
  { name: '西一53#阀室', mileage: 1751.9426, type: 'valve' },
  { name: '西一54#阀室', mileage: 1781.189, type: 'valve' },
  { name: '古浪分输站', mileage: 1812.911, type: 'distribution' },
  { name: '古浪压气站', mileage: 1841.5762, type: 'compressor' },
  { name: '西一56#阀室', mileage: 1873.1322, type: 'valve' },
  { name: '西一57#阀室', mileage: 1902.4369, type: 'valve' },
  { name: '西一58#阀室', mileage: 1921.0039, type: 'valve' },
  { name: '西一59#阀室', mileage: 1932.3321, type: 'valve' },
  { name: '西一60#阀室', mileage: 1957.3368, type: 'valve' },
  { name: '西一61#阀室', mileage: 1967.0717, type: 'valve' },
  { name: '西一62#阀室', mileage: 1981.9018, type: 'valve' },
  { name: '西一63#阀室', mileage: 1983.9016, type: 'valve' },
  { name: '中卫压气站', mileage: 2008.2399, type: 'compressor' },
  { name: '西一64#阀室', mileage: 2020.991, type: 'valve' },
  { name: '西一65#阀室', mileage: 2036.4441, type: 'valve' },
  { name: '西一66#阀室', mileage: 2054.4698, type: 'valve' },
  { name: '西一67#阀室', mileage: 2071.0733, type: 'valve' },
  { name: '西一68#阀室', mileage: 2091.0727, type: 'valve' },
  { name: '西一69#阀室', mileage: 2111.965, type: 'valve' },
  { name: '西一70#阀室', mileage: 2113.8639, type: 'valve' },
  { name: '西一71#阀室', mileage: 2143.5286, type: 'valve' },
  { name: '西一72#阀室', mileage: 2175.7044, type: 'valve' },
  { name: '西一盐池压气站', mileage: 2190.506, type: 'compressor' },
  { name: '西一73#阀室', mileage: 2219.906, type: 'valve' },
  { name: '西一74#阀室', mileage: 2244.0381, type: 'valve' },
  { name: '西一75#阀室', mileage: 2273.1779, type: 'valve' },
  { name: '西一76#阀室', mileage: 2298.2235, type: 'valve' },
  { name: '西一77#阀室', mileage: 2318.586, type: 'valve' },
  { name: '西一靖边压气站', mileage: 2343.806, type: 'compressor' },
  { name: '西一78#阀室', mileage: 2349.6473, type: 'valve' },
  { name: '西一79#阀室', mileage: 2373.0528, type: 'valve' },
  { name: '西一80#阀室', mileage: 2402.869, type: 'valve' },
  { name: '西一81#阀室', mileage: 2430.8451, type: 'valve' },
  { name: '西一82#阀室', mileage: 2454.488, type: 'valve' },
  { name: '子长分输站', mileage: 2454.488, type: 'distribution' },
  { name: '西一83#阀室', mileage: 2478.2994, type: 'valve' },
  { name: '延川压气站', mileage: 2494.007, type: 'compressor' },
  { name: '西一84#阀室', mileage: 2513.3548, type: 'valve' },
  { name: '延川西分输站', mileage: 2513.3548, type: 'distribution' },
  { name: '西一85#阀室', mileage: 2540.2008, type: 'valve' },
  { name: '西一86#阀室', mileage: 2549.907, type: 'valve' },
  { name: '西一87#阀室', mileage: 2572.107, type: 'valve' },
  { name: '西一88#阀室', mileage: 2592.4311, type: 'valve' },
  { name: '西一89#阀室', mileage: 2612.2766, type: 'valve' },
  { name: '蒲县压气站', mileage: 2635.207, type: 'compressor' },
  { name: '西一90#阀室', mileage: 2657.8794, type: 'valve' },
  { name: '西一91#阀室', mileage: 2687.5686, type: 'valve' },
  { name: '临汾分输站', mileage: 2697.907, type: 'distribution' },
  { name: '西一93#阀室', mileage: 2711.1122, type: 'valve' },
  { name: '西一94#阀室', mileage: 2721.9636, type: 'valve' },
  { name: '西一95#阀室', mileage: 2735.1823, type: 'valve' },
  { name: '西一96#阀室', mileage: 2751.9154, type: 'valve' },
  { name: '西一97#阀室', mileage: 2775.2222, type: 'valve' },
  { name: '沁水压气站', mileage: 2787.5069, type: 'compressor' },
  { name: '西一98#阀室', mileage: 2799.4481, type: 'valve' },
  { name: '西一99#阀室', mileage: 2813.8063, type: 'valve' },
  { name: '阳城清管站', mileage: 2837.1069, type: 'valve' },
  { name: '西一100#阀室', mileage: 2861.1069, type: 'valve' },
  { name: '西一101#阀室', mileage: 2876.723, type: 'valve' },
  { name: '博爱分输站', mileage: 2891.4069, type: 'distribution' },
  { name: '西一102#阀室', mileage: 2905.9145, type: 'valve' },
  { name: '西一103#阀室', mileage: 2918.068, type: 'valve' },
  { name: '西一104#阀室', mileage: 2928.3452, type: 'valve' },
  { name: '郑州压气站', mileage: 2953.6399, type: 'compressor' },
  { name: '西一105#阀室', mileage: 2976.3987, type: 'valve' },
  { name: '薛店分输站', mileage: 2997.3459, type: 'distribution' },
  { name: '西一106A#阀室', mileage: 3019.4089, type: 'valve' },
  { name: '西一106B#阀室', mileage: 3033.2899, type: 'valve' },
  { name: '西一107#阀室', mileage: 3056.5209, type: 'valve' },
  { name: '西一108#阀室', mileage: 3081.2717, type: 'valve' },
  { name: '西一109#阀室', mileage: 3105.0971, type: 'valve' },
  { name: '西一110#阀室', mileage: 3127.6914, type: 'valve' },
  { name: '淮阳压气站', mileage: 3141.3191, type: 'compressor' },
  { name: '西一111#阀室', mileage: 3165.2475, type: 'valve' },
  { name: '西一112#阀室', mileage: 3191.0929, type: 'valve' },
  { name: '西一113#阀室', mileage: 3218.119, type: 'valve' },
  { name: '太和分输站', mileage: 3218.119, type: 'distribution' },
  { name: '西一114#阀室', mileage: 3242.1875, type: 'valve' },
  { name: '西一115#阀室', mileage: 3268.6503, type: 'valve' },
  { name: '利辛分输站', mileage: 3293.097, type: 'distribution' },
  { name: '西一116#阀室', mileage: 3312.707, type: 'valve' },
  { name: '西一117#阀室', mileage: 3337.1078, type: 'valve' },
  { name: '西一118#阀室', mileage: 3349.8608, type: 'valve' },
  { name: '西一119#阀室', mileage: 3356.0254, type: 'valve' },
  { name: '西一120#阀室', mileage: 3376.4366, type: 'valve' },
  { name: '西一121#阀室', mileage: 3383.3752, type: 'valve' },
  { name: '刘巷子分输站', mileage: 3391.285, type: 'distribution' },
  { name: '西一122#阀室', mileage: 3417.6773, type: 'valve' },
  { name: '定远压气站', mileage: 3446.211, type: 'compressor' },
  { name: '西一123#阀室', mileage: 3471.6537, type: 'valve' },
  { name: '西一124#阀室', mileage: 3496.7446, type: 'valve' },
  { name: '滁州分输站', mileage: 3512.141, type: 'distribution' },
  { name: '西一125#阀室', mileage: 3538.741, type: 'valve' },
  { name: '龙池分输站', mileage: 3559.341, type: 'distribution' },
  { name: '西一126#阀室', mileage: 3570.5128, type: 'valve' },
  { name: '青山分输站', mileage: 3586.664, type: 'distribution' },
  { name: '龙潭分输站', mileage: 3593.95, type: 'distribution' },
  { name: '西一127#阀室', mileage: 3609.9476, type: 'valve' },
  { name: '西一127A#阀室', mileage: 3621.853, type: 'valve' },
  { name: '西一127B#阀室', mileage: 3628.9856, type: 'valve' },
  { name: '镇江分输站', mileage: 3633.125, type: 'distribution' },
  { name: '丹阳分输站', mileage: 3655.288, type: 'distribution' },
  { name: '西一129#阀室', mileage: 3675.5392, type: 'valve' },
  { name: '西一130#阀室', mileage: 3688.7304, type: 'valve' },
  { name: '常州分输站', mileage: 3700.402, type: 'distribution' },
  { name: '芙蓉分输站', mileage: 3717.33, type: 'distribution' },
  { name: '西一131#阀室', mileage: 3731.7248, type: 'valve' },
  { name: '西一132#阀室', mileage: 3743.6326, type: 'valve' },
  { name: '无锡分输站', mileage: 3754.483, type: 'distribution' },
  { name: '东桥分输站', mileage: 3773.533, type: 'distribution' },
  { name: '西一133阀室', mileage: 3783.2276, type: 'valve' },
  { name: '西一134阀室', mileage: 3792.117, type: 'valve' },
  { name: '苏州分输站', mileage: 3797.6201, type: 'distribution' },
  { name: '西一136#阀室', mileage: 3805.0804, type: 'valve' },
  { name: '西一137#阀室', mileage: 3812.1079, type: 'valve' },
  { name: '甪直分输站', mileage: 3819.2541, type: 'distribution' },
  { name: '昆山分输站', mileage: 3832.3461, type: 'distribution' },
  { name: '白鹤末站', mileage: 3846.1981, type: 'distribution' },
] as const

// ============== 沁水煤层气管道 ==============
const BRANCH_0_NODES = [
  { name: '煤层气端氏首站', mileage: 0.0, type: 'distribution' },
  { name: '煤层气郑庄阀室', mileage: 15.7578, type: 'valve' },
  { name: '沁水压气站', mileage: 35.0, type: 'compressor' },
] as const

// ============== 长铝支线 ==============
const BRANCH_1_NODES = [
  { name: '郑州压气站', mileage: 0.0, type: 'compressor' },
  { name: '长铝末站', mileage: 24.0, type: 'distribution' },
] as const

// ============== 定合支线 ==============
const BRANCH_2_NODES = [
  { name: '定远压气站', mileage: 0.0, type: 'compressor' },
  { name: '定合1#阀室', mileage: 12.2497, type: 'valve' },
  { name: '定合2#阀室', mileage: 24.21, type: 'valve' },
  { name: '定合3#阀室', mileage: 37.8017, type: 'valve' },
  { name: '定合4#阀室', mileage: 55.0499, type: 'valve' },
  { name: '定合5#阀室', mileage: 69.3429, type: 'valve' },
  { name: '合肥末站', mileage: 79.5999, type: 'distribution' },
] as const

// ============== 定合复线 ==============
const BRANCH_3_NODES = [
  { name: '定远压气站', mileage: 0.0, type: 'compressor' },
  { name: '定合复1#阀室', mileage: 11.9793, type: 'valve' },
  { name: '定合复2#阀室', mileage: 32.9006, type: 'valve' },
  { name: '定合复3#阀室', mileage: 55.8901, type: 'valve' },
  { name: '合肥北站', mileage: 67.2999, type: 'valve' },
] as const

// ============== 南芜支线 ==============
const BRANCH_4_NODES = [
  { name: '龙潭分输站', mileage: 0.0, type: 'distribution' },
  { name: '南芜1#阀室', mileage: 8.3765, type: 'valve' },
  { name: '南京分输站', mileage: 15.2, type: 'distribution' },
  { name: '南芜2#阀室', mileage: 26.6784, type: 'valve' },
  { name: '南芜3#阀室', mileage: 40.0958, type: 'valve' },
  { name: '江宁分输站', mileage: 58.2, type: 'distribution' },
  { name: '南芜5#阀室', mileage: 69.7, type: 'valve' },
  { name: '马鞍山分输站', mileage: 92.7, type: 'distribution' },
  { name: '南芜6#阀室', mileage: 114.198, type: 'valve' },
  { name: '南芜7#阀室', mileage: 116.366, type: 'valve' },
  { name: '芜湖末站', mileage: 130.0, type: 'distribution' },
] as const

// ============== 常长支线 ==============
const BRANCH_5_NODES = [
  { name: '芙蓉分输站', mileage: 0.0, type: 'distribution' },
  { name: '常长1#阀室', mileage: 11.6734, type: 'valve' },
  { name: '武进分输站', mileage: 19.5, type: 'distribution' },
  { name: '常长2#阀室', mileage: 40.0669, type: 'valve' },
  { name: '宜兴分输站', mileage: 59.3003, type: 'distribution' },
  { name: '常长3#阀室', mileage: 72.6217, type: 'valve' },
  { name: '常长4#阀室', mileage: 86.0003, type: 'valve' },
  { name: '长兴末站', mileage: 99.6003, type: 'distribution' },
] as const

// ============== 望亭电厂支线 ==============
const BRANCH_6_NODES = [
  { name: '东桥分输站', mileage: 0.0, type: 'distribution' },
  { name: '望亭分输站', mileage: 8.2, type: 'distribution' },
] as const

// ============== 扬巴支线 ==============
const BRANCH_7_NODES = [
  { name: '龙池分输站', mileage: 0.0, type: 'distribution' },
  { name: '扬子扬巴末站', mileage: 6.2, type: 'distribution' },
] as const

// ============== 金陵电厂支线 ==============
const BRANCH_8_NODES = [
  { name: '南京分输站', mileage: 0.0, type: 'distribution' },
  { name: '金陵电厂', mileage: 3.696, type: 'valve' },
] as const

// ============== 金坛储气库支线 ==============
const BRANCH_9_NODES = [
  { name: '镇江分输站', mileage: 0.0, type: 'distribution' },
  { name: '金坛1#阀室', mileage: 17.1532, type: 'valve' },
  { name: '金坛分输站', mileage: 34.81, type: 'distribution' },
] as const

// ============== 甪宝支线 ==============
const BRANCH_10_NODES = [
  { name: '甪直分输站', mileage: 0.0, type: 'distribution' },
  { name: '巴城分输站', mileage: 16.0, type: 'distribution' },
  { name: '周市分输站', mileage: 32.0, type: 'distribution' },
  { name: '太仓分输站', mileage: 45.9, type: 'distribution' },
  { name: '宝钢4#阀室', mileage: 57.3362, type: 'valve' },
  { name: '浏河分输站', mileage: 70.219, type: 'distribution' },
  { name: '金石路分输站', mileage: 80.219, type: 'distribution' },
] as const

// ============== 金溧支线 ==============
const BRANCH_11_NODES = [
  { name: '金坛分输站', mileage: 0.0, type: 'distribution' },
  { name: '金溧1#阀室', mileage: 21.6662, type: 'valve' },
  { name: '金溧2#阀室', mileage: 37.6025, type: 'valve' },
  { name: '南渡分输站', mileage: 52.3467, type: 'distribution' },
] as const

// ============== 西一线与青宁线青山-南京联络线 ==============
const BRANCH_12_NODES = [
  { name: '青山分输站', mileage: 0.0, type: 'distribution' },
  { name: '南京末站', mileage: 1.25, type: 'distribution' },
] as const

// ============== 南京计量中心支线 ==============
const BRANCH_13_NODES = [
  { name: '龙潭分输站', mileage: 0.0, type: 'distribution' },
  { name: '南京计量中心', mileage: 0.5, type: 'valve' },
] as const

// ============== 生成站点 ==============
export const trunkStations = generateStations(TRUNK_NODES, COORDS, '西一线干线', 'WE1_TRUNK', 40)
export const branch0Stations = generateStations(BRANCH_0_NODES, COORDS, '沁水煤层气管道', 'WE1_B0', 30)
export const branch1Stations = generateStations(BRANCH_1_NODES, COORDS, '长铝支线', 'WE1_B1', 30)
export const branch2Stations = generateStations(BRANCH_2_NODES, COORDS, '定合支线', 'WE1_B2', 30)
export const branch3Stations = generateStations(BRANCH_3_NODES, COORDS, '定合复线', 'WE1_B3', 30)
export const branch4Stations = generateStations(BRANCH_4_NODES, COORDS, '南芜支线', 'WE1_B4', 30)
export const branch5Stations = generateStations(BRANCH_5_NODES, COORDS, '常长支线', 'WE1_B5', 30)
export const branch6Stations = generateStations(BRANCH_6_NODES, COORDS, '望亭电厂支线', 'WE1_B6', 30)
export const branch7Stations = generateStations(BRANCH_7_NODES, COORDS, '扬巴支线', 'WE1_B7', 30)
export const branch8Stations = generateStations(BRANCH_8_NODES, COORDS, '金陵电厂支线', 'WE1_B8', 30)
export const branch9Stations = generateStations(BRANCH_9_NODES, COORDS, '金坛储气库支线', 'WE1_B9', 30)
export const branch10Stations = generateStations(BRANCH_10_NODES, COORDS, '甪宝支线', 'WE1_B10', 30)
export const branch11Stations = generateStations(BRANCH_11_NODES, COORDS, '金溧支线', 'WE1_B11', 30)
export const branch12Stations = generateStations(BRANCH_12_NODES, COORDS, '西一线与青宁线青山-南京联络线', 'WE1_B12', 30)
export const branch13Stations = generateStations(BRANCH_13_NODES, COORDS, '南京计量中心支线', 'WE1_B13', 30)

// ============== 生成管段 ==============
export const trunkPipelines = generatePipelines(trunkStations, '西一线干线', 'WE1_TRUNK', '#2196f3')
export const branch0Pipelines = generatePipelines(branch0Stations, '沁水煤层气管道', 'WE1_B0', '#42a5f5')
export const branch1Pipelines = generatePipelines(branch1Stations, '长铝支线', 'WE1_B1', '#64b5f6')
export const branch2Pipelines = generatePipelines(branch2Stations, '定合支线', 'WE1_B2', '#90caf9')
export const branch3Pipelines = generatePipelines(branch3Stations, '定合复线', 'WE1_B3', '#1976d2')
export const branch4Pipelines = generatePipelines(branch4Stations, '南芜支线', 'WE1_B4', '#1565c0')
export const branch5Pipelines = generatePipelines(branch5Stations, '常长支线', 'WE1_B5', '#0d47a1')
export const branch6Pipelines = generatePipelines(branch6Stations, '望亭电厂支线', 'WE1_B6', '#82b1ff')
export const branch7Pipelines = generatePipelines(branch7Stations, '扬巴支线', 'WE1_B7', '#42a5f5')
export const branch8Pipelines = generatePipelines(branch8Stations, '金陵电厂支线', 'WE1_B8', '#64b5f6')
export const branch9Pipelines = generatePipelines(branch9Stations, '金坛储气库支线', 'WE1_B9', '#90caf9')
export const branch10Pipelines = generatePipelines(branch10Stations, '甪宝支线', 'WE1_B10', '#1976d2')
export const branch11Pipelines = generatePipelines(branch11Stations, '金溧支线', 'WE1_B11', '#1565c0')
export const branch12Pipelines = generatePipelines(branch12Stations, '西一线与青宁线青山-南京联络线', 'WE1_B12', '#0d47a1')
export const branch13Pipelines = generatePipelines(branch13Stations, '南京计量中心支线', 'WE1_B13', '#82b1ff')

// ============== 汇总导出 ==============
export const allStations = [...trunkStations, ...branch0Stations, ...branch1Stations, ...branch2Stations, ...branch3Stations, ...branch4Stations, ...branch5Stations, ...branch6Stations, ...branch7Stations, ...branch8Stations, ...branch9Stations, ...branch10Stations, ...branch11Stations, ...branch12Stations, ...branch13Stations]
export const allPipelines = [...trunkPipelines, ...branch0Pipelines, ...branch1Pipelines, ...branch2Pipelines, ...branch3Pipelines, ...branch4Pipelines, ...branch5Pipelines, ...branch6Pipelines, ...branch7Pipelines, ...branch8Pipelines, ...branch9Pipelines, ...branch10Pipelines, ...branch11Pipelines, ...branch12Pipelines, ...branch13Pipelines]