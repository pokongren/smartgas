import { useState, useEffect } from 'react'
import { emergencyAPI, stationAPI, type RouteAnalysisResponse } from '@/services/api'
import './EmergencyPanel.css'

interface EmergencyPanelProps {
    onClose: () => void
}

export default function EmergencyPanel({ onClose }: EmergencyPanelProps) {
    const [stations, setStations] = useState<any[]>([])
    const [sourceStation, setSourceStation] = useState('')
    const [targetStation, setTargetStation] = useState('')
    const [scenario, setScenario] = useState('pipeline_break')
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<RouteAnalysisResponse | null>(null)
    const [error, setError] = useState('')

    // 加载站场列表
    useEffect(() => {
        stationAPI.getAll()
            .then(res => setStations(res.data))
            .catch(err => console.error('加载站场失败:', err))
    }, [])

    // 分析路径
    const handleAnalyze = async () => {
        if (!sourceStation || !targetStation) {
            setError('请选择起点和终点站场')
            return
        }

        setLoading(true)
        setError('')
        setResult(null)

        try {
            const response = await emergencyAPI.analyzeRoute({
                source_station: sourceStation,
                target_station: targetStation,
                scenario: scenario,
                blocked_pipelines: scenario === 'pipeline_break' ? ['line-003'] : []
            })

            setResult(response.data)
        } catch (err: any) {
            setError(err.response?.data?.detail || '分析失败,请重试')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="emergency-panel">
            <div className="emergency-panel-header">
                <h3 className="emergency-panel-title">
                    🚨 应急路径分析
                </h3>
                <button className="emergency-panel-close" onClick={onClose}>
                    ×
                </button>
            </div>

            <div className="emergency-form">
                <div className="form-group">
                    <label className="form-label">起点站场</label>
                    <select
                        className="form-select"
                        value={sourceStation}
                        onChange={(e) => setSourceStation(e.target.value)}
                    >
                        <option value="">请选择...</option>
                        {stations.map(station => (
                            <option key={station.id} value={station.id}>
                                {station.name} ({station.type})
                            </option>
                        ))}
                    </select>
                </div>

                <div className="form-group">
                    <label className="form-label">终点站场</label>
                    <select
                        className="form-select"
                        value={targetStation}
                        onChange={(e) => setTargetStation(e.target.value)}
                    >
                        <option value="">请选择...</option>
                        {stations.map(station => (
                            <option key={station.id} value={station.id}>
                                {station.name} ({station.type})
                            </option>
                        ))}
                    </select>
                </div>

                <div className="form-group">
                    <label className="form-label">故障场景</label>
                    <select
                        className="form-select"
                        value={scenario}
                        onChange={(e) => setScenario(e.target.value)}
                    >
                        <option value="normal">正常运行</option>
                        <option value="pipeline_break">管线断裂</option>
                        <option value="maintenance">计划检修</option>
                    </select>
                </div>

                <button
                    className="analyze-button"
                    onClick={handleAnalyze}
                    disabled={loading}
                >
                    {loading ? '分析中...' : '开始分析'}
                </button>
            </div>

            {error && (
                <div className="result-section">
                    <div className="error">{error}</div>
                </div>
            )}

            {result && (
                <div className="result-section">
                    <h4 className="result-title">备用路径</h4>
                    {result.alternative_routes.length > 0 ? (
                        result.alternative_routes.map((route, index) => (
                            <div key={index} className="route-card">
                                <div className="route-path">
                                    {route.path.join(' → ')}
                                </div>
                                <div className="route-info">
                                    <span>总长: {route.total_length}km</span>
                                    <span>预计: {route.estimated_time}</span>
                                    <span>风险: {route.risk_level}</span>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="error">⚠️ 无可用备用路径!</div>
                    )}

                    {result.affected_stations.length > 0 && (
                        <>
                            <h4 className="result-title">受影响站场</h4>
                            <div className="route-card">
                                {result.affected_stations.join(', ')}
                            </div>
                        </>
                    )}

                    <h4 className="result-title">建议</h4>
                    <div className="recommendation">
                        {result.recommendation}
                    </div>
                </div>
            )}
        </div>
    )
}
