import axios from 'axios'
import { API_BASE_URL, BACKEND_BASE_URL } from './apiBase'
import type { SimulationSnapshotRecord, SimulationSnapshotSummary } from '@/types/simulation'

export const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
})

const topologyApi = axios.create({
    baseURL: BACKEND_BASE_URL,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
})

// ============ 基础数据 API ============

export const stationAPI = {
    getAll: () => api.get('/api/stations'),
    getById: (id: string) => api.get(`/api/stations/${id}`),
}

export const pipelineAPI = {
    getAll: () => api.get('/api/pipelines'),
    getById: (id: string) => api.get(`/api/pipelines/${id}`),
}

// ============ 应急指挥 API ============

export interface RouteAnalysisRequest {
    source_station: string
    target_station: string
    scenario: string
    blocked_pipelines?: string[]
}

export interface AlternativeRoute {
    path: string[]
    total_length: number
    estimated_time: string
    risk_level: string
}

export interface RouteAnalysisResponse {
    alternative_routes: AlternativeRoute[]
    affected_stations: string[]
    recommendation: string
}

export const emergencyAPI = {
    // 路径分析
    analyzeRoute: (data: RouteAnalysisRequest) =>
        api.post<RouteAnalysisResponse>('/api/emergency/route-analysis', data),

    // 影响范围分析
    analyzeImpact: (data: { failed_pipeline: string; failure_type: string }) =>
        api.post('/api/emergency/impact-analysis', data),

    // RAG 知识问答
    queryKnowledge: (question: string) =>
        api.post('/api/emergency/knowledge-query', { question }),

    // 获取关键节点
    getCriticalNodes: () =>
        api.get('/api/emergency/critical-nodes'),
}

// ============ 拓扑与仿真 API ============

export interface TopoNode {
    id: string
    name: string
    type: string
    longitude: number
    latitude: number
    centrality?: number
}

export interface SimulationResult {
    step: number
    affected_nodes: string[]
    pressure_drops: Record<string, number>
    is_stable: boolean
}

export const topologyAPI = {
    getGraph: () => api.get('/api/topology/graph'),
    getStats: () => api.get('/api/topology/stats'),
    analyze: () => api.get('/api/topology/stats'),
    // Legacy failure simulation entry kept only for backward compatibility.
    simulate: (params: { failed_node_id?: string; failure_node_id?: string; steps?: number; max_ticks?: number }) =>
        api.post<SimulationResult[]>('/api/emergency/simulate-failure', {
            failure_node_id: params.failure_node_id ?? params.failed_node_id,
            max_ticks: params.max_ticks ?? params.steps,
        }),
    getSummary: () => api.get('/api/emergency/topology-summary'),
    correctPreview: (params: { pipeline_data: any; jump_threshold_km?: number }) =>
        topologyApi.post('/topology/correct/preview', params),
    correctApply: (params: { pipeline_data: any; jump_threshold_km?: number }) =>
        topologyApi.post('/topology/correct/apply', params),
    correctionHistory: (pipeline_name?: string) =>
        topologyApi.get('/topology/correct/history', { params: { pipeline_name } }),
}

export const topologySimulationSnapshotAPI = {
    create: (data: { pilot_id: string; scenario_id: string }) =>
        topologyApi.post<SimulationSnapshotRecord>('/topology-simulation/snapshots', data),
    list: (params?: { pilot_id?: string; scenario_id?: string; limit?: number }) =>
        topologyApi.get<{
            items: SimulationSnapshotSummary[]
            count: number
            pilot_id?: string
            scenario_id?: string
        }>('/topology-simulation/snapshots', { params }),
    getByRunId: (runId: string, pilotId?: string) =>
        topologyApi.get<SimulationSnapshotRecord>(`/topology-simulation/snapshots/${runId}`, {
            params: pilotId ? { pilot_id: pilotId } : undefined,
        }),
}

// ============ 稳态仿真种子节点类型 ============

export interface SeedNodePressure {
    id: string
    name?: string
    operating_pressure_in?: number
    operating_pressure_out?: number
    target_pressure_mpa?: number
    min_pressure_mpa?: number
}

// ============ 管线数据包 API（替代前端硬编码） ============

import type { PipelinePackage } from '@/data/pipelines/types'

export const pipelinePackageAPI = {
    /** 获取全部管线数据包（PipelinePackage 格式，含节点坐标和管段路径） */
    getAll: () => api.get<PipelinePackage[]>('/api/pipeline-packages'),

    /** 获取单个管线系统数据 */
    getBySystemId: (systemId: string) =>
        api.get<PipelinePackage[]>('/api/pipeline-packages', { params: { system_id: systemId } }),
}
