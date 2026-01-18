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
