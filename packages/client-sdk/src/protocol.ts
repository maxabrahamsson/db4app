/**
 * Postgres Wire Protocol Utilities
 * 
 * Implements a minimal Postgres server shim that handles:
 * - StartupMessage (handshake)
 * - Query messages (Type 'Q')
 * - Terminate messages (Type 'X')
 * 
 * Sends proper Postgres wire protocol responses compatible with v3.0
 */

/**
 * BufferReader - Reads Postgres wire protocol data from ArrayBuffer/Uint8Array
 */
export class BufferReader {
    private buffer: Uint8Array
    private offset: number

    constructor(buffer: ArrayBuffer | Uint8Array) {
        this.buffer = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
        this.offset = 0
    }

    readInt32(): number {
        const value = (this.buffer[this.offset] << 24) |
            (this.buffer[this.offset + 1] << 16) |
            (this.buffer[this.offset + 2] << 8) |
            this.buffer[this.offset + 3]
        this.offset += 4
        return value >>> 0 // Convert to unsigned
    }

    readInt16(): number {
        const value = (this.buffer[this.offset] << 8) | this.buffer[this.offset + 1]
        this.offset += 2
        return value & 0xFFFF // Convert to unsigned
    }

    readInt8(): number {
        return this.buffer[this.offset++]
    }

    readCString(): string {
        const start = this.offset
        while (this.offset < this.buffer.length && this.buffer[this.offset] !== 0) {
            this.offset++
        }
        const str = new TextDecoder('utf-8').decode(this.buffer.slice(start, this.offset))
        this.offset++ // Skip null terminator
        return str
    }

    readBytes(length: number): Uint8Array {
        const bytes = this.buffer.slice(this.offset, this.offset + length)
        this.offset += length
        return bytes
    }

    getRemaining(): number {
        return this.buffer.length - this.offset
    }

    skip(length: number): void {
        this.offset += length
    }
}

/**
 * BufferWriter - Writes Postgres wire protocol data
 */
export class BufferWriter {
    private chunks: Uint8Array[] = []
    private size: number = 0

    writeInt32(value: number): void {
        const buffer = new Uint8Array(4)
        buffer[0] = (value >>> 24) & 0xFF
        buffer[1] = (value >>> 16) & 0xFF
        buffer[2] = (value >>> 8) & 0xFF
        buffer[3] = value & 0xFF
        this.chunks.push(buffer)
        this.size += 4
    }

    writeInt16(value: number): void {
        const buffer = new Uint8Array(2)
        buffer[0] = (value >>> 8) & 0xFF
        buffer[1] = value & 0xFF
        this.chunks.push(buffer)
        this.size += 2
    }

    writeInt8(value: number): void {
        const buffer = new Uint8Array(1)
        buffer[0] = value & 0xFF
        this.chunks.push(buffer)
        this.size += 1
    }

    writeCString(str: string): void {
        const encoder = new TextEncoder()
        const bytes = encoder.encode(str)
        this.chunks.push(bytes)
        this.chunks.push(new Uint8Array([0])) // Null terminator
        this.size += bytes.length + 1
    }

    writeBytes(data: Uint8Array): void {
        this.chunks.push(data)
        this.size += data.length
    }

    /**
     * Builds the final buffer with message type and length prefix
     * Postgres message format: [type: char][length: int32][data...]
     * Length includes the 4-byte length field itself + payload, but NOT the type byte
     * 
     * NOTE: StartupMessage is the exception - it starts with length (no type byte)
     * All other server-to-client messages MUST start with type byte first!
     */
    buildMessage(type: string): ArrayBuffer {
        if (!type) {
            throw new Error('Type byte is required for server-to-client messages')
        }

        // Calculate length: 4 bytes (for the length integer itself) + payload size
        // The type byte is NOT included in the length
        const lengthVal = 4 + this.size

        // Total buffer: 1 byte (Type) + 4 bytes (Length) + payload size
        const totalSize = 1 + 4 + this.size
        const result = new Uint8Array(totalSize)
        let offset = 0

        // 1. Write Type Byte FIRST
        result[offset++] = type.charCodeAt(0)

        // 2. Write Length Int32 SECOND (Big Endian)
        result[offset++] = (lengthVal >>> 24) & 0xFF
        result[offset++] = (lengthVal >>> 16) & 0xFF
        result[offset++] = (lengthVal >>> 8) & 0xFF
        result[offset++] = lengthVal & 0xFF

        // 3. Write Payload (all chunks)
        for (const chunk of this.chunks) {
            result.set(chunk, offset)
            offset += chunk.length
        }

        return result.buffer
    }

