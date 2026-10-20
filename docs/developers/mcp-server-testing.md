# Testing the MCP Server (LM Studio, Claude Desktop, ...)

`db4app-mcp-server` (`packages/mcp-server-db4app`) lets MCP-compatible LLM tools
query your browser database over the Postgres wire protocol via a relay.

## Prerequisites

1. A relay running locally: `npm run relay` (HTTP/WS `8787`, Postgres `6543`).
2. The web app running (`npm run dev`) and open at `http://localhost:5173/database`,
   showing "Relay connected".
3. (For RAG tools) the "RAG with MCP Server" app/recipe installed.
4. (For embeddings) LM Studio's local server running with an embedding model.

## 1. Get connection info

From the Database page copy your **Connection ID** and **Auth Token**.

## 2. Configure the MCP client

LM Studio `mcp.json` locations:
- macOS: `~/Library/Application Support/LM Studio/mcp.json`
- Windows: `%APPDATA%\LM Studio\mcp.json`
- Linux: `~/.config/LM Studio/mcp.json`

```json
{
  "mcpServers": {
    "db4app": {
      "command": "npx",
      "args": ["-y", "db4app-mcp-server@0.1.9"],
      "env": {
        "MCP_POSTGRES_URL": "postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID",
        "LM_STUDIO_EMBEDDING_URL": "http://localhost:1234/v1/embeddings",
        "LM_STUDIO_EMBEDDING_MODEL": "your-embedding-model",
        "MCP_SCHEMA": "rag_mcp"
      }
    }
  }
}
```

To test unpublished local changes, point `command`/`args` at
`node packages/mcp-server-db4app/dist/index.js` after `npm run build:mcp`.

### Version pinning

- `db4app-mcp-server@0.1.9` - exact version (most predictable)
- `db4app-mcp-server@^0.1.9` - patch/minor-compatible updates
- `db4app-mcp-server@latest` - always newest

Check published versions with `npm view db4app-mcp-server versions`. If `npx`
picks up a stale version, run `npm cache clean --force`.

## 3. Restart the MCP client and try

- "List all tables in the database"
- "Remember that I prefer dark mode"
- "What did I tell you about my preferences?"
- "Show me all documents in the rag_mcp schema"

## Troubleshooting

| Error | Fix |
|-------|-----|
| MCP server not starting | Check client logs; `which npx`; Node.js >= 18; run `npx -y db4app-mcp-server` manually |
| Password authentication failed | Re-copy the auth token; the tab must still be open |
| Browser connection not found | Tab closed/disconnected or wrong connection ID |
| Failed to connect to embedding endpoint | Start LM Studio's server and load an embedding model |
| `relation "rag_mcp.documents" does not exist` | Install the RAG app and make `MCP_SCHEMA` match its schema |
