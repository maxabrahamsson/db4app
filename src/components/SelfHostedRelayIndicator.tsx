import { useState, useEffect, useRef, useCallback } from 'react'
import { useRelay } from '../contexts/RelayContext'
import { isUsingCustomRelay, setCustomRelayUrl, getRelayAgentUrl } from '../utils/relayConfig'
import { debugLog } from '../utils/debug'
import './SelfHostedRelayIndicator.css'

interface SelfHostedRelayInfo {
  httpPort: string
  pgPort: string
  isTauri: boolean
}

function getSelfHostedRelayInfo(): SelfHostedRelayInfo | null {
  try {
    const httpPort = localStorage.getItem('db4app-relay-http-port')
    const pgPort = localStorage.getItem('db4app-relay-pg-port')
    const isTauri = localStorage.getItem('db4app-relay-tauri') === 'true'
    
    // Check if we're using a custom relay URL (self-hosted)
    const customRelayUrl = localStorage.getItem('db4app-relay-url')
    const isLocalhostRelay = customRelayUrl && (
      customRelayUrl.includes('localhost') || 
      customRelayUrl.includes('127.0.0.1')
    )
    
    // Show if:
    // 1. Opened via Tauri app (has isTauri flag and ports), OR
    // 2. Using localhost relay in dev mode (has custom relay URL pointing to localhost)
    if (isTauri && httpPort && pgPort) {
      return { httpPort, pgPort, isTauri }
    }
    
    // In dev mode, if we're using localhost relay, try to extract ports from URL or use defaults
    if (isLocalhostRelay && customRelayUrl) {
      try {
        const url = new URL(customRelayUrl)
        const extractedHttpPort = url.port || httpPort || '8787'
        const extractedPgPort = pgPort || '5432'
        return { 
          httpPort: extractedHttpPort, 
          pgPort: extractedPgPort, 
          isTauri: false 
        }
      } catch {
        // If URL parsing fails, use defaults if we have ports
        if (httpPort && pgPort) {
          return { httpPort, pgPort, isTauri: false }
        }
      }
    }
    
    return null
  } catch {
    return null
  }
}

function clearSelfHostedRelayInfo() {
  try {
    localStorage.removeItem('db4app-relay-http-port')
    localStorage.removeItem('db4app-relay-pg-port')
    localStorage.removeItem('db4app-relay-tauri')
    setCustomRelayUrl(null)
  } catch {
    // Ignore
  }
}

