/**
 * Ò³Ãæ¼ÓÔØ×´Ì¬×é¼þ
 * ÔÚÊÓÍ¼×é¼þÀÁ¼ÓÔØÊ±ÏÔÊ¾
 */
const PageLoader: React.FC = () => (
  <div className="flex items-center justify-center h-screen bg-[#101922]">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-gray-400 text-sm">Ò³Ãæ¼ÓÔØÖÐ...</span>
    </div>
  </div>
);

/**
 * ÊÓÍ¼ÇÐ»»°´Å¥×é¼þ
 * ¹Ì¶¨ÔÚÓÒÏÂ½Ç£¬ÓÃÓÚÔÚ²»Í¬ÊÓÍ¼¼äÇÐ»»
 */
const ViewSwitcher: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isTech = location.pathname === '/tech';
  const isMapDemo = location.pathname === '/map-demo';
  const isGlobal = location.pathname === '/global';
  const isTopology = location.pathname === '/topology';
  const isMapTopology = location.pathname === '/map-topology';

  // µØÍ¼ÑÝÊ¾Ò³Ãæ²»ÏÔÊ¾ÇÐ»»°´Å¥
  if (isMapDemo) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 group">
      <div className="absolute bottom-full right-0 mb-2 px-3 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
        ÇÐ»»ÕýÊ½Ö÷·ÂÕæÒ³ / µ÷ÊÔÒ³
      </div>

      <button
        onClick={() => navigate('/map-topology')}
        className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${isMapTopology
          ? 'bg-teal-600 text-white shadow-teal-500/50'
          : 'bg-gray-700 text-white hover:bg-teal-500'
          }`}
        title="µÚÒ»ÕÅÍ¼Ö÷·ÂÕæÈë¿Ú"
      >
        <span className="material-symbols-outlined text-2xl">conversion_path</span>
      </button>

      <button
        onClick={() => navigate('/topology')}
        className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${isTopology
          ? 'bg-cyan-600 text-white shadow-cyan-500/50'
          : 'bg-gray-700 text-white hover:bg-cyan-500'
          }`}
        title="TopologyView µ÷ÊÔÒ³"
      >
        <span className="material-symbols-outlined text-2xl">hub</span>
      </button>


      <button
        onClick={() => navigate('/global')}
        className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${isGlobal
          ? 'bg-blue-600 text-white shadow-blue-500/50'
          : 'bg-gray-700 text-white hover:bg-blue-500'
          }`}
        title="È«¹ú¹ÜÍøÍ³Ò»ÊÓÍ¼"
      >
        <span className="material-symbols-outlined text-2xl">public</span>
      </button>

      <button
        onClick={() => navigate(isTech ? '/' : '/tech')}
        className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${isTech
          ? 'bg-corp-primary text-[#1d1a15] hover:bg-white'
          : 'bg-tech-primary text-white hover:bg-blue-400'
          }`}
        title="ÇÐ»» ¿Æ¼¼/ÕþÆó ÊÓÍ¼"
      >
        <span className="material-symbols-outlined text-2xl">
          {isTech ? 'domain' : 'terminal'}
        </span>
      </button>
    </div>
  );
};

/**
 * Ó¦ÓÃÖ÷×é¼þ
 * ÅäÖÃÂ·ÓÉºÍ Suspense ¼ÓÔØ×´Ì¬
 */
const AppContent: React.FC = () => {
  const location = useLocation();
  const isPopout = location.pathname.startsWith('/popout');

  // Èç¹û´¦ÓÚ¶ÀÁ¢µ¯³ö´°¿ÚÄ£Ê½£¬²»äÖÈ¾Ö÷Ó¦ÓÃµÄµþ¼Ó×é¼þ (²à±ßÀ¸/Switcher µÈ)
  if (isPopout) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/popout/assistant" element={<AiAssistantStandalone />} />
          <Route path="/popout/scada" element={<ScadaStandalone />} />
        </Routes>
      </Suspense>
    );
  }

  // ³£¹æÖ÷Ó¦ÓÃäÖÈ¾Âß¼­
  return (
    <>
      <ViewSwitcher />
      <AiAssistant />
      {/* ? Suspense °ü¹üÂ·ÓÉ£¬Ìá¹©ÀÁ¼ÓÔØ×´Ì¬ */}
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<CorpView />} />
          <Route path="/tech" element={<TechView />} />
          <Route path="/map-demo" element={<MapDemo />} />
          <Route path="/global" element={<GlobalPipelineView />} />
          <Route path="/topology" element={<TopologyView />} />
          <Route path="/map-topology" element={<MapTopologyView />} />
          <Route path="/topology-demo" element={<TopologyDemoView />} />
        </Routes>
      </Suspense>
    </>
  );
};

