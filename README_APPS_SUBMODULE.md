# Community Apps Submodule

The `apps/` folder is a git submodule that syncs community-contributed apps from the public repository:

**Repository**: https://github.com/maxabrahamsson/db4app-community-apps

## Purpose

Community members contribute apps (formerly called "recipes") to that repository; this repository pulls in approved apps via the git submodule.

## Structure

```
apps/
└── {app-id}/
    ├── recipe.json      # App metadata
    ├── setup.sql        # SQL setup script
    └── instructions.md # Setup instructions
```

## Workflow

1. **Community Contribution**: Developer creates app in community repository
2. **PR Review**: Submit PR to https://github.com/maxabrahamsson/db4app-community-apps
3. **Approval**: Maintainer reviews and merges PR
4. **Sync**: Maintainer updates submodule in main repository:
   ```bash
   git submodule update --remote apps
   git add apps
   git commit -m "Sync community apps"
   ```
5. **Embed**: Content is embedded in `src/recipes.ts` for the main app
6. **Release**: App appears in the in-app marketplace

## Updating the Submodule

To sync the latest changes from the community repository:

```bash
# Update submodule to latest from remote
git submodule update --remote apps

# Commit the update
git add apps
git commit -m "Sync community apps from latest main branch"
git push
```

## Cloning the Repository

When cloning the main repository, initialize submodules:

```bash
# Clone with submodules
git clone --recurse-submodules https://github.com/maxabrahamsson/db4app.git

# Or if already cloned, initialize submodules
git submodule update --init --recursive
```

## Adding a New App

1. Go to https://github.com/maxabrahamsson/db4app-community-apps
2. Create a new folder: `apps/{your-app-id}/`
3. Add files:
   - `recipe.json` - App metadata
   - `setup.sql` - SQL setup script
   - `instructions.md` - Setup instructions
4. Submit PR for review
5. After merge, maintainer will sync submodule and embed in main app

