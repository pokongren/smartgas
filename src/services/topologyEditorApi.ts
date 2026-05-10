import axios from 'axios'
import { api } from './api'

export interface JunctionGroup {
    id: number
    name: string
    description?: string | null
    station_ids: string[]
    raw_group_ids?: number[]
    junction_kind?: string
    system_ids?: string[]
    member_count?: number
    source_table?: string
}

export interface JunctionGroupsResult {
    junctions: JunctionGroup[]
    manual_editing_enabled: boolean
    mode: string
}

export interface CreateJunctionGroupPayload {
    name: string
    description?: string
    station_ids: string[]
    append_mode?: boolean
    target_junction_id?: number
}

export interface CreateJunctionGroupResult {
    message: string
    id: number
    mode?: 'created' | 'appended'
    member_count?: number
    merged_group_ids?: number[]
    removed_group_ids?: number[]
}

export interface DeleteJunctionGroupResult {
    ok: boolean
    message: string
}

export interface PositionUpdate {
    id: string
    longitude: number
    latitude: number
}

export interface PositionCommitPayload {
    updates: PositionUpdate[]
    cascade_valves: boolean
    cascade_scope: string
}

export interface PositionPreviewResult {
    message?: string
    updated_station_ids: string[]
    updated_valve_ids: string[]
    affected_layers: string[]
    impacted_segments: Array<{
        start_id: string
        end_id: string
        valve_ids: string[]
    }>
    errors: Array<{ id?: string | null; error: string }>
    preview_only?: boolean
}

export interface PositionCommitResult extends PositionPreviewResult {}

export interface CreateConnectionPayload {
    start_station_id: string
    end_station_id: string
    name?: string
    length_km?: number
    diameter_mm?: number
    category?: string
}

export interface PipelineEdgeResult {
    id: string
    name: string
    start_station_id: string
    end_station_id: string
    start_station_name?: string
    end_station_name?: string
    length_km?: number
    diameter_mm?: number | null
    category?: string
    is_orphan?: boolean
}

function extractApiErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data
        if (typeof responseData === 'string' && responseData.trim()) {
            return responseData
        }
        if (responseData && typeof responseData === 'object') {
            const detail = (responseData as { detail?: unknown }).detail
            if (typeof detail === 'string' && detail.trim()) {
                return detail
            }
            const message = (responseData as { message?: unknown }).message
            if (typeof message === 'string' && message.trim()) {
                return message
            }
        }
        return error.message
    }

    if (error instanceof Error) {
        return error.message
    }

    return '未知错误'
}

async function unwrap<T>(request: Promise<{ data: T }>): Promise<T> {
    try {
        const response = await request
        return response.data
    } catch (error) {
        throw new Error(extractApiErrorMessage(error))
    }
}

export const topologyEditorApi = {
    async getJunctionGroups(): Promise<JunctionGroupsResult> {
        const data = await unwrap<{
            junctions?: JunctionGroup[]
            manual_editing_enabled?: boolean
            mode?: string
        }>(
            api.get('/api/topology/junctions')
        )
        return {
            junctions: Array.isArray(data.junctions) ? data.junctions : [],
            manual_editing_enabled: data.manual_editing_enabled === true,
            mode: typeof data.mode === 'string' ? data.mode : 'runtime_readonly',
        }
    },

    createJunctionGroup(payload: CreateJunctionGroupPayload): Promise<CreateJunctionGroupResult> {
        return unwrap<CreateJunctionGroupResult>(
            api.post('/api/topology/junctions', payload)
        )
    },

    deleteJunctionGroup(junctionId: number): Promise<DeleteJunctionGroupResult> {
        return unwrap<DeleteJunctionGroupResult>(
            api.delete(`/api/topology/junctions/${junctionId}`)
        )
    },

    previewPositions(payload: PositionCommitPayload): Promise<PositionPreviewResult> {
        return unwrap<PositionPreviewResult>(
            api.post('/api/topology/positions/preview', payload)
        )
    },

    commitPositions(payload: PositionCommitPayload): Promise<PositionCommitResult> {
        return unwrap<PositionCommitResult>(
            api.put('/api/topology/positions/commit', payload)
        )
    },

    createConnection(payload: CreateConnectionPayload): Promise<PipelineEdgeResult> {
        return unwrap<PipelineEdgeResult>(
            api.post('/api/topology/connection', payload)
        )
    },

    deleteConnection(pipelineId: string): Promise<{ message: string; pipeline_id: string }> {
        return unwrap<{ message: string; pipeline_id: string }>(
            api.delete(`/api/topology/connection/${pipelineId}`)
        )
    },
}