const App: React.FC = () => {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
};

export default App;


=====FILE=====

/**
 * µØÍ¼ÍØÆË¹ÜÀíÊÓÍ¼£¨¶ÀÁ¢Ò³Ãæ£©
 *
 * Ö»ÏÔÊ¾´¿ÍØÆË²ã£¨¼ò½àÔ²µã + Ö±Ïß£©£¬Òþ²ØËùÓÐÕ¾³¡/·§ÊÒµÄ¸´ÔÓÍ¼ÐÎ¡£
 * ¶ÀÁ¢ÓÚÈ«¹ú¹ÜÍøÍ³Ò»ÊÓÍ¼ºÍ Canvas ÍØÆËÊÓÍ¼¡£
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
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
import { MAINLINE_SCENARIOS } from '@/types/simulation'

// ================== ÀàÐÍ ==================
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

function formatDateTimeLabel(value?: string): string {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString('zh-CN', { hour12: false })
}

function formatSignedNumber(value: number, digits = 2): string {
    const sign = value > 0 ? '+' : ''
    return `${sign}${value.toFixed(digits)}`
}

const SOLVER_STATUS_LABELS: Record<'converged' | 'max_iter' | 'error', string> = {
    converged: 'ÒÑÊÕÁ²',
    max_iter: '´ïµ½µü´úÉÏÏÞ',
    error: 'Çó½âÊ§°Ü',
}

const FAILURE_LAYER_LABELS: Record<'frontend-consumption' | 'mapping-source-ids' | 'overlay-contract' | 'rendering-style', string> = {
    'frontend-consumption': 'ÏÈ²éÇ°¶ËÏû·Ñ²ã£¨MapTopologyView / Ãæ°å£©',
    'mapping-source-ids': 'ÔÙ²é source IDs µ½ overlay IDs µÄÓ³Éä',
    'overlay-contract': 'ÔÙ²é simulation-overlay ÆõÔ¼',
    'rendering-style': '×îºóÔÙ²éµØÍ¼ÑùÊ½ºÍäÖÈ¾¶ÔÏó',
}

const MAINLINE_SCENARIO_PLAYBOOK: Record<string, {
    focus: string
    success: string
    risk: string
    talk: string
}> = {
    steady_base: {
        focus: 'ÏÈ¿´Ö÷¸ÉÑ¹Á¦ºÍÁ÷Á¿ÊÇ²»ÊÇÆ½Ë³£¬È·ÈÏµÚÒ»ÕÅÍ¼ÄÜÎÈ¶¨ÅÜÍ¨¡£',
        success: '×Ü¹©¸ø¡¢×ÜÐèÇó¡¢Æ½¾ùÀûÓÃÂÊ¶¼ÄÜÕý³£Âä³öÀ´£¬¸æ¾¯Êý²»ÒªÍ»È»Éý¸ß¡£',
        risk: 'Èç¹û³£¹æÎÈÌ¬¶¼Ã»ÓÐ½á¹û£¬ºóÃæµÄÒì³£³¡¾°ÏÈ±ð½²£¬ÏÈ°ÑÕýÊ½·ÂÕæÅÜÍ¨¡£',
        talk: 'ÏÈÓÃ³£¹æÎÈÌ¬°ÑÖ÷Á´´òÍ¨£¬Ö¤Ã÷ÍØÆË¡¢ÎÈÌ¬Çó½âºÍÒ³Ãæ¶¼ÒÑ¾­Á¬ÉÏ¡£',
    },
    zhongwei_compressor_offline: {
        focus: 'ÖØµã¿´ÖÐÎÀÑ¹ÆøÕ¾Í£ÔËºó£¬ÉÏÏÂÓÎÑ¹Á¦ÓÐÃ»ÓÐÃ÷ÏÔµôÂä¡£',
        success: '»ùÏß¶Ô±ÈÀïÄÜ¿´³ö½ÚµãÑ¹²î£¬ÃüÖÐ½ÚµãºÍ¸æ¾¯Êý»á±È³£¹æÎÈÌ¬¸üÃ÷ÏÔ¡£',
        risk: 'Èç¹ûÃ»Ñ¡»ùÏß¿ìÕÕ£¬Õâ¸ö³¡¾°Ö»ÄÜ¿´µ½µ±Ç°Öµ£¬¿´²»³öÍ£ÔËÇ°ºó²îÒì¡£',
        talk: 'ÕâÒ»Ä»Ö÷Òª½²Ñ¹ÆøÕ¾Òì³£ºó£¬Ö÷¸ÉÑ¹Á¦ÊÇÔõÃ´ÍùÉÏÏÂÓÎ´«µÝµÄ¡£',
    },
    zhongwei_trunk_break: {
        focus: 'ÖØµã¿´ÖÐÎÀ¸½½üÖ÷¸ÉÖÐ¶Ïºó£¬Á¬ÏßÁ÷Á¿ºÍÏÂÓÎ¹©¸øÔõÃ´±ä»¯¡£',
        success: '»ùÏß¶Ô±ÈÀïµÄÁ¬ÏßÁ÷Á¿±ä»¯»áºÜÍ»³ö£¬ÏÂÓÎÃüÖÐµãÏßºÍ¸æ¾¯»áÒ»ÆðÌ§Í·¡£',
        risk: 'Èç¹ûÓ³Éä¸²¸ÇÕªÒªÀïÃüÖÐ²»×ã£¬Õâ¸ö³¡¾°»á¿´²»Çå³þ¶ÏµãÓ°ÏìÏÈ´«µ½ÄÄ¡£',
        talk: 'ÕâÒ»Ä»½²Ö÷¸É¹ÊÕÏ´«²¥£¬×îÊÊºÏÄÃÀ´ÑÝÊ¾µÚÒ»ÕÅÍ¼µÄºËÐÄ¼ÛÖµ¡£',
    },
    yanchi_jingbian_limited: {
        focus: 'ÖØµã¿´ÑÎ³Øµ½¾¸±ßÏÞÁ÷ºó£¬ÀûÓÃÂÊºÍ¹Ø¼ü¶Î¸ºÔØÓÐÃ»ÓÐÌ§Éý¡£',
        success: 'ÔËÐÐ½á¹ûÕªÒªÀïÆ½¾ùÀûÓÃÂÊ»á±ä»¯£¬Á¬ÏßÏêÇéÀïµÄÀûÓÃÂÊ²îÖµÄÜ¿´³öÀ´¡£',
        risk: 'Èç¹ûµ±Ç°³¡¾°Ã»Áô¿ìÕÕ£¬Ö»¿¿Ò»´ÎÔËÐÐ½á¹û£¬²»ÊÊºÏÄÃÀ´×öÎÈ¶¨ÑéÊÕ¡£',
        talk: 'ÕâÒ»Ä»½²ÏÞÁ÷£¬²»ÊÇ¶ÏÊä£¬¶øÊÇÖ÷¸É»¹ÄÜÅÜµ«ÔËÐÐ±ß½ç¿ªÊ¼±ä½ô¡£',
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

// ================== ÍØÆËÑùÊ½£¨¼«¼òÔ²µã + ÑÕÉ«Çø·Ö£© ==================
const TOPO_COLORS: Record<PointType, string> = {
    compressor: '#FF9800',
    distribution: '#2196F3',
    junction: '#00e5ff',
    station: '#F44336',
    valve: '#9E9E9E',
}

const TOPO_LABELS: Record<PointType, string> = {
    compressor: 'Ñ¹ÆøÕ¾',
    distribution: '·ÖÊäÕ¾',
    junction: '½»»ãÊàÅ¦',
    station: 'Õ¾³¡',
    valve: '·§ÊÒ',
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
const JUNCTION_READONLY_HINT = 'µ±Ç°ÊàÅ¦ÓÉÔËÐÐÊ±ÖØ±à½á¹ûÎ¬»¤£¬±à¼­Æ÷½öÖ§³ÖÖ»¶Á²é¿´£¬²»ÔÙÒÔÊÖ¹¤ÄóºÏ×÷ÎªÖ÷Á÷³Ì¡£'
const JUNCTION_MODE_LABELS: Record<string, string> = {
    runtime_readonly: 'Ö»¶ÁÄ£Ê½',
    legacy_editable: '¾ÉÁ÷³Ì¼æÈÝ',
}

const LINE_COLOR = '#34d399'
const LINE_WEIGHT = 2

/** ´Ó PipelineNode.type (NodeType Ã¶¾ÙÖµ£¬¾ùÎªÐ¡Ð´) Ó³Éäµ½±à¼­Æ÷ PointType */
const TYPE_MAP: Record<string, PointType> = {
    regulator: 'compressor',
    metering: 'distribution',
    valve: 'valve',
    junction: 'junction',
    // NOTE: sj4 µÈÐÂÊý¾ÝÎÄ¼þÖ±½ÓÊ¹ÓÃ compressor/distribution µÈÖµ
    compressor: 'compressor',
    distribution: 'distribution',
}

