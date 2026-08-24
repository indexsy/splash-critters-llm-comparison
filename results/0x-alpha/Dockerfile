FROM node:20-slim

WORKDIR /app

# Install dependencies first (better layer caching; better-sqlite3 needs build tools)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci

# Copy sources and build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/client packages/client
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000

CMD ["npx", "tsx", "packages/server/src/index.ts"]
