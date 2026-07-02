# ShopTalk backend — MCP over streamable HTTP (/mcp) + health check.
FROM node:22-slim

WORKDIR /app

# Install deps first for better layer caching. (.dockerignore keeps the host's
# node_modules out of the build context.)
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Defaults; override in your host's dashboard.
ENV PORT=4000
# Keep Express in production mode (no stack traces in error responses).
ENV NODE_ENV=production

EXPOSE 4000
CMD ["node", "server.js"]
