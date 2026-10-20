#!/usr/bin/env node
/**
 * db4app-relay-local - Self-hosted relay server for db4app
 * 
 * This CLI allows you to host a Postgres relay on your own computer,
 * enabling connections from desktop applications (like DBeaver, pgAdmin)
 * to your browser-based db4app database.
 * 
 * Usage:
 *   npx db4app-relay-local
 *   npx db4app-relay-local --http-port 8787 --pg-port 5432
 * 
 * Then:
 *   1. Open db4app/database and select "Self-hosted" relay
 *   2. Connect your Postgres client to localhost:5432
 */

import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { parseArgs } from 'node:util'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Read version from package.json
const getVersion = () => {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))
    return pkg.version
  } catch {
    return 'unknown'
  }
}

// Parse CLI arguments
const { values: args } = parseArgs({
  options: {
    'http-port': { type: 'string', default: '8787' },
    'pg-port': { type: 'string', default: '5432' },
    'host': { type: 'string', default: '127.0.0.1' },
    'app-url': { type: 'string', default: process.env.DB4APP_URL || 'https://db4.lab4.app' },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
  },
  strict: false,
})

if (args.version) {
  console.log(`db4app-relay-local v${getVersion()}`)
  process.exit(0)
}

if (args.help) {
  console.log(`
db4app-relay-local - Self-hosted relay server for db4app

USAGE:
  npx db4app-relay-local [options]

OPTIONS:
  --http-port <port>   HTTP/WebSocket port (default: 8787)
  --pg-port <port>     Postgres TCP port (default: 5432)
  --host <host>        Host to bind to (default: 127.0.0.1)
  --app-url <url>      db4app web app URL used in links (default: https://db4.lab4.app,
                       or $DB4APP_URL). Use http://localhost:5173 for a local dev build.
  -h, --help           Show this help message
  -v, --version        Show version

EXAMPLES:
  npx db4app-relay-local
  npx db4app-relay-local --pg-port 5433
  npx db4app-relay-local --host 0.0.0.0

HOW TO USE:
  1. Run this relay on your machine
  2. Open <app-url>/database in your browser
  3. Select "Self-hosted" from the Relay server dropdown
  4. Connect your Postgres client (DBeaver, psql, etc.) to:
     postgres://postgres:YOUR_AUTH_TOKEN@localhost:5432

  The auth token is shown in the db4app UI after connecting.
`)
  process.exit(0)
}

const HTTP_PORT = parseInt(args['http-port'], 10)
const PG_PORT = parseInt(args['pg-port'], 10)
const HOST = args.host
const APP_URL = String(args['app-url']).replace(/\/+$/, '')

console.log(`
╔════════════════════════════════════════════════════════════════╗
║               db4app Self-Hosted Relay Server                  ║
╠════════════════════════════════════════════════════════════════╣
║  HTTP/WebSocket: http://${HOST}:${HTTP_PORT.toString().padEnd(27)}║
║  Postgres TCP:   postgres://postgres@${HOST}:${PG_PORT.toString().padEnd(14)}║
╚════════════════════════════════════════════════════════════════╝
`)

// Single browser connection tracking (self-hosted mode = one browser at a time)
let browserConnection = null // { socket: WebSocket, pending: Map, connectionId: string }

// TCP connections waiting to be routed
const pendingTcpConnections = new Map() // connectionId -> connection

// Active TCP connections
const activeTcpConnections = new Map() // connectionId -> connection

// ============================================================================
// HTTP Server
// ============================================================================

