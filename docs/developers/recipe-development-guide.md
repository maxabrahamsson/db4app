# Recipe Development Guide

Welcome! This guide will help you create secure, reviewable recipes for the db4 app marketplace.

## Overview

Recipes extend the browser-based Postgres database with new capabilities. Each recipe:
- Creates isolated database objects in its own schema
- Can include an MCP server for LLM integration
- Goes through security review before appearing in the marketplace
- Has embedded SQL and instructions (reviewed and approved)

## Quick Start

### 1. Create Recipe Structure

```bash
# In the community apps repository
mkdir -p apps/my-app
cd apps/my-app
```

Create three files:
- `recipe.json` - Metadata
- `setup.sql` - SQL to be reviewed
- `instructions.md` - Setup instructions

### 2. Recipe Metadata (`recipe.json`)

```json
{
  "id": "my-recipe",
  "name": "My Recipe",
  "description": "What this recipe does",
  "version": "1.0.0",
  "author": "Your Name",
  "category": "ai",
  "tags": ["tag1", "tag2"],
  "setup": {
    "sql": "setup.sql",
    "instructions": "instructions.md"
  },
  "requirements": {
    "mcpServer": true
  },
  "mcpServer": {
    "npmPackage": "@your-scope/mcp-server-name",
    "command": "npx",
    "args": ["-y", "@your-scope/mcp-server-name"],
    "env": {
      "MCP_RELAY_HTTP_URL": "http://localhost:8787/query",
      "MCP_ALLOWED_TABLES": "my_recipe.table1,my_recipe.table2"
    }
  },
  "permissions": {
    "allowedTables": ["my_recipe.table1", "my_recipe.table2"],
    "allowedSchemas": ["my_recipe"],
    "readOnly": false
  }
}
```

**Important**: The `setup.sql` and `instructions.md` references are for review only. After approval, content is embedded in the app.

### 3. SQL Setup (`setup.sql`)

**CRITICAL SECURITY RULES**:

1. **Always create your own schema**:
```sql
CREATE SCHEMA IF NOT EXISTS my_recipe;
```

2. **All objects must be in your schema**:
```sql
CREATE TABLE my_recipe.my_table (...);
CREATE FUNCTION my_recipe.my_function(...) ...;
```

3. **Never access other schemas**:
```sql
-- ❌ BAD - accessing public schema
CREATE TABLE public.something (...);

-- ✅ GOOD - using your own schema
CREATE TABLE my_recipe.something (...);
```

4. **No dangerous operations on user tables**:
```sql
-- ❌ BAD - can't drop user tables
DROP TABLE public.todos;

-- ✅ GOOD - only your own schema
DROP SCHEMA IF EXISTS my_recipe CASCADE;
```

5. **Example complete setup**:
```sql
-- Create isolated schema
CREATE SCHEMA IF NOT EXISTS my_recipe;

-- Create tables in your schema
CREATE TABLE IF NOT EXISTS my_recipe.data (
  id serial PRIMARY KEY,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create functions in your schema
CREATE OR REPLACE FUNCTION my_recipe.process_data(data_id int)
RETURNS text AS $$
  SELECT content FROM my_recipe.data WHERE id = data_id;
$$ LANGUAGE sql;
```

### 4. Instructions (`instructions.md`)

Write clear, user-friendly instructions:

```markdown
# My Recipe - Setup Instructions

## What This Recipe Installs

- `my_recipe` schema (isolated from other recipes)
- `data` table for storing...
- `process_data()` function for...

## MCP Server Setup

[Include mcp.json configuration with MCP_ALLOWED_TABLES]

## Security Note

This recipe operates in an isolated schema (`my_recipe`) and can only access its own tables. Your other data remains secure.
```

### 5. MCP Server (Optional)

If your recipe needs an MCP server:

1. **Create npm package**:
```bash
mkdir packages/mcp-server-my-recipe
cd packages/mcp-server-my-recipe
npm init
```

2. **Structure**:
```
packages/mcp-server-my-recipe/
├── package.json
├── src/
│   └── index.js
└── README.md
```

