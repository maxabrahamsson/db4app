import type { PGlite } from '@electric-sql/pglite'
import { PostgresServerShim } from './shim'
import { logger } from './logger'

export interface AgentOptions {
    db?: PGlite
    /**
     * WebSocket URL of a self-hosted relay's agent endpoint.
     * Defaults to a local relay: ws://localhost:8787/agent
     */
    relayUrl?: string
    authToken?: string
    /**
     * Custom WebSocket implementation (required for Node.js)
     */
    createWebSocket?: (url: string) => WebSocket
    onStatusChange?: (status: string) => void
    onError?: (error: Error) => void
}

/** Default relay agent endpoint: a self-hosted relay on this machine (there is no hosted relay). */
export const DEFAULT_RELAY_URL = 'ws://localhost:8787/agent'

export type AgentStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export class Db4AppAgent {
    private db?: PGlite
    private relayUrl: string
    private authToken: string
    private socket: WebSocket | null = null
    private shim: PostgresServerShim | null = null
    private connectionId: string | null = null
    private createWebSocket: ((url: string) => WebSocket) | null
    private onStatusChange?: (status: string) => void
    private onError?: (error: Error) => void

    constructor(options: AgentOptions) {
        this.db = options.db
        this.relayUrl = options.relayUrl || DEFAULT_RELAY_URL
        this.authToken = options.authToken || this.generateAuthToken()
        this.createWebSocket = options.createWebSocket || null
        this.onStatusChange = options.onStatusChange
        this.onError = options.onError
    }

    public async connect(): Promise<void> {
        this.updateStatus('Connecting to relay...')

        try {
            let SocketConstructor: typeof WebSocket

            if (this.createWebSocket) {
                // Use custom factory if provided
                this.socket = this.createWebSocket(this.relayUrl)
            } else if (typeof WebSocket !== 'undefined') {
                // Use native WebSocket in browser
                SocketConstructor = WebSocket
                this.socket = new SocketConstructor(this.relayUrl)
            } else {
                throw new Error('WebSocket is not defined. In Node.js, you must provide a createWebSocket option.')
            }

            const socket = this.socket!
            socket.binaryType = 'arraybuffer'

            socket.addEventListener('open', this.handleOpen)
            socket.addEventListener('close', this.handleClose)
            socket.addEventListener('error', this.handleError)
            socket.addEventListener('message', this.handleMessage)

        } catch (err) {
            this.handleError(err instanceof Event ? new Error('WebSocket connection failed') : err)
        }
    }

    public disconnect(): void {
        if (this.socket) {
            this.socket.close()
            this.socket = null
        }
        this.updateStatus('Disconnected')
    }

    public getConnectionId(): string | null {
        return this.connectionId
    }

    public getAuthToken(): string {
        return this.authToken
    }

    private updateStatus(status: string) {
        if (this.onStatusChange) {
            this.onStatusChange(status)
        }
    }

    private handleOpen = () => {
        logger.log('WebSocket connected')
        this.updateStatus('Connected, waiting for session...')

        // Initialize Postgres Shim (only if DB is present)
        if (this.db) {
            this.shim = new PostgresServerShim(
                this.db,
                (data) => {
                    if (this.socket && this.socket.readyState === this.socket.OPEN) {
                        this.socket.send(data)
                    }
                },
                this.authToken
            )
        }

        // Announce ready
        this.socket?.send(JSON.stringify({
            type: 'agent_ready',
            connectionId: this.connectionId || undefined
        }))
    }

    private handleClose = (event: CloseEvent) => {
        logger.log('WebSocket closed', event.code, event.reason)
        this.socket = null
        this.shim = null
        this.updateStatus(`Disconnected (Code: ${event.code})`)
    }

    private handleError = (event: Event | unknown) => {
        const err = event instanceof Error ? event : new Error(`Could not connect to relay at ${this.relayUrl}`)
        if (this.onError) {
            this.onError(err)
        } else {
            logger.error('WebSocket error', event)
        }
        this.updateStatus('Connection Error')
    }

    private handleMessage = async (event: MessageEvent) => {
        // Binary Message -> Postgres Protocol
        if (event.data instanceof ArrayBuffer) {
            if (this.shim) {
                try {
                    await this.shim.handleMessage(event.data)
                } catch (err) {
                    logger.error('Error handling Postgres message:', err)
                }
            }
            return
        }

        // Text Message -> Control channel
        if (typeof event.data === 'string') {
            try {
                const payload = JSON.parse(event.data)

                if (payload.type === 'connection_established' && payload.connectionId) {
                    this.connectionId = payload.connectionId
                    this.updateStatus(`Ready (ID: ${this.connectionId})`)
                    logger.log('Connection established with ID:', this.connectionId)
                }

            } catch (err) {
                logger.error('Failed to parse control message', err)
            }
        }
    }

    private generateAuthToken(): string {
        // Use crypto.randomUUID if available (Node and modern browsers)
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID()
        }
        return Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2)
    }
}

// Export Helper for generating tokens
export function generateAuthToken(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID()
    }
    return Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2)
}
