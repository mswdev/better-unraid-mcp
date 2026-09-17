# syntax=docker/dockerfile:1
# Better Unraid MCP — HTTP transport image for remote/hosted MCP clients.
# The server refuses to start without MCP_HTTP_BEARER_TOKEN (see README → Docker).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
COPY schema ./schema
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/schema ./schema
USER node
EXPOSE 3000
# An unauthenticated POST must answer 401 — that proves the server is up AND locked.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null -S --post-data='{}' --header='Content-Type: application/json' http://127.0.0.1:3000/mcp 2>&1 | grep -q "401" || exit 1
CMD ["node", "dist/index.js"]
