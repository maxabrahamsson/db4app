/**
 * Postgres Server Shim
 * 
 * Implements a minimal Postgres server that handles wire protocol messages
 * and executes queries against a PGlite instance.
 */

import type { PGlite } from '@electric-sql/pglite'
import {
    BufferReader,
    BufferWriter,
    getPostgresOID,
    serializeValue,
} from './protocol'
import { logger as debugLog } from './logger'

export interface PostgresQueryResult {
    fields: Array<{ name: string; dataTypeID: number }>
    rows: Record<string, unknown>[]
    rowCount: number
    command: string
}

export type PostgresMessageHandler = (message: ArrayBuffer) => void

export class PostgresServerShim {
    private db: PGlite
    private sendMessage: PostgresMessageHandler
    private handshakeComplete: boolean = false
    private awaitingPassword: boolean = false
    private authToken: string
    private processId: number
    private secretKey: number
    private responseBuffer: Uint8Array[] = [] // Buffer for accumulating responses
    private pendingBuffer: Uint8Array | null = null // Buffer for incomplete messages across WebSocket frames

    constructor(db: PGlite, sendMessage: PostgresMessageHandler, authToken: string) {
        this.db = db
        this.sendMessage = sendMessage
        this.authToken = authToken
        // Generate random Process ID and Secret Key for BackendKeyData
        // These are used for CancelRequest (Ctrl+C) functionality
        this.processId = Math.floor(Math.random() * (2 ** 31 - 1))
        this.secretKey = Math.floor(Math.random() * (2 ** 31 - 1))
    }

    /**
     * Handles incoming binary messages from the WebSocket
     */
    async handleMessage(data: ArrayBuffer): Promise<void> {
        // Check if this is a StartupMessage (starts with length, no type byte)
        // StartupMessage format: [length: int32][protocol_version: int32][params...]
        // We need to detect StartupMessage even after handshake is complete,
        // because multiple TCP connections can share the same browser WebSocket

        // Check for SSLRequest or CancelRequest first (8-byte packets)
        if (data.byteLength === 8) {
            const reader = new BufferReader(data)
            const length = reader.readInt32()

            // SSLRequest code: 80877103
            // CancelRequest code: 80877102
            // Check if this is a special request packet
            if (length === 8) {
                const code = reader.readInt32()

                if (code === 80877103) {
                    // SSLRequest - reply with 'N' (No SSL, the reverse proxy handles it)
                    debugLog.log('[PostgresShim] SSLRequest received, replying with "N"')
                    this.sendSSLResponse('N')
                    return
                }

                if (code === 80877102) {
                    // CancelRequest - just ignore or close connection
                    debugLog.log('[PostgresShim] CancelRequest received, ignoring')
                    return
                }
            }
        }

        // ALWAYS check if this is a StartupMessage first, regardless of handshake state
        // This allows multiple TCP connections to share the same browser WebSocket
        // StartupMessage: [length: int32][protocol_version: int32][params...]
        //   - length INCLUDES the 4-byte length field itself
        //   - protocol_version is typically 196608 (0x00030000) for version 3.0
        // Regular message: [type: char][length: int32][data...]
        //   - length does NOT include the 4-byte length field, but includes the type byte

        if (data.byteLength >= 8) {
            const testReader = new BufferReader(data)
            const firstInt32 = testReader.readInt32()

            // For StartupMessage, the length field includes itself, so firstInt32 should equal data.byteLength
            // For regular messages, firstInt32 would be interpreted as a type byte (0x00-0xFF), which is < 256
            // So if firstInt32 equals the message size, it's definitely a StartupMessage
            if (firstInt32 === data.byteLength) {
                // This looks like a StartupMessage (length field matches message size)
                // Verify by checking the protocol version
                const protocolVersion = testReader.readInt32()
                // Protocol version 3.0 is 196608 (0x00030000)
                // Some clients might send 0 or other values, but 196608 is the standard
                if (protocolVersion === 196608 || protocolVersion === 0 || (protocolVersion > 0 && protocolVersion < 1000000)) {
                    // This is definitely a StartupMessage - reset handshake state for new connection
                    if (this.handshakeComplete) {
                        debugLog.log('[PostgresShim] New StartupMessage received after handshake, resetting state')
                        this.handshakeComplete = false
                    }
                    const startupReader = new BufferReader(data)
                    await this.handleStartupMessage(startupReader)
                    return
                }
            }
        }

        // If awaiting password, check if this is a PasswordMessage (Type 'p')
        if (this.awaitingPassword) {
            if (data.byteLength < 5) {
                debugLog.error('[PostgresShim] PasswordMessage too short')
                this.sendErrorResponse('Invalid password message', '28P01')
                return
            }
            const reader = new BufferReader(data)
            const messageType = String.fromCharCode(reader.readInt8())
            if (messageType === 'p') {
                await this.handlePasswordMessage(reader)
                return
            } else {
                debugLog.error('[PostgresShim] Expected PasswordMessage (Type p) but got:', messageType)
                this.sendErrorResponse('Password required', '28P01') // Invalid password
                return
            }
        }

        // If handshake not complete and we got here, something went wrong
        if (!this.handshakeComplete) {
            debugLog.error('[PostgresShim] Received message but handshake not complete and not a StartupMessage')
            this.sendErrorResponse('Handshake not complete')
            return
        }

        // After handshake, process messages
        // IMPORTANT: Clients may batch multiple messages (P, B, E, S) in a single WebSocket frame
        // We must parse the buffer and process each message individually
        if (data.byteLength === 0) {
            debugLog.warn('[PostgresShim] Received empty message')
            return
        }

        // Process all messages in the buffer sequentially
        await this.processMessageBuffer(data)
    }

