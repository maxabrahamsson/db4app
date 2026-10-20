import type { PGlite } from '@electric-sql/pglite'

const READ_ONLY_ERROR = 'Database is in read-only mode'

/**
 * Keywords that indicate a write/DDL operation.
 * Checked against the first meaningful keyword in a SQL statement.
 */
const WRITE_KEYWORDS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'COPY',
])

/**
 * Detect whether a SQL string performs a write operation.
 * Strips leading whitespace, comments, and CTEs to find the first keyword.
 */
export function isWriteQuery(sql: string): boolean {
  // Strip leading whitespace
  let s = sql.trimStart()

  // Strip leading block comments (/* ... */)
  while (s.startsWith('/*')) {
    const end = s.indexOf('*/')
    if (end === -1) break
    s = s.slice(end + 2).trimStart()
  }

  // Strip leading line comments (-- ...)
  while (s.startsWith('--')) {
    const nl = s.indexOf('\n')
    if (nl === -1) return false // entire string is a comment
    s = s.slice(nl + 1).trimStart()
  }

  // Extract first keyword
  const match = s.match(/^([A-Za-z_]+)/)
  if (!match) return false

  const keyword = match[1].toUpperCase()

  // WITH could be a CTE wrapping a write (WITH ... INSERT/UPDATE/DELETE)
  if (keyword === 'WITH') {
    // Check if the body after the CTE(s) is a write
    // Simple heuristic: find last occurrence of a write keyword at statement level
    const upper = s.toUpperCase()
    for (const wk of WRITE_KEYWORDS) {
      if (upper.includes(wk)) return true
    }
    return false
  }

  return WRITE_KEYWORDS.has(keyword)
}

/**
 * Extract SQL string from a Parse ('P') wire protocol message.
 * Format: [type: 'P' (1 byte)][length: int32][statementName: cstring][query: cstring][numParams: int16][paramOIDs...]
 */
function extractSqlFromParseMessage(data: Uint8Array): string | null {
  if (data.length < 6 || data[0] !== 0x50) return null // Not a Parse message

  // Skip type (1) + length (4)
  let offset = 5

  // Skip statement name (null-terminated)
  while (offset < data.length && data[offset] !== 0) offset++
  offset++ // skip null terminator

  // Read query string (null-terminated)
  const start = offset
  while (offset < data.length && data[offset] !== 0) offset++

  if (offset === start) return null

  return new TextDecoder().decode(data.slice(start, offset))
}

/**
 * Wraps a PGlite instance with read-only enforcement via Proxy.
 * When isReadOnly() returns true, write queries throw an error before reaching PGlite.
 */
export function createGuardedDb(
  db: PGlite,
  opts: { isReadOnly: () => boolean }
): PGlite {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)

      if (prop === 'query') {
        return async function guardedQuery(sql: string, ...args: unknown[]) {
          if (opts.isReadOnly() && isWriteQuery(sql)) {
            throw new Error(READ_ONLY_ERROR)
          }
          return (target.query as Function).call(target, sql, ...args)
        }
      }

      if (prop === 'exec') {
        return async function guardedExec(sql: string, ...args: unknown[]) {
          if (opts.isReadOnly() && isWriteQuery(sql)) {
            throw new Error(READ_ONLY_ERROR)
          }
          return (target.exec as Function).call(target, sql, ...args)
        }
      }

      if (prop === 'execProtocol') {
        return async function guardedExecProtocol(
          message: Uint8Array,
          ...args: unknown[]
        ) {
          // Only check Parse messages (type 'P') — they contain the SQL
          if (opts.isReadOnly() && message.length > 0 && message[0] === 0x50) {
            const sql = extractSqlFromParseMessage(message)
            if (sql && isWriteQuery(sql)) {
              throw new Error(READ_ONLY_ERROR)
            }
          }
          return (target.execProtocol as Function).call(target, message, ...args)
        }
      }

      return value
    },
  })
}