// ================== ´´½¨´¿ÍØÆËÔ²µã±ê¼Ç ==================
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

// ================== Ö÷×é¼þ ==================
const MapTopologyView: React.FC = () => {
    const location = useLocation()
    const [mapInstance, setMapInstance] = useState<any>(null)
    const handleMapLoad = useCallback((map: any) => setMapInstance(map), [])
    const importedOnceRef = useRef(false)
    const appliedFocusNodeRef = useRef<string | null>(null)

    // ¹ÜÏßÊý¾ÝÒì²½¼ÓÔØ
    const [pipelines, setPipelines] = useState<PipelinePackage[]>([])
    useEffect(() => {
        loadAllPipelines()
            .then(data => setPipelines(data))
            .catch(err => console.error('[MapTopologyView] ¹ÜÏßÊý¾Ý¼ÓÔØÊ§°Ü:', err))
    }, [])

    // ±à¼­Æ÷×´Ì¬
    const [baseTopoNodes, setBaseTopoNodes] = useState<BaseTopoNode[]>([])
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
    const [statusMsg, setStatusMsg] = useState('µã»÷¡¸µ¼ÈëÍØÆË¡¹¼ÓÔØÒÑÓÐ¹ÜÏß')
    const [selectedMergeNodeIds, setSelectedMergeNodeIds] = useState<string[]>([])
    const [mergeJunctionName, setMergeJunctionName] = useState('')
    const [mergeJunctionDescription, setMergeJunctionDescription] = useState('')
    const [isMerging, setIsMerging] = useState(false)
    const [deletingJunctionId, setDeletingJunctionId] = useState<number | null>(null)
    const [activeTab, setActiveTab] = useState<PanelTab>('simulation')
    const [searchText, setSearchText] = useState('')
    const [report, setReport] = useState<ValidationReport | null>(null)
    const [centralityData, setCentralityData] = useState<Array<{ id: string; name: string; value: number }>>([])

    const [selectedNode, setSelectedNode] = useState<TopoNode | null>(null)
    const [historyChartTarget, setHistoryChartTarget] = useState<null | {
        stationName?: string
        junctionId?: string
        displayName?: string
    }>(null)

    // ³·ÏúÕ»
    type UndoAction =
        | { type: 'add-node'; nodeId: string }
        | { type: 'add-edge'; edgeId: string }
        | { type: 'create-junction'; junctionId: number; name: string }
        | { type: 'delete-junction'; group: JunctionGroup }
    const [undoStack, setUndoStack] = useState<UndoAction[]>([])

    // ½Ø¶Ï·ÂÕæ×´Ì¬
    const [cutoffNodeId, setCutoffNodeId] = useState<string | null>(null)
    const [cutoffResult, setCutoffResult] = useState<CutoffResult | null>(null)
    const [cutoffSearch, setCutoffSearch] = useState('')

    // ±£´æ»úÖÆ£º¸ú×ÙÍÏ×§ÐÞ¸ÄµÄ×ø±ê
    const [dirtyPositions, setDirtyPositions] = useState<Map<string, [number, number]>>(new Map())
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
        clearOverlay: cle…49820 tokens truncated…e="value" style={{ color: selectedNode.hasConnection ? '#34d399' : '#f87171' }}>
                                    {selectedNode.hasConnection ? '? ÒÑÁ¬½Ó' : '? ¹ÂÁ¢'}
                                </span>
                            </div>
                            <div className="detail-row">
                                <span className="label">¹Ø¼ü½Úµã</span>
                                <span className="value" style={{ color: criticalSetRef.current.has(selectedNode.id) ? '#fbbf24' : '#94a3b8' }}>
                                    {criticalSetRef.current.has(selectedNode.id) ? '¡ï ÊÇ' : '·ñ'}
                                </span>
                            </div>
                        </div>
                        <div className="detail-section">
                            <h4>¹ÜÏßÁ¬½Ó ({getNodeConnections(selectedNode.id).length})</h4>
                            <ul className="detail-connections">
                                {getNodeConnections(selectedNode.id).map(conn => {
                                    const otherId = conn.source === selectedNode.id ? conn.target : conn.source;
                                    const otherNode = rawData?.nodes.find(n => n.id === otherId);
                                    const dir = conn.source === selectedNode.id ? '¡ú' : '¡û';
                                    return (
                                        <li key={conn.id}>
                                            <span className="material-symbols-outlined">{conn.category === 'trunk' ? 'route' : 'alt_route'}</span>
                                            {dir} {otherNode?.name || otherId}
                                            <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 11 }}>{conn.lengthKm}km</span>
                                        </li>
                                    );
                                })}
                                {getNodeConnections(selectedNode.id).length === 0 && (
                                    <li style={{ color: '#f87171' }}>
                                        <span className="material-symbols-outlined">link_off</span>
                                        ÎÞ¹ÜÏßÁ¬½Ó
                                    </li>
                                )}
                            </ul>
                        </div>
                        {/* ÐÂÔö£ºÊàÅ¦ÄÚ²¿·ÖÁ¿Õ¹Ê¾ */}
                        {selectedNode.properties?.is_super_junction && (
                            <div className="detail-section">
                                <h4>µ÷¶È·ÖÁ¿Åä±È (»ùÓÚ¹Ü¾¶È¨ÖØ)</h4>
                                {(() => {
                                    const conns = getNodeConnections(selectedNode.id);
                                    const inflows = conns.filter(c => c.target === selectedNode.id);
                                    const outflows = conns.filter(c => c.source === selectedNode.id);
                                    const totalInWeight = inflows.reduce((sum, c) => sum + Math.pow(c.diameterMm || 600, 2), 0) || 1;
                                    const totalOutWeight = outflows.reduce((sum, c) => sum + Math.pow(c.diameterMm || 600, 2), 0) || 1;
                                    
                                    return (
                                        <div className="dispatch-components">
                                            {/* ½øÆøÁ÷ÏòÇøÓò */}
                                            <div style={{marginBottom: 10}}>
                                                <div style={{fontSize: 12, color: '#94a3b8', marginBottom: 4}}>½øÆøÅä±È (Inflow)</div>
                                                {inflows.map(c => {
                                                    const w = Math.pow(c.diameterMm || 600, 2);
                                                    const pct = ((w / totalInWeight) * 100).toFixed(1);
                                                    return (
                                                        <div key={c.id} style={{display: 'flex', alignItems: 'center', marginBottom: 4, fontSize: 11}}>
                                                            <div style={{width: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 4, color: '#10b981'}} title={c.name}>{c.name}</div>
                                                            <div style={{flex: 1, height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden', marginRight: 8}}>
                                                                <div style={{width: `${pct}%`, height: '100%', background: '#10b981'}} />
                                                            </div>
                                                            <div style={{width: 35, textAlign: 'right'}}>{pct}%</div>
                                                        </div>
                                                    );
                                                })}
                                                {inflows.length === 0 && <div style={{fontSize: 11, color: '#64748b'}}>ÎÞ½øÆø¹ÜÏß</div>}
                                            </div>
                                            {/* ³öÆøÁ÷ÏòÇøÓò */}
                                            <div>
                                                <div style={{fontSize: 12, color: '#94a3b8', marginBottom: 4}}>³öÆøÅä±È (Outflow)</div>
                                                {outflows.map(c => {
                                                    const w = Math.pow(c.diameterMm || 600, 2);
                                                    const pct = ((w / totalOutWeight) * 100).toFixed(1);
                                                    return (
                                                        <div key={c.id} style={{display: 'flex', alignItems: 'center', marginBottom: 4, fontSize: 11}}>
                                                            <div style={{width: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 4, color: '#3b82f6'}} title={c.name}>{c.name}</div>
                                                            <div style={{flex: 1, height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden', marginRight: 8}}>
                                                                <div style={{width: `${pct}%`, height: '100%', background: '#3b82f6'}} />
                                                            </div>
                                                            <div style={{width: 35, textAlign: 'right'}}>{pct}%</div>
                                                        </div>
                                                    );
                                                })}
                                                {outflows.length === 0 && <div style={{fontSize: 11, color: '#64748b'}}>ÎÞ³öÆø¹ÜÏß</div>}
                                            </div>
                                            {/* ÄÚ²¿Ô­½ÚµãÁÐ±í */}
                                            <div style={{marginTop: 8, fontSize: 11, color: '#64748b', background: '#0f172a', padding: 6, borderRadius: 4}}>
                                                <strong>ÄÚ²¿ºÏ²¢Õ¾³¡:</strong> {selectedNode.properties.original_stations?.join(', ') || 'Î´Öª'}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
        <SimPanel
            scenarioId={currentScenario}
            scenarios={MAINLINE_SCENARIOS}
            isLoading={simLoading}
            snapshotLoading={snapshotLoading}
            baselineSnapshotLoading={baselineSnapshotLoading}
            error={simError}
            snapshotError={snapshotError}
            overlay={overlay}
            snapshots={snapshots}
            selectedSnapshotRunId={selectedSnapshotRunId}
            baselineSnapshotRunId={baselineSnapshotRunId}
            trialRunScenarioId={trialRunScenarioId}
            bulkTrialRunActive={bulkTrialRunActive}
            comparison={comparison}
            trialRunItems={trialRunItems}
            onScenarioChange={setScenario}
            onSnapshotSelect={setSelectedSnapshotRunId}
            onBaselineSnapshotSelect={setBaselineSnapshotRunId}
            onRun={runSimulation}
            onSaveSnapshot={saveSnapshot}
            onRefreshSnapshots={refreshSnapshots}
            onLoadSnapshot={loadSelectedSnapshot}
            onRunTrialScenario={runTrialScenario}
            onRunMissingTrialScenarios={runMissingTrialScenarios}
            onClear={clearOverlay}
        />
        </>
    );
};

export default TopologyView;


=====FILE=====

import { useLocation } from 'react-router-dom'
import { useAssistantRuntimeContext } from './runtimeAssistantContext'

export interface AssistantChatContext {
    page?: string
    route?: string
    title?: string
    module?: string
    summary?: string
    selection?: Record<string, unknown>
    filters?: Record<string, unknown>
}

const PAGE_CONTEXT_MAP: Record<string, Omit<AssistantChatContext, 'route' | 'title'>> = {
    '/': {
        page: 'corp-dashboard',
        module: 'overview',
        summary: 'Enterprise overview dashboard for high-level metrics and station distribution.',
    },
    '/tech': {
        page: 'tech-dashboard',
        module: 'overview',
        summary: 'Technical operations dashboard for system capability and monitoring analysis.',
    },
    '/global': {
        page: 'global-pipeline',
        module: 'pipeline-analysis',
        summary: 'Nationwide pipeline overview for network scope, history trends, and station status.',
    },
    '/topology': {
        page: 'topology-canvas',
        module: 'topology-analysis',
        summary: 'Debug-only topology canvas for raw graph inspection, overlay troubleshooting, and structure questions.',
    },
    '/map-topology': {
        page: 'map-topology',
        module: 'topology-analysis',
        summary: 'Primary WE1 simulation entry on the first map for scenario runs, snapshots, baseline comparison, and coverage review.',
    },
    '/topology-demo': {
        page: 'topology-demo',
        module: 'topology-analysis',
        summary: 'Topology demo page for presentation-oriented data and structure review.',
    },
    '/popout/assistant': {
        page: 'assistant-popout',
        module: 'assistant',
        summary: 'Standalone AI assistant window that reuses the main workspace context.',
    },
}

export function useAiAssistantPageContext(): AssistantChatContext {
    const location = useLocation()
    const runtimeContext = useAssistantRuntimeContext()
    const descriptor = PAGE_CONTEXT_MAP[location.pathname] || {
        page: 'generic-page',
        module: 'generic',
        summary: 'Generic page context. Start with the user question and infer intent from the current route.',
    }

    return {
        ...descriptor,
        route: location.pathname,
        title: typeof document !== 'undefined' ? document.title : descriptor.page,
        selection: runtimeContext.selection || {},
        filters: runtimeContext.filters || {},
    }
}


=====SEARCH=====

F:/smartgas-grid/src\App.tsx:10:const TopologyView = lazy(() => import('./views/TopologyView'));
F:/smartgas-grid/src\App.tsx:11:const MapTopologyView = lazy(() => import('./views/MapTopologyView'));
F:/smartgas-grid/src\App.tsx:50:        åˆ‡æ¢æ­£å¼ä¸»ä»¿çœŸé¡µ / è°ƒè¯•é¡µ
F:/smartgas-grid/src\App.tsx:59:        title="ç¬¬ä¸€å¼ å›¾ä¸»ä»¿çœŸå…¥å£"
F:/smartgas-grid/src\App.tsx:70:        title="TopologyView è°ƒè¯•é¡µ"
F:/smartgas-grid/src\App.tsx:135:          <Route path="/topology" element={<TopologyView />} />
F:/smartgas-grid/src\App.tsx:136:          <Route path="/map-topology" element={<MapTopologyView />} />
F:/smartgas-grid/src\views\MapTopologyView.tsx:96:    'frontend-consumption': 'å…ˆæŸ¥å‰ç«¯æ¶ˆè´¹å±‚ï¼ˆMapTopologyView / é¢æ¿ï¼‰',
F:/smartgas-grid/src\views\MapTopologyView.tsx:224:const MapTopologyView: React.FC = () => {
F:/smartgas-grid/src\views\MapTopologyView.tsx:236:            .catch(err => console.error('[MapTopologyView] ç®¡çº¿æ•°æ®åŠ è½½å¤±è´¥:', err))
F:/smartgas-grid/src\views\MapTopologyView.tsx:305:        runSimulation: runSteadySimulation,
F:/smartgas-grid/src\views\MapTopologyView.tsx:306:        saveSnapshot: saveSteadySnapshot,
F:/smartgas-grid/src\views\MapTopologyView.tsx:308:        loadSelectedSnapshot: loadSteadySelectedSnapshot,
F:/smartgas-grid/src\views\MapTopologyView.tsx:310:        runMissingTrialScenarios: runSteadyMissingTrialScenarios,
F:/smartgas-grid/src\views\MapTopologyView.tsx:395:            console.error('[MapTopologyView] æž¢çº½ç»„åŠ è½½å¤±è´¥:', error)
F:/smartgas-grid/src\views\MapTopologyView.tsx:1398:    const simulationEntryHint = steadyOverlay
F:/smartgas-grid/src\views\MapTopologyView.tsx:1465:                                    await runSteadySimulation()
F:/smartgas-grid/src\views\MapTopologyView.tsx:1996:                                        <div className="text-[10px] uppercase tracking-wider text-cyan-200">ä¸»ä»¿çœŸå…¥å£</div>
F:/smartgas-grid/src\views\MapTopologyView.tsx:1997:                                        <div className="mt-1 text-xs leading-5 text-gray-300">{simulationEntryHint}</div>
F:/smartgas-grid/src\views\MapTopologyView.tsx:2011:                                                <button onClick={async () => { try { await loadSteadySelectedSnapshot(); setStatusMsg(`å·²åŠ è½½å¿«ç…§ï¼š${selectedSnapshotSummary?.scenario_id ?? steadySelectedSnapshotRunId}`) } catch (error) { setStatusMsg(error instanceof Error ? error.message : 'åŠ è½½å¿«ç…§å¤±è´¥') } }} disabled={!steadySelectedSnapshotRunId || steadySnapshotLoading} className="rounded-lg border border-cyan-500/30 bg-cyan-900/20 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40">{steadySnapshotLoading ? 'åŠ è½½ä¸­...' : 'åŠ è½½'}</button>
F:/smartgas-grid/src\views\MapTopologyView.tsx:2038:                                        <button onClick={async () => { try { await runSteadySimulation(); setStatusMsg(`WE1 ä¸»ä»¿çœŸå·²è¿è¡Œï¼š${steadyScenarioOption?.label ?? steadyScenarioId}`) } catch (error) { setStatusMsg(error instanceof Error ? error.message : 'WE1 ä¸»ä»¿çœŸè¿è¡Œå¤±è´¥') } }} disabled={steadySimLoading} className="rounded-lg bg-cyan-700/80 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">{steadySimLoading ? 'è¿è¡Œä¸­...' : 'è¿è¡Œä¸»ä»¿çœŸ'}</button>
F:/smartgas-grid/src\views\MapTopologyView.tsx:2039:                                        <button onClick={async () => { try { await saveSteadySnapshot(); setStatusMsg(`å·²ä¿å­˜å¿«ç…§ï¼š${steadyScenarioOption?.label ?? steadyScenarioId}`) } catch (error) { setStatusMsg(error instanceof Error ? error.message : 'ä¿å­˜å¿«ç…§å¤±è´¥') } }} disabled={!steadyOverlay || steadySnapshotLoading} className="rounded-lg border border-sky-500/30 bg-sky-900/20 px-3 py-2 text-xs font-medium text-sky-100 disabled:opacity-40">{steadySnapshotLoading ? 'ä¿å­˜ä¸­...' : 'ä¿å­˜å¿«ç…§'}</button>
F:/smartgas-grid/src\views\MapTopologyView.tsx:2054:                                <div className="rounded-lg border border-amber-500/20 bg-amber-950/10 p-3 space-y-3 text-[11px] text-gray-300"><div><div className="text-[10px] uppercase tracking-wider text-amber-200">è¯•è¿è¡Œè¦†ç›–</div><div className="mt-1 text-gray-400">æŠŠå…¸åž‹åœºæ™¯é€ä¸ªè¡¥è·‘å¹¶ç•™æ¡£ï¼Œæ–¹ä¾¿éªŒæ”¶æ—¶ä¸å†ä¸´åœºçŽ°è·‘ã€‚</div></div><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">å·²è¦†ç›–åœºæ™¯</div><div className="mt-1 font-semibold text-emerald-300">{trialCoverageSummary.coveredCount}</div></div><div className="rounded-lg bg-black/15 px-3 py-2"><div className="text-[10px] text-gray-500">å¾…è¡¥è·‘åœºæ™¯</div><div className="mt-1 font-semibold text-amber-300">{trialCoverageSummary.pendingCount}</div></div></div><button onClick={async () => { try { await runSteadyMissingTrialScenarios(); setStatusMsg('å·²è¡¥è·‘æ‰€æœ‰æœªç•™æ¡£çš„å…¸åž‹åœºæ™¯') } catch (error) { setStatusMsg(error instanceof Error ? error.message : 'æ‰¹é‡è¡¥è·‘å¤±è´¥') } }} disabled={steadyBulkTrialRunActive || steadyTrialRunItems.length === 0 || trialCoverageSummary.pendingCount === 0} className="w-full rounded-lg bg-amber-700/80 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">{steadyBulkTrialRunActive ? 'è¡¥è·‘ä¸­...' : 'ä¸€é”®è¡¥è·‘ç¼ºå¤±åœºæ™¯'}</button><div className="space-y-2">{steadyTrialRunItems.map(item => { const isRunning = steadyTrialRunScenarioId === item.scenario_id; return <div key={`trial-item-${item.scenario_id}`} className="rounded-lg bg-black/15 px-3 py-2"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-gray-100">{item.label}</div><div className="mt-1 text-[10px] text-gray-500">{item.covered ? `å·²ç•™æ¡£ ${item.snapshot_count} æ¡` : 'è¿˜æ²¡ç•™æ¡£'}</div><div className="mt-1 text-[10px] text-gray-500">æœ€è¿‘æ—¶é—´ï¼š{item.last_saved_at ? formatDateTimeLabel(item.last_saved_at) : '-'}</div></div><button onClick={async () => { try { await runSteadyTrialScenario(item.scenario_id); setStatusMsg(`å·²è¡¥è·‘åœºæ™¯ï¼š${item.label}`) } catch (error) { setStatusMsg(error instanceof Error ? error.message : 'å•åœºæ™¯è¡¥è·‘å¤±è´¥') } }} disabled={isRunning || steadyBulkTrialRunActive} className={`rounded-lg px-3 py-1 text-[10px] font-semibold ${item.covered ? 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-100' : 'border border-amber-400/20 bg-amber-500/10 text-amber-100'} disabled:opacity-40`}>{isRunning ? 'è¿è¡Œä¸­...' : item.covered ? 'é‡è·‘' : 'è¡¥è·‘'}</button></div></div> })}</div></div>
F:/smartgas-grid/src\views\MapTopologyView.tsx:2207:export default MapTopologyView
F:/smartgas-grid/src\views\TopologyView.tsx:481:const TopologyView: React.FC = () => {
F:/smartgas-grid/src\views\TopologyView.tsx:1503:                className="topology-canvas"
F:/smartgas-grid/src\views\TopologyView.tsx:1744:export default TopologyView;
F:/smartgas-grid/src\styles\topology-view.css:17:.topology-canvas {
F:/smartgas-grid/src\styles\topology-view.css:27:.topology-canvas:active {
F:/smartgas-grid/src\components\ai-assistant\useAiAssistantPageContext.ts:31:        page: 'topology-canvas',
ÎÞ·¨ÉèÖÃÊôÐÔ¡£´ËÓïÑÔÄ£Ê½½öÖ§³ÖºËÐÄÀàÐÍµÄÊôÐÔÉèÖÃ¡£
ËùÔÚÎ»ÖÃ ÐÐ:1 ×Ö·û: 1
+ [Console]::OutputEncoding=[System.Text.Encoding]::UTF8;
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : InvalidOperation: (:) []£¬RuntimeException
    + FullyQualifiedErrorId : PropertySetterNotSupportedInConstrainedLanguage
 
