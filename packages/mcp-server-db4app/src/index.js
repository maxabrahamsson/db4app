#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import pg from 'pg'
const { Client } = pg

// Configuration via environment variables
const DEFAULT_POSTGRES_URL = process.env.MCP_POSTGRES_URL ?? null
const DEFAULT_EMBEDDING_URL = process.env.LM_STUDIO_EMBEDDING_URL ?? 'http://localhost:1234/v1/embeddings'
const DEFAULT_EMBEDDING_MODEL = process.env.LM_STUDIO_EMBEDDING_MODEL ?? ''
const MCP_CONNECTION_ID = process.env.MCP_CONNECTION_ID ?? null
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? null
// Relay used when building a URL from connectionId + authToken (defaults to a local relay)
const MCP_RELAY_HOST = process.env.MCP_RELAY_HOST || 'localhost'
const MCP_RELAY_PORT = process.env.MCP_RELAY_PORT || '5432'
// Optional: SNI routing domain of the relay (RELAY_PG_DOMAIN on the server), e.g. "pg.example.com".
// When set, URLs are built as CONNECTION_ID.<domain> with TLS instead of routing by database name.
const MCP_RELAY_PG_DOMAIN = process.env.MCP_RELAY_PG_DOMAIN || null
// Optional SSL override: "true" (verify certs), "no-verify", or "false". Unset = follow sslmode in the URL.
const MCP_POSTGRES_SSL = process.env.MCP_POSTGRES_SSL ?? null
const MCP_SCHEMA = process.env.MCP_SCHEMA ?? 'public' // Schema for RAG functions (remember, search_memory)

// Connection pool for Postgres clients (one per connection string)
const clientPool = new Map()

/**
 * Get or create a Postgres client for a connection string
 */
function getClient(postgresUrl) {
  if (!postgresUrl) {
    throw new Error('Postgres connection URL is required. Set MCP_POSTGRES_URL or pass postgresUrl in the tool call.')
  }

  if (clientPool.has(postgresUrl)) {
    return clientPool.get(postgresUrl)
  }

  const clientConfig = { connectionString: postgresUrl }
  if (MCP_POSTGRES_SSL === 'true') clientConfig.ssl = { rejectUnauthorized: true }
  else if (MCP_POSTGRES_SSL === 'no-verify') clientConfig.ssl = { rejectUnauthorized: false }
  else if (MCP_POSTGRES_SSL === 'false') clientConfig.ssl = false
  const client = new Client(clientConfig)

  clientPool.set(postgresUrl, client)
  return client
}

/**
 * Ensure client is connected
 */
async function ensureConnected(client) {
  // Check if client is already connected
  if (client._connected || client._ending) {
    return
  }
  
  // If not connected, connect with timeout
  if (!client._connected) {
    const connectPromise = client.connect()
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Postgres connection timed out after 10 seconds')), 10000)
    )
    
    await Promise.race([connectPromise, timeoutPromise])
  }
}

const mcpServer = new McpServer({
  name: 'db4app-bridge',
  version: '0.2.0',
})

const RunSqlSchema = z.object({
  sql: z.string().min(1).describe('SQL statement to execute against the browser-backed Postgres engine'),
  params: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .describe('Optional positional parameters for the SQL statement')
    .optional(),
  postgresUrl: z
    .string()
    .url()
    .describe('Override the Postgres connection URL (defaults to MCP_POSTGRES_URL). Format: postgres://postgres:AUTH_TOKEN@RELAY_HOST:PORT/CONNECTION_ID')
    .optional(),
  connectionId: z
    .string()
    .uuid()
    .describe('Browser connection ID (used to construct connection URL if postgresUrl not provided, defaults to MCP_CONNECTION_ID)')
    .optional(),
  authToken: z
    .string()
    .describe('Auth token for authentication (used to construct connection URL if postgresUrl not provided, defaults to MCP_AUTH_TOKEN)')
    .optional(),
})

