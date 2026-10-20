import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'
import { randomInt, randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PostHog } from 'posthog-node'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const RELAY_HTTP_PORT = Number(process.env.RELAY_PORT ?? process.env.PROXY_PORT ?? 8787)
const RELAY_PG_PORT = Number(process.env.RELAY_PG_PORT ?? process.env.PROXY_PG_PORT ?? 6543)
const REQUEST_TIMEOUT_MS = Number(process.env.RELAY_TIMEOUT ?? process.env.PROXY_TIMEOUT ?? 15_000)

// PostHog analytics (opt-in): only enabled when POSTHOG_API_KEY is set.
// POSTHOG_HOST is optional; when unset the posthog-node default is used.
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || null
const POSTHOG_HOST = process.env.POSTHOG_HOST || null
let posthog = null

// Optional domain used for SNI-based routing of Postgres connections.
// When set (e.g. "pg.example.com"), clients can connect to
// "<connection-id>.pg.example.com" and the relay routes by hostname.
// When unset, any hostname whose first label is a UUID connection ID is accepted.
const RELAY_PG_DOMAIN = (process.env.RELAY_PG_DOMAIN || '').trim().replace(/^\.+|\.+$/g, '')
const PG_HOST_EXAMPLE = RELAY_PG_DOMAIN ? `CONNECTION_ID.${RELAY_PG_DOMAIN}` : 'RELAY_HOST'
const SNI_HOSTNAME_PATTERN = RELAY_PG_DOMAIN
  ? new RegExp(`^([a-f0-9-]+)\\.${RELAY_PG_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
  : /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\./i
const SNI_PATTERN_DESCRIPTION = RELAY_PG_DOMAIN ? `UUID.${RELAY_PG_DOMAIN}` : 'UUID.<domain>'

if (POSTHOG_API_KEY) {
  try {
    posthog = new PostHog(POSTHOG_API_KEY, {
      ...(POSTHOG_HOST ? { host: POSTHOG_HOST } : {}),
      flushAt: 10, // Batch events for efficiency
      flushInterval: 5000, // Flush every 5 seconds
    })
    console.log(`[Relay] PostHog telemetry enabled (POSTHOG_API_KEY set)`)
  } catch (error) {
    console.warn(`[Relay] Failed to initialize PostHog:`, error.message)
  }
}

// TLS Certificate paths (from mounted volume or environment variables)
const TLS_CERT_PATH = process.env.TLS_CERT_PATH || '/etc/tls/tls.crt'
const TLS_KEY_PATH = process.env.TLS_KEY_PATH || '/etc/tls/tls.key'

// Load TLS certificates at startup
let tlsOptions = null
try {
  if (existsSync(TLS_CERT_PATH) && existsSync(TLS_KEY_PATH)) {
    const cert = readFileSync(TLS_CERT_PATH, 'utf8')
    const key = readFileSync(TLS_KEY_PATH, 'utf8')
    tlsOptions = { cert, key }
    console.log(`[TLS] Loaded certificates from ${TLS_CERT_PATH} and ${TLS_KEY_PATH}`)
  } else {
    console.log(`[TLS] Certificates not found at ${TLS_CERT_PATH} and ${TLS_KEY_PATH} - SSL support disabled`)
  }
} catch (err) {
  console.error(`[TLS] Error loading certificates:`, err.message)
  console.log(`[TLS] SSL support will be disabled`)
}

/**
 * Tracks multiple browser agent connections.
 * Each connection has a unique ID and its own pending requests.
 */
const browserConnections = new Map() // connectionId -> { socket, pending: Map<requestId, handler> }

const frontendConnections = new Map() // TCP connection tracking

// Rate limiting and security
const IP_CONNECTION_LIMIT = Number(process.env.IP_CONNECTION_LIMIT ?? 10) // Max connections per IP
const IP_RATE_LIMIT_WINDOW_MS = Number(process.env.IP_RATE_LIMIT_WINDOW_MS ?? 60000) // 1 minute window
const IP_RATE_LIMIT_MAX_CONNECTIONS = Number(process.env.IP_RATE_LIMIT_MAX_CONNECTIONS ?? 5) // Max new connections per window
const MAX_CONNECTION_DURATION_MS = Number(process.env.MAX_CONNECTION_DURATION_MS ?? 3600000) // 1 hour max

// Allowlist for bypassing rate limits (comma-separated IPs)
const RATE_LIMIT_ALLOWLIST = new Set(
  (process.env.RATE_LIMIT_ALLOWLIST ?? '')
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean)
)

// Trusted internal CIDR ranges that bypass rate limiting (comma-separated, e.g. "10.0.0.0/8").
// Empty by default.
const TRUSTED_CIDRS = (process.env.TRUSTED_CIDRS ?? '')
  .split(',')
  .map(cidr => cidr.trim())
  .filter(Boolean)
  .map(cidr => {
    const [network, bits] = cidr.split('/')
    const prefix = bits ? Number(bits) : 32
    const octets = network.split('.').map(Number)
    const networkInt = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
    return { networkInt: networkInt & mask, mask }
  })

// Check if an IP falls within any trusted CIDR range
function isInTrustedCIDR(ip) {
  // Strip IPv6-mapped IPv4 prefix (e.g. ::ffff:10.0.0.5 -> 10.0.0.5)
  const cleanIP = ip.replace(/^::ffff:/, '')
  const octets = cleanIP.split('.')
  if (octets.length !== 4) return false
  const ipInt = ((Number(octets[0]) << 24) | (Number(octets[1]) << 16) | (Number(octets[2]) << 8) | Number(octets[3])) >>> 0
  return TRUSTED_CIDRS.some(({ networkInt, mask }) => (ipInt & mask) === networkInt)
}

// Track connections per IP
const ipConnections = new Map() // ip -> Set<connectionId>
const ipConnectionAttempts = new Map() // ip -> { count: number, resetAt: number }
const blockedIPs = new Set() // IPs that are temporarily blocked

// Helper to get client IP from request
function getClientIP(req) {
  // Check X-Forwarded-For header (for proxies/load balancers)
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  // Check X-Real-IP header
  if (req.headers['x-real-ip']) {
    return req.headers['x-real-ip']
  }
  // Fallback to socket remote address
  return req.socket?.remoteAddress || 'unknown'
}

// Helper to get IP from socket
function getSocketIP(socket) {
  return socket.remoteAddress || 'unknown'
}

// Check if IP is rate limited
function checkRateLimit(ip) {
  // Bypass for allowlisted IPs and trusted internal CIDRs
  if (RATE_LIMIT_ALLOWLIST.has(ip) || isInTrustedCIDR(ip)) {
    return { allowed: true }
  }

  if (blockedIPs.has(ip)) {
    return { allowed: false, reason: 'IP is temporarily blocked' }
  }

  const now = Date.now()
  const attempts = ipConnectionAttempts.get(ip)

  if (!attempts || attempts.resetAt < now) {
    // Reset window
    ipConnectionAttempts.set(ip, { count: 1, resetAt: now + IP_RATE_LIMIT_WINDOW_MS })
    return { allowed: true }
  }

  if (attempts.count >= IP_RATE_LIMIT_MAX_CONNECTIONS) {
    // Block IP temporarily (5 minutes)
    blockedIPs.add(ip)
    setTimeout(() => {
      blockedIPs.delete(ip)
      ipConnectionAttempts.delete(ip)
      console.log(`[Security] Unblocked IP: ${ip}`)
    }, 5 * 60 * 1000) // 5 minutes
    console.warn(`[Security] ⚠️ IP ${ip} blocked for excessive connection attempts (${attempts.count} in ${IP_RATE_LIMIT_WINDOW_MS}ms)`)
    return { allowed: false, reason: 'Rate limit exceeded' }
  }

  attempts.count++
  return { allowed: true }
}

// Check if IP has too many active connections
function checkConnectionLimit(ip) {
  // Bypass for allowlisted IPs and trusted internal CIDRs
  if (RATE_LIMIT_ALLOWLIST.has(ip) || isInTrustedCIDR(ip)) {
    return { allowed: true }
  }

  const connections = ipConnections.get(ip) || new Set()
  if (connections.size >= IP_CONNECTION_LIMIT) {
    console.warn(`[Security] ⚠️ IP ${ip} has ${connections.size} active connections (limit: ${IP_CONNECTION_LIMIT})`)
    return { allowed: false, reason: `Maximum ${IP_CONNECTION_LIMIT} connections per IP` }
  }
  return { allowed: true }
}

// Track connection for IP
function trackIPConnection(ip, connectionId) {
  if (!ipConnections.has(ip)) {
    ipConnections.set(ip, new Set())
  }
  ipConnections.get(ip).add(connectionId)
}

// Untrack connection for IP
function untrackIPConnection(ip, connectionId) {
  const connections = ipConnections.get(ip)
  if (connections) {
    connections.delete(connectionId)
    if (connections.size === 0) {
      ipConnections.delete(ip)
    }
  }
}

const httpServer = http.createServer(async (req, res) => {
  const requestId = Math.random().toString(36).substring(7)

  // IMPORTANT: When WebSocketServer is attached to httpServer, it handles WebSocket upgrades
  // AUTOMATICALLY via the 'upgrade' event BEFORE this HTTP handler is called.
  // So this handler will NEVER see WebSocket upgrade requests - only regular HTTP requests.
  // Therefore, we don't need to detect or handle WebSocket upgrades here.

  console.log(`[HTTP ${requestId}] ${req.method} ${req.url}`)

  // Apply CORS to all HTTP requests (WebSocket upgrades are handled by WebSocketServer)
  applyCorsHeaders(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Parse URL to extract connectionId from path
  // Format: /{connectionId}/query or /{connectionId}/public-key
  // This matches Postgres URL format where connectionId is the database name
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const pathParts = url.pathname.split('/').filter(Boolean)

  // Support both /{connectionId}/query and legacy /query/{connectionId} and /query?connectionId=...
  let connectionId = null
  if (pathParts.length >= 2) {
    // New format: /{connectionId}/query or /{connectionId}/public-key
    if (pathParts[1] === 'query' || pathParts[1] === 'public-key') {
      connectionId = pathParts[0]
    }
    // Legacy format: /query/{connectionId}
    else if (pathParts[0] === 'query' && pathParts[1]) {
      connectionId = pathParts[1]
    } else if (pathParts[0] === 'public-key' && pathParts[1]) {
      connectionId = pathParts[1]
    }
  }

  // Fallback to query parameter for backward compatibility
  if (!connectionId) {
    connectionId = url.searchParams.get('connectionId')
  }

  // Health check endpoint
  if (req.method === 'GET' && req.url === '/health') {
    await handleHealthCheck(req, res)
    return
  }

  if (req.method === 'GET' && (pathParts[1] === 'public-key' || pathParts[0] === 'public-key' || req.url === '/public-key')) {
    await handlePublicKeyRequest(req, res, connectionId)
    return
  }

  // /agent path is only for WebSocket connections (handled by WebSocketServer)
  // Any HTTP request to /agent should return 404
  if (req.url?.startsWith('/agent')) {
    console.log(`[HTTP ${requestId}] HTTP request to /agent - returning 404 (WebSocket only)`)
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found - /agent is WebSocket only' }))
    return
  }

  // Regular HTTP request handling
  if (req.method === 'POST' && (pathParts[1] === 'query' || pathParts[0] === 'query' || req.url === '/query')) {
    console.log(`[HTTP ${requestId}] Routing POST request to handleQueryRequest: url=${req.url}, connectionId=${connectionId}`)
    await handleQueryRequest(req, res, connectionId)
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

/**
 * Health check endpoint
 */
async function handleHealthCheck(req, res) {
  const activeConnections = browserConnections.size
  const tcpConnections = frontendConnections.size

  // Calculate IP statistics
  const ipStats = {}
  let totalIPConnections = 0
  for (const [ip, connections] of ipConnections.entries()) {
    ipStats[ip] = connections.size
    totalIPConnections += connections.size
  }

  // Get top IPs by connection count
  const topIPs = Object.entries(ipStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ip, count]) => ({ ip, connections: count }))

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    connections: {
      browser: activeConnections,
      tcp: tcpConnections,
      total: activeConnections + tcpConnections,
    },
    ipStats: {
      uniqueIPs: ipConnections.size,
      totalIPConnections,
      blockedIPs: blockedIPs.size,
    },
    limits: {
      maxConnectionsPerIP: IP_CONNECTION_LIMIT,
      rateLimitWindowMs: IP_RATE_LIMIT_WINDOW_MS,
      rateLimitMaxConnections: IP_RATE_LIMIT_MAX_CONNECTIONS,
      maxConnectionDurationMs: MAX_CONNECTION_DURATION_MS,
    },
    services: {
      http: true,
      websocket: true,
      tcp: tcpServer.listening,
    },
  }))
}

/**
 * Handles public key request (DEPRECATED - RSA keys no longer used)
 * This endpoint is kept for backward compatibility but returns a deprecation notice.
 * We now use Postgres TCP protocol with TLS encryption and password authentication.
 * Requires connectionId in URL path (/public-key/{connectionId}) or query parameter
 */
async function handlePublicKeyRequest(req, res, connectionId) {
  // Return deprecation notice
  res.writeHead(410, { 'content-type': 'application/json' }) // 410 Gone
  res.end(JSON.stringify({
    error: 'RSA encryption is deprecated. Please use Postgres TCP protocol with TLS encryption.',
    message: 'This endpoint is no longer supported. Use the Postgres wire protocol (port 6543) with TLS and password authentication instead.',
    deprecated: true
  }))
  return
}

/**
 * Validates SQL against allowed tables/schemas for MCP server security
 * @param {string} sql - SQL query to validate
 * @param {string[]} allowedTables - Array of "schema.table" strings
 * @returns {{ valid: boolean; error?: string }}
 */
function validateSQL(sql, allowedTables = []) {
  if (!allowedTables || allowedTables.length === 0) {
    // No restrictions - allow all (for direct browser queries)
    return { valid: true }
  }

  const sqlUpper = sql.toUpperCase().trim()

  // Block dangerous operations on non-allowed tables
  const dangerousOps = ['DROP', 'TRUNCATE', 'ALTER', 'DELETE']
  const hasDangerousOp = dangerousOps.some((op) => sqlUpper.startsWith(op))

  // Simple table reference extraction (basic implementation)
  // In production, use a proper SQL parser
  const tablePattern = /FROM\s+([a-z_][a-z0-9_]*\.?[a-z_][a-z0-9_]*)/gi
  const matches = [...sql.matchAll(tablePattern)]
  const referencedTables = matches.map((m) => m[1].toLowerCase())

  // Check if any referenced table is not in the whitelist
  for (const table of referencedTables) {
    const normalized = table.includes('.') ? table : `public.${table}`
    if (!allowedTables.some((allowed) => allowed.toLowerCase() === normalized)) {
      return {
        valid: false,
        error: `Access denied: Table "${table}" is not in the allowed list. Allowed tables: ${allowedTables.join(', ')}`,
      }
    }
  }

  // For dangerous operations, require explicit table in allowed list
  if (hasDangerousOp && referencedTables.length > 0) {
    for (const table of referencedTables) {
      const normalized = table.includes('.') ? table : `public.${table}`
      if (!allowedTables.some((allowed) => allowed.toLowerCase() === normalized)) {
        return {
          valid: false,
          error: `Operation denied: Cannot perform ${sqlUpper.split(' ')[0]} on table "${table}". Only allowed tables can be modified.`,
        }
      }
    }
  }

  return { valid: true }
}

async function handleQueryRequest(req, res, connectionIdFromPath) {
  const requestId = Math.random().toString(36).substring(7)
  try {
    const body = await readBody(req)
    const payload = JSON.parse(body || '{}')

    // Prefer connectionId from URL path, fallback to body for backward compatibility
    const connectionId = connectionIdFromPath || payload.connectionId
    if (!connectionId) {
      console.log(`[Query ${requestId}] Missing connectionId`)
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'Missing connectionId. Use /query/{connectionId} or include connectionId in request body.' }))
      return
    }

    console.log(`[Query ${requestId}] Processing query for connectionId: ${connectionId}`)

    // Wait for connection to be available with retry logic
    // This handles race conditions where the HTTP request arrives before WebSocket is fully established
    const maxRetries = 5
    const initialDelay = 100 // Start with 100ms
    let connection = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      connection = browserConnections.get(connectionId)
      if (connection && connection.socket.readyState === WebSocket.OPEN) {
        console.log(`[Query ${requestId}] Connection found and ready (attempt ${attempt + 1})`)
        break // Connection found and open
      }

      if (attempt < maxRetries - 1) {
        // Wait with exponential backoff before retrying
        const delay = initialDelay * Math.pow(2, attempt)
        console.log(`[Query ${requestId}] Connection ${connectionId} not ready (attempt ${attempt + 1}/${maxRetries}), waiting ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      console.log(`[Query ${requestId}] Connection ${connectionId} not found after ${maxRetries} retries`)
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: 'Connection not found or disconnected. Make sure the browser tab is open and connected.',
        connectionId,
        retries: maxRetries
      }))
      return
    }

    console.log(`[Query ${requestId}] Connection verified, processing query...`)

    // Check if this is an encrypted request
    if (payload.encrypted) {
      // Encrypted payload - relay cannot decrypt, just forward it
      // The browser agent will decrypt and validate
      console.log(`[Query ${requestId}] Dispatching encrypted query to agent`)
      const result = await dispatchToAgent(connection, {
        type: 'execute_encrypted',
        encryptedPayload: payload.encryptedPayload,
        allowedTables: payload.allowedTables, // Still pass for validation after decryption
      })

      console.log(`[Query ${requestId}] Query completed successfully`)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, result }))
      return
    }

    // Legacy unencrypted request (for backward compatibility)
    const { sql, params = [], allowedTables } = payload

    if (typeof sql !== 'string' || !sql.trim()) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'Missing SQL string' }))
      return
    }

    // Validate SQL against allowed tables (if provided)
    if (allowedTables && Array.isArray(allowedTables) && allowedTables.length > 0) {
      const validation = validateSQL(sql, allowedTables)
      if (!validation.valid) {
        res.writeHead(403, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: validation.error }))
        return
      }
    }

    const safeParams = Array.isArray(params) ? params : []
    console.log(`[Query ${requestId}] Dispatching unencrypted query to agent: ${sql.substring(0, 100)}...`)
    const result = await dispatchToAgent(connection, {
      type: 'execute',
      sql,
      params: safeParams,
    })

    console.log(`[Query ${requestId}] Query completed successfully`)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, result }))
  } catch (err) {
    console.error(`[Query ${requestId}] Error processing query:`, err)
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }))
  }
}

