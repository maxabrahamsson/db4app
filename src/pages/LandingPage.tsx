import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import '../App.css'
import { DbConnectionBox } from '../components/DbConnectionBox'

const proofPoints = [
  {
    title: 'Your data, your browser',
    body:
      'Your entire database runs in your browser. It never leaves your device unless you export it. No cloud storage, no data centers.',
  },
  {
    title: 'Open source, self-hosted',
    body:
      'db4 is fully open source. The optional relay that lets external tools reach your browser database runs on your own machine or server—there is no hosted service in the middle.',
  },
  {
    title: 'Extend with community apps',
    body:
      'Install community extensions with one click. RAG, vector search, and more—all while keeping your data isolated and secure.',
  },
  {
    title: 'Connect anything',
    body:
      'Use standard Postgres clients like psql, DBeaver, or TablePlus. Your Connection ID gives you full control over who can access your database. Direct TCP connection—no HTTP API needed.',
  },
] as const

const personas = [
  {
    name: 'Developers & Builders',
    goal: 'Build and test without infrastructure headaches.',
    weHost: ['Open-source relay you can self-host', 'Community apps'],
    youHost: ['Your database and data', 'Your auth tokens', 'Full control'],
  },
  {
    name: 'AI & ML Experimenters',
    goal: 'Connect LLMs to your data without exposing it.',
    weHost: ['MCP server integration', 'Self-hosted relay'],
    youHost: ['Your documents and embeddings', 'Your prompts and results', 'Your auth tokens'],
  },
  {
    name: 'Teams & Collaborators',
    goal: 'Share databases with teammates while keeping control.',
    weHost: ['Self-hosted remote access relay', 'Connection management'],
    youHost: ['Your schema and data', 'Who can access', 'When to export'],
  },
] as const

import { getConnectionString, maskConnectionString } from '../utils/connectionStrings'
import { useRelay } from '../contexts/RelayContext'
import { GITHUB_REPO_URL, WEBSITE_URL } from '../utils/projectLinks'

