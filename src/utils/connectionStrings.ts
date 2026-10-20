import { getRelayHost, getRelayPgPort, getCustomRelayUrl, isUsingCustomRelay } from './relayConfig'

export type ClientType = 'psql' | 'url' | 'dbeaver' | 'jdbc' | 'nodejs' | 'python' | 'tableplus'

export interface ConnectionStringOptions {
  connectionId: string | null
  authToken: string
  clientType: ClientType
}

const isLocalHost = (host: string) => {
  if (!host) return true
  const normalized = host.toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  )
}

/**
 * Get the effective relay host, considering custom relay URL
 */
const getEffectiveHost = (): string => {
  const customUrl = getCustomRelayUrl()
  if (customUrl) {
    try {
      const url = new URL(customUrl)
      return url.hostname
    } catch {
      // Fall through to default
    }
  }
  return getRelayHost()
}

/**
 * Check if we're using a local/custom relay
 */
const isLocalRelay = (): boolean => {
  if (isUsingCustomRelay()) {
    return true // Custom relay is always treated as local
  }
  return isLocalHost(getRelayHost())
}

// There is no hosted relay; connection strings always point at the self-hosted relay host.
const getConnectionHost = (): string => getEffectiveHost()

const getPort = (): string => {
  // Check for custom relay URL first
  const customUrl = getCustomRelayUrl()
  if (customUrl) {
    // Self-hosted relay app/CLI may report its Postgres port; CLI default is 5432
    try {
      const reported = localStorage.getItem('db4app-relay-pg-port')
      if (reported) return reported
    } catch {
      // ignore storage errors
    }
    return '5432'
  }

  return getRelayPgPort()
}

export const getConnectionString = (options: ConnectionStringOptions): string => {
  const { connectionId, authToken, clientType } = options
  const host = getConnectionHost()
  const port = getPort()
  const isLocal = isLocalRelay()
  
  // Note: Database name is required for routing since SNI doesn't work with Postgres clients
  // We keep it in code examples and explicit configs, but omit from URL formats where clients might handle it
  const dbName = connectionId || 'YOUR_CONNECTION_ID'
  
  // URL-encode the password for use in connection URLs
  const encodedPassword = encodeURIComponent(authToken)
  
  switch (clientType) {
    case 'psql':
      // Explicit dbname is needed for routing (Postgres clients don't send SNI)
      return `psql "host=${host} port=${port} user=postgres password=${authToken} dbname=${dbName}"`
    
    case 'url':
      return `postgres://postgres:${encodedPassword}@${host}:${port}/${dbName}`
    
    case 'dbeaver':
      // DBeaver: use "Connect by: URL" and paste this JDBC URL
      return `jdbc:postgresql://${host}:${port}/${dbName}?user=postgres&password=${encodedPassword}`
    
    case 'jdbc':
      // JDBC requires database in URL path for routing (SNI doesn't work)
      return `jdbc:postgresql://${host}:${port}/${dbName}?user=postgres&password=${encodedPassword}`
    
    case 'nodejs':
      // Code example - keep database explicit for clarity and routing
      return `const { Client } = require('pg');

const client = new Client({
  host: '${host}',
  port: ${port},
  database: '${dbName}',
  user: 'postgres',
  password: '${authToken}',
  ssl: ${isLocal ? 'false' : '{ rejectUnauthorized: true }'}
});

await client.connect();`
    
    case 'python':
      // Code example - keep database explicit for clarity and routing
      return `import psycopg2

conn = psycopg2.connect(
    host='${host}',
    port=${port},
    database='${dbName}',
    user='postgres',
    password='${authToken}',
    ${isLocal ? '' : "sslmode='require'"}
)`
    
    case 'tableplus':
      // TablePlus URL format with password (dbname needed for routing)
      return `postgres://postgres:${encodedPassword}@${host}:${port}/${dbName}`
    
    default:
      return `postgres://postgres:${encodedPassword}@${host}:${port}/${dbName}`
  }
}

