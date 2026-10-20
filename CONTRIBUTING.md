# Contributing to db4

Thanks for your interest in contributing!

## Development setup

Requirements: Node.js 20+, npm, git. (Rust + Tauri prerequisites only if you work on
`packages/relay-app`.)

```bash
git clone --recurse-submodules https://github.com/maxabrahamsson/db4app.git
cd db4app
# if you cloned without --recurse-submodules:
git submodule update --init

npm install

# terminal 1: relay (HTTP/WebSocket :8787, Postgres :6543)
npm run relay

# terminal 2: web app (http://localhost:5173)
npm run dev
```

Open http://localhost:5173, wait for the database to start and the relay to show as
connected, then connect a client using the connection ID and auth token from the
Database page:

```bash
psql "postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID"
```

Other useful commands:

| Command | Purpose |
|---------|---------|
| `npm run build` | Build the client SDK and the web app |
| `npm run lint` | ESLint |
| `npm run build:mcp` | Build `packages/mcp-server-db4app` |
| `npm run test:load:websocket:local` | Relay load test against localhost (needs Artillery) |

Optional configuration lives in `.env.local` (see `.env.example`); telemetry is off
unless you set the variables in [docs/telemetry.md](docs/telemetry.md).

## Architecture ground rule

**The browser tab running PGlite is the ground-truth owner of the data.** All
security checks, constraints and access controls must be enforced in the browser
tab and be controllable by the user - not in the relay, proxy, or MCP server, which
are untrusted transport. PRs that move enforcement into the relay will not be
accepted (defense-in-depth checks there are fine in addition).

## Pull requests

1. Open an issue first for larger changes so we can agree on the approach.
2. Branch from `main`, keep PRs focused, and describe what and why.
3. Run `npm run lint` and `npm run build` before submitting.
4. Test the relevant flow manually (e.g. web app + relay + `psql`) and say how you
   tested it in the PR.
5. Update docs in `docs/` when behaviour or configuration changes.
6. Never commit secrets, `.env*` files (other than `.env.example`), or database
   files (`pgdata/`).

## Community apps (recipes)

Apps live in the [db4app-community-apps](https://github.com/maxabrahamsson/db4app-community-apps)
repository, included here as the `apps/` submodule. See
[docs/developers/recipe-development-guide.md](docs/developers/recipe-development-guide.md)
and [README_APPS_SUBMODULE.md](README_APPS_SUBMODULE.md).

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
