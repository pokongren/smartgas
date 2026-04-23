import { useSyncExternalStore } from 'react'

type RuntimePayload = {
    selection?: Record<string, unknown>
    filters?: Record<string, unknown>
}

let runtimeContext: RuntimePayload = {}
const listeners = new Set<() => void>()

function emitChange() {
    listeners.forEach((listener) => listener())
}

export function setAssistantRuntimeContext(next: RuntimePayload): void {
    runtimeContext = {
        selection: {
            ...(runtimeContext.selection || {}),
            ...(next.selection || {}),
        },
        filters: {
            ...(runtimeContext.filters || {}),
            ...(next.filters || {}),
        },
    }
    emitChange()
}

export function clearAssistantRuntimeContext(): void {
    runtimeContext = {}
    emitChange()
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function getSnapshot() {
    return runtimeContext
}

export function useAssistantRuntimeContext(): RuntimePayload {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