    /**
     * Handles StartupMessage (handshake)
     * Format: [length: int32][protocol_version: int32][param_key\0param_value\0...][\0]
     */
    private async handleStartupMessage(reader: BufferReader): Promise<void> {
        const length = reader.readInt32()
        const protocolVersion = reader.readInt32()

        debugLog.log(`[PostgresShim] StartupMessage: protocol=${protocolVersion}, length=${length}`)

        // Read parameters (key-value pairs, null-terminated, ends with double null)
        const params: Record<string, string> = {}
        while (reader.getRemaining() > 0) {
            const key = reader.readCString()
            if (!key) break // Double null terminator
            const value = reader.readCString()
            params[key] = value
        }

        debugLog.log(`[PostgresShim] Connection parameters:`, params)

        // Request password authentication (CleartextPassword)
        // This will prompt the client to send a PasswordMessage (Type 'p')
        this.sendAuthenticationCleartextPassword()
        this.awaitingPassword = true
    }

    /**
     * Handles Query message (Type 'Q')
     * Format: [type: 'Q'][length: int32][sql_string: null-terminated]
     * Note: Type and length are already consumed by handleMessage
     */
    private async handleQuery(reader: BufferReader): Promise<void> {
        // Type and length already read in handleMessage, now read SQL string
        const sql = reader.readCString()

        debugLog.log(`[PostgresShim] Query received: ${sql.substring(0, 100)}...`)

        if (!sql.trim()) {
            this.sendCommandComplete('EMPTY')
            this.sendReadyForQuery('I')
            return
        }

        try {
            const result = await this.db.query(sql) as PostgresQueryResult

            // Determine command type from SQL
            const command = sql.trim().toUpperCase().split(/\s+/)[0]
            const isSelect = command === 'SELECT' || command === 'WITH'

            if (isSelect && result.rows && result.rows.length > 0) {
                // Send RowDescription
                this.sendRowDescription(result.fields || [])

                // Send DataRows
                for (const row of result.rows) {
                    this.sendDataRow(result.fields || [], row)
                }

                // Send CommandComplete
                this.sendCommandComplete(`SELECT ${result.rowCount || result.rows.length}`)
            } else if (isSelect) {
                // SELECT with no rows
                this.sendRowDescription(result.fields || [])
                this.sendCommandComplete('SELECT 0')
            } else {
                // INSERT, UPDATE, DELETE, etc.
                const tag = this.getCommandTag(command, result.rowCount || 0, result.command)
                this.sendCommandComplete(tag)
            }

            this.sendReadyForQuery('I')
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error'
            debugLog.error(`[PostgresShim] Query error:`, errorMessage)
            this.sendErrorResponse(errorMessage)
            this.sendReadyForQuery('I')
        }
    }

