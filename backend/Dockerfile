# MockBase backend — Express API + SSE + MCP (streamable HTTP) in one process.
FROM node:22-slim

# better-sqlite3 ships prebuilt binaries for common platforms; keep the build
# toolchain as a fallback in case a prebuild isn't available for the target arch.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for better layer caching. (.dockerignore keeps the host's
# node_modules and the local SQLite file out of the build context.)
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Defaults; override in your host's dashboard. MOCKBASE_DB should point at a
# mounted persistent volume so data survives restarts/redeploys.
ENV PORT=4000
ENV MOCKBASE_DB=/data/mockbase.db

EXPOSE 4000
CMD ["node", "server.js"]
