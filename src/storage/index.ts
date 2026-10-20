import type { DBStorage } from './StorageAdapter'
import { WebStorage } from './WebStorage'
import { debugLog } from '../utils/debug'

// Re-export types
export type { DBStorage } from './StorageAdapter'
export { WebStorage } from './WebStorage'
export { DesktopStorage } from './DesktopStorage'

// Declare Tauri global
declare global {
  interface Window {
    __TAURI__?: unknown
  }
}

/**
 * Check if running in Tauri desktop context
 */
export function isTauriContext(): boolean {
  if (typeof window === 'undefined') return false

  const isGlobalTauri = !!(window as any).__TAURI__
  if (isGlobalTauri) return true

  // Check for query param (MFE/Iframe)
  try {
    const params = new URLSearchParams(window.location.search)
    const isTauriParam = params.get('tauri') === '1'

    // Check localStorage (persisted by main.tsx which strips URL params)
    const isTauriStorage = typeof localStorage !== 'undefined' &&
      localStorage.getItem('db4app-relay-tauri') === 'true'

    // DEBUG LOGGING
    if (params.has('tauri') || isTauriStorage || window.location.href.includes('mfe')) {
      console.log('[isTauriContext] Check:', {
        href: window.location.href,
        search: window.location.search,
        isTauriParam,
        isTauriStorage,
        isGlobalTauri
      })
    }

    return isTauriParam || isTauriStorage
  } catch (e) {
    console.error('[isTauriContext] Error parsing URL:', e)
    return false
  }
}

/**
 * Get the appropriate storage adapter based on the runtime context.
 * - In Tauri: Returns DesktopStorage (filesystem-based)
 * - In Web: Returns WebStorage (IndexedDB-based, managed by PGlite)
 */
export async function getStorage(): Promise<DBStorage> {
  if (isTauriContext()) {
    debugLog.log('[Storage] Tauri context detected, using DesktopStorage')
    // Dynamic import to avoid loading Tauri dependencies in web context
    const { DesktopStorage } = await import('./DesktopStorage')
    return new DesktopStorage()
  }

  debugLog.log('[Storage] Web context detected, using WebStorage')
  return new WebStorage()
}

/**
 * Synchronous version that returns WebStorage by default.
 * Use getStorage() for proper async detection.
 */
export function getStorageSync(): DBStorage {
  if (isTauriContext()) {
    debugLog.log('[Storage] Tauri context detected (sync) - returning WebStorage as fallback')
    debugLog.log('[Storage] Note: Use getStorage() async function for proper DesktopStorage')
  }
  return new WebStorage()
}