const ListTablesSchema = z.object({
  schema: z.string().describe('Schema name to filter by (default: public)').optional(),
  postgresUrl: z
    .string()
    .url()
    .describe('Override the Postgres connection URL (defaults to MCP_POSTGRES_URL)')
    .optional(),
  connectionId: z
    .string()
    .uuid()
    .describe('Browser connection ID (used to construct connection URL if postgresUrl not provided)')
    .optional(),
  authToken: z
    .string()
    .describe('Auth token for authentication (used to construct connection URL if postgresUrl not provided)')
    .optional(),
})

const RememberSchema = z.object({
  content: z.string().min(1).describe('Information to remember and store in memory. This will be automatically embedded and indexed for semantic search.'),
  source: z.string().describe('Optional source identifier for this memory (e.g. "conversation", "user_input", file path)').optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .describe('Optional metadata to store alongside the memory (JSON object).')
    .optional(),
  postgresUrl: z
    .string()
    .url()
    .describe('Override the Postgres connection URL (defaults to MCP_POSTGRES_URL)')
    .optional(),
  embeddingUrl: z
    .string()
    .url()
    .describe('Override the LM Studio embedding endpoint (defaults to LM_STUDIO_EMBEDDING_URL or http://localhost:1234/v1/embeddings)')
    .optional(),
  embeddingModel: z.string().describe('Optional model name for embedding generation (defaults to LM_STUDIO_EMBEDDING_MODEL)').optional(),
  connectionId: z
    .string()
    .uuid()
    .describe('Browser connection ID (used to construct connection URL if postgresUrl not provided)')
    .optional(),
  authToken: z
    .string()
    .describe('Auth token for authentication (used to construct connection URL if postgresUrl not provided)')
    .optional(),
})

const SemanticSearchSchema = z.object({
  query: z.string().min(1).describe('Natural language query for semantic search'),
  embedding: z
    .array(z.number())
    .nonempty()
    .describe('Embedding for the query. If not provided, will be computed automatically using LM Studio.')
    .optional(),
  topK: z
    .number()
    .int()
    .positive()
    .max(100)
    .describe('Maximum number of matching chunks to return')
    .default(5),
  source: z.string().describe('Optional source identifier to filter results by').optional(),
  postgresUrl: z
    .string()
    .url()
    .describe('Override the Postgres connection URL (defaults to MCP_POSTGRES_URL)')
    .optional(),
  embeddingUrl: z
    .string()
    .url()
    .describe('Override the LM Studio embedding endpoint (used only if embedding is not provided)')
    .optional(),
  embeddingModel: z.string().describe('Optional model name for embedding generation (used only if embedding is not provided)').optional(),
  connectionId: z
    .string()
    .uuid()
    .describe('Browser connection ID (used to construct connection URL if postgresUrl not provided)')
    .optional(),
  authToken: z
    .string()
    .describe('Auth token for authentication (used to construct connection URL if postgresUrl not provided)')
    .optional(),
})

/**
 * Build Postgres connection URL from components
 */
function buildPostgresUrl(connectionId, authToken, providedUrl) {
  if (providedUrl) {
    return providedUrl
  }

  const effectiveConnectionId = connectionId ?? MCP_CONNECTION_ID
  const effectiveAuthToken = authToken ?? MCP_AUTH_TOKEN

  if (!effectiveConnectionId || !effectiveAuthToken) {
    if (DEFAULT_POSTGRES_URL) {
      return DEFAULT_POSTGRES_URL
    }
    throw new Error(
      'Postgres connection URL is required. Either provide postgresUrl, set MCP_POSTGRES_URL, or provide both connectionId and authToken (or set MCP_CONNECTION_ID and MCP_AUTH_TOKEN).',
    )
  }

  const password = encodeURIComponent(effectiveAuthToken)
  const connId = encodeURIComponent(effectiveConnectionId)
  if (MCP_RELAY_PG_DOMAIN) {
    // SNI routing: postgres://postgres:AUTH_TOKEN@CONNECTION_ID.<domain>:PORT/CONNECTION_ID?sslmode=require
    return `postgres://postgres:${password}@${connId}.${MCP_RELAY_PG_DOMAIN}:${MCP_RELAY_PORT}/${connId}?sslmode=require`
  }
  // Database-name routing: postgres://postgres:AUTH_TOKEN@HOST:PORT/CONNECTION_ID
  return `postgres://postgres:${password}@${MCP_RELAY_HOST}:${MCP_RELAY_PORT}/${connId}`
}


