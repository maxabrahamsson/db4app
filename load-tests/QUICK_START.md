# Quick Start: WebSocket Load Test

## Prerequisites

✅ Artillery is installed (run `npm install -g artillery` if needed)  
✅ A relay you operate is running (e.g. `npm run relay` on localhost)

## Run Your First Test

### Option 1: Using npm script (Recommended)

```bash
npm run test:load:websocket        # uses the target in the YAML (ws://localhost:8787)
npm run test:load:websocket:local  # explicit --target ws://localhost:8787
```

### Option 2: Using Artillery directly

```bash
artillery run load-tests/browser-websocket-test.yml
# another relay:
artillery run --target wss://relay.example.com load-tests/browser-websocket-test.yml
```

### Option 3: Using the shell script

```bash
./load-tests/run-websocket-test.sh
```

## What the Test Does

1. **Connects** to the relay WebSocket endpoint (`/agent`)
2. **Sends** `agent_ready` message with a unique connection ID
3. **Waits** for `connection_established` response
4. **Keeps** connection alive for ~2 minutes
5. **Closes** connection gracefully

The test runs in phases:
- **Warm up:** 10 connections/sec for 1 minute
- **Ramp up:** 50 connections/sec for 5 minutes
- **Sustained:** 100 connections/sec for 10 minutes
- **Peak:** 200 connections/sec for 5 minutes
- **Cool down:** 50 connections/sec for 2 minutes

## Monitor During Test

Open another terminal and run:

```bash
# Monitor relay health
watch -n 1 'curl -s http://localhost:8787/health | jq'
```

## View Results

After the test completes, Artillery will show:
- Total requests
- Success/failure rates
- Latency metrics (min, max, median, p95, p99)
- Request rates

To generate an HTML report:
```bash
artillery report artillery-report.json
```

## Expected Output

```
Phase 1: Warm up - 10 connections/sec
✓ 600 connections established
✓ 99.8% success rate
✓ Average latency: 45ms

Phase 2: Ramp up - 50 connections/sec
✓ 15,000 connections established
✓ 99.5% success rate
✓ Average latency: 52ms

...
```

## Troubleshooting

### "Connection refused"
- Check if relay is running
- Verify URL is correct
- Check firewall/network settings

### "High failure rate"
- Reduce arrival rate in test config
- Check server resources
- Verify rate limits

### "Timeout errors"
- Increase timeout in config
- Check network latency
- Verify server can handle load

## Next Steps

1. Review the results
2. Check relay health metrics
3. Adjust test parameters if needed
4. Run TCP connection test next

See `load-tests/README.md` for more details.
