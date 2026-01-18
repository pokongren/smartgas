import React, { useState } from 'react';
import MapView from '@/components/map-view';

const TechView: React.FC = () => {
  const [layers, setLayers] = useState({ highVoltage: true, distribution: false, storage: true, maintenance: false });

  const toggleLayer = (key: keyof typeof layers) => setLayers(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="flex flex-col h-screen w-full bg-tech-bg text-slate-200 font-display overflow-hidden">
      {/* Tech Header */}
      <header className="flex-none h-16 border-b border-tech-border bg-tech-panel flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 text-white">
            <div className="size-8 text-tech-primary">
              <span className="material-symbols-outlined !text-[32px]">hub</span>
            </div>
            <div>
              <h2 className="text-white text-lg font-bold leading-tight tracking-tight uppercase">全国天然气管网</h2>
              <p className="text-xs text-slate-400 font-medium tracking-wider">监测系统 V2.4</p>
            </div>
          </div>
          <div className="hidden md:flex ml-8 relative group">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="material-symbols-outlined text-slate-400">search</span>
            </div>
            <input
              className="block w-80 bg-[#111418] border border-tech-border text-slate-200 text-sm rounded-lg focus:ring-tech-primary focus:border-tech-primary pl-10 p-2.5 placeholder-slate-500 transition-all focus:w-96"
              placeholder="搜索管段、站场ID或区域"
              type="text"
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            <button className="relative p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/5">
              <span className="material-symbols-outlined">notifications</span>
              <span className="absolute top-2 right-2 size-2 bg-tech-alert-high rounded-full animate-pulse"></span>
            </button>
            <button className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/5">
              <span className="material-symbols-outlined">settings</span>
            </button>
          </div>
          <div className="h-8 w-px bg-tech-border mx-2"></div>
          <button className="flex items-center gap-3 pl-2 pr-4 py-1.5 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-tech-border">
            <div className="size-8 rounded-full bg-gradient-to-br from-tech-primary to-blue-700 flex items-center justify-center text-xs font-bold text-white shadow-lg shadow-tech-primary/20">
              OP
            </div>
            <div className="flex flex-col items-start hidden lg:flex">
              <span className="text-xs font-bold text-white leading-none mb-1">操作员 051</span>
              <span className="text-[10px] text-tech-primary font-medium tracking-wider uppercase leading-none">4级权限</span>
            </div>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar */}
        <aside className="w-80 flex-none bg-tech-panel border-r border-tech-border flex flex-col z-40 shadow-xl overflow-y-auto custom-scrollbar">
          <div className="p-5 border-b border-tech-border">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">可见图层</h3>
            <div className="space-y-1">
              {[
                { id: 'highVoltage', label: '高压管网', icon: 'hub', color: 'text-tech-primary' },
                { id: 'distribution', label: '配气网络', icon: 'account_tree', color: 'text-tech-alert-med' },
                { id: 'storage', label: '储气设施', icon: 'factory', color: 'text-purple-400' },
                { id: 'maintenance', label: '检修区域', icon: 'construction', color: 'text-slate-500' },
              ].map((layer) => (
                <label key={layer.id} className="flex items-center justify-between p-3 rounded-lg bg-transparent border border-transparent hover:bg-[#111418] hover:border-slate-700 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <span className={`material-symbols-outlined ${layer.color}`}>{layer.icon}</span>
                    <span className="text-sm font-medium text-slate-400 group-hover:text-slate-200">{layer.label}</span>
                  </div>
                  <input
                    checked={layers[layer.id as keyof typeof layers]}
                    onChange={() => toggleLayer(layer.id as keyof typeof layers)}
                    className="rounded border-slate-600 bg-[#283039] text-tech-primary focus:ring-offset-0 focus:ring-0"
                    type="checkbox"
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="p-5 flex-1">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">视图过滤</h3>
            <div className="space-y-6">
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-2">
                  <span>透明度</span>
                  <span>85%</span>
                </div>
                <input className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-tech-primary" max="100" min="0" type="range" defaultValue="85" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-2 block">区域聚焦</label>
                <select className="w-full bg-[#111418] border border-tech-border text-slate-200 text-sm rounded-lg focus:ring-tech-primary focus:border-tech-primary p-2.5">
                  <option>所有区域</option>
                  <option>东北走廊</option>
                  <option>南部沿海</option>
                  <option>西部管线</option>
                </select>
              </div>
              <div className="pt-4 border-t border-tech-border">
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-slate-400 text-sm">info</span>
                  <span className="text-xs text-slate-400">地图更新时间: <span className="text-white font-mono">14:02:45 UTC</span></span>
                </div>
                <button className="w-full py-2 px-4 bg-tech-primary hover:bg-blue-600 text-white text-sm font-bold rounded-lg transition-all shadow-lg shadow-tech-primary/20 flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-sm">refresh</span>
                  刷新数据
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* Center Map */}
        <section className="flex-1 relative bg-black">
          {/* 真实地图背景 */}
          <MapView
            config={{
              center: { longitude: 102.0, latitude: 25.0 }, // 云南地区中心(昆明附近)
              zoom: 7, // 调整缩放级别以显示整个区域
              theme: 'dark',
              draggable: true,
              zoomControl: true, // 启用缩放控制
              showScale: true,
              showCompass: false,
            }}
            className="absolute inset-0 z-0"
          />
          {/* 渐变覆盖层增强视觉效果 */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#101922]/60 via-transparent to-[#101922]/80 pointer-events-none z-[1]"></div>

          {/* Map Controls */}
          <div className="absolute top-6 right-6 flex flex-col gap-2 z-10">
            {/* 缩放控件已由高德地图自带,移除自定义按钮 */}
            {/* <div className="bg-tech-panel/90 backdrop-blur border border-tech-border rounded-lg shadow-lg flex flex-col overflow-hidden">
              <button className="p-2 text-slate-300 hover:text-white hover:bg-white/10 transition-colors border-b border-tech-border">
                <span className="material-symbols-outlined">add</span>
              </button>
              <button className="p-2 text-slate-300 hover:text-white hover:bg-white/10 transition-colors">
                <span className="material-symbols-outlined">remove</span>
              </button>
            </div> */}
            <button className="p-2 bg-tech-panel/90 backdrop-blur border border-tech-border rounded-lg shadow-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors">
              <span className="material-symbols-outlined">3d_rotation</span>
            </button>
            <button className="p-2 bg-tech-panel/90 backdrop-blur border border-tech-border rounded-lg shadow-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors">
              <span className="material-symbols-outlined">my_location</span>
            </button>
          </div>

          {/* Bottom Stats Overlay */}
          <div className="absolute bottom-6 left-6 right-6 z-10 grid grid-cols-1 md:grid-cols-4 gap-4 pointer-events-none">
            <div className="glass-panel-tech p-4 rounded-lg shadow-lg pointer-events-auto flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-xs font-medium uppercase mb-1">总流量</p>
                <p className="text-white text-xl font-bold font-mono tracking-tight">45,230 <span className="text-sm font-normal text-slate-500">m³/h</span></p>
              </div>
              <span className="text-tech-primary text-sm font-bold bg-tech-primary/10 px-2 py-1 rounded border border-tech-primary/20">+1.2%</span>
            </div>
            <div className="glass-panel-tech p-4 rounded-lg shadow-lg pointer-events-auto flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-xs font-medium uppercase mb-1">系统压力</p>
                <p className="text-white text-xl font-bold font-mono tracking-tight">68.4 <span className="text-sm font-normal text-slate-500">Bar</span></p>
              </div>
              <span className="text-emerald-400 text-sm font-bold bg-emerald-400/10 px-2 py-1 rounded border border-emerald-400/20">正常</span>
            </div>
            <div className="glass-panel-tech p-4 rounded-lg shadow-lg pointer-events-auto flex items-center justify-between md:col-span-2">
              <div>
                <p className="text-slate-400 text-xs font-medium uppercase mb-1">活动告警</p>
                <div className="flex items-center gap-2">
                  <span className="flex size-2 rounded-full bg-tech-alert-high animate-pulse"></span>
                  <p className="text-white text-sm font-medium">检测到 7-G 扇区压力下降</p>
                </div>
              </div>
              <button className="text-xs text-tech-primary hover:text-white underline">查看日志</button>
            </div>
          </div>
        </section>

        {/* Right Sidebar */}
        <aside className="w-96 flex-none bg-tech-panel border-l border-tech-border flex flex-col z-40 shadow-xl overflow-y-auto custom-scrollbar">
          <div className="p-5 border-b border-tech-border flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">实时数据</h3>
            <span className="flex size-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
          </div>
          <div className="flex-1 p-5 space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm text-white font-medium">消耗趋势 (24h)</h4>
                <span className="text-xs text-slate-400">平均: 41k m³</span>
              </div>
              <div className="h-32 w-full bg-[#111418] rounded-lg border border-tech-border p-4 relative overflow-hidden">
                <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 300 100">
                  <defs>
                    <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#137fec" stopOpacity="0.3"></stop>
                      <stop offset="100%" stopColor="#137fec" stopOpacity="0"></stop>
                    </linearGradient>
                  </defs>
                  <path d="M0,80 L30,70 L60,75 L90,50 L120,60 L150,40 L180,45 L210,30 L240,50 L270,20 L300,40 V100 H0 Z" fill="url(#chartGradient)"></path>
                  <path d="M0,80 L30,70 L60,75 L90,50 L120,60 L150,40 L180,45 L210,30 L240,50 L270,20 L300,40" fill="none" stroke="#137fec" strokeWidth="2"></path>
                </svg>
                {/* Grid Lines */}
                {[25, 50, 75].map(bottom => (
                  <div key={bottom} className="absolute inset-0 border-b border-slate-800 pointer-events-none" style={{ bottom: `${bottom}%` }}></div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm text-white font-medium">区域状态</h4>
              <div className="space-y-2">
                {[
                  { name: '北方区域', val: '12,400 m³/h', status: '优异', statusColor: 'text-emerald-400', sub: '98% 容量' },
                  { name: '西部管线', val: '8,230 m³/h', status: '压力警告', statusColor: 'text-tech-alert-med', sub: '102% 容量', warning: true },
                  { name: '南部沿海', val: '15,100 m³/h', status: '优异', statusColor: 'text-emerald-400', sub: '85% 容量' },
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-[#111418] border border-tech-border rounded-lg relative overflow-hidden">
                    {item.warning && <div className="absolute left-0 top-0 bottom-0 w-1 bg-tech-alert-med"></div>}
                    <div className={`flex flex-col ${item.warning ? 'pl-2' : ''}`}>
                      <span className="text-xs text-slate-400 font-medium uppercase">{item.name}</span>
                      <span className="text-sm text-white font-mono">{item.val}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className={`text-xs font-medium ${item.statusColor}`}>{item.status}</span>
                      <span className="text-[10px] text-slate-500">{item.sub}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm text-white font-medium">系统告警</h4>
                <a className="text-xs text-tech-primary hover:text-white transition-colors cursor-pointer">查看历史</a>
              </div>
              <div className="space-y-0 relative border-l border-slate-700 ml-2">
                {[
                  { level: '严重', time: '10:42 AM', msg: '402号站阀门故障。技术人员已派出。', color: 'bg-tech-alert-high', txtColor: 'text-tech-alert-high' },
                  { level: '警告', time: '09:15 AM', msg: '第4扇区检测到压力异常。已启动监控。', color: 'bg-tech-alert-med', txtColor: 'text-tech-alert-med' },
                  { level: '信息', time: '08:00 AM', msg: '配气网络A的定期维护已完成。', color: 'bg-tech-alert-low', txtColor: 'text-tech-alert-low' },
                ].map((alert, idx) => (
                  <div key={idx} className={`relative pl-6 ${idx !== 2 ? 'pb-6' : ''}`}>
                    <div className={`absolute -left-1.5 top-1 size-3 rounded-full ${alert.color} border-2 border-tech-panel`}></div>
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-start">
                        <span className={`text-xs font-bold ${alert.txtColor} uppercase tracking-wide`}>{alert.level}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{alert.time}</span>
                      </div>
                      <p className="text-xs text-slate-300">{alert.msg}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};

export default TechView;