mcpServer.registerTool(
  'query_database',
  {
    description:
      'Execute SQL queries against the database. Use this when you need to SELECT data, INSERT rows, UPDATE records, DELETE data, CREATE tables, or run any other SQL statement. This is the primary tool for interacting with the database schema and data.',
    inputSchema: RunSqlSchema,
  },
  async ({ sql, params = [], postgresUrl, connectionId, authToken }) => {
    try {
      const url = buildPostgresUrl(connectionId, authToken, postgresUrl)
      const result = await executeSql(url, sql, params)
      return formatToolResult(result)
    } catch (error) {
      return mcpServer.createToolError(error instanceof Error ? error.message : String(error))
    }
  },
)

mcpServer.registerTool(
  'list_tables',
  {
    description:
      'List tables in the database. Use this when you need to discover what tables exist, explore the database schema, or find out what data is available before writing queries. Returns table names and their schemas.',
    inputSchema: ListTablesSchema,
  },
  async ({ schema, postgresUrl, connectionId, authToken }) => {
    const sql = `
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
        AND ($1::text IS NULL OR table_schema = $1::text)
      ORDER BY table_schema, table_name;
    `

    try {
      const url = buildPostgresUrl(connectionId, authToken, postgresUrl)
      const result = await executeSql(url, sql, [schema ?? null])
      return formatToolResult(result)
    } catch (error) {
      return mcpServer.createToolError(error instanceof Error ? error.message : String(error))
    }
  },
)

mcpServer.registerTool(
  'remember',
  {
    description:
      'Store information in long-term memory for later retrieval. Use this when the user tells you something they want you to remember, such as personal facts, preferences, context from previous conversations, or any information that should persist across sessions. Automatically generates embeddings and makes the content searchable via semantic search. Examples: "Remember that I prefer dark mode", "Remember that Max is from Sweden", "Remember my API key is...".',
    inputSchema: RememberSchema,
  },
  async ({ content, source = null, metadata = null, postgresUrl, embeddingUrl, embeddingModel, connectionId, authToken }) => {
    const rememberStartTime = Date.now()
    try {
      // Step 1: Generate embedding automatically
      console.log('[MCP] remember() - Step 1: Generating embedding...')
      const embeddingStartTime = Date.now()
      const embedding = await generateEmbedding(content, embeddingUrl, embeddingModel)
      const embeddingTime = Date.now() - embeddingStartTime
      console.log(`[MCP] remember() - Step 1 complete: Embedding generated in ${embeddingTime}ms (${embedding.length} dimensions)`)

      // Step 2: Index the document with the embedding
      // Use schema from environment variable (defaults to 'public')
      const schema = MCP_SCHEMA

      const sql = `
        INSERT INTO ${schema}.documents (source, chunk_index, content, metadata, embedding)
        VALUES ($1, $2, $3, $4::jsonb, $5::double precision[])
        RETURNING id, source, chunk_index, content;
      `
      const params = [source, null, content, metadata ? JSON.stringify(metadata) : null, embedding]

      console.log(`[MCP] remember() - Step 2: Inserting into database (embedding size: ${embedding.length})...`)
      const insertStartTime = Date.now()
      const url = buildPostgresUrl(connectionId, authToken, postgresUrl)
      const result = await executeSql(url, sql, params)
      const insertTime = Date.now() - insertStartTime
      const totalTime = Date.now() - rememberStartTime
      console.log(`[MCP] remember() - Step 2 complete: Inserted in ${insertTime}ms (total: ${totalTime}ms)`)

      // Step 3: Return confirmation
      const insertedRow = result.rows[0]
      return {
        content: [
          {
            type: 'text',
            text: `✅ Successfully stored in memory!\n\nID: ${insertedRow.id}\nSource: ${insertedRow.source ?? 'N/A'}\nContent: ${insertedRow.content}\n\nThis information is now searchable via semantic_search.`,
          },
        ],
      }
    } catch (error) {
      const totalTime = Date.now() - rememberStartTime
      console.error(`[MCP] remember() - Failed after ${totalTime}ms:`, error.message)
      return mcpServer.createToolError(error instanceof Error ? error.message : String(error))
    }
  },
)

