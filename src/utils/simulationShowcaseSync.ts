import type { SimulationOverlay } from '@/types/simulation'

const SIMULATION_SHOWCASE_SYNC_KEY = 'smartgas-grid:simulation-showcase-context:v1'
const SIMULATION_SHOWCASE_SYNC_TTL_MS = 2 * 60 * 60 * 1000

export interface SimulationShowcaseSyncContext {
  source: 'map-topology' | 'topology'
  pilotId: string
  scenarioId: string
  selectedSnapshotRunId: string
  baselineSnapshotRunId: string
  overlay: SimulationOverlay | null
  updatedAt: string
}

export function writeSimulationShowcaseSyncContext(context: SimulationShowcaseSyncContext): void {
  if (typeof window === 'undefined') return

  try {
    window.sessionStorage.setItem(SIMULATION_SHOWCASE_SYNC_KEY, JSON.stringify(context))
  } catch (error) {
    console.warn('[simulationShowcaseSync] failed to write context', error)
  }
}

export function clearSimulationShowcaseSyncContext(): void {
  if (typeof window === 'undefined') return

  try {
    window.sessionStorage.removeItem(SIMULATION_SHOWCASE_SYNC_KEY)
  } catch (error) {
    console.warn('[simulationShowcaseSync] failed to clear context', error)
  }
}

export function readSimulationShowcaseSyncContext(
  pilotId?: string,
): SimulationShowcaseSyncContext | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.sessionStorage.getItem(SIMULATION_SHOWCASE_SYNC_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<SimulationShowcaseSyncContext> | null
    if (!parsed || typeof parsed !== 'object') return null
    if (pilotId && parsed.pilotId !== pilotId) return null

    const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : ''
    const updatedAtMs = updatedAt ? new Date(updatedAt).getTime() : Number.NaN
    if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > SIMULATION_SHOWCASE_SYNC_TTL_MS) {
      clearSimulationShowcaseSyncContext()
      return null
    }

    return {
      source: parsed.source === 'topology' ? 'topology' : 'map-topology',
      pilotId: typeof parsed.pilotId === 'string' ? parsed.pilotId : '',
      scenarioId: typeof parsed.scenarioId === 'string' ? parsed.scenarioId : '',
      selectedSnapshotRunId:
        typeof parsed.selectedSnapshotRunId === 'string' ? parsed.selectedSnapshotRunId : '',
      baselineSnapshotRunId:
        typeof parsed.baselineSnapshotRunId === 'string' ? parsed.baselineSnapshotRunId : '',
      overlay: parsed.overlay ?? null,
      updatedAt,
    }
  } catch (error) {
    clearSimulationShowcaseSyncContext()
    console.warn('[simulationShowcaseSync] failed to read context', error)
    return null
  }
}
