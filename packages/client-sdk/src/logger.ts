/**
 * Simple logger interface to replace the frontend debugLog
 */
export const logger = {
    log: (..._args: unknown[]) => {
        // Uncomment for verbose logging
        // console.log('[ClientSDK]', ..._args)
    },
    warn: (...args: unknown[]) => {
        console.warn('[ClientSDK]', ...args)
    },
    error: (...args: unknown[]) => {
        console.error('[ClientSDK]', ...args)
    }
}
