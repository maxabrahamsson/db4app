/**
 * Utility functions for checking relay server health
 */

import { getRelayHealthUrl } from './relayConfig'
import { debugLog } from './debug'

export interface RelayHealthStatus {
  status: 'healthy' | 'unhealthy' | 'unknown'
  timestamp?: string
  uptime?: number
  connections?: {
    browser: number
    tcp: number
  }
  services?: {
    http: boolean
    websocket: boolean
    tcp: boolean
  }
  error?: string
}

/**
 * Check relay server health
 * Uses the same host resolution logic as the WebSocket connection
 */
export async function checkRelayHealth(): Promise<RelayHealthStatus> {
  const healthUrl = getRelayHealthUrl()

  debugLog.log('[Relay Health] Checking health at:', healthUrl)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return {
        status: 'unhealthy',
        error: `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    return {
      status: data.status === 'healthy' ? 'healthy' : 'unhealthy',
      timestamp: data.timestamp,
      uptime: data.uptime,
      connections: data.connections,
      services: data.services,
    }
  } catch (error) {
    console.error('[Relay Health] Error checking health:', error)
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          status: 'unhealthy',
          error: 'Request timeout',
        }
      }
      return {
        status: 'unhealthy',
        error: error.message,
      }
    }
    return {
      status: 'unknown',
      error: 'Unknown error',
    }
  }
}

