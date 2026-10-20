# CLAUDE.md — db4 project guidance

## Core Principles

### Browser tab is the ground-truth owner of the data

The browser tab running PGlite is the authoritative owner of the user's data. All security checks, constraints, and access controls must be enforced at the browser tab level and governed/controlled by the user — not at the relay, proxy, or MCP server layer. The relay and MCP server are untrusted transport; the browser is the trust boundary.
