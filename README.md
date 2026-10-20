# db4

**Postgres in your browser tab, reachable by standard Postgres clients.**

db4 runs real Postgres ([PGlite](https://github.com/electric-sql/pglite), Postgres
compiled to WebAssembly) inside a browser tab and persists it to IndexedDB. A small
relay server lets external clients - `psql`, DBeaver, TablePlus, ORMs, MCP servers and
AI agents - connect to that database over the standard Postgres wire protocol.

> **Hosted instance shut down.** The hosted relay (`relay.db4.app`, `*.pg.db4.app`) was
> shut down on 2026-10-20. The project lives on as open source; to use it, run the web
> app and a relay yourself (see below). The website is at https://db4.lab4.app.

## Trust model

- **The browser tab is the ground-truth owner of the data.** All security checks,
  constraints and access controls (auth token, read-only mode, query guards, app
  schema isolation) are enforced in the tab and controlled by the user.
- **The relay is untrusted transport.** It routes bytes between a Postgres client and
  the right browser tab by connection ID. It stores nothing and makes no access
  decisions. The same applies to proxies and MCP servers.
- Data never leaves the tab unless you query it through a client you connected or
  export it.

## Architecture

```
 +-------------------+        Postgres wire        +------------------+
 | psql / DBeaver /  |  ------------------------>  |                  |
 | MCP server / ORM  |   TCP :6543 (optional TLS)  |      Relay       |
 +-------------------+                             |  server/index.js |
                                                   |  (untrusted)     |
                                                   +--------+---------+
                                                            |
                                          WebSocket :8787 /agent (binary frames)
                                                            |
                                     +----------------------v-----------------------+
                                     | Browser tab (trust boundary)                 |
                                     |  Postgres server shim (@db4app/client-sdk)   |
                                     |    - auth token check, query guards          |
                                     |  PGlite (Postgres in WASM) <-> IndexedDB     |
                                     +----------------------------------------------+
```

The connection ID is taken from the database name (or the TLS SNI hostname when
`RELAY_PG_DOMAIN` is configured); the password is the per-session auth token shown on
the Database page.

## Quick start

Requirements: Node.js 20+, npm, git.

```bash
git clone --recurse-submodules https://github.com/maxabrahamsson/db4app.git
cd db4app
git submodule update --init   # if you cloned without --recurse-submodules
npm install

npm run relay   # terminal 1: relay - HTTP/WebSocket :8787, Postgres :6543
npm run dev     # terminal 2: web app - http://localhost:5173
```

Open http://localhost:5173. The database starts automatically and connects to the
local relay. Copy the **Connection ID** and **Auth Token** from the Database page, then:

```bash
psql "postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID"
```

### Relay with Docker

```bash
docker build -t db4app-relay .
docker run -p 8787:8787 -p 6543:6543 db4app-relay
# or: docker run -p 8787:8787 -p 6543:6543 ghcr.io/maxabrahamsson/db4app-relay:latest
```

Main relay settings (environment variables):

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_PORT` | `8787` | HTTP + WebSocket (`/agent`, `/pg-ws/{id}`, `/health`) |
| `RELAY_PG_PORT` | `6543` | Postgres wire protocol |
| `RELAY_TIMEOUT` | `15000` | Request timeout (ms) |
| `ALLOWED_ORIGINS` | localhost dev origins | Comma-separated web app origins |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | `/etc/tls/tls.crt` / `.key` | Enable TLS on the Postgres port if present |
| `RELAY_PG_DOMAIN` | unset | Enable SNI routing: `<connectionId>.<domain>` |

Rate limits, TLS, exposing the relay to the internet, and pointing a deployed web app
at your relay (`VITE_RELAY_AGENT_URL` etc.) are covered in
[docs/self-hosting.md](docs/self-hosting.md).

### Single-user alternative

`npx db4app-relay-local` (see [packages/relay-cli](packages/relay-cli)) runs a minimal
local relay on `localhost:8787` / `localhost:5432`; [packages/relay-app](packages/relay-app)
wraps it as a desktop app.

## Connecting LLMs (MCP)

[`db4app-mcp-server`](packages/mcp-server-db4app) gives MCP clients (LM Studio, Claude
Desktop, ...) tools to query the browser database over the Postgres wire protocol:

```json
{
  "mcpServers": {
    "db4app": {
      "command": "npx",
      "args": ["-y", "db4app-mcp-server"],
      "env": {
        "MCP_POSTGRES_URL": "postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID"
      }
    }
  }
}
```

See [docs/developers/mcp-server-testing.md](docs/developers/mcp-server-testing.md).

## Packages

| Package | Description |
|---------|-------------|
| [`packages/client-sdk`](packages/client-sdk) | `@db4app/client-sdk` - relay agent, wire protocol helpers, and the Postgres server shim in front of PGlite |
| [`packages/components`](packages/components) | Shared React components |
| [`packages/mcp-server-db4app`](packages/mcp-server-db4app) | `db4app-mcp-server` - MCP server for the browser database |
| [`packages/todo-mcp-db4app`](packages/todo-mcp-db4app) | `db4app-todo-mcp-server` - MCP server for the todo example app |
| [`packages/relay-cli`](packages/relay-cli) | `db4app-relay-local` - single-user local relay |
| [`packages/relay-app`](packages/relay-app) | Tauri desktop app wrapping the relay CLI |
| [`packages/pg-ws-proxy`](packages/pg-ws-proxy) | Local TCP -> WebSocket proxy for reaching a relay through HTTP-only tunnels |

Other top-level directories: `src/` (web app), `server/` (relay), `apps/` (community
apps submodule, [db4app-community-apps](https://github.com/maxabrahamsson/db4app-community-apps)),
`load-tests/`, `docs/`.

## Features

- Full Postgres in the browser (PGlite), persisted to IndexedDB
- Standard Postgres wire protocol access through a relay, with password (auth token) auth
- Optional TLS and SNI routing on the relay
- Community apps/recipes installed into isolated schemas (e.g. RAG with pgvector)
- SQL export/import
- Telemetry is off by default; see [docs/telemetry.md](docs/telemetry.md)

## Documentation

See [docs/DOCUMENTATION-INDEX.md](docs/DOCUMENTATION-INDEX.md).

## Contributing & security

- [CONTRIBUTING.md](CONTRIBUTING.md) - dev setup and PR guidelines
- [SECURITY.md](SECURITY.md) - report vulnerabilities privately via GitHub Security Advisories

## License

[MIT](LICENSE) - Copyright (c) 2024-2026 Max Abrahamsson
