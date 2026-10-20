# Load Testing for the db4 Relay

Load testing scripts for the relay server. All defaults target a relay on `localhost` (`npm run relay`). Only run these against relays you operate.

## Prerequisites

### Install Artillery

```bash
npm install -g artillery
```

Or use npx (no installation needed):
```bash
npx artillery@latest
```

### Verify Installation

```bash
artillery --version
```

## Quick Start

### Test 1: Browser WebSocket Load Test

This test simulates multiple browser connections connecting to the relay via WebSocket.

**Run against a local relay (default):**
```bash
artillery run load-tests/browser-websocket-test.yml
```

**Run with custom target:**
```bash
artillery run load-tests/browser-websocket-test.yml --target wss://your-relay.example.com
```

### View Results

After the test completes, Artillery will display results in the terminal. To generate an HTML report:

```bash
artillery report artillery-report.json
```

This will create an HTML report you can open in your browser.

## Test Phases

The browser WebSocket test includes:

1. **Warm up** (60s): 10 connections/sec - Establish baseline
2. **Ramp up** (5min): 50 connections/sec - Gradual increase
3. **Sustained load** (10min): 100 connections/sec - Steady state
4. **Peak load** (5min): 200 connections/sec - Push to limits
5. **Cool down** (2min): 50 connections/sec - Gradual decrease

## Monitoring During Tests

### Monitor Relay Health

In another terminal, monitor the relay health endpoint:

```bash
# Continuous monitoring
watch -n 1 'curl -s http://localhost:8787/health | jq'

# Or the bundled monitor (HEALTH_URL overrides the target)
node load-tests/monitor.js
```

### Key Metrics to Watch

- `connections.browser` - Active browser connections
- `connections.tcp` - Active TCP connections  
- `connections.total` - Total connections
- `ipStats.uniqueIPs` - Number of unique IPs
- `ipStats.blockedIPs` - Number of blocked IPs

## Test Configuration

### Environment Variables

- `RELAY_URL` - Target used by `run-websocket-test.sh` (default: `ws://localhost:8787`)
- `HEALTH_URL` - Health endpoint for `monitor.js` / `run-websocket-test.sh` (default: `http://localhost:8787/health`)
- `RELAY_HOST`, `RELAY_PORT`, `RELAY_PG_PORT` - used by `mixed-load-test.js` (defaults: `localhost`, `8787`, `6543`)

### Node.js scripts

```bash
# End-to-end: fake browser agent + Postgres client through the relay
node load-tests/mixed-load-test.js

# Many concurrent agent+client pairs
node load-tests/stress-test.js --host=localhost --port=8787 --pgport=6543 --concurrency=50 --duration=30
# Flags: --pghost, --wss=true, --pgssl=true, --payload=<bytes>, --interval=<ms>, --rampup=<ms>, --origin=<url>

# Fill relay capacity to see the overload banner
./load-tests/trigger-overload.sh localhost 8787 600
```

### Customizing Test Load

Edit `browser-websocket-test.yml` to adjust:

- `arrivalRate` - Connections per second
- `duration` - Duration of each phase in seconds
- `think` times - Time between actions in seconds

### Example: Light Load Test

```yaml
phases:
  - duration: 60
    arrivalRate: 5
    name: "Light load"
```

### Example: Heavy Load Test

```yaml
phases:
  - duration: 300
    arrivalRate: 500
    name: "Heavy load"
```

## Expected Results

### Success Criteria

- **Connection Success Rate:** >99%
- **Average Latency:** <100ms
- **P95 Latency:** <200ms
- **P99 Latency:** <500ms
- **No Connection Refused Errors**

### What to Look For

1. **Connection Failures:** Should be <1%
2. **Latency Spikes:** Watch for sudden increases
3. **Server Errors:** Monitor for 5xx errors
4. **Rate Limiting:** Check if IPs are being blocked
5. **Resource Usage:** Monitor CPU, memory, network

## Troubleshooting

### Connection Refused

- Check if relay is running
- Verify URL is correct
- Check firewall/network settings

### High Failure Rate

- Reduce arrival rate
- Check server resources (CPU, memory)
- Verify rate limits aren't too restrictive

### Timeout Errors

- Increase timeout in Artillery config
- Check network latency
- Verify server can handle load

## Next Steps

After completing the WebSocket test, proceed to:

1. **TCP Connection Test** - Test Postgres TCP connections
2. **Mixed Load Test** - Test both WebSocket and TCP together
3. **Connection Churn Test** - Test rapid connect/disconnect patterns

For relay limits and tuning, see `docs/architecture/relay-security-features.md`.
