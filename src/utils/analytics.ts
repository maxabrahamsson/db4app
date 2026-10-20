/**
 * Analytics utility for tracking user events
 * 
 * This file provides a unified interface for tracking events across
 * different analytics providers (Posthog, Plausible, etc.)
 * 
 * All events are privacy-conscious - we never track:
 * - SQL queries
 * - Connection IDs (unless anonymized)
 * - Database contents
 * - Personal information
 */

import { usePostHog } from 'posthog-js/react'
import { debugLog } from './debug'

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, unknown> }) => void
  }
}

/**
 * Get PostHog instance (for use outside React components)
 * Use usePostHog() hook inside React components instead
 */
function getPostHog() {
  if (typeof window !== 'undefined') {
    // PostHogProvider sets this on window
    return (window as any).posthog
  }
  return null
}

/**
 * Track a custom event
 * @param eventName - Name of the event (e.g., 'recipe_installed')
 * @param properties - Event properties (no sensitive data)
 */
export function trackEvent(eventName: string, properties?: Record<string, unknown>) {
  // Filter out sensitive data
  const safeProperties = filterSensitiveData(properties || {})

  // Posthog
  const posthog = getPostHog()
  if (posthog) {
    posthog.capture(eventName, safeProperties)
  }

  // Plausible (custom events)
  if (typeof window !== 'undefined' && window.plausible) {
    window.plausible(eventName, { props: safeProperties })
  }
}

/**
 * Hook for using PostHog in React components
 * Use this inside React components for type-safe PostHog access
 */
export function useAnalytics() {
  const posthog = usePostHog()

  return {
    trackEvent: (eventName: string, properties?: Record<string, unknown>) => {
      const safeProperties = filterSensitiveData(properties || {})
      posthog?.capture(eventName, safeProperties)
      
      // Also track in Plausible
      if (typeof window !== 'undefined' && window.plausible) {
        window.plausible(eventName, { props: safeProperties })
      }
    },
    posthog, // Expose posthog instance for advanced usage
    // Survey functions
    showSurvey: (surveyId: string) => {
      if (posthog) {
        // PostHog surveys are shown automatically based on targeting rules
        // But you can also trigger them programmatically
        posthog.getFeatureFlag(`survey-${surveyId}`)
        // Note: Surveys are typically managed in PostHog dashboard
        // and shown automatically based on targeting rules
      }
    },
  }
}

/**
 * Show a PostHog survey programmatically
 * @param surveyId - The survey ID from PostHog dashboard
 */
export function showPostHogSurvey(surveyId: string) {
  const posthog = getPostHog()
  if (posthog) {
    // PostHog surveys are typically shown automatically based on targeting
    // This is a placeholder - actual implementation depends on PostHog survey API
    debugLog.log('[PostHog] Survey requested:', surveyId)
    // PostHog will show surveys automatically if they're active and match targeting rules
  }
}

/**
 * Track page view (usually automatic, but can be called manually)
 */
export function trackPageView(page: string) {
  trackEvent('page_view', { page })
}

/**
 * Track recipe installation
 */
export function trackRecipeInstall(recipeId: string, recipeName: string) {
  trackEvent('recipe_installed', {
    recipe_id: recipeId,
    recipe_name: recipeName,
  })
}

/**
 * Track recipe uninstallation
 */
export function trackRecipeUninstall(recipeId: string, recipeName: string) {
  trackEvent('recipe_uninstalled', {
    recipe_id: recipeId,
    recipe_name: recipeName,
  })
}

/**
 * Track database export
 */
export function trackDatabaseExport(tableCount: number, totalRows: number) {
  trackEvent('database_exported', {
    table_count: tableCount,
    total_rows: totalRows,
  })
}

/**
 * Track database import
 */
export function trackDatabaseImport(statementCount: number) {
  trackEvent('database_imported', {
    statement_count: statementCount,
  })
}

/**
 * Track MCP connection
 */
export function trackMCPConnection(serverName: string) {
  trackEvent('mcp_connected', {
    server_name: serverName,
  })
}

/**
 * Track connection ID generation
 */
export function trackConnectionIdGenerated() {
  trackEvent('connection_id_generated')
}

/**
 * Track encryption key regeneration
 */
export function trackEncryptionKeyRegenerated() {
  trackEvent('encryption_key_regenerated')
}

/**
 * Track database reset
 */
export function trackDatabaseReset() {
  trackEvent('database_reset')
}

/**
 * Track SQL query execution (anonymized)
 */
export function trackSQLQuery(queryType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE' | 'DROP' | 'OTHER') {
  trackEvent('sql_query_executed', {
    query_type: queryType,
  })
}

/**
 * Filter out sensitive data from event properties
 */
function filterSensitiveData(properties: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  
  for (const [key, value] of Object.entries(properties)) {
    // Skip sensitive keys
    if (
      key.toLowerCase().includes('sql') ||
      key.toLowerCase().includes('password') ||
      key.toLowerCase().includes('secret') ||
      key.toLowerCase().includes('key') && key !== 'recipe_id' ||
      key.toLowerCase().includes('token') ||
      key.toLowerCase().includes('connectionid') && typeof value === 'string' && value.length > 8
    ) {
      continue
    }

    // Anonymize connection IDs (keep first 8 chars)
    if (key.toLowerCase().includes('connection') && typeof value === 'string' && value.length > 8) {
      safe[key] = `${value.substring(0, 8)}...`
      continue
    }

    safe[key] = value
  }

  return safe
}

