import React, { useState } from 'react';
import MapView from '@/components/map-view';

const CorpView: React.FC = () => {
  const [activeTab, setActiveTab] = useState('Overview');

  return (
    <div className="bg-corp-bg-light dark:bg-corp-bg-dark text-[#111418] dark:text-white font-body overflow-hidden flex flex-col h-screen w-full transition-colors duration-300">
      {/* Header */}
      <header className="flex items-center justify-between whitespace-nowrap border-b border-solid border-[#e5e7eb] dark:border-[#283039] px-6 py-3 bg-white dark:bg-[#111418] z-30 shadow-sm relative">
        <div className="flex items-center gap-3">
          <div className="size-8 text-corp-primary flex items-center justify-center bg-corp-primary/10 rounded-lg">
            <span className="material-symbols-outlined text-2xl">propane</span>
          </div>
          <h2 className="text-[#111418] dark:text-white text-xl font-bold leading-tight tracking-[-0.015em] font-display">
            智慧管网 <span className="text-xs opacity-50 font-normal ml-2">政企版</span>
          </h2>
        </div>

        <nav className="hidden md:flex flex-1 justify-center gap-1">
          {['概览', '管网维护', '应急响应', '数据报表'].map((item) => (
            <button
              key={item}
              onClick={() => setActiveTab(item)}
              className={`text-sm font-medium leading-normal px-4 py-2 rounded-lg transition-all ${activeTab === item
                ? 'text-corp-primary bg-corp-primary/10'
                : 'text-[#637588] dark:text-[#9dabb9] hover:text-[#111418] dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#1c2127]'
                }`}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <button className="size-9 flex items-center justify-center rounded-full text-[#637588] dark:text-[#9dabb9] hover:text-corp-primary hover:bg-corp-primary/5 transition-colors">
            <span className="material-symbols-outlined text-[20px]">notifications</span>
          </button>
          <button className="size-9 flex items-center justify-center rounded-full text-[#637588] dark:text-[#9dabb9] hover:text-corp-primary hover:bg-corp-primary/5 transition-colors">
            <span className="material-symbols-outlined text-[20px]">settings</span>
          </button>
          <div className="h-6 w-px bg-[#e5e7eb] dark:bg-[#283039] mx-1"></div>
          <div
            className="bg-center bg-no-repeat aspect-square bg-cover rounded-full size-9 border-2 border-white dark:border-[#283039] shadow-sm cursor-pointer"
            style={{ backgroundImage: 'url("https://lh3.googleusercontent.com/aida-public/AB6AXuAyKCJNT_FwPyFtkxDxHdf3vavjPAVS2yHDARFm5ukhvOI3uOPI_VjK4r013WC982EC8qwrJLxIK6O0-K3VX7tgJM7x1Y9ySRl683ZfmIh1y7ydHtdMM0BXhjh7KWF-EU9TEFild-E3AosDxwgzAwBHEDfsztXyh3L3EftFkwdbFBa_laUAuPKMNA4XZEvm4fjLcXiCv2RSYCfLtPXigteb2tLoi-lM9Q9kOoNRtkyh4EHqf78f58e9C58eHvqElqbI2OHLvMBF5F2n")' }}
          />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative overflow-hidden bg-[#283039]">
        {/* 真实地图背景 */}
        <MapView
          config={{
            center: { longitude: 102.0, latitude: 25.0 }, // 云南地区中心
            zoom: 7,
            theme: 'light',
            draggable: true,
            zoomControl: true, // 启用缩放控制
            showScale: true,
            showCompass: false,
          }}
          className="absolute inset-0 z-0"
        />

        {/* Floating Controls */}
        <div className="absolute inset-0 z-10 pointer-events-none p-4 md:p-6 flex flex-col justify-between">
          <div className="flex justify-between items-start pointer-events-auto w-full gap-4">
            {/* Search Bar */}
            <div className="glass-panel-corp shadow-lg rounded-xl p-1 w-full max-w-md transition-all group focus-within:w-full focus-within:max-w-xl">
              <div className="flex items-center h-12">
                <div className="text-[#637588] dark:text-[#9dabb9] flex items-center justify-center pl-3 pr-2">
                  <span className="material-symbols-outlined">search</span>
                </div>
                <input
                  className="w-full bg-transparent border-none focus:ring-0 text-[#111418] dark:text-white placeholder:text-[#637588] dark:placeholder:text-[#9dabb9] text-base font-body"
                  placeholder="搜索管段、站场或区域..."
                />
                <div className="w-px h-6 bg-[#e5e7eb] dark:bg-[#3b4754] mx-1"></div>
                <button className="px-3 hover:bg-black/5 dark:hover:bg-white/5 rounded-md text-[#637588] dark:text-[#9dabb9] transition-colors">
                  <span className="material-symbols-outlined text-[20px]">tune</span>
                </button>
              </div>
            </div>

            {/* Map Tools */}
            <div className="flex flex-col gap-2">
              <div className="glass-panel-corp shadow-lg rounded-lg flex flex-col overflow-hidden">
                <button className="size-10 hover:bg-black/5 dark:hover:bg-white/5 text-[#111418] dark:text-white flex items-center justify-center border-b border-white/10 dark:border-[#283039] transition-colors">
                  <span className="material-symbols-outlined text-[24px]">add</span>
                </button>
                <button className="size-10 hover:bg-black/5 dark:hover:bg-white/5 text-[#111418] dark:text-white flex items-center justify-center transition-colors">
                  <span className="material-symbols-outlined text-[24px]">remove</span>
                </button>
              </div>
              <button className="glass-panel-corp shadow-lg rounded-lg size-10 hover:bg-black/5 dark:hover:bg-white/5 text-[#111418] dark:text-white flex items-center justify-center transition-colors">
                <span className="material-symbols-outlined text-[24px]">my_location</span>
              </button>
            </div>
          </div>

          {/* Legend */}
          <div className="flex justify-end pointer-events-auto">
            <div className="glass-panel-corp shadow-2xl rounded-xl p-5 w-72">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-[#111418] dark:text-white uppercase tracking-wider">图例</h3>
                <button className="text-[#637588] hover:text-[#111418] dark:text-[#9dabb9] dark:hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-[20px]">info</span>
                </button>
              </div>
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between group cursor-pointer hover:bg-white/5 p-1 rounded transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-1 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
                    <span className="text-sm text-[#111418] dark:text-white font-medium">运行中</span>
                  </div>
                  <span className="material-symbols-outlined text-green-500 text-[18px] opacity-0 group-hover:opacity-100 transition-opacity">check_circle</span>
                </div>
                <div className="flex items-center justify-between group cursor-pointer hover:bg-white/5 p-1 rounded transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-1 border-t-2 border-dashed border-yellow-500"></div>
                    <span className="text-sm text-[#111418] dark:text-white font-medium">维护中</span>
                  </div>
                  <span className="material-symbols-outlined text-yellow-500 text-[18px] opacity-0 group-hover:opacity-100 transition-opacity">engineering</span>
                </div>
                <div className="flex items-center justify-between group cursor-pointer hover:bg-white/5 p-1 rounded transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-red-500 text-[20px] animate-pulse">warning</span>
                    <span className="text-sm text-[#111418] dark:text-white font-medium">严重告警</span>
                  </div>
                  <span className="bg-red-500/10 text-red-500 text-[10px] font-bold px-1.5 py-0.5 rounded border border-red-500/20">新</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Stats */}
      <footer className="bg-white dark:bg-[#111418] border-t border-[#e5e7eb] dark:border-[#283039] z-20 px-6 py-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 max-w-[1600px] mx-auto">
          <div className="flex flex-wrap items-center gap-6 md:gap-12 flex-1">
            <div className="flex items-center gap-4 group cursor-pointer">
              <div className="size-12 rounded-xl bg-green-500/10 dark:bg-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400 border border-green-500/20 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined">health_metrics</span>
              </div>
              <div>
                <p className="text-[#637588] dark:text-[#9dabb9] text-xs font-medium uppercase tracking-wider mb-0.5">系统健康度</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-[#111418] dark:text-white text-2xl font-bold font-display leading-none">98.4%</p>
                  <span className="text-green-600 dark:text-green-400 text-sm font-medium bg-green-100 dark:bg-green-900/30 px-1.5 rounded">优</span>
                </div>
              </div>
            </div>

            <div className="hidden md:block w-px h-10 bg-[#e5e7eb] dark:bg-[#283039]"></div>

            <div className="flex items-center gap-4 group cursor-pointer">
              <div className="size-12 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 border border-blue-500/20 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined">timeline</span>
              </div>
              <div>
                <p className="text-[#637588] dark:text-[#9dabb9] text-xs font-medium uppercase tracking-wider mb-0.5">运行管线总长</p>
                <p className="text-[#111418] dark:text-white text-2xl font-bold font-display leading-none">
                  42,300 <span className="text-sm text-[#637588] dark:text-[#9dabb9] font-normal">km</span>
                </p>
              </div>
            </div>

            <div className="hidden md:block w-px h-10 bg-[#e5e7eb] dark:bg-[#283039]"></div>

            <div className="flex items-center gap-4 group cursor-pointer">
              <div className="size-12 rounded-xl bg-purple-500/10 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 border border-purple-500/20 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined">speed</span>
              </div>
              <div>
                <p className="text-[#637588] dark:text-[#9dabb9] text-xs font-medium uppercase tracking-wider mb-0.5">平均压力</p>
                <p className="text-[#111418] dark:text-white text-2xl font-bold font-display leading-none">
                  8.5 <span className="text-sm text-[#637588] dark:text-[#9dabb9] font-normal">MPa</span>
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-[#637588] dark:text-[#9dabb9] font-medium hidden lg:block">最近更新: 刚刚</span>
            <button className="bg-[#111418] dark:bg-white hover:bg-[#283039] dark:hover:bg-gray-200 text-white dark:text-[#111418] px-5 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 active:translate-y-0">
              <span className="material-symbols-outlined text-[20px]">description</span>
              生成报表
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default CorpView;