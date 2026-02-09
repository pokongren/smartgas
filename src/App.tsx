import React from 'react';
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import CorpView from './views/CorpView';
import TechView from './views/TechView';
import MapDemo from './views/MapDemo';
import GlobalPipelineView from './views/GlobalPipelineView';

const ViewSwitcher = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isTech = location.pathname === '/tech';
  const isMapDemo = location.pathname === '/map-demo';
  const isGlobal = location.pathname === '/global';

  // 地图演示页面不显示切换按钮
  if (isMapDemo) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 group">
      <div className="absolute bottom-full right-0 mb-2 px-3 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
        Switch Dashboard View
      </div>
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

const App: React.FC = () => {
  return (
    <HashRouter>
      <ViewSwitcher />
      <Routes>
        <Route path="/" element={<CorpView />} />
        <Route path="/tech" element={<TechView />} />
        <Route path="/map-demo" element={<MapDemo />} />
        <Route path="/global" element={<GlobalPipelineView />} />
      </Routes>
    </HashRouter>
  );
};

export default App;