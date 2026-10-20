import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { WebSocketServer } from 'ws'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { mkdirSync, existsSync, readFileSync } from 'fs'

// Polyfill CustomEvent for Node 18 environments (pkg/bundled)
if (typeof globalThis.CustomEvent === 'undefined') {
    class CustomEvent extends Event {
        constructor(message, data) {
            super(message, data)
            this.detail = data.detail
        }
    }
    globalThis.CustomEvent = CustomEvent
}

async function main() {
    const args = process.argv.slice(2)
    const pgPortIdx = args.indexOf('--pg-port')
    const httpPortIdx = args.indexOf('--http-port')
    const PG_PORT = pgPortIdx !== -1 ? parseInt(args[pgPortIdx + 1]) : 5432
    const HTTP_PORT = httpPortIdx !== -1 ? parseInt(args[httpPortIdx + 1]) : 8787

    console.log(`[Sidecar] Starting PGLite Sidecar...`)
    console.log(`[Sidecar] Ports -> PG: ${PG_PORT}, HTTP: ${HTTP_PORT}`)

    // Data Directory (Persistent)
    let dataDir
    if (process.platform === 'darwin') {
        dataDir = join(homedir(), 'Library', 'Application Support', 'com.db4app.desktop', 'db')
    } else if (process.platform === 'win32') {
        dataDir = join(homedir(), 'AppData', 'Local', 'db4app-desktop', 'db')
    } else {
        dataDir = join(homedir(), '.local', 'share', 'db4app-desktop', 'db')
    }

    try {
        mkdirSync(dataDir, { recursive: true })
        console.log(`[Sidecar] Data directory: ${dataDir}`)
    } catch (e) {
        console.error(`[Sidecar] Failed to create data dir: ${e.message}`)
        process.exit(1)
    }

    // Pre-load WASM and DATA assets manually to bypass resolution issues
    let wasmModule = undefined
    let fsBundle = undefined

    try {
        // Search paths for assets (relative to script or executable)
        const possiblePaths = [
            join(__dirname, 'pglite.wasm'), // Expected location (resources/)
            join(dirname(process.execPath), 'pglite.wasm'), // Next to binary
            join(process.cwd(), 'pglite.wasm') // CWD fallback
        ]

        for (const p of possiblePaths) {
            if (existsSync(p)) {
                console.log(`[Sidecar] Found WASM at: ${p}`)
                wasmModule = await WebAssembly.compile(readFileSync(p))

                // Look for data file next to it
                const dataPath = p.replace('.wasm', '.data')
                if (existsSync(dataPath)) {
                    console.log(`[Sidecar] Found DATA at: ${dataPath}`)
                    const buffer = readFileSync(dataPath)
                    fsBundle = new Blob([buffer])
                } else {
                    console.log(`[Sidecar] WARNING: pglite.data not found at ${dataPath}`)
                }
                break
            }
        }

        if (!wasmModule) {
            console.log(`[Sidecar] WASM file not found in standard locations. PGlite will attempt default resolution.`)
        }

    } catch (e) {
        console.log(`[Sidecar] Asset search failed: ${e.message}`)
    }

    try {
        const dbOptions = { dataDir }

        // Pass preloaded assets if available
        if (wasmModule) {
            dbOptions.wasmModule = wasmModule
        }
        if (fsBundle) {
            dbOptions.fsBundle = fsBundle
        }

        console.log(`[Sidecar] Initializing DB with options: keys=${Object.keys(dbOptions)}`)
        const db = new PGlite(dataDir, dbOptions)

        // Wait for it to be ready to catch init errors early
        await db.waitReady
        console.log(`[Sidecar] DB Ready`)

        // Start PGLite Server on internal port
        const INTERNAL_PORT = PG_PORT + 1
        const pgliteServer = new PGLiteSocketServer({ db, port: INTERNAL_PORT })

        // Port patch fix
        if (pgliteServer.port !== INTERNAL_PORT) {
            pgliteServer.port = INTERNAL_PORT
        }

        console.log(`[Sidecar] Starting Internal PGLite Server on port ${INTERNAL_PORT}...`)
        await pgliteServer.start()
        console.log(`[Sidecar] Internal Server ready`)

        // Start Public TCP Proxy (Handles SSL Negotiation)
        const { createServer, connect } = await import('net')

        const tcpProxy = createServer((clientSocket) => {
            let backendSocket = null
            let bufferedChunks = []
            let isHandshakeComplete = false

            // Handle client data
            clientSocket.on('data', (chunk) => {
                if (isHandshakeComplete) {
                    // Fast path: Just forward
                    if (backendSocket && !backendSocket.connecting) {
                        backendSocket.write(chunk)
                    } else {
                        bufferedChunks.push(chunk)
                    }
                    return
                }

                // Parse Packet Header
                // Postgres packets are at least 8 bytes (Len + Code)
                if (chunk.length < 8) {
                    // Partial packet? If so, we might need buffering. 
                    // For local `psql`, startup packets are usually whole.
                    // Optimistically assume it's part of negotiation if small.
                    console.log(`[Proxy Debug] Short packet: ${chunk.length} bytes`)
                }

                const packetLen = chunk.length >= 4 ? chunk.readUInt32BE(0) : 0
                const packetCode = chunk.length >= 8 ? chunk.readUInt32BE(4) : 0

                console.log(`[Proxy Debug] Packet: Len=${packetLen}, Code=${packetCode}, Hex=${chunk.toString('hex')}`)

                // 1. SSLRequest (80877103)
                if (packetLen === 8 && packetCode === 80877103) {
                    console.log('[Proxy Debug] SSLRequest -> Sending N')
                    clientSocket.write('N')
                    return
                }

                // 2. GSSENCRequest (80877104)
                if (packetLen === 8 && packetCode === 80877104) {
                    console.log('[Proxy Debug] GSSENCRequest -> Sending N')
                    clientSocket.write('N')
                    return
                }

                // 3. StartupMessage (Protocol 3.0 = 196608 / 0x00030000)
                // startup request code is usually the protocol version.
                // Or CancelRequest (80877102).

                // If it looks like a StartupMessage (Code is 196608) OR just regular data (unknown)
                // We assume negotiation is done.
                // Note: Protocol 3.0 is 0x00030000 = 196608

                console.log('[Proxy Debug] Handshake done or StartupMessage. Connecting backend.')
                isHandshakeComplete = true
                connectBackend(chunk)
            })

            function connectBackend(initialChunk = null) {
                if (backendSocket) return // Already connecting/connected

                backendSocket = connect(INTERNAL_PORT, '127.0.0.1', () => {
                    if (initialChunk) {
                        backendSocket.write(initialChunk)
                    }
                    for (const c of bufferedChunks) {
                        backendSocket.write(c)
                    }
                    bufferedChunks = []

                    clientSocket.pipe(backendSocket)
                    backendSocket.pipe(clientSocket)
                })

                backendSocket.on('error', (err) => {
                    console.error('[Sidecar] Backend socket error:', err.message)
                    clientSocket.end()
                })

                backendSocket.on('close', () => {
                    clientSocket.end()
                })
            }

            clientSocket.on('error', (err) => {
                // Ignore client disconnects
            })
        })

        tcpProxy.listen(PG_PORT, '127.0.0.1', () => {
            console.log(`[Sidecar] TCP Proxy listening on 127.0.0.1:${PG_PORT} (SSL Negotiation Enabled)`)
        })

        console.log(`[Sidecar] TCP Server listening on 127.0.0.1:${PG_PORT}`)

        // Unfortunately PGLiteSocketServer doesn't expose easy event hooks without subclassing
        // But we can infer activity if the process stays alive.

        // Start HTTP/WS Server (Mock Relay Protocol)
        const { createServer: createHttpServer } = await import('http')
        const httpServer = createHttpServer((req, res) => {
            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
                res.end(JSON.stringify({ status: 'ok', sentry: { status: 'ok' } }))
                return
            }
            res.writeHead(404)
            res.end()
        })

        // Create WebSocket Server without auto-monitoring
        const wss = new WebSocketServer({ noServer: true })

        wss.on('connection', (ws, req) => {
            const clientIp = req.socket.remoteAddress
            console.log(`[Sidecar] WS Connection accepted from ${clientIp} on ${req.url}`)

            const handshake = JSON.stringify({
                type: 'connection_established',
                connectionId: 'local-sidecar'
            })
            ws.send(handshake)

            ws.on('message', (data) => {
                try {
                    const msg = data.toString()
                    if (msg.includes('agent_ready')) {
                        console.log('[Sidecar] Frontend agent ready')
                    }
                } catch { }
            })

            ws.on('error', (err) => {
                console.error('[Sidecar] WS Client Error:', err)
            })

            ws.on('close', (code, reason) => {
                // Normal close
            })
        })

        // Manual Upgrade Handling for better debugging and path matching
        httpServer.on('upgrade', (request, socket, head) => {
            console.log(`[Sidecar] Upgrade request: ${request.url}`)

            const pathname = new URL(request.url, `http://${request.headers.host}`).pathname

            if (pathname === '/agent') {
                wss.handleUpgrade(request, socket, head, (ws) => {
                    wss.emit('connection', ws, request)
                })
            } else {
                console.log(`[Sidecar] Invalid upgrade path: ${pathname}`)
                socket.destroy()
            }
        })

        wss.on('error', (err) => {
            console.error('[Sidecar] WS Server Error:', err)
        })

        httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
            console.log(`[Sidecar] HTTP/WS Server listening on 0.0.0.0:${HTTP_PORT}`)
        })

        // Verify DB is actually alive
        setInterval(async () => {
            try {
                await db.query('SELECT 1')
            } catch (e) {
                console.error('[Sidecar] DB Heartbeat failed:', e.message)
            }
        }, 10000)

        process.on('SIGINT', async () => {
            console.log('[Sidecar] Shutting down...')
            await new Promise(resolve => httpServer.close(resolve))
            tcpProxy.close()
            await pgliteServer.stop()
            await db.close()
            process.exit(0)
        })

    } catch (error) {
        console.error('[Sidecar] Fatal Error:', error)
        process.exit(1)
    }
}

main().catch(console.error)
