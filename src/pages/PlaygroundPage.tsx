import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useDb } from '../contexts/DbContext'
import type { Results } from '@electric-sql/pglite'
import { trackPageView } from '../utils/analytics'
import Editor from '@monaco-editor/react'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, GridOptions } from 'ag-grid-community'
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import '../App.css'

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule])

const DEFAULT_QUERY = `
SELECT id, title, details, done, created_at
FROM todos
ORDER BY created_at DESC;
`.trim()

type QueryDisplay = {
  columns: string[]
  rows: Record<string, unknown>[]
  command: string
  rowCount: number
}

type RichResults = Results<Record<string, unknown>> & {
  rowCount?: number
  command?: string
}

type TableEntry = {
  schema: string
  name: string
}

function mapResultsToDisplay(res: RichResults): QueryDisplay {
  const columns =
    res.fields?.map((field) => field.name) ??
    Object.keys((res.rows as Record<string, unknown>[])[0] ?? {})

  return {
    columns,
    rows: res.rows as Record<string, unknown>[],
    command: res.command ?? 'QUERY',
    rowCount: res.rowCount ?? res.rows.length ?? 0,
  }
}

function formatValue(value: unknown): string {
  if (value === null || typeof value === 'undefined') return '∅'
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

export function PlaygroundPage() {
  const { db, updateLastAccessTime } = useDb()
  const [query, setQuery] = useState(DEFAULT_QUERY)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<QueryDisplay | null>(null)
  const [tables, setTables] = useState<TableEntry[]>([])
  const [tablesLoading, setTablesLoading] = useState(false)
  const [tableExplorerError, setTableExplorerError] = useState<string | null>(null)
  const [editorHeight, setEditorHeight] = useState(200) // Default to half of original 300px
  const [isEditorPoppedOut, setIsEditorPoppedOut] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const editorRef = useRef<any>(null)

  const runQuery = useCallback(
    async (sql?: string) => {
      if (!db) return
      const queryToRun = sql ?? query
      if (!queryToRun.trim()) return

      setIsRunning(true)
      setError(null)
      updateLastAccessTime()

      try {
        const res = (await db.query(queryToRun)) as RichResults
        const display = mapResultsToDisplay(res)
        setResult(display)
      } catch (err) {
        setError((err as Error).message)
        setResult(null)
      } finally {
        setIsRunning(false)
      }
    },
    [db, query, updateLastAccessTime],
  )


  const fetchTables = useCallback(async () => {
    if (!db) return
    setTablesLoading(true)
    setTableExplorerError(null)
    updateLastAccessTime()

    try {
      const res = await db.query(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name;
      `)
      const mapped = (res.rows as Record<string, unknown>[]).map((row) => ({
        schema: row.table_schema as string,
        name: row.table_name as string,
      }))
      setTables(mapped)
    } catch (err) {
      setTableExplorerError((err as Error).message)
    } finally {
      setTablesLoading(false)
    }
  }, [db, updateLastAccessTime])

  // Insert table name into query editor when table is clicked
  const handleTableClick = useCallback(
    (table: TableEntry) => {
      if (!editorRef.current) return
      const tableName = `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`
      const editor = editorRef.current
      const selection = editor.getSelection()
      const text = `SELECT * FROM ${tableName} LIMIT 100;`
      
      if (selection) {
        // Insert at cursor position
        editor.executeEdits('insert-table', [
          {
            range: selection,
            text: text,
          },
        ])
      } else {
        // Replace entire content
        editor.setValue(text)
      }
      editor.focus()
    },
    [],
  )

  useEffect(() => {
    if (db) {
      void fetchTables()
    }
  }, [db, fetchTables])

  // Track page view
  useEffect(() => {
    trackPageView('playground')
  }, [])

  // Convert query results to AG Grid format
  const queryGridColumns = useMemo<ColDef[]>(() => {
    if (!result || result.columns.length === 0) return []
    return result.columns.map((col) => ({
      field: col,
      headerName: col,
      sortable: true,
      filter: true,
      resizable: true,
      minWidth: 80, // Minimum width for small columns like IDs
      maxWidth: 400, // Maximum width to prevent overly wide columns
      flex: 1, // Allow columns to grow to fill available space
      cellRenderer: (params: any) => {
        const value = params.value
        if (value === null || value === undefined) return '<span style="opacity: 0.5">∅</span>'
        if (value instanceof Date) return value.toISOString()
        if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`
        if (typeof value === 'object') return JSON.stringify(value)
        return String(value)
      },
    }))
  }, [result])

  const queryGridRowData = useMemo(() => {
    if (!result) return []
    return result.rows
  }, [result])


  const defaultGridOptions: GridOptions = {
    theme: 'legacy', // Use CSS file themes instead of Theming API
    suppressCellFocus: true,
    rowSelection: {
      mode: 'multiRow', // Required: specify selection mode
      enableClickSelection: false, // Disable click selection (replaces deprecated suppressRowClickSelection)
    },
    animateRows: true,
    pagination: true,
    paginationPageSize: 50,
    domLayout: 'autoHeight',
  }

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor
    // Add keyboard shortcut for running query (Cmd/Ctrl + Enter)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      void runQuery()
    })
    // Define custom amber-toned theme
    // Note: defineTheme can be called multiple times safely - it will update existing theme
    try {
      monaco.editor.defineTheme('amber-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#FEFBF3', // Very light amber tint
          'editor.foreground': '#1F2937',
          'editorLineNumber.foreground': '#9CA3AF',
          'editor.selectionBackground': '#FEF3C7', // Light amber
          'editor.lineHighlightBackground': '#FFFBEB', // Amber highlight
          'editorCursor.foreground': '#F59E0B', // Amber cursor
        },
      })
      monaco.editor.setTheme('amber-light')
    } catch (error) {
      console.warn('Failed to set custom Monaco theme:', error)
      // Fallback to default light theme
      monaco.editor.setTheme('vs')
    }
  }

  // Handle editor resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const newHeight = e.clientY - (document.querySelector('.editor-container')?.getBoundingClientRect().top ?? 0)
      if (newHeight > 100 && newHeight < 800) {
        setEditorHeight(newHeight)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isResizing])

  if (!db) {
    return (
      <main className="landing">
        <div className="section-heading">
          <p className="eyebrow">Playground</p>
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
          <p className="eyebrow">SQL Playground</p>
          <h2>Run queries, explore tables, and insert data.</h2>
          <p>
            Use the interface below to insert data, browse tables, and run arbitrary SQL—all while the
            managed relay stays ready for remote clients.
          </p>
        </div>
        <section className="grid">
          <article className="card db-interface" style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: '1.5rem', minHeight: '600px' }}>
            {/* Left column: Table list */}
            <div className="table-browser" role="group" aria-label="Database tables" style={{ borderRight: '1px solid var(--border)', paddingRight: '1.5rem' }}>
              <div className="db-card-header inline">
                <div>
                  <p className="eyebrow">Tables</p>
                  <strong>Database schema</strong>
                  <p className="muted fine-print">
                    {tables.length} table{tables.length === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void fetchTables()}
                  disabled={!db || tablesLoading}
                >
                  Refresh
                </button>
              </div>
              {tableExplorerError && <p className="status-error">{tableExplorerError}</p>}
              <div className="table-list" role="list" style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto', marginTop: '1rem' }}>
                {tablesLoading ? (
                  <p className="muted">Loading tables…</p>
                ) : tables.length === 0 ? (
                  <p className="muted">Create a table to see it here.</p>
                ) : (
                  tables.map((table) => (
                    <button
                      type="button"
                      key={`${table.schema}.${table.name}`}
                      className="table-list-item"
                      onClick={() => handleTableClick(table)}
                      title={`Click to insert SELECT query for ${table.schema}.${table.name}`}
                    >
                      <span className="table-name">{table.name}</span>
                      <span className="table-schema">{table.schema}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right column: Query editor and results */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {/* Query editor section */}
              <div className="editor-container" style={{ position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <p className="muted" style={{ margin: 0 }}>
                    Use any valid Postgres syntax. Press <kbd style={{ padding: '0.125rem 0.375rem', background: 'var(--bg-secondary)', borderRadius: '3px', fontSize: '0.85em' }}>{navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl'}+Enter</kbd> to run.
                  </p>
                  <div className="button-row" style={{ gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="ghost-button small"
                      onClick={() => setIsEditorPoppedOut(!isEditorPoppedOut)}
                      title={isEditorPoppedOut ? 'Pop in editor' : 'Pop out editor'}
                      style={{ margin: 0, padding: '0.5rem', fontSize: '0.875rem', width: '2.5rem', height: '2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      {isEditorPoppedOut ? '⤓' : '⤢'}
                    </button>
                    <button onClick={() => void runQuery()} disabled={!db || isRunning} style={{ margin: 0 }}>
                      {isRunning ? 'Running…' : 'Run query'}
                    </button>
                  </div>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                  <Editor
                    height={`${editorHeight}px`}
                    defaultLanguage="sql"
                    value={query}
                    onChange={(value) => setQuery(value ?? '')}
                    theme="amber-light"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      wordWrap: 'on',
                      tabSize: 2,
                    }}
                    onMount={handleEditorDidMount}
                  />
                  {/* Resize handle */}
                  <div
                    onMouseDown={handleMouseDown}
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: '4px',
                      cursor: 'ns-resize',
                      backgroundColor: 'transparent',
                      zIndex: 10,
                    }}
                    title="Drag to resize editor"
                  />
                </div>
                {error && <p className="status-error" style={{ marginTop: '0.5rem', marginBottom: 0 }}>{error}</p>}
              </div>

              {/* Query results section - no gap */}
              <div style={{ flex: 1, minHeight: '400px', marginTop: 0 }}>
                {result ? (
                  <>
                    {result.rows.length > 0 ? (
                      <div className="ag-theme-alpine-dark" style={{ height: '400px', width: '100%' }}>
                        <AgGridReact
                          columnDefs={queryGridColumns}
                          rowData={queryGridRowData}
                          defaultColDef={{
                            sortable: true,
                            filter: true,
                            resizable: true,
                            flex: 1,
                            minWidth: 100,
                          }}
                          gridOptions={defaultGridOptions}
                          onFirstDataRendered={(params) => {
                            // Auto-size columns based on content
                            const allColumnIds: string[] = []
                            params.api.getColumns()?.forEach((column) => {
                              if (column) {
                                allColumnIds.push(column.getId())
                              }
                            })
                            if (allColumnIds.length > 0) {
                              params.api.autoSizeColumns(allColumnIds, false)
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <p className="muted" style={{ marginTop: '0.75rem' }}>Query executed successfully but returned no rows.</p>
                    )}
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', marginTop: '0.75rem' }}>
                    <p>Run a query to see results here.</p>
                  </div>
                )}
              </div>
            </div>
          </article>
        </section>
      </section>

      {/* Pop-out editor and results modal */}
      {isEditorPoppedOut && (
        <>
          {/* Backdrop */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 999,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
            }}
            onClick={() => setIsEditorPoppedOut(false)}
          />
          {/* Modal */}
          <div
            style={{
              position: 'fixed',
              top: '5%',
              left: '2.5%',
              right: '2.5%',
              bottom: '5%',
              zIndex: 1000,
              backgroundColor: 'rgba(12, 13, 20, 0.98)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              padding: '1.5rem',
              overflow: 'hidden',
              backdropFilter: 'blur(10px)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>SQL Playground</h3>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setIsEditorPoppedOut(false)}
                style={{ padding: '0.5rem' }}
              >
                ✕ Close
              </button>
            </div>
            
            {/* Query editor section */}
            <div style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <p className="muted" style={{ margin: 0 }}>
                  Use any valid Postgres syntax. Press <kbd style={{ padding: '0.125rem 0.375rem', background: 'var(--bg-secondary)', borderRadius: '3px', fontSize: '0.85em' }}>{navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl'}+Enter</kbd> to run.
                </p>
                <button onClick={() => void runQuery()} disabled={!db || isRunning}>
                  {isRunning ? 'Running…' : 'Run query'}
                </button>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                <Editor
                  height="300px"
                  defaultLanguage="sql"
                  value={query}
                  onChange={(value) => setQuery(value ?? '')}
                  theme="light"
                  options={{
                    minimap: { enabled: true },
                    fontSize: 14,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: 'on',
                    tabSize: 2,
                  }}
                  onMount={handleEditorDidMount}
                />
              </div>
              {error && <p className="status-error" style={{ marginTop: '0.5rem', marginBottom: 0 }}>{error}</p>}
            </div>

            {/* Query results section - flush against editor */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginTop: 0 }}>
              {result ? (
                <>
                  {result.rows.length > 0 ? (
                    <div className="ag-theme-alpine-dark" style={{ flex: 1, width: '100%', minHeight: 0 }}>
                      <AgGridReact
                        columnDefs={queryGridColumns}
                        rowData={queryGridRowData}
                        defaultColDef={{
                          sortable: true,
                          filter: true,
                          resizable: true,
                        }}
                        gridOptions={defaultGridOptions}
                        onFirstDataRendered={(params) => {
                          // Auto-size columns based on content
                          const allColumnIds: string[] = []
                          params.api.getColumns()?.forEach((column) => {
                            if (column) {
                              allColumnIds.push(column.getId())
                            }
                          })
                          if (allColumnIds.length > 0) {
                            params.api.autoSizeColumns(allColumnIds, false)
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <p className="muted" style={{ marginTop: '0.75rem' }}>Query executed successfully but returned no rows.</p>
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
                  <p>Run a query to see results here.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  )
}
