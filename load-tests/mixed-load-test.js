import { WebSocket } from 'ws';
import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';

// Configuration
const RELAY_HOST = process.env.RELAY_HOST || 'localhost';
const WS_PORT = Number(process.env.RELAY_PORT || 8787);
const PG_PORT = Number(process.env.RELAY_PG_PORT || 6543);
const WS_URL = `ws://${RELAY_HOST}:${WS_PORT}/agent`;

const connectionId = uuidv4();
console.log(`Test Context:`);
console.log(`- Connection ID: ${connectionId}`);
console.log(`- Relay WebSocket: ${WS_URL}`);
console.log(`- Postgres TCP: postgres://${RELAY_HOST}:${PG_PORT}/${connectionId}`);

// 1. Start "Browser" Agent (WebSocket)
console.log('\n[Browser] Connecting to WebSocket...');
const ws = new WebSocket(WS_URL, {
    headers: { Origin: process.env.RELAY_ORIGIN || 'http://localhost:5173' }
});

ws.on('open', () => {
    console.log('[Browser] WebSocket connected');

    // Send agent_ready
    const readyMsg = {
        type: 'agent_ready',
        connectionId: connectionId
    };
    ws.send(JSON.stringify(readyMsg));
    console.log('[Browser] Sent agent_ready');
});

ws.on('message', (data) => {
    // Try to parse as JSON first (control messages)
    try {
        const msg = JSON.parse(data.toString());
        console.log(`[Browser] Received control message: ${msg.type}`);
        if (msg.type === 'connection_established') {
            console.log('[Browser] Connection established confirmed by Relay');
            startPostgresClient();
        }
        return;
    } catch (e) {
        // Not JSON, likely binary Postgres protocol
    }

    // Mock Database Logic
    // Helper to write Int32BE
    const p32 = (val) => {
        const b = Buffer.alloc(4);
        b.writeInt32BE(val);
        return b;
    };
    // Helper to write Int16BE
    const p16 = (val) => {
        const b = Buffer.alloc(2);
        b.writeInt16BE(val);
        return b;
    };

    // Handle Binary Postgres Messages
    if (Buffer.isBuffer(data)) {
        // This is raw Postgres wire protocol data forwarded by the relay
        // In a real app, PGlite would handle this. 
        // Here we need to mock a response to "SELECT 1"

        // Simplistic parser/mocker:
        // We expect a Simple Query ('Q') with "SELECT 1"
        // We will blindly respond with a valid RowDescription and DataRow for "1"

        const charCode = data[0];
        const msgType = String.fromCharCode(charCode);
        console.log(`[Browser] Received binary message: Type=${msgType}, Length=${data.length}`);

        if (msgType === 'Q') { // Query
            const query = data.toString('utf8', 5).trim(); // Skip type (1) + length (4)
            console.log(`[Browser] Query received: "${query}"`);

            if (query.includes('SELECT 1')) {
                console.log('[Browser] detected SELECT 1, sending mock response...');

                // Construct Postgres Wire Protocol Responses
                // 1. RowDescription (T) - 1 column "?column?" (int4)
                // 2. DataRow (D) - 1 column value "1"
                // 3. CommandComplete (C) - "SELECT 1"
                // 4. ReadyForQuery (Z)

                // 1. RowDescription
                // Type 'T', Length, FieldCount (1), Name (?column?), TableOID (0), ColAttr (0), TypeOID (23=int4), TypeLen (4), TypeMod (-1), Format (0=text)
                const rowDescHeader = Buffer.from('T');
                const colName = Buffer.from('?column?\0');
                const fieldCount = p16(1);
                const typeInfo = Buffer.concat([
                    p32(0), p16(0), p32(23), p16(4), p32(-1), p16(0)
                ]);
                const rowDescContent = Buffer.concat([fieldCount, colName, typeInfo]);
                const rowDescLen = p32(4 + rowDescContent.length);
                const rowDesc = Buffer.concat([rowDescHeader, rowDescLen, rowDescContent]);

                // 2. DataRow
                // Type 'D', Length, ColCount (1), ColLen (1), Data ("1")
                const dataRowHeader = Buffer.from('D');
                const colCount = p16(1);
                const colVal = Buffer.from('1');
                const colLen = p32(colVal.length);
                const dataRowContent = Buffer.concat([colCount, colLen, colVal]);
                const dataRowLen = p32(4 + dataRowContent.length);
                const dataRow = Buffer.concat([dataRowHeader, dataRowLen, dataRowContent]);

                // 3. CommandComplete
                // Type 'C', Length, Tag ("SELECT 1\0")
                const cmdCompHeader = Buffer.from('C');
                const tag = Buffer.from('SELECT 1\0');
                const cmdCompLen = p32(4 + tag.length);
                const cmdComp = Buffer.concat([cmdCompHeader, cmdCompLen, tag]);

                // 4. ReadyForQuery
                // Type 'Z', Length (5), Status ('I')
                const readyHeader = Buffer.from('Z');
                const readyLen = p32(5);
                const status = Buffer.from('I');
                const ready = Buffer.concat([readyHeader, readyLen, status]);

                // Send all
                ws.send(rowDesc);
                ws.send(dataRow);
                ws.send(cmdComp);
                ws.send(ready);
                console.log('[Browser] Mock response sent');
            }
        }
        // Handle StartupMessage (mock auth ok)
        // Actually the Relay handles startup message parsing to extract connection ID.
        // Assuming relay forwards startup to us? 
        // The server/index.js logic says it forwards StartupMessage. 
        // We should respond with AuthOK (R) and ReadyForQuery (Z) if we receive startup.
        else if (msgType === '\x00') {
            // Startup message type is usually embedded in protocol version, 
            // but node Buffer[0] might be part of length if interpreted as 32-bit length packet structure without type byte
            // However, relay forwards raw packet.
            // Startup message: [Length (4)] [Protocol (4)] [Params...]
            // It doesn't have a 1-byte type header.

            // If we receive data that parses as StartupMessage (protocol 196608)
            const len = data.readInt32BE(0);
            const protocol = data.readInt32BE(4);
            if (protocol === 196608) {
                console.log('[Browser] StartupMessage received. Sending AuthOK + ReadyForQuery...');

                // AuthenticationOk (R)
                // Type 'R', Length (8), AuthType (0)
                const authOk = Buffer.concat([
                    Buffer.from('R'), p32(8), p32(0)
                ]);

                // ReadyForQuery (Z)
                const ready = Buffer.concat([
                    Buffer.from('Z'), p32(5), Buffer.from('I')
                ]);

                ws.send(authOk);

                // Determine BackendKeyData (K) - optional but good practice
                // Type 'K', Length (12), PID (int32), Key (int32)
                const keyData = Buffer.concat([
                    Buffer.from('K'), p32(12), p32(1234), p32(5678)
                ]);
                ws.send(keyData);

                ws.send(ready);
                console.log('[Browser] Auth handshake mock complete');
            }
        }
    }
});

