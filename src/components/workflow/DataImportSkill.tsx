/**
 * 数据导入 Skill 组件
 * 提供「粘贴原始数据 → AI 解析 → 预览编辑 → 写入数据库」的一站式体验
 */
import React, { useState, useCallback } from 'react';

// ============ 类型定义 ============

interface StationData {
    id: string;
    name: string;
    type: string;
    longitude: number;
    latitude: number;
    design_pressure: number | null;
}

interface PipelineData {
    id: string;
    name: string;
    start_station_id: string;
    end_station_id: string;
    diameter_mm: number | null;
    length_km: number;
    design_pressure_mpa: number | null;
    category: string;
}

interface ParseResult {
    stations: StationData[];
    pipelines: PipelineData[];
}

interface ExecuteResult {
    stations_created: number;
    stations_skipped: number;
    pipelines_created: number;
    pipelines_skipped: number;
    errors: string[];
}

type Phase = 'input' | 'parsing' | 'preview' | 'executing' | 'done';

// ============ API 调用 ============

const SKILL_API = '/api/skill/data-import';

/**
 * 调用后端 AI 解析接口
 * @param rawText 原始文本数据
 */
async function callParse(rawText: string): Promise<ParseResult> {
    const res = await fetch(`${SKILL_API}/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: '解析失败' }));
        throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
}

/**
 * 调用后端写入数据库接口
 * @param data 解析后的结构化数据
 */
async function callExecute(data: ParseResult): Promise<ExecuteResult> {
    const res = await fetch(`${SKILL_API}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: '写入失败' }));
        throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
}

// ============ 示例占位文本 ============

const PLACEHOLDER_TEXT = `支持粘贴以下格式的数据：

1. 自然语言描述：
   西气东输二线从霍尔果斯首站出发，经过果子沟压气站（管径1219mm，长185km），到达奎屯分输站（管径1016mm，长210km）。

2. CSV / 表格数据：
   站名,类型,管径(mm),长度(km)
   霍尔果斯首站,source,,
   果子沟压气站,compressor,1219,185

3. 任意混合格式的文本...`;

// ============ 主组件 ============

