import * as Sentry from '@sentry/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PostHogProvider } from 'posthog-js/react'
import { DbProvider } from './contexts/DbContext'
import { RelayProvider } from './contexts/RelayContext'
import { debugLog } from './utils/debug'
import { setCustomRelayUrl } from './utils/relayConfig'
import './index.css'
import App from './App.tsx'

// Check for relay URL in query parameters (used by Tauri self-hosted relay app)
// This allows the Tauri app to open the web UI and auto-configure the relay
const urlParams = new URLSearchParams(window.location.search)
const relayParam = urlParams.get('relay')
const httpPortParam = urlParams.get('httpPort')
const pgPortParam = urlParams.get('pgPort')
const tauriParam = urlParams.get('tauri')

if (relayParam) {
  try {
    // Validate it looks like a WebSocket URL
    const url = new URL(relayParam)
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      setCustomRelayUrl(relayParam)
      debugLog.log('[Relay] Auto-configured from URL parameter:', relayParam)
      
      // Store port info and Tauri flag for the self-hosted relay indicator
      if (httpPortParam) {
        localStorage.setItem('db4app-relay-http-port', httpPortParam)
      }
      if (pgPortParam) {
        localStorage.setItem('db4app-relay-pg-port', pgPortParam)
      }
      if (tauriParam === '1') {
        localStorage.setItem('db4app-relay-tauri', 'true')
      }
      
      // Remove the query parameters from URL to keep it clean
      const cleanUrl = new URL(window.location.href)
      cleanUrl.searchParams.delete('relay')
      cleanUrl.searchParams.delete('httpPort')
      cleanUrl.searchParams.delete('pgPort')
      cleanUrl.searchParams.delete('tauri')
      window.history.replaceState({}, '', cleanUrl.toString())
    }
  } catch (e) {
    debugLog.warn('[Relay] Invalid relay URL in query parameter:', relayParam)
  }
}

// Initialize Sentry (opt-in: only when VITE_SENTRY_DSN is set)
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
const sentryEnabled = !!sentryDsn
if (sentryEnabled) Sentry.init({
  dsn: sentryDsn,
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
  environment: import.meta.env.MODE,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: true, // Mask all text for privacy
      blockAllMedia: true, // Block all media for privacy
    }),
  ],
  // Tracing
  tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0, // 10% in production, 100% in dev
  // Set tracePropagationTargets to control for which URLs distributed tracing should be enabled
  tracePropagationTargets: ['localhost'],
  // Session Replay
  replaysSessionSampleRate: import.meta.env.MODE === 'production' ? 0.01 : 0.1, // 1% in production, 10% in dev
  replaysOnErrorSampleRate: 1.0, // 100% when errors occur
  // Enable logs to be sent to Sentry
  enableLogs: true,
  // Privacy: Filter out sensitive data
  beforeSend(event) {
    // Remove sensitive data from request bodies
    if (event.request?.data) {
      const data = event.request.data
      // Don't log SQL queries
      if (typeof data === 'object' && data !== null) {
        if ('sql' in data) {
          delete data.sql
        }
        if ('encryptedPayload' in data) {
          delete data.encryptedPayload
        }
        if ('connectionId' in data) {
          // Anonymize connection IDs (keep first 8 chars for debugging)
          data.connectionId = data.connectionId
            ? `${String(data.connectionId).substring(0, 8)}...`
            : '[REDACTED]'
        }
        if ('params' in data && Array.isArray(data.params)) {
          // Don't log query parameters (they might contain sensitive data)
          data.params = '[REDACTED]'
        }
      }
    }

    // Remove connection IDs from URLs
    if (event.request?.url) {
      event.request.url = event.request.url.replace(
        /\/[a-f0-9-]{36}\//g,
        '/[CONNECTION_ID]/',
      )
    }

    // Remove sensitive data from breadcrumbs
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((crumb) => {
        if (crumb.data) {
          const data = { ...crumb.data }
          if ('sql' in data) delete data.sql
          if ('connectionId' in data) {
            data.connectionId = '[REDACTED]'
          }
          return { ...crumb, data }
        }
        return crumb
      })
    }

    // Remove sensitive data from extra context
    if (event.extra) {
      const extra = { ...event.extra }
      if ('sql' in extra) delete extra.sql
      if ('connectionId' in extra) {
        extra.connectionId = '[REDACTED]'
      }
      event.extra = extra
    }

    return event
  },
})

// PostHog configuration
const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY
// No default host: PostHog is opt-in and requires both key and host to be configured
const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined

// Debug: Log PostHog configuration
debugLog.log('[PostHog] Configuration check:', {
  hasKey: !!posthogKey,
  keyLength: posthogKey?.length || 0,
  host: posthogHost,
  mode: import.meta.env.MODE,
})

const posthogOptions = {
  api_host: posthogHost,
  defaults: '2025-11-30',
  // Privacy settings
  autocapture: false, // Disable automatic capture for privacy
  capture_pageview: true,
  capture_pageleave: true,
  // Don't capture sensitive data
  disable_session_recording: false, // Can enable later if needed
  // Enable surveys (surveys are managed in PostHog dashboard)
  // Surveys will appear automatically based on targeting rules you set
  loaded: (posthog: any) => {
    // Store on window for non-React usage
    if (typeof window !== 'undefined') {
      ;(window as any).posthog = posthog
      debugLog.log('[PostHog] ✅ Initialized successfully!')
      debugLog.log('[PostHog] PostHog instance:', posthog)
      debugLog.log('[PostHog] Surveys enabled - create surveys in PostHog dashboard')
      
      // Send a test event immediately
      setTimeout(() => {
        posthog.capture('posthog_initialized', {
          timestamp: new Date().toISOString(),
        })
        debugLog.log('[PostHog] ✅ Test event "posthog_initialized" sent')
      }, 1000)
    }
    // Don't opt out - we want to track in both dev and production
    // PostHog will respect privacy settings via autocapture: false
  },
} as const

// Debug: Check if API key is set (optional - PostHog is not required)
if (!posthogKey || !posthogHost) {
  debugLog.log('[PostHog] ℹ️ PostHog not configured. Analytics will be disabled. To enable, set VITE_PUBLIC_POSTHOG_KEY and VITE_PUBLIC_POSTHOG_HOST in .env.local')
}

const container = document.getElementById('root')!
const root = createRoot(container)

// Only initialize PostHog if both API key and host are provided
const AppWithProviders = posthogKey && posthogHost ? (
  <PostHogProvider apiKey={posthogKey} options={posthogOptions}>
    <BrowserRouter>
      <DbProvider>
        <RelayProvider>
          <App />
        </RelayProvider>
      </DbProvider>
    </BrowserRouter>
  </PostHogProvider>
) : (
  <BrowserRouter>
    <DbProvider>
      <RelayProvider>
        <App />
      </RelayProvider>
    </DbProvider>
  </BrowserRouter>
)

root.render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<div>Something went wrong. Please refresh the page.</div>} showDialog={sentryEnabled}>
      {AppWithProviders}
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