3. **Read permissions from environment**:
```javascript
// MCP_ALLOWED_TABLES is comma-separated: "schema.table1,schema.table2"
const allowedTables = process.env.MCP_ALLOWED_TABLES
  ? process.env.MCP_ALLOWED_TABLES.split(',').map(t => t.trim())
  : []

// Extract schema from first table (all tables should be in same schema)
const schema = allowedTables.length > 0 && allowedTables[0].includes('.')
  ? allowedTables[0].split('.')[0]
  : 'public'

// All queries must use schema prefix
// For single table:
const sql = `SELECT * FROM ${schema}.my_table`

// For multiple tables (JOIN example):
const sql = `
  SELECT t1.*, t2.*
  FROM ${schema}.table1 t1
  JOIN ${schema}.table2 t2 ON t1.id = t2.table1_id
`

// Always validate: ensure all referenced tables are in allowedTables
// The relay will reject queries accessing non-whitelisted tables
```

4. **Send whitelist to relay**:
```javascript
const response = await fetch(relayUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    sql,
    params,
    allowedTables  // Relay validates against this
  })
})
```

5. **Publish to npm**:
```bash
npm publish --access public
```

## Security Requirements

### Schema Isolation

- ✅ Create your own schema: `CREATE SCHEMA IF NOT EXISTS {recipe_schema};`
- ✅ Use schema prefix for all objects
- ❌ Never access `public` schema
- ❌ Never access other recipe schemas

### Table Whitelisting

- ✅ Define `permissions.allowedTables` as an array in recipe.json
- ✅ Set `MCP_ALLOWED_TABLES` as comma-separated string in mcpServer.env
- ✅ MCP server can access multiple tables (all must be in your schema)
- ✅ Example: `["my_recipe.users", "my_recipe.sessions", "my_recipe.logs"]`
- ✅ Environment: `"my_recipe.users,my_recipe.sessions,my_recipe.logs"`
- ✅ MCP server only accesses whitelisted tables
- ❌ No access to user tables outside your schema

### SQL Safety

- ✅ Only CREATE/INSERT/UPDATE in your schema
- ✅ Use IF NOT EXISTS to avoid conflicts
- ❌ No DROP/TRUNCATE on user tables
- ❌ No ALTER on user tables
- ❌ No access to system catalogs (except metadata queries)

## Submission Process

1. **Fork the repository**
2. **Create your app** in `apps/{your-app-id}/` in the community repository
3. **Create MCP server** (if needed) and publish to npm
4. **Submit PR** with:
   - Recipe files
   - Link to MCP server npm package
   - Brief description

## Review Checklist

Maintainers will review:

- [ ] SQL creates isolated schema
- [ ] All objects use schema prefix
- [ ] No access to other schemas
- [ ] No dangerous operations on user tables
- [ ] MCP server code reviewed
- [ ] MCP server respects table whitelist
- [ ] Instructions are clear and accurate
- [ ] Permissions are minimal (principle of least privilege)

## After Approval

Once approved:
1. Maintainer embeds SQL and instructions in `src/recipes.ts`
2. Recipe appears in marketplace
3. Users can install it safely

## Example: RAG Recipe

See `apps/rag-mcp/` in the community repository for a complete example:
- Schema isolation (`rag_mcp` schema)
- Table whitelisting (`rag_mcp.documents`)
- MCP server with permissions
- Clear instructions

## Example: Multiple Tables

See `docs/developers/multiple-tables-example.md` for a complete example of a recipe that uses multiple tables:
- User session management with users, sessions, and logs tables
- JOINing multiple whitelisted tables
- Proper permission configuration

## Questions?

- Check existing recipes for patterns
- Review `docs/architecture/recipe-security.md`
- Open an issue for questions

## Best Practices

1. **Minimal permissions**: Only request access to tables you need
2. **Clear documentation**: Users should understand what they're installing
3. **Error handling**: MCP servers should handle errors gracefully
4. **Schema naming**: Use `{recipe_id}` → `{recipe_schema}` pattern
5. **Versioning**: Use semantic versioning for recipe updates

