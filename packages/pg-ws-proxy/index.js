#!/usr/bin/env node

/**
 * Postgres TCP-to-WebSocket Proxy
 * 
 * Bridges local TCP Postgres connections to a db4app relay over WebSocket
 * (useful when the relay is only reachable through an HTTP(S)-only proxy or tunnel).
 * 
 * Usage:
 *   db4app-pg-ws-proxy --connection-id YOUR_CONNECTION_ID [--local-port 5432] [--relay-url wss://relay.example.com]
 * 
 * Example:
 *   db4app-pg-ws-proxy --connection-id abc123 --local-port 5432
 */

import net from 'node:net'
import WebSocket from 'ws'

const args = process.argv.slice(2)
let connectionId = null
let localPort = 5432
let relayUrl = process.env.DB4APP_RELAY_URL || 'ws://localhost:8787'

// Parse command line arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--connection-id' && args[i + 1]) {
    connectionId = args[i + 1]
    i++
  } else if (args[i] === '--local-port' && args[i + 1]) {
    localPort = parseInt(args[i + 1], 10)
    i++
  } else if (args[i] === '--relay-url' && args[i + 1]) {
    relayUrl = args[i + 1]
    i++
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Postgres TCP-to-WebSocket Proxy for db4app

Usage:
  db4app-pg-ws-proxy --connection-id YOUR_CONNECTION_ID [options]

Options:
  --connection-id ID    Your db4app connection ID (required)
  --local-port PORT     Local TCP port to listen on (default: 5432)
  --relay-url URL       Relay WebSocket URL (default: $DB4APP_RELAY_URL or ws://localhost:8787)
  --help, -h            Show this help message

Example:
  db4app-pg-ws-proxy --connection-id abc123def456 --local-port 5432

Then connect with:
  psql postgres://postgres@localhost:5432/local
`)
    process.exit(0)
  }
}

if (!connectionId) {
  console.error('Error: --connection-id is required')
  console.error('Run with --help for usage information')
  process.exit(1)
}

// Construct WebSocket URL
const wsUrl = `${relayUrl.replace(/\/$/, '')}/pg-ws/${connectionId}`

console.log(`Starting Postgres TCP-to-WebSocket proxy...`)
console.log(`  Local TCP port: ${localPort}`)
console.log(`  Connection ID: ${connectionId}`)
console.log(`  Relay WebSocket: ${wsUrl}`)
console.log(`\nConnect with: postgres://postgres@localhost:${localPort}/local\n`)

// Create TCP server
const tcpServer = net.createServer((tcpSocket) => {
  const clientId = `${tcpSocket.remoteAddress}:${tcpSocket.remotePort}`
  console.log(`[${clientId}] TCP client connected`)
  
  // Create WebSocket connection to relay
  const ws = new WebSocket(wsUrl)
  
  let wsConnected = false
  let tcpClosed = false
  
  ws.on('open', () => {
    wsConnected = true
    console.log(`[${clientId}] WebSocket connected to relay`)
  })
  
  ws.on('error', (err) => {
    console.error(`[${clientId}] WebSocket error:`, err.message)
    if (!tcpClosed) {
      tcpSocket.destroy()
      tcpClosed = true
    }
  })
  
  ws.on('close', () => {
    console.log(`[${clientId}] WebSocket closed`)
    if (!tcpClosed) {
      tcpSocket.destroy()
      tcpClosed = true
    }
  })
  
  // Forward binary messages from WebSocket to TCP
  ws.on('message', (data) => {
    if (Buffer.isBuffer(data)) {
      if (!tcpClosed && tcpSocket.writable) {
        tcpSocket.write(data)
      }
    }
  })
  
  // Forward TCP data to WebSocket
  tcpSocket.on('data', (data) => {
    if (wsConnected && ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    } else {
      console.error(`[${clientId}] WebSocket not ready, dropping TCP data`)
      tcpSocket.destroy()
      tcpClosed = true
    }
  })
  
  tcpSocket.on('error', (err) => {
    console.error(`[${clientId}] TCP error:`, err.message)
    if (wsConnected && ws.readyState === WebSocket.OPEN) {
      ws.close()
    }
    tcpClosed = true
  })
  
  tcpSocket.on('close', () => {
    console.log(`[${clientId}] TCP client disconnected`)
    if (wsConnected && ws.readyState === WebSocket.OPEN) {
      ws.close()
    }
    tcpClosed = true
  })
})

tcpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Error: Port ${localPort} is already in use`)
    console.error(`Try a different port with --local-port`)
  } else {
    console.error('TCP server error:', err)
  }
  process.exit(1)
})

tcpServer.listen(localPort, () => {
  console.log(`✓ Proxy listening on tcp://localhost:${localPort}`)
  console.log(`✓ Ready to bridge Postgres connections to WebSocket\n`)
})

