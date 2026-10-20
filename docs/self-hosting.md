# Self-hosting the Relay

The relay is untrusted transport: it forwards Postgres wire protocol bytes between
clients and the browser tab that owns the database. It stores no data. You can
run it on your laptop, a server, or behind a tunnel.

## Options

| Option | Command | Ports |
|--------|---------|-------|
| From source | `npm install && npm run relay` | HTTP/WS `8787`, Postgres `6543` |
| Docker (build locally) | `docker build -t db4app-relay . && docker run -p 8787:8787 -p 6543:6543 db4app-relay` | same |
| Docker (GHCR) | `docker run -p 8787:8787 -p 6543:6543 ghcr.io/maxabrahamsson/db4app-relay:latest` | same |
| docker compose | `docker compose up relay` | same |
| Single-user local CLI | `npx db4app-relay-local` (see `packages/relay-cli`) | HTTP/WS `8787`, Postgres `5432` |
| Desktop app | `packages/relay-app` (Tauri wrapper around the CLI) | same as CLI |

See [architecture/relay-comparison.md](./architecture/relay-comparison.md) for the
differences between the multi-tenant relay and the CLI.

## Relay configuration (`server/index.js`)

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_PORT` | `8787` | HTTP + WebSocket port (`/agent`, `/pg-ws/{id}`, `/health`) |
| `RELAY_PG_PORT` | `6543` | Postgres wire protocol port |
| `RELAY_TIMEOUT` | `15000` | Request timeout (ms) |
| `ALLOWED_ORIGINS` | localhost dev origins | Comma-separated origins allowed for the web app |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | `/etc/tls/tls.crt` / `/etc/tls/tls.key` | If both exist, the Postgres port accepts TLS (SSLRequest -> `S`) |
| `RELAY_PG_DOMAIN` | unset | Domain for SNI routing, e.g. `pg.example.com` -> clients connect to `<connectionId>.pg.example.com` (needs a wildcard cert) |
| `IP_CONNECTION_LIMIT`, `IP_RATE_LIMIT_*`, `MAX_CONNECTION_DURATION_MS`, `MAX_CONCURRENT_USERS`, `RATE_LIMIT_ALLOWLIST`, `TRUSTED_CIDRS` | see [relay-security-features.md](./architecture/relay-security-features.md) | Abuse protection |
| `POSTHOG_API_KEY`, `POSTHOG_HOST` | unset | Optional telemetry, see [telemetry.md](./telemetry.md) |

`PROXY_PORT`, `PROXY_PG_PORT` and `PROXY_TIMEOUT` are accepted as legacy aliases.

## Pointing the web app at your relay

By default, the web app on `localhost` connects to `ws://127.0.0.1:8787/agent`.
For other setups, set these at build time (e.g. in `.env.local`):

```bash
VITE_RELAY_AGENT_URL=wss://relay.example.com/agent
VITE_RELAY_HTTP_URL=https://relay.example.com/query
VITE_RELAY_HOST=relay.example.com
VITE_RELAY_PG_PORT=5432
```

You can also override the relay per tab with a `?relay=wss://relay.example.com/agent`
query parameter.

## Connecting a client

```bash
psql "postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID"
```

With TLS and `RELAY_PG_DOMAIN=pg.example.com`:

```bash
psql "postgres://postgres:YOUR_AUTH_TOKEN@YOUR_CONNECTION_ID.pg.example.com:5432/postgres?sslmode=require"
```

## Exposing the relay to the internet

Only do this if you need remote clients. Note that TLS on the Postgres port is
terminated by the relay process, so whoever operates the relay can observe query
traffic. Run your own relay, and rely on the browser tab (auth token, query guards)
for access control - never on the relay.

### Port forwarding

Forward two TCP ports from your router to the machine running the relay:

| Service | Internal port | Notes |
|---------|---------------|-------|
| HTTP/WebSocket | `RELAY_PORT` (8787) | Browser tabs connect to `/agent` |
| Postgres | `RELAY_PG_PORT` (6543) | Postgres clients |

Using non-standard external ports (e.g. 15432) reduces automated scanning. Open
the same ports in the host firewall (`ufw allow 8787/tcp`, etc.). Verify from
outside your network with `curl http://YOUR_PUBLIC_IP:8787/health`.

### Tunnels / reverse proxies

- HTTP-only tunnels (e.g. Cloudflare Tunnel) can carry the WebSocket port. Raw
  Postgres TCP usually cannot pass through them; use `/pg-ws/{connectionId}`
  together with `packages/pg-ws-proxy` on the client side, which exposes a local
  TCP port and forwards it over WebSocket.
- `docker-compose.yml` includes an optional `cloudflared` service; provide your own
  tunnel token via the environment.
- When behind a proxy/load balancer, add its address range to `TRUSTED_CIDRS`.

### TLS

Mount a certificate and key at `TLS_CERT_PATH`/`TLS_KEY_PATH`. For per-connection
hostnames use a wildcard certificate for `*.RELAY_PG_DOMAIN`.

## Health check

`GET /health` returns connection counts and limits. The Docker image's
`HEALTHCHECK` probes the HTTP port.
