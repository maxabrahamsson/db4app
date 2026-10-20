# Relay Implementations: Multi-tenant Relay vs Local Relay CLI

The repository contains two relay implementations. Both bridge Postgres wire
protocol connections (psql, DBeaver, MCP servers, ...) to a PGlite database
running in a browser tab via WebSocket.

- **Multi-tenant relay** (`server/index.js`, run with `npm run relay` or the Docker image) -
  serves many browser tabs at once, routed by connection ID.
- **Local relay CLI** (`packages/relay-cli/bin/relay.js`, `npx db4app-relay-local`) -
  a lightweight single-user relay for your own machine. The desktop app in
  `packages/relay-app` wraps this CLI as a Tauri sidecar.

In both cases the relay is **untrusted transport**. The browser tab owns the data and
enforces authentication (the per-session auth token) and access control. Never add
security decisions to the relay that the browser does not also enforce.

## At a glance

| Aspect | Multi-tenant relay (`server/`) | Local relay CLI (`packages/relay-cli`) |
|--------|-------------------------------|----------------------------------------|
| Browser connections | `Map<connectionId, connection>` | Single connection |
| Routing | SNI hostname → database name (UUID) → `dbname:connectionId` | Whatever browser tab is connected |
| TLS | Optional, loaded from `TLS_CERT_PATH` / `TLS_KEY_PATH` | None (localhost) |
| Rate limiting | Per-IP limits, temporary blocks, max connection duration | None |
| Postgres over WebSocket | `/pg-ws/{connectionId}` (for tunnels that only pass HTTP) | Not needed |
| Default ports | HTTP/WS `8787`, Postgres `6543` | HTTP/WS `8787`, Postgres `5432` |
| Configuration | Environment variables | CLI flags |
| Telemetry | Optional, only if `POSTHOG_API_KEY` is set | None |

## Routing (multi-tenant relay)

When a Postgres client connects, the relay determines which browser tab to forward
to, in this order:

1. **SNI hostname** on a TLS connection, of the form `<connectionId>.<your-pg-domain>`
   (requires a wildcard certificate for your domain).
2. **Database name** set to the connection ID UUID, e.g.
   `postgres://postgres:TOKEN@relay.example.com:6543/<connectionId>`.
3. **Database name** in `dbname:connectionId` form.

If none match, the client receives an error.

## Security and rate limiting (multi-tenant relay)

See [relay-security-features.md](./relay-security-features.md). These limits protect
the relay process from resource exhaustion; they are not a substitute for the
browser-side authentication.

## Error handling

Both relays use a "fake success" strategy during startup: the relay completes the
Postgres handshake locally and then forwards the real authentication result from
the browser. This avoids psql's automatic retry behaviour when a password is
rejected.

## When to use which

**Multi-tenant relay** - you want to serve several browser tabs/users, need TLS, or
are deploying the relay on a server (Docker image published to GHCR).

**Local relay CLI / desktop app** - local development, a single user, everything on
`localhost`, nothing exposed to the network.

## Connection strings

| | Multi-tenant relay | Local relay CLI |
|-|--------------------|-----------------|
| Browser agent URL | `ws://localhost:8787/agent` (or `wss://` behind TLS) | `ws://localhost:8787/agent` |
| Postgres | `postgres://postgres:TOKEN@localhost:6543/<connectionId>` | `postgres://postgres:TOKEN@localhost:5432` |

## References

- Multi-tenant relay: `server/index.js`
- Local relay CLI: `packages/relay-cli/bin/relay.js`, `packages/relay-cli/README.md`
- Self-hosting guide: [../self-hosting.md](../self-hosting.md)
