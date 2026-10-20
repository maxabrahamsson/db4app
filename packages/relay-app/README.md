# DB4 Self-Hosted Relay Desktop App

A Tauri desktop application that runs a local relay server so desktop Postgres clients (DBeaver, pgAdmin, TablePlus, psql) can connect to your browser-based [db4app](https://github.com/maxabrahamsson/db4app) PGlite database. All traffic stays on your machine.

## Features

- **Local relay server**: bundled sidecar that bridges Postgres TCP and the browser tab over WebSocket
- **Embedded connection view**: shows connection details from the db4app web app
- **Free and open source**: no license key or account required

## Prerequisites

- Node.js 18+
- Rust toolchain (for building the Tauri shell)
- Linux only: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

## Development

```bash
npm install
npm run build:sidecar   # builds the relay CLI into a sidecar binary
npm run tauri:dev       # run the app in development mode
```

In development the embedded view loads the web app from `http://localhost:5173`.
For production builds it defaults to `https://db4.lab4.app`. To point it at your own
deployment, set `VITE_DB4APP_URL` at build time:

```bash
VITE_DB4APP_URL=https://db4.example.com npm run tauri:build
```

## Building releases

### Locally

```bash
npm install
npm run tauri:build
```

On macOS you can target a specific architecture:

```bash
TAURI_TARGET_TRIPLE=aarch64-apple-darwin npm run tauri:build   # Apple Silicon
TAURI_TARGET_TRIPLE=x86_64-apple-darwin  npm run tauri:build   # Intel
```

Output lands in `src-tauri/target/**/release/bundle/` (`.dmg`, `.msi`/`.exe`, `.AppImage`).

### GitHub Actions

The `Build Tauri Release` workflow (`.github/workflows/build-tauri-release.yml`) builds macOS
(Apple Silicon + Intel), Windows and Linux. Run it manually from the Actions tab, or push a tag:

```bash
git tag desktop-v0.2.0
git push origin desktop-v0.2.0
```

When bumping the version, update it in `package.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml`.

### Code signing (optional)

Unsigned builds work fine; signing only removes OS warnings. The release workflow signs and
notarizes macOS builds when these repository secrets are present (Settings -> Secrets and
variables -> Actions), and skips signing otherwise:

| Secret | Description |
|--------|-------------|
| `APPLE_CERTIFICATE` | Base64-encoded "Developer ID Application" `.p12` (`base64 -i cert.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | Password set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | Identity from `security find-identity -v -p codesigning` (a SHA-1 hash also works; the workflow resolves it) |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_PASSWORD` | App-specific password for notarization (appleid.apple.com -> Security) |
| `TAURI_SIGNING_PRIVATE_KEY` | Optional Tauri updater signing key |

Never commit these values to the repository.

### Running unsigned builds

- **macOS**: remove the quarantine attribute (`xattr -cr "/Applications/DB4 Relay.app"`), or use
  System Settings -> Privacy & Security -> "Open Anyway" after the first blocked launch.
- **Windows**: SmartScreen -> "More info" -> "Run anyway".
- **Linux**: `chmod +x *.AppImage`.

## Architecture

```
relay-app/
├── src/                    # Frontend (Tauri webview)
│   ├── main.ts             # App entry point: start/stop relay, embedded view
│   └── styles.css
├── src-tauri/              # Rust backend
│   ├── src/lib.rs          # Tauri commands (start_relay, stop_relay, ...)
│   └── capabilities/       # Permission configuration
└── scripts/
    └── build-sidecar.js    # Builds the relay CLI as a sidecar
```
