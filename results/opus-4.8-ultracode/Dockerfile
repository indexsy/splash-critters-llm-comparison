# --- build stage ---
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Toolchain for better-sqlite3 native build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# --- runtime stage ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

# Reinstall only production deps (rebuild native better-sqlite3 for runtime image)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY packages/server/package.json packages/server/
RUN npm install --omit=dev --no-audit --no-fund --workspace packages/server --include-workspace-root \
  && apt-get purge -y python3 make g++ || true

COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist

VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