/**
 * Sends a command to a specific browser agent connection and waits for the response.
 * @param {{ socket: WebSocket, pending: Map }} connection - The browser connection
 * @param {Record<string, unknown>} payload - The message payload
 */
function dispatchToAgent(connection, payload) {
  return new Promise((resolve, reject) => {
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      const error = new Error('Agent disconnected')
      console.error('[Dispatch] Agent disconnected, readyState:', connection?.socket?.readyState)
      reject(error)
      return
    }

    const requestId = randomUUID()
    const message = { ...payload, requestId }

    console.log(`[Dispatch ${requestId}] Sending message to agent:`, { type: payload.type, connectionId: connection.connectionId })

    const timeout = setTimeout(() => {
      connection.pending.delete(requestId)
      console.error(`[Dispatch ${requestId}] Request timed out after ${REQUEST_TIMEOUT_MS}ms`)
      reject(new Error('Agent timed out'))
    }, REQUEST_TIMEOUT_MS)

    connection.pending.set(requestId, { resolve, reject, timeout })

    try {
      connection.socket.send(JSON.stringify(message), (err) => {
        if (err) {
          clearTimeout(timeout)
          connection.pending.delete(requestId)
          console.error(`[Dispatch ${requestId}] Error sending message:`, err)
          reject(err)
        } else {
          console.log(`[Dispatch ${requestId}] Message sent successfully, waiting for response...`)
        }
      })
    } catch (err) {
      clearTimeout(timeout)
      connection.pending.delete(requestId)
      console.error(`[Dispatch ${requestId}] Exception sending message:`, err)
      reject(err)
    }
  })
}

