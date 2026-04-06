const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '')
const normalizePath = (path: string): string => (path.startsWith('/') ? path : `/${path}`)
const joinBasePath = (base: string, path: string): string => {
    const normalizedPath = normalizePath(path)
    if (!base) {
        return normalizedPath
    }
    return `${base}${normalizedPath}`
}

const configuredApiBaseUrl = trimTrailingSlash((import.meta.env.VITE_API_BASE_URL || '').trim())

export const API_BASE_URL = configuredApiBaseUrl
export const BACKEND_BASE_URL = configuredApiBaseUrl.endsWith('/api')
    ? configuredApiBaseUrl.slice(0, -4)
    : configuredApiBaseUrl

export function resolveBackendPath(path: string): string {
    return joinBasePath(BACKEND_BASE_URL, path)
}

export function resolveApiPath(path: string): string {
    const normalizedPath = normalizePath(path)
    if (!API_BASE_URL) {
        return normalizedPath
    }

    const pathWithoutApiPrefix = normalizedPath.startsWith('/api/')
        ? normalizedPath.slice(4)
        : normalizedPath

    return joinBasePath(API_BASE_URL, pathWithoutApiPrefix)
}