mcpServer.registerTool(
  'search_memory',
  {
    description:
      'Search through previously stored memories and information using semantic similarity. Use this when the user asks about something you might have remembered earlier, or when you need to recall information from past conversations. Examples: "Where is Max from?", "What did I tell you about my preferences?", "What information do you have about X?". Automatically computes embeddings if not provided. Returns the most relevant stored information ranked by similarity.',
    inputSchema: SemanticSearchSchema,
  },
  async ({ query, embedding, topK, source = null, postgresUrl, embeddingUrl, embeddingModel, connectionId, authToken }) => {
    try {
      // Compute embedding if not provided
      let queryEmbedding = embedding
      if (!queryEmbedding) {
        queryEmbedding = await generateEmbedding(query, embeddingUrl, embeddingModel)
      }

      // Use schema from environment variable (defaults to 'public')
      const schema = MCP_SCHEMA

      const sql = `
      SELECT
        id,
        source,
        chunk_index,
        content,
        metadata,
        ${schema}.vector_cosine_similarity(embedding, $1::double precision[]) AS score
      FROM ${schema}.documents
      WHERE embedding IS NOT NULL
        AND ($2::text IS NULL OR source = $2::text)
      ORDER BY score DESC
      LIMIT $3::int;
    `
      const params = [queryEmbedding, source, topK]

      const url = buildPostgresUrl(connectionId, authToken, postgresUrl)
      const result = await executeSql(url, sql, params)
      // override command for nicer display
      result.command = 'RAG_SEMANTIC_SEARCH'
      return formatToolResult(result)
    } catch (error) {
      return mcpServer.createToolError(error instanceof Error ? error.message : String(error))
    }
  },
)

async function generateEmbedding(text, embeddingUrl, model) {
  const url = embeddingUrl ?? DEFAULT_EMBEDDING_URL
  const requestBody = {
    input: text,
  }
  if (model || DEFAULT_EMBEDDING_MODEL) {
    requestBody.model = model ?? DEFAULT_EMBEDDING_MODEL
  }

  let response
  try {
    // Add timeout to prevent hanging (30 seconds)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)
    
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
    
    clearTimeout(timeoutId)
  } catch (fetchError) {
    if (fetchError.name === 'AbortError') {
      throw new Error(
        `Embedding request timed out after 30 seconds. This usually means:\n` +
        `1. LM Studio is not responding (check if it's running)\n` +
        `2. The model is not an embedding model (you need an embedding model, not a chat model)\n` +
        `3. The embedding endpoint URL is incorrect\n\n` +
        `Current URL: ${url}\n` +
        `Model: ${model || DEFAULT_EMBEDDING_MODEL || 'not specified'}\n\n` +
        `Troubleshooting:\n` +
        `- Make sure LM Studio headless server is running\n` +
        `- Load an EMBEDDING model (e.g., "BAAI/bge-small-en-v1.5", "text-embedding-qwen3-embedding-4b")\n` +
        `- Check the embedding endpoint URL (default: http://localhost:1234/v1/embeddings)`
      )
    }
    const baseMessage =
      fetchError instanceof TypeError && fetchError.message.includes('fetch')
        ? `Failed to connect to LM Studio embedding endpoint at ${url}`
        : `Network error calling LM Studio embedding API: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`

    const suggestion = `\n\nTroubleshooting:\n1. Make sure LM Studio headless server is running\n2. Check what port it's using (default is 1234)\n3. Try different endpoint paths:\n   - http://localhost:1234/v1/embeddings\n   - http://localhost:1234/embeddings\n   - http://localhost:1234/api/embeddings\n4. Set LM_STUDIO_EMBEDDING_URL environment variable or pass embeddingUrl parameter\n5. Ensure an embedding-capable model is loaded in LM Studio`

    throw new Error(baseMessage + suggestion)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(
      `LM Studio embedding request failed (${response.status}): ${errorText}. Make sure LM Studio is running with an embedding-capable model loaded and the API server is enabled.`,
    )
  }

  const payload = await response.json()
  // LM Studio typically returns { data: [{ embedding: [...] }] }
  if (payload.data && Array.isArray(payload.data) && payload.data.length > 0) {
    return payload.data[0].embedding
  }
  // Some APIs return embedding directly
  if (Array.isArray(payload.embedding)) {
    return payload.embedding
  }
  throw new Error('Unexpected embedding response format from LM Studio')
}

