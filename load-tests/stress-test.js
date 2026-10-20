import { WebSocket } from 'ws';
import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';

// --- CONFIGURATION ---
// Parse CLI Args
const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, value] = arg.split('=');
    if (key.startsWith('--')) acc[key.replace('--', '')] = value;
    return acc;
}, {});

const CONFIG = {
    relayWsHost: args.host || 'localhost',
    relayPgHost: args.pghost || args.host || 'localhost',
    relayWsPort: parseInt(args.port) || 8787,
    relayPgPort: parseInt(args.pgport) || 6543,
    useWss: args.wss === 'true',
    concurrency: parseInt(args.concurrency) || 50,
    payloadSize: parseInt(args.payload) || 0, // 0 = Standard "SELECT 1"
    durationSeconds: parseInt(args.duration) || 30,
    queryIntervalMs: parseInt(args.interval) || 200,
    rampUpIntervalMs: parseInt(args.rampup) || 200,
};

// --- STATS ---
const stats = {
    started: 0,
    completed: 0,
    errors: 0,
    queriesSent: 0,
    queriesSuccess: 0,
    queriesFailed: 0,
    latencies: [],
    startTime: Date.now(),
    endTime: null,
    // Connection Stats
    connected: 0,
    maxConnected: 0,
    capacityRejections: 0,
    otherConnectionFailures: 0,
};

console.log('=== RELAY SERVER STRESS TEST ===');
console.log(JSON.stringify(CONFIG, null, 2));
console.log('================================\n');

// Mock Database Protocol Helpers (Global Scope)
const p32 = (val) => { const b = Buffer.alloc(4); b.writeInt32BE(val); return b; };
const p16 = (val) => { const b = Buffer.alloc(2); b.writeInt16BE(val); return b; };

// --- WORKER CLASS ---
class VirtualUser {
    constructor(id) {
        this.id = id;
        this.connectionId = uuidv4();
        this.ws = null;
        this.client = null;
        this.active = true;
        this.queryLoopTimeout = null;
        this.isConnected = false;
    }

    async start() {
        try {
            // 1. WebSocket Agent Connect
            await this.connectAgent();

            // 2. TCP Client Connect
            await this.connectClient();

            // 3. Start Query Loop
            this.runQueryLoop();
        } catch (err) {
            // this.log(`❌ Setup failed: ${err.message}`); // Reduce log spam
            if (!err.message.includes('4503')) {
                stats.otherConnectionFailures++;
            }
            stats.errors++;
            this.stop();
        }
    }

    log(msg) {
        // Only log errors or specific milestones to reduce noise at scale
        if (msg.includes('❌') || msg.includes('✅')) {
            console.log(`[VU ${this.id}] ${msg}`);
        }
    }

    async connectAgent() {
        return new Promise((resolve, reject) => {
            const protocol = CONFIG.useWss ? 'wss' : 'ws';
            const url = `${protocol}://${CONFIG.relayWsHost}:${CONFIG.relayWsPort}/agent`;
            this.ws = new WebSocket(url, {
                headers: {
                    Origin: args.origin || 'http://localhost:5173',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                rejectUnauthorized: false
            });

            this.ws.on('close', (code, reason) => {
                if (this.isConnected) {
                    this.isConnected = false;
                    stats.connected--;
                }

                if (code !== 1000 && !this.active) {
                    // Normal close at end of test
                    return;
                }

                // Track Capacity Rejections specifically
                if (code === 4503) {
                    stats.capacityRejections++;
                }

                const msg = `WS Closed: ${code} - ${reason}`;
                // If we haven't resolved start() yet, reject it
                reject(new Error(msg));

                // If test is running, log it
                if (this.active) {
                    if (code !== 4503 && code !== 1000) {
                        this.log(`❌ Connection closed unexpectedly: ${code} ${reason}`);
                        stats.errors++;
                    }
                }
            });

            this.ws.on('error', (err) => {
                const msg = err.message || 'Unknown Error';
                reject(new Error(`WS Error: ${msg}`));
            });

            this.ws.on('open', () => {
                this.isConnected = true;
                stats.connected++;
                if (stats.connected > stats.maxConnected) {
                    stats.maxConnected = stats.connected;
                }
                this.ws.send(JSON.stringify({ type: 'agent_ready', connectionId: this.connectionId }));
            });

            this.ws.on('message', (data) => {
                if (!this.active) return;

                // Mock DB Logic
                if (Buffer.isBuffer(data)) {
                    const msgType = String.fromCharCode(data[0]);
                    if (msgType === 'Q') {
                        this.sendMockResponse();
                    } else if (msgType === '\x00') {
                        this.sendAuthHandshake();
                    }
                }

                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'connection_established') {
                        resolve();
                    }
                } catch (e) { /* ignore */ }
            });
        });
    }

    sendAuthHandshake() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const authOk = Buffer.concat([Buffer.from('R'), p32(8), p32(0)]);
        const ready = Buffer.concat([Buffer.from('Z'), p32(5), Buffer.from('I')]);
        const keyData = Buffer.concat([Buffer.from('K'), p32(12), p32(1234), p32(5678)]);
        this.ws.send(Buffer.concat([authOk, keyData, ready]));
    }

    sendMockResponse() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const colName = Buffer.from('?column?\0');
        const rowDescContent = Buffer.concat([p16(1), colName, p32(0), p16(0), p32(23), p16(4), p32(-1), p16(0)]);
        const rowDesc = Buffer.concat([Buffer.from('T'), p32(4 + rowDescContent.length), rowDescContent]);

        let colVal = CONFIG.payloadSize > 0 ? Buffer.alloc(CONFIG.payloadSize, 'A') : Buffer.from('1');
        const dataRowContent = Buffer.concat([p16(1), p32(colVal.length), colVal]);
        const dataRow = Buffer.concat([Buffer.from('D'), p32(4 + dataRowContent.length), dataRowContent]);

        const tag = Buffer.from('SELECT 1\0');
        const cmdComp = Buffer.concat([Buffer.from('C'), p32(4 + tag.length), tag]);
        const ready = Buffer.concat([Buffer.from('Z'), p32(5), Buffer.from('I')]);

        this.ws.send(Buffer.concat([rowDesc, dataRow, cmdComp, ready]));
    }

    async connectClient() {
        this.client = new pg.Client({
            host: CONFIG.relayPgHost,
            port: CONFIG.relayPgPort,
            user: 'postgres',
            database: this.connectionId,
            ssl: args.pgssl === 'true' ? { rejectUnauthorized: false } : false,
            connectionTimeoutMillis: 10000,
        });
        await this.client.connect();
    }

    async runQueryLoop() {
        if (!this.active) return;

        try {
            const start = Date.now();
            stats.queriesSent++;

            let query = 'SELECT 1';
            if (CONFIG.payloadSize > 0) {
                query = `SELECT repeat('A', ${CONFIG.payloadSize})`;
            }

            const res = await this.client.query(query);

            const duration = Date.now() - start;
            stats.latencies.push(duration);
            stats.queriesSuccess++;
        } catch (err) {
            if (this.active) {
                stats.queriesFailed++;
            }
        }

        if (this.active) {
            this.queryLoopTimeout = setTimeout(() => this.runQueryLoop(), CONFIG.queryIntervalMs);
        }
    }

    stop() {
        this.active = false;
        if (this.isConnected) {
            this.isConnected = false;
            stats.connected--;
        }
        if (this.queryLoopTimeout) clearTimeout(this.queryLoopTimeout);
        if (this.client) this.client.end().catch(() => { });
        if (this.ws) this.ws.close();
    }
}

