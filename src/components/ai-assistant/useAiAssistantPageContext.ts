import { useLocation } from 'react-router-dom'

export interface AssistantChatContext {
    page?: string
    route?: string
    title?: string
    module?: string
    summary?: string
    selection?: Record<string, unknown>
    filters?: Record<string, unknown>
}

const PAGE_CONTEXT_MAP: Record<string, Omit<AssistantChatContext, 'route' | 'title'>> = {
    '/': {
        page: 'corp-dashboard',
        module: 'overview',
        summary: 'Enterprise overview dashboard for high-level metrics and station distribution.',
    },
    '/tech': {
        page: 'tech-dashboard',
        module: 'overview',
        summary: 'Technical operations dashboard for system capability and monitoring analysis.',
    },
    '/global': {
        page: 'global-pipeline',
        module: 'pipeline-analysis',
        summary: 'Nationwide pipeline overview for network scope, history trends, and station status.',
    },
    '/topology': {
        page: 'topology-canvas',
        module: 'topology-analysis',
        summary: 'Topology analysis workspace for node relations, connectivity, and structure questions.',
    },
    '/map-topology': {
        page: 'map-topology',
        module: 'topology-analysis',
        summary: 'Map-linked topology workspace for combined geographic and topology analysis.',
    },
    '/topology-demo': {
        page: 'topology-demo',
        module: 'topology-analysis',
        summary: 'Topology demo page for presentation-oriented data and structure review.',
    },
    '/popout/assistant': {
        page: 'assistant-popout',
        module: 'assistant',
        summary: 'Standalone AI assistant window that reuses the main workspace context.',
    },
}

export function useAiAssistantPageContext(): AssistantChatContext {
    const location = useLocation()
    const descriptor = PAGE_CONTEXT_MAP[location.pathname] || {
        page: 'generic-page',
        module: 'generic',
        summary: 'Generic page context. Start with the user question and infer intent from the current route.',
    }

    return {
        ...descriptor,
        route: location.pathname,
        title: typeof document !== 'undefined' ? document.title : descriptor.page,
    }
}
