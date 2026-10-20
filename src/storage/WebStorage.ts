import type { PGlite } from '@electric-sql/pglite'
import type { DBStorage } from './StorageAdapter'
import { debugLog } from '../utils/debug'

/**
 * Web storage adapter.
 * PGlite handles IndexedDB persistence internally when configured with idb:// prefix,
 * so this adapter is essentially a no-op.
 */
export class WebStorage implements DBStorage {
  async save(_db: PGlite): Promise<void> {
    // PGlite uses IndexedDB auto-save when initialized with idb:// prefix
    // No manual save needed for web
    debugLog.log('[WebStorage] Web uses IndexedDB auto-save (no manual save needed)')
  }

  async load(): Promise<Blob | null> {
    // PGlite handles IndexedDB loading internally
    // Return null to signal that PGlite should use its internal loading mechanism
    debugLog.log('[WebStorage] Web uses IndexedDB auto-load (returning null)')
    return null
  }
}

