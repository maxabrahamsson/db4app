import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { usePostHog } from 'posthog-js/react'
import { Layout } from './components/Layout'
import { LandingPage } from './pages/LandingPage'
import { DatabasePage } from './pages/DatabasePage'
import { PlaygroundPage } from './pages/PlaygroundPage'
import { RecipesPage } from './pages/RecipesPage'
import { DocsPage } from './pages/DocsPage'
import { SelfHostedPage } from './pages/SelfHostedPage'
import { HealthDashboard } from './pages/HealthDashboard'
import { ConnectionBoxPage } from './pages/ConnectionBoxPage'
import { debugLog } from './utils/debug'

// Component to track page views
function PageViewTracker() {
  const location = useLocation()
  const posthog = usePostHog()

  useEffect(() => {
    if (posthog) {
      posthog.capture('$pageview', {
        path: location.pathname,
      })
      debugLog.log('[PostHog] Page view tracked:', location.pathname)
    }
  }, [location, posthog])

  return null
}

function App() {
  const posthog = usePostHog()

  // Send a test event on app load
  useEffect(() => {
    debugLog.log('[PostHog] App component mounted, posthog:', posthog)
    if (posthog) {
      posthog.capture('app_loaded', {
        timestamp: new Date().toISOString(),
        mode: import.meta.env.MODE,
      })
      debugLog.log('[PostHog] ✅ App loaded event sent')
    } else {
      debugLog.warn('[PostHog] ⚠️ PostHog not initialized - check VITE_PUBLIC_POSTHOG_KEY environment variable')
      debugLog.warn('[PostHog] Make sure .env.local exists with VITE_PUBLIC_POSTHOG_KEY')
    }
  }, [posthog])

  return (
    <Routes>
      <Route path="/mfe/connection-box" element={
        <div className="mfe-root">
          <ConnectionBoxPage />
        </div>
      } />

      <Route path="/*" element={
        <Layout>
          <PageViewTracker />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/playground" element={<PlaygroundPage />} />
            <Route path="/database" element={<DatabasePage />} />
            <Route path="/community-apps" element={<RecipesPage />} />
            <Route path="/recipes" element={<RecipesPage />} /> {/* Legacy route - redirects to community-apps */}
            <Route path="/docs/*" element={<DocsPage />} />
            <Route path="/pricing" element={<Navigate to="/self-hosted" replace />} /> {/* Legacy route - paid plans removed */}
            <Route path="/self-hosted" element={<SelfHostedPage />} />
            <Route path="/health-ui" element={<HealthDashboard />} />
          </Routes>
        </Layout>
      } />
    </Routes>
  )
}

export default App