const DataImportSkill: React.FC = () => {
    const [rawText, setRawText] = useState('');
    const [phase, setPhase] = useState<Phase>('input');
    const [parseResult, setParseResult] = useState<ParseResult | null>(null);
    const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);
    const [error, setError] = useState('');

    /** AI 解析 */
    const handleParse = useCallback(async () => {
        if (!rawText.trim()) return;
        setPhase('parsing');
        setError('');
        try {
            const result = await callParse(rawText);
            setParseResult(result);
            setPhase('preview');
        } catch (e) {
            setError(e instanceof Error ? e.message : '解析失败');
            setPhase('input');
        }
    }, [rawText]);

    /** 写入数据库 */
    const handleExecute = useCallback(async () => {
        if (!parseResult) return;
        setPhase('executing');
        setError('');
        try {
            const result = await callExecute(parseResult);
            setExecuteResult(result);
            setPhase('done');
        } catch (e) {
            setError(e instanceof Error ? e.message : '写入失败');
            setPhase('preview');
        }
    }, [parseResult]);

    /** 重置回初始状态 */
    const handleReset = useCallback(() => {
        setRawText('');
        setPhase('input');
        setParseResult(null);
        setExecuteResult(null);
        setError('');
    }, []);

    /** 更新预览中的站场字段 */
    const updateStation = useCallback((index: number, field: keyof StationData, value: string | number) => {
        if (!parseResult) return;
        const updated = { ...parseResult };
        updated.stations = [...updated.stations];
        updated.stations[index] = { ...updated.stations[index], [field]: value };
        setParseResult(updated);
    }, [parseResult]);

    /** 更新预览中的管线字段 */
    const updatePipeline = useCallback((index: number, field: keyof PipelineData, value: string | number) => {
        if (!parseResult) return;
        const updated = { ...parseResult };
        updated.pipelines = [...updated.pipelines];
        updated.pipelines[index] = { ...updated.pipelines[index], [field]: value };
        setParseResult(updated);
    }, [parseResult]);

    /** 删除预览中的站场 */
    const removeStation = useCallback((index: number) => {
        if (!parseResult) return;
        const updated = { ...parseResult };
        updated.stations = updated.stations.filter((_, i) => i !== index);
        setParseResult(updated);
    }, [parseResult]);

    /** 删除预览中的管线 */
    const removePipeline = useCallback((index: number) => {
        if (!parseResult) return;
        const updated = { ...parseResult };
        updated.pipelines = updated.pipelines.filter((_, i) => i !== index);
        setParseResult(updated);
    }, [parseResult]);

    return (
        <div className="h-full overflow-y-auto p-6">
            <div className="max-w-5xl mx-auto space-y-6">
                {/* 标题区 */}
                <div className="flex items-center gap-3 mb-2">
                    <div className="size-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center">
                        <span className="material-symbols-outlined text-emerald-400">database</span>
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-gray-100">数据导入</h2>
                        <p className="text-xs text-gray-500">粘贴原始数据，AI 自动解析并写入数据库</p>
                    </div>
                    {phase !== 'input' && (
                        <button
                            onClick={handleReset}
                            className="ml-auto px-4 py-2 text-sm rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all"
                        >
                            <span className="flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                                重新开始
                            </span>
                        </button>
                    )}
                </div>

                {/* 步骤指示器 */}
                <div className="flex items-center gap-2 px-1">
                    <StepIndicator
                        step={1}
                        label="输入数据"
                        active={phase === 'input' || phase === 'parsing'}
                        done={phase === 'preview' || phase === 'executing' || phase === 'done'}
                    />
                    <div className={`flex-1 h-px ${phase === 'preview' || phase === 'executing' || phase === 'done' ? 'bg-emerald-500/50' : 'bg-white/10'} transition-colors`} />
                    <StepIndicator
                        step={2}
                        label="预览确认"
                        active={phase === 'preview' || phase === 'executing'}
                        done={phase === 'done'}
                    />
                    <div className={`flex-1 h-px ${phase === 'done' ? 'bg-emerald-500/50' : 'bg-white/10'} transition-colors`} />
                    <StepIndicator
                        step={3}
                        label="写入完成"
                        active={phase === 'done'}
                        done={false}
                    />
                </div>

                {/* 错误提示 */}
                {error && (
                    <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-start gap-3">
                        <span className="material-symbols-outlined text-red-400 text-lg mt-0.5">error</span>
                        <div>
                            <p className="font-medium mb-1">操作失败</p>
                            <p className="text-red-300/80">{error}</p>
                        </div>
                    </div>
                )}

                {/* 阶段一：数据输入 */}
                {(phase === 'input' || phase === 'parsing') && (
                    <div className="space-y-4">
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                            <textarea
                                id="data-import-input"
                                value={rawText}
                                onChange={(e) => setRawText(e.target.value)}
                                placeholder={PLACEHOLDER_TEXT}
                                disabled={phase === 'parsing'}
                                className="w-full h-64 bg-transparent p-5 text-gray-200 text-sm font-mono resize-none focus:outline-none placeholder:text-gray-600 disabled:opacity-50"
                            />
                            <div className="flex items-center justify-between px-5 py-3 border-t border-white/5 bg-white/[0.01]">
                                <span className="text-xs text-gray-500">
                                    {rawText.length > 0 ? `${rawText.length} 字符` : '支持自然语言、CSV、表格等任意格式'}
                                </span>
                                <button
                                    id="data-import-parse-btn"
                                    onClick={handleParse}
                                    disabled={!rawText.trim() || phase === 'parsing'}
                                    className="px-6 py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-600/20 hover:shadow-emerald-500/30"
                                >
                                    {phase === 'parsing' ? (
                                        <span className="flex items-center gap-2">
                                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            AI 解析中...
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                                            AI 解析
                                        </span>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 阶段二：预览与编辑 */}
                {(phase === 'preview' || phase === 'executing') && parseResult && (
                    <div className="space-y-5">
                        {/* 统计摘要 */}
                        <div className="flex gap-4">
                            <div className="flex-1 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="material-symbols-outlined text-blue-400 text-lg">location_on</span>
                                    <span className="text-sm text-blue-300">站场</span>
                                </div>
                                <span className="text-2xl font-bold text-blue-200">{parseResult.stations.length}</span>
                                <span className="text-xs text-blue-400 ml-1">个</span>
                            </div>
                            <div className="flex-1 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="material-symbols-outlined text-amber-400 text-lg">route</span>
                                    <span className="text-sm text-amber-300">管线</span>
                                </div>
                                <span className="text-2xl font-bold text-amber-200">{parseResult.pipelines.length}</span>
                                <span className="text-xs text-amber-400 ml-1">条</span>
                            </div>
                        </div>

                        {/* 站场表格 */}
                        {parseResult.stations.length > 0 && (
                            <div className="rounded-xl border border-white/10 overflow-hidden">
                                <div className="px-4 py-3 bg-white/[0.03] border-b border-white/5 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-blue-400 text-lg">location_on</span>
                                    <span className="text-sm font-medium text-gray-300">站场数据</span>
                                    <span className="text-xs text-gray-500 ml-1">（可直接编辑修正）</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-white/[0.02] text-gray-400 text-xs">
                                                <th className="px-3 py-2.5 text-left font-medium">ID</th>
                                                <th className="px-3 py-2.5 text-left font-medium">名称</th>
                                                <th className="px-3 py-2.5 text-left font-medium">类型</th>
                                                <th className="px-3 py-2.5 text-left font-medium">经度</th>
                                                <th className="px-3 py-2.5 text-left font-medium">纬度</th>
                                                <th className="px-3 py-2.5 text-left font-medium">设计压力</th>
                                                <th className="px-3 py-2.5 text-center font-medium w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {parseResult.stations.map((s, i) => (
                                                <tr key={s.id} className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
                                                    <td className="px-3 py-2">
                                                        <input value={s.id} onChange={e => updateStation(i, 'id', e.target.value)}
                                                            className="bg-transparent text-gray-300 text-xs font-mono w-24 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 rounded px-1" />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input value={s.name} onChange={e => updateStation(i, 'name', e.target.value)}
                                                            className="bg-transparent text-gray-200 w-32 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 rounded px-1" />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <select value={s.type} onChange={e => updateStation(i, 'type', e.target.value)}
                                                            className="bg-transparent text-gray-300 text-xs focus:outline-none cursor-pointer">
                                                            <option value="source" className="bg-gray-800">气源站</option>
                                                            <option value="compressor" className="bg-gray-800">压气站</option>
                                                            <option value="distribution" className="bg-gray-800">分输站</option>
                                                            <option value="valve" className="bg-gray-800">阀室</option>
                                                        </select>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input type="number" value={s.longitude} onChange={e => updateStation(i, 'longitude', parseFloat(e.target.value) || 0)}
                                                            className="bg-transparent text-gray-400 w-20 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50 rounded px-1" />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input type="number" value={s.latitude} onChange={e => updateStation(i, 'latitude', parseFloat(e.target.value) || 0)}
                                                            className="bg-transparent text-gray-400 w-20 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50 rounded px-1" />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input type="number" value={s.design_pressure ?? 10} onChange={e => updateStation(i, 'design_pressure', parseFloat(e.target.value) || 10)}
                                                            className="bg-transparent text-gray-400 w-16 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50 rounded px-1" />
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
                                                        <button onClick={() => removeStation(i)} className="text-gray-600 hover:text-red-400 transition-colors" title="删除">
                                                            <span className="material-symbols-outlined text-[16px]">close</span>
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* 管线表格 */}
                        {parseResult.pipelines.length > 0 && (
                            <div className="rounded-xl border border-white/10 overflow-hidden">
                                <div className="px-4 py-3 bg-white/[0.03] border-b border-white/5 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-amber-400 text-lg">route</span>
                                    <span className="text-sm font-medium text-gray-300">管线数据</span>
                                    <span className="text-xs text-gray-500 ml-1">（可直接编辑修正）</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-white/[0.02] text-gray-400 text-xs">
                                                <th className="px-3 py-2.5 text-left font-medium">ID</th>
                                                <th className="px-3 py-2.5 text-left font-medium">名称</th>
                                                <th className="px-3 py-2.5 text-left font-medium">起点</th>
                                                <th className="px-3 py-2.5 text-left font-medium">终点</th>
                                                <th className="px-3 py-2.5 text-left font-medium">管径(mm)</th>
                                                <th className="px-3 py-2.5 text-left font-medium">长度(km)</th>
                                                <th className="px-3 py-2.5 text-left font-medium">类别</th>
                                                <th className="px-3 py-2.5 text-center font-medium w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {parseResult.pipelines.map((p, i) => (
                                                <tr key={p.id} className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
                                                    <td className="px-3 py-2">
                                                        <input value={p.id} onChange={e => updatePipeline(i, 'id', e.target.value)}
                                                            className="bg-transparent text-gray-300 text-xs font-mono w-24 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 rounded px-1" />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input value={p.name} onChange={e => updatePipeline(i, 'name', e.target.value)}
                                                            className="bg-transparent text-gray-200 w-36 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 rounded px-1" />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input value={p.start_station_id} onChange={e => updatePipeline(i, 'start_station_id', e.target.value)}
                                                            className="bg-transparent text-gray-300 text-xs font-mono w-24 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 rounded px-1" />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input value={p.end_station_id} onChange={e => updatePipeline(i, 'end_station_id', e.target.value)}
                                                            className="bg-transparent text-gray-300 text-xs font-mono w-24 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 rounded px-1" />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input type="number" value={p.diameter_mm ?? ''} onChange={e => updatePipeline(i, 'diameter_mm', parseFloat(e.target.value) || 0)}
                                                            className="bg-transparent text-gray-400 w-20 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50 rounded px-1" />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input type="number" value={p.length_km} onChange={e => updatePipeline(i, 'length_km', parseFloat(e.target.value) || 0)}
                                                            className="bg-transparent text-gray-400 w-20 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50 rounded px-1" />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <select value={p.category} onChange={e => updatePipeline(i, 'category', e.target.value)}
                                                            className="bg-transparent text-gray-300 text-xs focus:outline-none cursor-pointer">
                                                            <option value="trunk" className="bg-gray-800">干线</option>
                                                            <option value="branch" className="bg-gray-800">支线</option>
                                                        </select>
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
                                                        <button onClick={() => removePipeline(i)} className="text-gray-600 hover:text-red-400 transition-colors" title="删除">
                                                            <span className="material-symbols-outlined text-[16px]">close</span>
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* 写入按钮 */}
                        <div className="flex justify-end">
                            <button
                                id="data-import-execute-btn"
                                onClick={handleExecute}
                                disabled={phase === 'executing'}
                                className="px-8 py-3 rounded-xl font-medium text-sm transition-all disabled:opacity-50 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30"
                            >
                                {phase === 'executing' ? (
                                    <span className="flex items-center gap-2">
                                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        写入中...
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[18px]">check_circle</span>
                                        确认写入数据库
                                    </span>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* 阶段三：写入结果 */}
                {phase === 'done' && executeResult && (
                    <div className="space-y-4">
                        <div className="p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="size-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                    <span className="material-symbols-outlined text-emerald-400 text-2xl">check_circle</span>
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-emerald-200">导入完成</h3>
                                    <p className="text-xs text-emerald-400/70">数据已成功写入数据库</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 rounded-lg bg-white/5">
                                    <div className="text-xs text-gray-400 mb-1">站场</div>
                                    <div className="flex gap-4">
                                        <span className="text-emerald-300">
                                            <span className="text-lg font-bold">{executeResult.stations_created}</span>
                                            <span className="text-xs ml-1">新增</span>
                                        </span>
                                        {executeResult.stations_skipped > 0 && (
                                            <span className="text-gray-500">
                                                <span className="text-lg font-bold">{executeResult.stations_skipped}</span>
                                                <span className="text-xs ml-1">跳过</span>
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="p-3 rounded-lg bg-white/5">
                                    <div className="text-xs text-gray-400 mb-1">管线</div>
                                    <div className="flex gap-4">
                                        <span className="text-emerald-300">
                                            <span className="text-lg font-bold">{executeResult.pipelines_created}</span>
                                            <span className="text-xs ml-1">新增</span>
                                        </span>
                                        {executeResult.pipelines_skipped > 0 && (
                                            <span className="text-gray-500">
                                                <span className="text-lg font-bold">{executeResult.pipelines_skipped}</span>
                                                <span className="text-xs ml-1">跳过</span>
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {executeResult.errors.length > 0 && (
                                <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                                    <p className="text-xs text-red-300 font-medium mb-1">部分错误：</p>
                                    {executeResult.errors.map((err, i) => (
                                        <p key={i} className="text-xs text-red-400/80">{err}</p>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex justify-center">
                            <button
                                onClick={handleReset}
                                className="px-6 py-2.5 rounded-lg text-sm bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all"
                            >
                                <span className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-[16px]">add</span>
                                    继续导入更多数据
                                </span>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// ============ 子组件 ============

/** 步骤圆形指示器 */
const StepIndicator: React.FC<{
    step: number;
    label: string;
    active: boolean;
    done: boolean;
}> = ({ step, label, active, done }) => (
    <div className="flex items-center gap-2">
        <div className={`size-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${done
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
            : active
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40 shadow-lg shadow-blue-500/10'
                : 'bg-white/5 text-gray-600 border border-white/10'
            }`}>
            {done ? (
                <span className="material-symbols-outlined text-[14px]">check</span>
            ) : step}
        </div>
        <span className={`text-xs transition-colors ${active || done ? 'text-gray-300' : 'text-gray-600'}`}>
            {label}
        </span>
    </div>
);

export default DataImportSkill;
