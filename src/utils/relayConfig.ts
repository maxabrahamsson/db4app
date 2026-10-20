import { debugLog } from './debug'

/**
 * Relay configuration.
 *
 * There is no hosted relay. The relay URL is resolved in this order:
 *   1. `?relay=` query parameter (Tauri / self-hosted relay app integration)
 *   2. Custom relay URL saved in localStorage (Database page → Relay server)
 *   3. VITE_RELAY_* env vars at build time
 *   4. A local self-hosted relay on localhost (server/index.js defaults: HTTP/WS 8787, Postgres 6543)
 *
 * The app works without any relay (browser-only mode); the relay is only needed
 * for external Postgres / MCP clients.
 */
const DEFAULT_RELAY_HTTP_PORT = '8787'
const DEFAULT_RELAY_PG_PORT = '6543'
const isBrowser = typeof window !== 'undefined'

// LocalStorage key for custom relay URL (used by self-hosted relay)
const CUSTOM_RELAY_URL_KEY = 'db4app-relay-url'

/**
 * Get custom relay URL from localStorage (set by self-hosted relay)
 * This allows users to override the relay URL for self-hosted deployments
 */
export const getCustomRelayUrl = (): string | null => {
  if (!isBrowser) return null
  try {
    return localStorage.getItem(CUSTOM_RELAY_URL_KEY)
  } catch {
    return null
  }
}

/**
 * Set custom relay URL in localStorage
 * Used for self-hosted relay integration
 */
