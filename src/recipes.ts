import type { PGlite } from '@electric-sql/pglite'

export interface CommunityApp {
  id: string
  name: string
  description: string
  version: string
  author: string
  category: string
  tags: string[]
  schema: string // Isolated schema name (e.g., "rag_mcp")
  setup: {
    sql: string // Embedded SQL after review (includes schema creation)
    instructions: string // Embedded markdown instructions after review
  }
  requirements?: {
    mcpServer?: boolean
    embeddingService?: string
  }
  permissions: {
    allowedTables: string[] // Whitelist of schema.table that MCP can access
    allowedSchemas: string[] // Schemas this app can access
    readOnly?: boolean // If true, MCP can only read
  }
  mcpServer?: {
    npmPackage: string
    command: string
    args: string[]
    env?: Record<string, string>
    notes?: {
      embeddingModel?: string
    }
  }
}

export interface InstalledApp {
  appId: string
  installedAt: string
  version: string
}

// Curated community apps registry - all apps here have been reviewed and approved
// SQL and instructions are embedded after maintainer review
const CURATED_APPS: CommunityApp[] = [
  {
    id: 'rag-mcp',
    name: 'RAG with MCP Server',
    description:
      'Enable Retrieval Augmented Generation (RAG) capabilities with semantic search. Includes vector similarity functions and integration with LM Studio via MCP.',
    version: '1.0.0',
    author: 'db4app',
    category: 'ai',
    tags: ['rag', 'embeddings', 'mcp', 'lm-studio', 'vector-search'],
    schema: 'rag_mcp',
    setup: {
      sql: `-- RAG Community App: Create isolated schema and tables
-- This app enables semantic search capabilities in your browser database
-- All objects are created in the rag_mcp schema for isolation

CREATE SCHEMA IF NOT EXISTS rag_mcp;

-- Create documents table for storing embeddings
CREATE TABLE IF NOT EXISTS rag_mcp.documents (
  id serial PRIMARY KEY,
  source text,
  chunk_index integer,
  content text NOT NULL,
  metadata jsonb,
  embedding double precision[]
);

-- Vector dot product function
CREATE OR REPLACE FUNCTION rag_mcp.vector_dot(a double precision[], b double precision[])
RETURNS double precision AS $$
  SELECT SUM(ai * bi)
  FROM unnest(a) WITH ORDINALITY AS x(ai, idx)
  JOIN unnest(b) WITH ORDINALITY AS y(bi, idx2) ON idx = idx2;
$$ LANGUAGE sql IMMUTABLE;

-- Vector norm (magnitude) function
CREATE OR REPLACE FUNCTION rag_mcp.vector_norm(a double precision[])
RETURNS double precision AS $$
  SELECT sqrt(SUM(ai * ai))
  FROM unnest(a) AS x(ai);
$$ LANGUAGE sql IMMUTABLE;

-- Vector cosine similarity function
CREATE OR REPLACE FUNCTION rag_mcp.vector_cosine_similarity(a double precision[], b double precision[])
RETURNS double precision AS $$
  SELECT CASE
    WHEN rag_mcp.vector_norm(a) = 0 OR rag_mcp.vector_norm(b) = 0 THEN 0
    ELSE rag_mcp.vector_dot(a, b) / (rag_mcp.vector_norm(a) * rag_mcp.vector_norm(b))
  END;
$$ LANGUAGE sql IMMUTABLE;

-- Create index for better performance on large document sets
CREATE INDEX IF NOT EXISTS documents_embedding_idx ON rag_mcp.documents USING gin (embedding);`,
      instructions: `# RAG with MCP Server - Setup Instructions

This community app enables Retrieval Augmented Generation (RAG) capabilities in your browser database, allowing you to store and search through memories using semantic similarity.

## What This App Installs

- \`rag_mcp\` schema (isolated from other apps)
- \`documents\` table for storing text with embeddings
- Vector similarity functions (\`vector_dot\`, \`vector_norm\`, \`vector_cosine_similarity\`)
- GIN index for efficient embedding searches

## MCP Server Setup

The MCP server is available as an npm package and can be run with \`npx\` (no installation needed).

### Add to LM Studio mcp.json

1. Locate your \`mcp.json\` file:
   - **macOS:** \`~/Library/Application Support/LM Studio/mcp.json\`
   - **Windows:** \`%APPDATA%\\LM Studio\\mcp.json\`
   - **Linux:** \`~/.config/LM Studio/mcp.json\`

2. **Get your Connection ID and Auth Token**:
   - Open the Database page in your browser
   - Wait for the relay connection to establish (you'll see "Relay connected" status)
   - Your **Connection ID** is displayed in the Connection Info section (e.g., \`a1b2c3d4-e5f6-...\`)
   - Your **Auth Token** is also shown in the Connection Info section (this is your password)

3. Add this configuration to the \`mcpServers\` object:

\`\`\`json
{
  "mcpServers": {
    "db4app": {
      "command": "npx",
      "args": [
        "-y",
        "db4app-mcp-server@0.1.9"
      ],
      "env": {
        "MCP_POSTGRES_URL": "postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID",
        "LM_STUDIO_EMBEDDING_URL": "http://localhost:1234/v1/embeddings",
        "LM_STUDIO_EMBEDDING_MODEL": "text-embedding-qwen3-embedding-4b",
        "MCP_SCHEMA": "rag_mcp"
      }
    }
  }
}
\`\`\`

**Important Notes**: 
- Replace \`YOUR_AUTH_TOKEN\` with your actual auth token from step 2
- Replace \`YOUR_CONNECTION_ID\` with your Connection ID from step 2
- The connection string format is: \`postgres://postgres:AUTH_TOKEN@RELAY_HOST:RELAY_PG_PORT/CONNECTION_ID\`
- Each browser tab has its own unique Connection ID and Auth Token - make sure you use the correct ones
- **Postgres TCP Protocol**: The MCP server uses the standard Postgres wire protocol with TLS encryption, just like \`psql\` or DBeaver

4. **Install an Embedding Model** (Required):
   - Open LM Studio and go to the **Search** tab
   - Search for embedding models (try: "text-embedding", "embedding", "bge", "e5")
   - Popular options:
     - \`BAAI/bge-small-en-v1.5\` (recommended, small and fast)
     - \`BAAI/bge-base-en-v1.5\` (better quality, larger)
     - \`intfloat/e5-small-v2\` (alternative option)
   - Download and load the model in LM Studio
   - Note the **exact model name** (e.g., \`BAAI/bge-small-en-v1.5\`)

5. **Configure the Embedding Model**:
   - The example configuration uses \`text-embedding-qwen3-embedding-4b\` as the default
   - If you're using a different model, update the \`LM_STUDIO_EMBEDDING_MODEL\` value in your \`mcp.json\` with your model name:
     \`\`\`json
     "LM_STUDIO_EMBEDDING_MODEL": "your-model-name-here"
     \`\`\`
   - Popular alternatives:
     - \`BAAI/bge-small-en-v1.5\` (recommended, small and fast)
     - \`BAAI/bge-base-en-v1.5\` (better quality, larger)
     - \`intfloat/e5-small-v2\` (alternative option)

6. **Enable Headless Server Mode**:
   - In LM Studio, enable **headless server mode**
   - Make sure the embedding model is loaded
   - Note the server port (default is 1234)

7. **Restart LM Studio** to load the new MCP server configuration.

**Note:** The \`-y\` flag in args tells npx to automatically accept the package installation prompt, making it truly zero-install.

## Security & Permissions

This recipe operates in an isolated schema (\`rag_mcp\`) and the MCP server can only access the \`rag_mcp.documents\` table. This ensures your other data remains secure.

The MCP server uses:
- **TLS encryption**: All connections are encrypted using TLS (same as \`psql\` with SSL)
- **Password authentication**: Uses the auth token as the password
- **Schema isolation**: Operates in the \`rag_mcp\` schema, isolated from your other data

## Usage Example

Once configured, you can use these MCP tools in LM Studio:

- \`remember\` - Store information in memory (auto-generates embeddings). Supports embeddings of any size, including large models like Qwen (2560 dimensions).
- \`search_memory\` - Search through stored memories using semantic similarity. Works with embeddings of any size.
- \`query_database\` - Execute SQL queries
- \`list_tables\` - Explore database schema

In LM Studio, you can now say:

- "Remember that I prefer dark mode"
- "Remember that Max is from Sweden"
- "Where is Max from?" (will use \`search_memory\` to find the answer)

## Troubleshooting

### Embeddings Fail

1. Ensure LM Studio headless server is running
2. Check the embedding endpoint URL (may vary by LM Studio version)
3. Try alternative endpoints:
   - \`http://localhost:1234/v1/embeddings\`
   - \`http://localhost:1234/embeddings\`
   - \`http://localhost:1234/api/embeddings\`
4. Verify an embedding-capable model is loaded
5. Check the relay is running: \`npm run relay\`

### Connection Issues

- **Postgres TCP Protocol**: The MCP server uses the standard Postgres wire protocol with TLS encryption, just like \`psql\` or DBeaver
- **Connection String Format**: \`postgres://postgres:AUTH_TOKEN@RELAY_HOST:RELAY_PG_PORT/CONNECTION_ID\`
- **Auth Token Required**: You must provide the auth token in the connection string (it's your password)
- **TLS Encryption**: Connections are automatically encrypted using TLS (no additional configuration needed)

### Password Authentication Failed

If you see \`FATAL: Password authentication failed\`:

1. **Get your Auth Token**: Open the Database page → Connection Info section
2. **Use the exact token**: Copy the token and use it in your connection string
3. **Token persistence**: The token is auto-generated and stored in your browser's localStorage
4. **Single error message**: You should see only ONE error message. If you see multiple errors, please report it as a bug.

## Uninstalling

To remove this app, run:

\`\`\`sql
DROP SCHEMA IF EXISTS rag_mcp CASCADE;
\`\`\``,
    },
    permissions: {
      allowedTables: ['rag_mcp.documents'],
      allowedSchemas: ['rag_mcp'],
      readOnly: false,
    },
    requirements: {
      mcpServer: true,
      embeddingService: 'lm-studio',
    },
    mcpServer: {
      npmPackage: 'db4app-mcp-server',
      command: 'npx',
      args: ['-y', 'db4app-mcp-server@0.1.9'],
      env: {
        MCP_POSTGRES_URL: 'postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID',
        LM_STUDIO_EMBEDDING_URL: 'http://localhost:1234/v1/embeddings',
        LM_STUDIO_EMBEDDING_MODEL: 'text-embedding-qwen3-embedding-4b',
        MCP_SCHEMA: 'rag_mcp',
      },
      notes: {
        embeddingModel:
          'You must install an embedding-capable model in LM Studio and set LM_STUDIO_EMBEDDING_MODEL to the model name.',
      },
    },
  },
  {
    id: 'sample-todo',
    name: 'Sample Todo List',
    description:
      'A simple todo list app demonstrating db4 capabilities. Perfect for learning how to create apps!',
    version: '1.0.0',
    author: 'db4app',
    category: 'productivity',
    tags: ['todo', 'tasks', 'sample', 'example', 'learning'],
    schema: 'sample_todo',
    setup: {
      sql: `-- Sample Todo List App
-- This is a demonstration app showing how to create apps for db4
-- It includes: schema creation, tables, functions, indexes, and triggers

-- Create isolated schema (always use IF NOT EXISTS)
CREATE SCHEMA IF NOT EXISTS sample_todo;

-- Create categories table
CREATE TABLE IF NOT EXISTS sample_todo.categories (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  color text, -- Optional color for UI
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create todos table
CREATE TABLE IF NOT EXISTS sample_todo.todos (
  id serial PRIMARY KEY,
  title text NOT NULL,
  description text,
  category_id integer REFERENCES sample_todo.categories(id) ON DELETE SET NULL,
  completed boolean NOT NULL DEFAULT false,
  priority integer DEFAULT 0, -- 0 = normal, 1 = high, 2 = urgent
  due_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS todos_category_idx ON sample_todo.todos(category_id);
CREATE INDEX IF NOT EXISTS todos_completed_idx ON sample_todo.todos(completed);
CREATE INDEX IF NOT EXISTS todos_priority_idx ON sample_todo.todos(priority);
CREATE INDEX IF NOT EXISTS todos_due_date_idx ON sample_todo.todos(due_date) WHERE due_date IS NOT NULL;

-- Function: Get todo statistics
CREATE OR REPLACE FUNCTION sample_todo.get_stats()
RETURNS TABLE (
  total_todos integer,
  completed_todos integer,
  pending_todos integer,
  high_priority_todos integer
) AS $$
  SELECT 
    COUNT(*)::integer as total_todos,
    COUNT(*) FILTER (WHERE completed = true)::integer as completed_todos,
    COUNT(*) FILTER (WHERE completed = false)::integer as pending_todos,
    COUNT(*) FILTER (WHERE completed = false AND priority >= 1)::integer as high_priority_todos
  FROM sample_todo.todos;
$$ LANGUAGE sql;

-- Function: Get todos by category
CREATE OR REPLACE FUNCTION sample_todo.get_todos_by_category(category_name text)
RETURNS TABLE (
  id integer,
  title text,
  description text,
  completed boolean,
  priority integer,
  due_date timestamptz
) AS $$
  SELECT 
    t.id,
    t.title,
    t.description,
    t.completed,
    t.priority,
    t.due_date
  FROM sample_todo.todos t
  JOIN sample_todo.categories c ON t.category_id = c.id
  WHERE c.name = category_name
  ORDER BY t.priority DESC, t.created_at DESC;
$$ LANGUAGE sql;

-- Function: Mark todo as completed
CREATE OR REPLACE FUNCTION sample_todo.complete_todo(todo_id integer)
RETURNS void AS $$
  UPDATE sample_todo.todos
  SET 
    completed = true,
    completed_at = now()
  WHERE id = todo_id;
$$ LANGUAGE sql;

-- Trigger: Auto-update completed_at timestamp
CREATE OR REPLACE FUNCTION sample_todo.update_completed_at()
RETURNS trigger AS $$
BEGIN
  IF NEW.completed = true AND OLD.completed = false THEN
    NEW.completed_at := now();
  ELSIF NEW.completed = false THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER todo_completed_trigger
  BEFORE UPDATE ON sample_todo.todos
  FOR EACH ROW
  EXECUTE FUNCTION sample_todo.update_completed_at();

-- Insert sample data (optional - for demonstration)
INSERT INTO sample_todo.categories (name, color) VALUES
  ('Work', '#3b82f6'),
  ('Personal', '#10b981'),
  ('Shopping', '#f59e0b')
ON CONFLICT (name) DO NOTHING;

INSERT INTO sample_todo.todos (title, description, category_id, priority) VALUES
  ('Learn db4', 'Explore the platform and create my first app', 1, 1),
  ('Buy groceries', 'Milk, eggs, bread', 3, 0),
  ('Exercise', 'Go for a 30-minute walk', 2, 0)
ON CONFLICT DO NOTHING;`,
      instructions: `# Sample Todo List App

This is a **sample app** designed to help you learn how to create apps for db4. It demonstrates:

- ✅ Schema isolation
- ✅ Table creation with relationships
- ✅ Custom SQL functions
- ✅ Indexes for performance
- ✅ Triggers for automation
- ✅ Sample data insertion

## What This App Installs

- **\`sample_todo\` schema** - Isolated from other apps
- **\`categories\` table** - Organize todos by category
- **\`todos\` table** - Store your todo items
- **Custom functions** - Get statistics, filter by category, mark as complete
- **Indexes** - Fast queries on common fields
- **Triggers** - Auto-update completion timestamps

## Installation

1. Go to the **Community Apps** page in db4
2. Find "Sample Todo List" in the marketplace
3. Click **Install app**
4. The schema and tables will be created automatically

## Usage Examples

### View All Todos

\`\`\`sql
SELECT * FROM sample_todo.todos
ORDER BY priority DESC, created_at DESC;
\`\`\`

### Get Statistics

\`\`\`sql
SELECT * FROM sample_todo.get_stats();
\`\`\`

This returns:
- Total number of todos
- Number of completed todos
- Number of pending todos
- Number of high-priority pending todos

### Add a New Todo

\`\`\`sql
INSERT INTO sample_todo.todos (title, description, category_id, priority)
VALUES (
  'Finish my project',
  'Complete the documentation',
  (SELECT id FROM sample_todo.categories WHERE name = 'Work'),
  1  -- High priority
);
\`\`\`

### Mark a Todo as Complete

\`\`\`sql
-- Using the function
SELECT sample_todo.complete_todo(1);

-- Or directly
UPDATE sample_todo.todos
SET completed = true
WHERE id = 1;
\`\`\`

### Get Todos by Category

\`\`\`sql
SELECT * FROM sample_todo.get_todos_by_category('Work');
\`\`\`

### Add a New Category

\`\`\`sql
INSERT INTO sample_todo.categories (name, color)
VALUES ('Health', '#ef4444');
\`\`\`

### Query with Joins

\`\`\`sql
SELECT 
  t.title,
  t.completed,
  c.name as category,
  c.color as category_color
FROM sample_todo.todos t
LEFT JOIN sample_todo.categories c ON t.category_id = c.id
WHERE t.completed = false
ORDER BY t.priority DESC;
\`\`\`

## Features Demonstrated

### 1. Schema Isolation

All objects are created in the \`sample_todo\` schema, preventing conflicts with other apps:

\`\`\`sql
CREATE SCHEMA IF NOT EXISTS sample_todo;
CREATE TABLE sample_todo.todos (...);
\`\`\`

### 2. Foreign Key Relationships

The \`todos\` table references \`categories\`:

\`\`\`sql
category_id integer REFERENCES sample_todo.categories(id) ON DELETE SET NULL
\`\`\`

### 3. Custom Functions

Functions encapsulate common operations:

\`\`\`sql
SELECT * FROM sample_todo.get_stats();
SELECT * FROM sample_todo.get_todos_by_category('Work');
SELECT sample_todo.complete_todo(1);
\`\`\`

### 4. Indexes for Performance

Indexes are created on frequently queried columns:

\`\`\`sql
CREATE INDEX todos_completed_idx ON sample_todo.todos(completed);
CREATE INDEX todos_priority_idx ON sample_todo.todos(priority);
\`\`\`

### 5. Triggers for Automation

A trigger automatically updates \`completed_at\` when a todo is marked complete:

\`\`\`sql
-- This happens automatically when you update completed = true
UPDATE sample_todo.todos SET completed = true WHERE id = 1;
-- completed_at is set automatically by the trigger
\`\`\`

## Connecting External Tools

You can connect external tools (like DBeaver, TablePlus, or psql) to your database using this connection string:

\`\`\`
postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID
\`\`\`

**Note:** The placeholders \`YOUR_AUTH_TOKEN\` and \`YOUR_CONNECTION_ID\` are automatically replaced with your actual values when displayed in the db4 interface. You can find these values on the **Database** page.

### Example: Using psql

\`\`\`bash
psql "postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID"
\`\`\`

Once connected, you can run SQL queries:

\`\`\`sql
-- List all todos
SELECT * FROM sample_todo.todos;

-- Get statistics
SELECT * FROM sample_todo.get_stats();
\`\`\`

## Uninstalling

To remove this app:

\`\`\`sql
DROP SCHEMA IF EXISTS sample_todo CASCADE;
\`\`\`

**Warning:** This will delete all todos and categories! Make sure to export your data first if needed.

## Learning Resources

This sample app demonstrates best practices for creating db4 apps:

1. **Schema Isolation** - Always use your own schema
2. **IF NOT EXISTS** - Allow safe re-installation
3. **Indexes** - Improve query performance
4. **Functions** - Encapsulate common operations
5. **Triggers** - Automate data updates
6. **Documentation** - Clear instructions help users

## Next Steps

Now that you've seen this sample app:

1. **Explore the code** - Look at \`setup.sql\` to see how it's structured
2. **Modify it** - Try adding your own functions or tables
3. **Create your own** - Use this as a template for your app
4. **Submit it** - Share your app with the community!

## Questions?

- Check the main [README.md](../README.md) for contribution guidelines
- Look at other apps in the \`apps/\` directory for more examples
- Open an issue if you have questions

Happy coding! 🚀`,
    },
    permissions: {
      allowedTables: ['sample_todo.todos', 'sample_todo.categories'],
      allowedSchemas: ['sample_todo'],
      readOnly: false,
    },
  },
  {
    id: 'todo-mcp',
    name: 'Todo List with MCP',
    description:
      'A todo list app with MCP server integration. Manage your todos from LLM tools like LM Studio, Claude Desktop, and more!',
    version: '1.0.0',
    author: 'db4app',
    category: 'productivity',
    tags: ['todo', 'tasks', 'mcp', 'llm', 'productivity', 'ai'],
    schema: 'todo_mcp',
    setup: {
      sql: `-- Todo List with MCP Server
-- This app creates a todo list that can be managed via MCP (Model Context Protocol)
-- LLM tools like LM Studio and Claude Desktop can interact with your todos

-- Create isolated schema
CREATE SCHEMA IF NOT EXISTS todo_mcp;

-- Create categories table
CREATE TABLE IF NOT EXISTS todo_mcp.categories (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  color text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create todos table
CREATE TABLE IF NOT EXISTS todo_mcp.todos (
  id serial PRIMARY KEY,
  title text NOT NULL,
  description text,
  category_id integer REFERENCES todo_mcp.categories(id) ON DELETE SET NULL,
  completed boolean NOT NULL DEFAULT false,
  priority integer DEFAULT 0, -- 0 = normal, 1 = high, 2 = urgent
  due_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS todos_category_idx ON todo_mcp.todos(category_id);
CREATE INDEX IF NOT EXISTS todos_completed_idx ON todo_mcp.todos(completed);
CREATE INDEX IF NOT EXISTS todos_priority_idx ON todo_mcp.todos(priority);
CREATE INDEX IF NOT EXISTS todos_due_date_idx ON todo_mcp.todos(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS todos_created_at_idx ON todo_mcp.todos(created_at);

-- Function: Get todo by ID (useful for MCP tools)
CREATE OR REPLACE FUNCTION todo_mcp.get_todo(todo_id integer)
RETURNS TABLE (
  id integer,
  title text,
  description text,
  category_name text,
  completed boolean,
  priority integer,
  due_date timestamptz,
  created_at timestamptz,
  completed_at timestamptz
) AS $$
  SELECT 
    t.id,
    t.title,
    t.description,
    c.name as category_name,
    t.completed,
    t.priority,
    t.due_date,
    t.created_at,
    t.completed_at
  FROM todo_mcp.todos t
  LEFT JOIN todo_mcp.categories c ON t.category_id = c.id
  WHERE t.id = todo_id;
$$ LANGUAGE sql;

-- Function: List todos with filters (for MCP list_todos tool)
CREATE OR REPLACE FUNCTION todo_mcp.list_todos(
  show_completed boolean DEFAULT true,
  category_filter text DEFAULT NULL,
  priority_filter integer DEFAULT NULL
)
RETURNS TABLE (
  id integer,
  title text,
  description text,
  category_name text,
  completed boolean,
  priority integer,
  due_date timestamptz,
  created_at timestamptz
) AS $$
  SELECT 
    t.id,
    t.title,
    t.description,
    c.name as category_name,
    t.completed,
    t.priority,
    t.due_date,
    t.created_at
  FROM todo_mcp.todos t
  LEFT JOIN todo_mcp.categories c ON t.category_id = c.id
  WHERE 
    (show_completed = true OR t.completed = false)
    AND (category_filter IS NULL OR c.name = category_filter)
    AND (priority_filter IS NULL OR t.priority = priority_filter)
  ORDER BY 
    t.completed ASC,
    t.priority DESC,
    t.created_at DESC;
$$ LANGUAGE sql;

-- Function: Get statistics
CREATE OR REPLACE FUNCTION todo_mcp.get_stats()
RETURNS TABLE (
  total_todos integer,
  completed_todos integer,
  pending_todos integer,
  high_priority_todos integer
) AS $$
  SELECT 
    COUNT(*)::integer as total_todos,
    COUNT(*) FILTER (WHERE completed = true)::integer as completed_todos,
    COUNT(*) FILTER (WHERE completed = false)::integer as pending_todos,
    COUNT(*) FILTER (WHERE completed = false AND priority >= 1)::integer as high_priority_todos
  FROM todo_mcp.todos;
$$ LANGUAGE sql;

-- Trigger: Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION todo_mcp.update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER todo_updated_trigger
  BEFORE UPDATE ON todo_mcp.todos
  FOR EACH ROW
  EXECUTE FUNCTION todo_mcp.update_updated_at();

-- Trigger: Auto-update completed_at timestamp
CREATE OR REPLACE FUNCTION todo_mcp.update_completed_at()
RETURNS trigger AS $$
BEGIN
  IF NEW.completed = true AND (OLD.completed = false OR OLD.completed IS NULL) THEN
    NEW.completed_at := now();
  ELSIF NEW.completed = false THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER todo_completed_trigger
  BEFORE UPDATE ON todo_mcp.todos
  FOR EACH ROW
  EXECUTE FUNCTION todo_mcp.update_completed_at();

-- Insert default categories
INSERT INTO todo_mcp.categories (name, color) VALUES
  ('Work', '#3b82f6'),
  ('Personal', '#10b981'),
  ('Shopping', '#f59e0b'),
  ('Health', '#ef4444')
ON CONFLICT (name) DO NOTHING;`,
      instructions: `# Todo List with MCP Server

A powerful todo list app that integrates with LLM tools via MCP (Model Context Protocol). Manage your todos directly from LM Studio, Claude Desktop, and other MCP-compatible tools!

## What This App Installs

- **\`todo_mcp\` schema** - Isolated schema for your todos
- **\`categories\` table** - Organize todos by category
- **\`todos\` table** - Store your todo items with metadata
- **MCP Server tools** - \`add_todo\`, \`mark_as_done\`, \`list_todos\`, \`remove_todo\`
- **SQL functions** - Helper functions for querying todos
- **Indexes** - Optimized for fast queries
- **Triggers** - Auto-update timestamps

## Installation

1. Go to the **Community Apps** page in db4
2. Find "Todo List with MCP" in the marketplace
3. Click **Install app**
4. The schema and tables will be created automatically

## MCP Server Setup

This app includes an MCP server that provides LLM tools for managing your todos.

### Add to LM Studio mcp.json

1. **Locate your \`mcp.json\` file:**
   - **macOS:** \`~/Library/Application Support/LM Studio/mcp.json\`
   - **Windows:** \`%APPDATA%\\LM Studio\\mcp.json\`
   - **Linux:** \`~/.config/LM Studio/mcp.json\`

2. **Get your Connection ID and Auth Token:**
   - Open the Database page in your browser
   - Wait for the relay connection to establish
   - Your **Connection ID** is displayed in the Connection Info section
   - Your **Auth Token** is also shown (this is your password)

3. **Add this configuration to the \`mcpServers\` object:**

\`\`\`json
{
  "mcpServers": {
    "db4app-todo": {
      "command": "npx",
      "args": ["-y", "db4app-todo-mcp-server@0.1.0"],
      "env": {
        "MCP_POSTGRES_URL": "postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID",
        "MCP_SCHEMA": "todo_mcp"
      }
    }
  }
}
\`\`\`

**Important Notes:**
- Replace \`YOUR_AUTH_TOKEN\` with your actual auth token from step 2
- Replace \`YOUR_CONNECTION_ID\` with your Connection ID from step 2
- The placeholders above are automatically replaced when displayed in the db4 interface
- The connection string format is: \`postgres://postgres:AUTH_TOKEN@RELAY_HOST:RELAY_PG_PORT/CONNECTION_ID\`

4. **Restart LM Studio** to load the new MCP server configuration.

### Add to Claude Desktop

1. **Locate your Claude Desktop config:**
   - **macOS:** \`~/Library/Application Support/Claude/claude_desktop_config.json\`
   - **Windows:** \`%APPDATA%\\Claude\\claude_desktop_config.json\`
   - **Linux:** \`~/.config/Claude/claude_desktop_config.json\`

2. **Add the same configuration** as above to the \`mcpServers\` object.

3. **Restart Claude Desktop.**

## MCP Tools Available

Once configured, you can use these tools in your LLM:

### \`add_todo\`

Add a new todo item.

**Parameters:**
- \`title\` (required): The todo title
- \`description\` (optional): Additional details
- \`category\` (optional): Category name (e.g., "Work", "Personal")
- \`priority\` (optional): Priority level (0=normal, 1=high, 2=urgent)
- \`due_date\` (optional): Due date in ISO format (e.g., "2024-12-31T23:59:59Z")

**Example usage in LM Studio:**
\`\`\`
"Add a todo to finish the project report by end of month, high priority, in the Work category"
\`\`\`

### \`mark_as_done\`

Mark a todo as completed.

**Parameters:**
- \`todo_id\` (required): The ID of the todo to mark as done

**Example usage:**
\`\`\`
"Mark todo #5 as done"
"Complete the todo about finishing the report"
\`\`\`

### \`list_todos\`

List all todos with optional filters.

**Parameters:**
- \`show_completed\` (optional): Show completed todos (default: true)
- \`category\` (optional): Filter by category name
- \`priority\` (optional): Filter by priority level (0, 1, or 2)

**Example usage:**
\`\`\`
"Show me all my pending todos"
"List all high priority todos in the Work category"
"What todos do I have due today?"
\`\`\`

### \`remove_todo\`

Delete a todo item.

**Parameters:**
- \`todo_id\` (required): The ID of the todo to remove

**Example usage:**
\`\`\`
"Delete todo #3"
"Remove the todo about buying groceries"
\`\`\`

## Usage Examples

### In LM Studio or Claude Desktop

Once the MCP server is configured, you can interact with your todos naturally:

\`\`\`
"Add a todo to call mom tomorrow, high priority"
"What todos do I have?"
"Mark the grocery shopping todo as done"
"Show me all my work todos"
"Delete the old todo about fixing the bug"
\`\`\`

### Direct SQL Queries

You can also query the database directly:

\`\`\`sql
-- List all todos
SELECT * FROM todo_mcp.list_todos();

-- List only pending todos
SELECT * FROM todo_mcp.list_todos(show_completed => false);

-- List high priority todos
SELECT * FROM todo_mcp.list_todos(priority_filter => 1);

-- Get statistics
SELECT * FROM todo_mcp.get_stats();

-- Add a todo manually
INSERT INTO todo_mcp.todos (title, description, category_id, priority)
VALUES (
  'Finish project',
  'Complete the documentation',
  (SELECT id FROM todo_mcp.categories WHERE name = 'Work'),
  1
);

-- Mark as done
UPDATE todo_mcp.todos
SET completed = true
WHERE id = 1;
\`\`\`

## Features

### Schema Isolation

All objects are created in the \`todo_mcp\` schema, preventing conflicts with other apps.

### Automatic Timestamps

- \`created_at\` - Set when todo is created
- \`updated_at\` - Updated automatically on any change
- \`completed_at\` - Set automatically when marked as done

### Categories

Organize todos by category:
- Work
- Personal
- Shopping
- Health

Add your own categories:

\`\`\`sql
INSERT INTO todo_mcp.categories (name, color)
VALUES ('Learning', '#8b5cf6');
\`\`\`

### Priority Levels

- **0** - Normal priority
- **1** - High priority
- **2** - Urgent priority

### Due Dates

Set due dates for time-sensitive todos:

\`\`\`sql
INSERT INTO todo_mcp.todos (title, due_date, priority)
VALUES (
  'Submit report',
  '2024-12-31T23:59:59Z',
  2
);
\`\`\`

## Connecting External Tools

You can connect external tools (like DBeaver, TablePlus, or psql) to your database:

\`\`\`
postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID
\`\`\`

**Note:** The placeholders are automatically replaced with your actual values when displayed in the db4 interface.

### Example: Using psql

\`\`\`bash
psql "postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID"
\`\`\`

## Troubleshooting

### MCP Server Not Working

1. **Check connection string:**
   - Verify \`YOUR_AUTH_TOKEN\` and \`YOUR_CONNECTION_ID\` are correct
   - Make sure the connection string format is correct

2. **Check database connection:**
   \`\`\`sql
   SELECT * FROM todo_mcp.get_stats();
   \`\`\`
   If this works, the database is accessible.

3. **Check MCP server logs:**
   - Look for errors in LM Studio console
   - Verify the MCP server package is installed

4. **Verify schema exists:**
   \`\`\`sql
   SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'todo_mcp';
   \`\`\`

### Tools Not Appearing

1. **Restart LM Studio/Claude Desktop** after adding the MCP server
2. **Check mcp.json syntax** - Make sure JSON is valid
3. **Verify package name and version** - Should be \`db4app-todo-mcp-server@0.1.0\`

## Uninstalling

To remove this app:

\`\`\`sql
DROP SCHEMA IF EXISTS todo_mcp CASCADE;
\`\`\`

**Warning:** This will delete all todos and categories! Export your data first if needed.

## Next Steps

1. **Install the app** from the Community Apps page
2. **Set up the MCP server** in your LLM tool
3. **Start managing todos** via natural language!

## Example Workflow

1. **Add todos via LLM:**
   \`\`\`
   "Add a todo to review the code, high priority, in Work category"
   "Remind me to buy groceries tomorrow"
   \`\`\`

2. **Check your todos:**
   \`\`\`
   "What todos do I have?"
   "Show me high priority todos"
   \`\`\`

3. **Complete tasks:**
   \`\`\`
   "Mark the code review todo as done"
   \`\`\`

4. **Clean up:**
   \`\`\`
   "Delete completed todos from last week"
   \`\`\`

Enjoy managing your todos with AI! 🚀`,
    },
    permissions: {
      allowedTables: ['todo_mcp.todos', 'todo_mcp.categories'],
      allowedSchemas: ['todo_mcp'],
      readOnly: false,
    },
    requirements: {
      mcpServer: true,
    },
    mcpServer: {
      npmPackage: 'db4app-todo-mcp-server',
      command: 'npx',
      args: ['-y', 'db4app-todo-mcp-server@0.1.0'],
      env: {
        MCP_POSTGRES_URL: 'postgres://postgres:YOUR_AUTH_TOKEN@localhost:6543/YOUR_CONNECTION_ID',
        MCP_SCHEMA: 'todo_mcp',
      },
      notes: {
        embeddingModel: 'This MCP server provides tools for managing todos: add_todo, mark_as_done, list_todos, remove_todo',
      },
    },
  },
]

