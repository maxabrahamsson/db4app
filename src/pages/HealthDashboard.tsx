import React, { useEffect, useState } from 'react'

import { getRelayAgentUrl } from '../utils/relayConfig'

interface HealthStats {
    status: string
    timestamp: string
    uptime: number
    connections: {
        browser: number
        tcp: number
        total: number
    }
    ipStats: {
        uniqueIPs: number
        totalIPConnections: number
        blockedIPs: number
    }
    limits: {
        maxConnectionsPerIP: number
        rateLimitWindowMs: number
        rateLimitMaxConnections: number
        maxConnectionDurationMs: number
    }
    services: {
        http: boolean
        websocket: boolean
        tcp: boolean
    }
}

export const HealthDashboard: React.FC = () => {
    const [stats, setStats] = useState<HealthStats | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState<boolean>(true)

    const fetchHealth = async () => {
        try {
            // Convert WSS URL to HTTPS URL for health check
            const agentUrl = getRelayAgentUrl()
            const httpUrl = agentUrl
                .replace('wss://', 'https://')
                .replace('ws://', 'http://')
                .replace('/agent', '/health')

            const response = await fetch(httpUrl)
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`)
            }
            const data = await response.json()
            setStats(data)
            setError(null)
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchHealth()
        const interval = setInterval(fetchHealth, 3000)
        return () => clearInterval(interval)
    }, [])

    if (loading && !stats) return <div className="p-8">Loading health status...</div>

    return (
        <div className="health-dashboard-container" style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1>Relay Server Health</h1>
                <div style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '4px',
                    background: error ? 'var(--danger)' : 'var(--color-primary)',
                    color: '#ffffff',
                    fontWeight: 'bold'
                }}>
                    {error ? `Error: ${error}` : `Status: ${stats?.status.toUpperCase()}`}
                </div>
            </header>

            {stats && (
                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>

                    {/* General Info */}
                    <div className="card" style={{ background: 'var(--surface)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <h2 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>General</h2>
                        <div className="stat-row"><strong>Uptime:</strong> {(stats.uptime / 60).toFixed(2)} minutes</div>
                        <div className="stat-row"><strong>Timestamp:</strong> {new Date(stats.timestamp).toLocaleTimeString()}</div>
                        <div className="stat-row"><strong>Services:</strong>
                            <span style={{ color: stats.services.http ? 'var(--color-primary)' : 'var(--danger)' }}> HTTP </span> •
                            <span style={{ color: stats.services.websocket ? 'var(--color-primary)' : 'var(--danger)' }}> WS </span> •
                            <span style={{ color: stats.services.tcp ? 'var(--color-primary)' : 'var(--danger)' }}> TCP </span>
                        </div>
                    </div>

                    {/* Connections */}
                    <div className="card" style={{ background: 'var(--surface)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <h2 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Connections</h2>
                        <div className="stat-row" style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>{stats.connections.total}</div>
                        <div className="stat-row">Active Browsers: {stats.connections.browser}</div>
                        <div className="stat-row">Active TCP Clients: {stats.connections.tcp}</div>
                    </div>

                    {/* IP Stats */}
                    <div className="card" style={{ background: 'var(--surface)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <h2 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Security / IP</h2>
                        <div className="stat-row">Total Unique IPs: {stats.ipStats.uniqueIPs}</div>
                        <div className="stat-row" style={{ color: stats.ipStats.blockedIPs > 0 ? 'var(--danger)' : 'inherit' }}>Blocked IPs: {stats.ipStats.blockedIPs}</div>
                    </div>

                    {/* Limits Config */}
                    <div className="card" style={{ background: 'var(--surface)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <h2 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Limits Config</h2>
                        <div className="stat-row">Max Conn/IP: {stats.limits.maxConnectionsPerIP}</div>
                        <div className="stat-row">Rate Window: {stats.limits.rateLimitWindowMs / 1000}s</div>
                        <div className="stat-row">Rate Limit: {stats.limits.rateLimitMaxConnections} / window</div>
                    </div>

                </div>
            )}
        </div>
    )
}
