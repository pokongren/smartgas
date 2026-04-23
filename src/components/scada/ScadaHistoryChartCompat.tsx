import React from 'react'
import ScadaHistoryChart from './ScadaHistoryChart'

interface ScadaHistoryChartCompatProps {
  stationName?: string
  junctionId?: string
  displayName?: string
  designPressure?: number
  onClose: () => void
  onMouseDown?: (e: React.MouseEvent) => void
  isDragging?: boolean
  metricType?: 'pressure' | 'temperature' | 'dewpoint'
  baseValue?: number
  initialHours?: number
}

const ScadaHistoryChartCompat: React.FC<ScadaHistoryChartCompatProps> = ({
  initialHours,
  ...rest
}) => {
  const LegacyChart = ScadaHistoryChart as unknown as React.ComponentType<Record<string, unknown>>
  const resolvedHours = initialHours ?? 6
  const key = `${rest.stationName || rest.junctionId || 'history'}-${rest.metricType || 'pressure'}-${resolvedHours}`
  return (
    <LegacyChart
      key={key}
      {...({ ...rest, initialHours: resolvedHours } as unknown as Record<string, unknown>)}
    />
  )
}

export default ScadaHistoryChartCompat