export async function listApps(): Promise<CommunityApp[]> {
  // Try to load apps dynamically from the apps folder first
  // Fall back to hardcoded CURATED_APPS if dynamic loading fails
  try {
    const { loadAppsFromFolder } = await import('./utils/loadApps')
    const dynamicApps = await loadAppsFromFolder()
    if (dynamicApps.length > 0) {
      return dynamicApps
    }
  } catch (error) {
    console.warn('Failed to load apps dynamically, falling back to hardcoded apps:', error)
  }
  
  // Fallback to hardcoded apps
  return CURATED_APPS
}

export async function loadAppSQL(appId: string): Promise<string> {
  const app = CURATED_APPS.find((a) => a.id === appId)
  if (!app) {
    throw new Error(`Community app not found: ${appId}`)
  }
  return app.setup.sql
}

export async function loadAppInstructions(appId: string): Promise<string> {
  const app = CURATED_APPS.find((a) => a.id === appId)
  if (!app) {
    throw new Error(`Community app not found: ${appId}`)
  }
  return app.setup.instructions
}

export async function installApp(db: PGlite, app: CommunityApp): Promise<void> {
  const sql = await loadAppSQL(app.id)
  await db.exec(sql)

  // Record installation in a metadata table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      app_id text PRIMARY KEY,
      installed_at timestamptz NOT NULL DEFAULT now(),
      version text NOT NULL
    );
  `)

  await db.query(
    `
    INSERT INTO app_metadata (app_id, version)
    VALUES ($1, $2)
    ON CONFLICT (app_id) DO UPDATE SET
      installed_at = now(),
      version = EXCLUDED.version;
  `,
    [app.id, app.version],
  )
}

export async function uninstallApp(db: PGlite, appId: string): Promise<void> {
  // Load the app to get uninstall SQL (if it exists)
  // For now, we'll just remove from metadata
  // In a full implementation, apps could provide uninstall.sql
  await db.query(`DELETE FROM app_metadata WHERE app_id = $1`, [appId])
}

export async function getInstalledApps(db: PGlite): Promise<InstalledApp[]> {
  try {
    const result = await db.query<InstalledApp>(
      `
      SELECT app_id as "appId", installed_at as "installedAt", version
      FROM app_metadata
      ORDER BY installed_at DESC;
    `,
    )
    return result.rows
  } catch {
    // Table doesn't exist yet, return empty array
    return []
  }
}

export async function isAppInstalled(db: PGlite, appId: string): Promise<boolean> {
  try {
    const result = await db.query<{ exists: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1 FROM app_metadata WHERE app_id = $1
      ) as exists;
    `,
      [appId],
    )
    return result.rows[0]?.exists ?? false
  } catch {
    return false
  }
}

// Legacy exports for backward compatibility (deprecated)
/** @deprecated Use `listApps` instead */
export const listRecipes = listApps
/** @deprecated Use `loadAppSQL` instead */
export const loadRecipeSQL = loadAppSQL
/** @deprecated Use `loadAppInstructions` instead */
export const loadRecipeInstructions = loadAppInstructions
/** @deprecated Use `installApp` instead */
export const installRecipe = installApp
/** @deprecated Use `uninstallApp` instead */
export const uninstallRecipe = uninstallApp
/** @deprecated Use `getInstalledApps` instead */
export const getInstalledRecipes = getInstalledApps
/** @deprecated Use `isAppInstalled` instead */
export const isRecipeInstalled = isAppInstalled
/** @deprecated Use `CommunityApp` instead */
export type Recipe = CommunityApp
/** @deprecated Use `InstalledApp` instead */
export type InstalledRecipe = InstalledApp