    /**
     * Builds a message without length prefix (for StartupMessage)
     */
    buildStartupMessage(): ArrayBuffer {
        const result = new Uint8Array(4 + this.size) // 4 bytes for length + message
        let offset = 0

        // Write length (includes the length field itself)
        const totalSize = 4 + this.size
        result[offset++] = (totalSize >>> 24) & 0xFF
        result[offset++] = (totalSize >>> 16) & 0xFF
        result[offset++] = (totalSize >>> 8) & 0xFF
        result[offset++] = totalSize & 0xFF

        // Write all chunks
        for (const chunk of this.chunks) {
            result.set(chunk, offset)
            offset += chunk.length
        }

        return result.buffer
    }

    reset(): void {
        this.chunks = []
        this.size = 0
    }
}

/**
 * Postgres OID (Object Identifier) constants for common types
 */
export const PG_TYPES = {
    BOOL: 16,
    BYTEA: 17,
    CHAR: 18,
    INT8: 20,
    INT2: 21,
    INT4: 23,
    TEXT: 25,
    FLOAT4: 700,
    FLOAT8: 701,
    VARCHAR: 1043,
    DATE: 1082,
    TIME: 1083,
    TIMESTAMP: 1114,
    TIMESTAMPTZ: 1184,
    NUMERIC: 1700,
    JSON: 114,
    JSONB: 3802,
    UUID: 2950,
} as const

/**
 * Maps PGlite dataTypeID to Postgres OID
 * PGlite uses similar OIDs, but we map common ones
 */
export function getPostgresOID(dataTypeID: number): number {
    // PGlite already uses Postgres OIDs, so we can mostly pass them through
    // But we'll map some common ones to be safe
    const typeMap: Record<number, number> = {
        16: PG_TYPES.BOOL,
        17: PG_TYPES.BYTEA,
        18: PG_TYPES.CHAR,
        20: PG_TYPES.INT8,
        21: PG_TYPES.INT2,
        23: PG_TYPES.INT4,
        25: PG_TYPES.TEXT,
        700: PG_TYPES.FLOAT4,
        701: PG_TYPES.FLOAT8,
        1043: PG_TYPES.VARCHAR,
        1082: PG_TYPES.DATE,
        1083: PG_TYPES.TIME,
        1114: PG_TYPES.TIMESTAMP,
        1184: PG_TYPES.TIMESTAMPTZ,
        1700: PG_TYPES.NUMERIC,
        114: PG_TYPES.JSON,
        3802: PG_TYPES.JSONB,
        2950: PG_TYPES.UUID,
    }
    return typeMap[dataTypeID] || dataTypeID || PG_TYPES.TEXT
}

/**
 * Serializes a JavaScript value to Postgres wire format
 */
export function serializeValue(value: unknown, _oid: number): Uint8Array {
    if (value === null) {
        return new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]) // NULL indicator
    }

    let str: string
    if (typeof value === 'string') {
        str = value
    } else if (typeof value === 'number') {
        str = value.toString()
    } else if (typeof value === 'boolean') {
        str = value ? 't' : 'f'
    } else if (value instanceof Date) {
        str = value.toISOString()
    } else if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
        // For BYTEA
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
        // Postgres BYTEA format: \x followed by hex
        const hex = Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
        str = '\\x' + hex
    } else {
        // For JSON/JSONB and other complex types
        str = JSON.stringify(value)
    }

    const encoder = new TextEncoder()
    const bytes = encoder.encode(str)
    const result = new Uint8Array(4 + bytes.length)

    // Write length
    result[0] = (bytes.length >>> 24) & 0xFF
    result[1] = (bytes.length >>> 16) & 0xFF
    result[2] = (bytes.length >>> 8) & 0xFF
    result[3] = bytes.length & 0xFF

    // Write data
    result.set(bytes, 4)

    return result
}
