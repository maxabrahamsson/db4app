import { useCallback, useEffect, useState } from 'react'
import { useDb } from '../contexts/DbContext'
import { getInstalledApps, uninstallApp } from '../recipes'
import { trackPageView, trackDatabaseReset, trackDatabaseExport, trackDatabaseImport, trackEvent } from '../utils/analytics'
import { isDebugEnabled, enableDebug, disableDebug } from '../utils/debug'
import { getCustomRelayUrl, setCustomRelayUrl, isUsingCustomRelay } from '../utils/relayConfig'
import { GITHUB_REPO_URL } from '../utils/projectLinks'
import '../App.css'

type RelayMode = 'default' | 'self-hosted'

type TableEntry = {
  schema: string
  name: string
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

async function seedDatabase(pg: any) {
  await pg.exec(`
    DROP TABLE IF EXISTS todos;
    CREATE TABLE todos (
      id serial PRIMARY KEY,
      title text NOT NULL,
      details text,
      done boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO todos (title, details, done)
    VALUES
      ('Install Postgres in the browser', 'Done automatically when the app loads', true),
      ('Insert your own rows', 'Use the form to run parameterized INSERT statements', false),
      ('Experiment with SQL', 'Update, delete, or add tables—everything happens locally', false);
  `)
}

export function DatabasePage() {
  const { db, updateLastAccessTime, lastAccessTime } = useDb()
  const [dbStats, setDbStats] = useState<{
    tableCount: number
    totalRows: number
    installedApps: number
    lastWriteTime: Date | null
  } | null>(null)
  const [storageInfo, setStorageInfo] = useState<{
    usage: number
    quota: number
    percentage: number
  } | null>(null)
  const [managementLoading, setManagementLoading] = useState(false)
  const [managementStatus, setManagementStatus] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const [debugEnabled, setDebugEnabled] = useState(isDebugEnabled())

  // Relay server settings
  const [relayMode, setRelayMode] = useState<RelayMode>(() => {
    return isUsingCustomRelay() ? 'self-hosted' : 'default'
  })
  const [customRelayUrl, setCustomRelayUrlState] = useState(() => {
    return getCustomRelayUrl() || 'ws://localhost:8787/agent'
  })

  // Load database statistics
  const loadDbStats = useCallback(async () => {
    if (!db) return
    // Don't update lastAccessTime here - this is just reading stats, not modifying the database

    try {
      const [tablesRes, appsRes] = await Promise.all([
        db.query(`
          SELECT COUNT(*) as count
          FROM information_schema.tables
          WHERE table_type = 'BASE TABLE'
            AND table_schema NOT IN ('pg_catalog', 'information_schema');
        `),
        getInstalledApps(db),
      ])

      const tableCount = Number((tablesRes.rows[0] as { count: string | number })?.count ?? 0)

      // Get total row count across all tables
      let totalRows = 0
      if (tableCount > 0) {
        const tables = await db.query(`
          SELECT table_schema, table_name
          FROM information_schema.tables
          WHERE table_type = 'BASE TABLE'
            AND table_schema NOT IN ('pg_catalog', 'information_schema');
        `)

        for (const row of tables.rows as any[]) {
          try {
            const schemaName = quoteIdentifier(row.table_schema)
            const tableName = quoteIdentifier(row.table_name)
            const countRes = await db.query(
              `SELECT COUNT(*)::int as count FROM ${schemaName}.${tableName};`,
            )
            const rowCount = countRes.rows[0] as { count: number | string | bigint }
            // Handle different return types (string, number, bigint)
            if (typeof rowCount.count === 'bigint') {
              totalRows += Number(rowCount.count)
            } else if (typeof rowCount.count === 'string') {
              totalRows += parseInt(rowCount.count, 10) || 0
            } else {
              totalRows += rowCount.count || 0
            }
          } catch (err) {
            // Skip if table doesn't exist or can't be counted
            console.warn(`Failed to count rows in ${row.table_schema}.${row.table_name}:`, err)
          }
        }
      }

      // Get last write time from lastAccessTime (stored in context)
      const lastWrite = lastAccessTime || null

      setDbStats({
        tableCount,
        totalRows,
        installedApps: appsRes.length,
        lastWriteTime: lastWrite,
      })
    } catch (err) {
      console.error('Failed to load DB stats', err)
    }
  }, [db, lastAccessTime])

  const fetchTables = useCallback(async () => {
    if (!db) return
    try {
      const res = await db.query(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name;
      `)
      return (res.rows as Record<string, unknown>[]).map((row) => ({
        schema: row.table_schema as string,
        name: row.table_name as string,
      }))
    } catch (err) {
      console.error('Failed to fetch tables:', err)
      return []
    }
  }, [db])

  // Load storage information
  const loadStorageInfo = useCallback(async () => {
    if (!('storage' in navigator && 'estimate' in navigator.storage)) {
      // Storage API not available
      setStorageInfo(null)
      return
    }

    try {
      const estimate = await navigator.storage.estimate()
      // usage includes IndexedDB, Cache API, etc. for this origin
      // This is the persistent storage limit (where PGlite data is stored)
      const usage = estimate.usage ?? 0
      const quota = estimate.quota ?? 0
      const percentage = quota > 0 ? (usage / quota) * 100 : 0

      setStorageInfo({
        usage,
        quota,
        percentage,
      })
    } catch (err) {
      console.error('Failed to get storage estimate:', err)
      setStorageInfo(null)
    }
  }, [])

  // Export database as SQL dump
  const handleExportDatabase = useCallback(async () => {
    if (!db) return

    setManagementLoading(true)
    setManagementStatus(null)
    updateLastAccessTime()

    try {
      // Get all user tables
      const tables = await fetchTables()
      if (!tables || tables.length === 0) {
        setManagementStatus({
          type: 'error',
          message: 'No tables found to export.',
        })
        setManagementLoading(false)
        return
      }
      const sqlDump: string[] = []

      // Add header
      sqlDump.push('-- db4 Database Export')
      sqlDump.push(`-- Exported: ${new Date().toISOString()}`)
      sqlDump.push('-- This file contains the complete database schema and data')
      sqlDump.push('')

      // Export each table
      for (const table of tables) {
        const schemaName = quoteIdentifier(table.schema)
        const tableName = quoteIdentifier(table.name)
        const fullTableName = `${schemaName}.${tableName}`

        // Get table structure
        const columnsRes = await db.query(`
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position;
        `, [table.schema, table.name])

        const columns = columnsRes.rows as Array<{
          column_name: string
          data_type: string
          is_nullable: string
          column_default: string | null
        }>

        // Generate CREATE TABLE statement
        sqlDump.push(`-- Table: ${fullTableName}`)
        sqlDump.push(`DROP TABLE IF EXISTS ${fullTableName} CASCADE;`)
        sqlDump.push(`CREATE TABLE ${fullTableName} (`)

        const columnDefs = columns.map((col) => {
          const colName = quoteIdentifier(col.column_name)
          let def = `${colName} ${col.data_type}`
          if (col.is_nullable === 'NO') {
            def += ' NOT NULL'
          }
          if (col.column_default) {
            def += ` DEFAULT ${col.column_default}`
          }
          return def
        })
        sqlDump.push('  ' + columnDefs.join(',\n  '))
        sqlDump.push(');')
        sqlDump.push('')

        // Get and export data
        try {
          const dataRes = await db.query(`SELECT * FROM ${fullTableName};`)
          if (dataRes.rows.length > 0) {
            const colNamesQuoted = columns.map((col) => quoteIdentifier(col.column_name))
            const colNamesUnquoted = columns.map((col) => col.column_name)
            sqlDump.push(`-- Data for ${fullTableName}`)

            for (const row of dataRes.rows as Record<string, unknown>[]) {
              const values = colNamesUnquoted.map((colName) => {
                const value = row[colName]
                if (value === null || value === undefined) return 'NULL'
                if (typeof value === 'string') {
                  return `'${value.replace(/'/g, "''")}'`
                }
                if (typeof value === 'boolean') {
                  return value ? 'TRUE' : 'FALSE'
                }
                if (value instanceof Date) {
                  return `'${value.toISOString()}'`
                }
                if (typeof value === 'number') {
                  return String(value)
                }
                if (typeof value === 'bigint') {
                  return String(value)
                }
                // For arrays and other types, convert to string and escape
                return `'${String(value).replace(/'/g, "''")}'`
              })
              sqlDump.push(`INSERT INTO ${fullTableName} (${colNamesQuoted.join(', ')}) VALUES (${values.join(', ')});`)
            }
            sqlDump.push('')
          }
        } catch (err) {
          console.warn(`Failed to export data from ${fullTableName}:`, err)
          sqlDump.push(`-- Warning: Could not export data from ${fullTableName}`)
          sqlDump.push('')
        }
      }

      // Create and download file
      const sqlContent = sqlDump.join('\n')
      const blob = new Blob([sqlContent], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `db4app-export-${new Date().toISOString().split('T')[0]}.sql`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setManagementStatus({
        type: 'success',
        message: `Database exported successfully. ${tables.length} table(s) exported.`,
      })

      // Track export event
      trackDatabaseExport(tables.length, dbStats?.totalRows || 0)
    } catch (err) {
      setManagementStatus({
        type: 'error',
        message: (err as Error).message,
      })
    } finally {
      setManagementLoading(false)
    }
  }, [db, updateLastAccessTime, fetchTables, dbStats])

  // Import database from SQL file
  const handleImportDatabase = useCallback(async (file: File) => {
    if (!db) return

    if (!confirm('This will replace your current database. Are you sure?')) {
      return
    }

    setManagementLoading(true)
    setManagementStatus(null)
    updateLastAccessTime()

    try {
      const text = await file.text()
      const statements = text
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'))

      // Execute statements in a transaction-like manner
      let executed = 0
      let errors = 0

      for (const statement of statements) {
        try {
          await db.exec(statement)
          executed++
        } catch (err) {
          console.warn('Failed to execute statement:', statement.substring(0, 50), err)
          errors++
        }
      }

      // Refresh stats
      await loadDbStats()

      if (errors > 0) {
        setManagementStatus({
          type: 'error',
          message: `Import completed with errors. ${executed} statements executed, ${errors} failed.`,
        })
      } else {
        setManagementStatus({
          type: 'success',
          message: `Database imported successfully. ${executed} statements executed.`,
        })

        // Track import event
        trackDatabaseImport(executed)
      }
    } catch (err) {
      setManagementStatus({
        type: 'error',
        message: (err as Error).message,
      })
    } finally {
      setManagementLoading(false)
    }
  }, [db, updateLastAccessTime, loadDbStats])

  useEffect(() => {
    if (db) {
      void loadDbStats()
      void loadStorageInfo()
    }
  }, [db, loadDbStats, loadStorageInfo])

  // Track page view
  useEffect(() => {
    trackPageView('database')
  }, [])

  const handleResetDatabase = useCallback(async () => {
    if (!db) return
    if (!confirm('This will drop all tables and data. Are you sure?')) return

    setManagementLoading(true)
    setManagementStatus(null)
    updateLastAccessTime()

    try {
      // Get all user tables
      const tablesRes = await db.query(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema');
      `)

      // Drop all tables
      for (const table of tablesRes.rows as TableEntry[]) {
        const schemaName = quoteIdentifier(table.schema)
        const tableName = quoteIdentifier(table.name)
        await db.exec(`DROP TABLE IF EXISTS ${schemaName}.${tableName} CASCADE;`)
      }

      // Recreate todos table with sample data
      await seedDatabase(db)

      // Refresh stats
      await loadDbStats()

      // Track event
      trackDatabaseReset()

      setManagementStatus({
        type: 'success',
        message: 'Database reset successfully. All tables dropped and todos table recreated.',
      })
    } catch (err) {
      setManagementStatus({
        type: 'error',
        message: (err as Error).message,
      })
    } finally {
      setManagementLoading(false)
    }
  }, [db, loadDbStats, updateLastAccessTime])

  const handleClearApps = useCallback(async () => {
    if (!db) return
    if (!confirm('This will clear all installed app metadata. App tables/functions will remain. Continue?')) return

    setManagementLoading(true)
    setManagementStatus(null)
    updateLastAccessTime()

    try {
      const installed = await getInstalledApps(db)
      for (const app of installed) {
        await uninstallApp(db, app.appId)
      }

      await loadDbStats()

      // Track event
      trackEvent('apps_cleared', { app_count: installed.length })

      setManagementStatus({
        type: 'success',
        message: `Cleared ${installed.length} installed app${installed.length === 1 ? '' : 's'}.`,
      })
    } catch (err) {
      setManagementStatus({
        type: 'error',
        message: (err as Error).message,
      })
    } finally {
      setManagementLoading(false)
    }
  }, [db, loadDbStats, updateLastAccessTime])

  const handleClearAllData = useCallback(async () => {
    if (!db) return
    if (!confirm('This will delete ALL data from ALL tables (but keep the tables). This cannot be undone. Continue?')) return

    setManagementLoading(true)
    setManagementStatus(null)
    updateLastAccessTime()

    try {
      const tablesRes = await db.query(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema');
      `)

      let clearedCount = 0
      for (const table of tablesRes.rows as TableEntry[]) {
        try {
          const schemaName = quoteIdentifier(table.schema)
          const tableName = quoteIdentifier(table.name)
          await db.exec(`TRUNCATE TABLE ${schemaName}.${tableName} CASCADE;`)
          clearedCount++
        } catch {
          // Skip if table can't be truncated
        }
      }

      await loadDbStats()

      // Track event
      trackEvent('database_data_cleared', { table_count: clearedCount })

      setManagementStatus({
        type: 'success',
        message: `Cleared data from ${clearedCount} table${clearedCount === 1 ? '' : 's'}.`,
      })
    } catch (err) {
      setManagementStatus({
        type: 'error',
        message: (err as Error).message,
      })
    } finally {
      setManagementLoading(false)
    }
  }, [db, loadDbStats, updateLastAccessTime])

  const handleClearIndexedDB = useCallback(async () => {
    if (!confirm('This will completely wipe the IndexedDB storage. All data will be lost permanently. This cannot be undone. Continue?')) return

    setManagementLoading(true)
    setManagementStatus(null)

    try {
      // Close the database first
      if (db) {
        await db.close()
      }

      // Clear IndexedDB
      const deleteReq = indexedDB.deleteDatabase('db4app')
      await new Promise<void>((resolve, reject) => {
        deleteReq.onsuccess = () => resolve()
        deleteReq.onerror = () => reject(deleteReq.error)
        deleteReq.onblocked = () => {
          // If blocked, wait a bit and try to resolve
          setTimeout(() => resolve(), 100)
        }
      })

      setManagementStatus({
        type: 'success',
        message: 'IndexedDB cleared. Please refresh the page to reinitialize the database.',
      })

      // Reload the page after a short delay
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } catch (err) {
      setManagementStatus({
        type: 'error',
        message: (err as Error).message,
      })
      setManagementLoading(false)
    }
  }, [db])


  if (!db) {
    return (
      <main className="landing">
        <div className="section-heading">
          <p className="eyebrow">Database</p>
          <h2>Loading database…</h2>
          <p>Initializing Postgres WebAssembly bundle…</p>
        </div>
      </main>
    )
  }

  return (
    <main className="landing">
      <section className="playground" id="playground">
        <div className="section-heading">
          <p className="eyebrow">Database management</p>
          <h2>Control and maintain your database.</h2>
          <p>
            Manage your database instance, view statistics, export/import data, and configure encryption keys.
          </p>
        </div>
        <section className="grid">
          <article className="card db-interface">
            <div className="db-tab-panel management">
              <div className="db-card-header">
                <div>
                  <p className="eyebrow">Database management</p>
                  <strong>Control and maintain your database</strong>
                  <p className="muted fine-print">
                    Manage your database instance, clear data, and view statistics.
                  </p>
                </div>
              </div>

              {dbStats && (
                <div className="management-stats">
                  <div className="stat-card">
                    <span className="stat-label">Tables</span>
                    <strong className="stat-value">{dbStats.tableCount}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Total rows</span>
                    <strong className="stat-value">{dbStats.totalRows.toLocaleString()}</strong>
                    <p className="stat-hint">
                      Across all user tables (excluding system tables)
                    </p>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Installed apps</span>
                    <strong className="stat-value">{dbStats.installedApps}</strong>
                  </div>
                  {dbStats.lastWriteTime && (
                    <div className="stat-card">
                      <span className="stat-label">Last write</span>
                      <strong className="stat-value">
                        {dbStats.lastWriteTime.toLocaleString()}
                      </strong>
                      <p className="stat-hint">
                        Last database modification time
                      </p>
                    </div>
                  )}
                </div>
              )}

              {storageInfo && (
                <div className="storage-section">
                  <div className="storage-header">
                    <div>
                      <p className="eyebrow">Storage usage</p>
                      <strong>Persistent storage (IndexedDB)</strong>
                      <p className="muted fine-print">
                        This is the primary storage constraint for your database. PGlite persists
                        all data to IndexedDB. WebAssembly runtime memory (2-4GB typical) is separate
                        and used only for query processing, not data storage.
                      </p>
                    </div>
                  </div>
                  <div className="storage-info">
                    <div className="storage-bar-container">
                      <div
                        className="storage-bar"
                        style={{
                          width: `${Math.min(storageInfo.percentage, 100)}%`,
                          backgroundColor:
                            storageInfo.percentage > 90
                              ? '#ef4444'
                              : storageInfo.percentage > 70
                                ? '#f59e0b'
                                : '#10b981',
                        }}
                      />
                    </div>
                    <div className="storage-details">
                      <div className="storage-text">
                        <span className="storage-usage">
                          {formatBytes(storageInfo.usage)}
                        </span>
                        <span className="storage-separator">/</span>
                        <span className="storage-quota">
                          {formatBytes(storageInfo.quota)}
                        </span>
                      </div>
                      <span className="storage-percentage">
                        {storageInfo.percentage.toFixed(2)}% used
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="encryption-section">
                <div className="storage-header">
                  <div>
                    <p className="eyebrow">TLS encryption</p>
                    <strong>Secure connections with TLS</strong>
                    <p className="muted fine-print">
                      All connections use TLS encryption at the transport level (same as standard Postgres).
                      Your SQL queries are encrypted in transit. The relay server forwards encrypted traffic
                      but cannot decrypt it. Password authentication provides access control.
                    </p>
                  </div>
                </div>
              </div>

              <div className="management-actions">
                <div className="management-section">
                  <h3>Export & Import</h3>
                  <div className="action-buttons">
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => void handleExportDatabase()}
                      disabled={!db || managementLoading}
                    >
                      Export database
                    </button>
                    <p className="action-description">
                      Download your database as a SQL dump file. You can transfer this file to another device and import it there.
                    </p>
                  </div>
                  <div className="action-buttons">
                    <label className="action-button" style={{ cursor: db && !managementLoading ? 'pointer' : 'not-allowed' }}>
                      <input
                        type="file"
                        accept=".sql,text/plain"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) {
                            void handleImportDatabase(file)
                          }
                          // Reset input so same file can be selected again
                          e.target.value = ''
                        }}
                        disabled={!db || managementLoading}
                        style={{ display: 'none' }}
                      />
                      Import database
                    </label>
                    <p className="action-description">
                      Import a SQL dump file to replace your current database. This will overwrite all existing data.
                    </p>
                  </div>
                </div>

                <div className="management-section">
                  <h3>Data operations</h3>
                  <div className="action-buttons">
                    <button
                      type="button"
                      className="action-button danger"
                      onClick={() => void handleClearAllData()}
                      disabled={!db || managementLoading}
                    >
                      Clear all data
                    </button>
                    <p className="action-description">
                      Delete all rows from all tables. Tables and schema remain intact.
                    </p>
                  </div>
                </div>

                <div className="management-section">
                  <h3>Database reset</h3>
                  <div className="action-buttons">
                    <button
                      type="button"
                      className="action-button danger"
                      onClick={() => void handleResetDatabase()}
                      disabled={!db || managementLoading}
                    >
                      Reset database
                    </button>
                    <p className="action-description">
                      Drop all tables and recreate the todos table with sample data. This will
                      remove all custom tables and data.
                    </p>
                  </div>
                </div>

                <div className="management-section">
                  <h3>App management</h3>
                  <div className="action-buttons">
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => void handleClearApps()}
                      disabled={!db || managementLoading}
                    >
                      Clear installed apps
                    </button>
                    <p className="action-description">
                      Remove app metadata. App tables and functions will remain in the
                      database.
                    </p>
                  </div>
                </div>

                <div className="management-section">
                  <h3>Relay server</h3>
                  <div className="action-buttons">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
                      <select
                        value={relayMode}
                        onChange={(e) => {
                          const mode = e.target.value as RelayMode
                          setRelayMode(mode)
                          if (mode === 'default') {
                            setCustomRelayUrl(null)
                            trackEvent('relay_mode_changed', { mode: 'default' })
                          } else {
                            setCustomRelayUrl(customRelayUrl)
                            trackEvent('relay_mode_changed', { mode: 'self-hosted', url: customRelayUrl })
                          }
                          // Reload to apply changes
                          setTimeout(() => window.location.reload(), 500)
                        }}
                        className="relay-select"
                        style={{
                          padding: '0.75rem 1rem',
                          borderRadius: '0.5rem',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          background: 'rgba(245, 158, 11, 0.05)',
                          color: 'var(--color-text-main)',
                          fontSize: '1rem',
                          cursor: 'pointer',
                          width: '100%',
                        }}
                      >
                        <option value="default">Default (build config or localhost)</option>
                        <option value="self-hosted">Custom relay URL</option>
                      </select>

                      {relayMode === 'self-hosted' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <input
                            type="text"
                            value={customRelayUrl}
                            onChange={(e) => setCustomRelayUrlState(e.target.value)}
                            onBlur={() => {
                              if (relayMode === 'self-hosted' && customRelayUrl) {
                                setCustomRelayUrl(customRelayUrl)
                              }
                            }}
                            placeholder="ws://localhost:8787/agent"
                            style={{
                              padding: '0.75rem 1rem',
                              borderRadius: '0.5rem',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              background: 'rgba(245, 158, 11, 0.05)',
                              color: 'var(--color-text-main)',
                              fontSize: '0.875rem',
                              fontFamily: 'monospace',
                              width: '100%',
                            }}
                          />
                          <button
                            type="button"
                            className="action-button"
                            onClick={() => {
                              setCustomRelayUrl(customRelayUrl)
                              trackEvent('relay_url_updated', { url: customRelayUrl })
                              window.location.reload()
                            }}
                            style={{ alignSelf: 'flex-start' }}
                          >
                            Apply & Reconnect
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="action-description">
                      {relayMode === 'default' ? (
                        <>The hosted DB4 relay has been shut down. By default this tab connects to the relay set at build time (<code style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '0.125rem 0.375rem', borderRadius: '0.25rem' }}>VITE_RELAY_AGENT_URL</code>), or to a self-hosted relay on <code style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '0.125rem 0.375rem', borderRadius: '0.25rem' }}>ws://localhost:8787/agent</code>. Without a relay, the database still works in this browser.</>
                      ) : (
                        <>Point this tab at any relay you run yourself (e.g. <code style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '0.125rem 0.375rem', borderRadius: '0.25rem' }}>npm run relay</code> from the <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">db4app repo</a>).</>
                      )}
                    </p>
                  </div>
                </div>

                <div className="management-section">
                  <h3>Debug logging</h3>
                  <div className="action-buttons">
                    <label className="action-button" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem' }}>
                      <input
                        type="checkbox"
                        checked={debugEnabled}
                        onChange={(e) => {
                          const enabled = e.target.checked
                          setDebugEnabled(enabled)
                          if (enabled) {
                            enableDebug()
                          } else {
                            disableDebug()
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                      <span>Enable debug console logs</span>
                    </label>
                    <p className="action-description">
                      When enabled, detailed debug logs will appear in the browser console. Useful for troubleshooting connection issues.
                    </p>
                  </div>
                </div>
                <div className="management-section">
                  <h3>Storage</h3>
                  <div className="action-buttons">
                    <button
                      type="button"
                      className="action-button danger"
                      onClick={() => void handleClearIndexedDB()}
                      disabled={managementLoading}
                    >
                      Clear IndexedDB
                    </button>
                    <p className="action-description">
                      Completely wipe all persistent storage. This will delete everything and
                      require a page refresh. This action cannot be undone.
                    </p>
                  </div>
                </div>

              </div>

              {managementStatus && (
                <p
                  className={
                    managementStatus.type === 'error' ? 'status-error' : 'status-success'
                  }
                >
                  {managementStatus.message}
                </p>
              )}

              {managementLoading && (
                <p className="muted">Processing…</p>
              )}
            </div>
          </article>
        </section>
      </section>
    </main>
  )
}

