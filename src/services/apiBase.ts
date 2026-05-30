const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '')
const normalizePath = (path: string): string => (path.startsWith('/') ? path : `/${path}`)
const isLoopbackHost = (host: string): boolean => ['localhost', '127.0.0.1', '::1'].includes(host)
const configuredBackendOrigin = trimTrailingSlash((import.meta.env.VITE_BACKEND_ORIGIN || '').trim())
const configuredBackendPort = (import.meta.env.VITE_BACKEND_PORT || '').trim()
const joinBasePath = (base: string, path: string): string => {
    const normalizedPath = normalizePath(path)
    if (!base) {
        return normalizedPath
    }
    return `${base}${normalizedPath}`
}

const configuredApiBaseUrl = trimTrailingSlash((import.meta.env.VITE_API_BASE_URL || '').trim())
const resolveRuntimeApiBaseUrl = (baseUrl: string): string => {
    if (!baseUrl || typeof window === 'undefined') {
        return baseUrl
    }

    try {
        const url = new URL(baseUrl)
        const pageHost = window.location.hostname
        if (isLoopbackHost(url.hostname) && pageHost && !isLoopbackHost(pageHost)) {
            url.hostname = pageHost
            return trimTrailingSlash(url.toString())
        }
    } catch {
        return baseUrl
    }

    return baseUrl
}

export const API_BASE_URL = resolveRuntimeApiBaseUrl(configuredApiBaseUrl)
export const BACKEND_BASE_URL = configuredApiBaseUrl.endsWith('/api')
    ? API_BASE_URL.slice(0, -4)
    : API_BASE_URL

export function resolveBackendPath(path: string): string {
    return joinBasePath(BACKEND_BASE_URL, path)
}

export function resolveApiPath(path: string): string {
    const normalizedPath = normalizePath(path)
    if (!API_BASE_URL) {
        return normalizedPath
    }

    const apiBaseAlreadyIncludesApiPrefix = /\/api$/i.test(API_BASE_URL)
    const pathWithoutApiPrefix = apiBaseAlreadyIncludesApiPrefix && normalizedPath.startsWith('/api/')
        ? normalizedPath.slice(4)
        : normalizedPath

    return joinBasePath(API_BASE_URL, pathWithoutApiPrefix)
}

export function resolveApiPathCandidates(path: string): string[] {
    const normalizedPath = normalizePath(path)
    const candidates = [resolveApiPath(normalizedPath)]

    if (!candidates.includes(normalizedPath)) {
        candidates.push(normalizedPath)
    }

    if (typeof window !== 'undefined') {
        if (configuredBackendOrigin) {
            const directBackendUrl = new URL(normalizedPath, configuredBackendOrigin)
            const directBackend = directBackendUrl.toString()
            if (!candidates.includes(directBackend)) {
                candidates.push(directBackend)
            }
        } else if (configuredBackendPort) {
            const directBackendUrl = new URL(normalizedPath, window.location.origin)
            directBackendUrl.port = configuredBackendPort
            const directBackend = directBackendUrl.toString()
            if (!candidates.includes(directBackend)) {
                candidates.push(directBackend)
            }
        }
    }

    return candidates
}
