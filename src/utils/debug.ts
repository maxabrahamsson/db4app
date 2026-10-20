/**
 * Debug logging utility
 * 
 * Controls debug console output based on localStorage setting.
 * Errors are always logged regardless of debug setting.
 */

const DEBUG_KEY = 'db4app-debug-logs'

/**
 * Check if debug logging is enabled
 */
export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(DEBUG_KEY) === 'true'
}

/**
 * Enable debug logging
 */
export function enableDebug(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(DEBUG_KEY, 'true')
  }
}

/**
 * Disable debug logging
 */
export function disableDebug(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(DEBUG_KEY, 'false')
  }
}

/**
 * Debug logger - only logs if debug is enabled
 */
export const debugLog = {
  log: (...args: unknown[]) => {
    if (isDebugEnabled()) {
      console.log(...args)
    }
  },
  warn: (...args: unknown[]) => {
    if (isDebugEnabled()) {
      console.warn(...args)
    }
  },
  info: (...args: unknown[]) => {
    if (isDebugEnabled()) {
      console.info(...args)
    }
  },
  debug: (...args: unknown[]) => {
    if (isDebugEnabled()) {
      console.debug(...args)
    }
  },
  // Error always logs regardless of debug setting
  error: (...args: unknown[]) => {
    console.error(...args)
  },
}

