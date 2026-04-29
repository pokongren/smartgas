/**
 * 闂備線娼婚梽鍕熆濡ソ鐟邦潨閳ь剟鐛箛娑樼闁哄鍨熼崣褏绱撴担鍝勵€撶紒杈ㄦ礋楠炲啯绻濋崟顒€鏋傞梺绯曞墲椤ㄥ棛绮嬮崼銉︾叆婵炴垶顭囨晶銏ゆ倵濮樼厧骞樼紒顔规櫇閳ь剨缍嗛崰鎾诲焵椤掆偓椤﹂潧螞閸愵噯缍栨い鏂垮⒔椤? *
 * 闂備礁鎲￠悷顖涚濠靛柈鐔稿緞瀹€鈧惌鍡涙煣韫囨洘鍤€闁搞倝浜堕弻鐔兼煥鐎ｎ偄闉嶆繝鈷€浣糕偓妤佺閿曞倸纾奸柨鏂垮⒔椤︹晝绱撴担鍝勑涢柛瀣尰缁绘盯鐓鐙€妲┑鐐存崌缁犳牠骞?+ 闂備胶鍎甸弲娑㈩敋椤撱垹鍚归幖娣妽閺咁剙顭块懜鐢点€掔紒鈧径鎰拻闁告侗鍠栨慨灞句繆椤愩垻鐒告鐐茬Ч閸┾偓妞ゆ帒瀚€氬顭跨捄铏圭伇鐟滅増鐓￠弻?闂傚倸鍊搁崯鐘诲磻閹剧粯鍊垫鐐茬仢閳ь剚顨呴埢鎾诲箣閻愯尙绐為悗骞垮劚濡瑧寰婃禒瀣厱闁靛绠戦崝銈夋煠闂€鎰祮濠? * 闂備胶绮悷顖炲礈濞戙垺鍋熸繛鎴炵懅椤╂煡骞栫划鍏夊亾閸愯弓绱熼梻浣规偠閸庢娊寮查锔绘晣闁告縿鍎崇壕楣冩煙鐎电啸闁糕晝濮撮埥澶愬箻椤栨矮澹曢梺鑽ゅ枑閻熴儱螞濡も偓闇夋慨妞诲亾鐎?Canvas 闂備礁缍婇弨閬嶅箰缂佹ɑ娅犻柕鍫濇处閸犲棝鏌涢埄鍐炬畷缂佸倸鐗撻弻? */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import MapView from '@/components/map-view/MapView'
import ScadaHistoryChart from '@/components/scada/ScadaHistoryChart'
import { buildPipelineDataFromPackages, invalidatePipelineCache, loadAllPipelines } from '@/data/pipelines'
import type { PipelinePackage } from '@/data/pipelines/types'
import { useSimulation } from '@/hooks/useSimulation'
import {
    topologyEditorApi,
    type JunctionGroup,
    type PositionPreviewResult,
} from '@/services/topologyEditorApi'
import type { PipelineNode, PipelineLine } from '@/types'
import {
    validateTopology,
    computeBetweennessCentrality,
    findIsolatedNodes,
} from '@/utils/topology-validator'
import type { ValidationReport } from '@/utils/topology-validator'
import { buildSimulationOverlayMapping } from '@/utils/simulationOverlayMapping'
import { simulateCutoff, searchNodes, pathIdsToNames } from '@/utils/cutoff-simulator'
import type { CutoffResult } from '@/utils/cutoff-simulator'
import { clearSimulationShowcaseSyncContext, writeSimulationShowcaseSyncContext } from '@/utils/simulationShowcaseSync'
import { setAssistantRuntimeContext } from '@/components/ai-assistant/runtimeAssistantContext'
import type { SimulationInitialInput } from '@/types/simulation'
import { MAINLINE_SCENARIOS } from '@/types/simulation'

// ================== 缂傚倷绶￠崑澶愵敋瑜旈幃?==================
type PointType = 'station' | 'valve' | 'distribution' | 'compressor' | 'junction'
type EditMode = 'view' | 'draw-point' | 'connect' | 'merge'
type PanelTab = 'edit' | 'validate' | 'search' | 'centrality' | 'cutoff' | 'simulation'

interface TopoNode {
    id: string
    type: PointType
    name: string
    position: [number, number]
    sourceNodeIds?: string[]
    internalSourceEdgeIds?: string[]
    junctionId?: number
    isJunction?: boolean
    junctionKind?: string
    sourceTable?: string
    marker?: any
}

interface TopoEdge {
    id: string
    startNodeId: string
    endNodeId: string
    name?: string
    sourceEdgeIds?: string[]
    poly?: any
}

interface BaseTopoNode {
    id: string
    type: PointType
    name: string
    position: [number, number]
}

interface BaseTopoEdge {
    id: string
    startNodeId: string
    endNodeId: string
    name?: string
    sourceEdgeIds?: string[]
}

const WE1_PRIMARY_PILOT_ID = 'mainline_zhongwei_jingbian'
const TOPOLOGY_DRAFT_STORAGE_KEY = 'smartgas-map-topology-draft-v1'

function formatDateTimeLabel(value?: string): string {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString('zh-CN', { hour12: false })
}

function estimateTemperatureByPressure(pressureMpa: number): number {
    return Number((13 + pressureMpa * 1.7).toFixed(1))
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0
    if (value <= 0) return 0
    if (value >= 1) return 1
    return value
}

function formatSignedNumber(value: number, digits = 2): string {
    const sign = value > 0 ? '+' : ''
    return `${sign}${value.toFixed(digits)}`
}

/*function buildOpsSuggestion(alertCount: number, avgUtilization: number, solverStatus: 'converged' | 'max_iter' | 'error'): string {
    if (solverStatus === 'error') return '本次求解失败，先检查场景参数和边界条件，再重跑主仿真。'
    if (solverStatus === 'max_iter') return '本次达到迭代上限，建议先减小扰动幅度并核对基线快照。'
    if (alertCount >= 5) return '告警偏多，优先排查主干高负荷段和压气站上下游压差。'
    if (avgUtilization >= 0.82) return '利用率偏高，建议先做限流场景对比并准备调峰策略。'
    return '运行状态平稳，可将当前结果作为下一轮异常场景对比基线。'
}

*/
function buildOpsSuggestion(alertCount: number, avgUtilization: number, solverStatus: 'converged' | 'max_iter' | 'error'): string {
    if (solverStatus === 'error') return '本次求解失败，先检查场景参数和边界条件。'
    if (solverStatus === 'max_iter') return '达到迭代上限，建议先降低扰动幅度后重试。'
    if (alertCount >= 5) return '告警较多，优先排查主干高负荷区段。'
    if (avgUtilization >= 0.82) return '利用率偏高，建议先做限流对比场景。'
    return '运行平稳，可作为后续对比基线。'
}

function safeSetMarkerContent(marker: any, content: string): void {
    try {
        marker?.setContent?.(content)
    } catch (error) {
        console.warn('[MapTopologyView] marker.setContent failed', error)
    }
}

function safeSetPolylineOptions(polyline: any, options: Record<string, unknown>): void {
    try {
        polyline?.setOptions?.(options)
    } catch (error) {
        console.warn('[MapTopologyView] polyline.setOptions failed', error)
    }
}

/*const SOLVER_STATUS_LABELS: Record<'converged' | 'max_iter' | 'error', string> = {
    converged: '闁诲骸婀遍…鍫濐嚕閸洖鏋佺憸鐗堝笒閺?,
    max_iter: '闂佸搫顦悧濠囧磿閹惰棄鏄ラ悘鐐靛亾娴溿倖銇勯幘瀵哥畵闁轰讲鏅涢埥澶愬箻缁涚鍚┑?,
    error: '婵犳鍠氶幊鎾诲磹閸婄噥鏆板┑鐘灪閸庤偐鍒掗崜褎鍠?,
}

const FAILURE_LAYER_LABELS: Record<'frontend-consumption' | 'mapping-source-ids' | 'overlay-contract' | 'rendering-style', string> = {
    'frontend-consumption': '闂備胶顭堢换鎰版偋婵犲洦鍋傞柨鐔哄Т缁€鍫⑩偓骞垮劚濞村倹瀵奸崒娑氱闁瑰瓨绻勬晶锝夋煕閵娿儱鈧粯绂掗敃鍌氱＜闁挎柨澧介ˇ銕漚pTopologyView / 闂傚倸鍊搁悧鍕垂閸濆嫷鐔嗘慨妞诲亾闁?,
    'mapping-source-ids': '闂備礁鎲￠崝鏇犵矓閻㈠憡鍋?source IDs 闂?overlay IDs 闂備焦鐪归崝宀€鈧凹鍘煎嵄鐟滃繑绂?,
    'overlay-contract': '闂備礁鎲￠崝鏇犵矓閻㈠憡鍋?simulation-overlay 濠电娀娼ч崐褰掑垂閸︻厸鍋?,
    'rendering-style': '闂備礁鎼悧鍐磻閹剧粯鐓曟慨姗嗗墴椤庢鏌涢悢鎻掍壕闂備礁鎼悮顐﹀磿閸楃儑鑰块柟缁㈠枛閻愬﹪鏌ｉ幇闈涘濠㈢懓顦遍埀顒侇問閸犳牜鎹㈤幇鏉跨闁哄锟ラ埀顒佸浮瀹曪絾寰勭仦钘夎劘闂佽娴烽弫鎼併€佹繝鍥ㄥ瘶?,
}

const MAINLINE_SCENARIO_PLAYBOOK: Record<string, {
    focus: string
    success: string
    risk: string
    talk: string
}> = {
    steady_base: {
        focus: '闂備胶顭堢换鎰版偋韫囨搫鑰块柛娑卞枤閳绘棃鎮归崶銊ョ祷闁告瑱绻濋弻娑樜熸笟顖氬壈婵犳鍠栫换妯虹暦椤忓棔娌柛鎾椾礁浜伴梻鍌欑劍瑜板啰鎹㈤幋婢綁宕ㄦ繝鍕ㄦ灃閻庡箍鍎卞Λ娆戠懅婵°倗濮烽崑鐐寸箾婵犲洤违閹兼番鍔嶉弲顒傗偓鍏夊亾闁逞屽墴閸ㄦ儳螣閸忕厧顎涢梺闈涚墕濞村倿宕曢幋婵冩闁圭虎鍨版禍楣冩倵濞堝灝鏋ゅ┑顔芥綑闇夋慨妞诲亾闁硅櫕顨婇幃鍓т沪閹烘挻鈷掗柍褜鍓濋～澶嬬┍閾忓湱鐜婚柛銉墯閻掔粯鎱ㄥΟ绋垮姉闁?,
        success: '闂備浇顕栭崜婵嬵敊婵犲嫭顐介柣銏㈡暩绾惧吋绻涢崱妤冃滈柛瀣尰閹峰懘宕楁径濠佸婵犵數濮电喊宥嗙濡粯鍙忛柣鐔告緲閳ь剙鐖奸崺鈧い鎴ｆ硶椤︼箓姊虹憴锝嗘珚鐎规洘鎮傚畷鎯邦槻闁绘帗妞介弻锝夛綖椤掆偓婵¤法鈧湱顭堥妶鎼佸蓟閸儱纾归柣鏂垮槻楠炲鈹戦鐣岀缂佽弓绮欓幃銉╁醇閺囩喎顎忛梺鑺ッˇ顖毿掓径鎰厸濠㈣泛鐗嗛崝鐢电磼鏉堛劎绠炵€规洏鍔嶇换婵嬪椽娴ｇ韦闂備浇妗ㄧ欢姘躲€傞敂鍓х當濠㈣泛鏈崯鍝劽归敐鍫燁仩鐎规洘鍔欓弻锝夊箳閺囩喓銆愰悗瑙勬礀閺堫剟銆冮崶顬喓鍖栭弴鐐板?,
        risk: '濠电姷顣介埀顒€鍟块埀顒€缍婇幃妯诲緞鐏炵偓娈板┑顔界箓閻牆顭囬幇顔剧＜閻庯綆鍘介悵顏堟煃瑜滈崗娑氭濮樿泛绀傛俊顖濄€€閺岋箓鏌嶉埡浣告殲缂佺姵甯炵槐鎾存媴鐟欏嫬闉嶉梺璇茬箰椤︾敻寮鍥︽勃闁兼亽鍎遍埀顒傛暬濮婂宕煎☉妯间紕濠电偛鐗婇崹鐢割敋閿濆纾兼慨妯哄船閻撴垿姊洪棃鈺侇洭闁稿簺鍊曢埢宥呪枎閹惧磭顦ч梺鍓插亝缁诲倿鎮炴總鍛婂仯濞达絿鐡旈崵瀣磼鏉堛劎绠炵€规洘顨婂畷濂告偄閼茶　鏅滈幈銊モ攽閹捐泛鍩岀紓浣瑰閸撴繄绮嬮幒鏃€宕夐柕濠忕畱閻掓悂鏌ｉ悩闈涘妺闁搞劌娼￠崺鈧い鎺嶇閹兼悂鏌?,
        talk: '闂備胶顭堢换鎰版偋韫囨稑鏋侀柕鍫濇处閺嗘粍鎱ㄥ┑鍡欑劸婵炲吋鍔楃槐鎺斺偓锝庡幗閻濐亪鏌嶈閸忔盯鎮為敂鎴掔箚闁告稑锕﹂埢鏂库攽閻樺磭顣查柟宕囧█閺岀喖宕归锝呯３闂侀€炲苯澧柣鏃戝墰濡叉劕鈹戦崼鐔风彴婵炶揪缍€椤锝為弽顓熺厵闂佸灝顑嗙亸鏉款熆瑜嬮崐婵囦繆鐎涙ɑ濯撮柛娑樼仛濡啴鐛埀顒€霉閿濆懏璐℃繝鈧幘顔藉仭婵炲棙鐟ч崚浼存煙妞嬪骸顣奸柕鍥у閹粙宕ㄦ繝鍐︹偓鍐⒒娓氬洤鏋︽俊顐㈠瀹曟瑩鏁嶉崟顓狅紲闂婎偄娲﹀銊х不閹€妲堥柟鐐墯閻掗箖鏌?,
    },
    zhongwei_compressor_offline: {
        focus: '闂傚倷鐒﹁ぐ鍐矓閸洖纾婚柨婵嗩槹閸庢垿鎮楅敐鍌涙珗闁告﹩鍓熼弻娑樜旀繝鍌欑盎闁汇埄鍨板ú銈夛綖濠靛绫嶉柛灞剧矊鐠佹煡姊虹粙娆惧剱缂侇喖绻掗幑銏狀吋婢跺﹨袝闁瑰吋鎯岄崹宕囩矆婢跺ň妲堥柟鍓ь劜濮婃绱掑Δ鈧幊搴ㄥΥ閹烘梻鐭欓柛顭戝枤椤忓姊洪崨濠冣拹缂佸甯掗敃銏℃媴缁洘鐓㈤梺鏂ユ櫅閸燁垳绮婚幒妤佺厸闁告洦鍋勯銏′繆椤栨凹妯€妤犵偞甯楀鍕償閵忕姴濮嶉梻?,
        success: '闂備胶纭堕弲鐐测枍閿濆鍚归幖杈剧岛閸嬫挻鎷呴崘鐐秷闂佷紮瀵岄崳锝夊蓟鐏炵晫鏆嗛柛鎰╁妼楠炲姊哄ú璁崇盎妞ゆ垵鎳樺畷鐢割敇閵忊€虫疅闂佺鏈划灞剧椤栫偞鐓曟俊顖欒閸庡繑淇婇姘捐含闁轰礁绉舵禒锕傛嚍閵夈儲顓煎┑鐐村灦閹尖晠宕ｉ埀顒€鈹戦埥鍡楀籍闁诡喗鐟╅幃鐑芥偋閸繍浼呴梻浣告啞缁嬫垿鏁冮妸鈺婃晢闁绘梻鍘ч弸浣肝涙０浣藉厡缂佹劖顨嗛幈銊╂晲閸℃鍙嗛梺缁樼墪婢у酣骞夐幘顔肩妞ゆ挴鍋撻柡鍐ㄧ墕缁犳垵霉閿濆牜娼愮紒缁㈠灦閺岋繝宕熼銏╁妷濠碘槅鍨伴ˇ鍨繆?,
        risk: '濠电姷顣介埀顒€鍟块埀顒€缍婇幃妯诲緞婵炵偓鐓㈤梺璺ㄥ枔婵參宕戦幘鏉戠窞濠电姴瀚弫銈囩磽娴ｇ懓鍔ら柣蹇旂箞楠炴捇鍩￠崨顔间簵閻熸粍绻勫Σ鎰攽閸ャ劋姘﹀┑鐐叉闁帮綁宕电€ｎ喗鐓曢柨鏃€鍎抽崝瀣箾閸涱喚鎳囩€规洩缍侀、鏃堝炊瑜嶉獮瀣⒑濞茶绨绘い鎴濇嚇瀹曞搫鐣濋崘锔挎睏闂佽鍎抽崯鍧椔烽崨瀛樼厱濠电姴瀚ㄩ埀顒€顑囧Σ鎰攽鐎ｎ偄鍓抽柣搴岛閺呮繈鎮峰┑瀣厱闁瑰瓨绻冮幆鍫澝归悩闈浶ｆ繛鐓庮煼楠炲洭顢楅埀顒劼烽崨瀛樼厱婵﹩鍓熼妤佷繆椤栨熬宸ユい鏇秮瀹曟帒螣瀹勯澹?,
        talk: '闂佸搫顦弲婊堟偡閵堝洨鍗氶柟缁㈠枤瀹撲線鏌￠崶銊ㄥ闁伙附绮撻幃鐑藉即濮橆厾銈板銈嗘煥椤﹂潧鐣烽姀鈶╁亾閿濆骸浜炴慨锝嗙矌缁辨帡寮埀顒勬偡閵壯勵潟闁规崘鍩栭弳婊呯磼鐎ｎ偄顕滈柛濠勬暬閺屻劌鈽夊Ο渚闁诲酣娼ч惌鍌炴偘椤曗偓楠炴捇骞掗幋鐙€浼濋梻浣告啞濮婂湱绮欓幒鎳筹綁骞栨担鍝ョ暠闁圭厧鐡ㄧ换鍕偪閸曨厸鍋撻崹顐㈩棎闁稿鎸搁埥澶愬箻缁涜顣肩紓浣诡殔閹冲酣濡撮幒妤佲拹闁归偊鍠氶崐鐐烘⒒娓氬洤浜濋悽顖滃仜閳绘捇骞嬮敃鈧繚?,
    },
    zhongwei_trunk_break: {
        focus: '闂傚倷鐒﹁ぐ鍐矓閸洖纾婚柨婵嗩槹閸庢垿鎮楅敐鍌涙珗闁告﹩鍓熼弻娑樜旀繝鍌欏枈濠碉紕铏庨崰妤€顭囨繝姘婵犲﹤鍟板Σ锝呂旈悩闈涗哗鐎殿喗鎹囬幊娆撳箣閿曗偓濡ɑ銇勯幘璺轰沪闁稿﹦鏁婚弻銊モ槈濡偐鍔紓浣虹帛缁嬫捇鎯€椤忓牆绠伴幖杈剧祷閸嬪﹪姊绘担鐟扮祷缂佺粯鍔欓獮蹇涙偋閸懇鏋栭柣搴秵閸嬪棝宕哄Δ鈧妴鎺戭潩椤撶姰鈧帞绱掗璇插祮妤犵偐鍋撻柟鐓庣摠缁诲嫰鎮块崟顖涚厱婵炲棙鍏庨鍡忓亾閸偆鍙€濠?,
        success: '闂備胶纭堕弲鐐测枍閿濆鍚归幖杈剧岛閸嬫挻鎷呴崘鐐秷闂佷紮瀵岄崳锝夊蓟鐏炵晫鏆嗛柍褜鍓欓埢鎾诲箣閻愮繝姘﹂梺缁樺姍濞佳冣枔閻樺磭绠剧紓鍫㈠Х缁愭棃鏌涢敐鍡樸仢鐎规洩绲借灒闁告繂瀚烽崵娆愮箾閺夋垵鎮戦柤鐟板⒔濞嗐垽濮€閵忋垻骞撴繛杈剧悼椤牆袙婢舵劖鐓ユ繛鎴灻〃娆戠磼濡も偓閹冲酣濡撮幒鏃傜煓闁圭楠稿▓銉︾箾閹寸偞鎯勯柛姗€绠栧畷鎴︽晲閸モ晜锛忛梺鍓茬厛閸犳鈧碍鐓￠弻娑樷槈濮楀牓绶村銈嗗笧閸犳劗鈧數鍘ч～婵嬵敃閵堝簼绱橀梺鑽ゅ閸ャ劍鏆犳繝娈垮櫘閸犳顕ラ崟顐勫酣顢栭挊澶夊?,
        risk: '濠电姷顣介埀顒€鍟块埀顒€缍婇幃妯诲緞閹邦剙寮烽梺缁橆焾鐏忔瑥鈻撻幖浣瑰仭闁哄洨鍋為ˉ鐘崇箾閹绘帪韬鐐搭殔铻ｆ繛鍡欏亾閻姊绘担鐟扮祷闁兼椿鍨堕獮濠囧焺閸愵亖鏋栧銈嗘尰缁诲嫰鎮峰┑瀣仱闁圭儤妫忛崝婊呯磼鏉堛劎绠栨繛鑹邦嚙閳诲孩鎯旈妸銉︾杺闂備線娼绘俊鍥磿閵堝應鏋嶆繛鍡樺姇椤曡鲸鎱ㄥΟ鍧楀摵缂佺姵鐟ラ埥澶愬箻瀹曞泦锝囩磼閺冨浂鍤欓摶鏍ㄦ叏濮楀棗骞楅柣鎺嶇矙閺岋綁骞囬钘夋畬婵犻潧鍊归悧鐘茬暦椤愩埄鍚嬮柛娑卞幖瀵绻涚壕瀣汗濠殿喗鎸冲畷鍝勭暆閸曨偂绱跺銈呯箰閸婄敻宕?,
        talk: '闂佸搫顦弲婊堟偡閵堝洨鍗氶柟缁㈠枤瀹撲線鏌￠崶锝嗩潑闁哥偟鎳撻埥澶愬箻鐠団€虫闂佺绻樻禍璺侯嚕椤愶箑宸濋悗娑欙供閸炶埖绻涚壕瀣汗濠殿喚鏁婚獮鎰版焼瀹ュ棙娅栭柣蹇曞仧閸嬫挻绂掑鈧娲敃閵忕姭鍋撻幖浣哥畺閹兼番鍔岀粻顖炴煙缁嬪灝顒㈤梻鍕У缁绘繈寮撮悢绯曟嫽闂侀潧娲﹀銊у垝椤撱埄鏁勯悹渚厛娴煎洭鎮楀▓鍨灓濠殿喗娼欓湁婵せ鍋撻柟顖氬暣瀹曠喖顢楅崒姘兼闂傚鍋勫ú銈夊疮閳哄懏鍋濇い鏍仜绾惧湱绱掑Δ鍕┾偓鈧柛?,
    },
    yanchi_jingbian_limited: {
        focus: '闂傚倷鐒﹁ぐ鍐矓閸洖纾婚柨婵嗩槹閸庢垿鎮楅敐搴″缁炬拝闄勯幈銊╁捶椤撶倫銏ゆ煕閳轰胶鐒告俊顐㈠暣瀵粙顢楅崒婊冮獎闂傚倸鍊哥€氼參宕濋弽顐ょ焾闁挎洖鍊哥憴锕傚箹閹碱厼鐏ｇ紒鈧径鎰厱闁瑰搫妫欏▍鍥煛娴ｉ潧鈧繈骞冮幎钘夌倞鐟滃海鈧碍鐓￠弻娑滅疀閺傚簱鏋欓梺杞扮贰閸樺ジ鍩㈤幘瀛樺闁告劦浜跺Σ褰掓煛婢跺苯浠╁┑顔哄€曢敃銏℃媴缁洘鐓㈤梺鏂ユ櫅閸燁垳绮婚幒妤佺厵濡増绻傛晶顔锯偓瑙勬礀閻倹淇?,
        success: '闂佸搫顦弲婊堝礉濮椻偓閵嗕線骞嬮悩鐢碉紲闂佽鍎抽顓熺椤栫偞鐓欓柤鎭掑労閻掔偓銇勯埡瀣暤闁哄苯鐬兼禒锔界鐎ｎ偄鐨洪梻浣侯潒閸愨晜鎮欓梺绯曟櫅鐎氫即骞冩禒瀣╃憸宥夋嚍閸愯褰掑礂閼规澘顥濋悷婊勬緲椤﹂潧鐣烽悩璇插唨闁汇垻鏁搁ˇ顕€鏌℃径鍡樻珖闁稿鍠栧畷鍨償閿濆棗鐝伴梺鎸庢濡嫰宕滄导瀛樷拺闁圭粯甯為悘杈ㄧ箾閸喎鐏寸€规洘宀搁崺锟犲礃閳哄倹顓归梻浣虹帛缁苯煤閵堝憘鐔哥節閸パ咃紮闂佽壈顫夊姗€宕㈤幘顔界厽妞ゅ繐瀚烽崕蹇涙煕閵堝骸寮€殿喖鐖兼俊鐑芥晲閸屾矮澹?,
        risk: '濠电姷顣介埀顒€鍟块埀顒€缍婇幃妯诲緞鎼存稐姹楅梺瑙勫劤閸熷潡路閸涘瓨鐓曢柨鏃€鍎抽崝瀣箾閸涱喚鎳冮柍璁崇矙閺佸秹宕熼浣烘殮闂傚鍋勫ù鍌炲磻閸℃稑鐭楅幖娣妽閺咁剟鎮橀悙鑸殿棄婵炴嚪鍥ㄢ拻闁割偁鍨瑰皬缂備焦姊瑰娆撳煝鎼淬劍顎愮紓浣筋嚙缁夊爼骞冮弶璺ㄦ殕闁逞屽墰閸掓帡濡搁埡浣稿殤濠电姴锕ラ崝妤冪矆婢跺ň妲堥柟鎯х－鏁堥梺閫炲苯澧柛濠冩倐楠炲啯鎯旈妸銉ь唵闂佸湱顭堢€涒晠姊藉澶嬬厱閻庯綆鍋呴惃鎴︽嚕濞嗘挻鍊甸悷娆忓閸濇椽鏌ｅ☉娆戞噰鐎殿喓鍔戦悡顒€霉鐎ｎ亙澹?,
        talk: '闂佸搫顦弲婊堟偡閵堝洨鍗氶柟缁㈠枤瀹撲線鏌￠崶锝嗩潑闁哥偛缍婂濠氬礋椤掆偓婵牏绱掓笟濠勭暤闁轰礁绉舵禒锕傛嚃閳哄啯鍠掗梻浣告惈鐎氱兘宕归柆宥呰摕闁搞儯鍔嶇紞鍥煙閸喖顏紒鈧径鎰厾闁哄瀵у﹢鐗堜繆閹绘帗鍟炵紒瀣槺閹风娀骞撻幒鎴濈稇闂佸搫顦弲婊堚€﹂崼銉ョ婵☆垰鍚嬪畷澶愭煙鐎涙鐭岀紒瀣煼瀵爼鍩￠崒姘潙濡炪們鍨洪崹璺侯焽韫囨稑鎹舵い鎾跺枑閻濐亪鎮楀▓鍨灀闁稿鎸搁埞鎴︻敊绾板崬鍓伴悷婊勬緲椤﹀崬危閹邦垼妲归梺?,
    },
}

*/
const SOLVER_STATUS_LABELS: Record<'converged' | 'max_iter' | 'error', string> = {
    converged: '收敛完成',
    max_iter: '达到迭代上限',
    error: '求解失败',
}

const FAILURE_LAYER_LABELS: Record<'frontend-consumption' | 'mapping-source-ids' | 'overlay-contract' | 'rendering-style', string> = {
    'frontend-consumption': '前端消费层',
    'mapping-source-ids': 'ID 映射层',
    'overlay-contract': '数据契约层',
    'rendering-style': '渲染样式层',
}

const MAINLINE_SCENARIO_PLAYBOOK: Record<string, {
    focus: string
    success: string
    risk: string
    talk: string
}> = {
    steady_base: {
        focus: '稳态基线工况',
        success: '主干压力连续、供需平衡',
        risk: '基线偏移会影响后续场景对比',
        talk: '先把基线站稳，再拿它做对照尺子。',
    },
    zhongwei_compressor_offline: {
        focus: '中卫压气站离线场景',
        success: '主干连续供气且关键告警可控',
        risk: '局部压降过快可能触发联动告警',
        talk: '先盯主干压差，再看下游补偿能力。',
    },
    zhongwei_trunk_break: {
        focus: '中卫主干截断场景',
        success: '快速识别受影响区和可绕行区',
        risk: '连线错误会放大影响范围',
        talk: '先圈定影响半径，再给调度动作。',
    },
    yanchi_jingbian_limited: {
        focus: '盐池至靖边限流场景',
        success: '关键用户稳定供气',
        risk: '限流过硬导致末端波动放大',
        talk: '限流要分层，先保主干后保重点。',
    },
}

const COVERAGE_RECOMMENDATION_ORDER = [
    'zhongwei_trunk_break',
    'zhongwei_compressor_offline',
    'yanchi_jingbian_limited',
    'steady_base',
]

function resolveFocusTarget(nodes: TopoNode[], focusNodeId: string): TopoNode | null {
    const directNode = nodes.find(node => node.id === focusNodeId)
    if (directNode) return directNode

    const sourceNode = nodes.find(node => node.sourceNodeIds?.includes(focusNodeId))
    if (sourceNode) return sourceNode

    if (focusNodeId.startsWith('JUNCTION-')) {
        const junctionId = Number.parseInt(focusNodeId.slice('JUNCTION-'.length), 10)
        if (Number.isFinite(junctionId)) {
            return nodes.find(node => node.junctionId === junctionId) || null
        }
    }

    return null
}

// ================== 闂備礁缍婇弨閬嶅箰缂佹ɑ娅犻柕鍫濐槸閸愨偓閻庣懓瀚竟鍡欐兜閳ь剟姊洪幐搴ｂ槈闁绘锕幃妤咁敆閸屾粈绗夐梺閫炲苯澧寸€规洜鍏樺畷鍗炩枎韫囧骸瀵?+ 濠碘槅鍋嗘晶妤冨垝韫囨梻鐝跺┑鐘叉搐缁€宀勬煕濠靛棗顏╅柣搴☆煼閺?==================
const TOPO_COLORS: Record<PointType, string> = {
    compressor: '#FF9800',
    distribution: '#2196F3',
    junction: '#00e5ff',
    station: '#F44336',
    valve: '#9E9E9E',
}

/*const TOPO_LABELS: Record<PointType, string> = {
    compressor: '闂備礁鎲￠敋妞ゆ垵妫濋幆鍐偨閻㈤潧宕?,
    distribution: '闂備礁鎲＄敮鎺懳涘鍛偨妞ゆ挾濮烽崡?,
    junction: '濠电偛鐡ㄩ崵搴ㄥ磹閺嶎厽鍎戠憸鐗堝笒閸戠娀鏌曡箛瀣伇闁?,
    station: '缂傚倷鐒﹀褰掓偡閵夈儮鏀﹂柍?,
    valve: '闂傚倸鍊搁崯鐘诲磻閹剧粯鍊?,
}

const TOPO_SIZES: Record<PointType, number> = {
    compressor: 10,
    distribution: 8,
    junction: 9,
    station: 8,
    valve: 5,
}

const MANUAL_JUNCTION_EDIT_ENABLED_BY_DEFAULT =
    String(import.meta.env.VITE_TOPOLOGY_MANUAL_JUNCTION_EDIT ?? '1').trim() !== '0'
const JUNCTION_READONLY_HINT = '闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯款嚙閸戠娀鏌曡箛瀣伇闁糕晛鎳橀弻锝夊閿濆洨缈辩紓浣筋嚙缁夊爼骞冮幍顔绘勃闁绘劦鍓﹀Σ顖炴⒒娴ｇ懓绲荤紒澶婂濡叉劙顢旈崱娆戯紲闂佽鍎抽顓熺椤栨粎纾藉ù锝呮憸閹界姴鈹戦鍝勭伈闁轰礁绉撮悾婵嬪焵椤掑倹顫曟い蹇撴噺缂嶅洭鏌熺€涙绠栭柣婵勫€曢湁闁绘ê寮堕崳娲煛娓氬洤娅嶆鐐村姈閹峰懐绮欓幐搴ㄦ暘闂佽崵濮村ú銊у垝椤栫偞鍋傞柨鐔哄У閸庢垿鎮楅敐鍛暢缂佲偓婢跺ň妲堥柟鎯х－瀛濋梺鍝ュ暱閸嬫挻绻涚€电袨闁稿骸寮堕弲璺侯煥閸愭儳鏅犻梺闈涱檧缁犳垹绮堥崒鐐寸厱婵﹩鍓涙晶鏃傜磽瀹ュ棙鈷愮紒瀣槹濞碱亪寮剁捄銊π掓繝鐢靛仧缁绘繈鎳楅崼鏇炵厺濠靛倻顭堣繚?
const JUNCTION_MODE_LABELS: Record<string, string> = {
    runtime_readonly: '闂備礁鎲￠悷顖涚閿濆鏁嬮柡澶庮嚦閻旂厧鐏崇€规洖娲ㄩ、?,
    legacy_editable: '闂備礁鎼崬鏌ュ礋椤撴粌浜扮紓鍌欑椤戝懘顢栭崨鏉戣Е閻庯綆鍏橀崑?,
}

*/
const TOPO_LABELS: Record<PointType, string> = {
    compressor: '压气站',
    distribution: '分输站',
    junction: '交汇点',
    station: '站场',
    valve: '阀室',
}