// Create WebSocketServer WITHOUT attaching to httpServer initially
// We'll handle upgrades manually to avoid conflicts with multiple WebSocket servers
const wss = new WebSocketServer({
  noServer: true, // Don't attach to httpServer - we'll handle upgrades manually
  // Enable ping/pong keepalive to prevent idle connection timeouts
  // This sends a ping every 30 seconds and expects a pong response
  // If no pong is received within 10 seconds, the connection is closed
  clientTracking: true,
  perMessageDeflate: false,
  verifyClient: (info) => {
    const origin = info.origin || 'unknown origin'
    const url = info.req.url || 'unknown'
    const requestId = Math.random().toString(36).substring(7)
    console.log(`[WS verifyClient ${requestId}] WebSocket upgrade request from ${origin} to ${url}`)
    console.log(`[WS verifyClient ${requestId}] Request method: ${info.req.method}`)
    console.log(`[WS verifyClient ${requestId}] Request headers:`, {
      upgrade: info.req.headers.upgrade,
      connection: info.req.headers.connection,
      'sec-websocket-key': info.req.headers['sec-websocket-key'] ? 'present' : 'missing',
      'sec-websocket-version': info.req.headers['sec-websocket-version'],
      origin: info.req.headers.origin
    })

    // Only accept /agent path
    if (!url.startsWith('/agent')) {
      console.log(`[WS verifyClient ${requestId}] ❌ Rejecting WebSocket upgrade - path mismatch: ${url}`)
      return false
    }

    const accepted = true
    console.log(`[WS verifyClient ${requestId}] ✅ Upgrade request ACCEPTED for ${url}`)
    return accepted
  },
  // Handle upgrade errors
  handleProtocols: (protocols) => {
    console.log(`[WS] Client requested protocols: ${protocols.join(', ') || 'none'}`)
    return false // Don't require any specific protocol
  }
})

// WebSocketServer automatically handles 'upgrade' events when attached to httpServer
// We should NOT add our own upgrade listener as it can interfere with WebSocketServer

// Handle WebSocket upgrades manually to support multiple WebSocket servers
// This prevents conflicts when multiple WebSocketServer instances are used
httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname

  console.log(`[HTTP upgrade] Upgrade request for ${pathname}`)

  if (pathname.startsWith('/agent')) {
    // Handle /agent WebSocket connections
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  } else if (pathname.startsWith('/pg-ws')) {
    // Handle /pg-ws WebSocket connections
    pgWss.handleUpgrade(request, socket, head, (ws) => {
      pgWss.emit('connection', ws, request)
    })
  } else {
    // Unknown WebSocket path - destroy the socket
    console.log(`[HTTP upgrade] Unknown WebSocket path: ${pathname}, closing connection`)
    socket.destroy()
  }
})

// Listen for WebSocketServer errors
wss.on('error', (error) => {
  console.error(`[WS Server] WebSocketServer error:`, error)
  console.error(`[WS Server] Error stack:`, error.stack)
})

wss.on('connection', (ws, req) => {
  const logId = Math.random().toString(36).substring(7)
  const clientIP = getClientIP(req)

  // Max concurrent users (1 WS + 1 TCP per user)
  // Defaults to 500 to prevent system crash
  const MAX_CONCURRENT_USERS = parseInt(process.env.MAX_CONCURRENT_USERS || '500', 10)

  // Count active WebSocket connections
  // Note: wss.clients is a Set of all connected clients
  const activeCount = wss.clients.size

  if (activeCount > MAX_CONCURRENT_USERS) {
    console.warn(`[Capacity] ⚠️ Rejecting connection from ${clientIP}: Capacity reached (${activeCount}/${MAX_CONCURRENT_USERS})`)
    // Close with custom code 4503 (Service Unavailable / Capacity LImt)
    // Delay slightly to ensure handshake completes and code propagates through any reverse proxy
    setTimeout(() => {
      console.log(`[Capacity] Closing connection ${clientIP} (State: ${ws.readyState})`)
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(4503, 'Server Capacity Reached')
      } else if (ws.readyState === WebSocket.CONNECTING) {
        console.log(`[Capacity] Connection still CONNECTING. calling close(4503) anyway.`)
        ws.close(4503, 'Server Capacity Reached')
      } else {
        console.log(`[Capacity] Connection state ${ws.readyState}, calling terminate()`)
        ws.terminate()
      }
    }, 100)
    return
  }

  // Rate limiting check for WebSocket connections
  const rateLimitCheck = checkRateLimit(clientIP)
  if (!rateLimitCheck.allowed) {
    console.warn(`[Security] ⚠️ Rejecting WebSocket connection from ${clientIP}: ${rateLimitCheck.reason}`)
    ws.close(1008, rateLimitCheck.reason)
    return
  }

  console.log(`[WS connection ${logId}] ✅✅✅ WebSocket connection established from ${clientIP}, URL: ${req.url}`)
  console.log(`[WS connection ${logId}] Connection readyState: ${ws.readyState}, protocol: ${ws.protocol}`)
  console.log(`[WS connection ${logId}] Connection headers:`, {
    origin: req.headers.origin,
    'user-agent': req.headers['user-agent']?.substring(0, 50)
  })
  console.log(`[WS connection ${logId}] WebSocket object:`, {
    readyState: ws.readyState,
    protocol: ws.protocol,
    extensions: ws.extensions,
    _socket: ws._socket ? 'present' : 'missing'
  })
  // Wait for browser to send its connectionId, or generate a new one
  let connectionId = null
  let connection = null
  let connectionEstablished = false

  const establishConnection = (requestedConnectionId) => {
    if (connectionEstablished) return

    // If browser requested a specific connectionId, try to reuse it
    if (requestedConnectionId) {
      const existingConnection = browserConnections.get(requestedConnectionId)
      if (existingConnection && existingConnection.socket.readyState === WebSocket.OPEN) {
        // Close old connection with same ID (browser reconnected)
        console.log(`Closing old connection for ${requestedConnectionId}`)
        existingConnection.socket.close()
        browserConnections.delete(requestedConnectionId)
      }
      connectionId = requestedConnectionId
    } else {
      // Generate new connection ID
      connectionId = randomUUID()
    }

    connection = {
      socket: ws,
      pending: new Map(),
      connectionId,
      connectedAt: new Date(),
      clientIP, // Track client IP for security
    }

    browserConnections.set(connectionId, connection)

    // Track IP connection (WebSocket connections count towards limit too)
    trackIPConnection(clientIP, connectionId)

    console.log(`Browser agent connected: ${connectionId}, readyState: ${ws.readyState}, IP: ${clientIP}`)

    // Send connection ID to browser immediately if WebSocket is OPEN
    // Use setImmediate to ensure we're in the next tick after connection establishment
    setImmediate(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.error(`[Relay] ❌ Cannot send connection_established, WebSocket not OPEN, readyState: ${ws.readyState}`)
        return
      }

      // Send connection ID to browser
      const connectionMessage = JSON.stringify({
        type: 'connection_established',
        connectionId,
      })

      console.log(`[Relay] 📤 Attempting to send connection_established to ${connectionId}`)
      console.log(`[Relay] WebSocket readyState: ${ws.readyState}, message: ${connectionMessage}`)

      try {
        ws.send(connectionMessage, (err) => {
          if (err) {
            console.error(`[Relay] ❌ Failed to send connection_established to ${connectionId}:`, err)
          } else {
            console.log(`[Relay] ✅ Successfully sent connection_established to ${connectionId}`)
          }
        })
      } catch (err) {
        console.error(`[Relay] ❌ Error sending connection_established to ${connectionId}:`, err)
        console.error(`[Relay] Error details:`, err)
      }
    })

    connectionEstablished = true
  }

  // Wait for browser to send agent_ready message first
  // This ensures the WebSocket handshake is fully complete before we send any data
  // Sending data too early can cause "Invalid frame header" errors
  const connectionTimeout = setTimeout(() => {
    if (!connectionEstablished) {
      console.log(`[WS connection ${logId}] No agent_ready received within 2 seconds, establishing connection with new ID`)
      establishConnection(null)
    }
  }, 2000)

  ws.on('message', (data) => {
    console.log(`[WS connection ${logId}] 📨 Message received, length=${data.length}, connectionEstablished=${connectionEstablished}`)

    // Handle connection establishment if not yet established
    if (!connectionEstablished) {
      try {
        const message = JSON.parse(data.toString())
        console.log(`[WS connection ${logId}] 📨 First message received: type=${message.type}, connectionId=${message.connectionId || 'null'}`)

        // Handle agent_ready message (first message from browser)
        if (message.type === 'agent_ready') {
          clearTimeout(connectionTimeout)
          console.log(`[WS connection ${logId}] ✅ Received agent_ready, establishing connection...`)
          if (message.connectionId) {
            console.log(`[WS connection ${logId}] Reusing connectionId from browser: ${message.connectionId}`)
            establishConnection(message.connectionId)
          } else {
            console.log(`[WS connection ${logId}] No connectionId provided, generating new one`)
            establishConnection(null)
          }
          return
        } else {
          console.log(`[WS connection ${logId}] ⚠️ First message is not agent_ready, type: ${message.type}`)
        }
      } catch (err) {
        console.error(`[WS connection ${logId}] ❌ Error parsing first message:`, err)
        console.error(`[WS connection ${logId}] Raw data that failed to parse:`, data.toString())
      }
      return // Don't process other messages until connection is established
    }

    // Normal message handling after connection is established
    // Check if message is binary (Postgres protocol) - if so, skip JSON parsing
    // Binary messages are handled by the forwarding handler attached to TCP connections
    if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
      // This is binary data (Postgres protocol), not JSON
      // It will be handled by the wsMessageHandler if there's an active TCP connection
      // Otherwise, ignore it (shouldn't happen, but be safe)
      return
    }

    try {
      const message = JSON.parse(data.toString())

      if (message.type === 'result' && message.requestId) {
        console.log(`[WS connection ${logId}] 📥 Received result for requestId: ${message.requestId}`)
        const entry = connection.pending.get(message.requestId)
        if (entry) {
          clearTimeout(entry.timeout)
          connection.pending.delete(message.requestId)
          if (message.error) {
            console.error(`[WS connection ${logId}] ❌ Result contains error: ${message.error}`)
            entry.reject(new Error(message.error))
          } else {
            console.log(`[WS connection ${logId}] ✅ Result received successfully`)
            entry.resolve(message.result)
          }
        } else {
          console.warn(`[WS connection ${logId}] ⚠️ Received result for unknown requestId: ${message.requestId}`)
        }
      } else if (message.type === 'public_key' && message.requestId) {
        // Handle public key response from agent
        const entry = connection.pending.get(message.requestId)
        if (entry) {
          clearTimeout(entry.timeout)
          connection.pending.delete(message.requestId)
          if (message.publicKey) {
            entry.resolve(message.publicKey)
          } else {
            entry.reject(new Error('No public key in response'))
          }
        }
      }
    } catch (err) {
      console.error(`Failed to parse agent message (${connectionId})`, err)
    }
  })

  // Set up ping/pong keepalive to prevent idle connection timeouts
  // Browsers can close WebSocket connections when tabs are inactive or backgrounded
  // Sending periodic pings keeps the connection alive
  const PING_INTERVAL_MS = 30000 // Send ping every 30 seconds
  const PONG_TIMEOUT_MS = 10000 // Close connection if no pong received within 10 seconds

  let pingInterval = null
  let pongTimeout = null

  const startKeepalive = () => {
    if (pingInterval) return // Already started

    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          // Ping silently - only log errors to avoid log spam with many users
          ws.ping()

          // Set timeout to close connection if no pong received
          if (pongTimeout) clearTimeout(pongTimeout)
          pongTimeout = setTimeout(() => {
            console.warn(`[WS connection ${logId}] No pong received, closing connection`)
            ws.close(1000, 'No pong received')
          }, PONG_TIMEOUT_MS)
        } catch (err) {
          console.error(`[WS connection ${logId}] Error sending ping:`, err)
        }
      }
    }, PING_INTERVAL_MS)
  }

  const stopKeepalive = () => {
    if (pingInterval) {
      clearInterval(pingInterval)
      pingInterval = null
    }
    if (pongTimeout) {
      clearTimeout(pongTimeout)
      pongTimeout = null
    }
  }

  // Handle pong responses
  ws.on('pong', () => {
    // Pong received silently - only clear timeout, don't log to avoid spam
    if (pongTimeout) {
      clearTimeout(pongTimeout)
      pongTimeout = null
    }
  })

  // Start keepalive once connection is established
  if (ws.readyState === WebSocket.OPEN) {
    startKeepalive()
  } else {
    ws.on('open', () => {
      startKeepalive()
    })
  }

  ws.on('close', (code, reason) => {
    stopKeepalive() // Clean up keepalive timers
    console.log(`[WS connection ${logId}] WebSocket closed: code=${code}, reason=${reason?.toString() || 'none'}`)
    if (connectionEstablished && connection && connectionId) {
      const pendingCount = connection.pending.size
      console.log(`[WS connection ${logId}] Browser agent disconnected: ${connectionId}`)
      console.log(`[WS connection ${logId}] Pending requests at close: ${pendingCount}`)
      if (pendingCount > 0) {
        console.log(`[WS connection ${logId}] ⚠️ Connection closed with ${pendingCount} pending requests!`)
        connection.pending.forEach(({ reject, timeout }, requestId) => {
          console.log(`[WS connection ${logId}] Rejecting pending request: ${requestId}`)
          clearTimeout(timeout)
          reject(new Error('Agent disconnected'))
        })
      }
      connection.pending.clear()

      // Untrack IP connection
      if (connection.clientIP) {
        untrackIPConnection(connection.clientIP, connectionId)
      }

      browserConnections.delete(connectionId)
    } else {
      console.log(`[WS connection ${logId}] Browser agent disconnected before connection established`)
      console.log(`[WS connection ${logId}] connectionEstablished=${connectionEstablished}, connection=${!!connection}, connectionId=${connectionId}`)
    }
    clearTimeout(connectionTimeout)
  })

  ws.on('error', (err) => {
    stopKeepalive() // Clean up keepalive timers on error
    console.error(`[WS connection ${logId}] WebSocket error:`, err)
    console.error(`[WS connection ${logId}] Error stack:`, err.stack)
  })

  ws.on('error', (err) => {
    console.error(`[WS connection ${logId}] WebSocket error:`, err)
    console.error(`[WS connection ${logId}] Error details:`, {
      message: err.message,
      code: err.code,
      stack: err.stack?.split('\n').slice(0, 5).join('\n')
    })
    console.error(`[WS connection ${logId}] WebSocket state at error:`, {
      readyState: ws.readyState,
      protocol: ws.protocol,
      connectionId: connectionId || 'not set'
    })
  })
})

