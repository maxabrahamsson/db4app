# GitHub Actions Workflows

## Publish to npm

Automatically publishes the package to npm when code is merged to the `main` branch using **npm Trusted Publishing** (GitHub OIDC).

### Setup Required

**Enable Trusted Publishing on npm:**

1. **Go to npm package settings:**
   - Visit: https://www.npmjs.com/package/db4app-mcp-server/settings
   - Or: https://www.npmjs.com/settings/YOUR_USERNAME/packages (if package doesn't exist yet)

2. **Enable Trusted Publishing:**
   - Click on "Automation" or "Trusted Publishing" tab
   - Click "Add GitHub Actions workflow"
   - Select repository: `maxabrahamsson/rag-db4app`
   - Select workflow file: `.github/workflows/publish.yml`
   - Click "Approve"

3. **That's it!** No secrets needed. The workflow uses GitHub OIDC for authentication.

### How It Works

1. **Trigger:** Runs on every push to `main` branch (or manual trigger)
2. **Authentication:** Uses GitHub OIDC (no tokens required)
3. **Build:** Installs dependencies and builds the package
4. **Verify:** Checks package contents with `npm pack --dry-run`
5. **Check Version:** Verifies if the version already exists on npm
6. **Publish:** Publishes to npm if version is new (with provenance)
7. **Release:** Creates a GitHub release with the version tag

### Version Management

**Important:** The workflow will skip publishing if the version in `package.json` already exists on npm. To publish a new version:

1. Update `version` in `package.json` (e.g., `0.1.9` → `0.1.10`)
2. Commit and push to `main`
3. The workflow will automatically publish the new version

### Manual Trigger

You can also manually trigger the workflow:
- Go to Actions tab → "Publish to npm" → "Run workflow"

### Security Benefits

- ✅ **No secrets to manage** - Uses GitHub OIDC
- ✅ **Provenance** - Package includes build provenance
- ✅ **Automatic** - No manual token rotation needed
- ✅ **Secure** - npm verifies the workflow identity
