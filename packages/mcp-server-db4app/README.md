# db4app-mcp-server

MCP server for [db4app](https://github.com/maxabrahamsson/db4app) - enables LLMs to interact with browser-based Postgres databases via Model Context Protocol using the Postgres TCP protocol.

## Installation

```bash
npm install -g db4app-mcp-server
```

Or use with `npx` (no installation needed):

```bash
npx db4app-mcp-server
```

## Usage

**Important**: This MCP server uses the **Postgres TCP protocol** to connect directly to your browser database, just like `psql` or other Postgres clients. It uses password authentication, plus TLS when your relay is configured for it.

### With LM Studio

1. Locate your `mcp.json` file:
   - **macOS:** `~/Library/Application Support/LM Studio/mcp.json`
   - **Windows:** `%APPDATA%\LM Studio\mcp.json`
   - **Linux:** `~/.config/LM Studio/mcp.json`

2. **Get your Connection ID and Auth Token**:
   - Open the Database page in your browser
   - Your **Connection ID** is displayed in the Connection Info section
   - Your **Auth Token** is also shown in the Connection Info section (this is your password)

3. Add this to the `mcpServers` object in your `mcp.json`:

```json
{
  "mcpServers": {
    "db4app": {
      "command": "npx",
      "args": [
        "-y",
        "db4app-mcp-server@0.1.9"
      ],
      "env": {
        "MCP_POSTGRES_URL": "postgres://postgres:YOUR_AUTH_TOKEN@localhost:5432/YOUR_CONNECTION_ID",
        "LM_STUDIO_EMBEDDING_URL": "http://localhost:1234/v1/embeddings",
        "LM_STUDIO_EMBEDDING_MODEL": "text-embedding-qwen3-embedding-4b",
        "MCP_SCHEMA": "rag_mcp"
      }
    }
  }
}
```

**Note**: 
- Replace `YOUR_AUTH_TOKEN` with your actual auth token from step 2
- Replace `YOUR_CONNECTION_ID` with your Connection ID from step 2
- The connection string format is: `postgres://postgres:AUTH_TOKEN@RELAY_HOST:PORT/CONNECTION_ID`
- **Postgres TCP Protocol**: This server uses the standard Postgres wire protocol, just like `psql` or DBeaver
- See [Choosing a relay](#choosing-a-relay) for host/port options

4. **Install an Embedding Model** (Required for RAG features):
   - Open LM Studio → Search tab
   - Search for embedding models (e.g., "bge", "e5", "text-embedding")
   - Download and load an embedding-capable model
   - Update `LM_STUDIO_EMBEDDING_MODEL` in your `mcp.json` with the exact model name
   - Enable headless server mode in LM Studio

5. Restart LM Studio to load the configuration.

### With Claude Desktop

1. **Get your Connection ID and Auth Token** (same as LM Studio setup above)

2. Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "db4app": {
      "command": "npx",
      "args": [
        "-y",
        "db4app-mcp-server@0.1.9"
      ],
      "env": {
        "MCP_POSTGRES_URL": "postgres://postgres:YOUR_AUTH_TOKEN@localhost:5432/YOUR_CONNECTION_ID",
        "LM_STUDIO_EMBEDDING_URL": "http://localhost:1234/v1/embeddings",
        "LM_STUDIO_EMBEDDING_MODEL": "text-embedding-qwen3-embedding-4b",
        "MCP_SCHEMA": "rag_mcp"
      }
    }
  }
}
```

**Note**: 
- Replace `YOUR_AUTH_TOKEN` with your actual auth token
- Replace `YOUR_CONNECTION_ID` with your Connection ID
- The connection string format is: `postgres://postgres:AUTH_TOKEN@RELAY_HOST:PORT/CONNECTION_ID`

## Choosing a relay

db4app has no hosted relay. The MCP server talks to your browser tab through a relay you run yourself:

- **Local relay** (simplest): `npx db4app-relay-local` or the DB4 Relay desktop app. Postgres listens on `localhost:5432`.
- **Self-hosted relay server** (`docker compose up` in the repo root). Postgres listens on port `6543`.

The connection URL routes to your browser tab via the database name:

```
postgres://postgres:AUTH_TOKEN@RELAY_HOST:PORT/CONNECTION_ID
```

If your relay server has TLS and SNI routing configured (`RELAY_PG_DOMAIN`), you can instead use
`postgres://postgres:AUTH_TOKEN@CONNECTION_ID.<your-domain>:6543/CONNECTION_ID?sslmode=require`.

