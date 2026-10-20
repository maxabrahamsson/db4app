import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useDb } from '../contexts/DbContext'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useRelay } from '../contexts/RelayContext'
import './StatusIndicator.css'

export function StatusIndicator() {
  const { db, lastAccessTime, readOnly, setReadOnly } = useDb()
  const { relayStatus, connectionId } = useRelay()
  const [isHovered, setIsHovered] = useState(false)
  const faviconLinkRef = useRef<HTMLLinkElement | null>(null)
  const hoverTimeoutRef = useRef<number | null>(null)

  const isLive = db !== null

  // Derive relay connection state from relayStatus string
  const isRelayConnected = relayStatus.toLowerCase().includes('connected') || relayStatus.toLowerCase().includes('ready')
  const isRelayError = relayStatus.toLowerCase().includes('error') || relayStatus.toLowerCase().includes('failed')

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

  // Update favicon based on DB status
  useEffect(() => {
    // Find or create favicon link
    let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    faviconLinkRef.current = link

    // Create favicon canvas
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Draw green circle for live, gray for not live
    ctx.clearRect(0, 0, 32, 32)
    if (isLive) {
      ctx.fillStyle = '#10b981' // green-500
      ctx.beginPath()
      ctx.arc(16, 16, 12, 0, 2 * Math.PI)
      ctx.fill()
    } else {
      ctx.fillStyle = '#6b7280' // gray-500
      ctx.beginPath()
      ctx.arc(16, 16, 12, 0, 2 * Math.PI)
      ctx.fill()
    }

    // Update favicon
    if (faviconLinkRef.current) {
      faviconLinkRef.current.href = canvas.toDataURL()
    }
  }, [isLive])

  const formatLastAccess = () => {
    if (!lastAccessTime) return 'Never'
    const now = new Date()
    const diff = now.getTime() - lastAccessTime.getTime()
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (seconds < 60) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return lastAccessTime.toLocaleString()
  }

  return (
    <Link
      to="/database"
      className="status-indicator-link"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={`status-indicator ${isLive ? 'live' : 'idle'}`}>
        <div className="status-badge">
          <div className="status-dot" />
          <span className="status-label">Database</span>
          <span className="status-state">{isLive ? 'Live' : 'Idle'}</span>
        </div>
        <div className={`status-drawer ${isHovered ? 'open' : ''}`}>
          <div className="status-drawer-content">
            <div className="status-drawer-section">
              <div className="status-drawer-header">
                <span className="status-drawer-title">Database Status</span>
                <span className={`status-drawer-badge ${isLive ? 'live' : 'idle'}`}>
                  {isLive ? 'Live' : 'Idle'}
                </span>
              </div>
              <div className="status-drawer-body">
                <p className="status-drawer-text">
                  {isLive
                    ? 'Database is live and accessible'
                    : 'Database is not initialized'}
                </p>
                {isLive && lastAccessTime && (
                  <p className="status-drawer-time">
                    Last access: {formatLastAccess()}
                  </p>
                )}
              </div>
            </div>

            {isLive && (
              <>
                <div className="status-drawer-divider" />
                <div className="status-drawer-section">
                  <div className="status-drawer-header">
                    <span className="status-drawer-title">Access Mode</span>
                    <span className={`status-drawer-badge ${readOnly ? 'read-only' : 'live'}`}>
                      {readOnly ? 'Read-Only' : 'Read-Write'}
                    </span>
                  </div>
                  <div className="status-drawer-body">
                    <label
                      className="read-only-toggle"
                      onClick={(e: ReactMouseEvent) => { e.preventDefault(); e.stopPropagation() }}
                    >
                      <input
                        type="checkbox"
                        checked={readOnly}
                        onChange={(e) => setReadOnly(e.target.checked)}
                      />
                      <span className="toggle-slider" />
                      <span className="toggle-label">
                        {readOnly ? 'Writes blocked' : 'Writes allowed'}
                      </span>
                    </label>
                  </div>
                </div>
              </>
            )}

            <div className="status-drawer-divider" />

            <div className="status-drawer-section">
              <div className="status-drawer-header">
                <span className="status-drawer-title">Relay Connection</span>
                <span className={`status-drawer-badge ${isRelayConnected ? 'live' : isRelayError ? 'error' : 'idle'}`}>
                  {isRelayConnected ? 'Connected' : isRelayError ? 'Error' : 'Disconnected'}
                </span>
              </div>
              <div className="status-drawer-body">
                <p className="status-drawer-text">
                  {relayStatus}
                </p>
                {connectionId && (
                  <p className="status-drawer-time">
                    Connection ID: {connectionId.slice(0, 8)}...
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

