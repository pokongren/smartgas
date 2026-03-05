/**
 * AI 工作流 API 请求封装
 * 统一管理后端 API 调用，使用 Vite proxy 转发
 */
import type { Workflow, WorkflowListItem, WorkflowFormData, ExecutionEvent } from '../types/workflow';

// NOTE: 使用 Vite proxy 转发，不再硬编码后端地址
const API_BASE = '/api/workflow';

/**
 * 通用请求方法
 * @param url 请求路径
 * @param options fetch 选项
 * @returns 响应数据
 */
async function request<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${url}`, {
        headers: {
            'Content-Type': 'application/json',
        },
        ...options,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: '请求失败' }));
        throw new Error(error.detail || `HTTP ${response.status}`);
    }

    // 204 No Content 没有返回体
    if (response.status === 204) {
        return undefined as T;
    }

    return response.json();
}

/** 工作流 API */
export const workflowApi = {
    /** 获取所有工作流 */
    list: () => request<WorkflowListItem[]>('/list'),

    /** 获取单个工作流详情 */
    get: (id: string) => request<Workflow>(`/${id}`),

    /** 创建工作流 */
    create: (data: WorkflowFormData) =>
        request<Workflow>('', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    /** 更新工作流 */
    update: (id: string, data: Partial<WorkflowFormData>) =>
        request<Workflow>(`/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    /** 删除工作流 */
    delete: (id: string) =>
        request<void>(`/${id}`, {
            method: 'DELETE',
        }),

    /**
     * 执行工作流（SSE 流式）
     * @param id 工作流 ID
     * @param inputText 用户输入
     * @param onEvent 事件回调
     */
    execute: async (
        id: string,
        inputText: string,
        onEvent: (event: ExecutionEvent) => void,
    ): Promise<void> => {
        const response = await fetch(`${API_BASE}/${id}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input_text: inputText }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: '执行失败' }));
            throw new Error(error.detail || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('无法读取响应流');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // NOTE: 保留最后一个可能不完整的行
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data: ')) {
                    const dataStr = trimmed.slice(6);
                    if (dataStr === '[DONE]') return;
                    try {
                        const event: ExecutionEvent = JSON.parse(dataStr);
                        onEvent(event);
                    } catch {
                        // 忽略解析错误
                    }
                }
            }
        }
    },
};
