# Documentation Index

## Getting started
- [README](../README.md) - what db4 is, trust model, quick start
- [CONTRIBUTING](../CONTRIBUTING.md) - development setup and PR guidelines
- [Self-hosting the relay](./self-hosting.md) - running the relay locally, in Docker, or on a server
- [Telemetry](./telemetry.md) - opt-in analytics/error reporting (off by default)

## For users
- [End-to-end encryption](./users/encryption.md) - encryption for the legacy HTTP query API
- [Recipe security for users](./users/recipe-security.md) - how your data is protected when using apps/recipes

## For developers
- [Recipe development guide](./developers/recipe-development-guide.md) - creating secure recipes
- [Multiple tables example](./developers/multiple-tables-example.md)
- [Recipe contribution guide](./architecture/recipe-contribution-guide.md) - submission and review process
- [Testing the MCP server](./developers/mcp-server-testing.md) - LM Studio / MCP client setup, version pinning
- [Community apps submodule](../README_APPS_SUBMODULE.md)
- [MCP server README](../packages/mcp-server-db4app/README.md)
- [Relay CLI README](../packages/relay-cli/README.md)
- [Load tests](../load-tests/README.md)

## Architecture & security
- [Folder structure](./architecture/folder-structure.md)
- [Postgres wire protocol over the relay](./architecture/postgres-wire-protocol.md)
- [Relay implementations compared](./architecture/relay-comparison.md) - multi-tenant relay vs local relay CLI
- [Relay security features](./architecture/relay-security-features.md) - rate limiting, connection limits
- [Recipe system](./architecture/recipe-system.md)
- [Recipe security architecture](./architecture/recipe-security.md)
- [Security summary](./architecture/security-summary.md)
- [Security policy](../SECURITY.md)

## Key concepts

- **Trust model**: the browser tab running PGlite owns the data and enforces all
  security checks; relays, proxies and MCP servers are untrusted transport.
- **Connection ID**: identifies a browser tab to the relay (SNI hostname or database name).
- **Auth token**: per-session password for Postgres clients, checked in the browser.
- **Schema isolation**: each recipe gets its own schema (e.g. `rag-mcp` -> `rag_mcp`).
