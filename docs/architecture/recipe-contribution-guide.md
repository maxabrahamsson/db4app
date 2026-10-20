# Recipe Contribution Guide

## Overview

This guide explains how developers can contribute recipes to the db4 app marketplace. All recipes go through a security review before being displayed to users.

## Developer Workflow

### Step 1: Create Recipe Files

Create a new directory: `apps/{your-app-id}/` in the community repository

Required files:

1. **`recipe.json`** - Metadata only (no SQL or instructions):
```json
{
  "id": "your-recipe-id",
  "name": "Your Recipe Name",
  "description": "What this recipe does",
  "version": "1.0.0",
  "author": "Your Name",
  "category": "ai|data|integration|...",
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
      "MCP_ALLOWED_TABLES": "your_recipe.table1,your_recipe.table2"
    }
  },
  "permissions": {
    "allowedTables": ["your_recipe.table1", "your_recipe.table2"],
    "allowedSchemas": ["your_recipe"],
    "readOnly": false
  }
}
```

2. **`setup.sql`** - SQL to be reviewed:
   - Must create its own schema: `CREATE SCHEMA IF NOT EXISTS {recipe_schema};`
   - All tables/functions must be in that schema
   - No access to `public` schema or other recipe schemas
   - No DROP/TRUNCATE on non-recipe tables

3. **`instructions.md`** - Setup instructions (markdown)

### Step 2: Create MCP Server (if needed)

1. Create npm package following the pattern in `packages/mcp-server-db4app/`
2. Publish to npm
3. Reference in `recipe.json`

### Step 3: Submit PR

1. Fork the repository
2. Add your recipe files to `recipes/{id}/`
3. Submit PR with:
   - Recipe files
   - MCP server package link (if applicable)
   - Brief description

## Review Process

Maintainer reviews:

1. **SQL Safety**:
   - ✅ Creates isolated schema
   - ✅ No access to other schemas
   - ✅ No dangerous operations on user tables
   - ✅ SQL is safe and tested

2. **MCP Server Security**:
   - ✅ Code review of MCP server
   - ✅ Only accesses whitelisted tables
   - ✅ No unauthorized data access

3. **Instructions**:
   - ✅ Clear and accurate
   - ✅ Includes security notes
   - ✅ Proper mcp.json format

4. **Permissions**:
   - ✅ `permissions.allowedTables` is minimal
   - ✅ `permissions.allowedSchemas` is isolated

## After Approval

Once approved:
1. Maintainer embeds SQL and instructions in `src/recipes.ts`
2. Recipe appears in marketplace
3. MCP server is published to npm (if not already)

## Security Requirements

### Schema Isolation

Every recipe MUST:
- Create its own schema: `CREATE SCHEMA IF NOT EXISTS {recipe_schema};`
- Use schema prefix for all objects: `{schema}.table`, `{schema}.function`
- Never access `public` schema or other recipe schemas

### Table Whitelisting

MCP servers MUST:
- Only access tables in `permissions.allowedTables`
- Receive whitelist via `MCP_ALLOWED_TABLES` environment variable
- Relay validates all queries against whitelist

### SQL Restrictions

Blocked operations:
- `DROP` on non-recipe tables
- `TRUNCATE` on non-recipe tables
- `ALTER` on non-recipe tables
- Access to `pg_catalog`, `information_schema` (except for metadata queries)

## Example Recipe Structure

```
recipes/my-recipe/
├── recipe.json          # Metadata (reviewed)
├── setup.sql            # SQL (reviewed, then embedded)
└── instructions.md      # Instructions (reviewed, then embedded)
```

After review, content is embedded in `src/recipes.ts` as `CURATED_RECIPES`.

