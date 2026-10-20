# db4app-todo-mcp-server

MCP server for the [db4app](https://github.com/maxabrahamsson/db4app) todo list app - enables LLMs to manage todos via Model Context Protocol using the Postgres TCP protocol.

## Installation

```bash
npm install -g db4app-todo-mcp-server
```

Or use with `npx` (no installation needed):

```bash
npx db4app-todo-mcp-server
```

## Usage

**Important**: This MCP server uses the **Postgres TCP protocol** to connect directly to your browser database, just like `psql` or other Postgres clients. It uses password authentication, plus TLS when your relay is configured for it.

### With LM Studio

1. **Locate your `mcp.json` file:**
   - **macOS:** `~/Library/Application Support/LM Studio/mcp.json`
   - **Windows:** `%APPDATA%\LM Studio\mcp.json`
   - **Linux:** `~/.config/LM Studio/mcp.json`

2. **Get your Connection ID and Auth Token:**
   - Open the Database page in your browser
   - Your **Connection ID** is displayed in the Connection Info section
   - Your **Auth Token** is also shown in the Connection Info section (this is your password)

3. **Install the todo-mcp app** from the Community Apps page in db4app

4. **Add this to the `mcpServers` object in your `mcp.json`:**

```json
{
  "mcpServers": {
    "db4app-todo": {
      "command": "npx",
      "args": [
        "-y",
        "db4app-todo-mcp-server@0.1.0"
      ],
      "env": {
        "MCP_POSTGRES_URL": "postgres://postgres:YOUR_AUTH_TOKEN@localhost:5432/YOUR_CONNECTION_ID",
        "MCP_SCHEMA": "todo_mcp"
      }
    }
  }
}
```

**Important Notes:**
- Replace `YOUR_AUTH_TOKEN` with your actual auth token from step 2
- Replace `YOUR_CONNECTION_ID` with your Connection ID from step 2
- The connection string format is: `postgres://postgres:AUTH_TOKEN@RELAY_HOST:PORT/CONNECTION_ID`
- Each browser tab has its own unique Connection ID and Auth Token - make sure you use the correct ones
- **Postgres TCP Protocol**: The MCP server uses the standard Postgres wire protocol, just like `psql` or DBeaver

5. **Restart LM Studio** to load the new MCP server configuration.

### With Claude Desktop

1. **Locate your Claude Desktop config:**
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux:** `~/.config/Claude/claude_desktop_config.json`

2. **Add the same configuration** as above to the `mcpServers` object.

3. **Restart Claude Desktop.**

## Available Tools

### `add_todo`

Add a new todo item to the list.

**Parameters:**
- `title` (required): The title of the todo item
- `description` (optional): Additional details
- `category` (optional): Category name (e.g., "Work", "Personal", "Shopping")
- `priority` (optional): Priority level (0=normal, 1=high, 2=urgent, default: 0)
- `due_date` (optional): Due date in ISO format (e.g., "2024-12-31T23:59:59Z")

**Example usage:**
```
"Add a todo to finish the project report by end of month, high priority, in the Work category"
```

### `mark_as_done`

Mark a todo item as completed.

**Parameters:**
- `todo_id` (required): The ID of the todo to mark as done

**Example usage:**
```
"Mark todo #5 as done"
"Complete the todo about finishing the report"
```

### `list_todos`

List all todos with optional filters.

**Parameters:**
- `show_completed` (optional): Show completed todos (default: true)
- `category` (optional): Filter by category name
- `priority` (optional): Filter by priority level (0, 1, or 2)

**Example usage:**
```
"Show me all my pending todos"
"List all high priority todos in the Work category"
"What todos do I have due today?"
```

### `remove_todo`

Delete a todo item.

**Parameters:**
- `todo_id` (required): The ID of the todo to remove

**Example usage:**
```
"Delete todo #3"
"Remove the todo about buying groceries"
```

## Environment Variables

- `MCP_POSTGRES_URL`: Postgres connection URL (format: `postgres://postgres:AUTH_TOKEN@RELAY_HOST:PORT/CONNECTION_ID`)
- `MCP_SCHEMA`: Schema name for todo tables (default: `todo_mcp`)
- `MCP_CONNECTION_ID`: Browser connection ID (alternative to full URL)
- `MCP_AUTH_TOKEN`: Auth token for authentication (alternative to full URL)
- `MCP_RELAY_HOST`: Relay hostname used with `MCP_CONNECTION_ID`/`MCP_AUTH_TOKEN` (default: `localhost`)
- `MCP_RELAY_PORT`: Relay Postgres port (default: `5432` for the local relay; `6543` for the Docker relay server)
- `MCP_RELAY_PG_DOMAIN`: Optional SNI routing domain of your relay; builds `CONNECTION_ID.<domain>` URLs with `sslmode=require`
- `MCP_POSTGRES_SSL`: Optional SSL override: `true`, `no-verify`, or `false` (default: follow `sslmode` in the URL)

There is no hosted relay: run `npx db4app-relay-local`, the DB4 Relay desktop app, or the Docker relay server from the repo root.

## Troubleshooting

### Connection Issues

- **Postgres TCP Protocol**: The MCP server uses the standard Postgres wire protocol, just like `psql` or DBeaver
- **Connection String Format**: `postgres://postgres:AUTH_TOKEN@RELAY_HOST:PORT/CONNECTION_ID`
- **Auth Token Required**: You must provide the auth token in the connection string (it's your password)
- **TLS Encryption**: Optional; use `sslmode=require` or `MCP_POSTGRES_SSL=true` when your relay has TLS configured

### Password Authentication Failed

If you see `FATAL: Password authentication failed`:

1. **Get your Auth Token**: Open the Database page → Connection Info section
2. **Use the exact token**: Copy the token and use it in your connection string
3. **Token persistence**: The token is auto-generated and stored in your browser's localStorage
4. **Single error message**: You should see only ONE error message. If you see multiple errors, please report it as a bug.

### Schema Not Found

If you see errors about the schema not existing:

1. **Install the app**: Make sure you've installed the "Todo List with MCP" app from the Community Apps page
2. **Check schema name**: Verify `MCP_SCHEMA` matches the schema name (default: `todo_mcp`)
3. **Verify installation**: Run `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'todo_mcp';` to confirm the schema exists

## License

MIT

