import http from 'node:http';
import https from 'node:https';

const url = process.env.HEALTH_URL || 'http://localhost:8787/health';
const client = url.startsWith('https:') ? https : http;

console.log('Starting Health Monitor...');
console.log('Time,Status,Latency(ms)');

setInterval(() => {
    const start = Date.now();
    const req = client.get(url, (res) => {
        const duration = Date.now() - start;
        console.log(`${new Date().toISOString()},${res.statusCode},${duration}`);
        res.resume(); // Consume (discard) body
    });

    req.on('error', (e) => {
        const duration = Date.now() - start;
        console.log(`${new Date().toISOString()},ERROR_${e.code},${duration}`);
    });

    req.setTimeout(2000, () => {
        req.destroy();
        const duration = Date.now() - start;
        console.log(`${new Date().toISOString()},TIMEOUT,${duration}`);
    });

}, 500);
