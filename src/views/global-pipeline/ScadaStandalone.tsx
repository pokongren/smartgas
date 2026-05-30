import React from 'react'
import { usePopoutSync } from '@/hooks/useNewWindow'
import { SCADA_DATA_MAP } from '@/views/global-pipeline/scadaConfig'
import { ScadaTableContent } from '@/views/global-pipeline/ScadaTableContent'

// 供独立路由使用的通用 SCADA 弹窗组件
// 通过 URL 参数 ?id=xxx 动态加载对应管线的 SCADA 数据
export const ScadaStandalone: React.FC = () => {
    // 从 URL 获取管线 ID
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    const pipelineId = params.get('id') || 'we1'
    const config = SCADA_DATA_MAP[pipelineId] || SCADA_DATA_MAP['we1']

    // 专用 Hook 负责防白屏和发送心跳
    usePopoutSync(`scada-${pipelineId}`);

    // 设置窗口标题
    React.useEffect(() => {
        document.title = `${config.label} - SCADA 实时参数`
    }, [config.label])

    return (
        <div className="h-screen w-screen bg-[#0c1218] flex flex-col">
            {/* 独立窗口标题栏 */}
            <div className="px-4 py-3 flex justify-between items-center shrink-0" style={{ borderBottom: `1px solid ${config.color}33`, background: 'rgba(12,18,24,0.95)' }}>
                <h2 className="m-0 text-base font-bold flex items-center gap-2" style={{ color: config.color }}>
                    <span className="material-symbols-outlined text-xl">sensors</span>
                    <span>{config.label}</span>
                    <span style={{ color: config.color, fontSize: '10px', fontWeight: 'normal', background: `${config.color}22`, padding: '2px 8px', borderRadius: '9999px', border: `1px solid ${config.color}44` }}>SCADA 实时</span>
                </h2>
                <button onClick={() => window.close()} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10" title="关闭">
                    <span className="material-symbols-outlined">close</span>
                </button>
            </div>
            {Object.keys(config.data).length > 0 ? (
                <ScadaTableContent data={config.data} isPoppedOut={true} closePopOut={() => window.close()} popOut={() => {}} accentColor={config.color} />
            ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                        <span className="material-symbols-outlined text-5xl block mb-3" style={{ color: `${config.color}66` }}>database</span>
                        <p className="text-lg">暂无 SCADA 数据</p>
                        <p className="text-sm text-gray-600 mt-2">待导入 {config.label} 实际运行参数</p>
                    </div>
                </div>
            )}
        </div>
    )
}
