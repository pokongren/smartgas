/**
 * 工作流编辑界面组件
 * 支持创建、编辑、删除工作流及其步骤
 * 原 AI 套壳工具组件，重写为 TailwindCSS 风格以适配 SmartGas 深色主题
 */
import React, { useState, useCallback } from 'react';
import type { WorkflowStep, WorkflowFormData } from '../../types/workflow';
import { workflowApi } from '../../services/workflow-api';
import { useWorkflows } from '../../hooks/use-workflows';

/** 空步骤模板 */
const createEmptyStep = (order: number): Omit<WorkflowStep, 'id' | 'workflow_id'> => ({
    step_order: order,
    name: `步骤 ${order + 1}`,
    prompt_template: '',
    model: '',
    temperature: 0.7,
    max_tokens: 2000,
});

export default function WorkflowEditor() {
    const { workflows, loading, refresh } = useWorkflows();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [formData, setFormData] = useState<WorkflowFormData>({
        name: '',
        description: '',
        steps: [createEmptyStep(0)],
    });
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    /**
     * 加载工作流详情到编辑表单
     */
    const loadWorkflow = useCallback(async (id: string) => {
        try {
            const workflow = await workflowApi.get(id);
            setSelectedId(id);
            setFormData({
                name: workflow.name,
                description: workflow.description,
                steps: workflow.steps.map((s) => ({
                    step_order: s.step_order,
                    name: s.name,
                    prompt_template: s.prompt_template,
                    model: s.model,
                    temperature: s.temperature,
                    max_tokens: s.max_tokens,
                })),
            });
        } catch {
            showMessage('error', '加载工作流失败');
        }
    }, []);

    /** 新建工作流 */
    const handleNew = () => {
        setSelectedId(null);
        setFormData({
            name: '',
            description: '',
            steps: [createEmptyStep(0)],
        });
    };

    /** 保存工作流 */
    const handleSave = async () => {
        if (!formData.name.trim()) {
            showMessage('error', '请输入工作流名称');
            return;
        }

        setSaving(true);
        try {
            if (selectedId) {
                await workflowApi.update(selectedId, formData);
                showMessage('success', '工作流已更新');
            } else {
                const created = await workflowApi.create(formData);
                setSelectedId(created.id);
                showMessage('success', '工作流已创建');
            }
            refresh();
        } catch (err) {
            showMessage('error', err instanceof Error ? err.message : '保存失败');
        } finally {
            setSaving(false);
        }
    };

    /** 删除工作流 */
    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('确定要删除这个工作流吗？')) return;

        try {
            await workflowApi.delete(id);
            if (selectedId === id) handleNew();
            refresh();
            showMessage('success', '已删除');
        } catch {
            showMessage('error', '删除失败');
        }
    };

    /** 添加步骤 */
    const addStep = () => {
        setFormData((prev) => ({
            ...prev,
            steps: [...prev.steps, createEmptyStep(prev.steps.length)],
        }));
    };

    /** 删除步骤 */
    const removeStep = (index: number) => {
        setFormData((prev) => ({
            ...prev,
            steps: prev.steps
                .filter((_, i) => i !== index)
                .map((s, i) => ({ ...s, step_order: i })),
        }));
    };

    /** 上移步骤 */
    const moveStepUp = (index: number) => {
        if (index === 0) return;
        setFormData((prev) => {
            const steps = [...prev.steps];
            [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
            return { ...prev, steps: steps.map((s, i) => ({ ...s, step_order: i })) };
        });
    };

    /** 下移步骤 */
    const moveStepDown = (index: number) => {
        setFormData((prev) => {
            if (index >= prev.steps.length - 1) return prev;
            const steps = [...prev.steps];
            [steps[index], steps[index + 1]] = [steps[index + 1], steps[index]];
            return { ...prev, steps: steps.map((s, i) => ({ ...s, step_order: i })) };
        });
    };

    /** 更新步骤字段 */
    const updateStep = (index: number, field: string, value: string | number) => {
        setFormData((prev) => ({
            ...prev,
            steps: prev.steps.map((s, i) =>
                i === index ? { ...s, [field]: value } : s,
            ),
        }));
    };

    const showMessage = (type: 'success' | 'error', text: string) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 3000);
    };

    return (
        <div className="flex h-full overflow-hidden">
            {/* 消息提示 */}
            {message && (
                <div className={`fixed top-20 right-6 z-50 px-5 py-3 rounded-lg text-sm font-medium animate-fade-in-up backdrop-blur-xl ${message.type === 'success'
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : 'bg-red-500/15 text-red-400 border border-red-500/30'
                    }`}>
                    {message.text}
                </div>
            )}

            {/* 左侧：工作流列表 */}
            <aside className="w-72 flex-shrink-0 flex flex-col border-r border-white/10 bg-[#0c1218]">
                <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
                    <h2 className="text-sm font-semibold text-gray-400 tracking-wide">工作流列表</h2>
                    <button
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                        onClick={handleNew}
                    >
                        + 新建
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {loading ? (
                        <div className="text-center py-10 text-gray-500 text-sm">加载中...</div>
                    ) : workflows.length === 0 ? (
                        <div className="text-center py-10 text-gray-500">
                            <div className="text-3xl mb-3 opacity-40">📋</div>
                            <p className="text-sm">暂无工作流</p>
                            <p className="text-xs text-gray-600 mt-1">点击 "新建" 开始创建</p>
                        </div>
                    ) : (
                        workflows.map((w) => (
                            <div
                                key={w.id}
                                className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all group ${selectedId === w.id
                                    ? 'bg-blue-600/15 border-l-2 border-blue-500'
                                    : 'hover:bg-white/5'
                                    }`}
                                onClick={() => loadWorkflow(w.id)}
                            >
                                <div className="flex flex-col gap-0.5 min-w-0">
                                    <span className="text-sm font-medium text-gray-200 truncate">{w.name}</span>
                                    <span className="text-xs text-gray-500">{w.step_count} 个步骤</span>
                                </div>
                                <button
                                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all p-1 text-xs"
                                    onClick={(e) => handleDelete(w.id, e)}
                                    title="删除"
                                >
                                    <span className="material-symbols-outlined text-[16px]">delete</span>
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </aside>

            {/* 右侧：编辑区 */}
            <main className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                    <h2 className="text-lg font-semibold text-gray-200">
                        {selectedId ? '编辑工作流' : '新建工作流'}
                    </h2>
                    <button
                        className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        onClick={handleSave}
                        disabled={saving}
                    >
                        {saving ? '保存中...' : '💾 保存'}
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* 基本信息 */}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1.5">工作流名称</label>
                            <input
                                type="text"
                                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-200 text-sm focus:border-blue-500 focus:outline-none transition-colors placeholder:text-gray-600"
                                placeholder="例如：脚本生成器、文案改写器"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1.5">描述</label>
                            <textarea
                                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-200 text-sm focus:border-blue-500 focus:outline-none transition-colors placeholder:text-gray-600 resize-vertical min-h-[60px]"
                                placeholder="简要描述这个工作流的用途..."
                                rows={2}
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            />
                        </div>
                    </div>

                    {/* 步骤列表 */}
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold text-gray-300">Pipeline 步骤</h3>
                            <button
                                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 hover:border-white/20 transition-colors"
                                onClick={addStep}
                            >
                                + 添加步骤
                            </button>
                        </div>

                        <div className="space-y-3">
                            {formData.steps.map((step, index) => (
                                <div key={index} className="border border-white/10 rounded-xl bg-[#0c1218] overflow-hidden hover:border-white/15 transition-colors">
                                    {/* 步骤头部 */}
                                    <div className="flex items-center gap-3 px-4 py-3 bg-white/[0.02] border-b border-white/10">
                                        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-600/20 text-blue-400 text-xs font-bold flex-shrink-0">
                                            {index + 1}
                                        </span>
                                        <input
                                            type="text"
                                            className="flex-1 bg-transparent text-sm font-semibold text-gray-200 border border-transparent rounded-md px-2 py-1 hover:border-white/10 focus:border-blue-500 focus:outline-none transition-colors"
                                            placeholder="步骤名称"
                                            value={step.name}
                                            onChange={(e) => updateStep(index, 'name', e.target.value)}
                                        />
                                        <div className="flex gap-1">
                                            <button
                                                className="p-1.5 rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
                                                onClick={() => moveStepUp(index)}
                                                disabled={index === 0}
                                                title="上移"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                                            </button>
                                            <button
                                                className="p-1.5 rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
                                                onClick={() => moveStepDown(index)}
                                                disabled={index === formData.steps.length - 1}
                                                title="下移"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                                            </button>
                                            <button
                                                className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30"
                                                onClick={() => removeStep(index)}
                                                disabled={formData.steps.length <= 1}
                                                title="删除步骤"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">close</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* 步骤内容 */}
                                    <div className="p-4 space-y-4">
                                        <div>
                                            <label className="flex items-baseline gap-2 text-xs font-medium text-gray-400 mb-1.5">
                                                提示词模板
                                                <span className="text-[11px] text-gray-600 font-normal">
                                                    变量：{'{{input}}'}, {'{{prev_output}}'}, {'{{database_context}}'}, {'{{rag_context}}'}, {'{{step_N_output}}'}
                                                </span>
                                            </label>
                                            <textarea
                                                className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-gray-200 text-sm font-mono leading-relaxed focus:border-blue-500 focus:outline-none transition-colors placeholder:text-gray-600 resize-vertical min-h-[120px]"
                                                placeholder={`请输入提示词模板...\n\n例如：\n结合以下最新管网数据库上下文：\n{{database_context}}\n\n参考已有应急知识：\n{{rag_context}}\n\n请处理以下指令：\n{{input}}`}
                                                rows={5}
                                                value={step.prompt_template}
                                                onChange={(e) => updateStep(index, 'prompt_template', e.target.value)}
                                            />
                                        </div>

                                        <div className="grid grid-cols-3 gap-4">
                                            <div>
                                                <label className="block text-xs font-medium text-gray-400 mb-1.5">模型</label>
                                                <input
                                                    type="text"
                                                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-200 text-sm focus:border-blue-500 focus:outline-none transition-colors placeholder:text-gray-600"
                                                    placeholder="留空使用默认"
                                                    value={step.model}
                                                    onChange={(e) => updateStep(index, 'model', e.target.value)}
                                                />
                                            </div>
                                            <div>
                                                <label className="flex items-baseline gap-2 text-xs font-medium text-gray-400 mb-1.5">
                                                    温度
                                                    <span className="text-blue-400 font-semibold">{step.temperature}</span>
                                                </label>
                                                <input
                                                    type="range"
                                                    className="w-full accent-blue-500 mt-1"
                                                    min="0"
                                                    max="2"
                                                    step="0.1"
                                                    value={step.temperature}
                                                    onChange={(e) => updateStep(index, 'temperature', parseFloat(e.target.value))}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-400 mb-1.5">最大 Tokens</label>
                                                <input
                                                    type="number"
                                                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-200 text-sm focus:border-blue-500 focus:outline-none transition-colors"
                                                    min="1"
                                                    max="100000"
                                                    value={step.max_tokens}
                                                    onChange={(e) => updateStep(index, 'max_tokens', parseInt(e.target.value) || 2000)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
