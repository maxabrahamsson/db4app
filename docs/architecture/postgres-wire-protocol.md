# Postgres Wire Protocol over the Relay

PGlite (Postgres compiled to WASM) has no network layer: it exposes a JavaScript
API (`db.query()`, `db.exec()`, `db.execProtocol()`) and persists to IndexedDB.
db4 makes it reachable by standard Postgres clients by tunnelling the Postgres
wire protocol through a relay to the browser tab.

## Flow

```
Postgres client (psql, DBeaver, MCP server, ...)
  -> TCP (optionally TLS) to the relay  (default port 6543)
    -> relay looks up the browser tab by connection ID
      -> WebSocket (binary Postgres protocol frames)
        -> browser: Postgres server shim (packages/client-sdk/src/shim.ts)
          -> PGlite
```

The relay only forwards bytes. The browser-side shim parses startup, performs
password authentication against the session's auth token, and executes queries.
This is the trust boundary: the relay never decides who may access the data.

## Handshake

```
1. Client -> SSLRequest (optional)        relay answers 'S' (TLS configured) or 'N'
2. Client -> StartupMessage (user, database, ...)
3. Server -> AuthenticationCleartextPassword / password check (in the browser)
4. Server -> AuthenticationOk, BackendKeyData, ParameterStatus..., ReadyForQuery('I')
```

## Query protocols

- **Simple Query** (`Q`) - executed via PGlite.
- **Extended Query** (`P`arse, `B`ind, `D`escribe, `E`xecute, `S`ync, `C`lose) -
  passed to PGlite's `execProtocol`. The shim buffers fragmented messages (large
  `Bind` payloads such as embeddings arrive across multiple WebSocket frames).

## Connecting

The connection ID is either taken from the TLS SNI hostname
(`<connectionId>.<RELAY_PG_DOMAIN>`) or from the database name:

```bash
# Plaintext, database name = connection ID
psql "postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID"
```

- The username is ignored; the password is the auth token shown on the Database page.
- The connection ID and token are generated in the browser and stored in its
  local storage.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `Browser connection not found or disconnected` | Is the tab open and showing "Relay connected"? Does the connection ID match exactly? Is the tab pointed at the same relay (`VITE_RELAY_AGENT_URL` / `?relay=`)? |
| Connection refused | Is the relay running and the Postgres port (`RELAY_PG_PORT`) reachable? |
| SSL errors | The relay only offers TLS when `TLS_CERT_PATH`/`TLS_KEY_PATH` exist; use `sslmode=disable` locally. |
| Password authentication failed | Copy the auth token again from the Database page; it is per browser session. |
| Hangs | Look for `[PostgresShim]` logs in the browser console (enable debug logging) and the relay's stdout. |

## Differences from a real Postgres server

- One PGlite instance per tab; concurrent client sessions share it.
- No roles/users - access is all-or-nothing per auth token.
- Some catalog queries issued by GUI tools may behave differently from server
  Postgres.