    /**
     * Processes a buffer that may contain multiple Postgres wire protocol messages
     * Extracts individual messages based on Length headers and processes them sequentially
     * Accumulates all responses and sends them as a single batched response
     * 
     * Handles message fragmentation across WebSocket frames by buffering incomplete messages
     */
    private async processMessageBuffer(data: ArrayBuffer): Promise<void> {
        // Combine with any pending buffer from previous frames
        let combinedBuffer: Uint8Array
        if (this.pendingBuffer) {
            const pendingLen = this.pendingBuffer.length
            combinedBuffer = new Uint8Array(pendingLen + data.byteLength)
            combinedBuffer.set(this.pendingBuffer, 0)
            combinedBuffer.set(new Uint8Array(data), pendingLen)
            debugLog.log(`[PostgresShim] Combined with pending buffer: ${pendingLen} + ${data.byteLength} = ${combinedBuffer.length} bytes`)
            this.pendingBuffer = null
        } else {
            combinedBuffer = new Uint8Array(data)
        }

        const view = new DataView(combinedBuffer.buffer)
        let offset = 0
        let messageCount = 0

        // Clear response buffer for this batch
        this.responseBuffer = []

        debugLog.log(`[PostgresShim] processMessageBuffer: buffer length=${combinedBuffer.length} bytes`)

        while (offset < combinedBuffer.length) {
            messageCount++

            // Check if we have enough bytes for at least a type byte and length
            if (offset + 5 > combinedBuffer.length) {
                // Not enough data for a complete message header - buffer it for next frame
                const remaining = combinedBuffer.slice(offset)
                this.pendingBuffer = remaining
                debugLog.log(`[PostgresShim] Incomplete message header at offset ${offset}, buffering ${remaining.length} bytes for next frame`)
                break
            }

            // 1. Read Type byte
            const messageTypeByte = view.getUint8(offset)
            const messageType = String.fromCharCode(messageTypeByte)

            // Validate message type is printable ASCII (should be a letter)
            if (messageTypeByte < 32 || messageTypeByte > 126) {
                debugLog.error(`[PostgresShim] Invalid message type byte at offset ${offset}: 0x${messageTypeByte.toString(16).padStart(2, '0')} (${messageTypeByte})`)
                debugLog.error(`[PostgresShim] Buffer hex dump: ${Array.from(combinedBuffer.slice(Math.max(0, offset - 10), Math.min(offset + 40, combinedBuffer.length))).map(b => b.toString(16).padStart(2, '0')).join(' ')}`)
                // If we have pending buffer, this might be text data from a fragmented Bind message
                // Buffer it and wait for more data
                if (offset === 0 && combinedBuffer.length > 0) {
                    this.pendingBuffer = combinedBuffer
                    debugLog.log(`[PostgresShim] Buffering ${combinedBuffer.length} bytes (might be text data from fragmented Bind message)`)
                    break
                }
                break
            }

            // 2. Read Length (Postgres uses Big Endian Int32)
            // Note: Length includes the 4 bytes of the length field itself, but NOT the Type byte
            const messageLength = view.getInt32(offset + 1, false) // false = big endian

            // Validate message length is reasonable
            if (messageLength < 4 || messageLength > 1000000) {
                // Check if we're reading from the middle of text-encoded array data
                // Text-encoded arrays from pg library can appear as JSON text in the buffer
                const textAtOffset = new TextDecoder('utf-8', { fatal: false }).decode(
                    combinedBuffer.slice(offset, Math.min(offset + 100, combinedBuffer.length))
                )

                // If this looks like JSON/text array data, we're in the middle of a Bind message's parameter
                // This happens when pg library sends large arrays as text and the message boundary is misaligned
                if (textAtOffset.match(/^[\d\s,"{}\[\].+-]+$/) && (textAtOffset.includes(',') || textAtOffset.includes('"'))) {
                    debugLog.error(`[PostgresShim] Detected text-encoded array data at offset ${offset} - message boundary misalignment!`)
                    debugLog.error(`[PostgresShim] This indicates a Bind message with large text-encoded array was not properly contained.`)
                    debugLog.error(`[PostgresShim] Text preview: ${textAtOffset.substring(0, 50)}...`)
                    debugLog.error(`[PostgresShim] This is a known issue with pg library encoding large arrays as text.`)
                    debugLog.error(`[PostgresShim] Attempting to find next valid message boundary...`)

                    // Try to find the next valid message boundary by looking for a valid message type byte
                    // Look for common Postgres message types: 'P' (Parse), 'B' (Bind), 'E' (Execute), 'S' (Sync), 'C' (Close), 'D' (Describe)
                    let foundBoundary = false
                    const validMessageTypes = [0x50, 0x42, 0x45, 0x53, 0x43, 0x44] // P, B, E, S, C, D

                    for (let searchOffset = offset + 1; searchOffset < Math.min(offset + 10000, combinedBuffer.length - 5); searchOffset++) {
                        const candidateType = view.getUint8(searchOffset)

                        // Check if this is a valid Postgres message type
                        if (validMessageTypes.includes(candidateType)) {
                            try {
                                const candidateLength = view.getInt32(searchOffset + 1, false)
                                if (candidateLength >= 4 && candidateLength < 1000000 && searchOffset + 1 + candidateLength <= combinedBuffer.length) {
                                    debugLog.log(`[PostgresShim] Found potential message boundary at offset ${searchOffset}, type: ${String.fromCharCode(candidateType)}, length: ${candidateLength}`)
                                    offset = searchOffset
                                    foundBoundary = true
                                    messageCount-- // Don't count this as a new message, we're recovering
                                    break
                                }
                            } catch (e) {
                                // Invalid length, continue searching
                                continue
                            }
                        }
                    }

                    if (!foundBoundary) {
                        // Couldn't find a valid boundary - this might be text data from a fragmented Bind message
                        // Buffer it and wait for the next frame which should contain the message header
                        this.pendingBuffer = combinedBuffer.slice(offset)
                        debugLog.log(`[PostgresShim] Could not find valid message boundary. Buffering ${this.pendingBuffer.length} bytes (likely text data from fragmented Bind message).`)
                        break
                    }

                    continue // Retry parsing from the new offset
                }

                debugLog.error(`[PostgresShim] Invalid message length at offset ${offset + 1}: ${messageLength} (should be >= 4 and < 1000000)`)
                debugLog.error(`[PostgresShim] Message type: '${messageType}' (0x${messageTypeByte.toString(16)})`)
                break
            }

            // 3. Calculate Total Message Size
            // Format: [Type: 1 byte] [Length: 4 bytes] [Payload: (length - 4) bytes]
            // Total = 1 (type) + length (which includes the 4-byte length field itself)
            const totalMessageSize = 1 + messageLength

            // Validate we have the complete message
            if (offset + totalMessageSize > combinedBuffer.length) {
                // Message is incomplete - buffer it for next frame
                const remaining = combinedBuffer.slice(offset)
                this.pendingBuffer = remaining
                debugLog.log(`[PostgresShim] Incomplete message: expected ${totalMessageSize} bytes, have ${combinedBuffer.length - offset} bytes. Buffering ${remaining.length} bytes for next frame.`)
                debugLog.log(`[PostgresShim] Message type: '${messageType}', length field: ${messageLength}`)
                break
            }

            // 4. Create a COPY of the message chunk (not just a view)
            // This ensures execProtocol gets a proper ArrayBuffer
            const messageChunk = combinedBuffer.slice(offset, offset + totalMessageSize)

            // 5. Log message info
            const preview = Array.from(messageChunk.slice(0, Math.min(20, messageChunk.length)))
                .map(b => b.toString(16).padStart(2, '0'))
                .join(' ')
            debugLog.log(`[PostgresShim] [${messageCount}] Processing message type: '${messageType}' (0x${messageTypeByte.toString(16).padStart(2, '0')}), length field: ${messageLength}, total size: ${totalMessageSize}, offset: ${offset}, hex: ${preview}${messageChunk.length > 20 ? '...' : ''}`)

            // 6. Process this single message (responses will be accumulated in responseBuffer)
            try {
                await this.processSingleMessage(messageType, messageChunk)
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error'
                const errorStack = err instanceof Error ? err.stack : undefined
                debugLog.error(`[PostgresShim] Error processing message type '${messageType}' (message ${messageCount}):`, errorMessage)
                if (errorStack) {
                    debugLog.error(`[PostgresShim] Stack trace:`, errorStack)
                }
                // Send error response immediately (don't batch errors)
                this.sendErrorResponse(`Error processing ${messageType}: ${errorMessage}`)
                this.sendReadyForQuery('I')
                // Clear response buffer and return on error
                this.responseBuffer = []
                return
            }

            // 7. Advance to next message
            offset += totalMessageSize
        }

        if (offset < combinedBuffer.length) {
            const remaining = combinedBuffer.length - offset
            // If we have remaining bytes and no pending buffer was set, it means we couldn't process them
            // This shouldn't happen if our buffering logic is correct, but log it for debugging
            if (!this.pendingBuffer && remaining > 0) {
                debugLog.warn(`[PostgresShim] Processed ${offset} bytes (${messageCount} messages), but buffer had ${combinedBuffer.length} bytes. ${remaining} bytes remaining (not buffered).`)
                if (remaining > 0 && remaining < 100) {
                    const remainingHex = Array.from(combinedBuffer.slice(offset, offset + remaining))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join(' ')
                    debugLog.warn(`[PostgresShim] Remaining bytes hex: ${remainingHex}`)
                }
            } else if (this.pendingBuffer) {
                debugLog.log(`[PostgresShim] Processed ${offset} bytes (${messageCount} messages), buffered ${this.pendingBuffer.length} bytes for next frame`)
            }
        } else {
            debugLog.log(`[PostgresShim] Successfully processed all ${messageCount} message(s) from buffer`)
        }

        // 8. Merge and send all accumulated responses as a single batched response
        debugLog.log(`[PostgresShim] Finished processing batch: ${this.responseBuffer.length} response(s) accumulated`)
        if (this.responseBuffer.length > 0) {
            this.sendBatchedResponses()
        } else {
            debugLog.warn(`[PostgresShim] No responses accumulated! This might cause a timeout.`)
            debugLog.warn(`[PostgresShim] Processed ${messageCount} message(s) but responseBuffer is empty.`)
        }
    }

    /**
     * Merges all accumulated responses and sends them as a single WebSocket frame
     * This mimics standard TCP behavior where responses are sent in a continuous stream
     */
    private sendBatchedResponses(): void {
        if (this.responseBuffer.length === 0) {
            debugLog.warn(`[PostgresShim] sendBatchedResponses() called but buffer is empty!`)
            return
        }

        // Calculate total length
        const totalLength = this.responseBuffer.reduce((acc, part) => acc + part.byteLength, 0)

        debugLog.log(`[PostgresShim] Merging ${this.responseBuffer.length} response part(s) into single frame (${totalLength} bytes total)`)

        // Merge all response buffers into a single Uint8Array
        const merged = new Uint8Array(totalLength)
        let writeOffset = 0

        for (let i = 0; i < this.responseBuffer.length; i++) {
            const part = this.responseBuffer[i]
            merged.set(part, writeOffset)
            debugLog.log(`[PostgresShim]   Part ${i + 1}: ${part.byteLength} bytes, offset: ${writeOffset}`)
            writeOffset += part.byteLength
        }

        // Log merged response preview with message type analysis
        const preview = Array.from(merged.slice(0, Math.min(50, merged.length)))
            .map(b => b.toString(16).padStart(2, '0'))
            .join(' ')

        // Analyze first few message types in merged response
        let offset = 0
        const messageTypes: string[] = []
        while (offset < merged.length && offset < 200 && messageTypes.length < 10) {
            if (offset + 5 > merged.length) break
            const msgTypeByte = merged[offset]
            const msgType = msgTypeByte >= 32 && msgTypeByte <= 126 ? String.fromCharCode(msgTypeByte) : `0x${msgTypeByte.toString(16)}`
            const msgLength = new DataView(merged.buffer, offset + 1, 4).getInt32(0, false)
            if (msgLength < 4 || msgLength > 1000000) break // Invalid length
            messageTypes.push(`${msgType}(${msgLength})`)
            offset += 1 + msgLength
            if (offset >= merged.length) break
        }

        debugLog.log(`[PostgresShim] ✅ Sending batched response: ${this.responseBuffer.length} part(s), total ${totalLength} bytes`)
        debugLog.log(`[PostgresShim]   Message sequence: ${messageTypes.join(' -> ')}`)
        debugLog.log(`[PostgresShim]   Hex preview: ${preview}${merged.length > 50 ? '...' : ''}`)

        // Also log what each part contains (first byte)
        for (let i = 0; i < this.responseBuffer.length; i++) {
            const part = this.responseBuffer[i]
            if (part.length > 0) {
                const firstByte = part[0]
                const firstByteChar = firstByte >= 32 && firstByte <= 126 ? String.fromCharCode(firstByte) : `0x${firstByte.toString(16)}`
                debugLog.log(`[PostgresShim]   Part ${i + 1} starts with: ${firstByteChar} (${part.byteLength} bytes)`)
            }
        }

        // Send as a single WebSocket frame
        this.sendMessage(merged.buffer)

        // Clear the buffer
        this.responseBuffer = []
        debugLog.log(`[PostgresShim] Response buffer cleared`)
    }

    /**
     * Processes a single Postgres wire protocol message
     * Accumulates responses in responseBuffer instead of sending immediately
     */
    private async processSingleMessage(messageType: string, messageChunk: Uint8Array): Promise<void> {
        // Validate message chunk is not empty
        if (messageChunk.length === 0) {
            debugLog.error(`[PostgresShim] Empty message chunk for type '${messageType}'`)
            // Send error immediately (don't batch errors)
            this.sendErrorResponse('Empty message received')
            this.sendReadyForQuery('I')
            return
        }

        // Validate first byte matches expected type
        const actualTypeByte = messageChunk[0]
        const expectedTypeByte = messageType.charCodeAt(0)
        if (actualTypeByte !== expectedTypeByte) {
            debugLog.error(`[PostgresShim] Message type mismatch: expected '${messageType}' (0x${expectedTypeByte.toString(16)}), got 0x${actualTypeByte.toString(16)}`)
            // Send error immediately (don't batch errors)
            this.sendErrorResponse(`Message type mismatch: expected ${messageType}`)
            this.sendReadyForQuery('I')
            return
        }

        // Handle Terminate message separately (not a query)
        if (messageType === 'X') {
            this.handleTerminate()
            return
        }

        // Handle Simple Query Protocol (Type 'Q') manually
        // Note: handleQuery() sends responses immediately, so we need to refactor it
        // For now, we'll keep Simple Query as-is (it works) and only batch Extended Query
        if (messageType === 'Q') {
            const reader = new BufferReader(messageChunk)
            // Skip type byte and length (already read in processMessageBuffer)
            reader.readInt8() // Skip type
            reader.readInt32() // Skip length
            await this.handleQuery(reader)
            // Simple Query responses are sent immediately (not batched)
            // This is fine since Simple Query is typically a single message
            return
        }

        // Validate Extended Query Protocol message types
        const validExtendedTypes = ['P', 'B', 'E', 'D', 'S', 'C']
        if (!validExtendedTypes.includes(messageType)) {
            debugLog.warn(`[PostgresShim] Unsupported message type: '${messageType}', sending error response`)
            // Send error immediately (don't batch errors)
            this.sendErrorResponse(`Unsupported message type: ${messageType}`)
            this.sendReadyForQuery('I')
            return
        }

        // For Bind messages, check if they contain text-encoded arrays that might cause issues
        if (messageType === 'B') {
            try {
                const bindReader = new BufferReader(messageChunk)
                bindReader.readInt8() // Skip type 'B'
                const declaredLength = bindReader.readInt32() // Read declared length
                bindReader.readCString() // portalName
                bindReader.readCString() // statementName
                const numParamFormatCodes = bindReader.readInt16()
                for (let i = 0; i < numParamFormatCodes; i++) {
                    bindReader.readInt16() // Skip format codes
                }
                const numParams = bindReader.readInt16()

                // Check parameters for text-encoded arrays
                let hasLargeTextArray = false
                for (let i = 0; i < numParams; i++) {
                    const paramLength = bindReader.readInt32()
                    if (paramLength > 0 && paramLength < 100000) { // Reasonable size
                        const paramData = bindReader.readBytes(paramLength)
                        const text = new TextDecoder('utf-8', { fatal: false }).decode(paramData)
                        // Check if this looks like a text-encoded array (starts with '{' and contains numbers)
                        if (text.startsWith('{') && text.length > 100 && (text.match(/\d+\.\d+/g) || text.match(/[+-]?\d+/g))) {
                            hasLargeTextArray = true
                            debugLog.log(`[PostgresShim] Bind message contains large text-encoded array (param ${i + 1}, length: ${paramLength}, text preview: ${text.substring(0, 50)}...)`)
                            break
                        }
                    } else if (paramLength !== -1) {
                        // Skip this parameter (NULL or invalid)
                        if (paramLength > 0) {
                            bindReader.readBytes(paramLength)
                        }
                    }
                }

                if (hasLargeTextArray) {
                    debugLog.log(`[PostgresShim] ⚠️ Bind message with text-encoded array detected. Message length: ${declaredLength}, actual chunk size: ${messageChunk.length}`)
                    // The message should still be valid for PGlite, but we log it for debugging
                }
            } catch (err) {
                debugLog.warn(`[PostgresShim] Could not parse Bind message for inspection:`, err)
            }
        }

        // For Parse messages, try to extract the SQL for logging
        if (messageType === 'P') {
            try {
                const parseReader = new BufferReader(messageChunk)
                parseReader.readInt8() // Skip type
                parseReader.readInt32() // Skip length
                const statementName = parseReader.readCString()
                const queryString = parseReader.readCString()
                const numParams = parseReader.readInt16()
                debugLog.log(`[PostgresShim] Parse message: statement='${statementName}', params=${numParams}, SQL='${queryString.substring(0, 100)}${queryString.length > 100 ? '...' : ''}'`)
            } catch (err) {
                debugLog.warn(`[PostgresShim] Could not parse Parse message for logging:`, err)
            }
        }

        // Pass Extended Query Protocol messages to PGlite's execProtocol
        // Pass STRICTLY one message at a time - PGlite maintains session state internally
        debugLog.log(`[PostgresShim] Calling execProtocol for '${messageType}' with ${messageChunk.length} bytes`)

        try {
            const result = await this.db.execProtocol(messageChunk, {
                syncToFs: false, // Don't sync to filesystem on every query for performance
                throwOnError: false, // Let PGlite handle errors and return them in the protocol response
                onNotice: (notice) => {
                    // Log notices but don't send them as separate messages
                    // They'll be included in the protocol response if needed
                    debugLog.log('[PostgresShim] Notice:', notice.message)
                }
            })

            // Log response preview with first byte (message type)
            const firstByte = result.data.length > 0 ? result.data[0] : 0
            const firstByteChar = firstByte >= 32 && firstByte <= 126 ? String.fromCharCode(firstByte) : `0x${firstByte.toString(16)}`
            const responsePreview = Array.from(result.data.slice(0, Math.min(20, result.data.length)))
                .map(b => b.toString(16).padStart(2, '0'))
                .join(' ')
            debugLog.log(`[PostgresShim] execProtocol response for '${messageType}': Type=${firstByteChar} (${firstByte}), ${responsePreview}${result.data.length > 20 ? '...' : ''} (${result.data.length} bytes)`)

            // Check if response contains an error (Type 'E')
            if (firstByte === 0x45) { // 'E' = ErrorResponse
                // Try to extract error message from the response
                try {
                    const errorReader = new BufferReader(new Uint8Array(result.data))
                    errorReader.readInt8() // Skip type
                    errorReader.readInt32() // Skip length
                    const errorFields: Record<string, string> = {}
                    while (errorReader.getRemaining() > 0) {
                        const fieldType = errorReader.readInt8()
                        if (fieldType === 0) break // Null terminator
                        const fieldValue = errorReader.readCString()
                        errorFields[String.fromCharCode(fieldType)] = fieldValue
                    }
                    debugLog.error(`[PostgresShim] execProtocol returned ERROR for '${messageType}':`, errorFields)
                    if (errorFields.M) {
                        debugLog.error(`[PostgresShim] Error message: ${errorFields.M}`)
                    }
                } catch (err) {
                    debugLog.error(`[PostgresShim] Could not parse error response:`, err)
                }
            }

            // ACCUMULATE response instead of sending immediately
            // This will be merged and sent as a single batched response after all messages are processed
            if (result.data.byteLength > 0) {
                debugLog.log(`[PostgresShim] Accumulating response for '${messageType}': ${result.data.byteLength} bytes, first byte=${firstByteChar} (buffer now has ${this.responseBuffer.length + 1} part(s))`)
                // Create a COPY of the response data to ensure it's not modified
                const responseCopy = new Uint8Array(result.data)
                this.responseBuffer.push(responseCopy)
            } else {
                debugLog.warn(`[PostgresShim] execProtocol returned empty response for '${messageType}'`)
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error'
            const errorStack = err instanceof Error ? err.stack : undefined
            debugLog.error(`[PostgresShim] execProtocol threw error for '${messageType}':`, errorMessage)
            if (errorStack) {
                debugLog.error(`[PostgresShim] Stack trace:`, errorStack)
            }
            // Re-throw to be caught by processMessageBuffer
            throw err
        }
    }

    /**
     * Handles Terminate message (Type 'X')
     */
    private handleTerminate(): void {
        debugLog.log('[PostgresShim] Terminate message received')
        // Client is disconnecting, we can clean up if needed
        // The WebSocket close handler will handle cleanup
    }

    /**
     * Sends SSLResponse - single byte 'N' (No SSL) or 'S' (SSL required)
     */
    private sendSSLResponse(response: 'N' | 'S'): void {
        const buffer = new Uint8Array(1)
        buffer[0] = response.charCodeAt(0)
        this.sendMessage(buffer.buffer)
    }

    /**
     * Handles PasswordMessage (Type 'p')
     * Format: [type: 'p'][length: int32][password: null-terminated string]
     */
    private async handlePasswordMessage(reader: BufferReader): Promise<void> {
        // Type byte already read, now read length
        const length = reader.readInt32()

        // Read password string (null-terminated)
        const providedPassword = reader.readCString()

        debugLog.log(`[PostgresShim] PasswordMessage received, length=${length}, password length=${providedPassword.length}`)

        // Verify password matches auth token
        if (providedPassword === this.authToken) {
            debugLog.log('[PostgresShim] Password authentication successful')
            this.awaitingPassword = false

            // Send AuthenticationOk
            this.sendAuthenticationOk()

            // Send BackendKeyData (Type 'K') - required for CancelRequest support
            // Format: 'K' + Int32(Length=12) + Int32(PID) + Int32(SecretKey)
            this.sendBackendKeyData()

            // Send parameter status messages
            this.sendParameterStatus('server_version', '15.0')
            this.sendParameterStatus('client_encoding', 'UTF8')
            this.sendParameterStatus('server_encoding', 'UTF8')
            this.sendParameterStatus('application_name', 'db4app')
            this.sendParameterStatus('DateStyle', 'ISO')

            // Send ready for query
            this.sendReadyForQuery('I')

            this.handshakeComplete = true
        } else {
            debugLog.error('[PostgresShim] Password authentication failed: password mismatch')
            this.awaitingPassword = false

            // "Fake Success" strategy: Complete handshake to move libpq to CONNECTION_OK state
            // This prevents psql from retrying in plaintext (libpq treats FATAL during auth as connection failure)
            // By completing the handshake first, we tell libpq "connection is established", disabling retry logic

            // 1. Lie: Tell client auth succeeded
            this.sendAuthenticationOk()

            // 2. Send BackendKeyData (required for handshake completion)
            this.sendBackendKeyData()

            // 3. Send parameter status messages (required for handshake completion)
            this.sendParameterStatus('server_version', '15.0')
            this.sendParameterStatus('client_encoding', 'UTF8')
            this.sendParameterStatus('server_encoding', 'UTF8')
            this.sendParameterStatus('application_name', 'db4app')
            this.sendParameterStatus('DateStyle', 'ISO')

            // 4. Establish: Tell client we are ready for queries
            // This moves libpq status to CONNECTION_OK and disables retry
            this.sendReadyForQuery('I')

            // 5. Kill: NOW send the actual fatal error
            // Since handshake is complete, libpq will treat this as a query error, not a connection failure
            this.sendErrorResponse('Password authentication failed', '28P01')

            // Mark handshake as complete so we don't process further messages
            this.handshakeComplete = true
            // Connection will be closed by the client after receiving the error
        }
    }

    /**
     * Sends AuthenticationCleartextPassword message (Type 'R', value 3)
     * This requests the client to send a password in cleartext
     */
    private sendAuthenticationCleartextPassword(): void {
        const writer = new BufferWriter()
        writer.writeInt32(3) // AuthenticationCleartextPassword
        const message = writer.buildMessage('R')
        debugLog.log('[PostgresShim] Sending AuthenticationCleartextPassword:', Array.from(new Uint8Array(message)).map(b => b.toString(16).padStart(2, '0')).join(''))
        this.sendMessage(message)
    }

    /**
     * Sends AuthenticationOk message (Type 'R', value 0)
     */
    private sendAuthenticationOk(): void {
        const writer = new BufferWriter()
        writer.writeInt32(0) // AuthenticationOk
        const message = writer.buildMessage('R')
        debugLog.log('[PostgresShim] Sending AuthenticationOk:', Array.from(new Uint8Array(message)).map(b => b.toString(16).padStart(2, '0')).join(''))
        this.sendMessage(message)
    }

    /**
     * Sends BackendKeyData message (Type 'K')
     * Contains Process ID and Secret Key for CancelRequest support
     */
    private sendBackendKeyData(): void {
        const writer = new BufferWriter()
        writer.writeInt32(this.processId)
        writer.writeInt32(this.secretKey)
        const message = writer.buildMessage('K')
        debugLog.log('[PostgresShim] Sending BackendKeyData:', Array.from(new Uint8Array(message)).map(b => b.toString(16).padStart(2, '0')).join(''))
        this.sendMessage(message)
    }

    /**
     * Sends ParameterStatus message (Type 'S')
     */
    private sendParameterStatus(name: string, value: string): void {
        const writer = new BufferWriter()
        writer.writeCString(name)
        writer.writeCString(value)
        const message = writer.buildMessage('S')
        debugLog.log(`[PostgresShim] Sending ParameterStatus: ${name}=${value}`)
        this.sendMessage(message)
    }

    /**
     * Sends ReadyForQuery message (Type 'Z')
     * Status: 'I' = idle, 'T' = in transaction, 'E' = failed transaction
     */
    private sendReadyForQuery(status: 'I' | 'T' | 'E' = 'I'): void {
        const writer = new BufferWriter()
        writer.writeInt8(status.charCodeAt(0))
        const message = writer.buildMessage('Z')
        debugLog.log('[PostgresShim] Sending ReadyForQuery:', Array.from(new Uint8Array(message)).map(b => b.toString(16).padStart(2, '0')).join(''))
        this.sendMessage(message)
    }

    /**
     * Sends RowDescription message (Type 'T')
     */
    private sendRowDescription(fields: Array<{ name: string; dataTypeID: number }>): void {
        const writer = new BufferWriter()
        writer.writeInt16(fields.length)

        for (const field of fields) {
            writer.writeCString(field.name)
            writer.writeInt32(0) // table OID (0 for simple queries)
            writer.writeInt16(0) // column number (0 for simple queries)
            writer.writeInt32(getPostgresOID(field.dataTypeID)) // data type OID
            writer.writeInt16(-1) // data type size (-1 for variable length)
            writer.writeInt32(-1) // type modifier (-1 for no modifier)
            writer.writeInt16(0) // format code (0 = text, 1 = binary, we use text)
        }

        const message = writer.buildMessage('T')
        this.sendMessage(message)
    }

    /**
     * Sends DataRow message (Type 'D')
     */
    private sendDataRow(fields: Array<{ name: string; dataTypeID: number }>, row: Record<string, unknown>): void {
        const writer = new BufferWriter()
        writer.writeInt16(fields.length)

        for (const field of fields) {
            const value = row[field.name]
            const oid = getPostgresOID(field.dataTypeID)
            const serialized = serializeValue(value, oid)
            writer.writeBytes(serialized)
        }

        const message = writer.buildMessage('D')
        this.sendMessage(message)
    }

    /**
     * Sends CommandComplete message (Type 'C')
     */
    private sendCommandComplete(tag: string): void {
        const writer = new BufferWriter()
        writer.writeCString(tag)
        const message = writer.buildMessage('C')
        this.sendMessage(message)
    }

    /**
     * Sends ErrorResponse message (Type 'E')
     */
    private sendErrorResponse(message: string, code?: string): void {
        const writer = new BufferWriter()
        writer.writeInt8('S'.charCodeAt(0)) // Severity field
        writer.writeCString('FATAL') // Use FATAL for authentication errors
        writer.writeInt8('C'.charCodeAt(0)) // SQLSTATE code field
        writer.writeCString(code || 'XX000') // Error code (28P01 = invalid password)
        writer.writeInt8('M'.charCodeAt(0)) // Message field
        writer.writeCString(message)
        writer.writeInt8(0) // Null terminator to end error response
        const msg = writer.buildMessage('E')
        this.sendMessage(msg)
    }

    /**
     * Gets the command tag for CommandComplete
     */
    private getCommandTag(command: string, rowCount: number, dbCommand?: string): string {
        if (dbCommand) {
            // Use the command from PGlite if available
            if (dbCommand === 'INSERT') {
                return `INSERT 0 ${rowCount}`
            } else if (dbCommand === 'UPDATE') {
                return `UPDATE ${rowCount}`
            } else if (dbCommand === 'DELETE') {
                return `DELETE ${rowCount}`
            } else if (dbCommand === 'SELECT') {
                return `SELECT ${rowCount}`
            }
        }

        // Fallback based on SQL command
        if (command === 'INSERT') {
            return `INSERT 0 ${rowCount}`
        } else if (command === 'UPDATE') {
            return `UPDATE ${rowCount}`
        } else if (command === 'DELETE') {
            return `DELETE ${rowCount}`
        } else if (command === 'CREATE' || command === 'DROP' || command === 'ALTER') {
            return command
        } else {
            return `${command} ${rowCount}`
        }
    }

    /**
     * Resets the shim state (for reconnection scenarios)
     */
    reset(): void {
        this.handshakeComplete = false
        this.awaitingPassword = false
    }
}
