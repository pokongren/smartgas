/**
 * 工作流数据管理 Hook
 * 封装工作流列表的获取、刷新等操作
 */
import { useState, useEffect, useCallback } from 'react';
import type { WorkflowListItem } from '../types/workflow';
import { workflowApi } from '../services/workflow-api';

/** 工作流列表管理 */
export function useWorkflows() {
    const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchWorkflows = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await workflowApi.list();
            setWorkflows(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : '获取工作流列表失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchWorkflows();
    }, [fetchWorkflows]);

    return { workflows, loading, error, refresh: fetchWorkflows };
}
