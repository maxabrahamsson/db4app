import { useState } from 'react'
import { Link } from 'react-router-dom'
import { GITHUB_REPO_URL } from '../utils/projectLinks'
import './ShutdownNoticeBanner.css'

const DISMISS_KEY = 'db4app-shutdown-notice-dismissed'

const readDismissed = (): boolean => {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Site-wide notice: the hosted relay is gone, db4 is open source.
 * Dismissal is remembered per browser (convenience only).
 */
export function ShutdownNoticeBanner() {
  const [dismissed, setDismissed] = useState(readDismissed)

  if (dismissed) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // Ignore storage errors; banner just hides for this session
    }
    setDismissed(true)
  }

  return (
    <div className="shutdown-notice" role="status">
      <div className="shutdown-notice-content">
        <p className="shutdown-notice-text">
          <strong>The hosted db4 relay has been shut down. db4 is now open source.</strong>{' '}
          Your data lives in this browser (PGlite / IndexedDB) and is unaffected. To connect external
          tools, <Link to="/self-hosted">self-host the relay</Link>.
        </p>
        <a
          className="shutdown-notice-link"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on GitHub
        </a>
        <button
          type="button"
          className="shutdown-notice-dismiss"
          onClick={dismiss}
          aria-label="Dismiss notice"
        >
          ×
        </button>
      </div>
    </div>
  )
}