async function executeSql(postgresUrl, sql, params = [], timeoutMs = 30000) {
  const client = getClient(postgresUrl)
  const startTime = Date.now()
  let connectionTime = 0
  let queryTime = 0

  try {
    // Measure connection time
    const connectionStart = Date.now()
    await ensureConnected(client)
    connectionTime = Date.now() - connectionStart

    // Detect if this is an INSERT with a large embedding array
    // Large arrays take longer to serialize and transmit, especially over network
    const hasLargeArray = params.some((p) => Array.isArray(p) && p.length > 1000)
    const isVeryLargeArray = params.some((p) => Array.isArray(p) && p.length > 2000)
    const largestArraySize = params.reduce((max, p) => {
      if (Array.isArray(p) && p.length > max) return p.length
      return max
    }, 0)
    
    // Use longer timeout for very large arrays (e.g., 2560-dim embeddings)
    const timeout = isVeryLargeArray ? 120000 : hasLargeArray ? 60000 : timeoutMs // 120s for very large, 60s for large, 30s default

    console.log('[MCP] Executing SQL:', { 
      postgresUrl: postgresUrl.replace(/:[^:@]+@/, ':****@'), 
      sql: sql.substring(0, 100) + '...',
      hasLargeArray,
      largestArraySize,
      timeout: `${timeout}ms`
    })

    // Measure query execution time
    const queryStart = Date.now()
    const queryPromise = client.query(sql, params)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Postgres query timed out after ${timeout / 1000} seconds`)), timeout)
    )
    
    const result = await Promise.race([queryPromise, timeoutPromise])
    queryTime = Date.now() - queryStart
    const totalTime = Date.now() - startTime


    // Convert pg result to our format
    return {
      columns: result.fields?.map((f) => f.name) ?? [],
      rows: result.rows ?? [],
      command: result.command ?? 'QUERY',
      rowCount: result.rowCount ?? 0,
    }
  } catch (error) {
    const totalTime = Date.now() - startTime
    const timedOut = error.message.includes('timed out')
    
    console.error('[MCP] Postgres error:', error.message)
    
    
    throw error
  }
}

function formatToolResult(result) {
  const { columns = [], rows = [], command = 'QUERY', rowCount = rows.length ?? 0 } = result
  const printableColumns = columns.length > 0 ? columns : Object.keys(rows[0] ?? {})
  const previewRows = rows.slice(0, 10)
  const header = printableColumns.join(' | ')
  const separator = printableColumns.map(() => '---').join(' | ')
  const body = previewRows
    .map((row) => printableColumns.map((column) => formatValue(row?.[column])).join(' | '))
    .join('\n')
  const truncated =
    rows.length > previewRows.length ? `\n… truncated (${rows.length - previewRows.length} more rows)` : ''

  const textOutput =
    `${command} • ${rowCount === 1 ? '1 row' : `${rowCount} rows`}\n` +
    (printableColumns.length ? `${header}\n${separator}\n${body}${truncated}` : 'No columns returned.')

  const jsonPreview = JSON.stringify(
    {
      columns: printableColumns,
      rows,
      command,
      rowCount,
    },
    null,
    2,
  )

  return {
    content: [
      {
        type: 'text',
        text: `${textOutput}\n\nJSON result:\n${jsonPreview}`,
      },
    ],
  }
}

function formatValue(value) {
  if (value === null || typeof value === 'undefined') return '∅'
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

async function main() {
  const transport = new StdioServerTransport()
  await mcpServer.connect(transport)
  console.error('[db4app-mcp-server] listening on stdio')
}

// Cleanup on process exit
process.on('SIGINT', () => {
  process.exit(0)
})

process.on('SIGTERM', () => {
  process.exit(0)
})

main().catch((error) => {
  console.error('[db4app-mcp-server] fatal', error)
  process.exit(1)
})
