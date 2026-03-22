import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export const api = axios.create({
    baseURL: API_BASE_URL,
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
    // 获取后端分析结果 (中心性等)
    analyze: () => api.get<{ nodes: TopoNode[] }>('/api/topology/analyze'),
    
    // 执行故障仿真
    simulate: (params: { failed_node_id: string; steps?: number }) =>
        api.post<SimulationResult[]>('/api/topology/simulate', params),
        
    // 全球拓扑概览
    getSummary: () => api.get('/api/topology/summary'),

    // 修正预览（不写入数据库）
    correctPreview: (params: { pipeline_data: any; jump_threshold_km?: number }) =>
        api.post('/api/topology/correct/preview', params),

    // 确认修正并应用
    correctApply: (params: { pipeline_data: any; jump_threshold_km?: number }) =>
        api.post('/api/topology/correct/apply', params),

    // 修正历史
    correctionHistory: (pipeline_name?: string) =>
        api.get('/api/topology/correct/history', { params: { pipeline_name } }),
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