export const getConnectionStringDescription = (clientType: ClientType): string => {
  switch (clientType) {
    case 'psql':
      return 'Command-line PostgreSQL client'
    case 'url':
      return 'Standard PostgreSQL connection URL'
    case 'dbeaver':
      return 'DBeaver database management tool'
    case 'jdbc':
      return 'Java Database Connectivity (JDBC)'
    case 'nodejs':
      return 'Node.js with node-postgres library'
    case 'python':
      return 'Python with psycopg2 library'
    case 'tableplus':
      return 'TablePlus database client'
    default:
      return 'PostgreSQL connection'
  }
}

export const getAllClientTypes = (): ClientType[] => {
  return ['psql', 'url', 'dbeaver', 'jdbc', 'nodejs', 'python', 'tableplus']
}

/**
 * Masks sensitive information (password, dbname) in connection strings for display
 * while preserving the structure. The original value should still be used for copying.
 */
export const maskConnectionString = (connectionString: string): string => {
  if (!connectionString) return connectionString
  
  let masked = connectionString
  
  // Mask passwords in postgres:// URLs: postgres://postgres:PASSWORD@host
  masked = masked.replace(
    /postgres:\/\/postgres:([^@]+)@/g,
    'postgres://postgres:****@'
  )
  
  // Mask passwords in psql format: password=TOKEN
  masked = masked.replace(
    /password=([^\s"']+)/gi,
    'password=****'
  )
  
  // Mask passwords in JDBC URLs: &password=TOKEN or ?password=TOKEN
  masked = masked.replace(
    /[?&]password=([^&\s]+)/gi,
    (match) => match.replace(/password=([^&\s]+)/i, 'password=****')
  )
  
  // Mask database names in URLs: /dbname or /dbname?
  masked = masked.replace(
    /\/([^\/\s?@]+)(?=\?|$|@)/g,
    (match, dbname) => {
      // Don't mask if it looks like a hostname (contains dots and no special chars)
      if (dbname.includes('.') && !dbname.includes('_') && !dbname.includes('-')) {
        return match
      }
      // Don't mask if it's a placeholder
      if (dbname === 'YOUR_CONNECTION_ID' || dbname.startsWith('YOUR_')) {
        return match
      }
      return '/****'
    }
  )
  
  // Mask dbname= in psql format
  masked = masked.replace(
    /dbname=([^\s"']+)/gi,
    'dbname=****'
  )
  
  // Mask database: in multi-line formats (DBeaver, Node.js, Python)
  masked = masked.replace(
    /^(\s*)database:\s*['"]?([^'",\s]+)['"]?/gim,
    '$1database: \'****\''
  )
  
  
  // Mask password: in code examples (Node.js, Python)
  masked = masked.replace(
    /^(\s*)password:\s*['"]([^'"]+)['"]/gim,
    '$1password: \'****\''
  )
  
  return masked
}


/**
 * Placeholder Postgres URL used in docs and community-app content.
 * Points at a self-hosted relay on localhost (server/index.js default Postgres port 6543).
 */
export const PLACEHOLDER_POSTGRES_URL = 'postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID'

// Matches the placeholder URL above, plus the legacy hosted form (YOUR_CONNECTION_ID.pg.db4.app)
const PLACEHOLDER_URL_PATTERN =
  /postgres:\/\/postgres:YOUR_AUTH_TOKEN@(?:YOUR_CONNECTION_ID\.pg\.db4\.app|localhost:6543\/YOUR_CONNECTION_ID)/g

/**
 * Replace connection placeholders in docs/app content with the real values for this tab's relay.
 */
export const replaceConnectionPlaceholders = (
  text: string,
  connectionId: string | null,
  authToken: string | null,
): string => {
  if (!text) return text
  const url = getConnectionString({
    connectionId,
    authToken: authToken || 'YOUR_AUTH_TOKEN',
    clientType: 'url',
  })
  return text
    .replace(PLACEHOLDER_URL_PATTERN, url)
    .replace(/YOUR_CONNECTION_ID_HERE/g, connectionId || 'YOUR_CONNECTION_ID_HERE')
    .replace(/YOUR_CONNECTION_ID/g, connectionId || 'YOUR_CONNECTION_ID')
    .replace(/YOUR_AUTH_TOKEN/g, authToken || 'YOUR_AUTH_TOKEN')
}
