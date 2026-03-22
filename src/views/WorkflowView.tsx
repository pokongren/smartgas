/**
 * AI 工作流主视图
 * 包含 Tab 切换：执行模式和编辑模式
 * 集成自 AI 套壳工具项目
 */
import React, { useState, lazy, Suspense } from 'react';

// 懒加载子组件以优化性能
const WorkflowRunner = lazy(() => import('../components/workflow/WorkflowRunner'));
const WorkflowEditor = lazy(() => import('../components/workflow/WorkflowEditor'));
const DataImportSkill = lazy(() => import('../components/workflow/DataImportSkill'));

type TabMode = 'run' | 'edit' | 'skill';

/**
 * 内部加载状态组件
 */
const TabLoader: React.FC = () => (
    <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-500 text-sm">加载中...</span>
        </div>
    </div>
);

const WorkflowView: React.FC = () => {
    const [activeTab, setActiveTab] = useState<TabMode>('run');

    return (
        <div className="flex flex-col h-screen bg-[#090D11] text-gray-200 overflow-hidden relative selection:bg-blue-500/30">
            {/* 背景光晕装饰 */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-900/10 blur-[120px] rounded-full pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-900/10 blur-[120px] rounded-full pointer-events-none" />

            {/* 顶部导航 */}
            <header className="flex-shrink-0 flex items-center justify-between px-6 py-3 bg-transparent sticky top-0 z-20 border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="size-9 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center backdrop-blur-md">
                        <span className="material-symbols-outlined text-blue-400 text-lg">neurology</span>
                    </div>
                    <span className="text-lg font-semibold text-gray-200 tracking-wide">
                        智脉平台-AI <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">Workflow</span>
                    </span>
                </div>

                {/* Tab 切换 */}
                <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1 border border-white/5">
                    <button
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'run'
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                            : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                            }`}
                        onClick={() => setActiveTab('run')}
                    >
                        <span className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                            执行
                        </span>
                    </button>
                    <button
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'edit'
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                            : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                            }`}
                        onClick={() => setActiveTab('edit')}
                    >
                        <span className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[16px]">edit_note</span>
                            编辑
                        </span>
                    </button>
                    <button
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'skill'
                            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                            : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                            }`}
                        onClick={() => setActiveTab('skill')}
                    >
                        <span className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[16px]">magic_button</span>
                            技能
                        </span>
                    </button>
                </div>
            </header>

            {/* 内容区 */}
            <main className="flex-1 overflow-hidden">
                <Suspense fallback={<TabLoader />}>
                    {activeTab === 'run' && <WorkflowRunner />}
                    {activeTab === 'edit' && <WorkflowEditor />}
                    {activeTab === 'skill' && <DataImportSkill />}
                </Suspense>
            </main>
        </div>
    );
};

export default WorkflowView;
