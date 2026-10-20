import { Link } from 'react-router-dom'
import '../App.css'
import { GITHUB_REPO_URL, SELF_HOST_DOCS_URL } from '../utils/projectLinks'

const features = [
  {
    icon: '🔓',
    title: 'Open Source',
    description: 'The web app, relay server, client SDK and MCP server are all open source. Read the code, fork it, run it anywhere.',
  },
  {
    icon: '🔒',
    title: 'Complete Privacy',
    description: 'Traffic only goes through a relay you run. There is no hosted db4 service in the middle.',
  },
  {
    icon: '🏠',
    title: 'Browser Is the Owner',
    description: 'Your data lives in the browser tab (PGlite / IndexedDB). The relay is just transport—access control stays in the tab.',
  },
  {
    icon: '⚡',
    title: 'Low Latency',
    description: 'Run the relay on localhost or your own network for direct, fast connections from your tools.',
  },
  {
    icon: '🛠️',
    title: 'Full Control',
    description: 'Configure ports, TLS certificates and allowed origins yourself. Deploy with Node.js or Docker.',
  },
  {
    icon: '🤖',
    title: 'MCP & Postgres Clients',
    description: 'Connect psql, DBeaver, TablePlus or MCP-enabled AI agents to your browser database through your relay.',
  },
] as const

const codeStyle = { margin: 0 } as const

export function SelfHostedPage() {
  return (
    <main className="landing self-hosted-page">
      <header className="hero self-hosted-hero">
        <div className="hero-copy">
          <p className="eyebrow">Self-Hosted Relay</p>
          <h1>
            <span className="hero-title-line1">Your Database.</span>
            <span className="hero-title-line2">Your Relay.</span>
          </h1>
          <p>
            The hosted db4 relay has been shut down and db4 is now open source. The database itself
            keeps running in your browser—nothing changes there. To connect external Postgres clients
            or MCP agents, run the relay yourself.
          </p>
          <ul className="hero-bullets">
            <li>Free and open source</li>
            <li>Runs on your machine, your network or your server</li>
            <li>Your browser data is unaffected by the hosted shutdown</li>
            <li>Not needed at all for browser-only use</li>
          </ul>
          <div className="cta-buttons">
            <a className="cta-button primary" href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
              View on GitHub
            </a>
            <a className="cta-button secondary" href={SELF_HOST_DOCS_URL} target="_blank" rel="noopener noreferrer">
              Self-hosting guide
            </a>
          </div>
          <span className="microcopy">No license, no account, no subscription.</span>
        </div>
        <div className="status-card self-hosted-preview">
          <div className="preview-header">
            <span className="preview-dots">
              <span className="dot red"></span>
              <span className="dot yellow"></span>
              <span className="dot green"></span>
            </span>
            <span className="preview-title">db4 relay (self-hosted)</span>
          </div>
          <div className="preview-content">
            <div className="preview-status">
              <span className="status-dot active"></span>
              <span>Relay Server Running</span>
            </div>
            <div className="preview-ports">
              <div className="preview-port">
                <span className="port-label">HTTP / WebSocket</span>
                <span className="port-value connected">8787 ✓</span>
              </div>
              <div className="preview-port">
                <span className="port-label">Postgres</span>
                <span className="port-value connected">6543 ✓</span>
              </div>
            </div>
            <div className="preview-connections">
              <span>1 browser connected</span>
              <span>2 clients connected</span>
            </div>
          </div>
        </div>
      </header>

      <section className="how-it-works-section" id="how-it-works">
        <div className="section-heading">
          <p className="eyebrow">How It Works</p>
          <h2>Up and running in minutes</h2>
          <p>See the README on GitHub for full details, TLS setup and Docker instructions.</p>
        </div>
        <div className="steps-grid">
          <article className="step-card">
            <div className="step-number">1</div>
            <h3>Clone the repo</h3>
            <pre className="code-block" style={codeStyle}>
              <code>{`git clone ${GITHUB_REPO_URL}.git\ncd db4app && npm install`}</code>
            </pre>
          </article>
          <article className="step-card">
            <div className="step-number">2</div>
            <h3>Start the relay</h3>
            <pre className="code-block" style={codeStyle}>
              <code>{`npm run relay\n# or\ndocker compose up`}</code>
            </pre>
            <p>Listens on HTTP/WebSocket port 8787 and Postgres port 6543 by default.</p>
          </article>
          <article className="step-card">
            <div className="step-number">3</div>
            <h3>Point this tab at it</h3>
            <p>
              The app connects to <code>ws://localhost:8787/agent</code> by default. For another host,
              set a custom relay URL on the <Link to="/database">Database page</Link> or build with{' '}
              <code>VITE_RELAY_AGENT_URL</code>.
            </p>
          </article>
          <article className="step-card">
            <div className="step-number">4</div>
            <h3>Connect your tools</h3>
            <p>
              Copy the connection string from the <Link to="/database">Database page</Link> and use it with
              psql, DBeaver, TablePlus or an MCP server.
            </p>
          </article>
        </div>
      </section>

      <section className="features-section" id="features">
        <div className="section-heading">
          <p className="eyebrow">Why self-host</p>
          <h2>Everything stays under your control</h2>
        </div>
        <div className="features-grid">
          {features.map((feature) => (
            <article className="feature-card" key={feature.title}>
              <div className="feature-icon">{feature.icon}</div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="faq-section" id="faq">
        <div className="section-heading">
          <p className="eyebrow">FAQ</p>
          <h2>Common questions</h2>
        </div>
        <div className="faq-grid">
          <article className="faq-card">
            <h3>What happened to my data?</h3>
            <p>
              Nothing. Your database lives in your browser's IndexedDB via PGlite and never lived on the
              hosted relay. Keep using it, or export it from the Database page.
            </p>
          </article>
          <article className="faq-card">
            <h3>Do I need a relay?</h3>
            <p>
              Only to connect external tools (Postgres clients, MCP agents). The in-browser database and
              playground work without one.
            </p>
          </article>
          <article className="faq-card">
            <h3>I bought a self-hosted license. What now?</h3>
            <p>
              The relay is now free and open source, so no license key is needed. Run it from the GitHub
              repository.
            </p>
          </article>
          <article className="faq-card">
            <h3>Can I contribute?</h3>
            <p>
              Yes—issues and pull requests are welcome on{' '}
              <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a>.
            </p>
          </article>
        </div>
      </section>

      <section className="cta-band self-hosted-cta" id="cta">
        <div>
          <p className="eyebrow">Ready to go local?</p>
          <h2>Take control of your data.</h2>
          <p>Clone the repo, start the relay, and connect your tools.</p>
        </div>
        <div className="cta-links">
          <a className="cta-chip primary" href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
            Get the source
            <span>github.com/maxabrahamsson/db4app</span>
          </a>
          <Link className="cta-chip" to="/database">
            Open your database
            <span>Works in the browser without a relay</span>
          </Link>
        </div>
      </section>
    </main>
  )
}
