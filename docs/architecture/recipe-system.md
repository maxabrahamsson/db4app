# Recipe System Architecture

## Overview

The recipe system allows volunteers to create and contribute recipes that extend the Postgres WASM database with new capabilities. Recipes can include:
- SQL setup scripts (tables, functions, indexes)
- MCP server integrations (via npm packages)
- Setup instructions and documentation

## Recipe Structure

### Recipe JSON Schema

Apps are defined in `apps/{app-id}/recipe.json` in the community repository:

```json
{
  "id": "recipe-id",
  "name": "Recipe Name",
  "description": "Description of what this recipe does",
  "version": "1.0.0",
  "author": "Author Name",
  "category": "ai|data|integration|...",
  "tags": ["tag1", "tag2"],
  "setup": {
    "sql": "setup.sql",
    "instructions": "instructions.md"
  },
  "requirements": {
    "mcpServer": true,
    "embeddingService": "lm-studio"
  },
  "mcpServer": {
    "npmPackage": "db4app-mcp-server",
    "command": "npx",
    "args": ["db4app-mcp-server"],
    "env": {
      "MCP_RELAY_HTTP_URL": "http://localhost:8787/query",
      "LM_STUDIO_EMBEDDING_URL": "http://localhost:1234/v1/embeddings"
    }
  }
}
```

### Required Fields

- `id`: Unique identifier (used in URLs and database)
- `name`: Display name
- `description`: Brief description
- `version`: Semantic version
- `author`: Author name
- `category`: Recipe category
- `tags`: Array of tags for filtering
- `setup.sql`: Path to SQL setup file
- `setup.instructions`: Path to instructions markdown

### Optional Fields

- `requirements`: Object describing external requirements
- `mcpServer`: Configuration for MCP server npm package

## MCP Server Integration

### Creating an MCP Server Package

1. **Create package structure**:
   ```
   packages/mcp-server-{name}/
     ├── package.json
     ├── src/
     │   └── index.js
     ├── README.md
     └── LICENSE
   ```

2. **Package.json requirements**:
   - `name`: `db4app-mcp-server-{name}` (or your own scope)
   - `bin`: Entry point for CLI execution
   - `main`: Main entry point
   - `files`: What to include in npm package

3. **Configuration**:
   - All configuration via environment variables
   - Sensible defaults for local development
   - Document all env vars in README

4. **Publish to npm**:
   ```bash
   npm publish --access public
   ```

### Recipe MCP Server Configuration

When a recipe requires an MCP server, include the `mcpServer` field:

```json
{
  "mcpServer": {
    "npmPackage": "db4app-mcp-server",
    "command": "npx",
    "args": ["db4app-mcp-server"],
    "env": {
      "MCP_RELAY_HTTP_URL": "http://localhost:8787/query"
    }
  }
}
```

The UI will automatically display setup instructions for LM Studio/Claude Desktop.

## Contributing a Recipe

### Step 1: Create Recipe Files

1. Create directory: `apps/{your-app-id}/` in the community repository
2. Add `recipe.json` with metadata
3. Add `setup.sql` with SQL setup script
4. Add `instructions.md` with setup instructions

### Step 2: Create MCP Server (if needed)

1. Create npm package in `packages/mcp-server-{name}/`
2. Implement MCP server following MCP SDK patterns
3. Publish to npm
4. Reference in recipe.json

### Step 3: Submit PR

1. Fork the repository
2. Add your recipe files
3. Update `src/recipes.ts` to load your recipe (or implement dynamic loading)
4. Submit PR with:
   - Recipe files
   - MCP server package (if applicable)
   - Documentation

### Step 4: Review Process

- Recipe SQL is reviewed for safety
- MCP server code is reviewed
- Instructions are verified
- Once approved, recipe appears in marketplace

## Recipe Loading

Currently, apps are embedded in `src/recipes.ts` after review. The source files are in the `apps/` submodule from the community repository.
- CDN-hosted recipe registry
- API endpoint
- Git submodules
- npm packages with recipe metadata

## Future Enhancements

1. **Dynamic recipe discovery**: Auto-discover recipes from npm packages
2. **Recipe versioning**: Support multiple versions
3. **Recipe dependencies**: Recipes that depend on other recipes
4. **Recipe marketplace**: External recipe registry
5. **Recipe validation**: Automated testing of recipe SQL

