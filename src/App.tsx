import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import AiAssistant from './components/ai-assistant/AiAssistant';

// ✅ 路由级代码分割 - 动态导入视图组件
const CorpView = lazy(() => import('./views/CorpView'));
const TechView = lazy(() => import('./views/TechView'));
const MapDemo = lazy(() => import('./views/MapDemo'));
const GlobalPipelineView = lazy(() => import('./views/GlobalPipelineView'));
const WorkflowView = lazy(() => import('./views/WorkflowView'));
const TopologyView = lazy(() => import('./views/TopologyView'));
const MapTopologyView = lazy(() => import('./views/MapTopologyView'));

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
  const isTech = location.pathname === '/tech';
  const isMapDemo = location.pathname === '/map-demo';
  const isGlobal = location.pathname === '/global';
  const isWorkflow = location.pathname === '/workflow';
  const isTopology = location.pathname === '/topology';
  const isMapTopology = location.pathname === '/map-topology';

  // 地图演示页面不显示切换按钮
  if (isMapDemo) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 group">
      <div className="absolute bottom-full right-0 mb-2 px-3 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
        Switch Dashboard View
      </div>

      <button
        onClick={() => navigate('/map-topology')}
        className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${isMapTopology
          ? 'bg-teal-600 text-white shadow-teal-500/50'
          : 'bg-gray-700 text-white hover:bg-teal-500'
          }`}
        title="地图拓扑管理"
      >
        <span className="material-symbols-outlined text-2xl">conversion_path</span>
      </button>

      <button
        onClick={() => navigate('/topology')}
        className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${isTopology
          ? 'bg-cyan-600 text-white shadow-cyan-500/50'
          : 'bg-gray-700 text-white hover:bg-cyan-500'
          }`}
        title="Canvas 拓扑图"
      >
        <span className="material-symbols-outlined text-2xl">hub</span>
      </button>

      <button
        onClick={() => navigate('/workflow')}
        className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${isWorkflow
          ? 'bg-violet-600 text-white shadow-violet-500/50'
          : 'bg-gray-700 text-white hover:bg-violet-500'
          }`}
        title="AI 工作流"
      >
        <span className="material-symbols-outlined text-2xl">neurology</span>
      </button>

      <button
        onClick={() => navigate('/global')}
        className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${isGlobal
          ? 'bg-blue-600 text-white shadow-blue-500/50'
          : 'bg-gray-700 text-white hover:bg-blue-500'
          }`}
        title="全国管网统一视图"
      >
        <span className="material-symbols-outlined text-2xl">public</span>
      </button>

      <button
        onClick={() => navigate(isTech ? '/' : '/tech')}
        className={`size-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 ${isTech
          ? 'bg-corp-primary text-[#1d1a15] hover:bg-white'
          : 'bg-tech-primary text-white hover:bg-blue-400'
          }`}
        title="切换 科技/政企 视图"
      >
        <span className="material-symbols-outlined text-2xl">
          {isTech ? 'domain' : 'terminal'}
        </span>
      </button>
    </div>
  );
};

/**
 * 应用主组件
 * 配置路由和 Suspense 加载状态
 */
const App: React.FC = () => {
  return (
    <HashRouter>
      <ViewSwitcher />
      <AiAssistant />
      {/* ✅ Suspense 包裹路由，提供懒加载状态 */}
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<CorpView />} />
          <Route path="/tech" element={<TechView />} />
          <Route path="/map-demo" element={<MapDemo />} />
          <Route path="/global" element={<GlobalPipelineView />} />
          <Route path="/workflow" element={<WorkflowView />} />
          <Route path="/topology" element={<TopologyView />} />
          <Route path="/map-topology" element={<MapTopologyView />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
};

export default App;
