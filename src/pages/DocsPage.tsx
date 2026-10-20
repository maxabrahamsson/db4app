import { useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import '../App.css'

// Import markdown content (we'll embed it for now)
const DOCS_CONTENT: Record<string, string> = {
  'users/encryption': `# TLS Encryption

The db4 relay supports TLS for Postgres TCP connections, so your SQL queries can be encrypted in transit between your client and the relay. This is the same encryption used by standard Postgres connections.

> **Note:** The hosted db4 relay has been shut down. You now run the relay yourself (see the GitHub README). TLS is enabled when the relay finds a certificate at \`TLS_CERT_PATH\` / \`TLS_KEY_PATH\`; without one, connections are unencrypted (fine for localhost).

## How It Works

1. **TLS Handshake**: When you connect to your database, a TLS handshake is performed (same as standard Postgres)
2. **Encrypted Transport**: All data (SQL queries, results, etc.) is encrypted using TLS at the transport level
3. **Relay Forwarding**: The relay terminates TLS and forwards Postgres protocol messages to your browser tab over WebSocket
4. **Standard Postgres Security**: Uses the same TLS encryption as any standard Postgres connection

## Security Benefits

- ✅ **You run the relay**: There is no third-party relay; it runs on infrastructure you control
- ✅ **Data privacy in transit**: SQL queries are encrypted between your client and the relay
- ✅ **Standard Postgres security**: Uses the same encryption as standard Postgres connections
- ✅ **Password authentication**: Each session has a unique auth token (password) for security

## Using TLS Encryption

### For MCP Servers

The db4app MCP server uses the **Postgres TCP protocol** with TLS encryption (same as \`psql\`). No additional configuration needed.

1. **Get your Connection ID and Auth Token**:
   - Open the Database page
   - Your **Connection ID** is displayed in the Connection Info section
   - Your **Auth Token** is also shown in the Connection Info section (this is your password)

2. **Configure MCP server**:
   Add this environment variable to your \`mcp.json\`:
   \`\`\`json
   {
     "env": {
       "MCP_POSTGRES_URL": "postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID"
     }
   }
   \`\`\`

3. **TLS Encryption**: Connections use TLS when your relay has a certificate configured

### For Postgres Clients

All standard Postgres clients (psql, DBeaver, TablePlus, JDBC, etc.) negotiate TLS automatically when the relay offers it:

\`\`\`bash
psql "postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID"
\`\`\`

## Password Authentication

Each browser session has a unique **Auth Token** that acts as the password:

- **Auto-generated**: Created when your database initializes
- **Persistent**: Stored in your browser's localStorage
- **Unique per session**: Each browser tab has its own token
- **Required for connection**: Must be included in the connection string

## Technical Details

- **Protocol**: TLS 1.2+ (same as standard Postgres)
- **Certificate**: Your relay provides the TLS certificate (\`TLS_CERT_PATH\` / \`TLS_KEY_PATH\`)
- **Cipher Suites**: Standard Postgres cipher suites
- **Authentication**: Password-based (auth token)

## Best Practices

1. **Keep auth token secure**: Never share your auth token publicly
2. **Use TLS**: Configure a certificate on your relay when it is reachable beyond localhost
3. **Verify connection**: Check that your client shows a secure connection
4. **Token rotation**: If you suspect compromise, refresh your browser to get a new token

## Troubleshooting

### Connection fails (MCP servers)

- Check that \`MCP_POSTGRES_URL\` is correctly set
- Verify the Connection ID and Auth Token match the ones in your browser
- Ensure your self-hosted relay is running and the browser tab is open and connected to it
- **Note**: MCP servers use Postgres TCP protocol with TLS encryption

### Password authentication failed

If you see \`FATAL: Password authentication failed\` when connecting:

1. **Get your Auth Token**: Open the Database page → Connection Info section
2. **Use the exact token**: Copy the token and use it in your connection string:
   \`\`\`bash
   psql "postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID"
   \`\`\`
3. **Token persistence**: The token is auto-generated and stored in your browser's localStorage
4. **Single error message**: You should see only ONE error message. If you see multiple errors, please report it as a bug.

### TLS connection errors

- Ensure your client supports TLS (all modern Postgres clients do)
- Check that you're using the correct hostname (Connection ID must match)
- Verify the relay server is accessible`,
  'users/recipe-security': `# Recipe Security for Users

## How We Protect Your Data

When you install recipes from the marketplace, your data is protected through multiple security layers.

## Schema Isolation

**Each recipe operates in its own isolated schema.**

- Recipe \`rag-mcp\` uses schema \`rag_mcp\`
- Recipe \`my-recipe\` uses schema \`my_recipe\`
- Your user tables in \`public\` schema are separate

This means:
- ✅ Recipe tables can't accidentally conflict with your data
- ✅ Recipes can't access your tables in other schemas
- ✅ You can safely uninstall recipes without affecting your data

## Table Whitelisting

**MCP servers can only access tables they're explicitly allowed to use.**

When a recipe includes an MCP server:
- The recipe defines which tables the MCP can access
- This whitelist is enforced by the relay server
- Any attempt to access non-whitelisted tables is blocked

Example:
- RAG recipe MCP can only access \`rag_mcp.documents\`
- It cannot access your \`todos\` table or any other user tables
- All SQL queries are validated before execution

## Security Enforcement

### Relay-Level Validation

The relay server validates every SQL query:
- Checks table references against the whitelist
- Blocks queries accessing unauthorized tables
- Prevents dangerous operations on your data

### MCP Server Restrictions

MCP servers:
- Only receive whitelist of allowed tables
- Can only query tables in their whitelist
- Cannot see or access your other tables

## What This Means for You

### ✅ Safe to Install

- Recipes are reviewed before appearing in marketplace
- Each recipe is isolated in its own schema
- MCP servers have minimal, explicit permissions

### ✅ Your Data is Protected

- Recipes cannot access your user tables
- MCP servers can only access their own recipe tables
- All queries are validated and blocked if unauthorized

### ✅ Easy to Uninstall

- Uninstalling a recipe only affects its own schema
- Your data in other schemas remains untouched
- You can safely experiment with recipes

## How to Verify

When you install a recipe:
1. Check the "Permissions" section (if shown)
2. Review which tables the MCP server can access
3. Verify it only lists tables in the recipe's schema

Example RAG recipe permissions:
- Allowed tables: \`rag_mcp.documents\` ✅
- Cannot access: \`public.todos\`, \`public.*\`, or any other tables ✅

## Reporting Issues

If you notice any security concerns:
1. Check the recipe's permissions
2. Verify it only accesses its own schema
3. Report any suspicious behavior

## Technical Details

For developers: See \`docs/architecture/recipe-security.md\`

For users: This page explains the security model in plain language.`,
}

function formatMarkdown(content: string): ReactNode {
  const lines = content.split('\n')
  const elements: ReactNode[] = []
  let currentParagraph: string[] = []
  let inCodeBlock = false
  let codeBlockContent: string[] = []

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const text = currentParagraph.join(' ')
      if (text.trim()) {
        elements.push(
          <p key={elements.length} className="doc-paragraph">
            {formatInlineMarkdown(text)}
          </p>,
        )
      }
      currentParagraph = []
    }
  }

  const flushCodeBlock = () => {
    if (codeBlockContent.length > 0) {
      elements.push(
        <pre key={elements.length} className="doc-code-block">
          <code>{codeBlockContent.join('\n')}</code>
        </pre>,
      )
      codeBlockContent = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // Code blocks - handle triple backticks (```)
    // In template strings, \`\`\` becomes ```, so we check for that
    // Match lines that are exactly ``` or start with ``` followed by optional language
    const isCodeBlockStart = trimmedLine === '```' || /^```\w*$/.test(trimmedLine) || trimmedLine.startsWith('```')
    if (isCodeBlockStart) {
      if (inCodeBlock) {
        // Closing code block
        flushCodeBlock()
        inCodeBlock = false
      } else {
        // Opening code block
        flushParagraph()
        // Language extraction removed (not currently used)
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      // Inside code block - add line as-is (preserve formatting)
      codeBlockContent.push(line)
      continue
    }

    // Headers
    if (line.startsWith('# ')) {
      flushParagraph()
      elements.push(
        <h1 key={elements.length} className="doc-h1">
          {formatInlineMarkdown(line.slice(2))}
        </h1>,
      )
      continue
    }
    if (line.startsWith('## ')) {
      flushParagraph()
      elements.push(
        <h2 key={elements.length} className="doc-h2">
          {formatInlineMarkdown(line.slice(3))}
        </h2>,
      )
      continue
    }
    if (line.startsWith('### ')) {
      flushParagraph()
      elements.push(
        <h3 key={elements.length} className="doc-h3">
          {formatInlineMarkdown(line.slice(4))}
        </h3>,
      )
      continue
    }

    // Unordered lists
    if (line.match(/^[-*]\s/)) {
      flushParagraph()
      const listItems: string[] = []
      let j = i
      while (j < lines.length && lines[j].match(/^[-*]\s/)) {
        listItems.push(lines[j].slice(2))
        j++
      }
      i = j - 1
      elements.push(
        <ul key={elements.length} className="doc-list">
          {listItems.map((item, idx) => (
            <li key={idx}>{formatInlineMarkdown(item)}</li>
          ))}
        </ul>,
      )
      continue
    }

    // Numbered/ordered lists (supports "1. " format)
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/)
    if (numberedMatch) {
      flushParagraph()
      const listItems: string[] = []
      let j = i
      
      // Collect consecutive numbered list items
      while (j < lines.length) {
        const match = lines[j].match(/^(\d+)\.\s+(.+)$/)
        if (match) {
          listItems.push(match[2])
          j++
        } else if (lines[j].trim() === '') {
          // Empty line - check if next line continues the list
          if (j + 1 < lines.length && lines[j + 1].match(/^\d+\.\s+/)) {
            j++ // Skip empty line, continue with next numbered item
            continue
          } else {
            break // Empty line and next isn't a list item - end of list
          }
        } else {
          break // Not a list item, end of list
        }
      }
      
      i = j - 1
      if (listItems.length > 0) {
        elements.push(
          <ol key={elements.length} className="doc-list">
            {listItems.map((item, idx) => (
              <li key={idx}>{formatInlineMarkdown(item.trim())}</li>
            ))}
          </ol>,
        )
      }
      continue
    }

    // Empty line
    if (!line.trim()) {
      flushParagraph()
      continue
    }

    // Regular paragraph
    currentParagraph.push(line)
  }

  flushParagraph()
  flushCodeBlock()

  return elements
}

