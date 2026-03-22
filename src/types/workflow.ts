/**
 * AI 工作流相关 TypeScript 类型定义
 */

/** 工作流步骤 */
export interface WorkflowStep {
    id?: string;
    workflow_id?: string;
    step_order: number;
    name: string;
    prompt_template: string;
    model: string;
    temperature: number;
    max_tokens: number;
}

/** 工作流详情 */
export interface Workflow {
    id: string;
    name: string;
    description: string;
    steps: WorkflowStep[];
    created_at: string;
    updated_at: string;
}

/** 工作流列表项 */
export interface WorkflowListItem {
    id: string;
    name: string;
    description: string;
    step_count: number;
    created_at: string;
    updated_at: string;
}

/** 创建/更新工作流请求 */
export interface WorkflowFormData {
    name: string;
    description: string;
    steps: Omit<WorkflowStep, 'id' | 'workflow_id'>[];
}

/** SSE 执行事件类型 */
export type ExecutionEvent =
    | { type: 'start'; workflow_name: string; total_steps: number }
    | { type: 'context_ready'; database_context: string; rag_context: string }
    | { type: 'step_start'; step_order: number; step_name: string }
    | { type: 'step_complete'; step_order: number; step_name: string; output: string }
    | { type: 'step_error'; step_order: number; step_name: string; error: string }
    | { type: 'complete'; final_output: string }
    | { type: 'error'; message: string };

/** 步骤执行状态 */
export interface StepExecutionState {
    stepOrder: number;
    stepName: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    output?: string;
    error?: string;
}
