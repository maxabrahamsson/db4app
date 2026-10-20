import type { PGlite } from '@electric-sql/pglite'
import type { DBStorage } from './StorageAdapter'
import { debugLog } from '../utils/debug'

const DB_FOLDER = 'db4-data'
const SNAPSHOT_FILE = 'snapshot.bin'

/**
 * Desktop storage adapter using Tauri filesystem plugins.
 * 
 * IMPORTANT: All Tauri imports are done dynamically inside functions
 * to prevent crashes when running in web context.
 */
export class DesktopStorage implements DBStorage {
  private snapshotPath: string | null = null

  /**
   * Get or create the snapshot file path.
   * Uses Documents/db4-data/snapshot.bin
   * Tries to use documentDir() first, falls back to $DOCUMENT variable if permission denied
   */
  private async getSnapshotPath(): Promise<string> {
    if (this.snapshotPath) {
      return this.snapshotPath
    }

    const { join, documentDir } = await import('@tauri-apps/api/path')
    
    try {
      // Try to resolve the document directory (may fail in webview with remote URL)
      const docsDir = await documentDir()
      this.snapshotPath = await join(docsDir, DB_FOLDER, SNAPSHOT_FILE)
      debugLog.log('[DesktopStorage] Snapshot path (resolved):', this.snapshotPath)
    } catch (error) {
      // Fallback: use $DOCUMENT variable directly (Tauri will resolve it)
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (errorMsg.includes('not allowed') || errorMsg.includes('permission')) {
        debugLog.warn('[DesktopStorage] Cannot resolve documentDir, using $DOCUMENT variable:', errorMsg)
        this.snapshotPath = await join('$DOCUMENT', DB_FOLDER, SNAPSHOT_FILE)
        debugLog.log('[DesktopStorage] Snapshot path (using $DOCUMENT):', this.snapshotPath)
      } else {
        throw error
      }
    }
    
    return this.snapshotPath
  }

  /**
   * Ensure the db4-data directory exists
   * Tries to use documentDir() first, falls back to $DOCUMENT variable if permission denied
   */
  private async ensureDirectory(): Promise<void> {
    const { mkdir, exists } = await import('@tauri-apps/plugin-fs')
    const { join, documentDir } = await import('@tauri-apps/api/path')
    
    let dbDir: string
    try {
      // Try to resolve the document directory
      const docsDir = await documentDir()
      dbDir = await join(docsDir, DB_FOLDER)
    } catch (error) {
      // Fallback: use $DOCUMENT variable directly
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (errorMsg.includes('not allowed') || errorMsg.includes('permission')) {
        debugLog.warn('[DesktopStorage] Cannot resolve documentDir, using $DOCUMENT variable:', errorMsg)
        dbDir = await join('$DOCUMENT', DB_FOLDER)
      } else {
        throw error
      }
    }
    
    const dirExists = await exists(dbDir)
    if (!dirExists) {
      await mkdir(dbDir, { recursive: true })
      debugLog.log('[DesktopStorage] Created directory:', dbDir)
    }
  }

  async save(db: PGlite): Promise<void> {
    try {
      debugLog.log('[DesktopStorage] Saving database snapshot...')
      
      // Ensure directory exists
      await this.ensureDirectory()
      
      // Get the database dump as a Blob
      // PGlite's dumpDataDir returns the database as a tar archive
      const blob = await db.dumpDataDir('auto')
      
      // Convert Blob to Uint8Array
      const arrayBuffer = await blob.arrayBuffer()
      const data = new Uint8Array(arrayBuffer)
      
      // Dynamic import of Tauri fs plugin
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      
      const path = await this.getSnapshotPath()
      await writeFile(path, data)
      
      debugLog.log('[DesktopStorage] Saved snapshot:', path, `(${data.length} bytes)`)
    } catch (error) {
      console.error('[DesktopStorage] Failed to save:', error)
      throw error
    }
  }

  async load(): Promise<Blob | null> {
    try {
      debugLog.log('[DesktopStorage] Loading database snapshot...')
      
      // Dynamic import of Tauri fs plugin
      const { readFile, exists } = await import('@tauri-apps/plugin-fs')
      
      const path = await this.getSnapshotPath()
      
      // Check if snapshot exists
      const fileExists = await exists(path)
      if (!fileExists) {
        debugLog.log('[DesktopStorage] No snapshot found at:', path)
        return null
      }
      
      // Read the snapshot file
      const data = await readFile(path)
      
      // Convert Uint8Array to Blob
      const blob = new Blob([data], { type: 'application/x-tar' })
      
      debugLog.log('[DesktopStorage] Loaded snapshot:', path, `(${data.length} bytes)`)
      return blob
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      // If it's a permission error, log it but don't throw - fall back to IndexedDB
      if (errorMsg.includes('not allowed') || errorMsg.includes('permission')) {
        debugLog.warn('[DesktopStorage] Permission denied for file access, falling back to IndexedDB:', errorMsg)
        console.warn('[DesktopStorage] File system access not available, using IndexedDB instead')
        return null
      }
      console.error('[DesktopStorage] Failed to load:', error)
      return null
    }
  }
}