Relay-related environment variables (used when the URL is built from `MCP_CONNECTION_ID` + `MCP_AUTH_TOKEN`):

- `MCP_RELAY_HOST` - relay hostname (default: `localhost`)
- `MCP_RELAY_PORT` - relay Postgres port (default: `5432`; use `6543` for the Docker relay server)
- `MCP_RELAY_PG_DOMAIN` - optional SNI routing domain; when set, URLs use `CONNECTION_ID.<domain>` with `sslmode=require`
- `MCP_POSTGRES_SSL` - optional SSL override: `true` (verify certificates), `no-verify`, or `false`. When unset, the `sslmode` in the URL is used.

## Configuration

All configuration is done via environment variables:

- `MCP_POSTGRES_URL` - **Required**: Postgres connection string. Format: `postgres://postgres:AUTH_TOKEN@RELAY_HOST:PORT/CONNECTION_ID`. Get your Connection ID and Auth Token from the Database page → Connection Info section.
- `MCP_CONNECTION_ID` - **Optional**: Browser connection ID. Used to construct connection URL if `MCP_POSTGRES_URL` is not provided (requires `MCP_AUTH_TOKEN`).
- `MCP_AUTH_TOKEN` - **Optional**: Auth token for authentication. Used to construct connection URL if `MCP_POSTGRES_URL` is not provided (requires `MCP_CONNECTION_ID`).
- `LM_STUDIO_EMBEDDING_URL` - LM Studio embedding API endpoint (default: `http://localhost:1234/v1/embeddings`)
- `LM_STUDIO_EMBEDDING_MODEL` - Optional model name for embeddings
- `MCP_SCHEMA` - **Optional**: Schema name for RAG functions (`remember`, `search_memory`). Defaults to `public`. For recipes, set this to the recipe's schema (e.g., `rag_mcp`).

**Note**: This MCP server uses the **Postgres TCP protocol**, just like standard Postgres clients (TLS when the relay supports it). No HTTP or RSA-OAEP encryption is used.

## Available Tools

- `query_database` - Execute SQL queries against the database
- `list_tables` - List tables in the database
- `remember` - Store information in memory with automatic embedding (uses `MCP_SCHEMA` for the target schema). Supports large embeddings (e.g., 2560 dimensions) with automatic timeout handling.
- `search_memory` - Search through stored memories using semantic similarity (uses `MCP_SCHEMA` for the target schema). Works with embeddings of any size.

## Security

This MCP server uses the standard Postgres TCP protocol with:
- **TLS encryption** (optional): when your relay has TLS configured, use `sslmode=require` or `MCP_POSTGRES_SSL=true`. A local relay on `localhost` is plaintext over loopback.
- **Password authentication**: Uses the auth token as the password

**Note**: With password authentication, anyone with the auth token can connect with any Postgres client and access all tables. The security model relies on:
- Not sharing the auth token
- Schema isolation (recipes operate in their own schemas)
- Standard Postgres access control (if you have the password, you have access)

## Requirements

- Node.js 18+
- Browser tab with db4app open and connected to your relay
- Connection ID and Auth Token from the Database page
- For RAG features: LM Studio with embedding-capable model loaded

## Performance

The MCP server automatically handles large embeddings:
- **Small arrays (<1000 elements)**: 30-second timeout
- **Large arrays (1000-2000 elements)**: 60-second timeout
- **Very large arrays (>2000 elements, e.g., 2560-dim embeddings)**: 120-second timeout

All embedding sizes are fully supported, including large models like Qwen (2560 dimensions).

## Connection String Format

The connection string follows the standard Postgres URL format:

```
postgres://postgres:AUTH_TOKEN@RELAY_HOST:PORT/CONNECTION_ID
```

Where:
- `postgres` is the username (fixed)
- `AUTH_TOKEN` is your auth token (password)
- `RELAY_HOST:PORT` is your relay (e.g. `localhost:5432` for the local relay, port `6543` for the Docker relay server)
- `CONNECTION_ID` is your connection ID (used as the database name for routing)

## Development

```bash
npm install
npm run build          # bundles src/index.js -> dist/index.js
npm pack --dry-run     # check published contents (LICENSE, README.md, dist/index.js, package.json)
```

Releases are published to npm with `npm version <patch|minor|major>` followed by `npm publish`.

## License

MIT
