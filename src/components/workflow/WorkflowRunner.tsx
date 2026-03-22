/**
 * 工作流执行界面组件
 * 极简设计：选择工作流 → 输入内容 → 查看执行结果
 * 原 AI 套壳工具组件，重写为 TailwindCSS 风格以适配 SmartGas 深色主题
 */
import { useState } from 'react';
import { useWorkflows } from '../../hooks/use-workflows';
import { useExecution } from '../../hooks/use-execution';

export default function WorkflowRunner() {
    const { workflows } = useWorkflows();
    const {
        isExecuting,
        stepStates,
        finalOutput,
        error,
        workflowName,
        databaseContext,
        ragContext,
        execute,
        reset,
    } = useExecution();

    const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');
    const [inputText, setInputText] = useState('');
    const [copied, setCopied] = useState(false);

    /** 执行工作流 */
    const handleExecute = async () => {
        if (!selectedWorkflowId || !inputText.trim()) return;
        await execute(selectedWorkflowId, inputText.trim());
    };

    /** 重置回初始状态 */
    const handleReset = () => {
        reset();
        setInputText('');
    };

    /** 复制输出内容到剪贴板 */
    const handleCopy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // FIXME: 某些浏览器不支持 clipboard API
        }
    };

    return (
        <div className="h-full w-full overflow-y-auto p-6 flex flex-col items-center">
            <div className="w-full max-w-3xl my-auto flex-shrink-0 transition-all duration-500 py-10">
                {/* 标题区 */}
                <div className="text-center mb-10">
                    <div className="flex items-center justify-center gap-3 mb-3">
                        <div className="size-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center shadow-lg">
                            <span className="material-symbols-outlined text-[28px] text-white">bolt</span>
                        </div>
                        <h1 className="text-2xl font-bold text-gray-100 tracking-tight">AI 工作流执行</h1>
                    </div>
                    <p className="text-gray-500 text-sm mb-4">选择工作流 → 输入数据 → 等待 AI 处理</p>

                    {/* 能力状态指示 */}
                    <div className="flex items-center justify-center gap-4">
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400" title="已切换至极速文件检索模式">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                            内部管网文件数据库已桥接 (极速)
                        </div>
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                            应急预案知识库已挂载
                        </div>
                    </div>
                </div>

                {/* 输入区 */}
                <div className="bg-[#141b22] border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
                    <div className="mb-4">
                        <label className="block text-xs font-medium text-gray-400 mb-2">选择工作流</label>
                        <select
                            className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-200 text-sm focus:border-blue-500 focus:outline-none transition-colors appearance-none cursor-pointer"
                            value={selectedWorkflowId}
                            onChange={(e) => setSelectedWorkflowId(e.target.value)}
                            disabled={isExecuting}
                        >
                            <option value="">-- 请选择 --</option>
                            {workflows.map((w) => (
                                <option key={w.id} value={w.id}>
                                    {w.name} ({w.step_count} 步)
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="mb-4">
                        <label className="block text-xs font-medium text-gray-400 mb-2">输入内容</label>
                        <textarea
                            className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-gray-200 text-sm leading-relaxed focus:border-blue-500 focus:outline-none transition-colors placeholder:text-gray-600 resize-vertical min-h-[100px]"
                            placeholder="请输入你要处理的内容..."
                            rows={5}
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            disabled={isExecuting}
                        />
                    </div>

                    <div className="flex gap-3">
                        <button
                            className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20"
                            onClick={handleExecute}
                            disabled={isExecuting || !selectedWorkflowId || !inputText.trim()}
                        >
                            {isExecuting ? (
                                <>
                                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    处理中...
                                </>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                                    执行
                                </>
                            )}
                        </button>
                        {(stepStates.length > 0 || finalOutput) && (
                            <button
                                className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-300 text-sm font-medium hover:bg-white/5 transition-colors"
                                onClick={handleReset}
                            >
                                重置
                            </button>
                        )}
                    </div>
                </div>

                {/* 错误提示 */}
                {error && (
                    <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm mb-6">
                        <span className="material-symbols-outlined text-[18px]">error</span>
                        {error}
                    </div>
                )}

                {/* 提取的上下文信息 */}
                {(databaseContext || ragContext) && (
                    <div className="mb-6 animate-fade-in-up">
                        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                            <span className="material-symbols-outlined text-purple-400 text-[18px]">memory</span>
                            自动注入系统上下文
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* 数据库上下文 */}
                            {databaseContext && (
                                <div className="bg-[#141b22] border border-blue-500/30 rounded-xl p-4 shadow-lg relative overflow-hidden group">
                                    <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-600 to-cyan-400 opacity-50" />
                                    <span className="absolute -bottom-4 -right-4 text-[80px] material-symbols-outlined text-blue-500/5 group-hover:text-blue-500/10 transition-colors pointer-events-none select-none">database</span>
                                    <h4 className="text-xs font-semibold text-blue-400 mb-3 flex items-center gap-1.5 relative z-10">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                                        实时管网数据快照
                                    </h4>
                                    <pre className="text-[11px] text-gray-400 font-mono whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 relative z-10">
                                        {databaseContext}
                                    </pre>
                                </div>
                            )}

                            {/* 知识库上下文 */}
                            {ragContext && (
                                <div className="bg-[#141b22] border border-cyan-500/30 rounded-xl p-4 shadow-lg relative overflow-hidden group">
                                    <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-400 to-emerald-400 opacity-50" />
                                    <span className="absolute -bottom-4 -right-4 text-[80px] material-symbols-outlined text-cyan-500/5 group-hover:text-cyan-500/10 transition-colors pointer-events-none select-none">library_books</span>
                                    <h4 className="text-xs font-semibold text-cyan-400 mb-3 flex items-center gap-1.5 relative z-10">
                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                                        检索到的预案知识
                                    </h4>
                                    <pre className="text-[11px] text-gray-400 font-mono whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 relative z-10">
                                        {ragContext}
                                    </pre>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* 执行进度 */}
                {stepStates.length > 0 && (
                    <div className="mb-6">
                        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                            {workflowName && (
                                <span className="px-2.5 py-1 rounded-md bg-blue-600/15 text-blue-400 text-xs font-medium">
                                    {workflowName}
                                </span>
                            )}
                            执行进度
                        </h3>

                        <div className="space-y-2">
                            {stepStates.map((step) => (
                                <div
                                    key={step.stepOrder}
                                    className={`flex gap-4 px-5 py-4 rounded-xl border transition-colors ${step.status === 'running'
                                        ? 'border-blue-500/40 bg-blue-500/5'
                                        : step.status === 'completed'
                                            ? 'border-emerald-500/30 bg-emerald-500/5'
                                            : step.status === 'error'
                                                ? 'border-red-500/30 bg-red-500/5'
                                                : 'border-white/10 bg-white/[0.02]'
                                        }`}
                                >
                                    <div className="flex items-start pt-0.5 w-5 flex-shrink-0">
                                        {step.status === 'running' && (
                                            <span className="inline-block w-4 h-4 border-2 border-blue-500/30 border-t-blue-400 rounded-full animate-spin" />
                                        )}
                                        {step.status === 'completed' && (
                                            <span className="material-symbols-outlined text-[18px] text-emerald-400">check_circle</span>
                                        )}
                                        {step.status === 'error' && (
                                            <span className="material-symbols-outlined text-[18px] text-red-400">cancel</span>
                                        )}
                                        {step.status === 'pending' && (
                                            <span className="material-symbols-outlined text-[18px] text-gray-600">radio_button_unchecked</span>
                                        )}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-semibold text-gray-200 mb-1">{step.stepName}</div>
                                        {step.status === 'completed' && step.output && (
                                            <div className="mt-2">
                                                <div className="flex items-center justify-between mb-1.5">
                                                    <span className="text-[11px] text-gray-500 font-medium">输出结果</span>
                                                    <button
                                                        className="text-[11px] text-gray-500 hover:text-gray-300 px-2 py-0.5 border border-white/10 rounded transition-colors"
                                                        onClick={() => handleCopy(step.output!)}
                                                    >
                                                        复制
                                                    </button>
                                                </div>
                                                <pre className="px-4 py-3 rounded-lg bg-black/40 border border-white/5 text-xs text-emerald-400 font-mono leading-relaxed whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                                                    {step.output}
                                                </pre>
                                            </div>
                                        )}
                                        {step.status === 'error' && step.error && (
                                            <div className="mt-2 px-3 py-2 rounded-lg bg-red-500/10 text-red-400 text-xs">
                                                {step.error}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 最终输出 */}
                {finalOutput && (
                    <div className="bg-black/40 border border-white/10 border-l-4 border-l-blue-500 rounded-xl p-6 shadow-xl animate-fade-in-up">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
                                <span className="material-symbols-outlined text-blue-400">terminal</span>
                                最终输出
                            </h3>
                            <button
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${copied
                                    ? 'border-emerald-500/30 text-emerald-400'
                                    : 'border-white/10 text-gray-400 hover:bg-white/5 hover:text-gray-200'
                                    }`}
                                onClick={() => handleCopy(finalOutput)}
                            >
                                {copied ? '✓ 已复制' : '复制全部'}
                            </button>
                        </div>
                        <pre className="text-sm text-emerald-400 font-mono leading-relaxed whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                            {finalOutput}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}