/**
 * WebSocket server for Postgres protocol over WebSocket (for clients behind HTTP-only proxies or tunnels)
 * Path format: /pg-ws/{connectionId}
 */
const pgWss = new WebSocketServer({ noServer: true, path: '/pg-ws' })

pgWss.on('connection', (ws, req) => {
  // Extract connectionId from URL path: /pg-ws/{connectionId}
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const pathParts = url.pathname.split('/').filter(Boolean)

  let connectionId = null
  if (pathParts.length >= 2 && pathParts[0] === 'pg-ws') {
    connectionId = pathParts[1]
  }

  if (!connectionId) {
    console.error('[PG-WS] No connectionId in path, closing connection')
    ws.close(1008, 'Connection ID required in path: /pg-ws/{connectionId}')
    return
  }

  // Create a virtual Postgres connection that uses WebSocket instead of TCP
  const pgConnectionId = randomUUID()
  const pgConnection = {
    id: pgConnectionId,
    socket: ws, // Use WebSocket instead of TCP socket
    buffer: Buffer.alloc(0),
    started: false,
    user: 'postgres',
    database: 'local',
    processId: randomInt(1, 2 ** 30),
    secretKey: randomInt(1, 2 ** 30),
    closing: false,
    queue: [],
    status: 'I',
    browserConnectionId: connectionId, // The browser connection ID
    isWebSocket: true, // Flag to indicate this is a WebSocket connection
  }

  frontendConnections.set(pgConnectionId, pgConnection)
  console.log(`[PG-WS] Postgres client connected via WebSocket (${pgConnectionId}) -> browser (${connectionId})`)

  // Handle binary messages (Postgres protocol)
  ws.on('message', async (message) => {
    // Check if message is binary (Postgres wire protocol)
    if (Buffer.isBuffer(message) || message instanceof ArrayBuffer) {
      if (!pgConnection.socket) { // Changed connection to pgConnection
        // First binary message should be StartupMessage
        // We need to connect to the actual Postgres database now
        const success = await connectToPostgres(pgConnection, Buffer.from(message)) // Changed connection to pgConnection
        if (!success) {
          // Connection failed, close WebSocket
          ws.close(1011, 'Failed to connect to backend')
          return
        }
      } else {
        // Already connected, forward data to Postgres
        if (pgConnection.socket && !pgConnection.socket.destroyed) { // Changed connection to pgConnection
          try {
            pgConnection.socket.write(Buffer.from(message)) // Changed connection to pgConnection
          } catch (err) {
            console.error(`[Relay ${connectionId}] Error writing to TCP socket:`, err)
            ws.close(1011, 'TCP write error')
          }
        }
      }
      return
    }

    // Handle legacy JSON control messages
    try {
      const msg = JSON.parse(message)
      // ... existing legacy handling ...
      if (msg.type === 'agent_ready') {
        // Agent is ready
      }
    } catch (e) {
      // Ignore JSON parse errors for non-JSON messages
    }
  })

  ws.on('error', (err) => {
    console.error(`[PG-WS] WebSocket error (${pgConnectionId})`, err)
    cleanupFrontendConnection(pgConnectionId)
  })

  ws.on('close', () => {
    cleanupFrontendConnection(pgConnectionId)
    console.log(`[PG-WS] Postgres client disconnected (${pgConnectionId})`)
  })
})

httpServer.listen(RELAY_HTTP_PORT, () => {
  console.log(`HTTP bridge listening on http://localhost:${RELAY_HTTP_PORT}`)
  console.log(`POST SQL queries to http://localhost:${RELAY_HTTP_PORT}/{connectionId}/query`)
  console.log(`Get public key: http://localhost:${RELAY_HTTP_PORT}/{connectionId}/public-key`)
  console.log(`Browser agents connect via ws://localhost:${RELAY_HTTP_PORT}/agent`)
  console.log(`Postgres over WebSocket: ws://localhost:${RELAY_HTTP_PORT}/pg-ws/{connectionId}`)
})

/**
 * TCP server that emulates a bare-bones Postgres backend.
 */
