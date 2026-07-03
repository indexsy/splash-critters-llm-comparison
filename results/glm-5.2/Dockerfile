# Dockerfile — single Node process, server + built client on one PORT (spec §1).
# SQLite persists on a mounted volume at /data.
FROM node:20-slim AS base
WORKDIR /app

# build deps for better-sqlite3 (needs python/make/g++)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/
RUN npm ci

COPY packages ./packages
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000

# runtime needs only the native better-sqlite3 binding + dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/shared/dist ./packages/shared/dist
COPY --from=base /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=base /app/packages/server/dist ./packages/server/dist
COPY --from=base /app/packages/server/public ./packages/server/public
COPY --from=base /app/packages/server/package.json ./packages/server/package.json
COPY package.json tsconfig.base.json ./

VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
