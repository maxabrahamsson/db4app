# Folder Structure

| Path | Purpose |
|------|---------|
| `src/` | React + Vite web app. Runs PGlite in the browser tab and connects to a relay as a browser agent. |
| `src/recipes.ts` | Built-in apps/recipes (SQL + instructions embedded after review). |
| `src/utils/relayConfig.ts` | Resolves which relay the tab connects to (`VITE_RELAY_*`, `?relay=`). |
| `src/utils/queryGuard.ts` | Browser-side query guards (e.g. read-only mode). |
| `server/index.js` | Multi-tenant relay: WebSocket for browser agents, TCP (optionally TLS) for Postgres clients. Also the Docker image. |
| `packages/client-sdk/` | `@db4app/client-sdk` - browser/Node agent, Postgres wire protocol helpers and the Postgres server shim that sits in front of PGlite. |
| `packages/components/` | Shared React components (e.g. the DB connection box). |
| `packages/mcp-server-db4app/` | `db4app-mcp-server` - MCP server that talks to the browser DB over Postgres wire protocol. |
| `packages/todo-mcp-db4app/` | `db4app-todo-mcp-server` - MCP server for the todo example app. |
| `packages/relay-cli/` | `db4app-relay-local` - single-user local relay CLI. |
| `packages/relay-app/` | Tauri desktop app wrapping the relay CLI as a sidecar. |
| `packages/pg-ws-proxy/` | `db4app-pg-ws-proxy` - local TCP -> WebSocket proxy for reaching a relay through HTTP-only tunnels. |
| `apps/` | Git submodule with community apps ([db4app-community-apps](https://github.com/maxabrahamsson/db4app-community-apps)). |
| `load-tests/` | Artillery / Node.js load tests for the relay (default target: localhost). |
| `docs/` | Documentation (start at [DOCUMENTATION-INDEX.md](../DOCUMENTATION-INDEX.md)). |

## `apps/` - community apps

Each app lives in `apps/{app-id}/` with `recipe.json` (metadata), `setup.sql` and
`instructions.md`. Apps are contributed via PRs to the community repository;
after review the submodule is synced and the content is embedded in
`src/recipes.ts`. See [README_APPS_SUBMODULE.md](../../README_APPS_SUBMODULE.md).

## Recipes vs MCP packages

- A **recipe/app** defines what gets installed in the database (schema, tables, functions).
- An **MCP server** is an npm package that gives LLM tools access to those tables.

A recipe can reference an MCP server via its `mcpServer.npmPackage` field:

```json
{
  "mcpServer": {
    "npmPackage": "db4app-mcp-server",
    "command": "npx",
    "args": ["-y", "db4app-mcp-server"]
  }
}
```

Build the MCP server locally with `npm run build:mcp`.
