# Recipe Security Architecture Summary

## Problem Solved

1. **File Path Confusion**: Removed confusing `/recipes/{id}/instructions.md` paths
2. **Security**: Implemented schema isolation and table whitelisting
3. **Review Process**: All content embedded after maintainer review

## Architecture

### Recipe Lifecycle

1. **Developer** creates recipe files in `recipes/{id}/`
2. **PR submitted** with recipe files and MCP server
3. **Maintainer reviews**:
   - SQL safety (schema isolation, no dangerous ops)
   - MCP server code (no unauthorized access)
   - Instructions accuracy
4. **After approval**: SQL and instructions embedded in `src/recipes.ts`
5. **Recipe appears** in marketplace with embedded content

### Security Model

#### Schema Isolation
- Each recipe gets its own schema: `{recipe_id}` → `{recipe_schema}`
- Example: `rag-mcp` → `rag_mcp` schema
- All tables/functions created in that schema
- No access to `public` or other recipe schemas

#### Table Whitelisting
- `permissions.allowedTables`: Array of `"schema.table"` strings
- MCP server receives whitelist via `MCP_ALLOWED_TABLES` env var
- Relay validates all SQL queries against whitelist
- Queries accessing non-whitelisted tables are rejected (403)

#### SQL Validation
Relay validates:
- Table references match whitelist
- Dangerous operations (DROP, TRUNCATE) only on allowed tables
- No access to system catalogs (except metadata queries)

### Permission Enforcement

> **Trust model:** the browser tab running PGlite is the authoritative owner of the data.
> Checks that matter must be enforced in the browser (see `src/utils/queryGuard.ts` and the
> Postgres shim). The relay-level validation described below belongs to the legacy HTTP
> `/query` API and is defense-in-depth only - the relay is untrusted transport.

**Relay Level** (`server/index.js`):
- Validates SQL before execution
- Checks table references against `allowedTables`
- Rejects unauthorized queries

**MCP Server Level** (`packages/mcp-server-db4app/src/index.js`):
- Reads `MCP_ALLOWED_TABLES` from environment
- Sends whitelist to relay for validation
- `list_tables` only shows whitelisted tables

### Recipe Schema

```typescript
interface Recipe {
  id: string
  schema: string  // Isolated schema name
  setup: {
    sql: string  // Embedded after review
    instructions: string  // Embedded after review
  }
  permissions: {
    allowedTables: string[]  // Whitelist
    allowedSchemas: string[]  // Schema isolation
    readOnly?: boolean
  }
  mcpServer?: {
    npmPackage: string
    env: {
      MCP_ALLOWED_TABLES: string  // Comma-separated
    }
  }
}
```

## User Experience

- **No confusing paths**: Instructions embedded and displayed inline
- **Clear security**: Users see which tables MCP can access
- **Copy-paste ready**: mcp.json config shown directly
- **Schema awareness**: Users understand data isolation

## Developer Experience

- **Clear workflow**: Create files → PR → Review → Embed
- **Security enforced**: Can't accidentally access other data
- **Reviewable**: All SQL and instructions visible in PR

## Maintainer Experience

- **Full control**: Review all SQL before embedding
- **Security audit**: Verify schema isolation and permissions
- **Strict enforcement**: Browser-side guards validate queries (relay checks are defense-in-depth only)

## Future Enhancements

1. **SQL Parser**: Replace regex with proper SQL parser for better validation
2. **Row-Level Security**: Use Postgres RLS for additional protection
3. **Audit Logging**: Log all MCP queries for security monitoring
4. **Recipe Versioning**: Support multiple versions of recipes
5. **Dynamic Loading**: Load recipes from CDN (but still embed after review)

