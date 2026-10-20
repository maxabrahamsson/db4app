# Multiple Tables Example

This guide shows how to create a recipe that uses multiple tables in your MCP server.

## Scenario

You're building a recipe that manages user sessions. You need:
- `users` table - store user information
- `sessions` table - track active sessions
- `logs` table - audit log of actions

All tables must be in your isolated schema.

## Recipe Configuration

### recipe.json

```json
{
  "id": "user-sessions",
  "name": "User Session Management",
  "description": "Manage users and their sessions with audit logging",
  "version": "1.0.0",
  "author": "Your Name",
  "category": "data",
  "tags": ["users", "sessions", "auth"],
  "schema": "user_sessions",
  "setup": {
    "sql": "setup.sql",
    "instructions": "instructions.md"
  },
  "permissions": {
    "allowedTables": [
      "user_sessions.users",
      "user_sessions.sessions",
      "user_sessions.logs"
    ],
    "allowedSchemas": ["user_sessions"],
    "readOnly": false
  },
  "mcpServer": {
    "npmPackage": "@your-scope/mcp-server-user-sessions",
    "command": "npx",
    "args": ["-y", "@your-scope/mcp-server-user-sessions"],
    "env": {
      "MCP_RELAY_HTTP_URL": "http://localhost:8787/query",
      "MCP_ALLOWED_TABLES": "user_sessions.users,user_sessions.sessions,user_sessions.logs"
    }
  }
}
```

### setup.sql

```sql
-- Create isolated schema
CREATE SCHEMA IF NOT EXISTS user_sessions;

-- Users table
CREATE TABLE IF NOT EXISTS user_sessions.users (
  id serial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  email text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Sessions table
CREATE TABLE IF NOT EXISTS user_sessions.sessions (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES user_sessions.users(id),
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Logs table
CREATE TABLE IF NOT EXISTS user_sessions.logs (
  id serial PRIMARY KEY,
  user_id int REFERENCES user_sessions.users(id),
  action text NOT NULL,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON user_sessions.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_token_idx ON user_sessions.sessions(token);
CREATE INDEX IF NOT EXISTS logs_user_id_idx ON user_sessions.logs(user_id);
```

## MCP Server Implementation

### Reading Multiple Tables

```javascript
// Get allowed tables from environment
const allowedTables = process.env.MCP_ALLOWED_TABLES
  ? process.env.MCP_ALLOWED_TABLES.split(',').map(t => t.trim())
  : []

// Extract schema (all tables should be in same schema)
const schema = allowedTables.length > 0 && allowedTables[0].includes('.')
  ? allowedTables[0].split('.')[0]
  : 'public'

// Example: Get user with active sessions
async function getUserWithSessions(userId) {
  const sql = `
    SELECT 
      u.id,
      u.username,
      u.email,
      s.id as session_id,
      s.token,
      s.expires_at
    FROM ${schema}.users u
    LEFT JOIN ${schema}.sessions s ON u.id = s.user_id
    WHERE u.id = $1
      AND (s.expires_at IS NULL OR s.expires_at > now())
  `
  
  const result = await executeSql(relayUrl, sql, [userId], allowedTables)
  return result
}

// Example: Create session and log it
async function createSession(userId, token, expiresAt) {
  // Insert session
  const sessionSql = `
    INSERT INTO ${schema}.sessions (user_id, token, expires_at)
    VALUES ($1, $2, $3)
    RETURNING id, user_id, token, expires_at
  `
  
  const session = await executeSql(
    relayUrl, 
    sessionSql, 
    [userId, token, expiresAt],
    allowedTables
  )
  
  // Log the action
  const logSql = `
    INSERT INTO ${schema}.logs (user_id, action, details)
    VALUES ($1, 'session_created', $2::jsonb)
  `
  
  await executeSql(
    relayUrl,
    logSql,
    [userId, JSON.stringify({ session_id: session.rows[0].id, token })],
    allowedTables
  )
  
  return session
}
```

### Validating Table Access

The relay automatically validates that all tables in your queries are in the whitelist:

```javascript
// ✅ This works - all tables are whitelisted
const sql = `
  SELECT u.*, s.*
  FROM ${schema}.users u
  JOIN ${schema}.sessions s ON u.id = s.user_id
`

// ❌ This will be rejected - public.todos is not whitelisted
const badSql = `
  SELECT u.*, t.*
  FROM ${schema}.users u
  JOIN public.todos t ON u.id = t.user_id  -- ERROR: public.todos not allowed
`
```

## Key Points

1. **All tables in same schema**: All whitelisted tables must be in your recipe's schema
2. **Comma-separated env var**: `MCP_ALLOWED_TABLES` uses commas: `"schema.t1,schema.t2,schema.t3"`
3. **Array in recipe.json**: `permissions.allowedTables` is an array: `["schema.t1", "schema.t2"]`
4. **Relay validation**: All queries are validated - you can't access non-whitelisted tables
5. **JOINs work**: You can JOIN multiple whitelisted tables together

## Testing

When testing your MCP server:

1. Set `MCP_ALLOWED_TABLES` environment variable
2. Try querying each table individually
3. Try JOINing multiple tables
4. Try accessing a non-whitelisted table (should fail)
5. Verify relay rejects unauthorized queries