// 2. Start Postgres Client (TCP)
async function startPostgresClient() {
    console.log('\n[Client] Starting Postgres Client...');

    // We use database name as the connection ID for routing (since we bypass SNI)
    const client = new pg.Client({
        host: RELAY_HOST,
        port: PG_PORT,
        user: 'postgres',
        database: connectionId, // IMPORTANT: Routing ID
        ssl: { rejectUnauthorized: false } // Required if server promotes to TLS, or if we force it.
        // Our relay supports SSLRequest.
    });

    try {
        console.log('[Client] Connecting...');
        await client.connect();
        console.log('[Client] Connected!');

        console.log('[Client] Sending "SELECT 1"...');
        const start = Date.now();
        const res = await client.query('SELECT 1');
        const duration = Date.now() - start;

        console.log('[Client] Query returned:', res.rows);
        console.log(`[Client] Round-trip latency: ${duration}ms`);

        if (res.rows[0]['?column?'] === 1) {
            console.log('\n✅✅✅ TEST PASSED: Full end-to-end SQL query successful! ✅✅✅');
            process.exit(0);
        } else {
            console.error('\n❌ TEST FAILED: Unexpected result:', res.rows);
            process.exit(1);
        }

    } catch (err) {
        console.error('\n❌ Client Error:', err);
        process.exit(1);
    } finally {
        await client.end();
        ws.close();
    }
}

// Timeout
setTimeout(() => {
    console.error('\n❌ Timeout reached (30s)');
    process.exit(1);
}, 30000);
