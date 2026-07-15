# ShopTalk Cloud — multi-tenant MCP service.
# BUILD CONTEXT MUST BE THE REPO ROOT (cloud/ imports ../backend/).
# In Railway: set the service's Dockerfile path to `cloud/Dockerfile` and keep
# the root directory at the repository root.
FROM node:22

WORKDIR /app

# Install deps first for layer caching. cloud reuses backend's tool layer, so
# both dependency trees are needed at runtime.
COPY backend/package*.json backend/
RUN cd backend && npm ci --omit=dev
COPY cloud/package*.json cloud/
RUN cd cloud && npm ci --omit=dev

COPY backend/ backend/
COPY cloud/ cloud/
# Served (rendered) at /privacy — keep it in the image.
COPY PRIVACY.md PRIVACY.md

ENV NODE_ENV=production
ENV PORT=4700
# The tenant DB. Mount a persistent Railway Volume at /data or every redeploy
# wipes all merchants' encrypted tokens.
ENV CLOUD_DB=/data/cloud.db

EXPOSE 4700
CMD ["node", "cloud/app.js"]
