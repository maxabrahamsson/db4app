# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report vulnerabilities privately via GitHub Security Advisories:
https://github.com/maxabrahamsson/db4app/security/advisories/new

Include a description, affected component (web app, relay, client SDK, MCP server,
desktop app), reproduction steps and impact. You should receive a response within a
reasonable time; please allow time for a fix before public disclosure.

## Trust model

- **The browser tab running PGlite is the authoritative owner of the data.** All
  security checks, constraints and access controls are enforced in the browser tab
  and are under the user's control.
- **The relay, proxies and MCP servers are untrusted transport.** They forward
  Postgres wire protocol traffic. A compromised relay must not be able to bypass
  authentication or access controls enforced by the browser. Note that a relay that
  terminates TLS can observe query traffic, so run a relay you trust or operate.
- The per-session auth token (shown on the Database page) is the credential for
  Postgres clients; treat it like a database password.

Issues that are especially relevant:

- Bypassing browser-side authentication or query guards
- One connection ID reaching another tab's database through the relay
- Leaking auth tokens or data through the relay, logs or telemetry
- Malicious community apps escaping schema isolation

## Supported versions

Only the latest `main` branch is supported. The former hosted instance has been
shut down; there is no hosted service in scope.
