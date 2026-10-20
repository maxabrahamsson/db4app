import type { CommunityApp } from '../recipes'

// Load apps dynamically from the public/apps/apps folder at runtime
export async function loadAppsFromFolder(): Promise<CommunityApp[]> {
  const apps: CommunityApp[] = []

  try {
    // Try to fetch a manifest file first (if it exists in the future)
    // For now, we'll try to discover apps by attempting to fetch known app IDs
    // In production, we could maintain a manifest.json file
    
    // Known app IDs - these should match the folder names in apps/apps/
    // In the future, we could fetch a manifest.json that lists all available apps
    const appIds = ['rag-mcp', 'sample-todo', 'todo-mcp']
    
    const appPromises = appIds.map(async (appId) => {
      try {
        // Fetch recipe.json
        const recipeResponse = await fetch(`/apps/apps/${appId}/recipe.json`)
        if (!recipeResponse.ok) {
          return null
        }
        
        const recipeData = await recipeResponse.json()
        
        // Fetch setup.sql
        const sqlResponse = await fetch(`/apps/apps/${appId}/setup.sql`)
        const sql = sqlResponse.ok ? await sqlResponse.text() : ''
        
        // Fetch instructions.md
        const instructionsResponse = await fetch(`/apps/apps/${appId}/instructions.md`)
        const instructions = instructionsResponse.ok ? await instructionsResponse.text() : ''

        // Convert recipe.json format to CommunityApp format
        const app: CommunityApp = {
          id: recipeData.id || appId,
          name: recipeData.name || appId,
          description: recipeData.description || '',
          version: recipeData.version || '1.0.0',
          author: recipeData.author || 'community',
          category: recipeData.category || 'other',
          tags: recipeData.tags || [],
          schema: recipeData.schema || appId,
          setup: {
            sql,
            instructions,
          },
          permissions: recipeData.permissions || {
            allowedTables: [],
            allowedSchemas: [],
            readOnly: false,
          },
          requirements: recipeData.requirements,
          mcpServer: recipeData.mcpServer ? {
            npmPackage: recipeData.mcpServer.npmPackage,
            command: recipeData.mcpServer.command || 'npx',
            args: recipeData.mcpServer.args || [],
            env: recipeData.mcpServer.env || {},
            notes: recipeData.mcpServer.notes,
          } : undefined,
        }

        return app
      } catch (error) {
        console.warn(`Failed to load app ${appId}:`, error)
        return null
      }
    })

    const loadedApps = await Promise.all(appPromises)
    apps.push(...loadedApps.filter((app): app is CommunityApp => app !== null))
  } catch (error) {
    console.error('Failed to load apps from folder:', error)
  }

  return apps
}