// --- MAIN ORCHESTRATOR ---

const users = [];

async function main() {
    console.log('Starting Test...');

    // Ramp Up
    for (let i = 0; i < CONFIG.concurrency; i++) {
        const user = new VirtualUser(i);
        users.push(user);
        const delay = i * CONFIG.rampUpIntervalMs;
        setTimeout(() => user.start(), delay);
    }

    const statusInterval = setInterval(() => {
        printStats();
    }, 2000);

    setTimeout(() => {
        console.log('\n🛑 Test Duration Reached. Stopping...');
        clearInterval(statusInterval);
        stats.endTime = Date.now();

        users.forEach(u => u.stop());

        setTimeout(() => {
            printFinalReport();
            process.exit(0);
        }, 2000);
    }, CONFIG.durationSeconds * 1000);
}

function printStats() {
    const tps = calculateTPS();
    const p95 = calculateP95();
    console.log(`[Running] Users: ${stats.connected}/${CONFIG.concurrency} | 4503 Rejections: ${stats.capacityRejections} | Sent: ${stats.queriesSent} | Success: ${stats.queriesSuccess} | P95: ${p95}ms`);
}

function printFinalReport() {
    console.log('\n=== FINAL REPORT ===');
    const durationMs = stats.endTime - stats.startTime;
    const tps = (stats.queriesSuccess / (durationMs / 1000));
    const avgLatency = stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length || 0;

    stats.latencies.sort((a, b) => a - b);
    const p50 = stats.latencies[Math.floor(stats.latencies.length * 0.50)] || 0;
    const p95 = stats.latencies[Math.floor(stats.latencies.length * 0.95)] || 0;
    const p99 = stats.latencies[Math.floor(stats.latencies.length * 0.99)] || 0;

    console.log(`Duration:       ${(durationMs / 1000).toFixed(2)}s`);
    console.log(`Target Users:   ${CONFIG.concurrency}`);
    console.log(`Peak Connected: ${stats.maxConnected}`);
    console.log(`Capacity Rejects:${stats.capacityRejections}`);
    console.log(`Other Failures: ${stats.otherConnectionFailures}`);
    console.log(`Total Queries:  ${stats.queriesSent}`);
    console.log(`Successful:     ${stats.queriesSuccess}`);
    console.log(`Failed:         ${stats.queriesFailed}`);
    console.log(`Throughput:     ${tps.toFixed(2)} TPS`);
    console.log(`Latency (Avg):  ${avgLatency.toFixed(2)}ms`);
    console.log(`Latency (P95):  ${p95}ms`);
    console.log(`Latency (P99):  ${p99}ms`);

    if (stats.queriesFailed > 0 || stats.otherConnectionFailures > 0) {
        console.log('⚠️  WARNING: Failures detected.');
    } else {
        console.log('✅  SUCCESS: No errors detected.');
    }
}

function calculateTPS() {
    // Rough instantaneous TPS not implemented in intermediate view, using avg in final
    // For live view, simpler to just show cumulative
    return 0; // Placeholder
}

function calculateP95() {
    if (stats.latencies.length === 0) return 0;
    // Just take last 100 samples for rough live stat
    const samples = stats.latencies.slice(-100).sort((a, b) => a - b);
    return samples[Math.floor(samples.length * 0.95)] || 0;
}

main().catch(err => console.error(err));
