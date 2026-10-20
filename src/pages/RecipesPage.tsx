import { useCallback, useEffect, useState } from 'react'
import { useDb } from '../contexts/DbContext'
import { useRelay } from '../contexts/RelayContext'
import {
  listApps,
  installApp,
  uninstallApp,
  getInstalledApps,
  type CommunityApp,
  type InstalledApp,
} from '../recipes'
import { trackPageView, trackRecipeInstall, trackRecipeUninstall } from '../utils/analytics'
import '../App.css'
import { replaceConnectionPlaceholders } from '../utils/connectionStrings'

export function RecipesPage() {
  const { db, updateLastAccessTime } = useDb()
  const { connectionId, authToken } = useRelay()
  const [apps, setApps] = useState<CommunityApp[]>([])
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([])
  const [appsLoading, setAppsLoading] = useState(false)
  const [appError, setAppError] = useState<string | null>(null)
  const [showAppInstructions, setShowAppInstructions] = useState<string | null>(null)

  // Replace placeholders in text with actual values
  const replacePlaceholders = useCallback((text: string): string => {
    if (!text) return text
    
    const replaced = replaceConnectionPlaceholders(text, connectionId, authToken)
    return replaced
  }, [connectionId, authToken])

  // Generate MCP server config with placeholders replaced
  const generateMCPConfig = useCallback((app: CommunityApp) => {
    if (!app.mcpServer) return null
    
    const env: Record<string, string> = {}
    if (app.mcpServer.env) {
      for (const [key, value] of Object.entries(app.mcpServer.env)) {
        if (typeof value === 'string') {
          // Replace Postgres URL with actual values
          env[key] = replaceConnectionPlaceholders(value, connectionId, authToken)
        } else {
          env[key] = value
        }
      }
    }
    
    return {
      mcpServers: {
        [app.id]: {
          command: app.mcpServer.command,
          args: app.mcpServer.args,
          env,
        },
      },
    }
  }, [connectionId, authToken])

  // Track page view
  useEffect(() => {
    trackPageView('community-apps')
  }, [])

  // Load apps and installed apps
  useEffect(() => {
    if (!db) return

    let cancelled = false

    const loadApps = async () => {
      setAppsLoading(true)
      setAppError(null)
      try {
        const [availableApps, installed] = await Promise.all([
          listApps(),
          getInstalledApps(db),
        ])
        if (!cancelled) {
          setApps(availableApps)
          setInstalledApps(installed)
        }
      } catch (err) {
        if (!cancelled) {
          setAppError(err instanceof Error ? err.message : 'Failed to load community apps')
          console.error('Failed to load community apps:', err)
        }
      } finally {
        if (!cancelled) {
          setAppsLoading(false)
        }
      }
    }

    void loadApps()

    return () => {
      cancelled = true
    }
  }, [db])

  const handleInstallApp = useCallback(
    async (app: CommunityApp) => {
      if (!db) return
      setAppsLoading(true)
      setAppError(null)
      updateLastAccessTime()

      try {
        await installApp(db, app)
        const installed = await getInstalledApps(db)
        setInstalledApps(installed)
        setAppError(null)

        // Track app installation
        trackRecipeInstall(app.id, app.name)
      } catch (err) {
        setAppError(err instanceof Error ? err.message : 'Failed to install app')
      } finally {
        setAppsLoading(false)
      }
    },
    [db, updateLastAccessTime],
  )

  const handleUninstallApp = useCallback(
    async (appId: string) => {
      if (!db) return
      setAppsLoading(true)
      setAppError(null)
      updateLastAccessTime()

      try {
        const app = apps.find((a) => a.id === appId)
        await uninstallApp(db, appId)
        const installed = await getInstalledApps(db)
        setInstalledApps(installed)
        setAppError(null)

        // Track app uninstallation
        trackRecipeUninstall(appId, app?.name || appId)
      } catch (err) {
        setAppError(err instanceof Error ? err.message : 'Failed to uninstall app')
      } finally {
        setAppsLoading(false)
      }
    },
    [db, updateLastAccessTime, apps],
  )

  if (!db) {
    return (
      <main className="landing">
        <div className="section-heading">
          <p className="eyebrow">Community Apps</p>
          <h2>Loading database…</h2>
          <p>Initializing Postgres WebAssembly bundle…</p>
        </div>
      </main>
    )
  }

  return (
    <main className="landing">
      <section className="recipes" id="recipes">
        <div className="section-heading">
          <p className="eyebrow">Community Apps Marketplace</p>
          <h2>Extend your database with plug-and-play community apps.</h2>
          <p>
            Install community apps to add new capabilities like RAG, vector search, or custom integrations.
            Each app sets up the necessary tables, functions, and provides setup instructions.
          </p>
        </div>
        <div className="security-notice">
          <div className="security-notice-header">
            <strong>🔒 Security & Data Protection</strong>
          </div>
          <div className="security-notice-content">
            <p>
              All apps operate in <strong>isolated schemas</strong> and cannot access your other tables.
              MCP servers are restricted to only the tables explicitly whitelisted in each app.
              All SQL queries from MCP servers are validated by the relay service before execution.
              For direct Postgres connections, use the standard Postgres TCP protocol.
            </p>
            <p className="fine-print">
              <a href="/docs/users/recipe-security" target="_blank" rel="noopener noreferrer">
                Learn more about app security →
              </a>
            </p>
          </div>
        </div>
        {appError && (
          <div className="status-error" style={{ marginBottom: '1rem' }}>
            {appError}
          </div>
        )}
        <div className="recipe-grid">
          {appsLoading ? (
            <p className="muted">Loading community apps…</p>
          ) : apps.length === 0 ? (
            <p className="muted">No community apps available.</p>
          ) : (
            apps.map((app) => {
              const isInstalled = installedApps.some((a) => a.appId === app.id)
              return (
                <article key={app.id} className="recipe-card">
                  <header>
                    <div>
                      <h3>{app.name}</h3>
                      <p className="muted fine-print">
                        v{app.version} by {app.author}
                      </p>
                    </div>
                    <span className={`pill ${isInstalled ? 'accent' : 'outline'}`}>
                      {isInstalled ? 'Installed' : 'Available'}
                    </span>
                  </header>
                  <p>{app.description}</p>
                  <div className="recipe-tags">
                    {app.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {app.requirements && (
                    <div className="recipe-requirements">
                      <strong>Requirements:</strong>
                      <ul>
                        {app.requirements.mcpServer && <li>MCP Server</li>}
                        {app.requirements.embeddingService && (
                          <li>{app.requirements.embeddingService}</li>
                        )}
                      </ul>
                    </div>
                  )}
                  {app.permissions && (
                    <div className="recipe-permissions">
                      <strong>Permissions:</strong>
                      <p className="fine-print">
                        This app operates in the <code>{app.schema}</code> schema and can only access:{' '}
                        {app.permissions.allowedTables.map((table, idx) => (
                          <span key={table}>
                            <code>{table}</code>
                            {idx < app.permissions.allowedTables.length - 1 && ', '}
                          </span>
                        ))}
                      </p>
                    </div>
                  )}
                  <div className="recipe-actions">
                    {isInstalled ? (
                      <>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => setShowAppInstructions(app.id)}
                        >
                          View instructions
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void handleUninstallApp(app.id)}
                          disabled={appsLoading}
                        >
                          Uninstall
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleInstallApp(app)}
                        disabled={appsLoading || !db}
                      >
                        {appsLoading ? 'Installing…' : 'Install app'}
                      </button>
                    )}
                  </div>
                  {showAppInstructions === app.id && (
                    <div className="recipe-instructions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setShowAppInstructions(null)}
                      >
                        Close
                      </button>
                      <div className="instructions-content">
                        {app.mcpServer && (
                          <div className="mcp-setup-section">
                            <p>
                              <strong>MCP Server Setup:</strong>
                            </p>
                            <p className="muted fine-print">
                              Add this configuration to your <code>mcp.json</code> file in LM Studio:
                            </p>
                            <div className="code-block">
                              <pre>{JSON.stringify(
                                generateMCPConfig(app) || {
                                  mcpServers: {
                                    [app.id]: {
                                      command: app.mcpServer.command,
                                      args: app.mcpServer.args,
                                      env: app.mcpServer.env || {},
                                    },
                                  },
                                },
                                null,
                                2,
                              )}</pre>
                            </div>
                            {((app.mcpServer.env?.MCP_POSTGRES_URL?.includes('YOUR_CONNECTION_ID') && !connectionId) ||
                              (app.mcpServer.env?.MCP_POSTGRES_URL?.includes('YOUR_AUTH_TOKEN') && !authToken)) && (
                              <div className="mcp-notes" style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#fff3cd', borderRadius: '4px', border: '1px solid #ffc107' }}>
                                <p style={{ color: '#856404', margin: 0 }}>
                                  <strong style={{ color: '#856404' }}>⚠️ Note:</strong> Placeholder values have been automatically replaced with your current values. If you don't see your Connection ID or Auth Token, make sure:
                                  <ul style={{ marginTop: '0.5rem', marginBottom: 0, paddingLeft: '1.5rem', color: '#856404' }}>
                                    {!connectionId && (
                                      <li style={{ color: '#856404' }}>Wait for the WebSocket connection to establish (check the Database status indicator)</li>
                                    )}
                                    {!authToken && (
                                      <li style={{ color: '#856404' }}>Your auth token is available on the Database page → Connection Info section</li>
                                    )}
                                  </ul>
                                </p>
                              </div>
                            )}
                            <p className="muted fine-print" style={{ marginTop: '1rem' }}>
                              <strong>Location:</strong> The <code>mcp.json</code> file is typically located at:
                            </p>
                            <ul>
                              <li><strong>macOS:</strong> <code>~/Library/Application Support/LM Studio/mcp.json</code></li>
                              <li><strong>Windows:</strong> <code>%APPDATA%\LM Studio\mcp.json</code></li>
                              <li><strong>Linux:</strong> <code>~/.config/LM Studio/mcp.json</code></li>
                            </ul>
                            <p className="muted fine-print">
                              After adding the configuration, restart LM Studio to load the MCP server.
                            </p>
                            {app.mcpServer?.notes?.embeddingModel && (
                              <div className="mcp-notes">
                                <p>
                                  <strong>⚠️ Important: Embedding Model Required</strong>
                                </p>
                                <p className="muted fine-print">
                                  {app.mcpServer.notes.embeddingModel}
                                </p>
                                <ol>
                                  <li>Open LM Studio and go to the <strong>Search</strong> tab</li>
                                  <li>Search for an embedding model (e.g., "text-embedding", "embedding", "bge", "e5")</li>
                                  <li>Download and load an embedding-capable model</li>
                                  <li>Note the exact model name (e.g., <code>BAAI/bge-small-en-v1.5</code>)</li>
                                  <li>Update <code>LM_STUDIO_EMBEDDING_MODEL</code> in your <code>mcp.json</code> with the model name</li>
                                  <li>Enable <strong>headless server mode</strong> in LM Studio</li>
                                </ol>
                                <p className="muted fine-print">
                                  <strong>Note:</strong> The example configuration uses <code>text-embedding-qwen3-embedding-4b</code>. If you're using a different model, update <code>LM_STUDIO_EMBEDDING_MODEL</code> in your <code>mcp.json</code> with your model name.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                        {app.setup.instructions && (
                          <div className="recipe-documentation">
                            <p>
                              <strong>Full Instructions:</strong>
                            </p>
                            <div className="instructions-markdown">
                              <pre>{replacePlaceholders(app.setup.instructions)}</pre>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              )
            })
          )}
        </div>
      </section>
    </main>
  )
}