const tcpServer = net.createServer((socket) => {
  const clientIP = getSocketIP(socket)

  // Rate limiting check
  const rateLimitCheck = checkRateLimit(clientIP)
  if (!rateLimitCheck.allowed) {
    console.warn(`[Security] ⚠️ Rejecting connection from ${clientIP}: ${rateLimitCheck.reason}`)
    socket.destroy()
    return
  }

  // Connection limit check
  const limitCheck = checkConnectionLimit(clientIP)
  if (!limitCheck.allowed) {
    console.warn(`[Security] ⚠️ Rejecting connection from ${clientIP}: ${limitCheck.reason}`)
    socket.destroy()
    return
  }

  const connectionId = randomUUID()
  const connection = {
    id: connectionId,
    socket,
    buffer: Buffer.alloc(0),
    started: false,
    user: 'postgres',
    database: 'local',
    processId: randomInt(1, 2 ** 30),
    secretKey: randomInt(1, 2 ** 30),
    closing: false,
    queue: [],
    status: 'I',
    browserWebSocket: null, // Will be set when we find the browser connection
    browserConnectionId: null, // Connection ID extracted from hostname or database name
    pendingMessages: [], // Buffer messages (like SSLRequest) before we have connection ID
    tlsUpgraded: false, // Track if socket has been upgraded to TLS
    hostname: null, // Hostname from SNI (for TLS connections)
    createdAt: Date.now(), // Track connection creation time for metrics
    bytesForwardedToBrowser: 0, // Track bytes forwarded to browser
    bytesForwardedToClient: 0, // Track bytes forwarded to client
    clientIP, // Track client IP for security
  }

  // Track IP connection
  trackIPConnection(clientIP, connectionId)

  // Set max connection duration timeout
  const maxDurationTimeout = setTimeout(() => {
    if (!connection.closing) {
      console.warn(`[Security] ⚠️ Closing connection ${connectionId} from ${clientIP} - exceeded max duration (${MAX_CONNECTION_DURATION_MS}ms)`)
      connection.closing = true
      sendErrorMessage(connection, 'FATAL: Connection exceeded maximum duration')
      setTimeout(() => {
        closeConnection(connection)
        cleanupFrontendConnection(connectionId)
      }, 1000)
    }
  }, MAX_CONNECTION_DURATION_MS)

  // Store timeout for cleanup
  connection.maxDurationTimeout = maxDurationTimeout

  console.log(`[TCP ${connectionId}] Client connected from ${clientIP}:${socket.remotePort}`)
  frontendConnections.set(connectionId, connection)

  // Disable Nagle's algorithm to ensure each message is sent immediately as a separate packet
  // This is critical for Postgres protocol where messages must be sent separately
  socket.setNoDelay(true)

  socket.on('data', (chunk) => handleFrontendData(connection, chunk))
  socket.on('error', (err) => {
    console.error(`Frontend error (${connectionId})`, err)
    cleanupFrontendConnection(connectionId)
  })
  socket.on('close', (hadError) => {
    console.log(`[TCP ${connectionId}] Client disconnected (hadError=${hadError})`)
    // If connection was closing due to ErrorResponse, log it
    const conn = frontendConnections.get(connectionId)
    if (conn && conn.closing) {
      console.log(`[TCP ${connectionId}] Client disconnected after error - this is expected (Wait for Client pattern)`)
    }

    // Clean up max duration timeout
    if (conn && conn.maxDurationTimeout) {
      clearTimeout(conn.maxDurationTimeout)
    }

    // Untrack IP connection
    if (conn && conn.clientIP) {
      untrackIPConnection(conn.clientIP, connectionId)
    }

    // Track connection duration and metrics in PostHog
    if (posthog && conn) {
      const connectionDuration = Date.now() - (conn.createdAt || Date.now())
      try {
        posthog.capture({
          distinctId: 'relay-server',
          event: 'relay_connection_closed',
          properties: {
            connection_id: connectionId,
            had_error: hadError,
            connection_duration_ms: connectionDuration,
            bytes_to_browser: conn.bytesForwardedToBrowser || 0,
            bytes_to_client: conn.bytesForwardedToClient || 0,
            uses_tls: conn.tlsUpgraded || false,
            client_ip: conn.clientIP || 'unknown',
          },
        })
      } catch (error) {
        console.warn(`[Relay] Failed to send PostHog event:`, error.message)
      }
    }

    cleanupFrontendConnection(connectionId)
  })
})

tcpServer.listen(RELAY_PG_PORT, '0.0.0.0', () => {
  console.log(`Postgres wire relay listening on tcp://0.0.0.0:${RELAY_PG_PORT}`)
  console.log(`Use postgres://postgres@host:${RELAY_PG_PORT}/connectionId`)
})

function handleFrontendData(connection, chunk) {
  // Don't process data if connection is closing (e.g., after an error)
  if (connection.closing) {
    console.log(`[Relay ${connection.id}] Ignoring data from TCP client (connection closing)`)
    return
  }

  // If we've already established forwarding to browser, just forward the data
  if (connection.browserWebSocket && connection.browserWebSocket.readyState === WebSocket.OPEN) {
    // Forward raw binary packet to browser WebSocket
    connection.browserWebSocket.send(chunk)
    return
  }

  // Otherwise, we need to extract connection ID from StartupMessage first
  connection.buffer = Buffer.concat([connection.buffer, chunk])

  // Check for SSLRequest before processing other messages
  // SSLRequest is 8 bytes: [Length (Int32)] [Code (Int32)] = [00 00 00 08] [04 d2 16 2f]
  if (connection.buffer.length >= 8 && !connection.tlsUpgraded) {
    const length = connection.buffer.readInt32BE(0)
    const code = connection.buffer.readInt32BE(4)

    if (length === 8 && code === 80877103) {
      // This is an SSLRequest
      console.log(`[Relay ${connection.id}] SSLRequest detected`)

      if (tlsOptions) {
        // Remove SSLRequest from buffer (we've consumed it)
        connection.buffer = connection.buffer.subarray(8)

        // Respond with 'S' (Yes, SSL supported)
        console.log(`[Relay ${connection.id}] Responding with 'S' (SSL supported)`)
        connection.socket.write(Buffer.from('S'))

        // Upgrade socket to TLS
        console.log(`[Relay ${connection.id}] Upgrading socket to TLS`)

        // Create default secure context
        const defaultSecureContext = tls.createSecureContext(tlsOptions)

        // SNI callback to capture hostname and create context-specific secure context
        const sniCallback = (servername, callback) => {
          console.log(`[Relay ${connection.id}] 🔍🔍🔍 SNI Callback invoked! servername: ${servername || 'null'}`)
          if (servername) {
            connection.hostname = servername

            // Extract connection ID from hostname if it matches SNI_HOSTNAME_PATTERN
            const hostnameMatch = servername.match(SNI_HOSTNAME_PATTERN)
            if (hostnameMatch) {
              const extractedConnectionId = hostnameMatch[1]
              connection.browserConnectionId = extractedConnectionId
              console.log(`[Relay ${connection.id}] ✅ Extracted connection ID from SNI: ${extractedConnectionId} (hostname: ${servername})`)
            } else {
              console.warn(`[Relay ${connection.id}] ⚠️ SNI hostname '${servername}' does not match pattern ${SNI_PATTERN_DESCRIPTION}`)
            }
          }

          // Use the same secure context for all hostnames (wildcard certificate)
          callback(null, defaultSecureContext)
        }

        // Create TLS socket with SNI callback
        const tlsSocket = new tls.TLSSocket(connection.socket, {
          isServer: true,
          secureContext: defaultSecureContext,
          SNICallback: sniCallback
        })

        // Also listen for 'secureConnect' event as backup to check servername
        tlsSocket.on('secureConnect', () => {
          // Double-check servername (should already be set by SNICallback, but verify)
          if (tlsSocket.servername && !connection.hostname) {
            console.log(`[Relay ${connection.id}] 🔍 SNI Hostname from socket property: ${tlsSocket.servername}`)
            connection.hostname = tlsSocket.servername

            // Extract connection ID if not already extracted
            if (!connection.browserConnectionId) {
              const hostnameMatch = tlsSocket.servername.match(SNI_HOSTNAME_PATTERN)
              if (hostnameMatch) {
                connection.browserConnectionId = hostnameMatch[1]
                console.log(`[Relay ${connection.id}] ✅ Extracted connection ID from SNI (backup method): ${connection.browserConnectionId}`)
              }
            }
          } else if (!tlsSocket.servername && !connection.hostname) {
            console.log(`[Relay ${connection.id}] ⚠️ TLS handshake completed but no SNI hostname received (servername is null, SNICallback was not invoked)`)
          }

          console.log(`[Relay ${connection.id}] ✅ TLS handshake completed. Hostname: ${connection.hostname || 'not set'}, Connection ID: ${connection.browserConnectionId || 'not set'}, Socket servername: ${tlsSocket.servername || 'null'}`)
        })

        // Replace the socket with TLS socket
        connection.socket = tlsSocket
        connection.tlsUpgraded = true

        // Re-attach event handlers to TLS socket
        tlsSocket.on('data', (chunk) => handleFrontendData(connection, chunk))
        tlsSocket.on('error', (err) => {
          console.error(`[Relay ${connection.id}] TLS socket error:`, err)
          cleanupFrontendConnection(connection.id)
        })
        tlsSocket.on('close', (hadError) => {
          console.log(`[Relay ${connection.id}] TLS connection closed (hadError=${hadError})`)
          // If connection was closing due to ErrorResponse, log it
          if (connection.closing) {
            console.log(`[Relay ${connection.id}] TLS client disconnected after error - this is expected (Wait for Client pattern)`)
          }
          cleanupFrontendConnection(connection.id)
        })

        // Disable Nagle's algorithm on TLS socket too
        tlsSocket.setNoDelay(true)

        console.log(`[Relay ${connection.id}] TLS handshake initiated, waiting for client to continue`)
        return // Wait for client to send StartupMessage over TLS
      } else {
        // SSL not available - respond with 'N' (No)
        console.log(`[Relay ${connection.id}] SSLRequest received but TLS not configured, responding with 'N'`)
        connection.buffer = connection.buffer.subarray(8) // Remove SSLRequest from buffer
        connection.socket.write(Buffer.from('N'))
        // Continue with plaintext connection
      }
    }
  }
  console.log(`[Relay ${connection.id}] Received ${chunk.length} bytes, buffer now ${connection.buffer.length} bytes`)

  while (connection.buffer.length > 0 && !connection.closing) {
    if (!connection.started) {
      if (connection.buffer.length < 4) {
        console.log(`[Relay ${connection.id}] Waiting for more data (have ${connection.buffer.length} bytes, need at least 4)`)
        return
      }
      const length = connection.buffer.readInt32BE(0)
      console.log(`[Relay ${connection.id}] Message length: ${length}, buffer: ${connection.buffer.length}`)
      // In Postgres protocol, length includes the 4-byte length field itself
      // So if length=91, the total message size is 91 bytes (not 91+4)
      if (connection.buffer.length < length) {
        console.log(`[Relay ${connection.id}] Waiting for complete message (have ${connection.buffer.length}, need ${length})`)
        return
      }
      const message = connection.buffer.subarray(0, length)
      connection.buffer = connection.buffer.subarray(length)
      console.log(`[Relay ${connection.id}] Processing message of ${message.length} bytes`)

      const result = processStartupMessage(connection, message)
      if (result === false) {
        // Connection should be closed
        return
      }

      // If we found browser connection, forward all pending messages and start forwarding mode
      if (connection.browserWebSocket && connection.browserWebSocket.readyState === WebSocket.OPEN) {
        // If TLS was upgraded, SSLRequest was already handled locally - don't forward it
        // Otherwise, forward SSLRequest first (if any), wait for 'N' response, then forward StartupMessage
        // This ensures the client receives 'N' before StartupMessage is processed
        if (connection.pendingMessages.length > 0 && !connection.tlsUpgraded) {
          // Forward SSLRequest to browser first (only if not using TLS)
          const sslRequest = connection.pendingMessages[0]
          console.log(`[Relay ${connection.id}] Forwarding SSLRequest (${sslRequest.length} bytes) to browser first`)
          connection.browserWebSocket.send(sslRequest)

          // Set up a one-time handler to forward the 'N' response
          const sslResponseHandler = (data) => {
            if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
              const buffer = Buffer.from(data)
              // Check if this is the SSLRequest response ('N' = 1 byte, or 'S' = 1 byte)
              if (buffer.length === 1) {
                console.log(`[Relay ${connection.id}] Received SSLRequest response: ${buffer[0] === 0x4E ? 'N' : buffer[0] === 0x53 ? 'S' : '?'} (${buffer[0].toString(16)})`)
                // Forward 'N' to TCP client immediately
                try {
                  connection.socket.write(buffer)
                  console.log(`[Relay ${connection.id}] Forwarded SSLRequest response to TCP client`)
                } catch (err) {
                  console.error(`[Relay] Error forwarding SSLRequest response (${connection.id}):`, err)
                }
                // Remove this handler - we only want to catch the first 1-byte response
                connection.browserWebSocket.removeListener('message', sslResponseHandler)

                // Now forward StartupMessage and any other pending messages
                console.log(`[Relay ${connection.id}] Forwarding StartupMessage (${message.length} bytes) to browser`)
                connection.browserWebSocket.send(message)

                // Forward any remaining pending messages (shouldn't be any, but be safe)
                for (let i = 1; i < connection.pendingMessages.length; i++) {
                  connection.browserWebSocket.send(connection.pendingMessages[i])
                }
                connection.pendingMessages = []

                // Forward any remaining buffered data
                if (connection.buffer.length > 0) {
                  connection.browserWebSocket.send(connection.buffer)
                  connection.buffer = Buffer.alloc(0)
                }
                connection.started = true
              }
            }
          }

          // Attach handler to catch SSLRequest response
          connection.browserWebSocket.once('message', sslResponseHandler)

          // Set timeout in case browser doesn't respond
          setTimeout(() => {
            connection.browserWebSocket.removeListener('message', sslResponseHandler)
            console.warn(`[Relay ${connection.id}] Timeout waiting for SSLRequest response, proceeding anyway`)
            // Forward StartupMessage anyway
            console.log(`[Relay ${connection.id}] Forwarding StartupMessage (${message.length} bytes) to browser`)
            connection.browserWebSocket.send(message)
            for (let i = 1; i < connection.pendingMessages.length; i++) {
              connection.browserWebSocket.send(connection.pendingMessages[i])
            }
            connection.pendingMessages = []
            if (connection.buffer.length > 0) {
              connection.browserWebSocket.send(connection.buffer)
              connection.buffer = Buffer.alloc(0)
            }
            connection.started = true
          }, 1000)
        } else {
          // No SSLRequest, just forward StartupMessage directly
          console.log(`[Relay ${connection.id}] Forwarding StartupMessage (${message.length} bytes) to browser`)
          connection.browserWebSocket.send(message)
          console.log(`[Relay ${connection.id}] StartupMessage forwarded successfully`)

          // Forward any remaining buffered data
          if (connection.buffer.length > 0) {
            connection.browserWebSocket.send(connection.buffer)
            connection.buffer = Buffer.alloc(0)
          }
          connection.started = true
        }
        return
      }

      // If result is true but no browser connection yet, continue buffering
      // (This shouldn't happen if processStartupMessage works correctly)
      continue
    }

    // This shouldn't happen if forwarding is set up correctly
    if (connection.buffer.length < 5) return
    const code = connection.buffer[0]
    const length = connection.buffer.readInt32BE(1)
    const totalLength = 1 + length
    if (connection.buffer.length < totalLength) return

    const body = connection.buffer.subarray(5, totalLength)
    connection.buffer = connection.buffer.subarray(totalLength)
    processFrontendMessage(connection, code, body)
  }
}

