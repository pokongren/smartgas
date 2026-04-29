import React from 'react'

interface ScadaFloatingPanelProps {
    label: string
    accentColor: string
    titleColor: string
    style: React.CSSProperties
    topBarGradient: string
    borderColor: string
    headerBorderColor: string
    background: string
    isDragging?: boolean
    onMouseDown?: (e: React.MouseEvent) => void
    onClose: () => void
    actions?: React.ReactNode
    children: React.ReactNode
}

export const ScadaFloatingPanel: React.FC<ScadaFloatingPanelProps> = ({
    label,
    accentColor,
    titleColor,
    style,
    topBarGradient,
    borderColor,
    headerBorderColor,
    background,
    isDragging = false,
    onMouseDown,
    onClose,
    actions,
    children,
}) => {
    const draggable = typeof onMouseDown === 'function'

    return (
        <div
            className={`absolute z-10 glass-panel neon-border rounded-xl flex flex-col select-none overflow-hidden transition-all duration-300 ${isDragging ? 'cursor-grabbing scale-[1.02] shadow-2xl' : ''}`}
            style={{
                width: '480px',
                height: '310px',
                ...style,
            }}
        >

            <div style={{ height: '3px', background: topBarGradient, borderRadius: '10px 10px 0 0', opacity: 0.9 }} />
            <div
                className={`px-4 py-2.5 flex justify-between items-center shrink-0 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                style={{ borderBottom: `1px solid ${headerBorderColor}` }}
                onMouseDown={onMouseDown}
            >
                <h3 className="m-0 text-sm font-bold flex items-center gap-2" style={{ color: titleColor }}>
                    <span className="material-symbols-outlined text-lg" style={{ color: accentColor }}>sensors</span>
                    <span>{label}</span>
                    <span
                        style={{
                            color: accentColor,
                            fontSize: '10px',
                            fontWeight: 'normal',
                            background: `${accentColor}22`,
                            padding: '1px 6px',
                            borderRadius: '9999px',
                            border: `1px solid ${accentColor}44`,
                        }}
                    >
                        SCADA 实时
                    </span>
                </h3>
                <div className="flex gap-1" onMouseDown={e => e.stopPropagation()}>
                    {actions}
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10"
                        title="关闭"
                    >
                        <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                </div>
            </div>
            {children}
        </div>
    )
}

export const EmptyScadaState: React.FC<{ color: string; label?: string }> = ({ color, label }) => (
    <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        <div className="text-center">
            <span className="material-symbols-outlined text-3xl block mb-2" style={{ color: `${color}66` }}>database</span>
            <p>暂无 SCADA 数据</p>
            <p className="text-xs text-gray-600 mt-1">
                待导入{label ? ` ${label} ` : ''}实际运行参数
            </p>
        </div>
    </div>
)
