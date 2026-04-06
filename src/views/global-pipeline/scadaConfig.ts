export interface ScadaRecord {
    inP: number
    outP: number
    inT?: number
    outT?: number
    type?: 'compressor' | 'distribution' | 'valve'
}

export interface ScadaPanelConfig {
    id: string
    label: string
    data: Record<string, ScadaRecord>
    color: string
    bgFrom: string
    bgTo: string
    titleColor: string
}

export interface ScadaDataMapEntry {
    label: string
    data: Record<string, ScadaRecord>
    color: string
}

export const REAL_SCADA_DATA: Record<string, ScadaRecord> = {
    '中卫压气站': { inP: 6.391, outP: 7.856, inT: 7.7, outT: 30.8, type: 'compressor' },
    '盐池压气站': { inP: 7.133, outP: 7.092, inT: 10.3, outT: 10.2, type: 'compressor' },
    '靖边压气站': { inP: 6.681, outP: 8.947, inT: 5.7, outT: 34.9, type: 'compressor' },
    '子长分输站': { inP: 8.098, outP: 8.098, inT: 19.9, outT: 19.9, type: 'distribution' },
    '延川压气站': { inP: 7.88, outP: 9.175, inT: 21.4, outT: 31.9, type: 'compressor' },
    '沁水压气站': { inP: 6.889, outP: 8.762, inT: 18.0, outT: 39.4, type: 'compressor' },
    '阳城清管站': { inP: 7.936, outP: 7.912, inT: 16.4, outT: 16.4, type: 'distribution' },
    '博爱分输站': { inP: 7.118, outP: 7.126, outT: 26.2, type: 'distribution' },
    '郑州压气站': { inP: 6.166, outP: 7.83, inT: 20.1, outT: 41.9, type: 'compressor' },
    '薛店分输站': { inP: 7.273, outP: 7.273, outT: 34.8, type: 'distribution' },
    '淮阳压气站': { inP: 5.726, outP: 7.766, inT: 18.4, outT: 45.0, type: 'compressor' },
    '利辛分输站': { inP: 6.354, outP: 6.232, inT: 21.6, outT: 16.9, type: 'distribution' },
    '定远压气站': { inP: 4.818, outP: 6.245, inT: 12.8, outT: 35.0, type: 'compressor' },
    '龙池分输站': { inP: 6.005, outP: 6.002, outT: 19.3, type: 'distribution' },
    '龙源分输站': { inP: 5.971, outP: 5.59, outT: 20.4, type: 'distribution' },
    '镇江分输站': { inP: 5.573, outP: 5.575, outT: 14.9, type: 'distribution' },
    '常州分输站': { inP: 5.255, outP: 5.248, outT: 13.4, type: 'distribution' },
    '芙蓉分输站': { inP: 5.167, outP: 5.162, inT: 15.9, outT: 5.2, type: 'distribution' },
    '徐霞客分输站': { inP: 0.0, outP: 0.001, inT: 19.0, outT: 18.4, type: 'distribution' },
    '无锡分输站': { inP: 4.244, outP: 5.101, outT: 12.2, type: 'distribution' },
    '东桥分输站': { inP: 5.092, outP: 5.087, outT: 12.7, type: 'distribution' },
    '苏州分输站': { inP: 5.078, outP: 5.089, outT: 15.5, type: 'distribution' },
    '甪直分输站': { inP: 5.094, outP: 5.106, outT: 7.9, type: 'distribution' },
    '昆山分输站': { inP: 5.073, outP: 5.065, outT: 12.4, type: 'distribution' },
    '上海白鹤末站': { inP: 5.05, outP: 5.05, outT: 13.7, type: 'distribution' },
}