const httpServer = http.createServer(async (req, res) => {
  console.log(`[HTTP] ${req.method} ${req.url}`)
  
  // CORS headers for local development (include Sentry headers)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, sentry-trace, baggage')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      status: 'healthy',
      mode: 'self-hosted',
      timestamp: new Date().toISOString(),
      connections: {
        browser: browserConnection ? 1 : 0,
        tcp: activeTcpConnections.size,
      },
      // Include connection info for the app page
      connectionId: browserConnection?.connectionId || null,
      authToken: browserConnection?.authToken || null,
    }))
    return
  }

  // App endpoint - serves a setup page that links to the db4app web app with proper config
  // This is needed because an HTTPS-hosted web app can't connect to ws://localhost (mixed content)
  // So we serve this page over HTTP which CAN connect to ws://localhost
  const urlObj = new URL(req.url || '/', `http://${req.headers.host}`)
  if (req.method === 'GET' && urlObj.pathname === '/app') {
    const httpPort = urlObj.searchParams.get('httpPort') || HTTP_PORT
    const pgPort = urlObj.searchParams.get('pgPort') || PG_PORT
    
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>db4app - Self-Hosted Setup</title>
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: system-ui, -apple-system, sans-serif; 
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e2e8f0;
      min-height: 100vh;
      margin: 0;
      padding: 2rem;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .container { max-width: 600px; width: 100%; }
    h1 { 
      color: #F59E0B; 
      font-size: 1.75rem;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .subtitle { color: #94a3b8; margin-bottom: 2rem; }
    .card {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1rem;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
    }
    .status.connecting { background: rgba(234, 179, 8, 0.15); border: 1px solid rgba(234, 179, 8, 0.3); }
    .status.connected { background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.3); }
    .status.error { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    .connecting .status-dot { background: #EAB308; }
    .connected .status-dot { background: #22C55E; animation: none; }
    .error .status-dot { background: #EF4444; animation: none; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
      font-size: 1rem;
      width: 100%;
    }
    .btn-primary {
      background: #F59E0B;
      color: #1a1a2e;
    }
    .btn-primary:hover { background: #D97706; }
    .btn-primary:disabled { 
      background: #4b5563; 
      cursor: not-allowed;
      color: #9ca3af;
    }
    .btn-secondary {
      background: transparent;
      border: 1px solid #475569;
      color: #e2e8f0;
      margin-top: 0.75rem;
    }
    .btn-secondary:hover { background: rgba(71, 85, 105, 0.3); }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #94a3b8; }
    .info-value { 
      font-family: ui-monospace, monospace;
      color: #0ea5e9;
    }
    code {
      background: rgba(14, 165, 233, 0.1);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-family: ui-monospace, monospace;
      color: #0ea5e9;
      font-size: 0.875rem;
    }
    .connection-string {
      background: #0f172a;
      padding: 1rem;
      border-radius: 8px;
      font-family: ui-monospace, monospace;
      font-size: 0.8rem;
      word-break: break-all;
      color: #22d3ee;
      margin-top: 1rem;
    }
    .hidden { display: none; }
    .step-list { padding-left: 1.25rem; }
    .step-list li { margin-bottom: 0.75rem; color: #cbd5e1; }
    .note {
      background: rgba(234, 179, 8, 0.1);
      border-left: 3px solid #F59E0B;
      padding: 0.75rem 1rem;
      margin-top: 1rem;
      border-radius: 0 8px 8px 0;
      font-size: 0.875rem;
      color: #fcd34d;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔌 db4app Self-Hosted</h1>
    <p class="subtitle">Connect your database tools to a browser-based Postgres</p>
    
    <div class="card">
      <div id="status" class="status connecting">
        <div class="status-dot"></div>
        <span id="status-text">Connecting to relay...</span>
      </div>
      
      <div id="not-connected" class="hidden">
        <p style="margin-bottom: 1rem;">The relay is running but no browser database is connected yet.</p>
        <ol class="step-list">
          <li>Open <strong>db4app</strong> in your browser</li>
          <li>Go to the <strong>Database</strong> page</li>
          <li>Select <strong>"Self-hosted"</strong> from the Relay dropdown</li>
        </ol>
        <a href="${APP_URL}/database" target="_blank" class="btn btn-primary">
          Open db4app →
        </a>
        <div class="note">
          ⚠️ The browser will auto-configure to use your local relay.
        </div>
      </div>
      
      <div id="connected" class="hidden">
        <div class="info-row">
          <span class="info-label">Connection ID</span>
          <span class="info-value" id="connection-id">-</span>
        </div>
        <div class="info-row">
          <span class="info-label">Auth Token</span>
          <span class="info-value" id="auth-token">-</span>
        </div>
        <div class="info-row">
          <span class="info-label">Postgres Port</span>
          <span class="info-value">${pgPort}</span>
        </div>
        
        <p style="margin-top: 1rem; margin-bottom: 0.5rem; color: #94a3b8;">Connect with:</p>
        <div class="connection-string" id="conn-string">
          psql "postgres://postgres:TOKEN@localhost:${pgPort}"
        </div>
        
        <button class="btn btn-secondary" onclick="copyConnString()">
          📋 Copy Connection String
        </button>
      </div>
    </div>
    
    <div class="card" style="background: rgba(15, 23, 42, 0.5);">
      <div class="info-row">
        <span class="info-label">HTTP Port</span>
        <span class="info-value">${httpPort}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Postgres Port</span>
        <span class="info-value">${pgPort}</span>
      </div>
      <div class="info-row">
        <span class="info-label">WebSocket</span>
        <span class="info-value">ws://localhost:${httpPort}/agent</span>
      </div>
    </div>
  </div>

  <script>
    const WS_URL = 'ws://localhost:${httpPort}/agent';
    const PG_PORT = '${pgPort}';
    let ws = null;
    let connectionInfo = null;

    function updateStatus(state, message) {
      const statusEl = document.getElementById('status');
      const statusText = document.getElementById('status-text');
      statusEl.className = 'status ' + state;
      statusText.textContent = message;
    }

    function showConnected(info) {
      document.getElementById('not-connected').classList.add('hidden');
      document.getElementById('connected').classList.remove('hidden');
      document.getElementById('connection-id').textContent = info.connectionId.slice(0, 8) + '...';
      document.getElementById('auth-token').textContent = info.authToken ? info.authToken.slice(0, 8) + '...' : 'See db4app';
      
      const connStr = 'psql "postgres://postgres:' + (info.authToken || 'YOUR_TOKEN') + '@localhost:' + PG_PORT + '"';
      document.getElementById('conn-string').textContent = connStr;
      connectionInfo = { ...info, connStr };
    }

    function showNotConnected() {
      document.getElementById('connected').classList.add('hidden');
      document.getElementById('not-connected').classList.remove('hidden');
      connectionInfo = null;
    }

    function copyConnString() {
      if (connectionInfo && connectionInfo.connStr) {
        navigator.clipboard.writeText(connectionInfo.connStr);
        event.target.textContent = '✓ Copied!';
        setTimeout(() => { event.target.textContent = '📋 Copy Connection String'; }, 1500);
      }
    }

    function checkStatus() {
      fetch('/health')
        .then(r => r.json())
        .then(data => {
          if (data.connections && data.connections.browser > 0) {
            updateStatus('connected', 'Browser database connected');
            // Get more info if available
            if (data.connectionId) {
              showConnected({ connectionId: data.connectionId, authToken: data.authToken });
            } else {
              showConnected({ connectionId: 'Active', authToken: null });
            }
          } else {
            updateStatus('connecting', 'Waiting for browser connection...');
            showNotConnected();
          }
        })
        .catch(() => {
          updateStatus('error', 'Cannot reach relay server');
          showNotConnected();
        });
    }

    // Poll for status
    checkStatus();
    setInterval(checkStatus, 2000);
  </script>
</body>
</html>
    `)
    return
  }

  // Root endpoint with instructions
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>db4app Self-Hosted Relay</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 1rem; background: #1a1a2e; color: #eee; }
    h1 { color: #F59E0B; }
    code { background: #16213e; padding: 2px 8px; border-radius: 4px; color: #0ea5e9; }
    pre { background: #16213e; padding: 1rem; border-radius: 8px; overflow-x: auto; }
    .status { padding: 8px 16px; border-radius: 8px; margin: 1rem 0; }
    .status.connected { background: #065f46; }
    .status.waiting { background: #92400e; }
    a { color: #F59E0B; }
    .btn { display: inline-block; background: #F59E0B; color: #1a1a2e; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500; margin-top: 1rem; }
    .btn:hover { background: #D97706; }
  </style>
</head>
<body>
  <h1>🔌 db4app Self-Hosted Relay</h1>
  <div class="status ${browserConnection ? 'connected' : 'waiting'}">
    ${browserConnection 
      ? '✅ Browser connected (ID: ' + browserConnection.connectionId + ')' 
      : '⏳ Waiting for browser connection...'}
  </div>
  
  <a href="/app" class="btn">Open Setup Dashboard →</a>
  
  <h2>Quick Start</h2>
  <ol>
    <li>Open <a href="${APP_URL}/database" target="_blank">${APP_URL}/database</a> in your browser</li>
    <li>Select <strong>"Self-hosted"</strong> from the Relay server dropdown</li>
    <li>Connect your Postgres client to: <code>localhost:${PG_PORT}</code></li>
  </ol>
  
  <h2>Connection Info</h2>
  <ul>
    <li>HTTP: <code>http://localhost:${HTTP_PORT}</code></li>
    <li>WebSocket: <code>ws://localhost:${HTTP_PORT}/agent</code></li>
    <li>Postgres: <code>postgres://postgres:TOKEN@localhost:${PG_PORT}</code></li>
  </ul>
</body>
</html>
    `)
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

// WebSocket server for browser agent
const wss = new WebSocketServer({ noServer: true })

httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname

  if (pathname.startsWith('/agent')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  } else {
    socket.destroy()
  }
})

wss.on('connection', (ws, req) => {
  console.log('[WS] Browser agent connecting...')

  let connectionEstablished = false
  let connectionId = null

  ws.on('message', (data) => {
    // Convert to Buffer if needed
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
    
    // Check if this is a JSON message (starts with '{')
    // JSON messages are used for control (agent_ready, result, etc.)
    // Binary messages are Postgres wire protocol
    const isJsonMessage = buffer.length > 0 && buffer[0] === 0x7B // '{' character
    
    if (isJsonMessage) {
      // Handle JSON control messages
      try {
        const message = JSON.parse(buffer.toString('utf8'))
        console.log('[WS] Received JSON message:', message.type)

        if (message.type === 'agent_ready') {
          connectionId = message.connectionId || randomUUID()
          
          // Disconnect previous browser if any
          if (browserConnection && browserConnection.socket !== ws) {
            console.log('[WS] Disconnecting previous browser connection')
            browserConnection.socket.close()
          }

          browserConnection = {
            socket: ws,
            connectionId,
            pending: new Map(),
            activeTcpConnection: null,
          }
          connectionEstablished = true

          console.log(`[WS] ✅ Browser agent connected: ${connectionId}`)

          // Send confirmation
          ws.send(JSON.stringify({
            type: 'connection_established',
            connectionId,
          }))

          // Check if there's a pending TCP connection waiting
          for (const [tcpConnId, tcpConn] of pendingTcpConnections) {
            if (tcpConn.targetConnectionId === connectionId || !tcpConn.targetConnectionId) {
              console.log(`[TCP] Found pending connection, linking to browser`)
              linkTcpToBrowser(tcpConn, browserConnection)
              pendingTcpConnections.delete(tcpConnId)
              break
            }
          }
          return
        }

        // Handle responses from browser
        if (message.type === 'result' && message.requestId) {
          const pending = browserConnection?.pending.get(message.requestId)
          if (pending) {
            clearTimeout(pending.timeout)
            browserConnection.pending.delete(message.requestId)
            if (message.error) {
              pending.reject(new Error(message.error))
            } else {
              pending.resolve(message.result)
            }
          }
        }
      } catch (err) {
        console.error('[WS] Error parsing JSON message:', err.message)
      }
    } else {
      // Handle binary Postgres protocol messages - forward to TCP client
      if (browserConnection && browserConnection.activeTcpConnection) {
        const tcpConn = browserConnection.activeTcpConnection
        if (tcpConn.socket && !tcpConn.socket.destroyed) {
          tcpConn.socket.write(buffer)
        }
      }
    }
  })

  ws.on('close', () => {
    console.log(`[WS] Browser agent disconnected: ${connectionId || 'unknown'}`)
    if (browserConnection && browserConnection.socket === ws) {
      // Clean up pending requests
      browserConnection.pending.forEach(({ reject, timeout }) => {
        clearTimeout(timeout)
        reject(new Error('Browser disconnected'))
      })
      browserConnection = null
    }
  })

  ws.on('error', (err) => {
    console.error('[WS] WebSocket error:', err.message)
  })
})

// TCP server for Postgres wire protocol
const tcpServer = net.createServer((socket) => {
  const connectionId = randomUUID()
  const connection = {
    id: connectionId,
    socket,
    buffer: Buffer.alloc(0),
    started: false,
    targetConnectionId: null,
    user: null,
    database: null,
  }

  console.log(`[TCP] Client connected: ${connectionId}`)
  activeTcpConnections.set(connectionId, connection)
  socket.setNoDelay(true)

  socket.on('data', (chunk) => handleTcpData(connection, chunk))
  
  socket.on('error', (err) => {
    console.error(`[TCP] Error (${connectionId}):`, err.message)
    cleanupTcpConnection(connectionId)
  })

  socket.on('close', () => {
    console.log(`[TCP] Client disconnected: ${connectionId}`)
    cleanupTcpConnection(connectionId)
  })
})

function handleTcpData(connection, chunk) {
  // If already forwarding to browser, just forward
  if (connection.started && browserConnection?.socket?.readyState === WebSocket.OPEN) {
    browserConnection.socket.send(chunk)
    return
  }

  connection.buffer = Buffer.concat([connection.buffer, chunk])

  // Process messages from buffer
  while (connection.buffer.length >= 4) {
    const length = connection.buffer.readInt32BE(0)
    
    // Sanity check for message length
    if (length < 4 || length > 1024 * 1024) {
      console.error(`[TCP ${connection.id}] Invalid message length: ${length}`)
      connection.socket.end()
      return
    }
    
    if (connection.buffer.length < length) {
      return // Wait for more data
    }

    const message = connection.buffer.subarray(0, length)
    connection.buffer = connection.buffer.subarray(length)

    // Check for SSLRequest (8 bytes: length=8, code=80877103)
    if (length === 8 && message.length >= 8) {
      const code = message.readInt32BE(4)
      if (code === 80877103) {
        // SSLRequest - respond with 'N' (no SSL in self-hosted mode)
        console.log(`[TCP ${connection.id}] SSLRequest - responding 'N' (self-hosted mode)`)
        connection.socket.write(Buffer.from('N'))
        continue
      }
      if (code === 80877102) {
        // CancelRequest - ignore
        console.log(`[TCP ${connection.id}] CancelRequest - closing`)
        connection.socket.end()
        return
      }
    }

    // Process StartupMessage
    if (!connection.started) {
      if (message.length < 8) {
        console.error(`[TCP ${connection.id}] Message too short for StartupMessage: ${message.length}`)
        sendError(connection, 'Invalid StartupMessage')
        connection.socket.end()
        return
      }
      
      const protocol = message.readInt32BE(4)

      if (protocol !== 196608) {
        console.error(`[TCP ${connection.id}] Unsupported protocol version: ${protocol}`)
        sendError(connection, 'Only protocol version 3.0 is supported')
        connection.socket.end()
        return
      }

      // Parse startup parameters
      const paramsBuffer = message.subarray(8)
      const params = parseStartupParams(paramsBuffer)
      connection.user = params.user
      connection.database = params.database

      // In self-hosted mode, database name can optionally be the connection ID
      // But we typically just use whatever browser is connected
      if (params.database && params.database !== 'postgres') {
        connection.targetConnectionId = params.database
      }

      console.log(`[TCP ${connection.id}] StartupMessage: user=${params.user}, database=${params.database}`)

      // Link to browser connection
      if (browserConnection) {
        linkTcpToBrowser(connection, browserConnection)
        // Forward the startup message
        browserConnection.socket.send(message)
        connection.started = true
      } else {
        console.log(`[TCP ${connection.id}] No browser connected, waiting...`)
        pendingTcpConnections.set(connection.id, connection)
        // Set timeout
        setTimeout(() => {
          if (pendingTcpConnections.has(connection.id)) {
            console.log(`[TCP ${connection.id}] Timeout waiting for browser`)
            sendError(connection, 'Browser connection not available')
            connection.socket.end()
            pendingTcpConnections.delete(connection.id)
          }
        }, 30000)
      }
      return
    }
  }
}

function linkTcpToBrowser(tcpConn, browserConn) {
  console.log(`[Link] TCP ${tcpConn.id} <-> Browser ${browserConn.connectionId}`)
  browserConn.activeTcpConnection = tcpConn
  activeTcpConnections.set(tcpConn.id, tcpConn)
}

function cleanupTcpConnection(connectionId) {
  pendingTcpConnections.delete(connectionId)
  const conn = activeTcpConnections.get(connectionId)
  activeTcpConnections.delete(connectionId)
  
  if (browserConnection?.activeTcpConnection?.id === connectionId) {
    browserConnection.activeTcpConnection = null
  }
}

function parseStartupParams(buffer) {
  const params = {}
  let offset = 0
  
  while (offset < buffer.length) {
    const keyEnd = buffer.indexOf(0, offset)
    if (keyEnd === -1 || keyEnd === offset) break
    
    const key = buffer.subarray(offset, keyEnd).toString('utf8')
    offset = keyEnd + 1
    
    const valueEnd = buffer.indexOf(0, offset)
    if (valueEnd === -1) break
    
    const value = buffer.subarray(offset, valueEnd).toString('utf8')
    offset = valueEnd + 1
    
    params[key] = value
  }
  
  return params
}

function sendError(connection, message) {
  const msgBuffer = Buffer.from(message, 'utf8')
  const fields = [
    Buffer.from([0x53]), // Severity
    Buffer.from('FATAL\0'),
    Buffer.from([0x43]), // Code
    Buffer.from('08006\0'),
    Buffer.from([0x4D]), // Message
    msgBuffer,
    Buffer.from([0x00, 0x00]), // End of fields + terminator
  ]
  
  const payload = Buffer.concat(fields)
  const buffer = Buffer.alloc(1 + 4 + payload.length)
  buffer[0] = 0x45 // 'E' for ErrorResponse
  buffer.writeInt32BE(payload.length + 4, 1)
  payload.copy(buffer, 5)
  
  connection.socket.write(buffer)
}

// Start servers
httpServer.listen(HTTP_PORT, HOST, () => {
  console.log(`[HTTP] Listening on http://${HOST}:${HTTP_PORT}`)
  console.log(`[WS]   WebSocket at ws://${HOST}:${HTTP_PORT}/agent`)
})

tcpServer.listen(PG_PORT, HOST, () => {
  console.log(`[TCP]  Postgres on postgres://postgres@${HOST}:${PG_PORT}`)
  console.log('')
  console.log(`Ready! Open ${APP_URL}/database and select "Self-hosted" from the Relay server dropdown.`)
  console.log('See http://localhost:' + HTTP_PORT + ' for instructions.')
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Shutdown] Closing servers...')
  httpServer.close()
  tcpServer.close()
  if (browserConnection) {
    browserConnection.socket.close()
  }
  activeTcpConnections.forEach((conn) => {
    conn.socket.destroy()
  })
  process.exit(0)
})

process.on('SIGTERM', () => {
  process.emit('SIGINT')
})