function processStartupMessage(connection, message) {
  // Don't process if connection is already closing (e.g., after an error)
  if (connection.closing) {
    console.log(`[Relay ${connection.id}] Skipping processStartupMessage (connection closing)`)
    return false
  }

  const protocol = message.readInt32BE(4)

  // Handle SSLRequest - this comes before StartupMessage, we need to buffer it
  if (protocol === 80877103) {
    // SSLRequest - buffer it, we'll forward it along with StartupMessage once we have connection ID
    connection.pendingMessages.push(message)
    console.log(`[Relay] SSLRequest buffered, waiting for StartupMessage (${connection.id})`)
    return true // Continue buffering, wait for StartupMessage
  }

  if (protocol === 80877102) {
    // CancelRequest - ignore gracefully
    closeConnection(connection)
    connection.closing = true
    return false
  }

  if (protocol !== 196608) {
    // Not a valid StartupMessage
    sendErrorMessage(connection, 'Only protocol version 3.0 is supported')
    closeConnection(connection)
    connection.closing = true
    return false
  }

  // This is a StartupMessage - extract connection ID using Hybrid Priority: SNI (Primary) > Database Name (Fallback)
  const paramsBuffer = message.subarray(8)
  const params = parseStartupParameters(paramsBuffer)
  connection.user = params.user ?? connection.user
  const requestedDatabase = params.database ?? connection.database ?? 'postgres'

  // Standardize database name to 'postgres' (default Postgres database)
  // The connection ID should come from SNI hostname (clean URL) or database name (legacy/plaintext)
  connection.database = requestedDatabase === 'postgres' || !requestedDatabase ? 'postgres' : requestedDatabase

  // Hybrid Priority Routing Logic
  let browserConnectionId = null
  let routingMethod = null

  // Priority 1: SNI Hostname (The "Clean URL" Path)
  // This is set during the TLS handshake in the secureConnect event
  if (connection.browserConnectionId) {
    browserConnectionId = connection.browserConnectionId
    routingMethod = 'SNI'
    console.log(`[Relay ${connection.id}] ✅ Routing via SNI: ${browserConnectionId} (hostname: ${connection.hostname})`)
  } else if (connection.hostname) {
    // Try to extract from hostname if it wasn't already extracted
    const hostnameMatch = connection.hostname.match(SNI_HOSTNAME_PATTERN)
    if (hostnameMatch) {
      browserConnectionId = hostnameMatch[1]
      routingMethod = 'SNI'
      connection.browserConnectionId = browserConnectionId
      console.log(`[Relay ${connection.id}] ✅ Routing via SNI (extracted from hostname): ${browserConnectionId}`)
    } else {
      console.warn(`[Relay ${connection.id}] ⚠️ SNI hostname '${connection.hostname}' does not match pattern ${SNI_PATTERN_DESCRIPTION}`)
    }
  }

  // Priority 2: Database Name (The "Legacy/Plaintext" Path)
  // Only check this if SNI was missing or invalid
  if (!browserConnectionId) {
    if (requestedDatabase === 'local') {
      browserConnectionId = null
    } else if (requestedDatabase.includes(':')) {
      // Colon format: dbname:connectionId
      const [db, connId] = requestedDatabase.split(':', 2)
      browserConnectionId = connId
      routingMethod = 'database (colon format)'
      console.log(`[Relay ${connection.id}] ✅ Routing via database name (colon format): ${browserConnectionId}`)
    } else if (requestedDatabase !== 'postgres' && requestedDatabase.match(/^[a-f0-9-]+$/i)) {
      // If database name looks like a UUID, use it as connection ID (backward compatibility)
      browserConnectionId = requestedDatabase
      routingMethod = 'database (UUID)'
      console.log(`[Relay ${connection.id}] ✅ Routing via database name (UUID): ${browserConnectionId}`)
    }
  }

  // Priority 3: Failure - No routing ID found
  if (!browserConnectionId) {
    // Double-check connection isn't closing (might have been set by ErrorResponse handler)
    if (connection.closing) {
      console.log(`[Relay ${connection.id}] Skipping routing error (connection already closing)`)
      return false
    }

    console.error(`[Relay ${connection.id}] ❌ Could not determine target database connection ID`)
    console.error(`[Relay ${connection.id}]   Hostname (SNI): ${connection.hostname || 'N/A'}`)
    console.error(`[Relay ${connection.id}]   Database: ${requestedDatabase}`)
    console.error(`[Relay ${connection.id}]   TLS Upgraded: ${connection.tlsUpgraded}`)

    // Defense in depth: If this is a plaintext connection with default dbname=postgres,
    // it's likely a retry from psql. Send a clearer error message.
    let errorMessage = 'FATAL: Routing ID not found.'
    let hint = ''

    if (!connection.tlsUpgraded && requestedDatabase === 'postgres') {
      // This is likely a plaintext retry from psql after SSL connection failed
      // Send a clearer error that explains SSL is required
      errorMessage = 'FATAL: SSL required for this connection.'
      hint = `HINT: This connection requires SSL/TLS. Use: psql "host=${PG_HOST_EXAMPLE} user=postgres dbname=CONNECTION_ID sslmode=require"`
    } else if (!connection.tlsUpgraded) {
      hint = `HINT: For plaintext connections, you must specify the connection ID as the database name. Use: psql "host=${PG_HOST_EXAMPLE} user=postgres dbname=CONNECTION_ID sslmode=disable"`
    } else if (!connection.hostname) {
      hint = `HINT: Postgres clients do not send SNI (Server Name Indication) during TLS handshake, so the hostname cannot be extracted. You must specify the connection ID as the database name. Use: psql "host=${PG_HOST_EXAMPLE} user=postgres dbname=CONNECTION_ID sslmode=require"`
    } else {
      hint = `HINT: Hostname does not match expected pattern ${SNI_PATTERN_DESCRIPTION}. Use: psql "host=${PG_HOST_EXAMPLE} user=postgres dbname=CONNECTION_ID"`
    }

    sendErrorMessage(connection, `${errorMessage}\n${hint}`)
    // Don't close immediately - let client disconnect (same pattern as ErrorResponse)
    connection.closing = true
    // Set safety timeout to force close if client hangs
    setTimeout(() => {
      if (!connection.socket.destroyed && connection.socket.writable) {
        console.log(`[Relay ${connection.id}] Client did not disconnect after routing error. Forcing close.`)
        closeConnection(connection)
      }
      cleanupFrontendConnection(connection.id)
    }, 5000)
    return false
  }

  console.log(`[Relay ${connection.id}] ✅ Routing to browser connection: ${browserConnectionId} (method: ${routingMethod})`)

  // Find the browser WebSocket connection
  const browserConnection = browserConnections.get(browserConnectionId)

  // Debug: Log all active browser connections
  console.log(`[Relay ${connection.id}] Active browser connections: ${browserConnections.size}`)
  if (browserConnections.size > 0) {
    const activeIds = Array.from(browserConnections.keys())
    console.log(`[Relay ${connection.id}] Active connection IDs: ${activeIds.join(', ')}`)
  }

  // Check if connection is closing before sending errors
  if (connection.closing) {
    console.log(`[Relay ${connection.id}] Skipping browser connection check (connection already closing)`)
    return false
  }

  if (!browserConnection) {
    console.error(`[Relay ${connection.id}] ❌ Browser connection not found in map for ID: ${browserConnectionId}`)
    console.error(`[Relay ${connection.id}] Available connection IDs: ${Array.from(browserConnections.keys()).join(', ') || 'none'}`)
    sendErrorMessage(connection, `Browser connection not found or disconnected. Connection ID: ${browserConnectionId}. Please ensure the browser tab is open and connected.`)
    closeConnection(connection)
    connection.closing = true
    return false
  }

  if (browserConnection.socket.readyState !== WebSocket.OPEN) {
    console.error(`[Relay ${connection.id}] ❌ Browser connection found but WebSocket not OPEN. State: ${browserConnection.socket.readyState}`)
    console.error(`[Relay ${connection.id}] WebSocket states: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED`)
    sendErrorMessage(connection, 'Browser connection found but WebSocket is not open. The browser tab may have disconnected.')
    closeConnection(connection)
    connection.closing = true
    return false
  }

  console.log(`[Relay ${connection.id}] ✅ Browser connection found and WebSocket is OPEN`)

  console.log(`[Relay ${connection.id}] Found browser WebSocket for ${browserConnectionId}, establishing forwarding`)

  // Store reference to browser WebSocket for forwarding
  connection.browserWebSocket = browserConnection.socket
  connection.browserConnectionId = browserConnectionId

  // Set up bidirectional forwarding
  // Forward WebSocket messages (from browser) back to TCP client
  const wsMessageHandler = (data) => {
    if (connection.closing || !connection.socket.writable) {
      console.log(`[Relay ${connection.id}] wsMessageHandler: skipping (closing=${connection.closing}, writable=${connection.socket.writable})`)
      return
    }

    // Only forward binary messages (Postgres protocol packets)
    if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
      const buffer = Buffer.from(data)

      // Check if this is an ErrorResponse (Type 'E', first byte is 0x45)
      // With "Fake Success" strategy, ErrorResponse comes AFTER handshake completion (AuthOk, ReadyForQuery)
      // This means libpq is already in CONNECTION_OK state, so it won't retry
      // We forward the error and WAIT for client to disconnect gracefully
      if (buffer.length > 0 && buffer[0] === 0x45) {
        console.log(`[Relay ${connection.id}] ErrorResponse detected from browser (after handshake), forwarding and waiting for client disconnect`)
        try {
          // Mark connection as closing to prevent any further message processing
          connection.closing = true

          // Write the FATAL error to the wire
          // DO NOT close the connection immediately - let psql process the error and close itself
          const writeSuccess = connection.socket.write(buffer, (err) => {
            if (err) {
              console.error(`[Relay] Error writing ErrorResponse (${connection.id}):`, err)
              cleanupFrontendConnection(connection.id)
              return
            }

            // Data has been flushed to the OS buffer
            // DO NOT CLOSE IMMEDIATELY - let psql receive the error, print it, and decide to close itself
            // Since psql initiates the close cleanly, it does not trigger the fallback retry logic
            console.log(`[Relay ${connection.id}] Sent FATAL error to client. Waiting for client disconnect...`)

            // Safety valve: Only force-close if client hangs for too long (5 seconds)
            // This prevents resource leaks if a misbehaving client doesn't disconnect
            setTimeout(() => {
              if (!connection.socket.destroyed && connection.socket.writable) {
                console.log(`[Relay ${connection.id}] Client did not disconnect after 5s. Forcing close.`)
                connection.socket.end()
                cleanupFrontendConnection(connection.id)
              } else {
                // Client already disconnected - clean up
                cleanupFrontendConnection(connection.id)
              }
            }, 5000) // 5 second safety timeout
          })

          // If write returned false, socket buffer is full - wait for drain
          if (!writeSuccess) {
            console.log(`[Relay ${connection.id}] Socket buffer full, waiting for drain`)
            connection.socket.once('drain', () => {
              console.log(`[Relay ${connection.id}] Socket drained. Sent FATAL error. Waiting for client disconnect...`)
              // Set safety timeout after drain as well
              setTimeout(() => {
                if (!connection.socket.destroyed && connection.socket.writable) {
                  console.log(`[Relay ${connection.id}] Client did not disconnect after 5s. Forcing close.`)
                  connection.socket.end()
                  cleanupFrontendConnection(connection.id)
                } else {
                  cleanupFrontendConnection(connection.id)
                }
              }, 5000)
            })
          }
        } catch (err) {
          console.error(`[Relay] Error forwarding ErrorResponse (${connection.id}):`, err)
          connection.closing = true
          cleanupFrontendConnection(connection.id)
        }
        return
      }

      // Log first few bytes for debugging (first 20 bytes should show message type and length)
      const preview = buffer.slice(0, Math.min(20, buffer.length)).toString('hex')
      console.log(`[Relay ${connection.id}] Forwarding ${buffer.length} bytes from browser to TCP client (first 20 bytes: ${preview})`)
      try {
        const flushed = connection.socket.write(buffer)
        console.log(`[Relay ${connection.id}] Successfully forwarded ${buffer.length} bytes to TCP (flushed=${flushed}, writable=${connection.socket.writable}, destroyed=${connection.socket.destroyed})`)

        // Track message forwarding in PostHog (sample every 10th message to avoid spam)
        if (posthog && connection.id && Math.random() < 0.1) {
          connection.bytesForwardedToClient = (connection.bytesForwardedToClient || 0) + buffer.length
          try {
            posthog.capture({
              distinctId: 'relay-server',
              event: 'relay_message_forwarded',
              properties: {
                connection_id: connection.id,
                direction: 'browser_to_client',
                message_size_bytes: buffer.length,
                socket_buffer_full: !flushed,
              },
            })
          } catch (error) {
            // Silently fail - don't spam logs
          }
        } else {
          connection.bytesForwardedToClient = (connection.bytesForwardedToClient || 0) + buffer.length
        }

        // If write returned false, the socket buffer is full, but we'll let Node.js handle backpressure
        // Wait for drain event if buffer is full
        if (!flushed) {
          console.log(`[Relay ${connection.id}] Socket buffer full, waiting for drain event`)
          connection.socket.once('drain', () => {
            console.log(`[Relay ${connection.id}] Socket drained, ready for more data`)
          })
        }
      } catch (err) {
        console.error(`[Relay] Error forwarding WebSocket to TCP (${connection.id}):`, err)

        // Track errors in PostHog
        if (posthog) {
          try {
            posthog.capture({
              distinctId: 'relay-server',
              event: 'relay_forward_error',
              properties: {
                connection_id: connection.id,
                direction: 'browser_to_client',
                error_message: err.message.substring(0, 200),
              },
            })
          } catch (error) {
            // Silently fail
          }
        }

        cleanupFrontendConnection(connection.id)
      }
    } else {
      console.log(`[Relay ${connection.id}] wsMessageHandler: received non-binary message, ignoring`)
    }
  }

  connection.browserWebSocket.on('message', wsMessageHandler)

  // Handle browser WebSocket close events
  connection.browserWebSocket.on('close', () => {
    console.log(`[Relay ${connection.id}] Browser WebSocket closed`)
    // If connection is not already closing (e.g., due to ErrorResponse), mark it as closing
    if (!connection.closing) {
      connection.closing = true
      // Don't send an error here - the browser may have closed after sending an ErrorResponse
      // Just clean up the connection
      cleanupFrontendConnection(connection.id)
    }
  })

  // Clean up handler when TCP connection closes
  connection.socket.on('close', () => {
    if (connection.browserWebSocket) {
      connection.browserWebSocket.removeListener('message', wsMessageHandler)
    }
  })

  console.log(`[Relay] Routing TCP connection (${connection.id}) to browser (${browserConnectionId})`)

  // Track connection establishment in PostHog
  if (posthog) {
    const connectionTime = Date.now() - (connection.createdAt || Date.now())
    try {
      posthog.capture({
        distinctId: 'relay-server',
        event: 'relay_connection_established',
        properties: {
          connection_id: connection.id,
          routing_method: routingMethod || 'unknown',
          uses_tls: connection.tlsUpgraded,
          connection_time_ms: connectionTime,
        },
      })
    } catch (error) {
      console.warn(`[Relay] Failed to send PostHog event:`, error.message)
    }
  }

  // Don't mark as started yet - we'll do that after forwarding the StartupMessage
  // Return true to indicate we found the browser connection
  return true
}