export function LandingPage() {
  const { connectionId, authToken } = useRelay()
  const [copied, setCopied] = useState(false)

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Track page view
  useEffect(() => {
    let isActive = true

    void import('../utils/analytics')
      .then(({ trackPageView }) => {
        if (isActive && typeof trackPageView === 'function') {
          trackPageView('landing')
        }
      })
      .catch((err) => {
        console.warn('[Analytics] Failed to track landing page view:', err)
      })

    return () => {
      isActive = false
    }
  }, [])

  const hasCredentials = !!(connectionId && authToken)
  const postgresUrl = getConnectionString({
    connectionId: hasCredentials ? connectionId : null,
    authToken: hasCredentials ? authToken : 'YOUR_AUTH_TOKEN',
    clientType: 'url',
  })

  const tutorialSteps = [
    {
      title: 'Open db4 in your browser',
      description:
        'db4 spins up PGlite entirely in-browser. No accounts, no cloud storage. Use the public site or run the open-source app yourself.',
      code: WEBSITE_URL,
    },
    {
      title: 'Self-host the relay, connect via Postgres TCP',
      description:
        'Run the open-source relay on your machine (see the GitHub README), then connect with psql, DBeaver, TablePlus, or any Postgres client while your browser stays the data source.',
      code: hasCredentials
        ? postgresUrl
        : `${postgresUrl}\n\n# Start your relay, then get your Connection ID and Auth Token from the Database page`,
    },
    {
      title: 'Wire agents through MCP',
      description:
        'Connect AI agents via MCP (Model Context Protocol). MCP servers use the Postgres TCP protocol to connect directly to your browser database, just like psql or other Postgres clients.',
      code: hasCredentials
        ? `{
  "mcpServers": {
    "db4app": {
      "command": "npx",
      "args": ["-y", "db4app-mcp-server@0.1.9"],
      "env": {
        "MCP_POSTGRES_URL": "${postgresUrl}",
        "MCP_SCHEMA": "rag_mcp"
      }
    }
  }
}`
        : `{
  "mcpServers": {
    "db4app": {
      "command": "npx",
      "args": ["-y", "db4app-mcp-server@0.1.9"],
      "env": {
        "MCP_POSTGRES_URL": "${postgresUrl}",
        "MCP_SCHEMA": "rag_mcp"
      }
    }
  }
}

# Get your Connection ID and Auth Token from the Database page`,
    },
  ] as const

  return (
    <main className="landing">
      <header className="hero" id="hero">
        <div className="hero-copy">
          <p className="eyebrow">Postgres in your browser</p>
          <h1>
            <span className="hero-title-line1">Instant Postgres Server.</span>
            <span className="hero-title-line2">Connect Any App</span>
          </h1>
          <p>
            Run real Postgres entirely in your browser. No servers, no accounts, no cloud storage.
            Your data stays local, and you control who can access it. Connect external tools,
            install extensions, and work with your team—all while keeping your data in your browser.
          </p>
          <ul className="hero-bullets">
            <li>Full Postgres in your browser—no installation needed</li>
            <li>Native Postgres TCP via a relay you self-host—connect with psql, DBeaver, TablePlus, or any Postgres client</li>
            <li>Open source—no hosted service, no accounts</li>
            <li>Community apps—extend with one-click installs</li>
            <li>Export & import—transfer your database between devices</li>
          </ul>
          <div className="cta-buttons">
            <Link className="cta-button primary" to="/database">
              Launch your database
            </Link>
            <Link className="cta-button secondary" to="/community-apps">
              Browse community apps
            </Link>
            <a className="cta-button tertiary" href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
              Self-host from GitHub
            </a>
          </div>
          <span className="microcopy">Your data never leaves your browser unless you export it.</span>
        </div>
        <div className="status-card-wrapper">
          <DbConnectionBox />
          <div className="hero-video-embed">
            <iframe
              src="https://www.youtube.com/embed/t1nqPn75RCA?si=I72KU3OedonFPQ7P&controls=0&modestbranding=1&rel=0&showinfo=0"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              title="db4 explainer video"
            />
          </div>
        </div>
      </header >

      <section className="proof" id="proof">
        <div className="proof-copy">
          <p className="eyebrow">Why db4</p>
          <h2>Your database. Your control. Your browser.</h2>
          <p>
            Everything runs in your browser. Run the open-source relay yourself when you want to connect
            external tools—your data never leaves your device unless you export it.
          </p>
          <ul className="proof-points">
            {proofPoints.map((point) => (
              <li key={point.title}>
                <strong>{point.title}</strong>
                <p>{point.body}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="diagram-card" role="img" aria-label="Architecture illustration">
          <div className="diagram-node customer">
            <span>Your browser</span>
            <small>Your database lives here</small>
          </div>
          <div className="diagram-bridge">
            <span>Your relay (self-hosted)</span>
            <small>Optional · TLS supported</small>
          </div>
          <div className="diagram-clients">
            <div>
              <span>Your tools</span>
              <small>Postgres TCP · psql · DBeaver</small>
            </div>
            <div>
              <span>LLMs</span>
              <small>LM Studio · Claude</small>
            </div>
            <div>
              <span>Your team</span>
              <small>Shared access</small>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-band" id="cta">
        <div>
          <p className="eyebrow">Ready to get started?</p>
          <h2>Your database is waiting.</h2>
          <p>
            Open db4 and your database starts automatically. Self-host the relay to connect external tools,
            install community apps, and keep your data in your browser.
          </p>
        </div>
        <div className="cta-links">
          <Link className="cta-chip" to="/database">
            Launch your database
            <span>Ready in seconds, no setup needed</span>
          </Link>
          <Link className="cta-chip" to="/recipes">
            Browse recipes
            <span>RAG, vector search, and more</span>
          </Link>
          <a className="cta-chip" href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
            Self-host the relay
            <span>Open source on GitHub</span>
          </a>
        </div>
      </section>

      <section className="persona-section" id="personas">
        <div className="section-heading">
          <p className="eyebrow">Who uses db4</p>
          <h2>Built for developers who value control</h2>
          <p>Keep your data local while connecting the tools you need.</p>
        </div>
        <div className="persona-grid">
          {personas.map((persona) => (
            <article className="persona-card" key={persona.name}>
              <header>
                <h3>{persona.name}</h3>
                <p>{persona.goal}</p>
              </header>
              <div className="persona-meta">
                <strong>db4 provides</strong>
                <ul>
                  {persona.weHost.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="persona-meta">
                <strong>You control</strong>
                <ul>
                  {persona.youHost.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="privacy-section" id="privacy">
        <div className="section-heading">
          <p className="eyebrow">Privacy & Security</p>
          <h2>Your data privacy is non-negotiable.</h2>
          <p>
            Your data stays in your browser. External access only happens through a relay that you run and control.
          </p>
        </div>
        <div className="privacy-grid">
          <article className="privacy-card">
            <div className="privacy-icon">🔐</div>
            <h3>TLS Encryption</h3>
            <p>
              The relay supports standard Postgres TLS when you configure a certificate, so SQL
              queries can be encrypted in transit between your tools and the relay.
            </p>
          </article>
          <article className="privacy-card">
            <div className="privacy-icon">🚫</div>
            <h3>No Hosted Infrastructure</h3>
            <p>
              There is no db4 cloud. The relay is open source and runs on infrastructure you choose,
              so your schema, data, and SQL queries never pass through a third-party service.
            </p>
          </article>
          <article className="privacy-card">
            <div className="privacy-icon">🏠</div>
            <h3>Browser-Resident Data</h3>
            <p>
              Your entire database lives in your browser's IndexedDB. Data never leaves your device
              unless you explicitly export it. No cloud storage, no data centers, no third-party
              access.
            </p>
          </article>
          <article className="privacy-card">
            <div className="privacy-icon">🔑</div>
            <h3>Password Authentication</h3>
            <p>
              Each browser session has a unique auth token (password) for security. The token is
              auto-generated and stored locally in your browser. You control who can access your
              database by sharing your Connection ID and Auth Token.
            </p>
          </article>
        </div>
      </section>

      <section className="tutorial" id="tutorial">
        <div className="section-heading">
          <p className="eyebrow">How it works</p>
          <h2>Three steps to get started</h2>
          <p>Your database is ready in seconds. Connect external tools when you need them.</p>
        </div>
        <div className="tutorial-steps">
          {tutorialSteps.map((step) => {
            // Display masked version, but copy original
            const displayCode = maskConnectionString(step.code)
            return (
              <article className="tutorial-step" key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
                <div style={{ position: 'relative' }}>
                  <pre style={{ margin: 0, paddingBottom: '2.5rem' }}>
                    <code>{displayCode}</code>
                  </pre>
                  <button
                    onClick={() => handleCopy(step.code)}
                    className="ghost-button small"
                    style={{
                      position: 'absolute',
                      bottom: '0.75rem',
                      right: '0.75rem',
                      backgroundColor: copied ? 'var(--accent)' : 'transparent',
                      color: copied ? '#050711' : 'inherit',
                      borderColor: copied ? 'var(--accent)' : 'var(--border)',
                      whiteSpace: 'nowrap'
                    }}
                    title={copied ? 'Copied!' : 'Copy to clipboard'}
                  >
                    {copied ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
        <div className="tutorial-note">
          <Link to="/database">Launch your database</Link> to get started, <Link to="/self-hosted">self-host the relay</Link> to connect external tools, or <Link to="/community-apps">browse community apps</Link> to extend your database.
        </div>
      </section>

      <section className="community-section" id="community">
        <div className="section-heading">
          <p className="eyebrow">Join the Community</p>
          <h2>Build apps together</h2>
          <p>
            Share your creations with the community! Contribute apps that extend db4 with new capabilities.
            From simple utilities to powerful integrations, your apps help everyone get more from their browser database.
          </p>
        </div>
        <div className="community-grid">
          <article className="community-card">
            <div className="community-icon">🚀</div>
            <h3>Easy to Contribute</h3>
            <p>
              Create apps with just three files: <code>recipe.json</code> (app metadata), <code>setup.sql</code>, and <code>instructions.md</code>.
              No complex setup needed—just your ideas and SQL knowledge.
            </p>
          </article>
          <article className="community-card">
            <div className="community-icon">🎨</div>
            <h3>Showcase Your Skills</h3>
            <p>
              Build apps that solve real problems. Share your database schemas, functions, and integrations
              with thousands of users. Get recognition for your contributions.
            </p>
          </article>
          <article className="community-card">
            <div className="community-icon">🤝</div>
            <h3>Help Others</h3>
            <p>
              Your apps help others discover new ways to use db4. From productivity tools to AI integrations,
              every contribution makes the platform more powerful.
            </p>
          </article>
          <article className="community-card">
            <div className="community-icon">📚</div>
            <h3>Learn & Grow</h3>
            <p>
              Explore existing apps to learn best practices. See how others structure schemas, create functions,
              and integrate with external services. Great for learning Postgres!
            </p>
          </article>
          <article className="community-card">
            <div className="community-icon">⚡</div>
            <h3>Quick Start</h3>
            <p>
              Fork the repository, create your app directory, add your files, and submit a PR. We'll review
              and help you polish your app before it goes live.
            </p>
          </article>
          <article className="community-card">
            <div className="community-icon">🌟</div>
            <h3>Open Source</h3>
            <p>
              All apps are open source and community-driven. See what others are building, get inspired,
              and contribute to the growing ecosystem of db4 extensions.
            </p>
          </article>
        </div>
        <div className="community-cta">
          <a
            href="https://github.com/maxabrahamsson/db4app-community-apps"
            target="_blank"
            rel="noopener noreferrer"
            className="cta-button"
          >
            <span style={{ marginRight: '0.5rem' }}>🔗</span>
            View on GitHub
          </a>
          <a
            href="https://github.com/maxabrahamsson/db4app-community-apps/blob/main/README.md"
            target="_blank"
            rel="noopener noreferrer"
            className="cta-button secondary"
          >
            <span style={{ marginRight: '0.5rem' }}>📖</span>
            Read Contribution Guide
          </a>
          <a
            href="https://discord.com/channels/1042483037042118696/1452455190136623185"
            target="_blank"
            rel="noopener noreferrer"
            className="cta-button secondary"
          >
            <span style={{ marginRight: '0.5rem' }}>💬</span>
            Join Discord Community
          </a>
        </div>
        <div className="community-features">
          <h3 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>What You Can Build</h3>
          <div className="community-features-grid">
            <div className="community-feature">
              <span className="feature-icon">🗄️</span>
              <strong>Database Schemas</strong>
              <p>Create tables, indexes, and functions</p>
            </div>
            <div className="community-feature">
              <span className="feature-icon">🔌</span>
              <strong>MCP Integrations</strong>
              <p>Connect LLMs with custom tools</p>
            </div>
            <div className="community-feature">
              <span className="feature-icon">📊</span>
              <strong>Analytics & Reports</strong>
              <p>Build dashboards and insights</p>
            </div>
            <div className="community-feature">
              <span className="feature-icon">🔄</span>
              <strong>Data Processing</strong>
              <p>Transform and analyze data</p>
            </div>
            <div className="community-feature">
              <span className="feature-icon">🔍</span>
              <strong>Search & Indexing</strong>
              <p>Full-text search and vector search</p>
            </div>
            <div className="community-feature">
              <span className="feature-icon">🎯</span>
              <strong>Productivity Tools</strong>
              <p>Todo lists, notes, and more</p>
            </div>
          </div>
        </div>
        <div className="community-examples">
          <p className="muted" style={{ textAlign: 'center', marginTop: '2rem' }}>
            <strong>Examples:</strong> Check out <Link to="/community-apps" style={{ color: 'var(--accent)' }}>existing apps</Link> like RAG with MCP,
            Todo List, and more to see what's possible!
          </p>
          <p className="muted" style={{ textAlign: 'center', marginTop: '1rem' }}>
            <strong>Questions?</strong> Join our <a
              href="https://discord.com/channels/1042483037042118696/1452455190136623185"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent)' }}
            >Discord community</a> to chat with other contributors and get help!
          </p>
        </div>
      </section>
    </main >
  )
}