function formatInlineMarkdown(text: string): ReactNode {
  const parts: ReactNode[] = []
  let currentIndex = 0

  // Match bold **text**
  const boldRegex = /\*\*(.+?)\*\*/g
  // Match code `text`
  const codeRegex = /`([^`]+)`/g
  // Match links [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g

  const matches: Array<{ type: 'bold' | 'code' | 'link'; start: number; end: number; content: string; url?: string }> = []

  let match
  while ((match = boldRegex.exec(text)) !== null) {
    matches.push({ type: 'bold', start: match.index, end: match.index + match[0].length, content: match[1] })
  }
  while ((match = codeRegex.exec(text)) !== null) {
    matches.push({ type: 'code', start: match.index, end: match.index + match[0].length, content: match[1] })
  }
  while ((match = linkRegex.exec(text)) !== null) {
    matches.push({ type: 'link', start: match.index, end: match.index + match[0].length, content: match[1], url: match[2] })
  }

  matches.sort((a, b) => a.start - b.start)

  for (const m of matches) {
    if (m.start > currentIndex) {
      parts.push(text.slice(currentIndex, m.start))
    }
    if (m.type === 'bold') {
      parts.push(<strong key={parts.length}>{m.content}</strong>)
    } else if (m.type === 'code') {
      parts.push(
        <code key={parts.length} className="doc-inline-code">
          {m.content}
        </code>,
      )
    } else if (m.type === 'link') {
      parts.push(
        <a key={parts.length} href={m.url} target="_blank" rel="noopener noreferrer" className="doc-link">
          {m.content}
        </a>,
      )
    }
    currentIndex = m.end
  }

  if (currentIndex < text.length) {
    parts.push(text.slice(currentIndex))
  }

  return parts.length > 0 ? parts : text
}

export function DocsPage() {
  const { '*': path } = useParams<{ '*': string }>()
  const content = path ? DOCS_CONTENT[path] : null

  if (!content) {
    return (
      <main className="landing">
        <div className="section-heading">
          <p className="eyebrow">Documentation</p>
          <h2>Page not found</h2>
          <p>The documentation page you're looking for doesn't exist.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="landing">
      <article className="doc-page">
        <div className="doc-content">{formatMarkdown(content)}</div>
      </article>
    </main>
  )
}