function processFrontendMessage(connection, code, body) {
  // This function should not be called if forwarding is set up correctly
  // But keep it as fallback for legacy code paths
  if (connection.browserWebSocket && connection.browserWebSocket.readyState === WebSocket.OPEN) {
    // Should have been forwarded in handleFrontendData
    console.warn(`[Relay] processFrontendMessage called but forwarding is active (${connection.id})`)
    return
  }

  // Legacy handling (should not be reached in new flow)
  switch (code) {
    case 0x51: {
      const sql = body.toString('utf8', 0, Math.max(0, body.length - 1))
      enqueueQuery(connection, sql)
      break
    }
    case 0x58: {
      closeConnection(connection)
      connection.closing = true
      break
    }
    default: {
      sendErrorMessage(
        connection,
        `Unsupported message type: ${String.fromCharCode(code)} (${code.toString(16)})`,
      )
      break
    }
  }
}

function enqueueQuery(connection, sql) {
  if (connection.status === 'B') {
    connection.queue.push(sql)
    return
  }
  executeQuery(connection, sql)
}

function executeQuery(connection, sql) {
  if (!sql.trim()) {
    sendCommandComplete(connection, 'EMPTY')
    sendReadyForQuery(connection, 'I')
    flushQueue(connection)
    return
  }

  // Extract connectionId from database name (format: "local:connectionId" or just connectionId)
  // For backward compatibility, if database is "local", we'll need connectionId from elsewhere
  // For now, we'll use a special format: database name can be the connectionId directly
  // Or we can store it in connection.browserConnectionId when the connection is established
  const browserConnectionId = connection.browserConnectionId

  if (!browserConnectionId) {
    sendErrorMessage(
      connection,
      'No browser connection ID specified. Use connection string format: postgres://postgres@host:port/connectionId',
    )
    sendReadyForQuery(connection, 'I')
    return
  }

  const browserConnection = browserConnections.get(browserConnectionId)
  if (!browserConnection || browserConnection.socket.readyState !== WebSocket.OPEN) {
    sendErrorMessage(connection, 'Browser connection not found or disconnected')
    sendReadyForQuery(connection, 'I')
    return
  }

  connection.status = 'B'
  dispatchToAgent(browserConnection, { type: 'execute', sql })
    .then((result) => {
      streamResultToFrontend(connection, result)
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : 'Query failed'
      sendErrorMessage(connection, message)
    })
    .finally(() => {
      connection.status = 'I'
      flushQueue(connection)
    })
}

