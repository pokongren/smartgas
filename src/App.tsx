import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import AiAssistant from './components/ai-assistant/AiAssistant';
import EmergencyPanel from './components/EmergencyPanel';
import { DEFAULT_WE1_PILOT_ID } from './types/simulation';

// ✅ 路由级代码分割 - 动态导入视图组件
const CorpView = lazy(() => import('./views/CorpView'));
const TechView = lazy(() => import('./views/TechView'));
const MapDemo = lazy(() => import('./views/MapDemo'));
const GlobalPipelineView = lazy(() => import('./views/GlobalPipelineView'));
const TopologyView = lazy(() => import('./views/TopologyView'));
const MapTopologyView = lazy(() => import('./views/MapTopologyView'));
const TopologyDemoView = lazy(() => import('./views/TopologyDemoView'));

// 独立弹窗组件
import { AiAssistantStandalone } from './components/ai-assistant/AiAssistant';
import { ScadaStandalone } from './views/GlobalPipelineView';

interface AppErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unknown render error',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[AppErrorBoundary] render crashed', error, info);
  }

  private handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    event.preventDefault();
    console.error('[AppErrorBoundary] unhandled rejection', event?.reason);
  };

  private handleWindowError = (event: ErrorEvent): void => {
    console.error('[AppErrorBoundary] window error', event?.error || event);
  };

  componentDidMount(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
    window.addEventListener('error', this.handleWindowError);
  }

  componentWillUnmount(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    window.removeEventListener('error', this.handleWindowError);
  }

  private handleReload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0b1220] px-6 text-white">
          <div className="w-full max-w-xl rounded-xl border border-red-400/30 bg-red-950/20 p-6">
            <div className="text-lg font-semibold">页面渲染异常，已拦截白屏</div>
            <div className="mt-3 break-all text-sm text-red-100">{this.state.message}</div>
            <button
              onClick={this.handleReload}
              className="mt-5 rounded-lg border border-red-300/40 bg-red-700/60 px-4 py-2 text-sm hover:bg-red-700"
            >
              刷新重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * 页面加载状态组件
 * 在视图组件懒加载时显示
 */
const PageLoader: React.FC = () => (
  <div className="flex items-center justify-center h-screen bg-[#101922]">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-gray-400 text-sm">页面加载中...</span>
    </div>
  </div>
);

/**
 * 视图切换按钮组件
 * 固定在右下角，用于在不同视图间切换
 */
const ViewSwitcher: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [expanded, setExpanded] = React.useState(false);
  const [showEmergencyPanel, setShowEmergencyPanel] = React.useState(false);
  const isMapDemo = location.pathname === '/map-demo';
  const isGlobal = location.pathname === '/global';
  const isTopology = location.pathname === '/topology';
  const isMapTopology = location.pathname === '/map-topology';

  // 地图演示页面不显示切换按钮
  if (isMapDemo) return null;

  return (
    <>
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-3 group">
        {expanded && (
          <div className="flex flex-col items-end gap-3 animate-fade-in-up">
            <div className="px-3 py-1 bg-black/80 text-white text-xs rounded whitespace-nowrap">
              页面入口
            </div>

            <button
              onClick={() => {
                setShowEmergencyPanel(true);
                setExpanded(false);
              }}
              className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${showEmergencyPanel
                ? 'bg-amber-600 text-white shadow-amber-500/50'
                : 'bg-gray-700 text-white hover:bg-amber-500'
                }`}
              title="事件/应急指挥"
            >
              <span className="material-symbols-outlined text-2xl">emergency_home</span>
            </button>

            <button
              onClick={() => {
                navigate(`/map-topology?pilotId=${DEFAULT_WE1_PILOT_ID}`);
                setExpanded(false);
              }}
              className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${isMapTopology
                ? 'bg-teal-600 text-white shadow-teal-500/50'
                : 'bg-gray-700 text-white hover:bg-teal-500'
                }`}
              title="第一张图主仿真入口"
            >
              <span className="material-symbols-outlined text-2xl">conversion_path</span>
            </button>

            <button
              onClick={() => {
                navigate(`/topology?pilotId=${DEFAULT_WE1_PILOT_ID}`);
                setExpanded(false);
              }}
              className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${isTopology
                ? 'bg-cyan-600 text-white shadow-cyan-500/50'
                : 'bg-gray-700 text-white hover:bg-cyan-500'
                }`}
              title="WE1 第三张图展示页"
            >
              <span className="material-symbols-outlined text-2xl">hub</span>
            </button>

            <button
              onClick={() => {
                navigate('/global');
                setExpanded(false);
              }}
              className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${isGlobal
                ? 'bg-blue-600 text-white shadow-blue-500/50'
                : 'bg-gray-700 text-white hover:bg-blue-500'
                }`}
              title="全国管网统一视图"
            >
              <span className="material-symbols-outlined text-2xl">public</span>
            </button>
          </div>
        )}

        <button
          onClick={() => setExpanded((value) => !value)}
          className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${expanded
            ? 'bg-slate-700 text-white shadow-slate-500/40'
            : 'bg-cyan-600 text-white shadow-cyan-500/50 hover:bg-cyan-500'
            }`}
          title={expanded ? '收起页面入口' : '呼出页面入口'}
          aria-expanded={expanded}
          aria-label={expanded ? '收起页面入口' : '呼出页面入口'}
        >
          <span className="material-symbols-outlined text-2xl">
            {expanded ? 'close' : 'apps'}
          </span>
        </button>
      </div>

      {showEmergencyPanel && (
        <EmergencyPanel onClose={() => setShowEmergencyPanel(false)} />
      )}
    </>
  );
};

/**
 * 应用主组件
 * 配置路由和 Suspense 加载状态
 */
const AppContent: React.FC = () => {
  const location = useLocation();
  const isPopout = location.pathname.startsWith('/popout');
  const hideAiAssistantOnHeavyPage = location.pathname === '/map-topology';

  // 如果处于独立弹出窗口模式，不渲染主应用的叠加组件 (侧边栏/Switcher 等)
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

  // 常规主应用渲染逻辑
  return (
    <>
      <ViewSwitcher />
      {!hideAiAssistantOnHeavyPage && <AiAssistant />}
      {/* ✅ Suspense 包裹路由，提供懒加载状态 */}
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
      <AppErrorBoundary>
        <AppContent />
      </AppErrorBoundary>
    </HashRouter>
  );
};

export default App;
