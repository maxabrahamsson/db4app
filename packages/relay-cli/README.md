# db4app-relay-local

**Self-hosted relay server for [db4app](https://github.com/maxabrahamsson/db4app)** - Connect desktop Postgres clients to your browser-based database.

This CLI allows you to host a Postgres relay on your own computer, enabling connections from desktop applications (like DBeaver, pgAdmin, TablePlus, or psql) to your browser-based db4app database. Everything stays on your machine.

## Why Use This?

- **Privacy**: All traffic stays on your machine
- **Speed**: No round-trip to a remote relay server
- **Offline**: Works without internet (after initial page load)
- **Development**: Perfect for development workflows

## Quick Start

```bash
# Run the self-hosted relay (requires Node.js 18+)
npx db4app-relay-local
```

This starts:
- HTTP/WebSocket server on `http://localhost:8787`
- Postgres TCP server on `localhost:5432`

## Configuration

```bash
# Custom ports
npx db4app-relay-local --http-port 9000 --pg-port 5433

# Bind to all interfaces (for network access)
npx db4app-relay-local --host 0.0.0.0

# Point links at a locally running web app instead of https://db4.lab4.app
npx db4app-relay-local --app-url http://localhost:5173

# Show help
npx db4app-relay-local --help
```

## How to Connect

### Step 1: Start the Self-Hosted Relay

```bash
npx db4app-relay-local
```

### Step 2: Configure db4app to Use the Self-Hosted Relay

1. Open the db4app web app's `/database` page in your browser ([db4.lab4.app/database](https://db4.lab4.app/database), or `http://localhost:5173/database` if you run it locally)
2. Find the **"Relay server"** section
3. Select **"Self-hosted"** from the dropdown
4. The default URL (`ws://localhost:8787/agent`) will be pre-filled

That's it! Your browser is now configured to use your self-hosted relay.

### Step 3: Connect Your Desktop App

Use the connection string shown on the landing page. It will look like:

```
postgres://postgres:YOUR_AUTH_TOKEN@localhost:5432
```

**psql:**
```bash
psql "postgres://postgres:YOUR_AUTH_TOKEN@localhost:5432"
```

**DBeaver:**
- Host: `localhost`
- Port: `5432`
- Database: `postgres`
- Username: `postgres`
- Password: `YOUR_AUTH_TOKEN`

**TablePlus:**
- Connection URL: `postgres://postgres:YOUR_AUTH_TOKEN@localhost:5432`

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Desktop App    │────▶│ Self-Hosted     │────▶│    Browser      │
│  (DBeaver,etc)  │     │    Relay        │     │   (db4app)      │
│                 │◀────│                 │◀────│   + PGlite      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
     TCP 5432           WS localhost:8787           PGlite WASM
```

The self-hosted relay:
1. Accepts Postgres TCP connections on port 5432
2. Forwards Postgres wire protocol messages to the browser via WebSocket
3. Browser's PGlite (Postgres in WASM) executes queries
4. Results flow back through the same path

## Troubleshooting

### "Browser connection not available"

The browser tab with db4app is not connected. Make sure:
1. db4app is open in your browser
2. You've selected "Self-hosted" in the /database settings
3. The page has loaded completely (check the status indicator)

### Port already in use

Use different ports:
```bash
npx db4app-relay-local --http-port 9000 --pg-port 5433
```

### Connection timeout

Make sure:
1. The self-hosted relay is running
2. Browser tab is active (not suspended)
3. Firewall isn't blocking localhost connections

## License

MIT
