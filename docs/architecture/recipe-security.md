# Recipe Security & Permissions Architecture

## Overview

Recipes must be secure, reviewable, and isolated to prevent unauthorized access to user data. This document outlines the security model.

## Security Principles

1. **Review Before Display**: All recipes are reviewed before appearing in the marketplace
2. **Schema Isolation**: Each recipe operates in its own schema
3. **Table Whitelisting**: MCP servers can only access whitelisted tables
4. **SQL Validation**: All SQL is validated before execution
5. **Embedded Content**: Instructions and SQL are embedded in recipe JSON after review

## Recipe Schema (Post-Review)

After maintainer review, recipes are embedded in the app with all content:

```json
{
  "id": "rag-mcp",
  "name": "RAG with MCP Server",
  "description": "...",
  "version": "1.0.0",
  "author": "db4",
  "category": "ai",
  "tags": ["rag", "embeddings", "mcp"],
  "schema": "rag_mcp",  // Isolated schema name
  "setup": {
    "sql": "-- Embedded SQL after review\nCREATE SCHEMA IF NOT EXISTS rag_mcp;...",
    "instructions": "# Embedded markdown instructions\n..."
  },
  "permissions": {
    "allowedTables": ["rag_mcp.documents"],  // Whitelist for MCP server (array)
    "allowedSchemas": ["rag_mcp"],  // Schema isolation
    "readOnly": false  // Can write to its own tables
  },
  "mcpServer": {
    "npmPackage": "db4app-mcp-server",
    "command": "npx",
    "args": ["-y", "db4app-mcp-server"],
    "env": {
      "MCP_RELAY_HTTP_URL": "http://localhost:8787/query",
      "LM_STUDIO_EMBEDDING_URL": "http://localhost:1234/v1/embeddings",
      "LM_STUDIO_EMBEDDING_MODEL": "text-embedding-qwen3-embedding-4b",
      "MCP_ALLOWED_TABLES": "rag_mcp.documents"  // Enforced by relay
    }
  }
}
```

## Permission System

### Schema Isolation

Each recipe gets its own schema:
- Recipe ID: `rag-mcp` → Schema: `rag_mcp`
- All tables created in that schema
- MCP server can only access its own schema

### Table Whitelisting

MCP servers receive a whitelist of allowed tables via environment variable:
- `MCP_ALLOWED_TABLES`: Comma-separated list of `schema.table` (e.g., `"schema.table1,schema.table2"`)
- `permissions.allowedTables`: Array of `schema.table` strings in recipe.json
- Relay validates all SQL queries against this whitelist
- Queries accessing non-whitelisted tables are rejected
- **Multiple tables supported**: You can whitelist multiple tables from your schema
- Example: `"my_recipe.users,my_recipe.sessions,my_recipe.logs"`

### SQL Validation

Before execution, SQL is validated:
1. Check for dangerous operations (DROP, TRUNCATE on non-recipe tables)
2. Verify schema matches recipe's assigned schema
3. Ensure no access to `public` schema or other recipe schemas
4. Block system catalog access

## Developer Workflow

1. **Developer creates recipe**:
   - Creates `recipes/{id}/recipe.json` (metadata only)
   - Creates `recipes/{id}/setup.sql` (SQL to review)
   - Creates `recipes/{id}/instructions.md` (instructions to review)
   - Creates MCP server npm package

2. **Submit PR**:
   - PR includes recipe files and MCP server code
   - Maintainer reviews:
     - SQL safety (no DROP, no access to other schemas)
     - MCP server code (no unauthorized table access)
     - Instructions accuracy

3. **After approval**:
   - SQL is embedded in recipe JSON (with schema isolation)
   - Instructions are embedded in recipe JSON
   - Recipe appears in marketplace
   - MCP server is published to npm

## Relay-Level Security

The relay enforces permissions:

```javascript
function validateSQL(sql, allowedTables) {
  // Parse SQL to extract table references
  // Check all referenced tables are in allowedTables
  // Reject if accessing unauthorized tables
  // Reject dangerous operations on non-recipe tables
}
```

## MCP Server Security

MCP servers receive permissions via environment:
- `MCP_ALLOWED_TABLES`: Whitelist of accessible tables
- Relay validates all queries
- MCP server can only query whitelisted tables

