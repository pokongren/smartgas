import React, { useRef, useState } from 'react';
import MapView from '@/components/map-view';

type BoardPosition = {
  x: number;
  y: number;
};

type BoardSize = {
  width: number;
  height: number;
};

const MAJOR_EVENT_CARDS = [
  {
    icon: 'priority_high',
    title: '事件等级',
    value: 'I级',
    note: '疑似第三方施工靠近管道控制带，按重大外部风险事件联动处置。',
    tone: 'border-red-300/25 bg-red-500/12 text-red-100',
  },
  {
    icon: 'radar',
    title: '影响半径',
    value: '12km',
    note: '覆盖事件点上下游重点阀室、巡检点和伴行道路，优先核查穿越段。',
    tone: 'border-amber-300/25 bg-amber-500/12 text-amber-100',
  },
  {
    icon: 'speed',
    title: '上游压力',
    value: '8.72MPa',
    note: '当前压力未越限，但需要连续观察短时波动与下游压降趋势。',
    tone: 'border-cyan-300/25 bg-cyan-500/10 text-cyan-100',
  },
  {
    icon: 'valve',
    title: '最近阀室',
    value: 'V-142',
    note: '建议核对远控状态、通信链路和现场可达性，作为隔离预案关键点。',
    tone: 'border-slate-300/20 bg-slate-500/10 text-slate-100',
  },
  {
    icon: 'groups',
    title: '处置状态',
    value: '联动中',
    note: '调度、巡线、地方施工管理三线同步确认，15分钟内回传初判。',
    tone: 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100',
  },
  {
    icon: 'timeline',
    title: '趋势判断',
    value: '重点盯防',
    note: '暂无压力突降证据；若波动扩大，应立即启动上游降压和下游保供评估。',
    tone: 'border-violet-300/25 bg-violet-500/10 text-violet-100',
  },
  {
    icon: 'route',
    title: '管段定位',
    value: '西一线',
    note: '事件点落在河西走廊重点通道，需复核施工距离、管道埋深和交叉占压情况。',
    tone: 'border-blue-300/25 bg-blue-500/10 text-blue-100',
  },
  {
    icon: 'assignment_turned_in',
    title: '建议动作',
    value: '先核查后推演',
    note: '先核实现场风险，再按阀室隔离、压力调整、下游供气影响三类方案推演。',
    tone: 'border-lime-300/25 bg-lime-500/10 text-lime-100',
  },
];

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const CorpView: React.FC = () => {
  const [activeTab, setActiveTab] = useState('概览');
  const [showMajorEventPopup, setShowMajorEventPopup] = useState(true);
  const [eventBoardPosition, setEventBoardPosition] = useState<BoardPosition>({ x: 250, y: 355 });
  const [eventBoardSize, setEventBoardSize] = useState<BoardSize>({ width: 620, height: 430 });
  const [isDraggingEventBoard, setIsDraggingEventBoard] = useState(false);
  const [isResizingEventBoard, setIsResizingEventBoard] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const resizeStartRef = useRef({ x: 0, y: 0, width: 620, height: 430 });
  const boardPositionRef = useRef<BoardPosition>({ x: 250, y: 355 });

  const moveEventBoard = (nextPosition: BoardPosition) => {
    boardPositionRef.current = nextPosition;
    setEventBoardPosition(nextPosition);
  };

  const handleEventBoardMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;

    event.preventDefault();
    event.stopPropagation();
    setIsDraggingEventBoard(true);
    dragOffsetRef.current = {
      x: event.clientX - boardPositionRef.current.x,
      y: event.clientY - boardPositionRef.current.y,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const maxX = Math.max(12, window.innerWidth - eventBoardSize.width - 12);
      const maxY = Math.max(70, window.innerHeight - eventBoardSize.height - 120);
      moveEventBoard({
        x: clampNumber(moveEvent.clientX - dragOffsetRef.current.x, 12, maxX),
        y: clampNumber(moveEvent.clientY - dragOffsetRef.current.y, 70, maxY),
      });
    };

    const handleMouseUp = () => {
      setIsDraggingEventBoard(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleEventBoardResizeMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsResizingEventBoard(true);
    resizeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      width: eventBoardSize.width,
      height: eventBoardSize.height,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const maxWidth = Math.max(420, window.innerWidth - boardPositionRef.current.x - 12);
      const maxHeight = Math.max(360, window.innerHeight - boardPositionRef.current.y - 120);
      setEventBoardSize({
        width: clampNumber(resizeStartRef.current.width + moveEvent.clientX - resizeStartRef.current.x, 460, maxWidth),
        height: clampNumber(resizeStartRef.current.height + moveEvent.clientY - resizeStartRef.current.y, 360, maxHeight),
      });
    };

    const handleMouseUp = () => {
      setIsResizingEventBoard(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="bg-corp-bg-light dark:bg-corp-bg-dark text-[#111418] dark:text-white font-body overflow-hidden flex flex-col h-screen w-full transition-colors duration-300">
      {/* Header */}
      <header className="flex items-center justify-between whitespace-nowrap border-b border-solid border-[#e5e7eb] dark:border-[#283039] px-6 py-3 bg-white dark:bg-[#111418] z-30 shadow-sm relative">
        <div className="flex items-center gap-3">
          <div className="size-8 text-corp-primary flex items-center justify-center bg-corp-primary/10 rounded-lg">
            <span className="material-symbols-outlined text-2xl">propane</span>
          </div>
          <h2 className="text-[#111418] dark:text-white text-xl font-bold leading-tight tracking-[-0.015em] font-display">
            智脉平台-智慧管网 <span className="text-xs opacity-50 font-normal ml-2">政企版</span>
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

        {showMajorEventPopup && (
          <>
            <div className="pointer-events-none absolute left-[13%] top-[50%] z-20">
              <div className="absolute left-[-18px] top-[-18px] h-9 w-9 rounded-full border-2 border-red-100 bg-red-500 shadow-[0_0_34px_rgba(239,68,68,0.92)]">
                <span className="absolute inset-[-18px] rounded-full border border-red-400/70 animate-ping" />
                <span className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
              </div>
              <div className="absolute left-[9px] top-[4px] h-[2px] w-[105px] origin-left rotate-[-12deg] bg-gradient-to-r from-red-400 via-amber-300 to-transparent shadow-[0_0_14px_rgba(239,68,68,0.65)]" />
            </div>

            <section
              className={`pointer-events-auto absolute z-20 flex flex-col overflow-hidden rounded-2xl border border-red-400/35 bg-[#10141c]/95 text-white shadow-[0_26px_90px_rgba(15,23,42,0.42)] backdrop-blur-xl ${isDraggingEventBoard ? 'select-none shadow-red-900/40' : ''}`}
              onMouseDown={(event) => event.stopPropagation()}
              style={{
                left: eventBoardPosition.x,
                top: eventBoardPosition.y,
                width: eventBoardSize.width,
                height: eventBoardSize.height,
                cursor: isResizingEventBoard ? 'nwse-resize' : undefined,
              }}
            >
              <div className="h-1 bg-gradient-to-r from-red-500 via-amber-300 to-cyan-400" />
              <div
                className={`flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3 ${isDraggingEventBoard ? 'cursor-grabbing' : 'cursor-grab'}`}
                onMouseDown={handleEventBoardMouseDown}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-red-300/35 bg-red-500/18 text-red-100 shadow-[0_0_22px_rgba(248,113,113,0.24)]">
                      <span className="material-symbols-outlined text-[24px]">emergency_home</span>
                    </span>
                    <div className="min-w-0">
                      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-red-200">重大事件瀑布流</div>
                      <h3 className="mt-0.5 truncate text-[22px] font-black leading-tight text-white">
                        河西走廊管段外部施工风险
                      </h3>
                    </div>
                  </div>
                  <div className="mt-2 text-xs font-medium text-slate-400">
                    EVT-WE1-20260524-0911 · 西一线重点通道 · 最近更新：09:11
                  </div>
                </div>
                <button
                  onClick={() => setShowMajorEventPopup(false)}
                  className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                  title="关闭重大事件弹窗"
                  aria-label="关闭重大事件弹窗"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-red-300/25 bg-red-500/12 px-3 py-2">
                    <div className="text-[10px] font-semibold text-red-200">风险等级</div>
                    <div className="mt-1 text-2xl font-black text-red-100">高</div>
                  </div>
                  <div className="rounded-xl border border-amber-300/25 bg-amber-500/12 px-3 py-2">
                    <div className="text-[10px] font-semibold text-amber-100">建议响应</div>
                    <div className="mt-1 text-2xl font-black text-amber-100">15分钟</div>
                  </div>
                  <div className="rounded-xl border border-cyan-300/25 bg-cyan-500/10 px-3 py-2">
                    <div className="text-[10px] font-semibold text-cyan-100">联动对象</div>
                    <div className="mt-1 text-2xl font-black text-cyan-100">4类</div>
                  </div>
                </div>

                <div className="columns-1 gap-3 [column-fill:_balance] min-[560px]:columns-2 min-[780px]:columns-3">
                  {MAJOR_EVENT_CARDS.map((card) => (
                    <article
                      key={card.title}
                      className={`mb-3 inline-block w-full break-inside-avoid rounded-xl border p-3 shadow-[0_12px_28px_rgba(2,6,23,0.24)] ${card.tone}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="material-symbols-outlined mt-0.5 text-[20px]">{card.icon}</span>
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-white/70">{card.title}</div>
                          <div className="mt-1 text-[22px] font-black leading-none text-white">{card.value}</div>
                        </div>
                      </div>
                      <p className="mt-3 text-[12px] leading-relaxed text-slate-200">
                        {card.note}
                      </p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3">
                <button
                  onClick={() => setActiveTab('应急响应')}
                  className="flex-1 rounded-xl border border-red-300/35 bg-red-500/16 px-3 py-2 text-xs font-bold text-red-100 transition-colors hover:bg-red-500/24"
                >
                  启动应急响应
                </button>
                <button
                  onClick={() => setActiveTab('数据报表')}
                  className="flex-1 rounded-xl border border-cyan-300/30 bg-cyan-500/12 px-3 py-2 text-xs font-bold text-cyan-100 transition-colors hover:bg-cyan-500/20"
                >
                  查看事件数据
                </button>
              </div>

              <div
                className="absolute bottom-0 right-0 h-6 w-6 cursor-nwse-resize rounded-tl-lg border-l border-t border-red-300/25 bg-red-400/10 hover:bg-red-400/22"
                onMouseDown={handleEventBoardResizeMouseDown}
                title="调整大小"
              />
            </section>
          </>
        )}

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
