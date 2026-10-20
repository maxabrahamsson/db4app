# Relay Security Features

The multi-tenant relay (`server/index.js`) includes protections against abuse and
resource exhaustion. These protect the **relay process**; they are not the trust
boundary. Authentication and access control for your data are enforced by the
browser tab that owns the database (see [security-summary.md](./security-summary.md)).

## Features

### Health endpoint
`GET /health` reports active connections (browser + TCP), connections per IP,
top IPs, blocked IPs and the current limit settings.

### IP-based rate limiting
Limits how many new connections an IP can open within a time window.
Defaults: 5 connections per 60 seconds.

### Connection limit per IP
Limits simultaneous connections per IP. Default: 10.

### Automatic temporary blocking
IPs that exceed the rate limit are blocked for 5 minutes, then unblocked
automatically. Blocking events are logged.

### Maximum connection duration
Connections are closed after a maximum duration. Default: 1 hour.

### Global capacity
`MAX_CONCURRENT_USERS` (default 500) caps the number of active browser
connections.

### Allowlisting
IPs in `RATE_LIMIT_ALLOWLIST` (comma-separated) or inside `TRUSTED_CIDRS`
(comma-separated CIDRs, e.g. your load balancer or pod network) bypass the
per-IP limits. Both are empty by default.

## Environment variables

```bash
IP_CONNECTION_LIMIT=10              # Max simultaneous connections per IP
IP_RATE_LIMIT_WINDOW_MS=60000       # Rate limit window (1 minute)
IP_RATE_LIMIT_MAX_CONNECTIONS=5     # Max new connections per window
MAX_CONNECTION_DURATION_MS=3600000  # Max connection duration (1 hour)
MAX_CONCURRENT_USERS=500            # Max active browser connections
RATE_LIMIT_ALLOWLIST=               # e.g. 203.0.113.10,203.0.113.11
TRUSTED_CIDRS=                      # e.g. 10.0.0.0/8
```

## Example `/health` response

```json
{
  "status": "healthy",
  "connections": { "browser": 5, "tcp": 12, "total": 17 },
  "ipStats": {
    "uniqueIPs": 3,
    "totalIPConnections": 17,
    "blockedIPs": 0,
    "topIPs": [
      { "ip": "203.0.113.10", "connections": 8 },
      { "ip": "198.51.100.7", "connections": 5 },
      { "ip": "192.0.2.44", "connections": 4 }
    ]
  },
  "limits": {
    "maxConnectionsPerIP": 10,
    "rateLimitWindowMs": 60000,
    "rateLimitMaxConnections": 5,
    "maxConnectionDurationMs": 3600000
  }
}
```

## Operational tips

1. Watch `/health` for suspicious patterns.
2. Tune limits to your expected usage.
3. If the relay sits behind a reverse proxy or load balancer, add the proxy's
   address range to `TRUSTED_CIDRS` so all traffic is not attributed to one IP.
4. Consider a DDoS-protecting proxy in front of a publicly exposed relay.
