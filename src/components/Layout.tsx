import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { StatusIndicator } from './StatusIndicator'
import { SelfHostedRelayIndicator } from './SelfHostedRelayIndicator'
import { ThemeToggle } from './ThemeToggle'
import { GoogleTranslate } from './GoogleTranslate'
import { SystemOverloadBanner } from './SystemOverloadBanner'
import { ShutdownNoticeBanner } from './ShutdownNoticeBanner'
import { GITHUB_REPO_URL } from '../utils/projectLinks'
import './Layout.css'

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen)
  }

  const closeMobileMenu = () => {
    setMobileMenuOpen(false)
  }

  return (
    <div className="app-layout">
      <ShutdownNoticeBanner />
      <SystemOverloadBanner />
      <nav className="main-nav">
        <div className="nav-container">
          <Link to="/" className="nav-logo" onClick={closeMobileMenu}>
            <img
              src="/db4.svg"
              alt="db4"
              className="nav-logo-image"
            />
            <span className="nav-logo-text">
              <span className="logo-db">db</span>
              <span className="logo-4">4</span>
              <span className="logo-app">.app</span>
            </span>
          </Link>
          <div className="nav-right">
            <div className={`nav-links ${mobileMenuOpen ? 'mobile-open' : ''}`}>
              <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`} onClick={closeMobileMenu}>
                Home
              </Link>
              <Link
                to="/playground"
                className={`nav-link ${location.pathname === '/playground' ? 'active' : ''}`}
                onClick={closeMobileMenu}
              >
                Playground
              </Link>
              <Link
                to="/community-apps"
                className={`nav-link ${location.pathname === '/community-apps' || location.pathname === '/recipes' ? 'active' : ''}`}
                onClick={closeMobileMenu}
              >
                Community Apps
              </Link>
              <Link
                to="/self-hosted"
                className={`nav-link ${location.pathname === '/self-hosted' ? 'active' : ''}`}
                onClick={closeMobileMenu}
              >
                Self-Hosted
              </Link>
              <a
                href={GITHUB_REPO_URL}
                className="nav-link"
                target="_blank"
                rel="noopener noreferrer"
                onClick={closeMobileMenu}
              >
                GitHub
              </a>
            </div>
            <div className="nav-indicators">
              <SelfHostedRelayIndicator />
              <StatusIndicator />
            </div>
            <button
              className="mobile-menu-toggle"
              onClick={toggleMobileMenu}
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              <span className={`hamburger ${mobileMenuOpen ? 'open' : ''}`}>
                <span></span>
                <span></span>
                <span></span>
              </span>
            </button>
          </div>
        </div>
      </nav>
      <main>{children}</main>
      <footer className="main-footer">
        <div className="footer-content">
          <div className="footer-legal">
            <h3 className="footer-legal-title">Open source</h3>
            <div className="footer-links">
              <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" className="footer-link">Source on GitHub</a>
            </div>
          </div>
          <div className="footer-bottom">
            <p className="footer-text">
              A{' '}
              <a href="https://lab4.app" target="_blank" rel="noopener noreferrer" className="footer-link">
                Lab4
              </a>{' '}
              project
            </p>
            <div className="footer-settings">
              <GoogleTranslate />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