export const WE2_SCADA_DATA: Record<string, ScadaRecord> = {
    '霍尔果斯压气站': { inP: 7.566, outP: 9.615, inT: 15.7, outT: 34.5, type: 'compressor' },
    '精河压气站': { inP: 8.856, outP: 8.835, inT: 14.7, type: 'compressor' },
    '乌苏压气站': { inP: 7.981, outP: 7.977, inT: 13.8, type: 'compressor' },
    '玛纳斯压气站': { inP: 7.202, outP: 10.123, inT: 6.7, outT: 34.0, type: 'compressor' },
    '昌吉分输站': { inP: 9.492, outP: 9.526, inT: 6.7, type: 'distribution' },
    '乌鲁木齐压气站': { inP: 8.529, outP: 8.441, inT: 14.7, outT: 14.7, type: 'compressor' },
    '吐鲁番分输联络站': { inP: 7.826, outP: 7.832, inT: 29.5, outT: 28.7, type: 'distribution' },
    '连木沁压气站': { inP: 7.086, outP: 9.323, inT: 9.7, outT: 24.0, type: 'compressor' },
    '了墩压气站': { inP: 7.94, outP: 10.163, inT: 18.9, outT: 39.7, type: 'compressor' },
    '哈密分输站': { inP: 9.364, outP: 9.145, inT: 31.4, outT: 30.9, type: 'distribution' },
    '烟墩压气站': { inP: 9.011, outP: 8.977, inT: 26.8, outT: 25.5, type: 'compressor' },
    '红柳压气站': { inP: 7.462, outP: 10.155, inT: 13.3, outT: 38.6, type: 'compressor' },
    '瓜州压气站': { inP: 9.162, outP: 9.12, inT: 24.5, outT: 24.4, type: 'compressor' },
    '嘉峪关压气站': { inP: 7.753, outP: 9.67, inT: 12.8, outT: 31.9, type: 'compressor' },
    '张掖压气站': { inP: 8.599, outP: 8.555, inT: 17.1, outT: 16.6, type: 'compressor' },
    '永昌压气站': { inP: 6.765, outP: 8.201, inT: 6.9, outT: 23.9, type: 'compressor' },
    '武威分输站': { inP: 7.655, outP: 4.006, inT: 18.2, outT: 5.0, type: 'distribution' },
    '古浪压气站': { inP: 6.731, outP: 8.693, inT: 10.6, outT: 31.9, type: 'compressor' },
    '中卫压气站(二线)': { inP: 8.177, outP: 8.178, inT: 24.7, type: 'compressor' },
    '彭阳压气站': { inP: 6.765, outP: 8.201, inT: 6.9, outT: 23.9, type: 'compressor' },
    '灵台压气站': { inP: 6.153, outP: 8.388, inT: 12.3, outT: 38.0, type: 'compressor' },
    '高陵压气站': { inP: 7.511, outP: 7.539, inT: 26.7, type: 'compressor' },
    '潼关压气站': { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
    '洛宁压气站': { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
    '鲁山压气站': { inP: 6.614, outP: 9.23, inT: 21.0, type: 'compressor' },
    '枣阳压气站': { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
    '黄石压气站': { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
    '南昌压气站': { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
    '吉安压气站': { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
    '广州压气站': { inP: 6.663, outP: 9.167, inT: 22.6, outT: 47.7, type: 'compressor' },
}

export const WE1_WEST_SCADA_DATA: Record<string, ScadaRecord> = {
    '轮南压气站': { inP: 7.566, outP: 8.415, inT: 23.9, outT: 52.8, type: 'compressor' },
    '孔雀河压气站': { inP: 8.831, outP: 8.832, inT: 25.6, outT: 49.4, type: 'compressor' },
    '四道班压气站': { inP: 7.768, outP: 7.735, inT: 30.0, outT: 29.6, type: 'compressor' },
    '哈密压气站': { inP: 5.878, outP: 8.868, inT: 12.6, outT: 47.0, type: 'compressor' },
    '雅满苏压气站': { inP: 8.517, outP: 8.509, inT: 23.0, outT: 23.0, type: 'compressor' },
    '红柳压气站': { inP: 7.382, outP: 7.388, inT: 9.8, outT: 10.6, type: 'compressor' },
    '玉石压气站': { inP: 5.935, outP: 8.814, inT: 6.1, outT: 37.4, type: 'compressor' },
    '温泉压气站': { inP: 8.298, outP: 8.245, inT: 10.0, outT: 9.7, type: 'compressor' },
    '古浪分输压气站': { inP: 6.875, outP: 6.594, inT: 6.9, outT: 6.6, type: 'compressor' },
}

export const CRED_SCADA_DATA: Record<string, ScadaRecord> = {
    '黑河首站': { inP: 9.708, outP: 11.174, inT: 2.9, outT: 14.4, type: 'compressor' },
    '五大连池压气站': { inP: 9.23, outP: 10.584, inT: 4.4, outT: 15.1, type: 'compressor' },
    '明水压气站': { inP: 8.629, outP: 10.546, inT: 5.6, outT: 21.4, type: 'compressor' },
    '大庆分输站': { inP: 9.148, outP: 9.0, inT: 13.0, type: 'distribution' },
    '肇源压气站': { inP: 8.756, outP: 8.761, inT: 7.7, type: 'compressor' },
    '双辽分输站': { inP: 8.585, outP: 10.549, inT: 10.7, outT: 27.1, type: 'distribution' },
    '长岭分输站': { inP: 9.048, outP: 9.086, inT: 18.5, outT: 16.6, type: 'distribution' },
    '锦州压气站': { inP: 8.629, outP: 10.546, inT: 5.6, outT: 21.4, type: 'compressor' },
    '永清压气站': { inP: 8.447, outP: 8.451, inT: 6.5, outT: 6.9, type: 'compressor' },
    '安平压气站': { inP: 7.291, outP: 8.839, outT: 34.6, type: 'compressor' },
    '德州分输站': { inP: 7.291, outP: 7.291, type: 'distribution' },
    '济南西分输站': { inP: 6.505, outP: 6.509, type: 'distribution' },
    '泰安压气站': { inP: 6.116, outP: 8.4, inT: 12.0, outT: 36.8, type: 'compressor' },
    '临沂分输清管站': { inP: 7.888, outP: 7.862, inT: 15.9, outT: 15.7, type: 'distribution' },
    '连云港分输压气站': { inP: 7.291, outP: 8.064, outT: 22.4, type: 'compressor' },
    '阜宁联络站': { inP: 8.034, outP: 8.045, type: 'distribution' },
    '盐城分输清管站': { inP: 7.98, outP: 7.992, type: 'distribution' },
    '泰兴联络站': { inP: 7.25, outP: 7.218, inT: 15.3, type: 'distribution' },
    '南通联络站': { inP: 7.21, outP: 7.248, inT: 16.5, outT: 6.4, type: 'distribution' },
    '常熟分输站': { inP: 7.128, outP: 7.103, inT: 16.4, outT: 18.3, type: 'distribution' },
    '甪直末站': { inP: 7.061, outP: 5.097, inT: 17.0, outT: 7.8, type: 'distribution' },
}

export const PT_SCADA_DATA: Record<string, ScadaRecord> = {
    '鲁山压气站': { inP: 5.832, outP: 5.831, inT: 18.3, type: 'compressor' },
    '禹州分输站': { inP: 5.742, outP: 5.742, type: 'distribution' },
    '薛店分输站': { inP: 5.767, outP: 5.782, type: 'distribution' },
    '中牟分输站': { inP: 5.759, outP: 5.77, type: 'distribution' },
    '开封分输站': { inP: 5.73, outP: 5.724, type: 'distribution' },
    '杞县分输站': { inP: 5.689, outP: 5.688, inT: 14.5, type: 'distribution' },
    '兰考分输站': { inP: 5.66, outP: 5.66, type: 'distribution' },
    '菏泽分输站': { inP: 5.646, outP: 5.619, inT: 15.7, outT: 15.6, type: 'distribution' },
    '巨野分输站': { inP: 5.615, outP: 5.616, inT: 14.6, type: 'distribution' },
    '济宁分输站': { inP: 5.597, outP: 5.616, inT: 14.6, type: 'distribution' },
    '上山末站': { inP: 5.542, outP: 4.203, inT: 16.5, outT: 10.5, type: 'distribution' },
    '泰安压气站': { inP: 4.203, outP: 5.883, inT: 22.6, outT: 16.6, type: 'compressor' },
}

export const ZG_SCADA_DATA: Record<string, ScadaRecord> = {}
export const ZM_SCADA_DATA: Record<string, ScadaRecord> = {}
export const GN_SCADA_DATA: Record<string, ScadaRecord> = {}
export const GS_SCADA_DATA: Record<string, ScadaRecord> = {}
export const SJ4_SCADA_DATA: Record<string, ScadaRecord> = {}
export const SJ3_SCADA_DATA: Record<string, ScadaRecord> = {}
export const SJ2_SCADA_DATA: Record<string, ScadaRecord> = {}
export const NCSH_SCADA_DATA: Record<string, ScadaRecord> = {}
export const JXLZ_SCADA_DATA: Record<string, ScadaRecord> = {}

export const EXTRA_SCADA_PANELS: ScadaPanelConfig[] = [
    { id: 'zg', label: '中贵线', data: ZG_SCADA_DATA, color: '#f59e0b', bgFrom: 'rgba(25,15,5,0.93)', bgTo: 'rgba(35,20,5,0.93)', titleColor: '#fde68a' },
    { id: 'zm', label: '中缅线', data: ZM_SCADA_DATA, color: '#ef4444', bgFrom: 'rgba(25,5,5,0.93)', bgTo: 'rgba(35,5,8,0.93)', titleColor: '#fecaca' },
    { id: 'gn', label: '广南支干线', data: GN_SCADA_DATA, color: '#14b8a6', bgFrom: 'rgba(5,20,18,0.93)', bgTo: 'rgba(5,28,25,0.93)', titleColor: '#99f6e4' },
    { id: 'gs', label: '广深支干线', data: GS_SCADA_DATA, color: '#f97316', bgFrom: 'rgba(25,12,5,0.93)', bgTo: 'rgba(30,15,5,0.93)', titleColor: '#fed7aa' },
    { id: 'sj4', label: '陕京四线', data: SJ4_SCADA_DATA, color: '#6366f1', bgFrom: 'rgba(10,5,25,0.93)', bgTo: 'rgba(15,8,35,0.93)', titleColor: '#c7d2fe' },
    { id: 'sj3', label: '陕京三线', data: SJ3_SCADA_DATA, color: '#818cf8', bgFrom: 'rgba(12,5,28,0.93)', bgTo: 'rgba(18,8,38,0.93)', titleColor: '#c7d2fe' },
    { id: 'ncsh', label: '南昌-上海支干线', data: NCSH_SCADA_DATA, color: '#06b6d4', bgFrom: 'rgba(5,15,22,0.93)', bgTo: 'rgba(5,20,30,0.93)', titleColor: '#a5f3fc' },
    { id: 'jxlz', label: '嘉兴-甪直联络线', data: JXLZ_SCADA_DATA, color: '#84cc16', bgFrom: 'rgba(10,18,5,0.93)', bgTo: 'rgba(15,22,5,0.93)', titleColor: '#d9f99d' },
    { id: 'sj2', label: '陕京二线', data: SJ2_SCADA_DATA, color: '#a1887f', bgFrom: 'rgba(18,12,8,0.93)', bgTo: 'rgba(25,16,10,0.93)', titleColor: '#d7ccc8' },
]

export const WE1_FULL_STATIONS: { name: string; inP: number; outP: number; type: string }[] = [
    ...Object.entries(WE1_WEST_SCADA_DATA).map(([name, d]) => ({
        name,
        inP: d.inP,
        outP: d.outP,
        type: d.type || 'compressor',
    })),
    ...Object.entries(REAL_SCADA_DATA).map(([name, d]) => ({
        name,
        inP: d.inP,
        outP: d.outP,
        type: d.type || 'distribution',
    })),
]

export const SCADA_DATA_MAP: Record<string, ScadaDataMapEntry> = {
    we1: { label: '西气东输一线', data: REAL_SCADA_DATA, color: '#10b981' },
    'we1-west': { label: '西气东输一线（西段）', data: WE1_WEST_SCADA_DATA, color: '#f59e0b' },
    we2: { label: '西气东输二线', data: WE2_SCADA_DATA, color: '#3b82f6' },
    cred: { label: '中俄东线', data: CRED_SCADA_DATA, color: '#ec4899' },
    pt: { label: '平泰支干线', data: PT_SCADA_DATA, color: '#a855f7' },
    ...Object.fromEntries(
        EXTRA_SCADA_PANELS.map(panel => [
            panel.id,
            { label: panel.label, data: panel.data, color: panel.color },
        ]),
    ),
}
