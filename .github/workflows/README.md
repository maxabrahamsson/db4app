# GitHub Actions Workflows

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `publish-relay-docker.yml` | Push to `main` touching `server/`, `Dockerfile`, `package*.json`; manual | Builds the relay image and pushes it to `ghcr.io/<owner>/db4app-relay` (`latest` + `sha-<commit>`). |
| `build-tauri-release.yml` | Tag `desktop-v*`; manual | Builds the desktop relay app (`packages/relay-app`) for macOS and creates a draft GitHub release. Signing/notarization run only if the Apple secrets are configured; otherwise the build is unsigned. |
| `sync-apps-submodule.yml` | Push to `main`; manual; `repository_dispatch` (`community-apps-updated`) | Updates the `apps/` submodule to the latest commit of the community apps repo and commits the bump. |

## Optional secrets for `build-tauri-release.yml`

`APPLE_CERTIFICATE` (base64 .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_TEAM_ID`, `APPLE_ID`, `APPLE_PASSWORD`, `TAURI_SIGNING_PRIVATE_KEY`.

## Triggering the submodule sync from the community apps repo

Add a workflow to the community apps repository that sends a `repository_dispatch`
event to this repository on push to `main`:

```yaml
name: Notify Main Repo
on:
  push:
    branches: [main]
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: peter-evans/repository-dispatch@v2
        with:
          token: ${{ secrets.MAIN_REPO_TOKEN }}   # PAT with access to this repo
          repository: maxabrahamsson/db4app
          event-type: community-apps-updated
```

Manual alternative:

```bash
git submodule update --remote apps
git add apps
git commit -m "chore: sync apps submodule"
```