const TOPO_SIZES: Record<PointType, number> = {
    compressor: 10,
    distribution: 8,
    junction: 9,
    station: 8,
    valve: 5,
}

const MANUAL_JUNCTION_EDIT_ENABLED_BY_DEFAULT =
    String(import.meta.env.VITE_TOPOLOGY_MANUAL_JUNCTION_EDIT ?? '1').trim() !== '0'

const JUNCTION_READONLY_HINT =
    '当前为运行态交汇点，只读不可拖动；如需人工合并，请切到手工编辑模式。'

const JUNCTION_MODE_LABELS: Record<string, string> = {
    runtime_readonly: '运行态只读',
    legacy_editable: '手工编辑兼容',
}

const LINE_COLOR = '#34d399'
const LINE_WEIGHT = 2
const TOPO_RENDER_BUDGET = {
    full: { maxNodes: 520, maxEdges: 760 },
    lite: { maxNodes: 260, maxEdges: 360 },
}

/** 濠?PipelineNode.type (NodeType 闂備礁鎼鍡涙儗椤旀垝绻嗛柛銉墮绾惧湱鐥銏╂缂佲偓婢舵劖鐓曠憸宥吤洪敐鍥ㄥ闁绘棁妗ㄩ悞濠囩叓閸ャ劍灏柡? 闂備礁鎼€氼喗鎱ㄩ幘顔藉剭闁绘顕х粈鍡涙煙濞堝灝鏋ゆ俊鐐扮矙瀵爼宕奸悢椋庝淮濠?PointType */
const TYPE_MAP: Record<string, PointType> = {
    regulator: 'compressor',
    metering: 'distribution',
    valve: 'valve',
    junction: 'junction',
    // NOTE: sj4 缂傚倷鐒︾粙鎴λ囨导鏉戣摕濠电姴娲ら弸渚€鏌ｅΔ鈧悧鍡欑矈閿曞倹鐓涢柛灞剧閻绻涢崱鎰伈闁诡垰瀚埀顒佺⊕閿氬璺虹Т闇夐柨婵嗙墛绾爼鏌?compressor/distribution 缂傚倷鐒︾粙鎴λ囬鐐茬劦?    compressor: 'compressor',
    distribution: 'distribution',
}

// ================== 闂備礁鎲＄敮妤冪矙閹寸姷纾介柟鎯у濡垱銇勯弽銊р槈闁绘繃鐗犻弻鐔煎垂椤愩垻浠村┑鐐存崌缁犳牠骞冨▎鎴炲枂闁告洦鍘奸悘閬嶆煟?==================
function createTopoMarkerContent(type: PointType, name: string = '', isHighlight = false, isJunction = false): string {
    const color = TOPO_COLORS[type]
    const size = isJunction ? TOPO_SIZES.station + 4 : TOPO_SIZES[type]
    const border = isHighlight ? '2px solid #fff' : '1px solid rgba(255,255,255,0.5)'
    const shadow = isHighlight ? '0 0 8px rgba(255,255,255,0.5)' : 'none'
    const shapeStyle = isJunction
        ? `width:${size}px;height:${size}px;transform: rotate(45deg);border-radius: 3px;background:${color};border:${border};box-shadow:${shadow}; pointer-events: auto;`
        : `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border};box-shadow:${shadow}; pointer-events: auto;`
    
    return `
        <div style="position: relative; display: flex; flex-direction: column; align-items: center; pointer-events: none;">
            <div style="${shapeStyle}"></div>
            ${name ? `<div style="position: absolute; top: ${size + 4}px; white-space: nowrap; font-size: 11px; color: #fff; text-shadow: 0 0 2px #000, 0 0 2px #000, 0 0 2px #000; z-index: 10;">${name}</div>` : ''}
        </div>
    `
}

