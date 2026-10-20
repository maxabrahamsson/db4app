import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { useDb } from './DbContext'
import { isTauriContext } from '../storage'
import { debugLog } from '../utils/debug'
import { getRelayAgentUrl } from '../utils/relayConfig'
import { Db4AppAgent, setSharedAgent } from '@db4app/client-sdk'


const CONNECTION_ID_STORAGE_KEY = 'db4app-connection-id'
const AUTH_TOKEN_STORAGE_KEY = 'db4app-auth-token'

interface RelayContextType {
  connectionId: string | null
  authToken: string
  relayStatus: string
  relayError?: string | null
  setConnectionId: (id: string | null) => void
  setRelayStatus: (status: string) => void
}

const RelayContext = createContext<RelayContextType | undefined>(undefined)

export function RelayProvider({ children }: { children: ReactNode }) {
  const { db, updateLastAccessTime } = useDb()

  // Load connectionId from localStorage on mount
  const [connectionId, setConnectionIdState] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(CONNECTION_ID_STORAGE_KEY)
    }
    return null
  })

  // Generate or load auth token from localStorage
  const [authToken] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
      if (stored) {
        return stored
      }
      const newToken = crypto.randomUUID?.() ||
        Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, newToken)
      return newToken
    }
    return 'default-token' // Fallback for SSR
  })

  const [relayStatus, setRelayStatus] = useState('Relay bridge idle')
  const [relayError, setRelayError] = useState<string | null>(null)

  // Use the Agent from SDK
  const agentRef = useRef<Db4AppAgent | null>(null)

  // Sync connectionId to localStorage on change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (connectionId) {
        localStorage.setItem(CONNECTION_ID_STORAGE_KEY, connectionId)
      } else {
        localStorage.removeItem(CONNECTION_ID_STORAGE_KEY)
      }
    }
  }, [connectionId])

  // Listen for storage events (cross-tab synchronization)
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === CONNECTION_ID_STORAGE_KEY) {
        setConnectionIdState(e.newValue)
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  // Establish connection using Agent
  useEffect(() => {
    const isTauri = isTauriContext()

    // In Web mode, require DB. In Tauri mode, allow connection without DB (control plane)
    if ((!db && !isTauri) || typeof window === 'undefined') return

    // DEBUG: Force overload state for UI testing
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.get('test_overload') === 'true') {
      debugLog.log('[RelayContext] Test mode: Forcing overload state')
      setRelayError('capacity_limit')
      setRelayStatus('System busy (Test Mode)')
      return
    }

    const agentUrl = getRelayAgentUrl()
    debugLog.log('[RelayContext] Initializing Db4AppAgent:', {
      agentUrl,
      connectionId,
      authToken: authToken.substring(0, 8) + '...',
    })

    const agent = new Db4AppAgent({
      db: db || undefined,
      relayUrl: agentUrl,
      authToken,
      onStatusChange: (status) => {
        setRelayStatus(status)
        // If we get a connection ID in the status message (hacky but effective for now)
        // Ideally agent exposes events. 
        // The agent class updates status with "Ready (ID: ...)"
        if (status.startsWith('Ready (ID: ')) {
          const id = agent.getConnectionId()
          if (id && id !== connectionId) {
            setConnectionIdState(id)
          }
        }
      },
      onError: (err) => {
        // No relay running is a normal state (browser-only mode) - don't spam the console
        debugLog.warn('[RelayContext] Relay not reachable at', agentUrl, '- running in browser-only mode.', err)
        setRelayError(err.message)
        // Check for specific error codes if needed (e.g. capacity limit)
        // For now, simple error setting
      }
    })

    agentRef.current = agent

    // Connect
    agent.connect().catch(err => {
      debugLog.warn('[RelayContext] Connection failed (browser-only mode):', err)
      setRelayStatus('Relay connection failed')
    })

    // IMPORTANT: Set this agent as the shared instance
    // This allows other components (like microfrontends) to reuse the connection
    setSharedAgent(agent)

    return () => {
      agent.disconnect()
      agentRef.current = null
    }
  }, [db, updateLastAccessTime, authToken /* connectionId not needed as dep, handled internally */])

  // Explicit setter for connection ID (exposed to consumers)
  const setConnectionId = useCallback((id: string | null) => {
    setConnectionIdState(id)
  }, [])

  return (
    <RelayContext.Provider
      value={{
        connectionId,
        authToken,
        relayStatus,
        relayError,
        setConnectionId,
        setRelayStatus,
      }}
    >
      {children}
    </RelayContext.Provider>
  )
}

export function useRelay() {
  const context = useContext(RelayContext)
  if (context === undefined) {
    throw new Error('useRelay must be used within a RelayProvider')
  }
  return context
}

