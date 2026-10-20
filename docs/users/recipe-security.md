# Recipe Security for Users

## How We Protect Your Data

When you install recipes from the marketplace, your data is protected through multiple security layers.

## Schema Isolation

**Each recipe operates in its own isolated schema.**

- Recipe `rag-mcp` uses schema `rag_mcp`
- Recipe `my-recipe` uses schema `my_recipe`
- Your user tables in `public` schema are separate

This means:
- ✅ Recipe tables can't accidentally conflict with your data
- ✅ Recipes can't access your tables in other schemas
- ✅ You can safely uninstall recipes without affecting your data

## Table Whitelisting

**MCP servers can only access tables they're explicitly allowed to use.**

When a recipe includes an MCP server:
- The recipe defines which tables the MCP can access
- This whitelist is enforced by the relay server
- Any attempt to access non-whitelisted tables is blocked

Example:
- RAG recipe MCP can only access `rag_mcp.documents`
- It cannot access your `todos` table or any other user tables
- All SQL queries are validated before execution

## Security Enforcement

### Relay-Level Validation

The relay server validates every SQL query:
- Checks table references against the whitelist
- Blocks queries accessing unauthorized tables
- Prevents dangerous operations on your data

### MCP Server Restrictions

MCP servers:
- Only receive whitelist of allowed tables
- Can only query tables in their whitelist
- Cannot see or access your other tables

## What This Means for You

### ✅ Safe to Install

- Recipes are reviewed before appearing in marketplace
- Each recipe is isolated in its own schema
- MCP servers have minimal, explicit permissions

### ✅ Your Data is Protected

- Recipes cannot access your user tables
- MCP servers can only access their own recipe tables
- All queries are validated and blocked if unauthorized

### ✅ Easy to Uninstall

- Uninstalling a recipe only affects its own schema
- Your data in other schemas remains untouched
- You can safely experiment with recipes

## How to Verify

When you install a recipe:
1. Check the "Permissions" section (if shown)
2. Review which tables the MCP server can access
3. Verify it only lists tables in the recipe's schema

Example RAG recipe permissions:
- Allowed tables: `rag_mcp.documents` ✅
- Cannot access: `public.todos`, `public.*`, or any other tables ✅

## Reporting Issues

If you notice any security concerns:
1. Check the recipe's permissions
2. Verify it only accesses its own schema
3. Report any suspicious behavior

## Technical Details

For developers: See `docs/architecture/recipe-security.md`

For users: This page explains the security model in plain language.

