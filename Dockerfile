# Dockerfile for db4app relay server
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies (production only for smaller image)
# Note: ws is needed for WebSocket support
# Skip postinstall hook (build:mcp) since we don't need MCP server in relay container
RUN npm ci --omit=dev --ignore-scripts

# Copy server code
COPY server/ ./server/

# Optional configuration (see docker-compose.yml for the full list):
#   ALLOWED_ORIGINS   comma-separated CORS origins for the web app
#   RELAY_PG_DOMAIN   domain for SNI routing (CONNECTION_ID.<domain>), requires TLS certs
#   TLS_CERT_PATH / TLS_KEY_PATH   default /etc/tls/tls.crt and /etc/tls/tls.key
#   POSTHOG_API_KEY / POSTHOG_HOST  opt-in telemetry, disabled unless set
ENV NODE_ENV=production

# Expose ports
# 8787: HTTP/WebSocket server
# 6543: Postgres wire protocol
EXPOSE 8787 6543

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.RELAY_PORT || 8787) + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start the relay server
CMD ["node", "server/index.js"]