function flushQueue(connection) {
  if (connection.status === 'B') return
  const nextSql = connection.queue.shift()
  if (nextSql) {
    executeQuery(connection, nextSql)
  }
}

function streamResultToFrontend(connection, result) {
  const fields = result?.fields ?? []
  if (fields.length > 0) {
    sendRowDescription(connection, fields)
  }

  const fieldNames = fields.map((field) => field.name)
  for (const row of result.rows ?? []) {
    const values = fieldNames.map((name) => stringifyValue(row?.[name]))
    sendDataRow(connection, values)
  }

  const commandTag = deriveCommandTag(result)
  sendCommandComplete(connection, commandTag)
  sendReadyForQuery(connection, 'I')
}

function deriveCommandTag(result) {
  const command = (result.command || 'SELECT').toUpperCase()
  const rowCount = result.rowCount ?? 0
  if (command === 'INSERT') {
    return `INSERT 0 ${rowCount}`
  }
  if (['SELECT', 'UPDATE', 'DELETE', 'MOVE', 'FETCH', 'COPY'].includes(command)) {
    return `${command} ${rowCount}`
  }
  return command
}

function cleanupFrontendConnection(connectionId) {
  const connection = frontendConnections.get(connectionId)
  if (!connection) return

  // Clean up max duration timeout
  if (connection.maxDurationTimeout) {
    clearTimeout(connection.maxDurationTimeout)
  }

  // Untrack IP connection
  if (connection.clientIP) {
    untrackIPConnection(connection.clientIP, connectionId)
  }

  connection.closing = true
  frontendConnections.delete(connectionId)
}

function parseStartupParameters(buffer) {
  const params = {}
  let offset = 0
  while (offset < buffer.length) {
    const keyEnd = buffer.indexOf(0, offset)
    if (keyEnd === -1 || keyEnd === offset) break
    const key = buffer.toString('utf8', offset, keyEnd)
    offset = keyEnd + 1
    const valueEnd = buffer.indexOf(0, offset)
    if (valueEnd === -1) break
    const value = buffer.toString('utf8', offset, valueEnd)
    params[key] = value
    offset = valueEnd + 1
  }
  return params
}

/**
 * Helper function to write data to either TCP socket or WebSocket
 */
function writeToConnection(connection, data) {
  if (connection.isWebSocket && connection.socket.readyState === WebSocket.OPEN) {
    // WebSocket connection
    connection.socket.send(data)
  } else if (!connection.isWebSocket) {
    // TCP connection
    connection.socket.write(data)
  } else {
    console.error('[PG-WS] Cannot write to closed WebSocket connection')
  }
}

/**
 * Helper function to close either TCP socket or WebSocket
 */
function closeConnection(connection) {
  if (connection.isWebSocket) {
    // WebSocket connection
    if (connection.socket.readyState === WebSocket.OPEN || connection.socket.readyState === WebSocket.CONNECTING) {
      connection.socket.close()
    }
  } else {
    // TCP connection - close the socket
    if (connection.socket && !connection.socket.destroyed) {
      connection.socket.destroy()
    }
  }
}

function sendAuthenticationOk(connection) {
  const buffer = Buffer.alloc(1 + 4 + 4)
  buffer[0] = 0x52
  buffer.writeInt32BE(8, 1)
  buffer.writeInt32BE(0, 5)
  writeToConnection(connection, buffer)
}

function sendParameterStatus(connection, name, value) {
  const nameBuffer = encodeCString(name)
  const valueBuffer = encodeCString(value)
  const payloadLength = nameBuffer.length + valueBuffer.length
  const buffer = Buffer.alloc(1 + 4 + payloadLength)
  buffer[0] = 0x53
  buffer.writeInt32BE(payloadLength + 4, 1)
  nameBuffer.copy(buffer, 5)
  valueBuffer.copy(buffer, 5 + nameBuffer.length)
  writeToConnection(connection, buffer)
}

function sendBackendKeyData(connection) {
  const buffer = Buffer.alloc(1 + 4 + 8)
  buffer[0] = 0x4b
  buffer.writeInt32BE(12, 1)
  buffer.writeInt32BE(connection.processId, 5)
  buffer.writeInt32BE(connection.secretKey, 9)
  writeToConnection(connection, buffer)
}

function sendReadyForQuery(connection, status) {
  const buffer = Buffer.alloc(1 + 4 + 1)
  buffer[0] = 0x5a
  buffer.writeInt32BE(5, 1)
  buffer.write(status, 5)
  writeToConnection(connection, buffer)
}

function sendRowDescription(connection, fields) {
  const fieldBuffers = fields.map((field) => {
    const nameBuffer = encodeCString(field.name ?? '')
    const buffer = Buffer.alloc(nameBuffer.length + 18)
    nameBuffer.copy(buffer, 0)
    let offset = nameBuffer.length
    buffer.writeUInt32BE(0, offset)
    offset += 4
    buffer.writeInt16BE(0, offset)
    offset += 2
    buffer.writeUInt32BE(field.dataTypeID ?? 25, offset)
    offset += 4
    buffer.writeInt16BE(-1, offset)
    offset += 2
    buffer.writeInt32BE(-1, offset)
    offset += 4
    buffer.writeInt16BE(0, offset)
    return buffer
  })

  const payloadLength = 2 + fieldBuffers.reduce((sum, buf) => sum + buf.length, 0)
  const buffer = Buffer.alloc(1 + 4 + payloadLength)
  buffer[0] = 0x54
  buffer.writeInt32BE(payloadLength + 4, 1)
  buffer.writeInt16BE(fields.length, 5)
  let offset = 7
  for (const fieldBuffer of fieldBuffers) {
    fieldBuffer.copy(buffer, offset)
    offset += fieldBuffer.length
  }
  writeToConnection(connection, buffer)
}

function sendDataRow(connection, values) {
  const valueBuffers = values.map((value) => {
    if (value === null || typeof value === 'undefined') return null
    return Buffer.from(String(value), 'utf8')
  })
  const payloadLength =
    2 + valueBuffers.reduce((sum, buf) => sum + 4 + (buf ? buf.length : 0), 0)
  const buffer = Buffer.alloc(1 + 4 + payloadLength)
  buffer[0] = 0x44
  buffer.writeInt32BE(payloadLength + 4, 1)
  buffer.writeInt16BE(valueBuffers.length, 5)
  let offset = 7
  for (const valueBuffer of valueBuffers) {
    if (!valueBuffer) {
      buffer.writeInt32BE(-1, offset)
      offset += 4
      continue
    }
    buffer.writeInt32BE(valueBuffer.length, offset)
    offset += 4
    valueBuffer.copy(buffer, offset)
    offset += valueBuffer.length
  }
  writeToConnection(connection, buffer)
}

function sendCommandComplete(connection, tag) {
  const tagBuffer = encodeCString(tag)
  const payloadLength = tagBuffer.length
  const buffer = Buffer.alloc(1 + 4 + payloadLength)
  buffer[0] = 0x43
  buffer.writeInt32BE(payloadLength + 4, 1)
  tagBuffer.copy(buffer, 5)
  writeToConnection(connection, buffer)
}

function sendErrorMessage(connection, message) {
  const fields = [
    ['S', 'ERROR'],
    ['V', 'ERROR'],
    ['C', 'XX000'],
    ['M', message],
  ]
  const fieldBuffers = fields.map(([code, value]) => {
    const valueBuffer = Buffer.from(value, 'utf8')
    const buffer = Buffer.alloc(1 + valueBuffer.length + 1)
    buffer.write(code, 0)
    valueBuffer.copy(buffer, 1)
    buffer[buffer.length - 1] = 0
    return buffer
  })

  const payloadLength = fieldBuffers.reduce((sum, buf) => sum + buf.length, 0) + 1
  const buffer = Buffer.alloc(1 + 4 + payloadLength)
  buffer[0] = 0x45
  buffer.writeInt32BE(payloadLength + 4, 1)
  let offset = 5
  for (const fieldBuffer of fieldBuffers) {
    fieldBuffer.copy(buffer, offset)
    offset += fieldBuffer.length
  }
  buffer[offset] = 0
  writeToConnection(connection, buffer)
  sendReadyForQuery(connection, 'E')
}

function encodeCString(value) {
  const utf8 = Buffer.from(value ?? '', 'utf8')
  const buffer = Buffer.alloc(utf8.length + 1)
  utf8.copy(buffer, 0)
  buffer[utf8.length] = 0
  return buffer
}

function stringifyValue(value) {
  if (value === null || typeof value === 'undefined') return null
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return value
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function applyCorsHeaders(req, res) {
  // Get allowed origins from environment or default to localhost for development
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'https://db4.lab4.app']

  const origin = req.headers.origin
  // Normalize origin (remove trailing slash, lowercase for comparison)
  const normalizedOrigin = origin ? origin.toLowerCase().replace(/\/$/, '') : null
  const normalizedAllowed = allowedOrigins.map(o => o.toLowerCase().replace(/\/$/, ''))
  const isAllowed = !origin || normalizedAllowed.includes(normalizedOrigin) || allowedOrigins.includes('*')

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || allowedOrigins[0] || '*')
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, sentry-trace, baggage')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  } else {
    // Log for debugging
    console.log('[CORS] Rejected origin:', origin, 'Allowed:', allowedOrigins)
  }
}