export const setCustomRelayUrl = (url: string | null): void => {
  if (!isBrowser) return
  try {
    if (url) {
      localStorage.setItem(CUSTOM_RELAY_URL_KEY, url)
    } else {
      localStorage.removeItem(CUSTOM_RELAY_URL_KEY)
    }
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Check if using a custom/self-hosted relay
 */
export const isUsingCustomRelay = (): boolean => {
  return !!getCustomRelayUrl()
}

const isLocalHost = (host: string) => {
  if (!host) {
    return true
  }
  const normalized = host.toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  )
}

// Force 127.0.0.1 for local relay to ensure IPv4 binding
const getLocalRelayHost = (host: string) => {
  if (isLocalHost(host)) {
    return '127.0.0.1'
  }
  return host
}

const getEnv = <T extends string | undefined>(primary?: T, fallback?: T): T | undefined => {
  return primary ?? fallback
}

const resolveRelayHost = () => {
  const configuredHost = getEnv(import.meta.env.VITE_RELAY_HOST, import.meta.env.VITE_PROXY_HOST)
  if (configuredHost) {
    return configuredHost
  }

  // No hosted relay: default to a relay running on this machine
  return 'localhost'
}

const getLocalHttpPort = () =>
  getEnv(import.meta.env.VITE_RELAY_PORT, import.meta.env.VITE_PROXY_PORT) ?? DEFAULT_RELAY_HTTP_PORT

export const getRelayPgPort = (): string =>
  getEnv(import.meta.env.VITE_RELAY_PG_PORT, import.meta.env.VITE_PROXY_PG_PORT) ?? DEFAULT_RELAY_PG_PORT

export const getRelayHost = () => resolveRelayHost()

export const getRelayHttpUrl = () => {
  const configuredUrl = getEnv(import.meta.env.VITE_RELAY_HTTP_URL, import.meta.env.VITE_PROXY_HTTP_URL)
  if (configuredUrl) {
    return configuredUrl
  }
  const host = getRelayHost()
  const isLocal = isLocalHost(host)
  const scheme = isLocal ? 'http' : 'https'
  const portSegment = isLocal ? `:${getLocalHttpPort()}` : ''
  return `${scheme}://${host}${portSegment}/query`
}

export const getRelayAgentUrl = () => {
  // Check for query parameter override (used by Tauri/MFE integration)
  if (isBrowser) {
    const params = new URLSearchParams(window.location.search)
    const queryRelay = params.get('relay')
    if (queryRelay) {
      debugLog.log('[RelayConfig] Using query param relay URL:', queryRelay)
      return queryRelay
    }
  }

  // Check for custom relay URL first (set by self-hosted relay)
  const customUrl = getCustomRelayUrl()
  if (customUrl) {
    debugLog.log('[RelayConfig] Using custom relay URL:', customUrl)
    return customUrl
  }

  const configuredUrl = getEnv(import.meta.env.VITE_RELAY_AGENT_URL, import.meta.env.VITE_PROXY_AGENT_URL)
  if (configuredUrl) {
    debugLog.log('[RelayConfig] Using configured relay URL:', configuredUrl)
    return configuredUrl
  }
  const host = getLocalRelayHost(getRelayHost())
  const isLocal = isLocalHost(host)
  const scheme = isLocal ? 'ws' : 'wss'
  const portSegment = isLocal ? `:${getLocalHttpPort()}` : ''
  const finalUrl = `${scheme}://${host}${portSegment}/agent`
  debugLog.log('[RelayConfig] Resolved relay agent URL:', {
    host,
    isLocal,
    scheme,
    portSegment,
    finalUrl,
    envVars: {
      VITE_RELAY_AGENT_URL: import.meta.env.VITE_RELAY_AGENT_URL,
      VITE_PROXY_AGENT_URL: import.meta.env.VITE_PROXY_AGENT_URL
    }
  })
  return finalUrl
}

export const getRelayConnectionString = (connectionId?: string | null) => {
  // Check if using custom/self-hosted relay
  const customUrl = getCustomRelayUrl()
  if (customUrl) {
    // Extract host and port from custom WebSocket URL
    try {
      const wsUrl = new URL(customUrl)
      const host = wsUrl.hostname
      // For self-hosted relay, use port 5432 by default (the CLI's default PG port)
      const pgPort = '5432'
      if (connectionId) {
        return `postgres://postgres:AUTH_TOKEN@${host}:${pgPort}`
      } else {
        return `postgres://postgres:AUTH_TOKEN@${host}:${pgPort}`
      }
    } catch {
      // Fall through to normal logic if URL parsing fails
    }
  }

  // Only use explicitly configured connection string (prefer new name, fallback to old for migration)
  const configured = import.meta.env.VITE_RELAY_CONNECTION_STRING || import.meta.env.VITE_PROXY_CONNECTION_STRING
  if (configured) {
    // If it's already in psql format, return as-is
    if (configured.startsWith('psql ')) {
      return configured
    }
    // Legacy postgres:// URLs - convert to psql format if connectionId is provided
    if (connectionId && configured.includes('/local')) {
      const replaced = configured.replace('/local', `/${connectionId}`)
      // Try to parse postgres:// URL and convert to psql format
      try {
        const url = new URL(replaced)
        const host = url.hostname
        const port = url.port || '5432'
        // Connection ID is in hostname, use cleanest format
        if (port === '5432') {
          return `postgres://postgres@${host}`
        } else {
          return `psql "host=${host} port=${port} user=postgres"`
        }
      } catch {
        return replaced
      }
    }
    return configured
  }

  // Self-hosted relay host (VITE_RELAY_HOST or localhost)
  const connectionHost = getRelayHost()
  const pgPort = getRelayPgPort()

  // Connection ID must be in the database name for routing (Postgres clients don't send SNI)
  // Format: psql "host=HOST port=PORT user=postgres dbname=CONNECTION_ID"
  if (!connectionId) {
    return `postgres://postgres@${connectionHost}:${pgPort}/YOUR_CONNECTION_ID`
  }

  return `psql "host=${connectionHost} port=${pgPort} user=postgres dbname=${connectionId}"`
}

export const getRelayHealthUrl = () => {
  // Check for custom relay URL first
  const customUrl = getCustomRelayUrl()
  if (customUrl) {
    try {
      const wsUrl = new URL(customUrl)
      const scheme = wsUrl.protocol === 'wss:' ? 'https' : 'http'
      const portSegment = wsUrl.port ? `:${wsUrl.port}` : ''
      return `${scheme}://${wsUrl.hostname}${portSegment}/health`
    } catch {
      // Fall through to normal logic
    }
  }

  const host = getRelayHost()
  const isLocal = isLocalHost(host)
  const scheme = isLocal ? 'http' : 'https'
  const portSegment = isLocal ? `:${getLocalHttpPort()}` : ''
  return `${scheme}://${host}${portSegment}/health`
}

