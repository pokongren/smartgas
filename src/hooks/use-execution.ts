/**
 * 工作流执行 Hook
 * 处理 SSE 流式执行和状态管理
 */
import { useState, useCallback } from 'react';
import type { StepExecutionState, ExecutionEvent } from '../types/workflow';
import { workflowApi } from '../services/workflow-api';

export function useExecution() {
    const [isExecuting, setIsExecuting] = useState(false);
    const [stepStates, setStepStates] = useState<StepExecutionState[]>([]);
    const [finalOutput, setFinalOutput] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [workflowName, setWorkflowName] = useState<string>('');
    const [databaseContext, setDatabaseContext] = useState<string | null>(null);
    const [ragContext, setRagContext] = useState<string | null>(null);

    const execute = useCallback(async (workflowId: string, inputText: string) => {
        setIsExecuting(true);
        setStepStates([]);
        setFinalOutput('');
        setError(null);
        setWorkflowName('');
        setDatabaseContext(null);
        setRagContext(null);

        try {
            await workflowApi.execute(workflowId, inputText, (event: ExecutionEvent) => {
                switch (event.type) {
                    case 'start':
                        setWorkflowName(event.workflow_name);
                        break;

                    case 'context_ready':
                        setDatabaseContext(event.database_context);
                        setRagContext(event.rag_context);
                        break;

                    case 'step_start':
                        setStepStates((prev) => [
                            ...prev,
                            {
                                stepOrder: event.step_order,
                                stepName: event.step_name,
                                status: 'running',
                            },
                        ]);
                        break;

                    case 'step_complete':
                        setStepStates((prev) =>
                            prev.map((s) =>
                                s.stepOrder === event.step_order
                                    ? { ...s, status: 'completed' as const, output: event.output }
                                    : s,
                            ),
                        );
                        break;

                    case 'step_error':
                        setStepStates((prev) =>
                            prev.map((s) =>
                                s.stepOrder === event.step_order
                                    ? { ...s, status: 'error' as const, error: event.error }
                                    : s,
                            ),
                        );
                        setError(`步骤 "${event.step_name}" 执行失败: ${event.error}`);
                        break;

                    case 'complete':
                        setFinalOutput(event.final_output);
                        break;

                    case 'error':
                        setError(event.message);
                        break;
                }
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : '执行失败');
        } finally {
            setIsExecuting(false);
        }
    }, []);

    const reset = useCallback(() => {
        setStepStates([]);
        setFinalOutput('');
        setError(null);
        setWorkflowName('');
        setDatabaseContext(null);
        setRagContext(null);
    }, []);

    return {
        isExecuting,
        stepStates,
        finalOutput,
        error,
        workflowName,
        databaseContext,
        ragContext,
        execute,
        reset,
    };
}
