#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import pg from 'pg'
const { Client } = pg

// Configuration via environment variables
const DEFAULT_POSTGRES_URL = process.env.MCP_POSTGRES_URL ?? null
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
const MCP_SCHEMA = process.env.MCP_SCHEMA ?? 'todo_mcp' // Schema for todo tables

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
  name: 'db4app-todo',
  version: '0.1.0',
})

const AddTodoSchema = z.object({
  title: z.string().min(1).describe('The title of the todo item'),
  description: z.string().describe('Optional description or additional details').optional(),
  category: z.string().describe('Optional category name (e.g., "Work", "Personal", "Shopping")').optional(),
  priority: z.number().int().min(0).max(2).describe('Priority level: 0=normal, 1=high, 2=urgent').default(0),
  due_date: z.string().describe('Optional due date in ISO format (e.g., "2024-12-31T23:59:59Z")').optional(),
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

const MarkAsDoneSchema = z.object({
  todo_id: z.number().int().positive().describe('The ID of the todo item to mark as completed'),
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

const ListTodosSchema = z.object({
  show_completed: z.boolean().describe('Whether to include completed todos in the results').default(true),
  category: z.string().describe('Optional category name to filter by').optional(),
  priority: z.number().int().min(0).max(2).describe('Optional priority level to filter by (0, 1, or 2)').optional(),
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

const RemoveTodoSchema = z.object({
  todo_id: z.number().int().positive().describe('The ID of the todo item to remove'),
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
  'add_todo',
  {
    description:
      'Add a new todo item to the list. Use this when the user wants to create a new task or reminder. You can specify title, description, category, priority, and due date.',
    inputSchema: AddTodoSchema,
  },
  async ({ title, description, category, priority = 0, due_date, postgresUrl, connectionId, authToken }) => {
    try {
      const url = buildPostgresUrl(connectionId, authToken, postgresUrl)
      const schema = MCP_SCHEMA

      // Get category_id if category name is provided
      let categoryId = null
      if (category) {
        const categoryResult = await executeSql(
          url,
          `SELECT id FROM ${schema}.categories WHERE name = $1 LIMIT 1`,
          [category],
        )
        if (categoryResult.rows.length > 0) {
          categoryId = categoryResult.rows[0].id
        } else {
          // Category doesn't exist, create it
          const insertCategoryResult = await executeSql(
            url,
            `INSERT INTO ${schema}.categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
            [category],
          )
          categoryId = insertCategoryResult.rows[0].id
        }
      }

      // Insert the todo
      const sql = `
        INSERT INTO ${schema}.todos (title, description, category_id, priority, due_date)
        VALUES ($1, $2, $3, $4, $5::timestamptz)
        RETURNING id, title, description, completed, priority, due_date, created_at;
      `
      const params = [title, description || null, categoryId, priority, due_date || null]

      const result = await executeSql(url, sql, params)
      const todo = result.rows[0]

      return {
        content: [
          {
            type: 'text',
            text: `✅ Todo added successfully!\n\nID: ${todo.id}\nTitle: ${todo.title}\n${description ? `Description: ${todo.description}\n` : ''}${category ? `Category: ${category}\n` : ''}Priority: ${priority === 0 ? 'Normal' : priority === 1 ? 'High' : 'Urgent'}\n${due_date ? `Due Date: ${due_date}\n` : ''}Created: ${todo.created_at}`,
          },
        ],
      }
    } catch (error) {
      return mcpServer.createToolError(error instanceof Error ? error.message : String(error))
    }
  },
)

mcpServer.registerTool(
  'mark_as_done',
  {
    description:
      'Mark a todo item as completed. Use this when the user wants to complete a task. Provide the todo ID.',
    inputSchema: MarkAsDoneSchema,
  },
  async ({ todo_id, postgresUrl, connectionId, authToken }) => {
    try {
      const url = buildPostgresUrl(connectionId, authToken, postgresUrl)
      const schema = MCP_SCHEMA

      const sql = `
        UPDATE ${schema}.todos
        SET completed = true
        WHERE id = $1
        RETURNING id, title, completed, completed_at;
      `

      const result = await executeSql(url, sql, [todo_id])

      if (result.rows.length === 0) {
        return mcpServer.createToolError(`Todo with ID ${todo_id} not found`)
      }

      const todo = result.rows[0]

      return {
        content: [
          {
            type: 'text',
            text: `✅ Todo marked as completed!\n\nID: ${todo.id}\nTitle: ${todo.title}\nCompleted at: ${todo.completed_at || 'now'}`,
          },
        ],
      }
    } catch (error) {
      return mcpServer.createToolError(error instanceof Error ? error.message : String(error))
    }
  },
)

mcpServer.registerTool(
  'list_todos',
  {
    description:
      'List todos with optional filters. Use this when the user wants to see their todos. You can filter by completion status, category, or priority.',
    inputSchema: ListTodosSchema,
  },
  async ({ show_completed = true, category, priority, postgresUrl, connectionId, authToken }) => {
    try {
      const url = buildPostgresUrl(connectionId, authToken, postgresUrl)
      const schema = MCP_SCHEMA

      // Use the list_todos function from the schema
      const sql = `SELECT * FROM ${schema}.list_todos($1, $2, $3)`
      const params = [show_completed, category || null, priority ?? null]

      const result = await executeSql(url, sql, params)

      if (result.rows.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No todos found matching the criteria.',
            },
          ],
        }
      }

      const todos = result.rows.map((todo) => {
        const priorityText = todo.priority === 0 ? 'Normal' : todo.priority === 1 ? 'High' : 'Urgent'
        const status = todo.completed ? '✅ Completed' : '⏳ Pending'
        return `ID: ${todo.id} | ${status} | Priority: ${priorityText}\nTitle: ${todo.title}\n${todo.description ? `Description: ${todo.description}\n` : ''}${todo.category_name ? `Category: ${todo.category_name}\n` : ''}${todo.due_date ? `Due: ${todo.due_date}\n` : ''}Created: ${todo.created_at}`
      }).join('\n\n')

      return {
        content: [
          {
            type: 'text',
            text: `Found ${result.rows.length} todo(s):\n\n${todos}`,
          },
        ],
      }
    } catch (error) {
      return mcpServer.createToolError(error instanceof Error ? error.message : String(error))
    }
  },
)

mcpServer.registerTool(
  'remove_todo',
  {
    description:
      'Remove a todo item from the list. Use this when the user wants to delete a task. Provide the todo ID.',
    inputSchema: RemoveTodoSchema,
  },
  async ({ todo_id, postgresUrl, connectionId, authToken }) => {
    try {
      const url = buildPostgresUrl(connectionId, authToken, postgresUrl)
      const schema = MCP_SCHEMA

      // First, get the todo to confirm it exists
      const getTodoSql = `SELECT id, title FROM ${schema}.todos WHERE id = $1`
      const getTodoResult = await executeSql(url, getTodoSql, [todo_id])

      if (getTodoResult.rows.length === 0) {
        return mcpServer.createToolError(`Todo with ID ${todo_id} not found`)
      }

      const todo = getTodoResult.rows[0]

      // Delete the todo
      const deleteSql = `DELETE FROM ${schema}.todos WHERE id = $1`
      await executeSql(url, deleteSql, [todo_id])

      return {
        content: [
          {
            type: 'text',
            text: `✅ Todo removed successfully!\n\nID: ${todo.id}\nTitle: ${todo.title}`,
          },
        ],
      }
    } catch (error) {
      return mcpServer.createToolError(error instanceof Error ? error.message : String(error))
    }
  },
)

async function executeSql(postgresUrl, sql, params = [], timeoutMs = 30000) {
  const client = getClient(postgresUrl)
  const startTime = Date.now()

  try {
    await ensureConnected(client)

    const queryPromise = client.query(sql, params)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Postgres query timed out after ${timeoutMs / 1000} seconds`)), timeoutMs)
    )
    
    const result = await Promise.race([queryPromise, timeoutPromise])
    const totalTime = Date.now() - startTime

    // Convert pg result to our format
    return {
      columns: result.fields?.map((f) => f.name) ?? [],
      rows: result.rows ?? [],
      command: result.command ?? 'QUERY',
      rowCount: result.rowCount ?? 0,
    }
  } catch (error) {
    console.error('[MCP] Postgres error:', error.message)
    throw error
  }
}

async function main() {
  const transport = new StdioServerTransport()
  await mcpServer.connect(transport)
  console.error('[db4app-todo-mcp-server] listening on stdio')
}

main().catch((error) => {
  console.error('[db4app-todo-mcp-server] fatal', error)
  process.exit(1)
})


