import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { PGlite } from '@electric-sql/pglite'
import wasmAssetUrl from '../../node_modules/@electric-sql/pglite/dist/pglite.wasm?url'
import fsBundleUrl from '../../node_modules/@electric-sql/pglite/dist/pglite.data?url'
import { getStorage, isTauriContext } from '../storage'
import type { DBStorage } from '../storage'
import { debugLog } from '../utils/debug'
import { createGuardedDb } from '../utils/queryGuard'

// Auto-save interval in milliseconds (30 seconds)
const AUTO_SAVE_INTERVAL = 30000

const READ_ONLY_KEY = 'db4:readOnly'

interface DbContextType {
  db: PGlite | null
  status: string
  error: string | null
  lastAccessTime: Date | null
  updateLastAccessTime: () => void
  saveToDesktop: () => Promise<void>
  readOnly: boolean
  setReadOnly: (value: boolean) => void
}

const DbContext = createContext<DbContextType | undefined>(undefined)

let wasmModulePromise: Promise<WebAssembly.Module> | null = null

async function loadWasmModule(): Promise<WebAssembly.Module> {
  if (!wasmModulePromise) {
    wasmModulePromise = fetch(wasmAssetUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load PGlite WASM bundle (${response.status})`)
        }
        return response.arrayBuffer()
      })
      .then((buffer) => WebAssembly.compile(buffer))
  }
  return wasmModulePromise
}

async function loadFsBundle(): Promise<Blob> {
  const response = await fetch(fsBundleUrl)
  if (!response.ok) {
    throw new Error(`Failed to load PGlite fsBundle (${response.status})`)
  }
  return response.blob()
}

async function seedDatabaseIfNeeded(pg: PGlite) {
  // Check if todos table already exists (database has been initialized before)
  const tableCheck = await pg.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'todos'
    );
  `)

  const todosExists = (tableCheck.rows[0] as { exists: boolean })?.exists ?? false

  if (!todosExists) {
    // First run - create todos table and seed with sample data
    await pg.exec(`
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

  // RAG setup is now handled via recipes - users can install the "rag-mcp" recipe
}

export function DbProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<PGlite | null>(null)
  const [status, setStatus] = useState('Loading Postgres WebAssembly bundle…')
  const [error, setError] = useState<string | null>(null)
  const [lastAccessTime, setLastAccessTime] = useState<Date | null>(null)
  const [readOnly, setReadOnlyState] = useState(() => {
    try { return localStorage.getItem(READ_ONLY_KEY) === 'true' } catch { return false }
  })
  const readOnlyRef = useRef(readOnly)
  const storageRef = useRef<DBStorage | null>(null)
  const autoSaveIntervalRef = useRef<number | null>(null)

  const setReadOnly = useCallback((value: boolean) => {
    setReadOnlyState(value)
    readOnlyRef.current = value
    try { localStorage.setItem(READ_ONLY_KEY, String(value)) } catch {}
  }, [])

  const updateLastAccessTime = useCallback(() => {
    setLastAccessTime(new Date())
  }, [])

  // Manual save function exposed to consumers
  const saveToDesktop = useCallback(async () => {
    if (!db || !storageRef.current) {
      debugLog.warn('[DbContext] Cannot save: db or storage not initialized')
      return
    }

    try {
      await storageRef.current.save(db)
      debugLog.log('[DbContext] Manual save completed')
    } catch (err) {
      console.error('[DbContext] Manual save failed:', err)
      throw err
    }
  }, [db])

  // Initialize database
  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        const isTauri = isTauriContext()
        console.log('[DbContext] Bootstrap start. isTauriContext:', isTauri)

        // Check context first
        if (isTauri) {
          debugLog.log('[DbContext] Tauri context detected: Skipping local PGlite initialization')
          setStatus('Connected to Desktop Sidecar')
          // In Tauri mode, we don't initialize a local DB.
          // The Agent will be initialized with no DB, acting as a control plane.
          setLastAccessTime(new Date())
          return
        }

        // Web Context: Initialize local PGlite

        // Get the appropriate storage adapter
        const storage = await getStorage()
        storageRef.current = storage

        // Load WASM module and FS bundle in parallel
        const [wasmModule, fsBundle] = await Promise.all([
          loadWasmModule(),
          loadFsBundle()
        ])

        // Try to load existing snapshot from desktop storage (if in Tauri)
        // Note: Logic below is now effectively dead code for Tauri since we return early above,
        // but we keep the structure for potential future hybrid modes.
        let loadDataDir: Blob | undefined

        // Initialize PGlite
        // Use IndexedDB as cache layer
        const pgOptions: ConstructorParameters<typeof PGlite>[0] = {
          wasmModule,
          fsBundle,
          dataDir: 'idb://db4app',
        }

        if (loadDataDir) {
          (pgOptions as any).loadDataDir = loadDataDir
        }

        setStatus('Starting Postgres…')
        const pg = new PGlite(pgOptions)

        // Only seed if tables don't exist (first run)
        await seedDatabaseIfNeeded(pg)

        if (cancelled) {
          await pg.close()
          return
        }

        const guardedPg = createGuardedDb(pg, {
          isReadOnly: () => readOnlyRef.current,
        })
        setDb(guardedPg)

        setStatus(`Ready — Postgres is running fully in your browser (persisted to IndexedDB)`)
        setLastAccessTime(new Date())
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message)
          setStatus('An error occurred while starting Postgres')
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  // Auto-save loop for desktop (Tauri) mode
  useEffect(() => {
    if (!db || !isTauriContext()) {
      return
    }

    const performAutoSave = async () => {
      if (!storageRef.current) return

      try {
        await storageRef.current.save(db)
        debugLog.log('[DbContext] Auto-save completed')
      } catch (err) {
        console.error('[DbContext] Auto-save failed:', err)
      }
    }

    // Set up auto-save interval
    debugLog.log('[DbContext] Setting up auto-save interval:', AUTO_SAVE_INTERVAL, 'ms')
    autoSaveIntervalRef.current = window.setInterval(performAutoSave, AUTO_SAVE_INTERVAL)

    // Save on page unload (best effort)
    const handleBeforeUnload = () => {
      // Note: async operations may not complete during beforeunload
      // This is a best-effort save attempt
      if (storageRef.current && db) {
        debugLog.log('[DbContext] Attempting save before unload...')
        // Use synchronous approach if possible, or fire-and-forget
        void storageRef.current.save(db).catch(err => {
          console.error('[DbContext] Save on unload failed:', err)
        })
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current)
        autoSaveIntervalRef.current = null
      }
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [db])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void db?.close()
    }
  }, [db])

  return (
    <DbContext.Provider
      value={{
        db,
        status,
        error,
        lastAccessTime,
        updateLastAccessTime,
        saveToDesktop,
        readOnly,
        setReadOnly,
      }}
    >
      {children}
    </DbContext.Provider>
  )
}

export function useDb() {
  const context = useContext(DbContext)
  if (context === undefined) {
    throw new Error('useDb must be used within a DbProvider')
  }
  return context
}