// ================== 濠电偞鍨堕幑浣哥暦閻㈤潧鍨濈€广儱妫涢々?==================
const MapTopologyView: React.FC = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const [mapInstance, setMapInstance] = useState<any>(null)
    const handleMapLoad = useCallback((map: any) => setMapInstance(map), [])
    const importedOnceRef = useRef(false)
    const appliedFocusNodeRef = useRef<string | null>(null)

    // 缂傚倷鑳舵刊瀵告閺囥垹鍚归幖娣妼閺嬩線鏌ｅΔ鈧悧鍡欑矈閿旈敮鍋撳▓鍨灈闁稿﹤缍婇、妤呮倷閸濆嫮顦梺缁橆焽閸庛倗绮?    const [pipelines, setPipelines] = useState<PipelinePackage[]>([])
    useEffect(() => {
        loadAllPipelines()
            .then(data => setPipelines(data))
            .catch(err => console.error('[MapTopologyView] 缂傚倷鑳舵刊瀵告閺囥垹鍚归幖娣妼閺嬩線鏌ｅΔ鈧悧鍡欑矈閿曞倹鐓曢柡鍐ㄥ€搁瀷濠电偞娼欏ú锕€顕ラ崟顒佺秶妞ゆ劑鍎?', err))
    }, [])

    // 缂傚倸鍊搁崐褰掓偋閻愬灚顐芥い鎰剁畱闂傤垶鏌曟繛褍鍞敃鍌涚厵?    const [baseTopoNodes, setBaseTopoNodes] = useState<BaseTopoNode[]>([])
    const [baseTopoEdges, setBaseTopoEdges] = useState<BaseTopoEdge[]>([])
    const [topoNodes, setTopoNodes] = useState<TopoNode[]>([])
    const [topoEdges, setTopoEdges] = useState<TopoEdge[]>([])
    const [junctionGroups, setJunctionGroups] = useState<JunctionGroup[]>([])
    const [manualJunctionEditingEnabled, setManualJunctionEditingEnabled] = useState(
        MANUAL_JUNCTION_EDIT_ENABLED_BY_DEFAULT
    )
    const [junctionMode, setJunctionMode] = useState<string>('runtime_readonly')
    const [editMode, setEditMode] = useState<EditMode>('view')
    const [pointType, setPointType] = useState<PointType>('station')
    const [connectFrom, setConnectFrom] = useState<string | null>(null)
    const [statusMsg, setStatusMsg] = useState('点击“导入拓扑”加载数据，或在仿真页直接运行场景。')
    const [selectedMergeNodeIds, setSelectedMergeNodeIds] = useState<string[]>([])
    const [mergeJunctionName, setMergeJunctionName] = useState('')
    const [mergeJunctionDescription, setMergeJunctionDescription] = useState('')
    const [isMerging, setIsMerging] = useState(false)
    const [deletingJunctionId, setDeletingJunctionId] = useState<number | null>(null)
    const [activeTab, setActiveTab] = useState<PanelTab>('simulation')
    const activeTabRef = useRef<PanelTab>(activeTab)

    // Tooltip 闂備浇顕栭崳顕€宕滃杈ㄥ珰闁绘劕妯婂ù鏍煕閳╁啰鎳冪粭鎴︽⒑?    const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
    const [tooltipPos, setTooltipPos] = useState<{ x: number, y: number } | null>(null)
    const hoveredRawEdge = useMemo(() => {
        if (!hoveredEdgeId) return null;
        const e = topoEdges.find(edge => edge.id === hoveredEdgeId);
        if (!e) return null;
        for (const p of pipelines) {
            const lines = Array.isArray(p?.lines) ? p.lines : [];
            const l = lines.find(x => x.startNodeId === e.startNodeId || e.sourceEdgeIds?.includes(x.id));
            if (l) {
                return {
                    name: e.name || l.name,
                    flowRate: l.flowRate,
                    currentPressure: l.currentPressure,
                    pressureLevel: l.pressureLevel,
                    startNodeId: e.startNodeId
                }
            }
        }
        return e;
    }, [hoveredEdgeId, topoEdges, pipelines])

    useEffect(() => {
        activeTabRef.current = activeTab
        if (activeTab !== 'edit') {
            setEditMode('view')
            setConnectFrom(null)
        }
    }, [activeTab])
    const [searchText, setSearchText] = useState('')
    const [report, setReport] = useState<ValidationReport | null>(null)
    const [centralityData, setCentralityData] = useState<Array<{ id: string; name: string; value: number }>>([])

    const [selectedNode, setSelectedNode] = useState<TopoNode | null>(null)
    const [historyChartTarget, setHistoryChartTarget] = useState<null | {
        stationName?: string
        junctionId?: string
        displayName?: string
    }>(null)

    // 闂備線鈧稑瀚庨柛濠冪箞瀵劑濮€閵堝懎鍞?    type UndoAction =
    type UndoAction =
        | { type: 'add-node'; nodeId: string }
        | { type: 'add-edge'; edgeId: string }
        | { type: 'create-junction'; junctionId: number; name: string }
        | { type: 'delete-junction'; group: JunctionGroup }
    const [undoStack, setUndoStack] = useState<UndoAction[]>([])

    // 闂備浇顫夐幆灞剧濠靛钃熼柛銉ｅ妿椤╃兘鎮归幁鎺戝闁糕晛鍊块弻锝呂熼崹顔惧帿闂?    const [cutoffNodeId, setCutoffNodeId] = useState<string | null>(null)
    const [cutoffResult, setCutoffResult] = useState<CutoffResult | null>(null)
    const [cutoffSearch, setCutoffSearch] = useState('')

    // 濠电儑绲藉ú锔炬崲閸岀偞鍋ら柕濞炬櫅鐎氬鏌涘┑鍡楊仼闁绘挻鍨块弻銊モ槈濞嗗簼瀛╃紓浣瑰姧缁绘繈鎮￠鍫晜闁告侗鍘捐ぐ宀勬⒑瑜版帗鏁遍柛銊︾箞楠炲牓濡搁埡浣哄摋闂侀潻瀵岄崢浠嬫偩闁秵鐓曠憸搴ㄥ礉閺嶎厽鍋?    const [dirtyPositions, setDirtyPositions] = useState<Map<string, [number, number]>>(new Map())
    const [unsavedEdgeIds, setUnsavedEdgeIds] = useState<Set<string>>(new Set())
    const [hasSavedDraft, setHasSavedDraft] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const {
        overlay: steadyOverlay,
        baselineOverlay: steadyBaselineOverlay,
        isLoading: steadySimLoading,
        error: steadySimError,
        currentScenario: steadyScenarioId,
        snapshots: steadySnapshots,
        snapshotLoading: steadySnapshotLoading,
        baselineSnapshotLoading: steadyBaselineSnapshotLoading,
        snapshotError: steadySnapshotError,
        selectedSnapshotRunId: steadySelectedSnapshotRunId,
        baselineSnapshotRunId: steadyBaselineSnapshotRunId,
        trialRunScenarioId: steadyTrialRunScenarioId,
        bulkTrialRunActive: steadyBulkTrialRunActive,
        comparison: steadyComparison,
        trialRunItems: steadyTrialRunItems,
        setScenario: setSteadyScenario,
        setSelectedSnapshotRunId: setSteadySelectedSnapshotRunId,
        setBaselineSnapshotRunId: setSteadyBaselineSnapshotRunId,
        runSimulation: runSteadySimulation,
        saveSnapshot: saveSteadySnapshot,
        refreshSnapshots: refreshSteadySnapshots,
        loadSelectedSnapshot: loadSteadySelectedSnapshot,
        runTrialScenario: runSteadyTrialScenario,
        runMissingTrialScenarios: runSteadyMissingTrialScenarios,
        clearOverlay: clearSteadyOverlay,
    } = useSimulation({
        pilotId: WE1_PRIMARY_PILOT_ID,
        scenarios: MAINLINE_SCENARIOS,
    })
    const [cascadeValves, setCascadeValves] = useState(true)
    const [positionPreview, setPositionPreview] = useState<PositionPreviewResult | null>(null)
    const [isPreviewing, setIsPreviewing] = useState(false)
    const [lineFlowPhase, setLineFlowPhase] = useState(0)
    const [damageFlashVisible, setDamageFlashVisible] = useState(false)
    const [isMapInteracting, setIsMapInteracting] = useState(false)
    const [renderSafetyMode, setRenderSafetyMode] = useState<'full' | 'lite'>('full')
    const [preSimInputEnabled, setPreSimInputEnabled] = useState(true)
    const [preSimDefaultPressureMpa, setPreSimDefaultPressureMpa] = useState(8.8)
    const [preSimDefaultTemperatureC, setPreSimDefaultTemperatureC] = useState(28)
    const [preSimDefaultFlowRate, setPreSimDefaultFlowRate] = useState(120)
    const [preSimApplyToSources, setPreSimApplyToSources] = useState(false)
    const [preSimNodePressureOverrides, setPreSimNodePressureOverrides] = useState<Record<string, number>>({})
    const [preSimNodeTemperatureOverrides, setPreSimNodeTemperatureOverrides] = useState<Record<string, number>>({})
    const [preSimEdgeFlowOverrides, setPreSimEdgeFlowOverrides] = useState<Record<string, number>>({})
    const isLargeGraphMode = renderSafetyMode === 'lite' || topoNodes.length > 320 || topoEdges.length > 480

    const upsertOverrideNumber = useCallback(
        (
            setter: React.Dispatch<React.SetStateAction<Record<string, number>>>,
            id: string,
            rawValue: string,
        ) => {
            const next = rawValue.trim()
            setter(prev => {
                const draft = { ...prev }
                if (!next) {
                    delete draft[id]
                    return draft
                }
                const parsed = Number(next)
                if (!Number.isFinite(parsed)) {
                    return draft
                }
                draft[id] = parsed
                return draft
            })
        },
        [],
    )

    const clearPreSimulationCustomOverrides = useCallback(() => {
        setPreSimNodePressureOverrides({})
        setPreSimNodeTemperatureOverrides({})
        setPreSimEdgeFlowOverrides({})
    }, [])

    const buildPreSimulationInput = useCallback((): SimulationInitialInput | undefined => {
        if (!preSimInputEnabled) return undefined

        const pressure = Number.isFinite(preSimDefaultPressureMpa) ? preSimDefaultPressureMpa : 8.8
        const temperature = Number.isFinite(preSimDefaultTemperatureC) ? preSimDefaultTemperatureC : estimateTemperatureByPressure(pressure)
        const flowRate = Number.isFinite(preSimDefaultFlowRate) ? preSimDefaultFlowRate : 120
        const nodeIds = new Set([
            ...Object.keys(preSimNodePressureOverrides),
            ...Object.keys(preSimNodeTemperatureOverrides),
        ])
        const nodeOverrides = [...nodeIds]
            .map(nodeId => {
                const override: {
                    node_id: string
                    target_pressure_mpa?: number
                    temperature_c?: number
                } = { node_id: nodeId }
                if (Number.isFinite(preSimNodePressureOverrides[nodeId])) {
                    override.target_pressure_mpa = preSimNodePressureOverrides[nodeId]
                }
                if (Number.isFinite(preSimNodeTemperatureOverrides[nodeId])) {
                    override.temperature_c = preSimNodeTemperatureOverrides[nodeId]
                }
                return override
            })
            .filter(item => item.target_pressure_mpa != null || item.temperature_c != null)
        const edgeOverrides = Object.entries(preSimEdgeFlowOverrides)
            .filter(([, value]) => Number.isFinite(value))
            .map(([edgeId, value]) => ({
                edge_id: edgeId,
                flow_rate: value,
            }))

        return {
            node_overrides: nodeOverrides,
            edge_overrides: edgeOverrides,
            default_pressure_mpa: pressure,
            default_temperature_c: temperature,
            default_flow_rate: flowRate,
            apply_to_sources: preSimApplyToSources,
        }
    }, [
        preSimApplyToSources,
        preSimDefaultFlowRate,
        preSimDefaultPressureMpa,
        preSimDefaultTemperatureC,
        preSimInputEnabled,
        preSimEdgeFlowOverrides,
        preSimNodePressureOverrides,
        preSimNodeTemperatureOverrides,
    ])

    const runSteadySimulationWithPreset = useCallback(async () => {
        await runSteadySimulation({
            initialInput: buildPreSimulationInput(),
        })
    }, [buildPreSimulationInput, runSteadySimulation])

    // 闁诲海鎳撻幉锟犳偂閿熺姵鍋熸い鏃傛櫕椤╁弶銇勯弮鍌氫壕闁?marker 闂備礁鎲￠…鍥窗鎼搭煉缍?content闂備焦瀵х粙鎴︽儔婵傜鏋侀柕鍫濇椤╂煡骞栭幖顓熺窔闁告帗甯掗…?    const highlightedMarkersRef = useRef<Map<string, string>>(new Map())
    const lastNodeContentRef = useRef<Map<string, string>>(new Map())
    const lastEdgeOptionsRef = useRef<Map<string, string>>(new Map())

    // Refs 闂?闂佽崵鍠愰悷杈╁緤娴犲绐楅柛娑樼摠閳锋帗銇勯幘璺轰粶闁伙箑鐖煎濠氬礋椤愩倕顤€濠碘槅鍋掗崑鍕敋閿濆鍗抽柣妯挎珪濞?    const nodesRef = useRef<TopoNode[]>([])
    const edgesRef = useRef<TopoEdge[]>([])
    const modeRef = useRef<EditMode>('view')
    const ptRef = useRef<PointType>('station')
    const cfRef = useRef<string | null>(null)

    useEffect(() => { nodesRef.current = topoNodes; edgesRef.current = topoEdges }, [topoNodes, topoEdges])
    useEffect(() => { modeRef.current = editMode; ptRef.current = pointType }, [editMode, pointType])
    useEffect(() => { cfRef.current = connectFrom }, [connectFrom])
    useEffect(() => {
        if (steadyOverlay) {
            setStatusMsg(`婵犳鍠楃换鎰緤閻ｅ本顫曢柍鈺佸暟椤╃兘鎮归幁鎺戝闁糕晛鍊婚埀顒傛嚀閹猜ゃ亹閸愵喖鍨傞煫鍥ㄧ☉缁€?${steadyOverlay.scenario_id}闂備焦瀵х粙鎴︻敊閹插《_id=${steadyOverlay.run_id.slice(0, 12)}`)
        }
    }, [steadyOverlay])
    useEffect(() => {
        if (steadySimError) {
            setStatusMsg(`婵犳鍠楃换鎰緤閻ｅ本顫曢柍鈺佸暟椤╃兘鎮归幁鎺戝闁糕晛鍊搁…鍧楀箚閹殿喚缈遍柣鐔哥懕缁犳捇寮?{steadySimError}`)
        }
    }, [steadySimError])

    // ================== 闂備浇銆€閸嬫捇鏌涢锝嗙闁艰尙濞€閺屾稖绠涚€ｎ亜顫囬梺绋块椤曨厾鍒掓繝姘櫖闁告洦鍋呴悿鍥⒑閸涘鐒介柛鐘查叄閿濈偤骞囬弶鎸庣€梺缁橆殔閻楀棛绮婇敃鍌涚叆婵炴垶顭囨晶鏃傜磼濡も偓椤︽壆鈧潧銈搁幃鈺呮偨娴ｅ啫鐓?MapView闂備焦瀵х粙鎴炵附閺冨倸鍨濋幖娣灮閻熻绻涢幋鐑囦緵闁搞們鍊濋弻娑滅疀鐎ｎ亜濮㈤梺杞伴檷閸婃繈寮?==================
    useEffect(() => {
        if (!steadyOverlay && !steadySelectedSnapshotRunId) {
            clearSimulationShowcaseSyncContext()
            return
        }

        writeSimulationShowcaseSyncContext({
            source: 'map-topology',
            pilotId: WE1_PRIMARY_PILOT_ID,
            scenarioId: steadyOverlay?.scenario_id ?? steadyScenarioId,
            selectedSnapshotRunId: steadySelectedSnapshotRunId,
            baselineSnapshotRunId: steadyBaselineSnapshotRunId,
            overlay: steadyOverlay,
            updatedAt: new Date().toISOString(),
        })
    }, [steadyBaselineSnapshotRunId, steadyOverlay, steadyScenarioId, steadySelectedSnapshotRunId])

    useEffect(() => {
        if (!steadyOverlay?.run_id) return
        setDamageFlashVisible(true)
        const timer = window.setTimeout(() => setDamageFlashVisible(false), 4500)
        return () => window.clearTimeout(timer)
    }, [steadyOverlay?.run_id])
    useEffect(() => {
        const tooManyOverlays = topoNodes.length > TOPO_RENDER_BUDGET.full.maxNodes || topoEdges.length > TOPO_RENDER_BUDGET.full.maxEdges
        if (!steadyOverlay || isMapInteracting || tooManyOverlays || renderSafetyMode === 'lite') return
        const timer = window.setInterval(() => {
            setLineFlowPhase(prev => (prev + 2) % 1000)
        }, 180)
        return () => window.clearInterval(timer)
    }, [steadyOverlay?.run_id, isMapInteracting, topoEdges.length, topoNodes.length, renderSafetyMode])
    useEffect(() => {
        const tooManyOverlays = topoNodes.length > TOPO_RENDER_BUDGET.full.maxNodes || topoEdges.length > TOPO_RENDER_BUDGET.full.maxEdges
        if (tooManyOverlays || isMapInteracting) {
            if (renderSafetyMode !== 'lite') {
                setRenderSafetyMode('lite')
            }
            return
        }
        if (renderSafetyMode !== 'full') {
            setRenderSafetyMode('full')
        }
    }, [topoNodes.length, topoEdges.length, isMapInteracting, renderSafetyMode])

    const rawPipelineData = useMemo(() => {
        const { nodes, lines } = buildPipelineDataFromPackages(pipelines)
        return { nodes, lines }
    }, [pipelines])

    const clearRenderedTopology = useCallback(() => {
        nodesRef.current.forEach(node => node.marker?.setMap(null))
        edgesRef.current.forEach(edge => edge.poly?.setMap(null))
        highlightedMarkersRef.current.clear()
        lastNodeContentRef.current.clear()
        lastEdgeOptionsRef.current.clear()
    }, [])

    useEffect(() => {
        setPositionPreview(null)
    }, [cascadeValves, dirtyPositions])
    useEffect(() => {
        setHasSavedDraft(Boolean(localStorage.getItem(TOPOLOGY_DRAFT_STORAGE_KEY)))
    }, [])

    const resetUnsavedPositions = useCallback(() => {
        if (dirtyPositions.size === 0) return
        void loadAllPipelines()
            .then(data => {
                setPipelines(data)
                const coordMap = new Map<string, [number, number]>()
                for (const pkg of data) {
                    for (const layer of pkg.layers) {
                        for (const node of layer.nodes) {
                            coordMap.set(node.id, [node.coordinate.longitude, node.coordinate.latitude])
                        }
                    }
                }
                setBaseTopoNodes(prev => prev.map(node => {
                    const next = coordMap.get(node.id)
                    return next ? { ...node, position: next } : node
                }))
                setDirtyPositions(new Map())
                setPositionPreview(null)
                setStatusMsg('闁诲骸婀遍…鍫濐嚕閸洖绠版繛鍡樻尰閻撱儵鏌嶈閸撶喎顕ｉ悽鍓叉晜闁告劦浜為鏃堟煟鎼淬垻鈯曟い顓炴搐閳绘捇骞嬮敂钘夆偓鐑芥⒑椤愶絿銆掔紒澶嬫綑鑿愰柛銉ㄦ硾閺嬬喖鏌?)
            })
            .catch(error => {
                console.error(error)
                setStatusMsg('闂備線鈧稑瀚庨柛濠冪箞瀵劑濮€閵堝懎鐝樺銈呯箰閸熸壆绮绘禒瀣€垫繛鎴烆仾婵傜绠為柕濞炬櫅缂佲晠鏌ｉ悢璇茬劷濞存粌銈搁幃?)
            })
    }, [dirtyPositions.size])

    const loadJunctionGroups = useCallback(async () => {
        try {
            const result = await topologyEditorApi.getJunctionGroups()
            setJunctionGroups(result.junctions)
            setManualJunctionEditingEnabled(result.manual_editing_enabled)
            setJunctionMode(result.mode)
            return result.junctions
        } catch (error) {
            console.error('[MapTopologyView] 闂備礁鎼鍐垂婵犳碍鍤嬫い蹇撴绾惧ジ鏌涢弴銊ヤ簻妞ゎ偓缍佸鍫曟倷閼告妫勯梺闈涙处閸ㄥ綊骞?', error)
            setStatusMsg(error instanceof Error ? `闂備礁鎲″缁樻叏閹灐褰掑炊椤掆偓閸戠娀鏌曡箛瀣伇闁糕晛鎳愮槐鎾存媴缁嬫浠奸梺闈涙处閸ㄥ綊骞忚ぐ鎺懳ㄦい鏍ㄧ矌閻?{error.message}` : '闂備礁鎲″缁樻叏閹灐褰掑炊椤掆偓閸戠娀鏌曡箛瀣伇闁糕晛鎳愮槐鎾存媴缁嬫浠奸梺闈涙处閸ㄥ綊骞?)
            return []
        }
    }, [])

    const isRuntimeReadonlyGroup = useCallback((group: JunctionGroup) => {
        return group.source_table === 'junction_groups_rebuilt'
    }, [])

    const manualEditableJunctionGroups = useMemo(() => {
        return junctionGroups.filter(group => !isRuntimeReadonlyGroup(group))
    }, [junctionGroups, isRuntimeReadonlyGroup])

    const selectedMergeNodeSet = useMemo(() => new Set(selectedMergeNodeIds), [selectedMergeNodeIds])
    const selectedMergeNodes = useMemo(() => {
        return topoNodes.filter(node => !node.isJunction && selectedMergeNodeSet.has(node.id))
    }, [selectedMergeNodeSet, topoNodes])
    const selectedMergeAutoName = useMemo(() => {
        const names = selectedMergeNodes.map(node => node.name).filter(Boolean)
        if (names.length === 0) return ''
        if (names.length === 1) return `${names[0]}闂備礁鎼鍐垂婵犳碍鍤嬮柣?        const preview = names.slice(0, 2).join(' / ')
        return `${preview}${names.length > 2 ? ` 缂?${names.length} 缂傚倷鐒﹀褰掓偘?: ''}闂備礁鎼鍐垂婵犳碍鍤嬮柣?    }, [selectedMergeNodes])
    const selectedJunctionGroup = useMemo(() => {
        if (!selectedNode?.isJunction || !selectedNode.junctionId) return null
        return junctionGroups.find(group => group.id === selectedNode.junctionId) ?? null
    }, [junctionGroups, selectedNode])
    const canDeleteSelectedJunction = !!(
        selectedJunctionGroup && !isRuntimeReadonlyGroup(selectedJunctionGroup)
    )

    const buildCollapsedGraph = useCallback((
        nodes: BaseTopoNode[],
        edges: BaseTopoEdge[],
        groups: JunctionGroup[]
    ) => {
        const stationToDisplayId = new Map<string, string>()
        const displayNodes: TopoNode[] = []

        groups.forEach(group => {
            const memberNodes = nodes.filter(node => group.station_ids.includes(node.id))
            if (memberNodes.length === 0) return

            const centerLng = memberNodes.reduce((sum, node) => sum + node.position[0], 0) / memberNodes.length
            const centerLat = memberNodes.reduce((sum, node) => sum + node.position[1], 0) / memberNodes.length
            const junctionNodeId = `junction-${group.id}`

            group.station_ids.forEach(stationId => stationToDisplayId.set(stationId, junctionNodeId))
            displayNodes.push({
                id: junctionNodeId,
                name: group.name,
                type: 'junction',
                position: [centerLng, centerLat],
                sourceNodeIds: [...group.station_ids],
                junctionId: group.id,
                isJunction: true,
                junctionKind: group.junction_kind,
                sourceTable: group.source_table,
            })
        })

        nodes.forEach(node => {
            if (stationToDisplayId.has(node.id)) return
            displayNodes.push({
                ...node,
                sourceNodeIds: [node.id],
                isJunction: false,
            })
        })

        const collapsedEdgeMap = new Map<string, TopoEdge>()
        edges.forEach(edge => {
            const startNodeId = stationToDisplayId.get(edge.startNodeId) ?? edge.startNodeId
            const endNodeId = stationToDisplayId.get(edge.endNodeId) ?? edge.endNodeId
            if (startNodeId === endNodeId) return

            const sorted = [startNodeId, endNodeId].sort()
            const key = `${sorted[0]}__${sorted[1]}`
            const existing = collapsedEdgeMap.get(key)
            if (existing) {
                existing.sourceEdgeIds = [...(existing.sourceEdgeIds ?? []), edge.id]
                return
            }

            collapsedEdgeMap.set(key, {
                id: `merged-${key}`,
                startNodeId,
                endNodeId,
                name: edge.name,
                sourceEdgeIds: [edge.id],
            })
        })

        return {
            nodes: displayNodes,
            edges: [...collapsedEdgeMap.values()],
        }
    }, [])

    const renderCollapsedGraph = useCallback((graphNodes: TopoNode[], graphEdges: TopoEdge[]) => {
        if (!mapInstance) return
        const AMap = (window as any).AMap
        if (!AMap) return

        clearRenderedTopology()

        const budget = renderSafetyMode === 'lite'
            ? TOPO_RENDER_BUDGET.lite
            : TOPO_RENDER_BUDGET.full
        const cappedNodes = graphNodes.slice(0, budget.maxNodes)
        const allowedNodeIds = new Set(cappedNodes.map(node => node.id))
        const cappedEdges = graphEdges
            .filter(edge => allowedNodeIds.has(edge.startNodeId) && allowedNodeIds.has(edge.endNodeId))
            .slice(0, budget.maxEdges)
        const isLargeGraph = renderSafetyMode === 'lite' || cappedNodes.length > 320 || cappedEdges.length > 480

        if (cappedNodes.length < graphNodes.length || cappedEdges.length < graphEdges.length) {
            setStatusMsg(
                `闂備礁缍婇弨閬嶅箰缂佹ɑ娅犻柕鍫濇娴溿倝鏌涢妷鎴滄濞寸兘姊洪幐搴ｂ槈闁兼椿鍨跺畷娆撴晸閻樿尪袝濡炪倖鐗楃划宥夊汲?{renderSafetyMode === 'lite' ? '闂佸搫顦遍崑娑⑩€﹂悜钘夐棷? : '闂備礁鎼粔鏉懨洪妶澶婇棷?}濠碘槅鍋呭妯尖偓姘煎櫍閹偓绻濆顓熸珫濠殿喗锚閸熻儻鐏愰梻?${cappedNodes.length}/${graphNodes.length}闂備焦瀵х粙鎴︽儗娴ｇ儤宕叉繛鎴炴皑濡?${cappedEdges.length}/${graphEdges.length}`,
            )
        }

        const renderedNodes: TopoNode[] = cappedNodes.map(node => {
            const size = node.isJunction ? TOPO_SIZES.station + 4 : TOPO_SIZES[node.type]
            const marker = new AMap.Marker({
                position: new AMap.LngLat(node.position[0], node.position[1]),
                content: createTopoMarkerContent(node.type, isLargeGraph ? '' : node.name, false, !!node.isJunction),
                offset: new AMap.Pixel(-size / 2, -size / 2),
                draggable: !node.isJunction && !isLargeGraph,
                cursor: node.isJunction ? 'pointer' : (!isLargeGraph ? 'move' : 'pointer'),
                zIndex: node.isJunction ? 260 : 200,
                zooms: [2, 18],
            })
            marker.setMap(mapInstance)

            const nodeId = node.id
            if (!node.isJunction && !isLargeGraph) {
                marker.on('dragend', (event: any) => {
                    const nextPosition: [number, number] = [event.lnglat.getLng(), event.lnglat.getLat()]
                    setBaseTopoNodes(prev => prev.map(item => item.id === nodeId ? { ...item, position: nextPosition } : item))
                    setDirtyPositions(prev => new Map(prev).set(nodeId, nextPosition))
                })
            }
            marker.on('click', (event: any) => doNodeClick(nodeId, event))

            return { ...node, marker }
        })

        const renderedNodeMap = new Map(renderedNodes.map(node => [node.id, node]))
        const renderedEdges: TopoEdge[] = cappedEdges.map(edge => {
            const startNode = renderedNodeMap.get(edge.startNodeId)
            const endNode = renderedNodeMap.get(edge.endNodeId)
            if (!startNode || !endNode) return edge

            const poly = new AMap.Polyline({
                path: [startNode.position, endNode.position],
                strokeColor: LINE_COLOR,
                strokeWeight: LINE_WEIGHT,
                strokeStyle: 'solid',
                zIndex: 100,
                zooms: [2, 18],
            })
            poly.setMap(mapInstance)
            
            // 缂傚倸鍊烽悞锕傚垂閻㈠憡鍋╁Δ锝呭暙缁犳牗銇勯幒宥嗙グ闁谎傜劍娣囧﹤螖閳ь剙螞閺冨倽濮抽柕濠忓椤?            if (!isLargeGraph) {
                poly.on('mouseover', (e: any) => {
                    setHoveredEdgeId(edge.id)
                    const clientX = e?.originEvent?.clientX
                    const clientY = e?.originEvent?.clientY
                    if (typeof clientX === 'number' && typeof clientY === 'number') {
                        setTooltipPos({ x: clientX, y: clientY })
                    }
                })
                poly.on('mousemove', (e: any) => {
                    const clientX = e?.originEvent?.clientX
                    const clientY = e?.originEvent?.clientY
                    if (typeof clientX === 'number' && typeof clientY === 'number') {
                        setTooltipPos({ x: clientX, y: clientY })
                    }
                })
                poly.on('mouseout', () => {
                    setHoveredEdgeId(null)
                    setTooltipPos(null)
                })
            }

            return { ...edge, poly }
        })

        setTopoNodes(renderedNodes)
        setTopoEdges(renderedEdges)
    }, [clearRenderedTopology, mapInstance, renderSafetyMode])

    useEffect(() => {
        void loadJunctionGroups()
    }, [loadJunctionGroups])

    useEffect(() => {
        if (!mapInstance || baseTopoNodes.length === 0) return
        const collapsed = buildCollapsedGraph(baseTopoNodes, baseTopoEdges, junctionGroups)
        renderCollapsedGraph(collapsed.nodes, collapsed.edges)
    }, [baseTopoNodes, baseTopoEdges, buildCollapsedGraph, junctionGroups, mapInstance, renderCollapsedGraph])

    // ================== 闂備線娼婚梽鍕熆濡ソ鐟邦潨閳ь剟骞冨▎鎾村仭闁哄瀵ч惁?==================
    useEffect(() => {
        if (!mapInstance) return
        const onClick = (e: any) => {
            if (modeRef.current === 'draw-point') doAddNode(e.lnglat, ptRef.current)
        }
        mapInstance.on('click', onClick)
        return () => {
            mapInstance.off('click', onClick)
            nodesRef.current.forEach(n => n.marker?.setMap(null))
            edgesRef.current.forEach(e => e.poly?.setMap(null))
        }
    }, [mapInstance])
    useEffect(() => {
        if (!mapInstance) return
        const startInteraction = () => setIsMapInteracting(true)
        const endInteraction = () => setIsMapInteracting(false)
        mapInstance.on('zoomstart', startInteraction)
        mapInstance.on('movestart', startInteraction)
        mapInstance.on('dragstart', startInteraction)
        mapInstance.on('zoomend', endInteraction)
        mapInstance.on('moveend', endInteraction)
        mapInstance.on('dragend', endInteraction)
        return () => {
            mapInstance.off('zoomstart', startInteraction)
            mapInstance.off('movestart', startInteraction)
            mapInstance.off('dragstart', startInteraction)
            mapInstance.off('zoomend', endInteraction)
            mapInstance.off('moveend', endInteraction)
            mapInstance.off('dragend', endInteraction)
        }
    }, [mapInstance])

    useEffect(() => {
        if (!mapInstance) return
        mapInstance.setDefaultCursor(editMode === 'view' ? 'grab' : 'crosshair')
        if (editMode === 'draw-point') setStatusMsg(`缂傚倸鍊烽悞锕傛晪闂佺硶鏅滈〃濠囧极瀹ュ拋娼╅柛妤冨仒閸栨牠姊洪崨濠傜伇妞ゆ泦鍐胯€块柟缁㈠枛閻愬﹪鏌ｉ幇闈涘婵炲吋鍨块弻娑㈠籍閸屾鐐烘煃?{TOPO_LABELS[pointType]}闂備線娼уΛ妤冩兜?
        else if (editMode === 'connect') { setStatusMsg('闂佸搫顦弲婵嬪磻閻旂厧鍚归幖娣妽閺咁剚鎱ㄥΟ鍝勮埞濞寸媭鍨堕弻娑㈠箣閻愭惌娼￠梺鍦缂嶄線骞冨▎鎴炲厹闁告侗鍘欏┑瀣厽?); setConnectFrom(null) }
        else setStatusMsg('婵犵數鍋炲娆戞崲濡ゅ拑缍栫€广儱鎲橀悢鐓庣伋鐎规洖娲ㄩ、?)
    }, [editMode, pointType, mapInstance])

    useEffect(() => {
        if (editMode !== 'merge') return
        setConnectFrom(null)
        setStatusMsg('闂備礁缍婂褔顢栭崨顔碱嚤闁圭増婢樼粻鏌ョ叓閸ャ劍灏伴柛濞垮€濋弻銊モ槈濞嗘劗娈ら梺绋款儜缂嶄礁鐣峰▎鎴炲珰闁肩⒈鍏涙禍銏ゆ煟韫囨洖浠滈柛濠傤煼閹敻顢涢悙鏉戔偓鐑芥煟閻斿憡绶叉い顐秮閺?缂傚倷绀侀ˇ顖炩€﹀畡鎵虫瀺閹兼番鍔嶉弲顒勬倶閻愯埖顥夐柡鍛懇閺屾盯鏁傞崫鍕瀳婵炴垶鏌ㄧ换鎴犵箔閻旀椿妲婚梺鎼炲妼瀹曨剟顢氬▎鎾村€绘俊顖炴？閺夘厾绱?)
    }, [editMode])

    const paintMergeSelection = useCallback((selectedIds: Set<string>) => {
        for (const node of nodesRef.current) {
            if (!node.marker) continue
            const isSelected = !node.isJunction && selectedIds.has(node.id)
            safeSetMarkerContent(node.marker, createTopoMarkerContent(node.type, isLargeGraphMode ? '' : node.name, isSelected, !!node.isJunction))
        }
    }, [isLargeGraphMode])

    useEffect(() => {
        if (editMode !== 'merge') {
            if (selectedMergeNodeIds.length > 0) {
                setSelectedMergeNodeIds([])
            }
            if (mergeJunctionName) {
                setMergeJunctionName('')
            }
            if (mergeJunctionDescription) {
                setMergeJunctionDescription('')
            }
            paintMergeSelection(new Set())
            return
        }
        paintMergeSelection(selectedMergeNodeSet)
    }, [
        editMode,
        mergeJunctionDescription,
        mergeJunctionName,
        paintMergeSelection,
        selectedMergeNodeIds.length,
        selectedMergeNodeSet,
        topoNodes,
    ])

    // ================== 闂備胶鍘ч幖顐﹀磹婵犳艾纾婚柨婵嗩槸缁犺偐鈧箍鍎辩€氼喚绮?==================
    const doAddNode = (lnglat: any, type: PointType) => {
        const id = `tn-${Date.now()}`
        const nodeName = `${TOPO_LABELS[type]}-${baseTopoNodes.length + 1}`
        const pos: [number, number] = [lnglat.getLng(), lnglat.getLat()]
        const node: BaseTopoNode = { id, type, name: nodeName, position: pos }
        setBaseTopoNodes(prev => [...prev, node])
        setUndoStack(prev => [...prev, { type: 'add-node', nodeId: id }])
        setStatusMsg(`闁诲骸婀遍…鍫濐嚕閸洖閿ゅ┑鐘叉搐缁€? ${node.name}`)
    }

    /** 闂備礁缍婇弨閬嶆偋濡ゅ啠鍋撳顒佸仴鐎规洏鍎查幆鏃堝焺閸愩劉鍋撴潏銊﹀弿婵犻潧瀚崝姘舵煕濞呰娲﹂崵鍌炴煛閸愩劌浜為柛姘ｅ亾缂?*/
    const syncEdges = (_nodeId: string, _newPos: [number, number]) => {}

    const doNodeClick = (nodeId: string, _event?: any) => {
        if (modeRef.current === 'connect') {
            const from = cfRef.current
            if (!from) {
                setConnectFrom(nodeId)
                const nd = nodesRef.current.find(n => n.id === nodeId)
                setStatusMsg(`闂佽崵濮嶉崶鑸殿棖闂佺顑戠紞浣逛繆?{nd?.name}闂備線娼уΛ妤冪矓椤曗偓瀹?闂備胶绮崝妤呭箠閹捐鍚规い鏂垮⒔绾惧ジ鏌涢鐘茬仼濞寸姷妫?
            } else {
                if (nodeId === from) { setStatusMsg('濠电偞鍨堕幐鍝ョ矓閻戣棄绀傛俊顖滅帛娴溿倝鏌ｉ幇顓熺稇濠㈣泛绉归弻銈嗙附婢跺鎹ｉ梻?); return }
                doAddEdge(from, nodeId)
                setConnectFrom(null)
                setStatusMsg('闂佸搫顦弲婵嬪磻閻旂厧鍚归幖娣妼缁狅綁鏌熼柇锕€澧い顐ゅ█閺屻劌鈽夊Ο鍨伃閻熸粎澧楅悡锟犲箖濞嗘挾宓侀幖瀛樻尭娴滈箖鎮橀悙璺轰汗缂佺姳绮欓幃妤€鈽夊▎妯煎姼缂備胶绮粙鎾绘儉椤忓棙鍟戦柕鍫濆€告禍鍓р偓骞垮劚閻楀﹪宕曟导瀛樼厽闁冲搫鍋婇崗顒傜磼鏉堛劎绠炴鐐差儔瀵粙顢曢敐鍛幈缂傚倸鍊风欢锟犲储妤ｅ啫纾婚柨婵嗩槸缁€鍕煛閸曨偆绠茬€规洘濞婇弻?)
            }
            return
        }

        const clickedNode = nodesRef.current.find(n => n.id === nodeId) || null

        if (modeRef.current === 'merge') {
            if (!clickedNode) return
            if (clickedNode.isJunction) {
                setStatusMsg('闂備礁缍婂褔顢栭崨顔碱嚤闁圭増婢樼粻鏌ョ叓閸ャ劍灏伴柛濞垮€濋幃褰掑炊閳轰礁骞嬮梺閫炲苯澧い锔诲灣閼哄崬鐣烽崶锔藉媰闂佺鏈划搴ゃ亹閺屻儲鐓熼柟閭﹀枟椤忕喓绱掓潏銊х疄鐎殿喗鎮傛慨鈧柕蹇ョ到閻掑姊洪悡搴㈡儓闁稿﹤顭峰畷鎴︽晲閸℃瑢鏋栭悗骞垮劚閻楀棝宕㈤幘顔界厽闁宠桨鑳堕幗鐘绘偨椤栨稒灏︽鐐村灱缁犳盯骞橀弶鎴斿亾?)
                setSelectedNode(clickedNode)
                return
            }

            setSelectedNode(clickedNode)
            setSelectedMergeNodeIds(prev => {
                const next = prev.includes(nodeId)
                    ? prev.filter(id => id !== nodeId)
                    : [...prev, nodeId]
                setStatusMsg(`闁诲海鎳撻幉锟犳偂閿熺姴鐒垫い鎺嗗亾妞わ附澹嗛埀?${next.length} 濠电偞鍨堕幖鈺傜閻愮儤鍋熸い鏍仦閸婄兘鏌涢敂璇插箺闁哄棗绻愰湁婵犲﹤鍟銏狀熆瑜庣划宀勵敊韫囨稑唯闁挎洍鍋撶紒鈧崒鐐寸厱婵﹩鍓氱紞?
                return next
            })
            return
        }

        setSelectedNode(clickedNode)

        // 闂備浇顫夐幆灞剧濠靛钃熼柛銉仜閻旂厧鐏崇€规洖娲ㄩ、鍛存⒑閹稿海鈯曟慨妯稿姂瀹曟垿鏁愭径濠勵槱闂佸搫瀚换鎰亹闂備胶绮崝妤呫€佹繝鍥舵晩闁哄洨鍠撻埢鏃堟煟閹寸伝顏堟倿婵犳碍鐓涢柛灞诲€曢獮姗€鏌?        if (modeRef.current === 'view' && activeTabRef.current === 'cutoff') {
            const nd = clickedNode
            if (!nd) return
            setCutoffNodeId(nodeId)
            setCutoffResult(null)
            setStatusMsg(`闂備浇顫夐幆灞剧濠靛钃熼柛銉墯閸婄兘鏌ｉ悢鍛婄凡闁搞倖甯″娲敃閵忊晜顎嗙紓?{nd.name}`)
            return
        }

        if (clickedNode?.isJunction) {
            setStatusMsg(`闁诲海鎳撻幉锟犳偂閿熺姴鐒垫い鎺嗗亾妞わ富鍣ｉ幊娆撳箣閿曗偓閸戠娀鏌曡箛瀣伇闁糕晛鎳橀弻?{clickedNode.name}`)
        } else if (clickedNode) {
            setStatusMsg(`闁诲海鎳撻幉锟犳偂閿熺姴鐒垫い鎺嗗亾妞わ富鍣ｉ幊娆撳箣閿旇棄娈熼梺绋挎湰缁本绂掗鐐寸叆?{clickedNode.name}`)
        }
    }

    const doAddEdge = (startId: string, endId: string) => {
        const s = baseTopoNodes.find(n => n.id === startId)
        const e = baseTopoNodes.find(n => n.id === endId)
        if (!s || !e) return
        const id = `te-${Date.now()}`
        setBaseTopoEdges(prev => [...prev, { id, startNodeId: startId, endNodeId: endId, name: '闂備礁鎼崐鐟邦熆濡偐纾介柟鎯у娑撳秹鏌ㄥ☉妯侯仼婵? }])
        setUnsavedEdgeIds(prev => {
            const next = new Set(prev)
            next.add(id)
            return next
        })
        setUndoStack(prev => [...prev, { type: 'add-edge', edgeId: id }])
    }

    // ================== 闂佽娴烽弫鎼佸储瑜斿畷锝夊幢濞戞瑦娅栧┑顔斤供閸撴稑鈻?ALL_PIPELINES 闂備浇妗ㄩ懗鑸垫櫠濡も偓閻ｅ灚鎷呯憴鍕潯濡炪倖鍨奸崕鑽ょ矆鐎ｎ剛纾肩紓浣靛灩閻忥繝鎮楀顒佸枠妤犵偛绉归獮瀣偐闊厼瀵?缂傚倷鐒﹂崕宕囦焊閸涱垱顫曟繛鍡樻尰閳锋捇鏌嶈閸撴盯鍩€椤掆偓缁犲秹宕愬┑瀣闁兼祴鏅滃畷澶嬨亜閺嶃劎顣查柛濞垮€栭〃銉╂倷妫版繂鏅ｇ紓?==================

    // ================== 闂備線鈧稑瀚庨柛濠冪箞瀵劑濮€閵堝懐顔撻悗骞垮劚鐎氼喚绮?==================
    const doUndo = useCallback(async () => {
        const stack = [...undoStack]
        const action = stack.pop()
        if (!action) { setStatusMsg('闂備礁鎼崯鐗堟叏绾惧浜归柡灞诲劚缁犲鏌曢崼婵愭Ч闁轰焦锕㈤弻锝夊Ω閵夈儺浠鹃梺鐟般偢閺€閬嶅箯?); return }
        setUndoStack(stack)

        if (action.type === 'add-edge') {
            setBaseTopoEdges(prev => prev.filter(e => e.id !== action.edgeId))
            setUnsavedEdgeIds(prev => {
                const next = new Set(prev)
                next.delete(action.edgeId)
                return next
            })
            setStatusMsg('闁诲骸婀遍…鍫濐嚕閸洖绠版繛鍡樻尰閻撱儵鏌? 闂備礁鎲＄敮鐐寸箾閳ь剚绻涢崨顓烆劉婵炵厧顭烽幃娆撴濞戞瑧鏋?)
        } else if (action.type === 'add-node') {
            const node = baseTopoNodes.find(n => n.id === action.nodeId)
            setBaseTopoEdges(prev => prev.filter(e => e.startNodeId !== action.nodeId && e.endNodeId !== action.nodeId))
            setBaseTopoNodes(prev => prev.filter(n => n.id !== action.nodeId))
            setSelectedMergeNodeIds(prev => prev.filter(id => id !== action.nodeId))
            setStatusMsg(`闁诲骸婀遍…鍫濐嚕閸洖绠版繛鍡樻尰閻撱儵鏌? 闂備礁鎲＄敮鐐寸箾閳ь剚绻?${node?.name || '闂備胶鍘ч幖顐﹀磹婵犳艾纾?}`)
        } else if (action.type === 'create-junction') {
            try {
                await topologyEditorApi.deleteJunctionGroup(action.junctionId)
                invalidatePipelineCache()
                await loadJunctionGroups()
                setSelectedNode(null)
                setStatusMsg(`闁诲骸婀遍…鍫濐嚕閸洖绠版繛鍡樻尰閻撱儵鏌? 闂備胶鎳撻崲鎻捨涘Δ鍛瀭閹兼番鍔岄崙鐘绘煏韫囧鐏遍柛鈺佹嚇閺?{action.name}闂備線娼уΛ妤冩兜?
            } catch (error) {
                console.error(error)
                setStatusMsg(error instanceof Error ? `闂備線鈧稑瀚庨柛濠冪箞瀵劑濮€閵堝懎鍤戦梺闈涚箞閸ㄥジ宕洪崨瀛樼厱闁圭儤鎸鹃埥澶岀磽閸屾稒灏扮€垫澘瀚蹇涱敃閵夋劖娲熼弻?{error.message}` : '闂備線鈧稑瀚庨柛濠冪箞瀵劑濮€閵堝懎鍤戦梺闈涚箞閸ㄥジ宕洪崨瀛樼厱闁圭儤鎸鹃埥澶岀磽閸屾稒灏扮€垫澘瀚蹇涱敃閵?)
            }
        } else if (action.type === 'delete-junction') {
            try {
                await topologyEditorApi.createJunctionGroup({
                    name: action.group.name,
                    station_ids: action.group.station_ids,
                    description: action.group.description ?? undefined,
                })
                invalidatePipelineCache()
                await loadJunctionGroups()
                setStatusMsg(`闁诲骸婀遍…鍫濐嚕閸洖绠版繛鍡樻尰閻撱儵鏌? 闂備浇顕栭崢褰掑垂瑜版崵鍥蓟閵夈儱鍤戦梺闈涚箞閸ㄥジ宕洪崨瀛樼厪?{action.group.name}闂備線娼уΛ妤冩兜?
            } catch (error) {
                console.error(error)
                setStatusMsg(error instanceof Error ? `闂備線鈧稑瀚庨柛濠冪箞瀵劑濮€閵堝懎鍤戦梺闈涚箞閸ㄥジ宕洪崨瀛樼厵鐎瑰嫮澧楅ˉ婊堟煕閵娿儱顒㈢€垫澘瀚蹇涱敃閵夋劖娲熼弻?{error.message}` : '闂備線鈧稑瀚庨柛濠冪箞瀵劑濮€閵堝懎鍤戦梺闈涚箞閸ㄥジ宕洪崨瀛樼厵鐎瑰嫮澧楅ˉ婊堟煕閵娿儱顒㈢€垫澘瀚蹇涱敃閵?)
            }
        }
    }, [baseTopoNodes, loadJunctionGroups, undoStack])

    // Ctrl+Z 闂傚鍋勫ù鍌炲磻閸涱厾鏆ら幖娣妽閻?    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault()
                void doUndo()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [doUndo])
    const importTopology = useCallback((silent = false) => {
        if (!mapInstance) return
        const { nodes: srcN, lines: srcL } = rawPipelineData
        if (srcN.length === 0) {
            if (!silent) setStatusMsg('闂備礁鎼崯鐗堟叏绾惧浜归柤纰卞厴閸嬫捇鎮介棃娑樹粯闂佸憡鐟ュΛ婵嬪箚閸愵喖绀嬫い鎾楀啯鍊庣紓鍌欒兌閸嬫挾鈧瑳鍥ф辈闁绘梻鍘х粻?)
            return
        }

        clearRenderedTopology()
        setTopoNodes([])
        setTopoEdges([])
        setSelectedNode(null)

        // ------- 闂傚倸鍊搁崯鐘诲磻閹剧粯鍊垫鐐茬仢閳ь剚绻堥獮妤呮嚃閳哄倸纾銈嗙墬绾板秹宕愰妶鍡╂闁绘劖褰冮。鎶芥煟閿濆牜鍤欓柍?-------
        // 1. 闁荤喐绮庢晶妤冩暜閻愬灚鍋栨い鎰堕檮閺咁剚鎱ㄥ鍡楀闁规彃鐏濋湁婵犲﹤瀚埊鏇熶繆閸欏鍊愭慨濠傘偢閸┾偓妞ゆ帒鍊甸崑鎾荤嵁閸喒鍋撻幋锕€鐒垫い鎴ｆ硶椤︼箓鏌熸慨鎰仾缂佸倸绉撮埥澶娾枎閹板濡囩槐鎺楀籍閳ь剟鎮烽妷銉㈡敠闁?        const nodeTypeMap = new Map<string, PointType>()
        const valveIds = new Set<string>()
        for (const sn of srcN) {
            const mt: PointType = TYPE_MAP[sn.type] || 'station'
            nodeTypeMap.set(sn.id, mt)
            if (mt === 'valve') valveIds.add(sn.id)
        }

        // 2. 闂備礁鎼鍛偓姘煎墰缁辨捇骞樼拠鑼槯闂侀潧艌閺呮稑鈻嶉妶澶嬧拺妞ゆ挾濮风敮娑㈡偨椤栨凹鍤熼柟顔诲嵆閳ワ箓骞掗弮鍌ゆП闂備礁鎲￠悧鏇㈠箠鎼淬劌绠氶柛顐犲劜閳锋捇鏌嶈閸撴盯鍩€椤掆偓缁犲秹宕愯濡?        const adj = new Map<string, Set<string>>()
        for (const sn of srcN) {
            adj.set(sn.id, new Set())
        }
        for (const sl of srcL) {
            if (adj.has(sl.startNodeId) && adj.has(sl.endNodeId)) {
                adj.get(sl.startNodeId)!.add(sl.endNodeId)
                adj.get(sl.endNodeId)!.add(sl.startNodeId)
            }
        }

        // 3. BFS闂備焦瀵х粙鎺楁儗椤旀儳鍨濋柣妯荤暙閹烘洜鐤€閹兼番鍔屽▓婵嬫⒒閸屾氨澧㈤柛瀣ㄥ€曢～妤呭礈瑜夐崑鎾荤嵁閸喒鍋撳☉娆庣箚妞ゆ挶鍨洪崐鐑芥煟閻斿憡绶叉慨锝咁樀閺屾稑鈻庨幇顒傚帎缂備浇椴哥换鍕垝濮樿埖鍤勬い鏍ㄧ敖閵娾晜鈷掗柛鎰剁到娴滈箖鏌ｆ惔锛勭暛闁稿﹥绻堥獮妤佺附閸涘﹥娅栭柣蹇曞仦閸庢娊藟濠靛鐓曢柟鐑樻煥椤ｇ厧顭胯缁夌懓顕ｉ崹顐㈢窞濠电姴鍊介澶愭煛婢跺﹦澧曞褑妫勯埢鎾诲箣閿旂瓔妫冮梺缁樺姉閸庛倝鈥栨繝鍥ㄥ€垫鐐茬仢閳ь剚绻堝畷鎴︽晜閸欍儲鍕?        //    A 闂?V1 闂?V2 闂?B  闂備礁鎲￠懝楣冩偋閸℃稒鍤愰柣鏂挎憸閳? A 闂?B
        const collapsedEdges = new Set<string>()  // "minId_maxId" 闂備礁鎲￠敋妞ゎ厾鍏樺畷?        const edgePairs: Array<[string, string]> = []

        for (const sn of srcN) {
            if (valveIds.has(sn.id)) continue  // 闂佽崵濮嶉崶鑸殿棖闂佺顑戠紞鈧紒鐘崇洴瀹曘劌菐椤戣棄浜鹃煫鍥ㄧ☉閸欏﹥銇勯弽顐沪濠殿喗绮撳濠氬礃閿濆懍澹曢梺?
            const queue = [...(adj.get(sn.id) || [])]
            const visited = new Set<string>([sn.id])

            while (queue.length > 0) {
                const curr = queue.shift()!
                if (visited.has(curr)) continue
                visited.add(curr)

                if (valveIds.has(curr)) {
                    // 闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯款嚙閸欏﹥銇勯弽顐沪妞ゎ剙锕幃?闂?缂傚倸鍊风紞鈧柛娑卞灡閺嗘壆绱撴担鍝ョ劮闁稿氦宕电划?                    for (const next of adj.get(curr) || []) {
                        if (!visited.has(next)) queue.push(next)
                    }
                } else {
                    // 闂備胶鎳撻悘姘跺磿閹惰棄鏄ラ悘鐐插⒔椤╂煡鏌涢埄鍐炬當缂傚秵顨呴埥澶愬箻椤栨矮澹曞┑鐐村灦閹尖晜绂嶉鍕电劷妞ゅ繐鐗婇埛鎾绘煃瑜滈崜娑㈠焵椤掆偓缁犲秹宕愬☉娆庣箚妞ゆ挶鍨洪崐?闂?闂備焦鐪归崹濠氬窗閹版澘鍨傛慨妯挎硾鐟欙箓鏌涢锝囩畾閻庢碍鐟╁?                    const ids = [sn.id, curr].sort()
                    const key = `${ids[0]}_${ids[1]}`
                    if (!collapsedEdges.has(key)) {
                        collapsedEdges.add(key)
                        edgePairs.push([sn.id, curr])
                    }
                }
            }
        }

        // 4. 闂備礁鎼鍛偓姘嵆閸┾偓妞ゆ帒鍊搁埢鍫熺箾绾板彉閭慨濠傘偢閸┾偓妞ゆ帒鍊甸崑鎾荤嵁閸喒鍋撻弴銏″亜闁逞屽墰閻ヮ亪顢樺☉妯瑰闂備胶鍘ч幖顐﹀磹婵犳艾纾?        const imported: BaseTopoNode[] = []
        for (const sn of srcN) {
            if (valveIds.has(sn.id)) continue

            const pos: [number, number] = [sn.coordinate.longitude, sn.coordinate.latitude]
            const type = nodeTypeMap.get(sn.id) || 'station'
            imported.push({ id: sn.id, type, name: sn.name, position: pos })
        }

        // 5. 闂備礁鎼鍛偓姘嵆閸┾偓妞ゆ帒鍊稿瓭闂佺粯鏌￠崑鎾剁磼缂併垹骞愰柛瀣崌瀵爼鍩￠崘銊ゆ埛闂?        const importedEdges: BaseTopoEdge[] = []
        const importedMap = new Map(imported.map(node => [node.id, node]))

        for (const [startId, endId] of edgePairs) {
            const sNode = importedMap.get(startId)
            const eNode = importedMap.get(endId)
            if (!sNode || !eNode) continue
            const edgeId = `ce-${startId.slice(-4)}-${endId.slice(-4)}`
            importedEdges.push({ id: edgeId, startNodeId: startId, endNodeId: endId, name: `${sNode.name} 闂?${eNode.name}` })
        }

        setBaseTopoNodes(imported)
        setBaseTopoEdges(importedEdges)
        setDirtyPositions(new Map())
        setUnsavedEdgeIds(new Set())
        setPositionPreview(null)

        if (!silent) {
            setStatusMsg(`闁诲海鎳撻幉陇銇愰崘顕呮晪闂侇剙绉寸粈?${imported.length} 闂備胶鍘ч幖顐﹀磹婵犳艾纾? ${importedEdges.length} 闂備礁鎼ˉ锟犲Χ閸モ晩鍟庣紓鍌欑劍閸庡磭浜搁崨顖涱潟婵炲棙鎸婚埛鎾绘煃瑜滈崜娑㈠焵椤掆偓缁犲秹宕愬┑瀣闁兼祴鏅滃畷澶嬨亜閺嶃劏澹橀柛銈嗗浮閺屾稑顫濋鍌氼暫闂佽壈宕甸崰鏍极瀹ュ棛绠?
        }
    }, [clearRenderedTopology, mapInstance, rawPipelineData])

    const restoreSavedDraft = useCallback((silent = false) => {
        try {
            const raw = localStorage.getItem(TOPOLOGY_DRAFT_STORAGE_KEY)
            if (!raw) return false
            const parsed = JSON.parse(raw) as {
                nodes?: Array<{ id?: string; name?: string; type?: PointType; lng?: number; lat?: number }>
                edges?: Array<{ id?: string; from?: string; to?: string; name?: string }>
            }
            const draftNodes = Array.isArray(parsed.nodes)
                ? parsed.nodes
                    .filter(item => item && typeof item.id === 'string' && Number.isFinite(item.lng) && Number.isFinite(item.lat))
                    .map(item => ({
                        id: String(item.id),
                        name: String(item.name || item.id),
                        type: (item.type && TOPO_LABELS[item.type] ? item.type : 'station') as PointType,
                        position: [Number(item.lng), Number(item.lat)] as [number, number],
                    }))
                : []
            const nodeIdSet = new Set(draftNodes.map(item => item.id))
            const draftEdges = Array.isArray(parsed.edges)
                ? parsed.edges
                    .filter(item => item && typeof item.id === 'string' && typeof item.from === 'string' && typeof item.to === 'string')
                    .filter(item => nodeIdSet.has(String(item.from)) && nodeIdSet.has(String(item.to)))
                    .map(item => ({
                        id: String(item.id),
                        startNodeId: String(item.from),
                        endNodeId: String(item.to),
                        name: String(item.name || '闂備浇顕栭崢褰掑垂瑜版崵鍥嚑椤掑倷绗夐梺鎸庣☉鐎氼剙鈻?),
                    }))
                : []
            if (draftNodes.length === 0) return false

            setBaseTopoNodes(draftNodes)
            setBaseTopoEdges(draftEdges)
            setDirtyPositions(new Map())
            setUnsavedEdgeIds(new Set())
            setPositionPreview(null)
            setHasSavedDraft(true)
            if (!silent) {
                setStatusMsg(`闁诲骸婀遍…鍫濐嚕閼哥數顩锋い鏃囨缁剁偟鈧箍鍎卞Λ娆撳箯闁秵鐓曢柨鏇炲亞閺嗘帞绱掔紒妯荤殤闁逞屽墯缁嬫帡鈥﹂崶顑解偓锕傚醇閵夛附娅?{draftNodes.length} 闂備胶鍘ч幖顐﹀磹婵犳艾纾?/ ${draftEdges.length} 闂佸搫顦弲婵嬪磻閻旂厧鍚圭€?
            }
            return true
        } catch (error) {
            console.error('[MapTopologyView] restoreSavedDraft failed', error)
            return false
        }
    }, [])

    useEffect(() => {
        if (!mapInstance || rawPipelineData.nodes.length === 0 || importedOnceRef.current) return
        importedOnceRef.current = true
        const restored = restoreSavedDraft(true)
        if (!restored) {
            importTopology(true)
        }
    }, [importTopology, mapInstance, rawPipelineData.nodes.length, restoreSavedDraft])

    useEffect(() => {
        if (!selectedNode) return
        const nextSelected = topoNodes.find(node => node.id === selectedNode.id) || null
        setSelectedNode(nextSelected)
    }, [selectedNode?.id, topoNodes])

    const flyTo = useCallback((node: TopoNode) => {
        if (!mapInstance) return
        mapInstance.setZoomAndCenter(10, node.position, true, 500)
        setStatusMsg(`闁诲海鎳撻幉陇銇愰崘顔藉仼闁绘劦鍓氭刊? ${node.name}`)
    }, [mapInstance])

    useEffect(() => {
        const params = new URLSearchParams(location.search)
        const focusNodeId = params.get('focusNode')
        if (!focusNodeId || topoNodes.length === 0) return
        if (appliedFocusNodeRef.current === focusNodeId) return

        const targetNode = resolveFocusTarget(topoNodes, focusNodeId)
        if (!targetNode) return

        appliedFocusNodeRef.current = focusNodeId
        flyTo(targetNode)
        setSelectedNode(targetNode)
        setStatusMsg(`闁诲氦顫夐悺鏇烆嚕閹捐泛鍨濋柣妯款嚙閹瑰爼鏌℃径瀣嚋缂佸倸鐗撻弻銈嗘綇閵婏妇鍙嗘繝娈垮枓閺呮繈鍩€椤掑喚娼愰柣顓у枤缁辩偤宕ㄩ弶鎴狀槴闂佺粯顨呴悧鍡涙偟閺嶎厽鐓欓柛顭戝亜閻忓崬鈹戦埥鍡楀籍闁诡喗鐟╅幆鍌炲传閵壯呭炊${targetNode.name}`)
    }, [flyTo, location.search, topoNodes])

    // ================== 闂備浇顫夐幆灞剧濠靛钃熼柛銉ｅ妿椤╃兘鎮归幁鎺戝闁?==================
    const runCutoffSimulation = useCallback(() => {
        if (!cutoffNodeId || topoNodes.length === 0) return
        const gn = topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))
        const ge = topoEdges.map(e => ({ id: e.id, startNodeId: e.startNodeId, endNodeId: e.endNodeId }))
        const result = simulateCutoff(gn, ge, cutoffNodeId)
        setCutoffResult(result)

        const lostCount = result.summary.supplyLost
        setStatusMsg(`濠电偛顕慨鎯р枖閺囩儑鑰块柨娑樺閸嬫捇鎮烽悧鍫熸嫳闂佹悶鍔嶅畝鎼佸极?{lostCount} 濠电偞鍨堕幖鈺傜濠靛钃熼柛銉ｅ妿閻熻绻涢幋婵堬紞缂佲偓?{result.summary.rerouted} 濠电偞鍨堕幖鈺傜閻愰潧鍨濇い鎰╁€栭崑妯尖偓鍏夊亾閻庯綆鍓涢ˇ?{result.summary.same} 濠电偞鍨堕幖鈺傜濞嗘垹绠斿鑸靛姇閻淇婇妶鍌氫壕婵犻潧鍊归悧鐘茬暦椤愩垻鏆?
    }, [cutoffNodeId, topoNodes, topoEdges])

    /** 婵犵數鍋為幐鎼佸箠濡　鏋嶉幖娣妼缁狅絾銇勮箛鎾村櫤闁绘帟妫勯湁闁绘鍎ょ涵鑸电節閳ь剟鍩勯崘鐐暬濠碘槅鍨抽幊鎾绘儊閵娾晜鐓ユ繛鎴炆戝﹢鏉棵归悪鈧崰妤€顕ラ崟顐悑闁告侗鍘介弸鐐節濞堝灝鏋涙い鎴濇閹囧础閻戝棗娈?*/
    const clearCutoffHighlight = useCallback(() => {
        setCutoffNodeId(null)
        setCutoffResult(null)
        setStatusMsg('闂備浇顫夐幆灞剧濠靛钃熼柛銉ｅ妿椤╃兘鎮归幁鎺戝闁糕晛鍊婚埀顒€婀遍…鍫濐嚕閸撲胶鍗氬┑鐘崇閳?)
    }, [])

    // ================== 濠德板€楁慨鎾儗娓氣偓閹?==================
    const runValidation = useCallback(() => {
        const gn = topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))
        const ge = topoEdges.map(e => ({ id: e.id, startNodeId: e.startNodeId, endNodeId: e.endNodeId, name: e.name }))
        const r = validateTopology(gn, ge)
        setReport(r)
        setStatusMsg(`濠德板€楁慨鎾儗娓氣偓閹焦寰勭仦绋夸壕闁荤喓澧楀﹢浼存煕? ${r.issues.length} 闂備礁鎼ˇ顐﹀焵椤掑啯鐝柛鐔哄仱閹綊鍩€椤掑嫨鈧?
        setActiveTab('validate')
    }, [topoNodes, topoEdges])

    // ================== 濠电偛顕慨鎾敄閸℃稑姹查柣鏂挎憸閳绘梹銇勯幘璺轰户濠碘€虫喘閺?==================
    const runCentrality = useCallback(() => {
        const gn = topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))
        const ge = topoEdges.map(e => ({ id: e.id, startNodeId: e.startNodeId, endNodeId: e.endNodeId }))
        const c = computeBetweennessCentrality(gn, ge)
        const top = [...c.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([id, val]) => ({ id, name: topoNodes.find(n => n.id === id)?.name || id, value: Math.round(val * 100) }))
        setCentralityData(top)
        setStatusMsg(`濠电偛顕慨鎾敄閸℃稑姹查柣鏂挎憸閳绘梹銇勯幘璺轰户濠碘€虫喘閺?Top ${top.length}`)
        setActiveTab('centrality')
    }, [topoNodes, topoEdges])

    // ================== 闂備胶鎳撻崥瀣垝鎼淬劌纾?==================
    const searchResults = useMemo(() => {
        if (!searchText.trim()) return []
        const kw = searchText.trim().toLowerCase()
        return topoNodes.filter(n => n.name.toLowerCase().includes(kw))
    }, [searchText, topoNodes])

    // ================== 闂佽娴烽弫鎼佸储瑜斿畷?==================
    const buildTopologyPayload = useCallback(() => {
        return {
            nodes: topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type, lng: n.position[0], lat: n.position[1] })),
            edges: topoEdges.map(e => ({ id: e.id, from: e.startNodeId, to: e.endNodeId, name: e.name })),
        }
    }, [topoEdges, topoNodes])

    const exportJSON = () => {
        const obj = buildTopologyPayload()
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `topology_${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
        setStatusMsg(`闁诲海鎳撻幉陇銇愰崘顕呮晪闂侇剙绉寸粈?${topoNodes.length} 闂備胶鍘ч幖顐﹀磹婵犳艾纾绘い?
    }

    const saveConnectedEdges = useCallback(() => {
        if (unsavedEdgeIds.size === 0) return
        const payload = buildTopologyPayload()
        const savedAt = new Date().toISOString()
        const draft = { ...payload, savedAt }
        localStorage.setItem(TOPOLOGY_DRAFT_STORAGE_KEY, JSON.stringify(draft))
        const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `topology_saved_${savedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`
        a.click()
        URL.revokeObjectURL(url)
        setUnsavedEdgeIds(new Set())
        setHasSavedDraft(true)
        setStatusMsg(`闁诲氦顫夐悺鏇烆嚕閹捐埖宕叉慨妯诲閸嬫挸鈽夊▎妯煎姼缂備胶绮粙鎾绘儉椤忓牆绀岄柨娑樺椤︻噣姊洪崫鍕偓鐟邦熆濮椻偓璺?${unsavedEdgeIds.size} 闂備礁鎼ˉ锟犲Χ閸モ晩鍟庣紓鍌欑劍閸庢娊鎮樺┑瀣闁跨喓濮垫刊浼存煟閿濆懏婀扮痪鍓х彋)
    }, [buildTopologyPayload, unsavedEdgeIds])`r`n`r`n    const clearAll = () => {
        clearRenderedTopology()
        setBaseTopoNodes([])
        setBaseTopoEdges([])
        setTopoNodes([])
        setTopoEdges([])
        setDirtyPositions(new Map())
        setUnsavedEdgeIds(new Set())
        setPositionPreview(null)
        setReport(null)
        setCentralityData([])
        setSelectedNode(null)
        setSelectedMergeNodeIds([])
        setCutoffNodeId(null)
        setCutoffResult(null)
        setStatusMsg('闁诲骸婀遍…鍫濐嚕閸撲胶鍗氶柤濮愬€楅惌?)
    }

    const handleCreateManualJunction = useCallback(async () => {
        if (!manualJunctionEditingEnabled) {
            setStatusMsg('闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯肩帛閸嬫繃銇勯弽銊ュ毈闁哄棙妫冮弻锟犲醇椤愶紕鐩庣紓浣介哺閸ㄥ灝顕ｉ妸鈺傚€锋い鎺嗗亾妞ゃ倓鑳堕埀顒冾潐閹爼宕曢幓鎺旀殾婵°倕鎳庣憴锕傛煕椤愶絿绠撻柡鍛倐閺?)
            return
        }
        if (selectedMergeNodeIds.length < 2 || isMerging) return

        const name = mergeJunctionName.trim() || selectedMergeAutoName
        if (!name) {
            setStatusMsg('闂佽崵濮村ú銈夊床閺屻儱鍌ㄦ繛鎴欏灪閻掕顭跨捄渚剰妞ゅ繈鍎甸弻銈呯暋閺夋寧姣愰梺娲荤厛閸ㄨ京绮欐径鎰ч柛鏇ㄥ灠濞堟繄绱撴担瑙勨拹闁荤啙鍥х；闁挎繂顦伴弲顒勬倶閻愯埖顥夐柡鍛懇閺屾盯骞掗幘鍨涙缂傚倸鍊归幑鍥嵁閹达絿鐤€闁圭偓娼欓埀顑惧€濋弻锛勨偓锝冨妼閻忣噣鏌?)
            return
        }

        setIsMerging(true)
        try {
            const result = await topologyEditorApi.createJunctionGroup({
                name,
                description: mergeJunctionDescription.trim() || undefined,
                station_ids: selectedMergeNodeIds,
            })
            invalidatePipelineCache()
            await loadJunctionGroups()
            setUndoStack(prev => [...prev, { type: 'create-junction', junctionId: result.id, name }])
            setEditMode('view')
            setSelectedMergeNodeIds([])
            setMergeJunctionName('')
            setMergeJunctionDescription('')
            setStatusMsg(`闁诲海鎳撻幉陇銇愰崘顔煎瀭闁告鍎愰崵鍫ユ煟閹寸伝顏埪锋担琛″亾鐟欏嫭鍋犻柛搴㈠絻閻ｅ嘲螖閸涱叀袝闂佸壊鍋嗛崰鎾寸閼测晝纾奸柣鎰靛墯閻忣喚绱?{name}`)
        } catch (error) {
            console.error(error)
            setStatusMsg(error instanceof Error ? `闂備礁鎲＄敮妤冪矙閹寸姷纾介柟鎹愵嚙缁犮儵鎮楅敐搴濈胺缂佹唻缍侀弻鐔兼偡閹殿喚顔囬梺璇″枛鐎涒晛顕ラ崟顒佺秶妞ゆ劑鍎涢弴銏＄叆?{error.message}` : '闂備礁鎲＄敮妤冪矙閹寸姷纾介柟鎹愵嚙缁犮儵鎮楅敐搴濈胺缂佹唻缍侀弻鐔兼偡閹殿喚顔囬梺璇″枛鐎涒晛顕ラ崟顒佺秶妞ゆ劑鍎?)
        } finally {
            setIsMerging(false)
        }
    }, [
        isMerging,
        loadJunctionGroups,
        manualJunctionEditingEnabled,
        mergeJunctionDescription,
        mergeJunctionName,
        selectedMergeAutoName,
        selectedMergeNodeIds,
    ])

    const handleDeleteManualJunction = useCallback(async (group: JunctionGroup) => {
        if (isRuntimeReadonlyGroup(group) || deletingJunctionId === group.id) {
            return
        }

        setDeletingJunctionId(group.id)
        try {
            await topologyEditorApi.deleteJunctionGroup(group.id)
            invalidatePipelineCache()
            await loadJunctionGroups()
            setUndoStack(prev => [...prev, { type: 'delete-junction', group }])
            setSelectedNode(current => (
                current?.junctionId === group.id ? null : current
            ))
            setStatusMsg(`闁诲骸婀遍…鍫濐嚕閼搁潧鍨旈柛顐ｆ礀缁€鍡涙煕閳╁厾顏埪锋担琛″亾鐟欏嫭鍋犻柛搴㈠絻閻ｅ嘲螖閸涱叀袝闂佸壊鍋嗛崰鎾寸閼测晝纾奸柣鎰靛墯閻忣喚绱?{group.name}`)
        } catch (error) {
            console.error(error)
            setStatusMsg(error instanceof Error ? `闂備胶鎳撻崲鎻捨涘Δ鍛瀭閹兼番鍔岀粻銉╂倵閿濆簼绨风紒鎲嬬秮閺岀喖鎮烽幍顔绢唶闂佽鍠栫€涒晛顕ラ崟顒佺秶妞ゆ劑鍎涢弴銏＄叆?{error.message}` : '闂備胶鎳撻崲鎻捨涘Δ鍛瀭閹兼番鍔岀粻銉╂倵閿濆簼绨风紒鎲嬬秮閺岀喖鎮烽幍顔绢唶闂佽鍠栫€涒晛顕ラ崟顒佺秶妞ゆ劑鍎?)
        } finally {
            setDeletingJunctionId(null)
        }
    }, [deletingJunctionId, isRuntimeReadonlyGroup, loadJunctionGroups])

    const handleSavePositions = useCallback(async () => {
        if (dirtyPositions.size === 0 || isSaving) return
        setIsSaving(true)
        try {
            const updates = [...dirtyPositions.entries()].map(([id, position]) => ({
                id,
                longitude: position[0],
                latitude: position[1],
            }))
            const data = await topologyEditorApi.commitPositions({
                updates,
                cascade_valves: cascadeValves,
                cascade_scope: 'segment',
            })
            invalidatePipelineCache()
            const packages = await loadAllPipelines()
            setPipelines(packages)
            setDirtyPositions(new Map())
            setPositionPreview(null)
            setStatusMsg(
                `闁诲氦顫夐悺鏇烆嚕閹捐埖宕叉慨妯诲閸?${data.updated_station_ids?.length ?? 0} 濠电偞鍨堕幖鈺傜濞嗘垟鍋撻棃娑氱劯闁诡喗鐟╅幆鍌炲传閵壯屾Х闂備浇澹堟ご鎼佸蓟閵婏附鍙?${data.updated_valve_ids?.length ?? 0} 濠电偞鍨堕幖鈺傜椤忓嫷娼￠柛鎾椻偓閸嬫挾鎷犻埄鍐炬綉
            )
        } catch (error) {
            console.error(error)
            setStatusMsg(error instanceof Error ? `濠电儑绲藉ú锔炬崲閸岀偞鍋ら柕濞炬櫆閸婄兘姊洪锝囥€掔紒澶嬫綑椤潡骞嗛幍顔剧勘闁荤喐鐟辩粻鎾诲极?{error.message}` : '濠电儑绲藉ú锔炬崲閸岀偞鍋ら柕濞炬櫆閸婄兘姊洪锝囥€掔紒澶嬫綑椤潡骞嗛幍顔剧勘闁?)
        } finally {
            setIsSaving(false)
        }
    }, [cascadeValves, dirtyPositions, isSaving])

    const handlePreviewPositions = useCallback(async () => {
        if (dirtyPositions.size === 0 || isPreviewing || isSaving) return
        setIsPreviewing(true)
        try {
            const updates = [...dirtyPositions.entries()].map(([id, position]) => ({
                id,
                longitude: position[0],
                latitude: position[1],
            }))
            const data = await topologyEditorApi.previewPositions({
                updates,
                cascade_valves: cascadeValves,
                cascade_scope: 'segment',
            })
            setPositionPreview(data)
            setStatusMsg(
                `濠碘槅鍋呭妯尖偓姘煎灦閿濈偛顓奸崶锝呬壕闁荤喓澧楀﹢浼存煕閵婏箑鍝洪柡浣哥Т椤繈顢楅崒娑卞晥闁荤喐绮嶅妯虹暦椤掑嫬绠?${data.updated_station_ids?.length ?? 0} 濠电偞鍨堕幖鈺傜濞嗘垟鍋撻棃娑氱劯闁诡喗鐟╅悰顔芥償閹惧厖澹?{data.updated_valve_ids?.length ?? 0} 濠电偞鍨堕幖鈺傜椤忓嫷娼￠柛鎾椻偓閸嬫挾鎷犻埄鍐炬綉
            )
        } catch (error) {
            console.error(error)
            setStatusMsg(error instanceof Error ? `濠碘槅鍋呭妯尖偓姘煎灦閿濈偛顓奸崼娑楁睏闂佸憡顨堥崑鐐哄箚濞嗗浚鐔嗛柟顖涘缁ㄥ潡鎮峰▎娆戠暤闁?{error.message}` : '濠碘槅鍋呭妯尖偓姘煎灦閿濈偛顓奸崼娑楁睏闂佸憡顨堥崑鐐哄箚濞嗗浚鐔嗛柟顖涘缁ㄥ潡鎮?)
        } finally {
            setIsPreviewing(false)
        }
    }, [cascadeValves, dirtyPositions, isPreviewing, isSaving])

    // ================== 闂佽楠稿﹢閬嶅磻閻愬樊娓婚柛灞剧矌绾惧ジ鏌ｉ弮鈧鍧楀触閳?==================
    const createManualJunction = useCallback(async () => {
        if (!manualJunctionEditingEnabled) {
            setStatusMsg('闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯款嚙鐟欙箓骞栨潏鍓хУ濞寸厧鍊搁…璺ㄦ崉閸濆嫷浠圭紓渚囩厛閸撶喎鐣烽敐澶樻晜闁搞儴娉涘▓鍝勨攽閳藉棗鐏欓柍褜鍓欑壕顓犳兜閳ь剟姊洪幐搴ｂ槈濠靛倹姊荤划顓熷緞閹邦厼娈戦梺鑺ッˇ顖炴倶閿涘嫧鍋撻悙鐟扳偓妤呭磿閵堝棙娅犳繝濠傚枤閸熷懘鏌曟径娑氱暠缂佲偓閸岀偞鐓?)
            return
        }
        if (selectedMergeNodeIds.length < 2) {
            setStatusMsg('闂備胶鍘ч崲鏌ュ疮閸ф鍎嶆い鏍仦閻掕顭跨捄渚剰妞?2 濠电偞鍨堕幖鈺傜濠婂懓濮崇€规洖娲ｅ▽顏堟煕鐏炲墽鐭岀憸鐗堢叀閺岋綁骞囬锝嗙秷婵犫拃鍛枅闁硅櫕顨婇幐濠冨緞婵犲嫪鐢婚柣搴ｅ仯閸婃宕曢妶鍡樻珷婵犲﹤鍠氶崯鍛存煏婢舵稓鐣辩紒鈧崒鐐寸厱?)
            return
        }
        if (isMerging) return

        const fallbackName = `闂備礁缍婂褔顢栭崨顔碱嚤闁圭増婢橀崙鐘绘煏韫囧鐏遍柛?${new Date().toISOString().slice(0, 10)}`
        const payloadName = mergeJunctionName.trim() || fallbackName

        setIsMerging(true)
        try {
            const result = await topologyEditorApi.createJunctionGroup({
                name: payloadName,
                description: mergeJunctionDescription.trim() || undefined,
                station_ids: selectedMergeNodeIds,
            })
            setUndoStack(prev => [...prev, { type: 'create-junction', junctionId: result.id, name: payloadName }])
            setSelectedMergeNodeIds([])
            setMergeJunctionName('')
            setMergeJunctionDescription('')
            invalidatePipelineCache()
            await loadJunctionGroups()
            setStatusMsg(`闂備礁缍婂褔顢栭崨顔碱嚤闁圭増婢樼粻鏌ョ叓閸ャ劍灏伴柛濞垮€楅埀顒傛嚀閹猜ゃ亹閸愵喖鍨傞柛妤冨剱閸ゅ牓鏌ｅ顒夊殶缂?{payloadName}`)
        } catch (error) {
            console.error(error)
            setStatusMsg(error instanceof Error ? `闂備礁鎲＄敮妤冪矙閹寸姷纾介柟鎹愵嚙缁犮儵鎮楅敐搴濈胺缂佹唻缍侀弻鐔兼偡閹殿喚顔囬梺璇″枛鐎涒晛顕ラ崟顒佺秶妞ゆ劑鍎涢弴銏＄叆?{error.message}` : '闂備礁鎲＄敮妤冪矙閹寸姷纾介柟鎹愵嚙缁犮儵鎮楅敐搴濈胺缂佹唻缍侀弻鐔兼偡閹殿喚顔囬梺璇″枛鐎涒晛顕ラ崟顒佺秶妞ゆ劑鍎?)
        } finally {
            setIsMerging(false)
        }
    }, [
        isMerging,
        loadJunctionGroups,
        manualJunctionEditingEnabled,
        mergeJunctionDescription,
        mergeJunctionName,
        selectedMergeNodeIds,
    ])

    const removeManualJunction = useCallback(async (group: JunctionGroup) => {
        if (!manualJunctionEditingEnabled) {
            setStatusMsg('闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯款嚙鐟欙箓骞栨潏鍓хУ濞寸厧鍊搁…璺ㄦ崉閸濆嫷浠圭紓渚囩厛閸撶喎鐣烽敐澶樻晜闁搞儴娉涘▓鍝勨攽閳藉棗鐏欓柍褜鍓欑壕顓犳兜閳ь剟姊洪幐搴ｂ槈濠靛倹姊荤划顓熷緞閹邦厼娈戦梺鑺ッˇ顖炴倶閳哄懏鈷掗柛鏇楁櫅閳ь剚鐗楅弲璺侯煥閸愭儳鏅犻梺闈涱檧缁犳垹绮堥崒鐐寸厱?)
            return
        }
        if (isRuntimeReadonlyGroup(group)) {
            setStatusMsg('闂佸搫顦弲婊堟偡閿曗偓鍗遍柛娑橈攻娴溿倝鏌熼柇锕€鐏遍柡鈧禒瀣厸闁告劑鍔庨崺锝夋煕閿濆懏鎲哥紒杈ㄦ崌瀵粙濡歌閺夘厾绱撴担鍝勪壕闁哄宕靛Σ鎰攽閸モ斁鏋栭悗骞垮劚閻楀棝宕㈤幘顔界厱闁挎柨鎼慨鈧紓浣虹帛閻楃娀寮诲畝鈧禒锕傛寠婢跺奔鎮ｉ梻?)
            return
        }
        if (deletingJunctionId === group.id) return

        setDeletingJunctionId(group.id)
        try {
            await topologyEditorApi.deleteJunctionGroup(group.id)
            setUndoStack(prev => [...prev, { type: 'delete-junction', group }])
            invalidatePipelineCache()
            await loadJunctionGroups()
            if (selectedNode?.junctionId === group.id) {
                setSelectedNode(null)
            }
            setStatusMsg(`闁诲骸婀遍…鍫濐嚕閼搁潧鍨旈柛顐ｆ礀缁€鍡涙煕閳╁厾顏埪锋担琛″亾鐟欏嫭鍋犻柛搴㈠絻閻ｅ嘲螖閸涱叀袝闂佸壊鍋掗崜娑氱玻?{group.name}`)
        } catch (error) {
            console.error(error)
            setStatusMsg(error instanceof Error ? `闂備胶鎳撻崲鎻捨涘Δ鍛瀭閹兼番鍔岀粻銉╂倵閿濆簼绨风紒鎲嬬秮閺岀喖鎮烽幍顔绢唶闂佽鍠栫€涒晛顕ラ崟顒佺秶妞ゆ劑鍎涢弴銏＄叆?{error.message}` : '闂備胶鎳撻崲鎻捨涘Δ鍛瀭閹兼番鍔岀粻銉╂倵閿濆簼绨风紒鎲嬬秮閺岀喖鎮烽幍顔绢唶闂佽鍠栫€涒晛顕ラ崟顒佺秶妞ゆ劑鍎?)
        } finally {
            setDeletingJunctionId(null)
        }
    }, [
        deletingJunctionId,
        isRuntimeReadonlyGroup,
        loadJunctionGroups,
        manualJunctionEditingEnabled,
        selectedNode?.junctionId,
    ])

    const stats = useMemo(() => ({
        nodes: topoNodes.length,
        edges: topoEdges.length,
        isolated: topoNodes.length > 0
            ? findIsolatedNodes(
                topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type })),
                topoEdges.map(e => ({ id: e.id, startNodeId: e.startNodeId, endNodeId: e.endNodeId }))
            ).length
            : 0,
    }), [topoNodes, topoEdges])
    const simulationMapping = useMemo(() => {
        return buildSimulationOverlayMapping(topoNodes, topoEdges, steadyOverlay)
    }, [steadyOverlay, topoEdges, topoNodes])
    const baselineSimulationMapping = useMemo(() => {
        return buildSimulationOverlayMapping(topoNodes, topoEdges, steadyBaselineOverlay)
    }, [steadyBaselineOverlay, topoEdges, topoNodes])
    const selectedNodeSimulationMetrics = useMemo(() => {
        if (!selectedNode) return null
        if (simulationMapping) {
            const match = simulationMapping.nodeMatchesByDisplayId.get(selectedNode.id)
            if (!match || match.matchedNodes.length === 0) return null

            const tempItems = match.matchedNodes
                .map(item => item.temperature_c)
                .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
            const realAvgTemp = tempItems.length > 0
                ? tempItems.reduce((sum, value) => sum + value, 0) / tempItems.length
                : null
            const pressure = match.averagePressureMpa

            return {
                pressure,
                temperatureC: realAvgTemp ?? (pressure != null ? estimateTemperatureByPressure(pressure) : null),
                estimated: realAvgTemp == null,
                preSimulation: false,
            }
        }

        const nodePressure = preSimNodePressureOverrides[selectedNode.id]
        const fallbackPressure = Number.isFinite(nodePressure)
            ? nodePressure
            : Number.isFinite(preSimDefaultPressureMpa)
                ? preSimDefaultPressureMpa
                : 8.8
        const nodeTemperature = preSimNodeTemperatureOverrides[selectedNode.id]
        const fallbackTemperature = Number.isFinite(nodeTemperature)
            ? nodeTemperature
            : Number.isFinite(preSimDefaultTemperatureC)
                ? preSimDefaultTemperatureC
                : estimateTemperatureByPressure(fallbackPressure)

        return {
            pressure: fallbackPressure,
            temperatureC: fallbackTemperature,
            estimated: true,
            preSimulation: true,
        }
    }, [
        preSimDefaultPressureMpa,
        preSimDefaultTemperatureC,
        preSimNodePressureOverrides,
        preSimNodeTemperatureOverrides,
        selectedNode,
        simulationMapping,
    ])
    const selectedNodeConnectedEdges = useMemo(() => {
        if (!selectedNode) return []
        return topoEdges.filter(edge => edge.startNodeId === selectedNode.id || edge.endNodeId === selectedNode.id)
    }, [selectedNode, topoEdges])
    const mappingSummary = simulationMapping?.summary ?? null
    const isBreakScenarioActive = Boolean(
        steadyOverlay && steadyOverlay.scenario_id === 'zhongwei_trunk_break' && steadyOverlay.solver_status !== 'error'
    )
    const nodePressureDeltaMap = useMemo(() => {
        const map = new Map<string, number>()
        if (!steadyComparison) return map
        steadyComparison.top_node_pressure_changes.forEach(item => {
            map.set(item.id, item.delta_pressure_mpa)
        })
        return map
    }, [steadyComparison])
    const simulationVisualSummary = useMemo(() => {
        if (!simulationMapping) return null
        const highlightedNodeCount = topoNodes.filter(node => {
            const match = simulationMapping.nodeMatchesByDisplayId.get(node.id)
            return Boolean(match && (match.matchedNodeIds.length > 0 || match.matchedInternalEdgeIds.length > 0))
        }).length
        const highlightedEdgeCount = topoEdges.filter(edge => {
            const match = simulationMapping.edgeMatchesByDisplayId.get(edge.id)
            return Boolean(match && match.matchedEdgeIds.length > 0)
        }).length
        return {
            highlightedNodeCount,
            highlightedEdgeCount,
        }
    }, [simulationMapping, topoEdges, topoNodes])

    // ================== 婵犵數鍋為幐绋款嚕閸洘鍋?Simulation 闂備礁鎼€氼喗鎱ㄩ幘顔藉剭闁绘顕ч崘鈧悗鐟板婢瑰棛娑甸埀顒勬⒑閸涘﹤绗氭繝銏∶敃銏ゅ箻椤旇偐鍊?==================
    // ================== 婵犵數鍋為幐绋款嚕閸洘鍋?Simulation 闂備礁鎼€氼喗鎱ㄩ幘顔藉剭闁绘顕ч崘鈧悗鐟板婢瑰棛娑甸埀顒勬⒑閸涘﹤绗氭繝銏∶敃銏ゅ箻椤旇偐鍊?(闂備胶鍘ч幖顐﹀磹婵犳艾纾婚柨婵嗩槹閻掗箖鏌曟繛鍨姎闁? ==================
    useEffect(() => {
        if (topoNodes.length === 0) return

        topoNodes.forEach(node => {
            if (!node.marker) return
            let content = ''

            if (!simulationMapping) {
                if (activeTab === 'cutoff' && cutoffNodeId === node.id) {
                    content = `<div style="position: relative; display: flex; flex-direction: column; align-items: center; pointer-events: none;">
                        <div style="width:18px;height:18px;border-radius:50%;background:#ef4444;border:2px solid #fff;box-shadow:0 0 10px #ef4444; pointer-events: auto; transition: all 0.3s;"></div>
                        <div style="position: absolute; top: 22px; white-space: nowrap; font-size: 11px; color: #ef4444; font-weight: bold; text-shadow: 0 0 2px #fff, 0 0 2px #fff; z-index: 10;">${node.name}</div>
                    </div>`
                } else if (activeTab === 'cutoff' && cutoffResult) {
                    const aNode = cutoffResult.affectedNodes.find(n => n.id === node.id)
                    if (aNode) {
                        const color = aNode.status === 'supply_lost' ? '#991b1b' : '#f97316'
                        const size = aNode.status === 'supply_lost' ? 12 : 10
                        content = `<div style="position: relative; display: flex; flex-direction: column; align-items: center; pointer-events: none;">
                            <div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:1.5px solid #fff; pointer-events: auto; transition: all 0.3s;"></div>
                            <div style="position: absolute; top: ${size + 4}px; white-space: nowrap; font-size: 11px; color: ${color}; font-weight: bold; text-shadow: 0 0 2px #fff, 0 0 2px #fff; z-index: 10;">${node.name}</div>
                        </div>`
                    }
                }
                
                if (!content && node.id !== cutoffNodeId && !selectedMergeNodeIds.includes(node.id)) {
                    content = createTopoMarkerContent(node.type, isLargeGraphMode ? '' : node.name, false, !!node.isJunction)
                }
            } else {
                const allowFancyNodeEffect = renderSafetyMode === 'full' && !isMapInteracting && !isLargeGraphMode
                
                // 濠电偞娼欓崥瀣晪闂佸憡蓱缁嬫帡骞嗛弮鍫濈睄闁稿本绋掑▓銏ゆ⒑鐟欏嫭鍎楀ù婊勭箞瀵宕堕妸褜娴勯柣鐘充航閸斿秹宕洪崒鐐寸厸鐎广儱鎳庡Σ鑽ょ磼?                if (activeTab === 'cutoff') {
                    if (cutoffNodeId === node.id) {
                        content = `<div style="position: relative; display: flex; flex-direction: column; align-items: center; pointer-events: none;">
                            <div style="width:18px;height:18px;border-radius:50%;background:#ef4444;border:2px solid #fff;box-shadow:0 0 10px #ef4444; pointer-events: auto; transition: all 0.3s;"></div>
                            <div style="position: absolute; top: 22px; white-space: nowrap; font-size: 11px; color: #ef4444; font-weight: bold; text-shadow: 0 0 2px #fff, 0 0 2px #fff; z-index: 10;">${node.name}</div>
                        </div>`
                    } else if (cutoffResult) {
                        const aNode = cutoffResult.affectedNodes.find(n => n.id === node.id)
                        if (aNode) {
                            const color = aNode.status === 'supply_lost' ? '#991b1b' : '#f97316'
                            const size = aNode.status === 'supply_lost' ? 12 : 10
                            content = `<div style="position: relative; display: flex; flex-direction: column; align-items: center; pointer-events: none;">
                                <div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:1.5px solid #fff; pointer-events: auto; transition: all 0.3s;"></div>
                                <div style="position: absolute; top: ${size + 4}px; white-space: nowrap; font-size: 11px; color: ${color}; font-weight: bold; text-shadow: 0 0 2px #fff, 0 0 2px #fff; z-index: 10;">${node.name}</div>
                            </div>`
                        }
                    }
                }

                if (!content) {
                    const match = simulationMapping.nodeMatchesByDisplayId.get(node.id)
                    let color = TOPO_COLORS[node.type]
                    let glow = 'none'
                    let isAlert = false
                    let isCriticalAlert = false
                    let isWarningAlert = false
                    if (match && match.matchedNodes.length > 0) {
                        if (match.highestAlertLevel === 'critical') {
                            color = '#f87171' // red-400
                            glow = '0 0 12px #f87171'
                            isAlert = true
                            isCriticalAlert = true
                        } else if (match.highestAlertLevel === 'warning') {
                            color = '#fbbf24' // amber-400
                            glow = '0 0 10px #fbbf24'
                            isAlert = true
                            isWarningAlert = true
                        } else {
                            glow = '0 0 6px #6ee7b7' // mild green glow
                        }
                    }
                    
                    const size = node.isJunction ? TOPO_SIZES.station + 4 : TOPO_SIZES[node.type]
                    const border = isAlert ? '2px solid #fff' : '1px solid rgba(255,255,255,0.5)'
                    const shouldPulseCore = allowFancyNodeEffect && (isCriticalAlert || (isBreakScenarioActive && node.id === 'WE1-76'))
                    const pressureDelta = nodePressureDeltaMap.get(node.id)
                    const showDamage = allowFancyNodeEffect && damageFlashVisible && typeof pressureDelta === 'number' && pressureDelta < -0.01
                    const damageText = showDamage ? `${formatSignedNumber(pressureDelta, 2)} MPa` : ''
                    const shapeStyle = node.isJunction
                        ? `width:${size}px;height:${size}px;transform: rotate(45deg);border-radius: 3px;background:${color};border:${border};box-shadow:${glow}; pointer-events: auto; transition: all 0.5s;`
                        : `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border};box-shadow:${glow}; pointer-events: auto; transition: all 0.5s;`
                    
                    const extraLabel = match && match.averagePressureMpa != null ? 
                        `<div style="font-size: 9px; color: #67e8f9; background: rgba(0,20,30,0.8); padding: 2px 4px; border-radius: 3px; margin-top: 3px; border: 1px solid rgba(103,232,249,0.3);">${match.averagePressureMpa.toFixed(2)} MPa</div>` : ''

                    content = `
                        <div style="position: relative; display: flex; flex-direction: column; align-items: center; pointer-events: none;">
                            ${shouldPulseCore ? `<div class="we1-fault-ripple" style="--ripple-color:${isCriticalAlert ? '#f87171' : '#fb7185'}; --ripple-size:${size + 10}px;"></div>` : ''}
                            ${showDamage ? `<div class="we1-damage-pop">${damageText}</div>` : ''}
                            <div style="${shapeStyle}"></div>
                            ${node.name ? `<div style="position: absolute; top: ${size + 4}px; white-space: nowrap; font-size: 11px; color: ${isCriticalAlert ? '#f87171' : isWarningAlert ? '#fbbf24' : '#fff'}; text-shadow: 0 0 2px #000, 0 0 2px #000, 0 0 2px #000; z-index: 10; display: flex; flex-direction: column; align-items: center;">${node.name}${extraLabel}</div>` : ''}
                        </div>
                    `
                }
            }
            
            if (content && lastNodeContentRef.current.get(node.id) !== content) {
                safeSetMarkerContent(node.marker, content)
                lastNodeContentRef.current.set(node.id, content)
            }
        })
    }, [simulationMapping, topoNodes, cutoffNodeId, selectedMergeNodeIds, activeTab, cutoffResult, isBreakScenarioActive, nodePressureDeltaMap, damageFlashVisible, isMapInteracting, renderSafetyMode])

    // ================== 婵犵數鍋為幐绋款嚕閸洘鍋?Simulation 闂備礁鎼€氼喗鎱ㄩ幘顔藉剭闁绘顕ч崘鈧悗鐟板婢瑰棛娑甸埀顒勬⒑閸涘﹤绗氭繝銏∶敃銏ゅ箻椤旇偐鍊?(闂佸搫顦悧鍡楋耿闁秴鐤炬い鎰剁畱濡炵晫鈧厜鍋撻柛鎰典簽椤旀洜绱撴担鐟板姢婵炵》绻濆畷鏇㈠箻椤旇偐顦? ==================
    useEffect(() => {
        if (topoEdges.length === 0) return

        topoEdges.forEach(edge => {
            if (!edge.poly) return

            let edgeOptions: any = null

            if (!simulationMapping) {
                edgeOptions = { strokeColor: LINE_COLOR, strokeWeight: LINE_WEIGHT, strokeStyle: 'solid', showDir: false }
            } else {
                const allowFancyEdgeEffect = renderSafetyMode === 'full' && !isMapInteracting && !isLargeGraphMode
                const match = simulationMapping.edgeMatchesByDisplayId.get(edge.id)
                let color = LINE_COLOR
                let weight = LINE_WEIGHT
                let isDashed = false
                let hasFlow = false
                let flowSpeed = 0
                if (activeTab === 'cutoff') {
                    // In cutoff mode, we don't necessarily override line flows, keep the simulation lines for visual continuity if needed.
                    // Or maybe revert to default. We'll retain the simulation match if active.
                }

                if (match && match.matchedEdges.length > 0) {
                    if (match.highestAlertLevel === 'critical') {
                        color = '#f43f5e' // rose-500
                        weight = LINE_WEIGHT + 2
                        isDashed = true
                        hasFlow = true
                        flowSpeed = 0.25
                    } else if (match.highestAlertLevel === 'warning') {
                        color = '#f59e0b' // amber-500
                        weight = LINE_WEIGHT + 1
                        hasFlow = true
                        flowSpeed = 0.8
                    } else if (match.averageUtilization != null && match.averageUtilization > 0) {
                        color = '#10b981' // strong green
                        weight = LINE_WEIGHT + 1
                        hasFlow = true
                        flowSpeed = Math.max(0.6, Math.min(2.6, match.averageUtilization * 2.8))
                    } else if (match.averageUtilization === 0) {
                        color = '#64748b' // slate
                        flowSpeed = 0
                    }
                }
                if (isBreakScenarioActive && (match?.highestAlertLevel === 'critical' || (match?.averageUtilization ?? 0) <= 0.05)) {
                    flowSpeed = 0
                }
                edgeOptions = {
                    strokeColor: color,
                    strokeWeight: weight,
                    strokeStyle: hasFlow || isDashed ? 'dashed' : 'solid',
                    showDir: hasFlow && flowSpeed > 0.05,
                }
                if (allowFancyEdgeEffect && (hasFlow || isDashed)) {
                    edgeOptions.strokeDasharray = [10, 12]
                    edgeOptions.strokeDashoffset = -Math.round(lineFlowPhase * flowSpeed)
                } else if (hasFlow || isDashed) {
                    edgeOptions.strokeDasharray = [10, 12]
                    edgeOptions.strokeDashoffset = 0
                }
            }

            const edgeOptionsStr = JSON.stringify(edgeOptions)
            if (lastEdgeOptionsRef.current.get(edge.id) !== edgeOptionsStr) {
                safeSetPolylineOptions(edge.poly, edgeOptions)
                lastEdgeOptionsRef.current.set(edge.id, edgeOptionsStr)
            }
        })

    }, [simulationMapping, topoEdges, activeTab, lineFlowPhase, isBreakScenarioActive, isMapInteracting, renderSafetyMode])

    const steadyScenarioOption = useMemo(() => {
        return MAINLINE_SCENARIOS.find(item => item.id === steadyScenarioId) ?? null
    }, [steadyScenarioId])
    const selectedSnapshotSummary = useMemo(() => {
        if (!steadySelectedSnapshotRunId) return null
        return steadySnapshots.find(item => item.run_id === steadySelectedSnapshotRunId) ?? null
    }, [steadySelectedSnapshotRunId, steadySnapshots])
    const selectedBaselineSnapshotSummary = useMemo(() => {
        if (!steadyBaselineSnapshotRunId) return null
        return steadySnapshots.find(item => item.run_id === steadyBaselineSnapshotRunId) ?? null
    }, [steadyBaselineSnapshotRunId, steadySnapshots])
    const trialCoverageSummary = useMemo(() => {
        const coveredCount = steadyTrialRunItems.filter(item => item.covered).length
        return {
            coveredCount,
            pendingCount: steadyTrialRunItems.length - coveredCount,
        }
    }, [steadyTrialRunItems])
    const latestCoveredTrialItem = useMemo(() => {
        return [...steadyTrialRunItems]
            .filter(item => item.covered && item.last_saved_at)
            .sort((left, right) => (right.last_saved_at ?? '').localeCompare(left.last_saved_at ?? ''))[0] ?? null
    }, [steadyTrialRunItems])
    const recommendedCoverageScenario = useMemo(() => {
        const itemMap = new Map(steadyTrialRunItems.map(item => [item.scenario_id, item]))
        for (const scenarioId of [steadyScenarioId, ...COVERAGE_RECOMMENDATION_ORDER]) {
            const matched = itemMap.get(scenarioId)
            if (matched?.covered) {
                return matched
            }
        }
        return steadyTrialRunItems.find(item => item.covered) ?? steadyTrialRunItems[0] ?? null
    }, [steadyScenarioId, steadyTrialRunItems])
    const latestCoveredSnapshotSummary = useMemo(() => {
        if (!latestCoveredTrialItem?.scenario_id) return null
        return [...steadySnapshots]
            .filter(item => item.scenario_id === latestCoveredTrialItem.scenario_id)
            .sort((left, right) => (right.saved_at ?? '').localeCompare(left.saved_at ?? ''))[0] ?? null
    }, [latestCoveredTrialItem?.scenario_id, steadySnapshots])
    const coverageResultSummary = useMemo(() => {
        const currentScenarioItem = steadyTrialRunItems.find(item => item.scenario_id === steadyScenarioId) ?? null
        const readinessLabel = trialCoverageSummary.pendingCount === 0
            ? '闂備礁鎲￠悷顖炲垂娴煎瓨鍋╂い鎺戝閺嬩線鎮楀☉娆樼劷鐎瑰憡绻勭槐鎺楀焵?
            : trialCoverageSummary.coveredCount > 0
                ? '闂備礁鎲￠悷顖炲垂娴煎瓨鍎戞い鎺戝閻掗箖鏌曟繝蹇擃洭鐎瑰憡绻勭槐鎺楀焵?
                : '闂佸搫顦弲婊呮箒缂備焦顨呴ˇ鐢稿箠濡ゅ懏鍤嶉柕澹啰鐛╃紓鍌欒閸?
        const riskSummary = trialCoverageSummary.pendingCount > 0
            ? `闂佸搫顦弲婊嗘懌濠电姭鍋?${trialCoverageSummary.pendingCount} 濠电偞鍨堕幖鈺傜濠婂牆瑙﹂柍褜鍓熼弻娑㈠Ω閵夘喖鍓板┑鐘欌偓閸嬫捇姊洪崫鍕闁搞劑浜堕幆鈧柛娑樼摠閸嬧晜绻涢崱妤冪鐟滆埇鍎甸弻锝夊箻濡も偓缁夊墎绮堟径濞㈡棃鎮╅崣澶嬫嫳闂佽桨绀佺紞濠傜暦濠婂喚鍚嬮柛娑卞幖瀵鏌ｉ悙瀵糕棨闁稿海鏁哥槐鐐哄醇閵夈儙銉デ?            : (mappingSummary && (mappingSummary.unmatchedOverlayNodeIds.length > 0 || mappingSummary.unmatchedOverlayEdgeIds.length > 0))
                ? '闂備線娼绘俊鍥磿閵堝應鏋嶆繛鍡樺灦閸熸椽鏌涢埄鍐噭缁剧偓澹嗛埀顒冾潐閻℃洜浜稿▎鎴濆灊闁挎稑瀚崑姗€鏌曟径鍡樻珖缂佸鍏橀弻銊モ槈濡警娈紓浣稿级瀹曟﹢濡甸幇鏉跨闁告劕妯婇弸鈧紓鍌氬€烽悞锕傚箰婵犳碍鍊跺璺侯儐娴溿倖淇婇婊呭笡缂佺姵甯￠弻锝夊箛椤掍浇纭€闂佹悶鍊曟鎼佸煝娴犲鐏抽柧蹇ｅ亜濞堛儲绻涢幋鐐存儎闁告妫勮灒濠㈣泛鐬奸惌鍡涙煕濠靛棗顏繝鈧幘顔界叆婵炴垶顭囬悞閿嬨亜閺傛妲洪柟鍙夋尦閺佹劙宕卞鍡樞濋梺鑽ゅ枑濞叉垹绮堟笟鈧獮鍐箻閹颁焦妗ㄩ梺闈涳紡閸曨厾鏆梻浣告惈鐎氼喗鎱ㄩ幘顔藉剭闁绘ê鐏氶崯娲煕閳╁啰鎳勭痪鍙ュ嵆閺岀喖鎳為妷顔惧姼濡炪倐鏅粻鎾翠繆?
                : '闂備線娼绘俊鍥磿閵堝應鏋嶆繛鍡樺灦閸熸椽鏌涢埄鍐噭缁惧彞鍗抽弻娑橆煥閸愵厼顏紓鍌氱Т椤戝鐣峰鍐惧悑闁告侗鍠栧▓銉︾箾閹寸偞鎯勯柛娆忓暣瀹曟螣鐠囪尙绐為梺缁樻⒒閸庛倝寮宠箛娑欑叆婵炴垶顭堢€氭壆鎲搁弶鍨骇缂佸倹甯℃俊鐤槼缂佺虎鍨堕弻鐔煎箒閹烘垵濮ょ紓浣虹帛閿曘垹鐣峰Δ鍛ㄩ柕澶涘閵堝ジ鏌ｆ惔銈庢綈缁炬澘绉跺Σ鎰板Ω瑜忛惌鍡涙煕濠靛棗顏╃紓宥嗘尵閳ь剙鐏氬妯尖偓姘ュ姂閸┾偓?
        return {
            readinessLabel,
            currentScenarioCovered: Boolean(currentScenarioItem?.covered),
            currentScenarioSnapshotCount: currentScenarioItem?.snapshot_count ?? 0,
            latestCoverageTime: latestCoveredTrialItem?.last_saved_at ?? '',
            matchedNodeText: simulationMapping ? `${mappingSummary?.displayNodesWithMatchedOverlay ?? 0} / ${mappingSummary?.displayNodeCount ?? 0}` : '-',
            matchedEdgeText: simulationMapping ? `${mappingSummary?.matchedOverlayEdgeCount ?? 0} / ${steadyOverlay?.edges.length ?? 0}` : '-',
            riskSummary,
        }
    }, [
        latestCoveredTrialItem?.last_saved_at,
        mappingSummary,
        simulationMapping,
        steadyOverlay?.edges.length,
        steadyScenarioId,
        steadyTrialRunItems,
        trialCoverageSummary.coveredCount,
        trialCoverageSummary.pendingCount,
    ])
    const coverageChecklistItems = useMemo(() => {
        return steadyTrialRunItems.map(item => {
            const playbook = MAINLINE_SCENARIO_PLAYBOOK[item.scenario_id] ?? {
                focus: '闂備胶顭堢换鎰版偋韫囨搫鑰块柛娑滃焽娴滃綊鏌熼幆褍鏆辨い銈呮嚇閺屾盯鏁傞幆褍濡哄┑鐐叉噺閻熝囧焵椤掑倹鏆╅柟铏尵閼洪亶寮婚妷锕€鍓梺鍛婃处閸嬪嫮绮╂ィ鍐╃厱闁哄啠鍋撶紒瀣箻閸┾偓妞ゆ垼娉曢崝宥囩磼娓氬﹦鐣甸柡灞界焷缁犳盯骞橀弶鎴紖闂備礁鎲＄粙鎴︽晝閵娾晩鏁嗛柣鏃傚帶鐎氬顭跨捄渚剳婵﹪绠栭弻锟犲醇濠垫劖笑闂佽鍠栭柊锝夊箖閸洖骞㈡俊銈傚亾缂傚秳绶氶弻娑㈠冀閵娧冣叺闂?,
                success: '闂備胶鍘ч崲鏌ュ疮閸ф鍎嶆い鏍ㄧ矋閸熷搫霉閿濆牊顥夐柛妯绘尦閹綊鎮滃Ο铏逛淮闂佹悶鍊ら崢濂革綖閵忋倖鏅查柛娑卞灣椤㈠懐绱撻崒娆戝妽闁圭顭烽幃妯诲緞閹邦厽娅栭柣蹇曞仜閳ь剛鍠庨悵顖炴⒑閻撳海锛嶉柡鍜佸亰瀵娊鍩€椤掆偓閳藉骞橀幇浣稿壆缂備焦姊归幐鍐差嚕閸洖鐏抽柛鎰蔼椤斿姊洪幖鐐插姢闁稿鍠庨敃銏ゅ川鐎涙ê鍓梺鍛婃处閸嬪懓銇愰妷鈺傜厽闁圭偓銇炵拋鏌ュ磻?,
                risk: '濠电姷顣介埀顒€鍟块埀顒€缍婇幃妯诲緞鎼存稐姹楅梺瑙勫劤閸熷潡路閸涘瓨鐓曢柨鏃€鍎抽崝瀣箾閸涱喚鎳冮柍璁崇矙閸╁嫰宕橀埡鍐殺闂備礁鎲￠敋婵☆偅顨夐妵鎰板箚閹殿喚鏉稿銈嗗姂閸婃洖顕ｆィ鍐╃叆婵炴垶顭囬悞鎼佹煟濞戞瑧鎳囩€殿喓鍔戦幊婊堝垂椤愵偅袧闂備礁鎲￠悷顖涚閿濆绀傛慨妞诲亾闁诡垰娲ㄩ埀顒婄秵娴滄粎绮婇鈧弻锟犲礃閵娿儺鏆㈢紓渚囧枔閸旀垵顕ｇ粙搴撴敠閹煎瓨鎸告禍?,
                talk: '闂備礁婀遍…鍫ニ囬婊呯閻庯綆鍠栫粈鍫⑩偓骞垮劚閹冲繒鑺卞鑸电厸闁告粈绀侀悘銉ф偖濞嗘挻鈷戦柟缁樺釜濮婃鎮楅棃娑氱劯闁绘侗鍣ｉ幊鐘活敆閳ь剛鐟ч梻浣筋嚃閸忔稓绮堟担濮愪汗濠㈣埖鍔曠粈宀勬煛瀹ュ啫鍔楅柛?,
            }
            return {
                ...item,
                focus: playbook.focus,
                success: playbook.success,
                risk: playbook.risk,
                talk: playbook.talk,
                isCurrent: item.scenario_id === steadyScenarioId,
                isRecommended: item.scenario_id === recommendedCoverageScenario?.scenario_id,
            }
        })
    }, [recommendedCoverageScenario?.scenario_id, steadyScenarioId, steadyTrialRunItems])
    const failureInvestigationLayerLabel = mappingSummary
        ? FAILURE_LAYER_LABELS[mappingSummary.failureInvestigationLayer]
        : FAILURE_LAYER_LABELS['frontend-consumption']
    const steadyOverlayStatusText = steadyOverlay
        ? `濠电偞鍨堕幑渚€顢欐繝鍕闁靛繈鍊栭崕?${steadyScenarioOption?.label ?? steadyOverlay.scenario_id} 闁?${SOLVER_STATUS_LABELS[steadyOverlay.solver_status]}`
        : '濠电偞鍨堕幑渚€顢欐繝鍕闁靛繈鍊栭崕鎴︽煟閺冨洤鍚圭紒鐘绘敱缁绘稓浠﹂崟鈺佲偓妤冪不閵夆晜鍋?
    const steadyStatusToneClass = steadySimLoading
        ? 'border-amber-400/30 bg-amber-500/10 text-amber-100'
        : steadyOverlay?.solver_status === 'converged'
            ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
            : steadyOverlay?.solver_status === 'max_iter'
                ? 'border-amber-400/30 bg-amber-500/10 text-amber-100'
                : steadyOverlay?.solver_status === 'error' || steadySimError
                    ? 'border-red-400/30 bg-red-500/10 text-red-100'
                    : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
    const steadyMetricCards = steadyOverlay ? [
        { label: '闂備浇顕栭崜婵嬵敊婵犲嫭顐介柣銏㈡暩绾?, value: steadyOverlay.summary.total_supply.toFixed(2), tone: 'text-cyan-100' },
        { label: '闂備浇顕栭崜娆撯€﹀畡鑸偓鎺旀崉閻?, value: steadyOverlay.summary.total_demand.toFixed(2), tone: 'text-sky-100' },
        { label: '婵°倗濮烽崑娑㈠疮閸噮鐒介幖娣妼缁€鍡涙煃閸濆嫬鏆為柡鍡楃箻閺?, value: steadyOverlay.summary.avg_utilization.toFixed(3), tone: 'text-emerald-100' },
        { label: '闂備礁鎲＄粙鎴︽晝閵娾晩鏁嗛柣鏃傚帶閺?, value: String(steadyOverlay.summary.alert_count), tone: 'text-amber-100' },
    ] : [
        { label: '闂佸搫顦弲婊堝礉濮椻偓閵嗕線骞嬮悩鐢碉紳闂佸搫璇為崘銊㈡瀼', value: '闂備礁鎼悧婊勭閿濆洦宕茬€广儱娲﹂崑?, tone: 'text-slate-200' },
        { label: '闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯款嚙閹瑰爼鏌ｉ幋鐐嗘垿鎮?, value: steadyScenarioOption?.label ?? steadyScenarioId, tone: 'text-cyan-100' },
        { label: '闂備胶纭堕弲鐐测枍閿濆鍚归幖娣€楅悿鈧銈嗗姂閸婃洖顕?, value: selectedBaselineSnapshotSummary ? selectedBaselineSnapshotSummary.scenario_id : '闂備礁鎼悧婊勭椤忓牆鐒垫い鎺嗗亾妞わ附澹嗛埀?, tone: 'text-violet-100' },
        { label: '闂傚鍋勫ù鍌炲磻閸℃稑鐭楅幖娣妼閺嬩礁霉閸忓吋缍戞繛?, value: `${steadySnapshots.length} 闂備礁鎼ˇ浠嬪箺? tone: 'text-sky-100' },
    ]
    const simulationSignalCards = useMemo(() => {
        if (!steadyOverlay) {
            return [
                { label: '濠电偞鎸荤喊宥夋儎椤栨哎鈧帡宕奸弴鐘茬ウ闁诲骸婀辨慨浼村焵椤戣棄浜鹃梺?, percent: 0, tone: 'from-cyan-500 to-sky-500', text: '缂傚倷鐒︾粙鎴λ囬婊勵偨闁绘柨鎽滈々鐑芥偣閹帒濡介柛鈺佸€荤槐鎾存媴鐟欏嫬闉嶉梺? },
                { label: '缂傚倷鑳舵刊瀵告閺囩姷绀婂璺衡姇濞差亜鍙婇煫鍥ㄦ磵閺€顒勬煙?, percent: 0, tone: 'from-emerald-500 to-lime-500', text: '缂傚倷鐒︾粙鎴λ囬婊勵偨闁绘柨鎽滈々鐑芥偣閹帒濡介柛鈺佸€荤槐鎾存媴鐟欏嫬闉嶉梺? },
                { label: '濠碉紕鍋涢鍛存煀閿濆應鏋嶉柟鍓х帛閸婄粯銇勯幘璺轰粶妞?, percent: 0, tone: 'from-amber-500 to-red-500', text: '缂傚倷鐒︾粙鎴λ囬婊勵偨闁绘柨鎽滈々鐑芥偣閹帒濡介柛鈺佸€荤槐鎾存媴鐟欏嫬闉嶉梺? },
            ]
        }

        const supply = steadyOverlay.summary.total_supply
        const demand = steadyOverlay.summary.total_demand
        const balance = supply > 0 ? clamp01(1 - Math.abs(supply - demand) / Math.max(supply, demand, 1)) : 0
        const utilization = clamp01(steadyOverlay.summary.avg_utilization)
        const risk = clamp01(steadyOverlay.summary.alert_count / 8)

        return [
            {
                label: '濠电偞鎸荤喊宥夋儎椤栨哎鈧帡宕奸弴鐘茬ウ闁诲骸婀辨慨浼村焵椤戣棄浜鹃梺?,
                percent: Math.round(balance * 100),
                tone: 'from-cyan-500 to-sky-500',
                text: `濠电偞鎸荤喊宥囩矙閹捐泛鍨?${supply.toFixed(1)} / 闂傚倸鍊稿ú鐘诲磻閹惧瓨鍙?${demand.toFixed(1)}`,
            },
            {
                label: '缂傚倷鑳舵刊瀵告閺囩姷绀婂璺衡姇濞差亜鍙婇煫鍥ㄦ磵閺€顒勬煙?,
                percent: Math.round(utilization * 100),
                tone: 'from-emerald-500 to-lime-500',
                text: `婵°倗濮烽崑娑㈠疮閸噮鐒介幖娣妼缁€鍡涙煃閸濆嫬鏆為柡鍡楃箻閺?${steadyOverlay.summary.avg_utilization.toFixed(3)}`,
            },
            {
                label: '濠碉紕鍋涢鍛存煀閿濆應鏋嶉柟鍓х帛閸婄粯銇勯幘璺轰粶妞?,
                percent: Math.round(risk * 100),
                tone: 'from-amber-500 to-red-500',
                text: `闂備礁鎲＄粙鎴︽晝閵娾晩鏁嗛柣鏃傚帶閺?${steadyOverlay.summary.alert_count}`,
            },
        ]
    }, [steadyOverlay])
    const simulationNarrative = useMemo(() => {
        const title = `WE1 濠电偞鍨堕幑渚€顢欐繝鍕闁靛繈鍊栭崕鎴︽煟閺冨洦顏犻柡鍡楁閺岀喖鐓幓鎺戝Х缂?{steadyScenarioOption?.label ?? steadyScenarioId}闂備焦瀵х粙鎴ｆ
        if (!steadyOverlay) {
            return `${title}\n闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯挎珪娴溿倖淇婇婵嗗惞婵﹪绠栭弻锟犲醇濠垫劖啸闁诲酣娼ч張顒傜矉閹烘梹宕夐柕濠忕畱閻掑摜绱撻崒娆戝妽闁圭顭烽幃妯诲緞閹邦儵銉╂煕鐏炲墽绠ラ柛銈囧仱閺屾稖绠涢幘璺衡叢缂備浇顕х粔鍫曞箖閹殿喕娌柣鎾虫捣濡诧絾绻涚€电鞋婵炲娲栭敃銏ゆ晸閻樿櫕娅栭柣蹇曞仩濡嫰寮插▎鎾寸厽闁靛繈鍨归弸鎴︽煕閵婏箑鍝虹€殿噮鍓熷畷鎯邦槾闁圭晫鍠栭幃宄扳枎濞嗘垹袣濡炪倖娲戦崡铏繆鐎涙鈹?        }

        const status = SOLVER_STATUS_LABELS[steadyOverlay.solver_status]
        const summaryLine = `闂備礁鎼悧婊堝礈濮橀鏁?run_id=${steadyOverlay.run_id.slice(0, 12)}闂備焦瀵х粙鎴︽儔閸忓吋鍙忛柟闂寸缁?${status}闂備焦瀵х粙鎴﹀嫉椤掑嫬鐒垫い鎺戝枤閸炶櫣绱掗崜浣规毄缂?${steadyOverlay.summary.total_supply.toFixed(2)}闂備焦瀵х粙鎴﹀嫉椤掑嫬鐒垫い鎺嗗亾妞ゎ厼鍢查妴鎺旀崉閻?${steadyOverlay.summary.total_demand.toFixed(2)}闂備焦瀵х粙鎴︽嚐椤栫偞鐓㈤柍鍝勬噹闁裤倝鏌涢妷鎴濆暟閸旀挳姊哄ú缁樺▏闁告柨楠搁?${steadyOverlay.summary.avg_utilization.toFixed(3)}闂備焦瀵х粙鎴︽嚐椤栫偛绠熼柨娑樺婵即鏌ㄩ弮鍥撴繛?${steadyOverlay.summary.alert_count}闂備線娼уΛ鏃傛崲?        
        const criticalNodes = steadyOverlay.nodes.filter(n => n.alert_level === 'critical').map(n => topoNodes.find(tn => tn.id === (n as any).id)?.name || (n as any).id)
        const warningNodes = steadyOverlay.nodes.filter(n => n.alert_level === 'warning').map(n => topoNodes.find(tn => tn.id === (n as any).id)?.name || (n as any).id)
        const criticalEdges = steadyOverlay.edges.filter(e => e.alert_level === 'critical').map(e => topoEdges.find(te => te.id === (e as any).id)?.name || (e as any).id)
        
        let alertDetails = ''
        if (criticalNodes.length > 0) alertDetails += `濠电偞鍨堕幐鍫曞磿閻㈢闂柟闂寸瀹告繂鈹戦悩鍙夊闁告柨鎳橀弻銈夊传閸曨偀鍋撴繝姘；?Top5)闂?{criticalNodes.slice(0, 5).join('闂?)}闂備線娼уΛ鏃傛崲?        if (warningNodes.length > 0 && criticalNodes.length < 5) alertDetails += `濠碘槅鍋呭妯尖偓姘煎灦椤㈡鎮㈤崗鐓庢疅闂佺鏈划灞剧?Top5)闂?{warningNodes.slice(0, 5).join('闂?)}闂備線娼уΛ鏃傛崲?        if (criticalEdges.length > 0) alertDetails += `闂備礁鎼鍕矆娓氣偓婵＄敻宕堕妸锔挎唉闂佹悶鍎烘禍婵堢矈閹殿喚纾奸柣娆忔噽绾惧潡鏌?Top5)闂?{criticalEdges.slice(0, 5).join('闂?)}闂備線娼уΛ鏃傛崲?
        const coverageLine = `闂備礁鎼€氼剚鏅舵禒瀣︽慨妯挎硾閸欏﹪鏌ｅΟ鍨毢婵炲牊鎮傞弻娑樷槈濞嗗繒浜伴梺鐓庣仛閸ㄥ潡寮鍜佹僵闁告劕寮┑瀣厽?${coverageResultSummary.matchedNodeText}闂備焦瀵х粙鎴︽儗娴ｇ儤宕叉繛鎴炴皑濡?${coverageResultSummary.matchedEdgeText}闂備線娼уΛ鏃傛崲?        const compareLine = steadyComparison
            ? `闂備胶鍎甸弲婵嬧€﹂崼銉晪妞ゆ洍鍋撶€规洘妞介幖褰掓偡閻楀牏鏋冮梻浣瑰缁嬫帡鎯岄鐐偨闁汇垻鏁哥壕鍏肩箾閸℃绠查柍缁樻礋閺?${formatSignedNumber(steadyComparison.summary_delta.total_supply.delta, 2)}闂備焦瀵х粙鎴︽儗閸屾哎鈧帞鎹勯惄鎹洤纾兼慨姗嗗幐閺嬫瑩姊?${formatSignedNumber(steadyComparison.summary_delta.total_demand.delta, 2)}闂備焦瀵х粙鎴︽嚐椤栫偛鏄ラ柛鏇ㄥ灡閸嬨劑鏌曟繛褍鍟虫慨鐢告倵閻熸澘顥忛柛鐘崇墵閸┾偓?${formatSignedNumber(steadyComparison.summary_delta.avg_utilization.delta, 3)}闂備焦瀵х粙鎴︽嚐椤栫偛绠熼柨娑樺婵即鏌ㄩ弴妤€浜惧┑鈽嗗灠閿曨亜鐣?${formatSignedNumber(steadyComparison.summary_delta.alert_count.delta, 0)}闂備線娼уΛ鏃傛崲?            : '闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯款嚙鐎氬銇勮箛鎾跺闁稿鎸诲鍕偓锝庝憾娴犳挳姊虹化鏇熸珗婵炲拑缍佸畷鍨償閵堝洨鏉稿銈嗗姂閸婃洖顕ｆィ鍐╃叆婵炴垶蓱濠€鐗堢箾閸繄绠茬紒瀣槸椤撳ジ宕奸姀銏㈠€抽梻浣告啞閸ㄧ敻骞栭鈶界喐绻濋崶褏锛欓梺缁樻尭妤犳悂鎮楁繝姘厸閻庯綆鍋勬慨鍌炴煃?
        
        const actionLine = [alertDetails, `缂傚倸鍊烽懗鍫曞储瑜旈獮鍐╂償閵忊晜效闁瑰吋鐣崝宥夋偟閿曞倹鐓曢柟鍝勵儏閳ь剚娲熼幃鐐偅閸愨晜娅?{coverageResultSummary.riskSummary}`].filter(Boolean).join('\n')
        return [title, summaryLine, coverageLine, compareLine, actionLine].join('\n')
    }, [
        coverageResultSummary.matchedEdgeText,
        coverageResultSummary.matchedNodeText,
        coverageResultSummary.riskSummary,
        steadyComparison,
        steadyOverlay,
        steadyScenarioId,
        steadyScenarioOption?.label,
        topoNodes,
        topoEdges,
    ])
    const simulationNarrativePlain = useMemo(() => {
        if (!steadyOverlay) {
            return '闂佸搫顦弲婊嗘懌闂佹眹鍎遍幊妯侯嚕閸偄绶炲璺洪叄濞村矂姊哄ú璁崇敖闁哥姵鎸鹃崚鎺楀Ω閳轰礁鍤戝┑鐘欏啰姘ㄩ柛瀣崌瀹曟帒顫濋鈧妤呮⒑缂佹ê濮囬柛妯荤矒閸┾偓妞ゆ帊鑳堕惌搴ｇ磼鐠囪尙肖闁诡喗澹嗘禒锕傛偂鎼达絾袙濠电偛顕慨鎯р枖閺囩儑鑰块柨鐔哄Т閻忚櫕绻濋崹顐ｅ暗缂佲偓婢舵劖鐓曢柟閭﹀墰鑲栧┑鐘亾闁告侗鍠楁禍銈嗙箾閸℃绠查柛瀣ㄥ劦閺岋綁濡搁妷銉还濠殿喚鎳撻ˇ閬嶅箯閻樻祴鏀藉┑鐑囬檮鐢繝寮荤仦鍓х閹煎瓨鎸告禍?
        }
        const supply = steadyOverlay.summary.total_supply
        const demand = steadyOverlay.summary.total_demand
        const gap = supply - demand
        const utilization = steadyOverlay.summary.avg_utilization
        const status = SOLVER_STATUS_LABELS[steadyOverlay.solver_status]
        const compareSummary = steadyComparison
            ? `闂備胶鍎甸弲婵嬧€﹂崼銉晪妞ゆ洍鍋撶€规洘妞介幖褰掓偡閻楀牏鏋冮梻浣瑰缁嬫垶绺介弮鍌涱偨闁汇垻鏁哥壕鍏肩箾閸℃绠查柍缁樻礋閺?{formatSignedNumber(steadyComparison.summary_delta.total_supply.delta, 2)}闂備焦瀵х粙鎴︽儗閸屾哎鈧帞鎹勯惄鎹洤纾兼慨姗嗗幐閺嬫瑩姊?{formatSignedNumber(steadyComparison.summary_delta.total_demand.delta, 2)}闂備焦瀵х粙鎴︽嚐椤栫偛鏄ラ柛鏇ㄥ灡閸嬨劑鏌曟繛褍鍟虫慨鐢告倵閻熸澘顥忛柛鐘崇墵閸┾偓?{formatSignedNumber(steadyComparison.summary_delta.avg_utilization.delta, 3)}闂備線娼уΛ鏃傛崲?            : '闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯荤ゴ閺岋箓鏌嶉埡浣告殲缂佺姵甯″娲敃閵忊晜笑闂佺粯鏌￠崑鎾剁磽娴ｇ懓鍔ら柣蹇旂箞楠炴捇鍩￠崨顔间簵閻熸粍绻勫Σ鎰攽鐎ｎ亞顓奸梺閫炲苯澧紒鍌涘浮婵＄兘濡烽妷銉ョ船缂傚倸鍊烽悞锕傛偡閵夆晛鍚规い鎾卞灩鐎氬銇勯幒宥囪窗闁稿瑪鍛＝濞达絽婀辩粻鎾淬亜閺囥劌鏋ょ紒杈ㄥ浮楠炴鈧敻鏅查崙浠嬫⒑?
        const suggestion = buildOpsSuggestion(steadyOverlay.summary.alert_count, utilization, steadyOverlay.solver_status)
        return [
            `闂佸搫顦弲婊堟偡閿曞偆鏁冨┑鍌滎焾閹瑰爼鏌ｉ幋鐐嗘垿鎮甸鐐寸厸闁告洟娼ч悘娆撴煃?{steadyScenarioOption?.label ?? steadyScenarioId}闂備胶鍋ㄩ崕鑼崲閹邦喗顫曟繝闈涙煀瑜斿畷鎺戭熆椤掍礁娴柟顔规櫊閹虫粎鍠婂Ο杞板婵炶揪缍€椤鐟ч梻?{status}闂備胶鍋ㄩ崕鑼紦閸ф鐒垫い鎴ｆ硶缁?
            `缂傚倷绶￠崹闈涚暦閻㈤潧鍨濋柣鎴烆焽閻熻绻涢幋鐐寸殤闁?{supply.toFixed(2)}闂備焦瀵х粙鎴︽儗閸屾哎鈧帞鎹勯惄?{demand.toFixed(2)}闂備焦瀵х粙鎴︽嚐椤栨鐔哥節閸パ咃紮?{formatSignedNumber(gap, 2)}闂備焦瀵х粙鎴︽嚐椤栫偞鐓㈤柍鍝勬噹闁裤倝鏌涢妷鎴濆暟閸旀挳姊哄ú缁樺▏闁告柨楠搁?{utilization.toFixed(3)}闂備焦瀵х粙鎴︽嚐椤栫偛绠熼柨娑樺婵?{steadyOverlay.summary.alert_count}濠电偞鍨堕幖鈺傜濡ゅ懎鐒垫い鎴ｆ硶缁?
            `闂備礁鎼€氼喗鎱ㄩ幘顔藉剭闁绘顕у婵嬫煙鐎涙ê绗╅柛姗嗗墴閺岀喖顢涘顓炴闂佸摜濮撮惌鍌炲极瀹ュ拋娼╅柛鎰棘濠靛鐓?{coverageResultSummary.matchedNodeText}闂備焦瀵х粙鎴︽儗娴ｇ儤宕叉繛鎴炴皑濡?{coverageResultSummary.matchedEdgeText}闂備線娼уΛ鏃傛崲?
            compareSummary,
            `闁诲海鍋ｉ崐婵堢磽濮橀鏁婇柛娑欐綑缁€澶愭煏婵炲灝鈧绮欐繝鍥ㄧ叆?{suggestion}`,
        ].join('\n')
    }, [
        coverageResultSummary.matchedEdgeText,
        coverageResultSummary.matchedNodeText,
        steadyComparison,
        steadyOverlay,
        steadyScenarioId,
        steadyScenarioOption?.label,
    ])
    const simulationStructuredBrief = useMemo(() => {
        if (!steadyOverlay) {
            return {
                pilot: WE1_PRIMARY_PILOT_ID,
                scenario_id: steadyScenarioId,
                status: 'idle',
                message: 'no_result',
            }
        }
        const gap = steadyOverlay.summary.total_supply - steadyOverlay.summary.total_demand
        return {
            pilot: WE1_PRIMARY_PILOT_ID,
            scenario_id: steadyOverlay.scenario_id,
            run_id: steadyOverlay.run_id,
            solver_status: steadyOverlay.solver_status,
            summary: {
                total_supply: Number(steadyOverlay.summary.total_supply.toFixed(3)),
                total_demand: Number(steadyOverlay.summary.total_demand.toFixed(3)),
                gap: Number(gap.toFixed(3)),
                avg_utilization: Number(steadyOverlay.summary.avg_utilization.toFixed(4)),
                alert_count: steadyOverlay.summary.alert_count,
            },
            coverage: {
                matched_nodes: coverageResultSummary.matchedNodeText,
                matched_edges: coverageResultSummary.matchedEdgeText,
                readiness: coverageResultSummary.readinessLabel,
            },
            baseline_delta: steadyComparison ? {
                total_supply: Number(steadyComparison.summary_delta.total_supply.delta.toFixed(3)),
                total_demand: Number(steadyComparison.summary_delta.total_demand.delta.toFixed(3)),
                avg_utilization: Number(steadyComparison.summary_delta.avg_utilization.delta.toFixed(4)),
                alert_count: steadyComparison.summary_delta.alert_count.delta,
            } : null,
            recommendation: buildOpsSuggestion(
                steadyOverlay.summary.alert_count,
                steadyOverlay.summary.avg_utilization,
                steadyOverlay.solver_status,
            ),
            generated_at: new Date().toISOString(),
        }
    }, [
        coverageResultSummary.matchedEdgeText,
        coverageResultSummary.matchedNodeText,
        coverageResultSummary.readinessLabel,
        steadyComparison,
        steadyOverlay,
        steadyScenarioId,
    ])
    const simulationRunTimeline = useMemo(() => {
        const stage = steadySimLoading
            ? 'running'
            : steadyOverlay?.solver_status === 'converged'
                ? 'done'
                : steadyOverlay?.solver_status === 'max_iter'
                    ? 'warn'
                    : steadyOverlay?.solver_status === 'error'
                        ? 'error'
                        : 'idle'
        return [
            { key: 'load', label: '闂備礁鎲″缁樻叏閹灐褰掑炊椤掆偓閹瑰爼鏌ｉ幋鐐嗘垿鎮?, active: stage !== 'idle' },
            { key: 'solve', label: '婵犳鍠氶幊鎾诲磹閸婄噥鏆伴梺鑽ゅС缁躲倗妲愰弴銏″仼?, active: ['running', 'done', 'warn', 'error'].includes(stage), pulse: stage === 'running' },
            { key: 'overlay', label: '闂備礁鎲￠悷褎鎱ㄧ€涙ɑ鍙忛柣鎰湴閳ь剚甯″畷锝嗗緞鐏炶棄鑴?, active: ['done', 'warn'].includes(stage) },
            { key: 'ai', label: '闂備礁鎲￠懝楣冨嫉椤掑嫷鏁嗘繝娈挎箟', active: stage !== 'idle' && stage !== 'running' },
        ]
    }, [steadyOverlay?.solver_status, steadySimLoading])`r`n    useEffect(() => {
        const cutoffContext: Record<string, any> = {}
        if (cutoffResult) {
            cutoffContext.we1_cutoff_node_id = cutoffNodeId || ''
            cutoffContext.we1_cutoff_supply_lost_nodes = cutoffResult.affectedNodes.filter(n => n.status === 'supply_lost').map(n => n.name || n.id).join(', ') || '闂?
            cutoffContext.we1_cutoff_rerouted_nodes = cutoffResult.affectedNodes.filter(n => n.status === 'rerouted').map(n => n.name || n.id).join(', ') || '闂?
        }

        setAssistantRuntimeContext({
            selection: {
                we1_simulation_narrative: simulationNarrative,
                we1_simulation_narrative_plain: simulationNarrativePlain,
                we1_simulation_structured_brief: simulationStructuredBrief,
                we1_scenario_id: steadyScenarioId,
                we1_run_id: steadyOverlay?.run_id ?? '',
                we1_solver_status: steadyOverlay?.solver_status ?? 'idle',
                ...cutoffContext
            },
            filters: {
                we1_baseline_run_id: steadyBaselineSnapshotRunId,
                we1_selected_snapshot_run_id: steadySelectedSnapshotRunId,
            },
        })
    }, [
        simulationNarrative,
        simulationNarrativePlain,
        simulationStructuredBrief,
        steadyBaselineSnapshotRunId,
        steadyOverlay?.run_id,
        steadyOverlay?.solver_status,
        steadyScenarioId,
        steadySelectedSnapshotRunId,
        cutoffResult,
        cutoffNodeId
    ])
    const demoGuideSteps = useMemo(() => {
        return [
            `1. 闂備胶顭堢换鎰版偋閸℃鑰挎い蹇撶墕閹瑰爼鏌ｉ幋鐐嗘垿鎮甸姘ｆ闁圭偓鍓氶崕鎰攽椤栨稒銇濋柡灞借嫰閻ｆ繈宕熼妸銉ゅ?${recommendedCoverageScenario?.label ?? '闂佹眹鍩勯崹閬嶆偤閺囶澁缍栧璺虹灱閻瑩鏌ц箛锝呬簮闁?}闂備線娼уΛ鏃傛崲?
            '2. 闂備胶绮崝鏇㈠储濠婂牆鐒垫い鎺嶈兌閻海绱掔拠鑼ら柟顔藉娴狅妇绱掗姀鐘参楅柣搴㈩問閸犳牜鎹㈢€ｎ剚瀵柕蹇嬪€栭崕鎴︽煟閺冣偓缁佹挳宕戦幘鏂ユ斀闁规儳澧庨ˇ顔剧磼缂併垹寮鹃柛鐘崇洴椤㈡绱掑Ο璁虫唉闂佸綊鍋婇崹濂稿绩閻ｅ瞼纾藉ù锝堫潐鐏忎即鏌ｈ箛鎿冩█妤犵偞顨呰灒婵炲棛鍋撻惌妤呮⒒娴ｇ懓绲婚柤娲诲灦瀹曠敻顢橀姀鈥充虎?run_id闂備線娼уΛ鏃堟嚄閸洖鏋侀柟鎹愵嚙缁狅綁鏌熼柇锕€骞楁い蟻鍥ㄢ拻闁稿本绋掔紞鎴︽煙闁垮绶查弫鍫ユ煕鐏炲墽娓ら柟鐑橆殕閸嬫劙鏌ら崫銉毌闁稿鎸婚幏鍛枈濡桨澹?,
            '3. 闂備胶绮崝鏇㈠储濠婂牆鐒垫い鎺嶈兌閻棛绱掔紒妯荤殤闁逞屽墯缁嬫帡鏁嬮梺鍦劦閺呯娀骞冮檱椤︻噣鏌嶈閸撴氨鎹㈤幇顔筋潟婵犻潧顑呯粻顔尖攽閻樺弶鍣界紒鐘侯潐缁绘盯宕遍鐘碉紵缂備緡鍠撻崝鎴濐嚕缁嬫鐓ラ柛娑卞枟閻ｎ剙鈹戦埄鍐炬缂傚秴娲ㄥΣ鎰綇閵娿倗绠氶梺绋挎湰缁嬫挻绂嶉鐐村仭闁哄洦纰嶇粊鐗堛亜閺傛妲告い鏇秮瀹曟帒顫濋崡鐐靛幀闂備焦瀵х粙鎴︽儗娓氣偓椤㈡瑩宕惰閸ゆ淇婇妶鍌氫壕闂佸憡蓱閻╊垶寮婚崨顔肩窞濠㈣泛鐭堟导鍥⒑閸濆嫷妲撮柍褜鍓欑壕顓㈠船閵娧呯＜闁诡垎鍛檸闂佸湱鍎甸弲鐘诲箖闄囬ˇ浼存煃?,
            '4. 闂備焦妞挎禍婊堫敄閸岀偛鐒垫い鎺嶈兌閻﹪鏌ｉ弬鍝勪壕缂傚倷鐒﹂崕鎶芥倶濠靛鏁嬫い鏂裤仚閹烘妫橀悶娑掆偓鍏呭濠电娀娼уΛ娆戔偓姘叀閺屽秹濡烽敂鍓х厔濡炪倐鏅╅崑濠囧箚閸曨垰鍐€妞ゆ劑鍊栫亸婵嬫⒑閸濆嫷鍎愮紒顔肩Ф缁晜绻濆顒傤攨闂佸搫娲﹂妵娑㈠磻閹炬枼鏀介柟鎯у椤︻喚绱掔紒銏犲季闁哥姵鐩、妯兼嫚瀹割喖鏅犲銈嗘煥閻ㄧ兘宕戦幘鍓佺當閻炴稈鈧厖澹曟繛杈剧悼閻℃柨煤椤掑嫭鐓熼柍鍝勫€绘晶鍗炩攽椤旇姤鍊愭鐐╁亾婵炶揪绲介幉锛勨偓姘叀閺岋繝宕煎顑垮闂佸搫顦弲婊堝垂瑜版帒姹查柍褜鍓氭穱濠偽旂€ｎ剛蓱濠碉紕鍋涢崐鍨潖鐠囩潿搴敄閽樺澹?,
            `5. 濠电姷顣介埀顒€鍟块埀顒€缍婇幃妯诲緞閹邦厼浠㈤梺鍝勵槹鐎笛呰姳濮樿埖鐓曢柟瀵稿仦閵囨繃淇婇銉ョ厫闁挎稒鍔曢～婊堝醇閵忋埄妲烽梻浣侯焾缁绘劙鎮ф繝鍕ㄥ亾閸偆鐭掗柛?{failureInvestigationLayerLabel}闂備胶鍋ㄩ崕鑼崲閸℃瑦宕查柡宥庡幖缁狙囨煥濞戞ê顏╂繛鍫㈠Х閳ь剙鐏氭竟瀣磻閹炬枼妲堥柟鐐墯閸庢劙鏌ｉ幙鍕瘈濠碘€崇摠缁?
        ]
    }, [failureInvestigationLayerLabel, recommendedCoverageScenario?.label])`r`n`r`n    // ================== 婵犵數鍋為幐绋款嚕閸洘鍋?==================
    // NOTE: 濠电偞鍨堕幐鍝ョ矓瀹曞洦顫?pipelineData 缂?MapView闂備焦瀵х粙鎴︽儗娴ｇ儤宕查柡宥庡幖閸愨偓閻庣懓瀚晶妤呭礋妤ｅ啯鐓曢柕澶堝劚缂嶆牜绱掑Δ鈧崐鍨暦閿濆鏁傞柛娑卞枤閻ｆ娊鏌熼悡搴ｆ憼婵炲弶鐗曢湁婵せ鍋撻柡浣哥Ф娴狅箓宕滆閳锋洟姊洪崫鍕妞わ富鍣ｉ獮鎴﹀閳╁啫顎撻梺鍝勬川婵柉銇愰弻銉︾厱?缂傚倷鑳舵刊瀵告閺囥垹鍚归幖缁版壋鍋撻幒妤€鐭楀璺鸿嫰鐢?    const openTopologyShowcase = useCallback(() => {
        writeSimulationShowcaseSyncContext({
            source: 'map-topology',
            pilotId: WE1_PRIMARY_PILOT_ID,
            scenarioId: steadyOverlay?.scenario_id ?? steadyScenarioId,
            selectedSnapshotRunId: steadySelectedSnapshotRunId,
            baselineSnapshotRunId: steadyBaselineSnapshotRunId,
            overlay: steadyOverlay,
            updatedAt: new Date().toISOString(),
        })
        setStatusMsg('闁诲骸婀遍…鍫濐嚕閼稿吀绻嗘慨婵嗚娴滃綊鏌熼幆褍鏆辨い銈呮噹閳藉骞樼拠鈥虫暯闁荤姷鍋戦崹浠嬪箚閸ヮ剚鍋勯柛鎾茶兌閹差亝绻涢幋鐐村碍妞ゆ垵妫濆鎼佸礃椤忓懏娈伴梺鎸庢磵閸嬫捇鏌涢埡浣虹伇缂侇噮鍙冮、鏍崉閵娧勫暔闁诲孩顔栭崰姘叏閺夋嚚鐟拔熼梻瀛樺媰闂佸搫娲ㄦ慨鐗堢濞戞﹩娓?)
        navigate('/topology')
    }, [
        navigate,
        steadyBaselineSnapshotRunId,
        steadyOverlay,
        steadyScenarioId,
        steadySelectedSnapshotRunId,
    ])

    const emergencyVignetteActive = isBreakScenarioActive && Boolean(steadyOverlay)

    return (
        <div className="h-screen w-screen overflow-hidden relative bg-[#101922]">
            <style>{`
                .we1-fault-ripple {
                    position: absolute;
                    width: var(--ripple-size, 22px);
                    height: var(--ripple-size, 22px);
                    border-radius: 50%;
                    border: 2px solid var(--ripple-color, #f87171);
                    opacity: 0.8;
                    transform: scale(0.72);
                    animation: we1-ripple 1.4s ease-out infinite;
                }
                .we1-damage-pop {
                    position: absolute;
                    top: -16px;
                    white-space: nowrap;
                    color: #fca5a5;
                    font-size: 10px;
                    font-weight: 700;
                    text-shadow: 0 1px 2px #000;
                    animation: we1-damage-pop 1.8s ease-out forwards;
                }
                @keyframes we1-ripple {
                    0% { transform: scale(0.72); opacity: 0.85; }
                    100% { transform: scale(1.55); opacity: 0; }
                }
                @keyframes we1-damage-pop {
                    0% { transform: translateY(0); opacity: 0.95; }
                    100% { transform: translateY(-20px); opacity: 0; }
                }
                @keyframes we1-vignette-breathe {
                    0%, 100% { opacity: 0.22; }
                    50% { opacity: 0.48; }
                }
            `}</style>
            {emergencyVignetteActive && (
                <div
                    className="pointer-events-none absolute inset-0 z-10"
                    style={{
                        background: 'radial-gradient(circle at center, rgba(239,68,68,0) 62%, rgba(239,68,68,0.28) 100%)',
                        animation: 'we1-vignette-breathe 2.8s ease-in-out infinite',
                    }}
                />
            )}
            {/* 闂備礁鎼粔鏉懨洪顫偓鍌涚鐎ｎ亜鍞?*/}
            <div className="absolute top-0 left-0 right-0 z-30 bg-[#0c1218]/90 backdrop-blur-md border-b border-cyan-500/30">
                <div className="px-6 py-3 flex justify-between items-center">
                    <div>
                        <h1 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-xl text-cyan-400">conversion_path</span>
                            SmartGas 闁?WE1 缂傚倷鐒﹂〃蹇涘礂濞戞氨鍗氶柡澶嬪焾閸ゆ洟鏌ｅΟ鍝勭骇缂佸倸鐗嗛埥澶愬箻鐠団€虫暯闁荤姷鍋戦崹浠嬪箚?                        </h1>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                            闂備胶鍘ч幖顐﹀磹婵犳艾纾?<b className="text-cyan-400">{stats.nodes}</b> 闁?闂佸搫顦弲婵嬪磻閻旂厧鍚?<b className="text-green-400">{stats.edges}</b> 闁?闂佽瀛╃粙蹇涘磹濡ゅ懎纾?<b className="text-red-400">{stats.isolated}</b> 闁?{steadyOverlayStatusText}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={openTopologyShowcase}
                            className="px-3 py-1.5 border border-cyan-500/30 bg-cyan-950/30 hover:bg-cyan-900/40 text-cyan-100 text-xs rounded-lg transition-colors flex items-center gap-1"
                        >
                            <span className="material-symbols-outlined text-sm">monitoring</span>缂傚倷鐒﹂〃蹇涘礂濞戞氨绠斿ù锝呭閸ゆ洟鏌ｅΟ鍝勭骇缂佸倸鐗撻幃姗€鎮欑€涙顦梺?                        </button>
                        <button
                            onClick={() => setActiveTab('simulation')}
                            className="px-3 py-1.5 border border-cyan-500/30 bg-cyan-900/30 hover:bg-cyan-800/40 text-cyan-100 text-xs rounded-lg transition-colors flex items-center gap-1"
                        >
                            <span className="material-symbols-outlined text-sm">science</span>濠电偞鍨堕幑渚€顢欐繝鍕闁靛繈鍊栭崕?                        </button>
                        <button
                            onClick={async () => {
                                setActiveTab('simulation')
                                try {
                                    await runSteadySimulationWithPreset()
                                    setStatusMsg(`WE1 濠电偞鍨堕幑渚€顢欐繝鍕闁靛繈鍊栭崕鎴︽煟閺傚灝妲婚柛銈嗗浮瀵爼鍩￠崒姘潙濡炪們鍨洪崹鍧楀极?{steadyScenarioOption?.label ?? steadyScenarioId}`)
                                } catch (error) {
                                    setStatusMsg(error instanceof Error ? error.message : 'WE1 濠电偞鍨堕幑渚€顢欐繝鍕闁靛繈鍊栭崕鎴︽煟閺冨洤鍚圭紒鐘劦閹泛鈽夊Ο鍨伃闂侀潧娲﹂崹褰掑箯?)
                                }
                            }}
                            disabled={steadySimLoading}
                            className="px-3 py-1.5 bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40"
                        >
                            <span className="material-symbols-outlined text-sm">play_arrow</span>{steadySimLoading ? '闂佸搫顦弲婊堝礉濮椻偓閵嗕線骞嬮悙纰樻灃?..' : '闂佸搫顦弲婊堝礉濮椻偓閵嗕線骞嬮悙纰樻灃闁荤姳绀侀悿鍥⒖瑜版帗鐓?}
                        </button>
                        {steadyOverlay && (
                            <button
                                onClick={() => {
                                    clearSteadyOverlay()
                                    clearSimulationShowcaseSyncContext()
                                    setStatusMsg('闁诲骸婀遍…鍫濐嚕閸撲胶鍗氶柤濮愬€楅惌姘舵煕濠靛棗顏紒澶娿偢閺屾盯骞樺畷鍥嗭繝鎮楅棃娑欐拱缂佸倹甯為幑鍕Ω閿曗偓閻掑摜绱撻崒娆戝妽闁圭顭烽幃?)
                                }}
                                className="px-3 py-1.5 border border-slate-600 bg-slate-800/70 hover:bg-slate-700/80 text-slate-200 text-xs rounded-lg transition-colors flex items-center gap-1"
                            >
                                <span className="material-symbols-outlined text-sm">layers_clear</span>婵犵數鍋為幐鎼佸箠閹版澘鐓橀柡宥冨妿閳绘棃鎮规担鍝ユ瀮闂傚棗缍婇弻?                            </button>
                        )}
                        <button onClick={importTopology} className="px-3 py-1.5 bg-purple-600/80 hover:bg-purple-500 text-white text-xs rounded-lg transition-colors flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">download</span>闂佽娴烽弫鎼佸储瑜斿畷锝夊幢濞戞顔嗛梺鍦亾濞兼瑩鍩?                        </button>
                        <button onClick={runValidation} disabled={topoNodes.length === 0} className="px-3 py-1.5 bg-cyan-600/80 hover:bg-cyan-500 text-white text-xs rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40">
                            <span className="material-symbols-outlined text-sm">verified</span>濠德板€楁慨鎾儗娓氣偓閹?                        </button>
                        <button onClick={runCentrality} disabled={topoNodes.length < 3} className="px-3 py-1.5 bg-amber-600/80 hover:bg-amber-500 text-white text-xs rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40">
                            <span className="material-symbols-outlined text-sm">stars</span>闂備胶顭堢换鎴炵箾婵犲洤鏋佹い鎾卞灪閸ゅ秹鏌涚仦鍓х煀濞?                        </button>
                    </div>
                </div>
            </div>

            {/* 缂傚倷鑳堕搹搴ㄥ垂閹殿喛濮抽柟鎯版閻?闂備胶鍋ㄩ崕鏌ュ蓟閿熺姴鐒?濠电偞鍨堕幐鍝ョ矓瀹曞洦顫?pipelineData闂備焦瀵х粙鎴炵附閺冨倻绠斿璺侯焾閳ь剚甯″畷锝嗗緞鐏炶棄鑴┑鐐差嚟婵箖顢欐繝鍕鐎广儱娲ㄩ崡姘箾閸℃绠茬紒?闂傚倸鍊搁崯鐘诲磻閹剧粯鍊?*/}
            <MapView
                config={{
                    viewMode: '2D',
                    showProvinceLabels: false,
                    showDistrictLayer: false,
                    showScale: false,
                    showCompass: false,
                    maxRenderNodes: 900,
                    maxRenderLines: 1400,
                }}
                onLoad={handleMapLoad}
            />

            {/* 闁诲骸缍婂鑽ょ磽濮樿泛鐤鹃柛顐ｆ礃椤ュ牓鏌曡箛濠傚⒉缂?*/}
            <div className="absolute top-[68px] left-4 bottom-4 z-20 w-72 flex flex-col">
                <div className="bg-[#0c1218]/95 backdrop-blur-md rounded-xl border border-cyan-500/20 shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 90px)' }}>
                    {/* 闂備礁鎼粔鏉懨洪妸鈺婃晢闂佸灝顑冩禍婊堟⒒閸喓鈼ゅù?*/}
                    <div className="flex border-b border-gray-700/40 shrink-0">
                        {([
                            { id: 'edit' as PanelTab, label: '缂傚倸鍊搁崐褰掓偋閻愬灚顐?, icon: 'edit' },
                            { id: 'validate' as PanelTab, label: '濠德板€楁慨鎾儗娓氣偓閹?, icon: 'verified' },
                            { id: 'search' as PanelTab, label: '闂備胶鎳撻崥瀣垝鎼淬劌纾?, icon: 'search' },
                            { id: 'centrality' as PanelTab, label: '闂備礁鎼鍐垂婵犳碍鍤?, icon: 'stars' },
                            { id: 'cutoff' as PanelTab, label: '闂備浇顫夐幆灞剧濠靛钃?, icon: 'cut' },
                            { id: 'simulation' as PanelTab, label: '濠电偛顕慨鎯р枖閺囩儑鑰?, icon: 'science' },
                        ]).map(tab => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 py-2.5 text-[11px] flex items-center justify-center gap-1 transition-all border-b-2
                                    ${activeTab === tab.id ? 'text-cyan-400 border-cyan-500 bg-cyan-500/5' : 'text-gray-500 border-transparent hover:text-gray-300'}`}>
                                <span className="material-symbols-outlined text-sm">{tab.icon}</span>{tab.label}
                            </button>
                        ))}
                    </div>

                    {/* 闂傚倸鍊搁悧鍕垂閸濆嫷鐔嗘慨妞诲亾鐎规洘锕㈠畷銊╊敇瑜嶉弲?*/}
                    <div className="flex-1 overflow-y-auto p-3">
                        {/* 缂傚倸鍊搁崐褰掓偋閻愬灚顐?*/}
                        {activeTab === 'edit' && (
                            <div className="space-y-3">
                                <div>
                                    <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wider">闂備胶鎳撻悘婵堢矓瀹曞洨绀婇柡鍌濐嚦閻旂厧鐏崇€规洖娲ㄩ、?/p>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {([
                                            { m: 'view' as EditMode, label: '婵犵數鍋炲娆戞崲濡ゅ拑缍?, icon: 'pan_tool' },
                                            { m: 'draw-point' as EditMode, label: '婵犵數鍎戠紞鈧€规洜鏁诲畷?, icon: 'add_location' },
                                            { m: 'connect' as EditMode, label: '闂佸搫顦弲婵嬪磻閻旂厧鍚?, icon: 'timeline' },
                                        ]).map(item => (
                                            <button key={item.m} onClick={() => setEditMode(item.m)}
                                                className={`py-2 rounded-lg text-[11px] transition-all flex flex-col items-center gap-0.5
                                                    ${editMode === item.m ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20' : 'bg-gray-800/60 text-gray-400 hover:bg-gray-700'}`}>
                                                <span className="material-symbols-outlined text-base">{item.icon}</span>{item.label}
                                            </button>
                                        ))}
                                    </div>
                                    {manualJunctionEditingEnabled && (
                                        <button
                                            onClick={() => setEditMode('merge')}
                                            className={`mt-2 w-full py-2 rounded-lg text-[11px] transition-all flex items-center justify-center gap-1.5
                                                ${editMode === 'merge' ? 'bg-purple-700/80 text-white' : 'bg-purple-900/40 text-purple-200 hover:bg-purple-800/50'}`}
                                        >
                                            <span className="material-symbols-outlined text-sm">hub</span>
                                            闂備胶顭堢换鎺楀储瑜旈、娆撳箛閺夎法顓奸柣搴秵娴滄瑧妲愰敐澶嬬厵闁荤喐澹嗙粻浼存煙椤斿ジ鍙勯柡浣哥Ч瀹曞ジ鎮㈤棃鈺冪婵犵數鍋熺换婵嬫嚄閸洖鐓濆┑鍌氭啞閺?                                        </button>
                                    )}
                                </div>

                                <div className="border border-sky-500/20 bg-sky-950/20 rounded-lg p-2.5 space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="text-[10px] text-sky-300 uppercase tracking-wider">闂佸搫顦弲婊堝礉濮椻偓閵嗕線骞嬮敃鈧猾宥夋煠閸濄儲鏆╁ù婊嗗亹缁?/p>
                                        <span className="text-[10px] text-sky-400">
                                            {JUNCTION_MODE_LABELS[junctionMode] || junctionMode}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-300 leading-5">{JUNCTION_READONLY_HINT}</p>
                                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                                        <div className="rounded bg-white/5 px-2 py-2">
                                            <div className="text-gray-500">闂備礁鎼鍐垂婵犳碍鍤嬫い蹇撶墕閺?/div>
                                            <div className="mt-1 text-white font-medium">{junctionGroups.length}</div>
                                        </div>
                                        <div className="rounded bg-white/5 px-2 py-2">
                                            <div className="text-gray-500">濠电姰鍨归悥銏ゅ礋椤撴繃婢€缂?/div>
                                            <div className="mt-1 text-white font-medium">
                                                {junctionGroups.filter(group => group.junction_kind === 'major_junction').length}
                                            </div>
                                        </div>
                                        <div className="rounded bg-white/5 px-2 py-2">
                                            <div className="text-gray-500">闂佽崵鍠愬ú鏍涘☉妯忕儤绻濋崟顓炲触濠电偛妫欓崹鍨?/div>
                                            <div className="mt-1 text-white font-medium">
                                                {junctionGroups.reduce((sum, group) => sum + (group.member_count ?? group.station_ids.length ?? 0), 0)}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {editMode === 'draw-point' && (
                                    <div>
                                        <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wider">闂備胶鍘ч幖顐﹀磹婵犳艾纾婚柨婵嗘川鐏忕敻鎮归崶顏勭毢闁?/p>
                                        <div className="grid grid-cols-2 gap-1.5">
                                            {(Object.keys(TOPO_LABELS) as PointType[]).map(key => (
                                                <button key={key} onClick={() => setPointType(key)}
                                                    className={`py-2 px-2 rounded-lg text-xs flex items-center gap-1.5 transition-all
                                                        ${pointType === key ? 'ring-1 ring-cyan-500 bg-gray-700 text-white' : 'bg-gray-800/40 text-gray-400 hover:bg-gray-700/60'}`}>
                                                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: TOPO_COLORS[key] }} />
                                                    {TOPO_LABELS[key]}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {editMode === 'merge' && (
                                    <div className="border border-purple-500/20 bg-purple-950/20 rounded-lg p-2.5 space-y-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-[10px] text-purple-300 uppercase tracking-wider">闂備礁缍婂褔顢栭崨顔碱嚤闁圭増婢樼粻鏌ョ叓閸ャ劍灏伴柛?/p>
                                            <span className="text-[10px] text-purple-400">闁诲海鎳撻幉锟犳偂閿熺姴鐒?{selectedMergeNodeIds.length} 缂?/span>
                                        </div>
                                        <p className="text-xs text-gray-300 leading-5">
                                            闂佸搫顦弲婊堟偡閵夈儺鐒介柨鐔哄Т閸欏﹥銇勯弽銊ф噭闁告瑥绻戦幈銊モ攽閹捐泛鍩岄梺鍛婄懃濡繂鐣烽敐澶嬫櫜闁告劧绲芥禍楣冩煕鐏炲墽鐭婂ù鐙€鍨堕弻娑㈡晜閼恒儳鍑″┑鐐茬摠钃辩紒瀣槹缁绘繈宕熼鍌涙闂佸湱鍘ч悺銊ッ洪弽顓熷剳闁规鍠氶崡姘箾閸℃ê鐏ュù鐙€鍨堕弻銊モ槈濡粯鎷辨繝纰樺墲閹倸螞娓氣偓閸┾偓妞ゆ帒鍊归崯鍝劽归敐鍛喐缂佸妞介弻鐔衡偓娑櫭慨鍥煙椤旇姤灏扮紒瀣樀閸┾偓妞ゆ帊鑳堕埢鏃€銇勮箛鎾村櫧濞存粏鍋愮槐鎺楀礈瑜庡▍鏇熺箾閸喎鐏╃紒顔规櫅閳诲酣骞橀姘婵犮垼娉涢敃銈呅掓径鎰厸濠㈣泛鐗嗛崝鐢电磼鏉堛劎绠炵€规洘锚椤撳ジ宕ㄩ鐘辩敾闁诲海鍋ｉ崐婵堢磽濮樿翰鈧懘顢曢敂钘夊壆闂佸搫璇為崨顔煎瑎闂?                                            闂佸搫顦弲婊堝礉濮椻偓閵嗕線骞嬮敃鈧猾宥夋煕椤愶絾绀€婵炲懌鍨荤槐鎾诲磼濞戞艾鈷堢紓渚囧枔閸旀垵顕ｇ粙娆剧叆闁告侗鍠栭悡鏇犵磽閸屾瑧璐伴柛妯挎缁辩偤寮埀顒傜矙婢舵劕浼犻柛鏇ㄥ幒娴溿垽鏌熼悡搴㈡嵍鐎广儱娲ㄩˇ顕€姊鸿ぐ鎺撴锭妞ゆ垵鎳忕€靛ジ骞囬弶璺唹闂婎偄娲﹂幐濠氬磹閵堝鐓曟繛鍡樏煎ù閿嬨亜閳哄﹤浜伴柟顖氬瀵粙鏁傞崜褉妲堥梻浣告惈鐎氼剙霉閻戣棄鐏虫慨妞诲亾闁哄苯鎳忓鍕緞鎼粹€崇畱闂備焦鐪归崝宀€鈧凹鍣ｉ幃鐢割敍閻愭潙鈧攱顨ラ悙鑼皑闁?                                        </p>
                                        <input
                                            value={mergeJunctionName}
                                            onChange={e => setMergeJunctionName(e.target.value)}
                                            placeholder={selectedMergeAutoName || '缂傚倸鍊烽悞锕傛偡閵娧勫床闁哄诞鈧弸搴ㄦ煃閳轰礁鏆欐い銈勮兌閳ь剝顫夐幃鍫曞磿閹绘帞鏆︽俊銈呮噹鐟欙箓鏌涢顒傜ɑ鐎规洖鍟块埥澶愬箼閸愌呯泿闂佽鍠楀ú婊堝焵?}
                                            className="w-full rounded-lg border border-purple-500/20 bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-purple-400"
                                        />
                                        <textarea
                                            value={mergeJunctionDescription}
                                            onChange={e => setMergeJunctionDescription(e.target.value)}
                                            placeholder="闂備礁鎲￠悷顖炲垂閸洖鐒垫い鎺嗗亾妞ぱ€鍋撶紓浣稿綁閸楀啿鐣峰Ο琛℃瀻閹艰揪绲块幉顔界箾閿濆懏绁╅柛鐘愁殜椤㈡顭ㄩ崼婵嗗亶闂佺粯妫冮弨杈╃矆閸儲鐓ユ繛鎴烆焾鐎氫即鏌熼绛嬫疁婵☆偄鍟存慨鈧柣娆屽亾婵℃彃顭烽弻锝夊煛閸嬪灚鍨电叅閻犳亽鍔夐崑鎾舵兜閸滀焦缍堝┑鈥冲级椤ㄥ﹪骞嗛崶鈹惧亾閿濆骸浜滄繛?
                                            rows={3}
                                            className="w-full resize-none rounded-lg border border-purple-500/20 bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-purple-400"
                                        />
                                        <div className="rounded-lg bg-black/20 p-2">
                                            <div className="flex items-center justify-between text-[10px] text-gray-400">
                                                <span>闂備礁鎼悧婊堝礈濮橀鏁冨┑鍌氭啞閻掕顭跨捄渚Ъ闁告﹩鍓熼弻锝夊Ω閵夈儺浼€闂佺粯绻嶉崹鍫曞箖?/span>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedMergeNodeIds([])}
                                                    disabled={selectedMergeNodeIds.length === 0}
                                                    className="text-gray-400 hover:text-white disabled:opacity-40"
                                                >
                                                    婵犵數鍋為幐鎼佸箠閹版澘鐓?                                                </button>
                                            </div>
                                            <div className="mt-2 max-h-28 space-y-1 overflow-y-auto">
                                                {selectedMergeNodes.length > 0 ? selectedMergeNodes.map(node => (
                                                    <div key={node.id} className="flex items-center gap-2 rounded bg-white/5 px-2 py-1 text-xs text-gray-200">
                                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: TOPO_COLORS[node.type] }} />
                                                        <span className="flex-1 truncate">{node.name}</span>
                                                        <span className="text-[10px] text-gray-500">{node.id}</span>
                                                    </div>
                                                )) : (
                                                    <div className="rounded bg-white/5 px-2 py-2 text-xs text-gray-500">
                                                        闂佸搫顦弲婊嗘懌闂佹眹鍎遍幊姗€寮婚崨顔肩窞鐎光偓閳ь剝銇愰弻銉︾厽闁归偊鍓涢悾顓㈡煃瑜滈崜娆撳磹閹间礁鍌ㄦ繛鎴欏灩閸屻劑鎮归崶褍绾ч柛鏇㈢畺閺屾盯濡烽妷銉х◤缂備焦顨呴崐鍧楀箖濞嗘挻鐒绘繛鎴炲閹封剝绻涢幋鐐存儎濞存粍绮岄锝夋煥鐎ｎ剦娴勯梺闈涱槶閸婃鎮烽幇鏉跨閻庢稒蓱缁€鈧梺娲讳簼婢瑰棛鍒掗埡浣叉瀻闁瑰瓨绻€閸栨牠姊?                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => void handleCreateManualJunction()}
                                            disabled={selectedMergeNodeIds.length < 2 || isMerging}
                                            className="w-full bg-purple-700/80 hover:bg-purple-600 text-white py-2 rounded-lg text-xs transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                                        >
                                            <span className="material-symbols-outlined text-sm">hub</span>
                                            {isMerging ? '闂備礁鎲＄敮妤冪矙閹寸姷纾介柟鎯ь嚟閳?..' : '闂備礁鎲＄敮妤冪矙閹寸姷纾介柟鎹愵嚙缁犮儵鎮楅敐搴濈胺缂佹唻缍侀弻鐔兼偡閹殿喚顔囬梺璇″枛闁帮絽顕ｉ幖浣割潊闁靛骏绲介悞?}
                                        </button>
                                        <div className="rounded-lg border border-white/10 bg-black/10 p-2">
                                            <div className="flex items-center justify-between text-[10px] text-gray-400">
                                                <span>闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯款嚙閻銇勯弽銊р槈妞ゅ孩娲熼弻娑㈠箳閹寸儐妫ゅ┑鐐茬墛閸ㄥ潡鐛鍥ｅ亾閿濆簼绨风紒鎲嬬秮閺岀喖鎮烽幍顔绢唶闂?/span>
                                                <span>{manualEditableJunctionGroups.length} 濠?/span>
                                            </div>
                                            <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                                                {manualEditableJunctionGroups.length > 0 ? manualEditableJunctionGroups.map(group => (
                                                    <div key={group.id} className="rounded bg-white/5 px-2 py-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="flex-1 truncate text-xs text-gray-200">{group.name}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => void handleDeleteManualJunction(group)}
                                                                disabled={deletingJunctionId === group.id}
                                                                className="text-[10px] text-red-300 hover:text-red-200 disabled:opacity-40"
                                                            >
                                                                {deletingJunctionId === group.id ? '闂備胶鎳撻崲鎻捨涘Δ鍛瀭閹兼番鍨婚埢?..' : '闂備胶鎳撻崲鎻捨涘Δ鍛瀭?}
                                                            </button>
                                                        </div>
                                                        <div className="mt-1 text-[10px] text-gray-500">
                                                            闂佽崵鍠愬ú鏍涘☉妯?{group.member_count ?? group.station_ids.length} 濠电偞鍨堕幖鈺傜閻愮儤鍋熸い鏍仦閸?                                                        </div>
                                                    </div>
                                                )) : (
                                                    <div className="rounded bg-white/5 px-2 py-2 text-xs text-gray-500">
                                                        闂備胶绮划宥咁熆濡尨鑰挎い蹇撳閺岋箓鏌嶉埡浣告殲缂佺姵甯￠弻鐔兼濞戝崬鍓版繛鏉戝悑閸旀瑩鐛幋锝囩杸闁圭偓娼欓埀顑惧€濋幃鐑藉即閻愭惌妫ゅ┑鐐村絻閿曪附绂掗敃鍌氱＜婵☆垰鍢叉禍?                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}


                                <div className="border border-cyan-500/20 bg-cyan-950/20 rounded-lg p-2.5 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-[10px] text-cyan-300 uppercase tracking-wider">闂備胶绮崝娆撳焵椤掍胶銆掔紒澶嬫綑鑿愰柛銉ｅ妿缁犳捇鏌?/p>
                                        <span className="text-[10px] text-cyan-400">{dirtyPositions.size} 濠电偞鍨堕幖鈺傜濠婂懏顐介柣鏂挎憸閳瑰秵绻濋棃娑欘棤闁?/span>
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] text-cyan-400">
                                        <span>闂備礁鎼崐鐟邦熆濮椻偓璺柛鎰ㄦ櫆娴溿倝鏌ｉ幇鐗堟锭婵炲牏濮烽埀顒€鐏氬姗€骞婂鍥ㄥ床婵ɑ澧庨崑?/span>
                                        <span>{unsavedEdgeIds.size} 闂?/span>
                                    </div>
                                    <label className="flex items-center justify-between gap-3 text-xs text-gray-300">
                                        <span>濠电儑绲藉ú锔炬崲閸岀偞鍋ら柕濞炬櫅缁秹鏌熼鐑嗘殥缂侇喗鎹囬弻娑㈠棘鐠囨彃顫囧┑顔藉笒婢т粙鍩€?/span>
                                        <button
                                            type="button"
                                            onClick={() => setCascadeValves(prev => !prev)}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${cascadeValves ? 'bg-cyan-600' : 'bg-gray-700'}`}
                                        >
                                            <span
                                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${cascadeValves ? 'translate-x-6' : 'translate-x-1'}`}
                                            />
                                        </button>
                                    </label>
                                    <p className="text-[10px] text-gray-500 leading-4">
                                        濠电儑绲藉ú锔炬崲閸岀偞鍋ら柕濞炬櫅鐟欙箓骞栫€涙绠樼紒鎰殜閺岀喓鎹勯悮鏉戜紣缂傚倸绉撮澶婄暦濠婂喚鍚嬮柛鈩冾殘瑜板矂姊洪崨濠冪厽闁告柨绻掗幑銏ゅ礃椤旇棄鍓梺鍛婃处娴滄粓鎯佸鍫熺厽闁归偊鍠楅崵鈧梺鍝ュ枑閹瑰洤鐣峰Δ鍛ㄩ柨鏃囧Г椤斿秹姊虹涵鍜佸殐闁哥姵鐗滈懞閬嶆焼瀹ュ棙娅栭柣蹇曞仜閳ь剛鍠庨悵顖炴⒑閸︻収鐒炬い锔诲灣娴滄悂顢涘锝嗙亖婵炶揪绲介崯顐⑩枔娴煎瓨鐓曢柡鍌濐嚙婵倿鏌涢敐鍛喐缂侇喛顕ц灃闁逞屽墲閵囨劙宕奸敐鍐ф睏闂佸憡顨堥崑鐐哄箚濞嗘挻鈷掗柛鎰剁到娴滈箖鏌ｆ惔锛勭暛闁稿﹥顨呴埢鎾诲箣閻愭潙顎撻悗骞垮劚濞层劑寮搁崒鐐寸厪?                                    </p>
                                    {positionPreview && (
                                        <div className="rounded-lg border border-cyan-500/20 bg-black/20 p-2 space-y-1.5">
                                            <div className="grid grid-cols-3 gap-1 text-[10px]">
                                                <span className="rounded bg-white/5 px-2 py-1 text-center text-gray-300">
                                                    濠电偞鍨堕幑浣哥暦閻㈢纾?{positionPreview.updated_station_ids.length}
                                                </span>
                                                <span className="rounded bg-white/5 px-2 py-1 text-center text-gray-300">
                                                    闂傚倸鍊搁崯鐘诲磻閹剧粯鍊?{positionPreview.updated_valve_ids.length}
                                                </span>
                                                <span className="rounded bg-white/5 px-2 py-1 text-center text-gray-300">
                                                    闂備礁鎲￠悧婊堝磿閵堝鏁?{positionPreview.impacted_segments.length}
                                                </span>
                                            </div>
                                            {positionPreview.impacted_segments.length > 0 && (
                                                <div className="max-h-24 overflow-y-auto space-y-1">
                                                    {positionPreview.impacted_segments.slice(0, 4).map(segment => (
                                                        <div key={`${segment.start_id}-${segment.end_id}`} className="text-[10px] text-gray-400 bg-white/5 rounded px-2 py-1">
                                                            {segment.start_id} 闂?{segment.end_id} 闁?闂傚倸鍊搁崯鐘诲磻閹剧粯鍊?{segment.valve_ids.length}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {positionPreview.errors.length > 0 && (
                                                <p className="text-[10px] text-red-400">
                                                    濠碘槅鍋呭妯尖偓姘煎灦閿濈偛顓兼径濠勵槺闂佸憡渚楅崢浠嬪磿?{positionPreview.errors.length} 闂備礁鎼ˇ顐﹀焵椤掆偓绾绢厾澹曟禒瀣仺妞ゆ牜鍋炴禍銈囩磼鏉堛劎绠橀柟椋庡Т閻ｏ繝寮堕崹顔肩船婵犵妲呴崑鈧柛瀣崌閺岋紕浠︾拠鎻掑缂備礁澧庨崰鎰矚閸楃偐鏀介柛鈩冪懄閹插ジ姊虹紒妯哄闁逞屽墯缁嬫挾绮旈幘顔界厪?                                                </p>
                                            )}
                                        </div>
                                    )}
                                    <div className="flex gap-1.5">
                                        <button
                                            onClick={() => void handlePreviewPositions()}
                                            disabled={dirtyPositions.size === 0 || isSaving || isPreviewing}
                                            className="flex-1 bg-sky-900/60 hover:bg-sky-800 text-sky-300 py-2 rounded-lg text-xs transition-colors disabled:opacity-40"
                                        >
                                            {isPreviewing ? '濠碘槅鍋呭妯尖偓姘煎灦閿濈偛顓奸崱娆屾灃?..' : '濠碘槅鍋呭妯尖偓姘煎灦閿濈偛顓奸崼娑楁睏闂佸憡顨堥崑鐐哄箚?}
                                        </button>
                                        <button
                                            onClick={() => void resetUnsavedPositions()}
                                            disabled={dirtyPositions.size === 0 || isSaving}
                                            className="flex-1 bg-gray-800/60 hover:bg-gray-700 text-gray-300 py-2 rounded-lg text-xs transition-colors disabled:opacity-40"
                                        >
                                            闂備線鈧稑瀚庨柛濠冪箞瀵劑濮€閵堝懎鐝樺銈呯箰閸熸壆绮绘禒瀣€?                                        </button>
                                        <button
                                            onClick={() => void handleSavePositions()}
                                            disabled={dirtyPositions.size === 0 || isSaving}
                                            className="flex-1 bg-cyan-700/80 hover:bg-cyan-600 text-white py-2 rounded-lg text-xs transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                                        >
                                            <span className="material-symbols-outlined text-sm">save</span>
                                            {isSaving ? '濠电儑绲藉ú锔炬崲閸岀偞鍋ら柕濠忓閳?..' : '濠电儑绲藉ú锔炬崲閸岀偞鍋ら柕濞炬櫅闁裤倝鏌熼柇锕€骞橀柛?}
                                        </button>
                                    </div>
                                    <button
                                        onClick={saveConnectedEdges}
                                        disabled={unsavedEdgeIds.size === 0 || isSaving}
                                        className="w-full bg-emerald-700/80 hover:bg-emerald-600 text-white py-2 rounded-lg text-xs transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-sm">timeline</span>
                                        濠电儑绲藉ú锔炬崲閸岀偞鍋ら柕濠忛檮娴溿倝鏌ｉ幇鐗堟锭婵炲牏濞€閺屻劌鈽夊Ο鑽ょ構SON闂?                                    </button>
                                    <button
                                        onClick={() => void restoreSavedDraft(false)}
                                        disabled={!hasSavedDraft || isSaving}
                                        className="w-full bg-slate-700/80 hover:bg-slate-600 text-white py-2 rounded-lg text-xs transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-sm">restore</span>
                                        闂備浇顕栭崢褰掑垂瑜版崵鍥箵閹烘繂鏅犻梻濠庡亽閸樺墽绮绘禒瀣€垫繛鎴炵懐閻掑墽绱掔紒妯笺€掗柣?                                    </button>
                                </div>

                                {/* 闂備焦鎮堕崕杈亹閻愬灚顐?*/}
                                <div className="border-t border-gray-800/50 pt-2">
                                    <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-wider">闂備焦鎮堕崕杈亹閻愬灚顐?/p>
                                    <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-400">
                                        {(Object.keys(TOPO_LABELS) as PointType[]).map(key => (
                                            <span key={key} className="flex items-center gap-1">
                                                <span className="rounded-full shrink-0" style={{ width: TOPO_SIZES[key], height: TOPO_SIZES[key], backgroundColor: TOPO_COLORS[key] }} />
                                                {TOPO_LABELS[key]}
                                            </span>
                                        ))}
                                        <span className="flex items-center gap-1 col-span-2 mt-0.5">
                                            <span className="w-6 h-[2px] shrink-0" style={{ backgroundColor: LINE_COLOR }} />
                                            缂傚倷鑳舵刊瀵告閺囥垹鍚归幖娣灪娴溿倝鏌ｉ幇顓熺稇濠?                                        </span>
                                    </div>
                                </div>

                                <div className="flex gap-1.5 pt-1">
                                    <button onClick={() => void doUndo()} disabled={undoStack.length === 0} className="flex-1 bg-blue-900/40 hover:bg-blue-800 text-blue-400 py-2 rounded-lg text-xs border border-blue-800/40 transition-colors disabled:opacity-40 flex items-center justify-center gap-1">
                                        <span className="material-symbols-outlined text-sm">undo</span>闂備線鈧稑瀚庨柛濠冪箞瀵劑銆傞　绫瞕oStack.length > 0 ? `(${undoStack.length})` : ''}
                                    </button>
                                    <button onClick={exportJSON} disabled={topoNodes.length === 0} className="flex-1 bg-green-900/40 hover:bg-green-800 text-green-400 py-2 rounded-lg text-xs border border-green-800/40 transition-colors disabled:opacity-40">闂佽娴烽弫鎼佸储瑜斿畷?/button>
                                    <button onClick={clearAll} disabled={topoNodes.length === 0} className="flex-1 bg-red-900/40 hover:bg-red-800 text-red-400 py-2 rounded-lg text-xs border border-red-800/40 transition-colors disabled:opacity-40">婵犵數鍋為幐鎼佸箠閹版澘鐓?/button>
                                </div>
                            </div>
                        )}

                        {/* 濠德板€楁慨鎾儗娓氣偓閹?*/}
                        {activeTab === 'validate' && (
                            <div className="space-y-2">
                                {!report ? (
                                    <div className="text-center py-6">
                                        <span className="material-symbols-outlined text-4xl text-gray-600">verified</span>
                                        <p className="text-gray-500 text-xs mt-2">闂備胶绮崝妤呭箠閹捐鍚规い鏂款潟娴滄粓鏌ら崫銉︽毄闁糕晛顦甸弻鏇㈠幢濡ゅ啰鍔梺缁樼⊕閻熝囧箯閻樿櫕濯寸痪鐗埫禍鍓р偓骞垮劚閹虫劗澹曠拠娴嬫斀?/p>
                                    </div>
                                ) : (
                                    <>
                                        <div className={`p-3 rounded-lg text-xs border ${report.passed ? 'bg-green-900/20 border-green-700/40 text-green-400' : 'bg-red-900/20 border-red-700/40 text-red-400'}`}>
                                            <div className="flex items-center gap-1.5 font-bold text-sm mb-1">
                                                <span className="material-symbols-outlined text-base">{report.passed ? 'check_circle' : 'error'}</span>
                                                {report.passed ? '闂備礁缍婇弨閬嶅箰缂佹ɑ娅犻柕鍫濐槸鐟欙箓鏌涢銈呮灁闁? : `${report.issues.length} 闂備礁鎼¨鈧紒缁樼箓铻為柤鍝ヮ暜缁憋絾鎱ㄩ幒鎾愁€?                                            </div>
                                            <div className="grid grid-cols-2 gap-y-0.5 text-[10px] text-gray-400 mt-1">
                                                <span>闂備胶鍘ч幖顐﹀磹婵犳艾纾?{report.stats.nodeCount}</span>
                                                <span>闂佸搫顦弲婵嬪磻閻旂厧鍚?{report.stats.edgeCount}</span>
                                                <span>闂佽瀛╃粙蹇涘磹濡ゅ懏鍋?{report.stats.isolatedCount}</span>
                                                <span>闂佸搫顦弲婵嬪磻閵堝鐒垫い鎺嶆祰婢规﹢鏌涢妸銉╁弰闁?{report.stats.componentCount}</span>
                                            </div>
                                        </div>
                                        <div className="space-y-1 max-h-60 overflow-y-auto">
                                            {report.issues.map((issue, i) => (
                                                <div key={i} className={`p-2 rounded text-[10px] border ${issue.level === 'error' ? 'border-red-800/40 text-red-400 bg-red-900/10' : 'border-yellow-800/40 text-yellow-400 bg-yellow-900/10'}`}>
                                                    <span className="material-symbols-outlined text-[10px] mr-1 align-middle">{issue.level === 'error' ? 'error' : 'warning'}</span>{issue.message}
                                                </div>
                                            ))}
                                            {report.issues.length === 0 && <p className="text-center text-gray-500 text-[10px] py-3">闂備礁鎼崯鐗堢箾閳ь剚淇婇銉ョ厫闁?婵☆偓绲介崯顐ょ博?/p>}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* 闂備胶鎳撻崥瀣垝鎼淬劌纾?*/}
                        {activeTab === 'search' && (
                            <div className="space-y-2">
                                <input className="w-full bg-gray-900/60 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 outline-none focus:border-cyan-500/50"
                                    placeholder="闂佸搫顦悧濠囧箰閹间礁鐭楅柛鈩冪懅閸楁碍绻涢崱妤冪缂併劍宀搁弻娑橆潩椤掑倐銈囨偖?.." value={searchText} onChange={e => setSearchText(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && searchResults.length > 0) flyTo(searchResults[0]) }} />
                                <div className="max-h-72 overflow-y-auto space-y-1">
                                    {searchText.trim() && searchResults.length === 0 && <p className="text-center text-gray-500 text-[10px] py-3">闂備礁鎼崯鐗堟叏鐎甸晲鐒婃い鏇楀亾闁?/p>}
                                    {searchResults.map(node => (
                                        <button key={node.id} onClick={() => flyTo(node)} className="w-full flex items-center gap-2 p-2 rounded-lg text-xs hover:bg-white/5 transition-colors text-left">
                                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: TOPO_COLORS[node.type] }} />
                                            <span className="text-gray-300 flex-1 truncate">{node.name}</span>
                                            <span className="material-symbols-outlined text-gray-500 text-sm">my_location</span>
                                        </button>
                                    ))}
                                    {!searchText.trim() && <p className="text-center text-gray-500 text-[10px] py-3">{topoNodes.length > 0 ? `${topoNodes.length} 濠电偞鍨堕幖鈺傜閿濆棔绻嗘い鎾卞灪閸婇绱?: '闂佽崵濮村ú銈夊床閺屻儱鍌ㄦ繛鎴炲焹閸嬫捇鎮介棃娑樹粯闂佸憡鐟ュΛ婵嬬嵁韫囨稑绠婚柡澶嬪灍閸?}</p>}
                                </div>
                            </div>
                        )}

                        {/* 闂備浇顫夐幆灞剧濠靛钃熼柛銉ｅ妿椤╃兘鎮归幁鎺戝闁?*/}
                        {activeTab === 'cutoff' && (
                            <div className="space-y-2">
                                {/* 闂備胶鎳撻崥瀣垝鎼淬劌纾奸柕濞炬櫅缁狅絾銇勮箛鎾村櫤闁绘帊绮欓弻?*/}
                                <div>
                                    <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">闂傚倷绶￠崑鍕囬幍顔瑰亾濮樸儱濮傛鐐差儔椤㈡棃宕ㄩ鎯уШ闂備胶鍘ч幖顐﹀磹婵犳艾纾?/p>
                                    <input
                                        className="w-full bg-gray-900/60 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 outline-none focus:border-red-500/50"
                                        placeholder="闂備胶鎳撻崥瀣垝鎼淬劌纾奸柕濞炬櫆閸ゅ秹鏌涚仦鍓х煀濞寸媭鍨堕弻娑橆潩椤掑倐銈囨偖?.."
                                        value={cutoffSearch}
                                        onChange={e => setCutoffSearch(e.target.value)}
                                    />
                                    {/* 闂備胶鎳撻崥瀣垝鎼淬劌纾奸柕濞у懐锛滈梺瑙勫劤椤曨厽绂嶉鐐寸厱闁圭儤鎼╁▓娆撴煏?*/}
                                    {cutoffSearch.trim() && (
                                        <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                                            {searchNodes(
                                                topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type })),
                                                cutoffSearch
                                            ).map(node => (
                                                <button key={node.id}
                                                    onClick={() => {
                                                        setCutoffNodeId(node.id)
                                                        setCutoffResult(null)
                                                        setCutoffSearch('')
                                                        setStatusMsg(`闂備浇顫夐幆灞剧濠靛钃熼柛銉墯閸婄兘鏌ｉ悢鍛婄凡闁搞倖甯″娲敃閵忊晜顎嗙紓?{node.name}`)
                                                    }}
                                                    className="w-full flex items-center gap-2 p-1.5 rounded text-xs hover:bg-white/5 text-left">
                                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: TOPO_COLORS[node.type as keyof typeof TOPO_COLORS] || '#888' }} />
                                                    <span className="text-gray-300 flex-1 truncate">{node.name}</span>
                                                    <span className="text-gray-600 text-[10px]">{node.type}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* 闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯款嚙缁狅絾銇勮箛鎾村櫤闁绘帊绮欓弻?*/}
                                {cutoffNodeId && (
                                    <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-2">
                                        <p className="text-[10px] text-red-400 mb-0.5">闂備浇顫夐幆灞剧濠靛钃熼柛銉墯閸?/p>
                                        <p className="text-xs text-white font-medium truncate">
                                            {topoNodes.find(n => n.id === cutoffNodeId)?.name ?? cutoffNodeId}
                                        </p>
                                    </div>
                                )}

                                {/* 闂備胶鎳撻悘婵堢矓瀹曞洨绀婇柡鍐ㄧ墕缁犳澘顭块懜闈涘閻?*/}
                                <div className="flex gap-1.5">
                                    <button
                                        onClick={runCutoffSimulation}
                                        disabled={!cutoffNodeId || topoNodes.length === 0}
                                        className="flex-1 bg-red-800/50 hover:bg-red-700 text-red-300 py-2 rounded-lg text-xs border border-red-700/40 transition-colors disabled:opacity-40 flex items-center justify-center gap-1">
                                        <span className="material-symbols-outlined text-sm">play_arrow</span>闂佸搫顦弲婊堝礉濮椻偓閵嗕線骞嬮悙娈挎祫闁荤姵浜介崝宥夊春?                                    </button>
                                    <button
                                        onClick={clearCutoffHighlight}
                                        disabled={!cutoffNodeId}
                                        className="bg-gray-800/60 hover:bg-gray-700 text-gray-400 py-2 px-3 rounded-lg text-xs border border-gray-700/40 transition-colors disabled:opacity-40">
                                        <span className="material-symbols-outlined text-sm">undo</span>
                                    </button>
                                </div>

                                {/* 濠电偛顕慨鎯р枖閺囩儑鑰块柨娑樺绾惧ジ鏌熼幆褜鍤熷ù?*/}
                                {cutoffResult && (
                                    <div className="space-y-2">
                                        {/* 婵犳鍠楄摫婵﹤婀遍懞閬嶎敊閸撗傜瑝闂侀€炲苯澧紒?*/}
                                        {cutoffResult.sourceNodes.length > 0 && (
                                            <div className="bg-blue-900/15 border border-blue-700/30 rounded-lg p-2 text-[10px]">
                                                <p className="text-blue-400 mb-1">闂佽崵濮村ú銈呂涘Δ鍛槬闁糕剝绋戠粈?{cutoffResult.sourceNodes.length} 濠电偞鍨堕幖鈺傜濠靛鍎嶉梻鍫熺▓閺€?/p>
                                                <div className="text-gray-400 space-y-0.5 max-h-16 overflow-y-auto">
                                                    {cutoffResult.sourceNodes.map(s => (
                                                        <div key={s.id} className="truncate">闁?{s.name}</div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* 闂備胶顢婃慨銈夆€﹂崼銉ｂ偓鍛存晝閸屾氨顢呴梺鎸庣☉鐎氼剟銆?*/}
                                        <div className="bg-gray-900/60 border border-gray-700/30 rounded-lg p-2.5 text-[10px]">
                                            <p className="text-gray-400 mb-1.5">闂備礁鎲＄敮鎺懳涘▎鎾村€甸柤鎭掑劤椤?{cutoffResult.totalDistributionNodes} 濠电偞鍨堕幖鈺傜濠婂牆鍨傞幖娣灪缂嶅洭鏌熼幆褍顣崇憸?/p>
                                            <div className="flex gap-2">
                                                <span className="flex-1 bg-red-900/30 rounded px-2 py-1 text-center">
                                                    <span className="block text-lg font-bold text-red-400">{cutoffResult.summary.supplyLost}</span>
                                                    <span className="text-gray-500">闂備礁鎼崑鍡涘储閾忚顐?/span>
                                                </span>
                                                <span className="flex-1 bg-orange-900/30 rounded px-2 py-1 text-center">
                                                    <span className="block text-lg font-bold text-orange-400">{cutoffResult.summary.rerouted}</span>
                                                    <span className="text-gray-500">缂傚倸鍊烽悞锕€煤濠靛鈧?/span>
                                                </span>
                                                <span className="flex-1 bg-green-900/30 rounded px-2 py-1 text-center">
                                                    <span className="block text-lg font-bold text-green-400">{cutoffResult.summary.same}</span>
                                                    <span className="text-gray-500">婵犳鍠楃换鎰緤娴犲鍋?/span>
                                                </span>
                                            </div>
                                        </div>

                                        {/* 闂備礁鎲￠悷锕傘€冮崨顔鹃檮闁哄稁鍘兼导鐘碘偓骞垮劚閻楀棜鐏愰梻浣虹帛閸旀骞婇幘璇插瀭妞ゅ繐妫欓崑?*/}
                                        {cutoffResult.affectedNodes.length > 0 && (
                                            <div className="space-y-0.5 max-h-52 overflow-y-auto">
                                                <p className="text-[10px] text-gray-500 mb-1">闂備礁鎲￠悷锕傘€冮崨顔鹃檮闁哄稁鍘兼导鐘碘偓骞垮劚閻楀棜鐏愰梻?/p>
                                                {cutoffResult.affectedNodes.map(node => (
                                                    <div key={node.id}
                                                        className={`px-2 py-1.5 rounded text-[10px] border ${
                                                            node.status === 'supply_lost'
                                                                ? 'border-red-800/40 bg-red-900/10'
                                                                : 'border-orange-800/40 bg-orange-900/10'
                                                        }`}>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="material-symbols-outlined text-[10px]" style={{
                                                                color: node.status === 'supply_lost' ? '#f87171' : '#fb923c'
                                                            }}>
                                                                {node.status === 'supply_lost' ? 'cancel' : 'alt_route'}
                                                            </span>
                                                            <span className="flex-1 truncate text-gray-300">{node.name}</span>
                                                            <span className={node.status === 'supply_lost' ? 'text-red-400' : 'text-orange-400'}>
                                                                {node.status === 'supply_lost' ? '闂備礁鎼崑鍡涘储閾忚顐? : '缂傚倸鍊烽悞锕€煤濠靛鈧?}
                                                            </span>
                                                        </div>
                                                        {/* 闂佽崵濮崇拃锕傚垂閹殿喗顐介柣鎰彧缁憋綁鏌涢弴銊ユ珮婵?*/}
                                                        {node.status === 'rerouted' && node.pathAfter.length > 0 && (
                                                            <div className="mt-1 text-[9px] text-gray-600 truncate pl-4">
                                                                闂?{pathIdsToNames(node.pathAfter, topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))).join(' 闂?')}
                                                            </div>
                                                        )}
                                                        {node.status === 'supply_lost' && node.pathBefore.length > 0 && (
                                                            <div className="mt-1 text-[9px] text-gray-600 truncate pl-4">
                                                                闂?闂備礁鎲￠…鍥窗閺囥垺鍎楅柟顖嗗苯娈? {pathIdsToNames(node.pathBefore, topoNodes.map(n => ({ id: n.id, name: n.name, type: n.type }))).join(' 闂?')}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 闂備礁婀辩划顖炲礉濡ゅ懎桅?*/}
                                {topoNodes.length === 0 && (
                                    <p className="text-center text-gray-600 text-[10px] py-4">闂佽崵濮村ú銈夊床閺屻儱鍌ㄦ繛鎴欏灪閸婄兘鏌ｉ悢鍛婄凡婵絽锕弻鏇㈠幢濡ゅ嫬顏銈嗘礋娴滆泛鐣峰Δ鍛ㄩ柨鏇楀亾闁绘繃鐗犻弻鐔煎垂椤愩垻浠ч梺?/p>
                                )}
                            </div>
                        )}

                        {/* 缂傚倷绀侀鍫濃枍閺囥垹鐒垫い鎴炲椤︾兘鎮归悙顏勭伈闁?*/}
                        {activeTab === 'simulation' && (
                            <div className="space-y-3">
                                
                                <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/10 p-3 space-y-3">
                                    <div className="text-[10px] uppercase tracking-wider text-cyan-200">濠电偞鍨堕幑渚€顢欐繝鍕闁靛繈鍊栭崕鎴︽煟閺傛寧鍟為柟顖涚懃闇?/div>
                                    <div className="grid grid-cols-1 gap-2">
                                        <div>
                                            <div className="mb-1 text-[10px] text-gray-500">闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯款嚙閹瑰爼鏌ｉ幋鐐嗘垿鎮?/div>
                                            <select value={steadyScenarioId} onChange={event => setSteadyScenario(event.target.value)} className="w-full rounded-lg border border-cyan-500/20 bg-black/20 px-3 py-2 text-xs text-white outline-none">{MAINLINE_SCENARIOS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
                                        </div>
                                        <div>
                                            <div className="mb-1 text-[10px] text-gray-500">缂傚倸鍊烽悞锕傚箰婵犳碍鍊跺璺烘捣閻も偓濡炪倖鍔戦崐鏇烆嚕?/div>
                                            <div className="flex gap-2">
                                                <select value={steadySelectedSnapshotRunId} onChange={event => setSteadySelectedSnapshotRunId(event.target.value)} className="flex-1 rounded-lg border border-cyan-500/20 bg-black/20 px-3 py-2 text-xs text-white outline-none">
                                                    <option value="">闂佽崵濮村ú銊╁礂濮椻偓閸┾偓妞ゆ巻鍋撴い锔藉閳ь剚鍝庨崝宥囩矙婢舵劕鐒垫い鎺戝缁狙囨煃閵夈劍鐝憸鑸劦閺?/option>
                                                    {steadySnapshots.map(item => <option key={item.run_id} value={item.run_id}>{item.scenario_id} | {item.run_id.slice(0, 12)} | {formatDateTimeLabel(item.saved_at)}</option>)}
                                                </select>
                                                <button onClick={async () => { try { await loadSteadySelectedSnapshot(); setStatusMsg(`闁诲海鎳撻幉陇銇愰崘鈺傚弿闁绘劕鐡ㄦ慨婊堟煢濡警妲圭憸鑸劦閺岋綁骞樺Δ鈧粔鍓佺玻?{selectedSnapshotSummary?.scenario_id ?? steadySelectedSnapshotRunId}`) } catch (error) { setStatusMsg(error instanceof Error ? error.message : '闂備礁鎲″缁樻叏閹灐褰掑炊椤忓棛鏉稿銈嗗姂閸婃洖顕ｉ幆褜鐔嗛柟顖涘缁ㄥ潡鎮?) } }} disabled={!steadySelectedSnapshotRunId || steadySnapshotLoading} className="rounded-lg border border-cyan-500/30 bg-cyan-900/20 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40">{steadySnapshotLoading ? '闂備礁鎲″缁樻叏閹灐褰掑炊閵娧€鏋?..' : '闂備礁鎲″缁樻叏閹灐?}</button>
                                            </div>
                                        </div>
                                        <div>
                                            <div className="mb-1 text-[10px] text-gray-500">闂備胶纭堕弲鐐测枍閿濆鍚归幖娣€楅悿鈧銈嗗姂閸婃洖顕?/div>
                                            <select value={steadyBaselineSnapshotRunId} onChange={event => setSteadyBaselineSnapshotRunId(event.target.value)} className="w-full rounded-lg border border-violet-500/20 bg-black/20 px-3 py-2 text-xs text-white outline-none">
                                                <option value="">闂佽崵濮村ú銊╁礂濮椻偓閸┾偓妞ゆ巻鍋撴い锔藉閳ь剚鍝庨崝鎴濈暦濞差亝鎯為柣鐔哄閻ゅ洭妫呴銏＄ォ闁稿妫濆畷?/option>
                                                {steadySnapshots.map(item => <option key={`baseline-${item.run_id}`} value={item.run_id}>{item.scenario_id} | {item.run_id.slice(0, 12)} | {formatDateTimeLabel(item.saved_at)}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3 space-y-2">
                                        <label className="flex items-center justify-between gap-3 text-xs text-emerald-100">
                                            <span>濠电偛顕慨鎯р枖閺囩儑鑰块柨鐔哄Т缁€鍫⑩偓骞垮劚閹冲酣寮查幖浣圭厱闊洤顑呴崝姘舵偨椤栨碍鍠樼€?婵犵數鍋為幐鎾疾濞戞埃鍋?婵犵數鍋熺换婵堟濮樿泛闂?/span>
                                            <input type="checkbox" checked={preSimInputEnabled} onChange={event => setPreSimInputEnabled(event.target.checked)} className="h-4 w-4 accent-emerald-400" />
                                        </label>
                                        <div className="grid grid-cols-3 gap-2">
                                            <label className="space-y-1 text-[10px] text-gray-400">
                                                <span>濠殿喗甯楃粙鎺椻€﹂崼銉晣濠电姵鑹鹃崒銊╂倵閿濆簼绨绘い?MPa)</span>
                                                <input type="number" step="0.1" value={preSimDefaultPressureMpa} onChange={event => setPreSimDefaultPressureMpa(Number(event.target.value))} disabled={!preSimInputEnabled} className="w-full rounded border border-emerald-500/20 bg-black/20 px-2 py-1 text-xs text-white outline-none disabled:opacity-40" />
                                            </label>
                                            <label className="space-y-1 text-[10px] text-gray-400">
                                                <span>濠殿喗甯楃粙鎺椻€﹂崼銉晣閻犲洤鐪伴埀顒佸浮閸┾剝鎷呴崜鎻掓暯(闂佺娅ｉ悡?</span>
                                                <input type="number" step="0.1" value={preSimDefaultTemperatureC} onChange={event => setPreSimDefaultTemperatureC(Number(event.target.value))} disabled={!preSimInputEnabled} className="w-full rounded border border-emerald-500/20 bg-black/20 px-2 py-1 text-xs text-white outline-none disabled:opacity-40" />
                                            </label>
                                            <label className="space-y-1 text-[10px] text-gray-400">
                                                <span>濠殿喗甯楃粙鎺椻€﹂崼銉晣閻犲洩顥嗙憴鍕懝闁逞屽墴瀹?濠电偞鍨堕幐绋棵洪敃鍌氳摕?濠?</span>
                                                <input type="number" step="1" value={preSimDefaultFlowRate} onChange={event => setPreSimDefaultFlowRate(Number(event.target.value))} disabled={!preSimInputEnabled} className="w-full rounded border border-emerald-500/20 bg-black/20 px-2 py-1 text-xs text-white outline-none disabled:opacity-40" />
                                            </label>
                                        </div>
                                        <label className="flex items-center gap-2 text-[11px] text-gray-300">
                                            <input type="checkbox" checked={preSimApplyToSources} onChange={event => setPreSimApplyToSources(event.target.checked)} disabled={!preSimInputEnabled} className="h-3.5 w-3.5 accent-emerald-400 disabled:opacity-40" />
                                            <span>闂備礁鎲￠懝楣冨嫉椤掆偓椤啴宕掑鍕毇闂佺硶鍓濋悷锔惧閻楀牏绡€鐟滃酣宕濆Δ鍛仧妞ゆ牜鍋涢崒銊╂倵閿濆簼绨绘い?/span>
                                        </label>
                                        <button
                                            type="button"
                                            onClick={clearPreSimulationCustomOverrides}
                                            className="rounded border border-emerald-500/30 bg-black/20 px-2 py-1 text-[10px] text-emerald-100 hover:bg-emerald-900/20"
                                        >
                                            婵犵數鍋為幐鎼佸箠閹版澘鐓橀柡宥庡幗閸ゅ秹鏌涚仦鍓х煀濞?缂傚倷鑳舵慨顓㈠礈濠靛鏁婄€光偓閳ь剟鍩€椤掑喚娼愰柤褰掔畺瀹曞搫螖閸涱厾锛?                                        </button>
                                        <div className="text-[10px] text-gray-400">闂備胶顭堢换鎴炵箾婵犲伣娑㈠级閹搭厼娈ㄩ梺閫炲苯澧寸€规洘顨婇幖褰掝敃閿濆孩袧闂備焦瀵х粙鎴︽儔婵傚憡鐒鹃悗闈涙憸绾惧ジ鏌ｉ弮鍥跺殭婵炲牅鍗抽弻娑㈠棘鐠囨彃顬嗘繝鐢靛仜濞差參骞冩禒瀣╅柕澶涚畱閳ь剛鏁哥槐鎺楀籍閹存繄浠哥紓渚囧櫘閸ㄦ娊骞忕€ｎ喖围闁告侗鍘鹃濠氭⒑閸涘﹥鈷愮紒瀣姉缁厾浠︽慨鎰ㄥ亾閹烘鐓涘ù锝呭閸炵儤绻涢弶鎴濇倯濠㈢懓妫濋幃鐐節濮橆儵?/div>
                                    </div>
                                    
                                    
                                    <div className="grid grid-cols-2 gap-2">
                                        <button onClick={async () => { try { await runSteadySimulationWithPreset(); setStatusMsg(`WE1 濠电偞鍨堕幑渚€顢欐繝鍕闁靛繈鍊栭崕鎴︽煟閺傚灝妲婚柛銈嗗浮瀵爼鍩￠崒姘潙濡炪們鍨洪崹鍧楀极?{steadyScenarioOption?.label ?? steadyScenarioId}`) } catch (error) { setStatusMsg(error instanceof Error ? error.message : 'WE1 濠电偞鍨堕幑渚€顢欐繝鍕闁靛繈鍊栭崕鎴︽煟閺冨洤鍚圭紒鐘劦閹泛鈽夊Ο鍨伃闂侀潧娲﹂崹褰掑箯?) } }} disabled={steadySimLoading} className="rounded-lg bg-cyan-700/80 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">{steadySimLoading ? '闂佸搫顦弲婊堝礉濮椻偓閵嗕線骞嬮悙纰樻灃?..' : '闂佸搫顦弲婊堝礉濮椻偓閵嗕線骞嬮悙纰樻灃闁荤姳绀侀悿鍥⒖瑜版帗鐓?}</button>
                                        <button onClick={async () => { try { await saveSteadySnapshot(); setStatusMsg(`闁诲氦顫夐悺鏇烆嚕閹捐埖宕叉慨妯诲閸嬫挸鈽夊▍顓т邯楠炴捇鍩￠崨顔间簵閻熸粍绻勫Σ?{steadyScenarioOption?.label ?? steadyScenarioId}`) } catch (error) { setStatusMsg(error instanceof Error ? error.message : '濠电儑绲藉ú锔炬崲閸岀偞鍋ら柕濞垮妿閻も偓濡炪倖鍔戦崐鏇烆嚕閹岀唵闁诡垱澹嗙花鍧楁偡?) } }} disabled={!steadyOverlay || steadySnapshotLoading} className="rounded-lg border border-sky-500/30 bg-sky-900/20 px-3 py-2 text-xs font-medium text-sky-100 disabled:opacity-40">{steadySnapshotLoading ? '濠电儑绲藉ú锔炬崲閸岀偞鍋ら柕濠忓閳?..' : '濠电儑绲藉ú锔炬崲閸岀偞鍋ら柕濞垮妿閻も偓濡炪倖鍔戦崐鏇烆嚕?}</button>
                                        <button onClick={async () => { try { await refreshSteadySnapshots(); setStatusMsg('闂傚鍋勫ù鍌炲磻閸℃稑鐭楅幖娣妼缁€鍡樹繆閵堝懎顏ラ柍褜鍓欓崯顐︻敊韫囨稑绠甸柟鐑樺灩閸橀亶姊?) } catch (error) { setStatusMsg(error instanceof Error ? error.message : '闂備礁鎲＄敮锟犲绩闁秴钃熷┑鐘叉噽閻も偓濡炪倖鍔戦崐鏇烆嚕閹岀唵闁诡垱澹嗙花鍧楁偡?) } }} disabled={steadySnapshotLoading || steadyBaselineSnapshotLoading} className="rounded-lg border border-slate-600 bg-slate-800/70 px-3 py-2 text-xs font-medium text-slate-200 disabled:opacity-40">闂備礁鎲＄敮锟犲绩闁秴钃熷┑鐘叉噽閻も偓濡炪倖鍔戦崐鏇烆嚕?/button>
                                        <button onClick={() => { clearSteadyOverlay(); clearSimulationShowcaseSyncContext(); setStatusMsg('闁诲骸婀遍…鍫濐嚕閸撲胶鍗氶柤濮愬€楅惌姘舵煕濠靛棗顏紒澶娿偢閺屾盯骞樺畷鍥嗭繝鎮楅棃娑欐拱缂佸倹甯為幑鍕Ω閿曗偓閻掑摜绱撻崒娆戝妽闁圭顭烽幃?) }} className="rounded-lg border border-slate-600 bg-slate-800/70 px-3 py-2 text-xs font-medium text-slate-200">婵犵數鍋為幐鎼佸箠閹版澘鐓橀柡宥冨妿閳绘棃鎮规担鍝ユ瀮闂傚棗缍婇弻?/button>
                                    </div>
                                    <div className="rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-[11px] text-slate-300">
                                        <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] mr-2 ${steadyStatusToneClass}`}>{steadySimLoading ? '婵犳鍠氶幊鎾诲磹閸婄噥鏆板┑? : steadyOverlay ? SOLVER_STATUS_LABELS[steadyOverlay.solver_status] : '缂傚倷鐒︾粙鎴λ囬婊勵偨闁绘柨鎲℃禍銈夋煙闁箑鐏遍柡鈧?}</span>
                                        <span>闂備胶绮…鍫ュ春閺嶎厼鐒垫い鎴ｆ硶缁涘繒绱掓潏鈺傤唫steadyOverlayStatusText}</span>
                                        {steadyOverlay && <span className="ml-2 text-slate-400">run_id: {steadyOverlay.run_id.slice(0, 12)}</span>}
                                    </div>
                                    <div className="hidden rounded-lg border border-cyan-500/20 bg-black/10 px-3 py-2">
                                        <div className="text-[10px] uppercase tracking-wider text-cyan-200">濠电偛顕慨鎯р枖閺囩儑鑰块柨鐔哄У閸ゅ﹥銇勮箛鎾愁仼鐞氱喖鏌ｉ悢鍝ユ嚂缂傚秮鍋撳銈嗘磻閸楁娊寮澶婇唶婵犻潧妫滈澶岀磽?AI闂?/div>
                                        <div className="mt-1 text-[11px] text-slate-300 whitespace-pre-line leading-5">{simulationNarrative}</div>
                                    </div>
                                    <div className="hidden rounded-lg border border-emerald-500/20 bg-emerald-950/10 px-3 py-2">
                                        <div className="text-[10px] uppercase tracking-wider text-emerald-200">濠电偛鐡ㄧ划鎾剁磽濮樿埖鍎婇柣锝呮湰閸犲棝鏌ㄥ┑鍡╂Ц婵炲懐鍋ら弻銊モ槈濡厧顣洪梺閫炲苯澧查柛瀣姌閵囨劙顢氶埀顒€鐣烽敐澶樻晬婵犲灚鍔曞▓娲⒑?/div>
                                        <div className="mt-1 text-[11px] text-slate-300 whitespace-pre-line leading-5">{simulationNarrativePlain}</div>
                                    </div>
                                </div>
                                {(steadySimError || steadySnapshotError) && <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-[11px] text-red-200">{steadySimError || steadySnapshotError}</div>}
                            </div>
                        )}
                        {activeTab === 'centrality' && (
                            <div className="space-y-2">
                                {centralityData.length === 0 ? (
                                    <div className="text-center py-6">
                                        <span className="material-symbols-outlined text-4xl text-gray-600">stars</span>
                                        <p className="text-gray-500 text-xs mt-2">闂備胶绮崝妤呭箠閹捐鍚规い鏂款潟娴滄粓鏌ら崫銉︽毄闁糕晛顦甸弻鏇㈠幢濡ゅ嫬顏梺鍛婎伕閸ャ劎鍙嗗銈嗘煥閻忔繆鐏愰梻浣虹帛閸旀洜绮诲澶婄劦妞ゆ巻鍋撶紒澶屽厴椤㈡﹢宕妷褌绗?/p>
                                        <p className="text-gray-600 text-[10px] mt-1">闂備胶纭堕弲鐐差浖閵娧嗗С妞ゆ帊鑳堕々鐑芥倵閿濆骸浜濇繛鍫ｆ硾閳藉骞欓崘銊ョ缂備焦妞界粻鏍嵁閳ь剛鎲歌箛娑欏仼閻犲洦绁撮弸?/p>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-[10px] text-gray-500">濠电偛顕慨鎾敄閸℃稑姹查柣鏂挎憸閳绘梹銇勯幘璺轰户濠碘€虫喘閺?Top {centralityData.length}</p>
                                        {centralityData.map((node, i) => (
                                            <button key={node.id} onClick={() => { const n = topoNodes.find(x => x.id === node.id); if (n) flyTo(n) }}
                                                className="w-full flex items-center gap-2 p-2 rounded-lg text-xs hover:bg-white/5 transition-colors text-left">
                                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${i < 3 ? 'bg-amber-500 text-black' : 'bg-gray-700 text-gray-300'}`}>{i + 1}</span>
                                                <span className="text-gray-200 flex-1 truncate">{node.name}</span>
                                                <div className="w-16 h-1.5 bg-gray-800 rounded overflow-hidden shrink-0">
                                                    <div className="h-full bg-gradient-to-r from-amber-500 to-cyan-400 rounded" style={{ width: `${node.value}%` }} />
                                                </div>
                                                <span className="text-gray-500 w-8 text-right shrink-0">{node.value}%</span>
                                            </button>
                                        ))}
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 闂備胶绮…鍫ュ春閺嶎厼鐒垫い鎴ｆ硶閸斿秹鏌?*/}
                    <div className="px-3 py-2 bg-[#080d12] border-t border-gray-800/60 text-[10px] text-gray-500 truncate shrink-0 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[10px]">info</span>{statusMsg}
                    </div>
                </div>
            </div>

            {selectedNode && (
                <div className="absolute top-[84px] right-4 bottom-4 z-20 w-[360px]">
                    <div className="h-full bg-[#0c1218]/95 backdrop-blur-md rounded-xl border border-cyan-500/20 shadow-2xl overflow-hidden flex flex-col">
                        <div className="px-4 py-3 border-b border-cyan-500/20 flex items-center justify-between bg-[#0f1722]">
                            <div>
                                <h3 className="text-sm font-semibold text-white">{selectedNode.name}</h3>
                                <p className="text-[11px] text-gray-400 mt-0.5">闂備胶鍘ч幖顐﹀磹婵犳艾纾婚柨婵嗘处鐎氭岸鏌ㄩ弮鍥棄闁?/p>
                            </div>
                            <button
                                onClick={() => setSelectedNode(null)}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
                            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                                <div className="flex items-center gap-2">
                                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: TOPO_COLORS[selectedNode.type] }} />
                                    <span className="text-white font-medium">{selectedNode.name}</span>
                                </div>
                                <p className="text-xs text-gray-400 mt-2">缂傚倷绶￠崑澶愵敋瑜旈幃妤呮倻閼恒儲娅栧┑顔界箘鎼存竼lectedNode.isJunction ? '闂備礁鎼鍐垂婵犳碍鍤? : TOPO_LABELS[selectedNode.type]}</p>
                                <p className="text-xs text-gray-400 mt-1">
                                    闂備胶顫嬮崟顐㈩潔闂佺粯鐗紞渚€寮鍜佹桨缂佽櫣鏁ectedNode.position[0].toFixed(4)}, {selectedNode.position[1].toFixed(4)}
                                </p>
                                <p className="text-xs text-gray-400 mt-1">
                                    闂備胶顭堢换鎰版偪閸ャ劎顩烽柛顐ゅ枑娴溿倝鏌ｉ幇鐗堟锭婵炲牏濞€閺屻劌鈽夊▎妯哄ПtopoEdges.filter(edge => edge.startNodeId === selectedNode.id || edge.endNodeId === selectedNode.id).length}
                                </p>
                            </div>
                            <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-3 space-y-2">
                                <p className="text-xs text-emerald-300 uppercase tracking-wider">濠电偛顕慨鎯р枖閺囩儑鑰块柨鐔哄У閸嬫劙鏌ら崫銉毌闁?/p>
                                <div className="flex items-center justify-between gap-3 text-xs">
                                    <span className="text-gray-400">闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯款嚙閸屻劑鎮楅敐搴濈盎妞?/span>
                                    <span className="text-emerald-100 font-medium">
                                        {selectedNodeSimulationMetrics?.pressure != null
                                            ? `${selectedNodeSimulationMetrics.pressure.toFixed(2)} MPa${selectedNodeSimulationMetrics.preSimulation ? '闂備焦瀵х粙鎴︽偋閸涱垱瀵柕蹇嬪€栭崕鎴︽煟閺傚灝妲绘い銈呮噹铻為柡澶婄仢椤忣偊鏌ｉ妶鍛棦闁? : ''}`
                                            : '闂備礁鎼悧婊勭閿濆洦宕茬€广儱娲﹂崑姗€鎮橀悙璺侯棈闂傚棗缍婇弻?}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-3 text-xs">
                                    <span className="text-gray-400">闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯虹湴閳ь剚甯￠崺鈩冩媴閸撴彃鏁?/span>
                                    <span className="text-emerald-100 font-medium">
                                        {selectedNodeSimulationMetrics?.temperatureC != null
                                            ? `${selectedNodeSimulationMetrics.temperatureC.toFixed(1)}闂佺娅ｉ悡?{selectedNodeSimulationMetrics.preSimulation ? '闂備焦瀵х粙鎴︽偋閸涱垱瀵柕蹇嬪€栭崕鎴︽煟閺傚灝妲绘い銈呮噹铻為柡澶婄仢椤忣偊鏌ｉ妶鍛棦闁? : selectedNodeSimulationMetrics.estimated ? '闂備焦瀵х粙鎴︽偋閸涙潙鐭楀┑鐘插娑撳秵淇婇妶鍜佸剳缂佲偓? : ''}`
                                            : '闂備礁鎼悧婊勭閿濆洦宕茬€广儱娲﹂崑姗€鎮橀悙璺侯棈闂傚棗缍婇弻?}
                                    </span>
                                </div>
                            </div>
                            <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/20 p-3 space-y-2">
                                <p className="text-xs text-cyan-300 uppercase tracking-wider">濠电偛顕慨鎯р枖閺囩儑鑰块柨鐔哄Т缁€鍫⑩偓骞垮劚閹虫劙寮虫导瀛樼厱闁圭儤鎸搁崝鍓佺磼妫版繂寮€?/p>
                                <div className="grid grid-cols-2 gap-2">
                                    <label className="space-y-1 text-[10px] text-gray-400">
                                        <span>闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯肩帛閸ゅ秹鏌涚仦鍓х煀濞寸媭鍨堕弻娑樜熸笟顖氬壈婵?MPa)</span>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={preSimNodePressureOverrides[selectedNode.id] ?? ''}
                                            onChange={event => upsertOverrideNumber(setPreSimNodePressureOverrides, selectedNode.id, event.target.value)}
                                            disabled={!preSimInputEnabled}
                                            className="w-full rounded border border-cyan-500/20 bg-black/20 px-2 py-1 text-xs text-white outline-none disabled:opacity-40"
                                        />
                                    </label>
                                    <label className="space-y-1 text-[10px] text-gray-400">
                                        <span>闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯肩帛閸ゅ秹鏌涚仦鍓х煀濞寸媭鍨辩换娑㈠箻椤栨稒鐝旈柣?闂佺娅ｉ悡?</span>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={preSimNodeTemperatureOverrides[selectedNode.id] ?? ''}
                                            onChange={event => upsertOverrideNumber(setPreSimNodeTemperatureOverrides, selectedNode.id, event.target.value)}
                                            disabled={!preSimInputEnabled}
                                            className="w-full rounded border border-cyan-500/20 bg-black/20 px-2 py-1 text-xs text-white outline-none disabled:opacity-40"
                                        />
                                    </label>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[10px] text-gray-400">闂備胶顭堢换鎰版偪閸ャ劎顩烽柛顐犲灮娑撳秹鏌嶉埡浣告灓闁哥偠濮ょ换娑氱礄閻樼數鐛㈤梺?濠电偞鍨堕幐绋棵洪敃鍌氳摕?濠?</p>
                                    {selectedNodeConnectedEdges.length === 0 ? (
                                        <p className="text-[10px] text-gray-500">闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯肩帛閸ゅ秹鏌涚仦鍓х煀濞寸媭鍨堕弻锟犲幢濡も偓閳ь剛鎳撹灋闁靛牆顦粈鍌炴倵閸︻厼小缂侇喗鎸剧槐鎺楁偐椤愩垹鈷夊?/p>
                                    ) : (
                                        <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                                            {selectedNodeConnectedEdges.map(edge => (
                                                <div key={edge.id} className="grid grid-cols-[1fr_92px] gap-2 items-center">
                                                    <span className="truncate text-[10px] text-gray-300" title={edge.name || edge.id}>{edge.name || edge.id}</span>
                                                    <input
                                                        type="number"
                                                        step="1"
                                                        value={preSimEdgeFlowOverrides[edge.id] ?? ''}
                                                        onChange={event => upsertOverrideNumber(setPreSimEdgeFlowOverrides, edge.id, event.target.value)}
                                                        disabled={!preSimInputEnabled}
                                                        className="w-full rounded border border-cyan-500/20 bg-black/20 px-2 py-1 text-[11px] text-white outline-none disabled:opacity-40"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {selectedNode.isJunction ? (
                                <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 space-y-3">
                                    <div>
                                        <p className="text-xs text-purple-300 uppercase tracking-wider">闂佸湱鍘ч悺銊ッ洪弽顓熷剳闁规鍠氶崡姘箾閸℃ê鐏ュù?/p>
                                        <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                                            {selectedNode.sourceNodeIds?.map(stationId => {
                                                const rawNode = baseTopoNodes.find(node => node.id === stationId)
                                                return (
                                                    <div key={stationId} className="text-xs text-gray-300 bg-white/5 rounded px-2 py-1">
                                                        {rawNode?.name || stationId}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-black/15 px-3 py-2 text-xs text-gray-300 space-y-1">
                                        <div className="flex items-center justify-between gap-3">
                                            <span>闂備礁鎼ˇ顓㈠磿閼碱剝濮?/span>
                                            <span className="text-[10px] text-gray-400">
                                                {selectedJunctionGroup && isRuntimeReadonlyGroup(selectedJunctionGroup)
                                                    ? '闂佸搫顦弲婊堝礉濮椻偓閵嗕線骞嬮敃鈧猾宥夋煕椤愶絾绀€婵炲懌鍨荤槐?
                                                    : '闂備礁缍婂褔顢栭崨顔碱嚤闁圭増婢樼粻鏌ョ叓閸ャ劍灏伴柛濞垮€濋幃鐑藉即閻愭惌妫ゅ┑?}
                                            </span>
                                        </div>
                                        {selectedNode.junctionKind && (
                                            <div className="flex items-center justify-between gap-3">
                                                <span>闂備礁鎼鍐垂婵犳碍鍤嬫い蹇撴鐏忕敻鎮归崶顏勭毢闁?/span>
                                                <span className="text-[10px] text-gray-400">{selectedNode.junctionKind}</span>
                                            </div>
                                        )}
                                    </div>
                                    {!manualJunctionEditingEnabled && (
                                        <div className="rounded-lg border border-sky-500/20 bg-sky-950/20 px-3 py-2.5 text-xs text-gray-300 leading-5">
                                            闁荤喐绮庢晶妤呭箰閸涘﹥娅犻柣妯款嚙閸戠娀鏌曡箛瀣伇闁糕晛鎳橀弻鈩冨緞閸繂濮ら梺鎼炲€栫划宥咁焽婵犳艾绠涙い鏍电稻閺傗偓闂備礁鎼崯顐︽偉婵傜闂柛婵勫劤绾句粙鏌″畵顔煎枤濞堫垶鏌ｆ惔銏⑩姇闁告梹锕㈡俊鎾礃椤旇姤娅栭悗鍏夊亾闁逞屽墴楠炲顦版惔锝囷紲濡炪倖鎸荤换鍕矙婵犲倵妲堥柟鎹愭硾閸斿鎮楀顒佸枠妤犵偛绉归獮瀣倷閸忓憡婢€缂傚倷鐒﹀畷妯何涢崟顐殨妞ゆ帊鑳堕埢鏃堝箹鏉堝墽纾挎繛鍏兼⒒缁辨帡鍩€椤掑嫬浼犻柛鏇ㄥ墮椤忣垶鏌ｉ悩杈╃瓘缂佽鲸娲熼幃鐐節濮橆厽娅栭柣蹇曞仩閸嬫劗绮欐繝姘骇闁冲搫鍊婚幊鍥煕閿濆鏁辩紒瀣槸椤撳ジ宕ㄩ鐔哥彃闂備胶顢婂▔娑㈡晝閵夛附娅犳繝濠傚枤閸熷懘鏌曟径娑氱暠妞ゅ孩娲熼弻娑㈠箳閹寸儐妫炵紓鍌氱Т椤戝棛绮欐径宀€纾兼俊顖滎儠閸嬪﹦绱撴担鍓插剰妞ゆ垵鍟撮崺鈧?                                        </div>
                                    )}
                                    <button
                                        onClick={() => setHistoryChartTarget({
                                            junctionId: selectedNode.junctionId ? `JUNCTION-${selectedNode.junctionId}` : selectedNode.id,
                                            displayName: selectedNode.name,
                                        })}
                                        className="w-full bg-blue-700/80 hover:bg-blue-600 text-white py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-sm">show_chart</span>闂備礁鎼悮顐﹀磿閸愯鑰块柛娑欐綑閸戠娀鏌曡箛瀣伇闁糕晛鎳橀弻娑樜熼悜姗嗘閻?                                    </button>
                                    {canDeleteSelectedJunction && selectedJunctionGroup && (
                                        <button
                                            onClick={() => void handleDeleteManualJunction(selectedJunctionGroup)}
                                            disabled={deletingJunctionId === selectedJunctionGroup.id}
                                            className="w-full bg-red-900/60 hover:bg-red-800 text-red-200 py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1 disabled:opacity-40"
                                        >
                                            <span className="material-symbols-outlined text-sm">account_tree_off</span>
                                            {deletingJunctionId === selectedJunctionGroup.id ? '闂備胶鎳撻崲鎻捨涘Δ鍛瀭閹兼番鍨婚埢?..' : '闂備胶鎳撻崲鎻捨涘Δ鍛瀭閹兼番鍨烘禍銈嗙箾閸℃鍙勯柛銈咁儔閺岀喖妫冨☉鍗炲壈婵炴潙鍚嬮崝娆撶嵁閹达絿鐤€闁圭偓娼欓埀?}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="rounded-lg border border-gray-700/40 bg-white/5 p-3">
                                    <p className="text-xs text-gray-300 leading-5">
                                        闂佸搫顦弲婊堟偡閳哄懎闂梺鍨儑閳瑰秵绻濋棃娑氬婵炲牆鐬肩槐鎺楀籍閳ь剟鎮疯瀹曟垿鏁愭径濠呮憰闂侀潧锛忛崟顓犳毌闂備礁鎲＄划宀勬儔婵傜纾婚柨婵嗘婵鈧箍鍎卞ú銊ヮ渻娴犲绾ч柛顐ゅ枎閻忕喖鏌嶈閸撴瑩宕愯ぐ鎺撳€堕柟瀵稿Х濡垶鏌﹀Ο渚Ц鐟滄壆濮风槐鎺楊敍濠靛棗鎯為梺杞扮窔娴滆泛鐣烽妷锔藉劅闁炽儲濞婇崣锟犳⒑閸︻収鐒炬い锔诲枛椤繈鏁冮埀顒佹櫏闂佹悶鍎烘禍璺侯焽閹扮増鐓曢柟鐑樻尵閹冲棛绱掔拠鑼ら柟顔藉娴狅箓鎮欓澶嬓濋梻浣圭湽閸ㄥ宕伴幇鏉垮瀭婵鍩栭弲顒勬倶閻愯泛浜归柣鐔哥箞閺屾盯骞囬鍌傘垺绻濋埀顒勵敂閸涱喕姘﹀┑鐐叉闁帮綁宕电€ｎ喗鈷掗柛顐ｇ☉閻忣亝绻濋姀鈽呰€块柡灞界灱娴狅箓骞嗚閺夊綊鎮楃憴鍕仩闁稿孩褰冮悾宄拔旈崨顓⌒曢梺鍓插亝缁嬪牓宕?                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {historyChartTarget && (
                <div className="absolute inset-0 z-30 bg-black/30 backdrop-blur-[1px] flex items-center justify-center">
                    <ScadaHistoryChart
                        stationName={historyChartTarget.stationName}
                        junctionId={historyChartTarget.junctionId}
                        displayName={historyChartTarget.displayName}
                        onClose={() => setHistoryChartTarget(null)}
                    />
                </div>
            )}

            {/* 缂傚倷鑳舵刊瀵告閺囥垹鍚?Hover Tooltip */}
            {hoveredEdgeId && tooltipPos && hoveredRawEdge && (
                <div
                    className="fixed z-50 pointer-events-none bg-[#0f1722]/95 border border-cyan-500/30 rounded-lg p-3 shadow-2xl backdrop-blur-md min-w-[200px]"
                    style={{ left: tooltipPos.x + 15, top: tooltipPos.y + 15 }}
                >
                    <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                        <span className="text-white font-medium text-sm">{hoveredRawEdge.name}</span>
                    </div>
                    {hoveredRawEdge.flowRate !== undefined && (
                        <div className="flex items-center justify-between gap-4 mt-2">
                            <span className="text-gray-400 text-xs">闂佸搫顦弲婊堝礉濮椻偓閵嗕線骞嬪婵婎潐缁楃喖鍩€椤掑嫬闂柣鎴灻閬嶆煙瀹勬壆鐒鹃柛姘ｅ亾</span>
                            <span className="text-cyan-300 font-mono text-sm">{hoveredRawEdge.flowRate} <span className="text-[10px] text-gray-500">濠电偞鍨堕幐绋棵洪敃鍌氳摕?濠?/span></span>
                        </div>
                    )}
                    {hoveredRawEdge.currentPressure !== undefined && (
                        <div className="flex items-center justify-between gap-4 mt-1">
                            <span className="text-gray-400 text-xs">闂備胶顫嬮崘鈺傛倷闁汇埄鍨板ú顓㈢嵁閹烘惟闁挎梹鍎崇粣?/span>
                            <span className="text-emerald-300 font-mono text-sm">{hoveredRawEdge.currentPressure} <span className="text-[10px] text-gray-500">MPa</span></span>
                        </div>
                    )}
                    {hoveredRawEdge.flowRate === undefined && (
                        <p className="text-[10px] text-gray-500 mt-2 italic">闂備礁鎼Λ妤呭磹閻熸嫈娑㈠Χ閸氥倛顫夐幏鍛槹鎼达及顏堟⒑閸涘﹥鐓熼柛鏂挎湰閹便劏绠涢弴妤€浜炬繛鎴濈－閻ｈ櫕銇勯弮鈧ú婊堝焵?/p>
                    )}
                </div>
            )}
        </div>
    )
}

export default MapTopologyView
