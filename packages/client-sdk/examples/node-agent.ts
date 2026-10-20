import { PGlite } from '@electric-sql/pglite'
import WebSocket from 'ws'
import { Db4AppAgent } from '@db4app/client-sdk'

// Configuration
// Point this at your self-hosted relay's agent endpoint (e.g. `npm run relay` in the db4app repo).
// There is no hosted relay.
const RELAY_URL = process.env.RELAY_URL || 'ws://localhost:8787/agent'
// Postgres host/port of the same relay (server/index.js defaults to port 6543)
const RELAY_PG_HOST = process.env.RELAY_PG_HOST || new URL(RELAY_URL).hostname
const RELAY_PG_PORT = process.env.RELAY_PG_PORT || '6543'
// Optional: Generate a token or let the agent generate one
const AUTH_TOKEN = process.env.AUTH_TOKEN

async function startAgent() {
    console.log('Starting PGlite Node.js Agent...')

    // 1. Initialize PGlite (fs persistence by default in Node)
    // Use a local directory for persistence
    const db = new PGlite('./pgdata')
    await db.waitReady
    console.log('PGlite ready.')

    // 2. Initialize Agent
    console.log(`Connecting to relay at ${RELAY_URL}...`)

    const agent = new Db4AppAgent({
        db,
        relayUrl: RELAY_URL,
        authToken: AUTH_TOKEN,
        // IMPORTANT: In Node.js, we must provide the WebSocket implementation
        createWebSocket: (url) => new WebSocket(url) as any,
        onStatusChange: (status) => {
            console.log(`[Agent Status]: ${status}`)
        },
        onError: (err) => {
            console.error('[Agent Error]:', err)
        }
    })

    // 3. Connect
    await agent.connect()

    const connectionId = agent.getConnectionId()
    const token = agent.getAuthToken()

    if (connectionId) {
        console.log(`\n✅ Agent Online!`)
        console.log(`Connect via Postgres URL:`)
        console.log(`psql "postgres://postgres:${token}@${RELAY_PG_HOST}:${RELAY_PG_PORT}/${connectionId}"`)
    }

    // Keep process alive
    // Setup shutdown handlers
    const cleanup = () => {
        console.log('\nShutting down...')
        agent.disconnect() // This will close the WebSocket
        db.close().then(() => { // Close PGlite
            process.exit(0)
        })
    }

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
}

startAgent().catch(console.error)