export function SelfHostedRelayIndicator() {
  const { relayStatus } = useRelay()
  const [isHovered, setIsHovered] = useState(false)
  const [relayInfo, setRelayInfo] = useState<SelfHostedRelayInfo | null>(null)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const hoverTimeoutRef = useRef<number | null>(null)

  // Check if we should show this indicator
  useEffect(() => {
    const info = getSelfHostedRelayInfo()
    setRelayInfo(info)
    
    if (!info) return
    
    debugLog.log('[SelfHostedRelay] Detected self-hosted relay:', info)
  }, [])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setIsHovered(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    // Delay closing to allow moving to drawer
    hoverTimeoutRef.current = window.setTimeout(() => {
      setIsHovered(false)
    }, 150)
  }, [])

  // Derive connection state from relayStatus (no polling needed!)
  // Calculate these BEFORE early return to ensure hooks are always called in same order
  // Only show if we have relayInfo (Tauri app opened it) AND are actually using custom relay
  const isActuallyUsingSelfHosted = isUsingCustomRelay()
  const shouldShow = relayInfo && isActuallyUsingSelfHosted
  
  // Check if we're actually connected to self-hosted (not cloud)
  // Detect when the self-hosted server is closed and we should clear localStorage
  useEffect(() => {
    if (!relayInfo) return
    
    const hasCustomRelayUrl = isUsingCustomRelay()
    const agentUrl = getRelayAgentUrl()
    const isLocalhostUrl = agentUrl.includes('localhost') || agentUrl.includes('127.0.0.1')
    const isConnected = relayStatus.toLowerCase().includes('connected')
    const isError = relayStatus.toLowerCase().includes('error') || relayStatus.toLowerCase().includes('failed')
    const isDisconnected = relayStatus.toLowerCase().includes('disconnected')
    
    debugLog.log('[SelfHostedRelay] Connection check:', {
      hasRelayInfo: !!relayInfo,
      hasCustomRelayUrl,
      agentUrl,
      isLocalhostUrl,
      relayStatus,
      isConnected,
      isError,
      isDisconnected
    })
    
    // If we have relayInfo (localStorage has self-hosted info) but:
    // 1. We're not using custom relay URL (it was cleared), OR
    // 2. The agent URL is NOT localhost (we're connecting to cloud), OR
    // 3. We have persistent errors/disconnections suggesting the server is down
    // Then clear the localStorage and reload
    if (relayInfo && (!hasCustomRelayUrl || (!isLocalhostUrl && isConnected))) {
      debugLog.log('[SelfHostedRelay] Detected mismatch: localStorage has self-hosted info but not actually using self-hosted relay. Clearing...', {
        hasRelayInfo: !!relayInfo,
        hasCustomRelayUrl,
        agentUrl,
        isLocalhostUrl,
        relayStatus,
        customRelayUrl: localStorage.getItem('db4app-relay-url')
      })
      clearSelfHostedRelayInfo()
      setRelayInfo(null)
      // Small delay to ensure state is cleared before reload
      setTimeout(() => {
        window.location.reload()
      }, 100)
      return
    }
    
    // Also check for persistent connection errors to localhost (server is down)
    if (relayInfo && isLocalhostUrl && (isError || isDisconnected)) {
      // Give it a few seconds - if still erroring after 3 seconds, assume server is down
      const timeoutId = setTimeout(() => {
        const stillErroring = relayStatus.toLowerCase().includes('error') || 
                             relayStatus.toLowerCase().includes('failed') ||
                             relayStatus.toLowerCase().includes('disconnected')
        if (stillErroring && relayInfo) {
          debugLog.log('[SelfHostedRelay] Persistent connection errors to localhost. Server appears to be down. Clearing...')
          clearSelfHostedRelayInfo()
          setRelayInfo(null)
          window.location.reload()
        }
      }, 3000)
      
      return () => clearTimeout(timeoutId)
    }
  }, [relayStatus, relayInfo])
  
  // Only consider connected if:
  // 1. We have relayInfo (Tauri opened it)
  // 2. We're actually using self-hosted relay
  // 3. Status includes "connected" but NOT "cloud" (to avoid false positives on production)
  const isConnected = shouldShow && relayStatus.toLowerCase().includes('connected') 
    && !relayStatus.toLowerCase().includes('cloud')
  
  const isError = shouldShow 
    ? (relayStatus.toLowerCase().includes('error') || relayStatus.toLowerCase().includes('failed'))
    : false
  
  // Log state changes for debugging (must be before early return!)
  useEffect(() => {
    if (!shouldShow) return
    
    debugLog.log('[SelfHostedRelay] Status update:', {
      relayStatus,
      isConnected,
      isError,
      relayInfo,
      isUsingCustomRelay: isUsingCustomRelay()
    })
    
    if (isError) {
      debugLog.warn('[SelfHostedRelay] Error state detected!', {
        relayStatus,
        relayInfo,
        localStorage: {
          httpPort: localStorage.getItem('db4app-relay-http-port'),
          pgPort: localStorage.getItem('db4app-relay-pg-port'),
          tauri: localStorage.getItem('db4app-relay-tauri'),
          customRelayUrl: localStorage.getItem('db4app-custom-relay-url')
        }
      })
    }
  }, [relayStatus, isConnected, isError, relayInfo, shouldShow])

  // Don't render if not using self-hosted relay via Tauri
  if (!shouldShow) {
    return null
  }

  const handleDisconnect = () => {
    setIsDisconnecting(true)
    clearSelfHostedRelayInfo()
    // Reload the page to fall back to the default relay configuration
    window.location.reload()
  }

  return (
    <div
      className="selfhosted-indicator-wrapper"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={`selfhosted-indicator ${isConnected ? 'connected' : isError ? 'error' : 'disconnected'}`}>
        <div className="selfhosted-badge">
          <div className="selfhosted-dot" />
          <span className="selfhosted-label">Self-Hosted</span>
          <span className="selfhosted-state">{isConnected ? 'Active' : isError ? 'Error' : 'Connecting'}</span>
        </div>
        <div className={`selfhosted-drawer ${isHovered ? 'open' : ''}`}>
          <div className="selfhosted-drawer-content">
            <div className="selfhosted-drawer-section">
              <div className="selfhosted-drawer-header">
                <span className="selfhosted-drawer-title">Self-Hosted Relay</span>
                <span className={`selfhosted-drawer-badge ${isConnected ? 'connected' : 'disconnected'}`}>
                  {isConnected ? 'Connected' : isError ? 'Error' : 'Connecting'}
                </span>
              </div>
              <div className="selfhosted-drawer-body">
                <p className="selfhosted-drawer-text">
                  {relayStatus}
                </p>
              </div>
            </div>
            
            <div className="selfhosted-drawer-divider" />
            
            <div className="selfhosted-drawer-section">
              <div className="selfhosted-drawer-header">
                <span className="selfhosted-drawer-title">Server Ports</span>
              </div>
              <div className="selfhosted-drawer-ports">
                <div className={`selfhosted-port-row ${isConnected ? 'connected' : ''}`}>
                  <span className="selfhosted-port-label">HTTP Port</span>
                  <span className="selfhosted-port-value">{relayInfo.httpPort}</span>
                  {isConnected && <span className="selfhosted-port-status">✓</span>}
                </div>
                <div className="selfhosted-port-row">
                  <span className="selfhosted-port-label">Postgres Port</span>
                  <span className="selfhosted-port-value">{relayInfo.pgPort}</span>
                </div>
              </div>
            </div>
            
            <div className="selfhosted-drawer-divider" />
            
            <div className="selfhosted-drawer-section">
              <button 
                className="selfhosted-disconnect-btn"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
              >
                {isDisconnecting ? 'Switching...' : 'Switch to Cloud Relay'}
              </button>
              <p className="selfhosted-drawer-hint">
                Stop the relay from the desktop app
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

