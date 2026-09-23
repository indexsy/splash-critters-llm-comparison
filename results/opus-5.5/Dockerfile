# syntax=docker/dockerfile:1
# Single Node process serving the client, REST API, WebSocket (/ws) and /health on $PORT.
# SQLite lives at $DATA_DIR/splash.db: mount a volume there so it persists.

FROM node:20-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 falls back to a source build when no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages ./packages
# The server bundle inlines @splash/shared and the client is static files, so the runtime needs
# only the production dependencies (express, ws, better-sqlite3), not the workspace links.
RUN npm run build \
  && npm prune --omit=dev --no-audit --no-fund \
  && rm -rf node_modules/@splash

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/client/dist ./packages/client/dist
# No VOLUME instruction: Railway rejects Dockerfiles that declare one. Mount storage at /data
# (docker run -v, a Railway volume, a Fly mount or a Render disk).
RUN mkdir -p /data && chown node:node /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Platform volumes and host bind mounts arrive owned by root, which the unprivileged server cannot
# write (SQLITE_CANTOPEN). Started as root, the entrypoint only hands DATA_DIR to `node` and then
# execs the server as `node` via setpriv (util-linux, part of the base image), so the server stays
# PID 1, never runs as root and receives SIGTERM directly. Started with --user, it runs as that user.
# Either way it first checks, as the server's user, that DATA_DIR and the database files in it
# (splash.db, -wal, -shm) are writable, and exits with a clear message if not: SQLite opens a
# read-only mount without complaint, and the server would then pass its health check while every
# write failed with SQLITE_READONLY.
ENTRYPOINT ["/bin/sh", "-c", "set -e; mkdir -p \"$DATA_DIR\"; as_server=; \
  if [ \"$(id -u)\" = 0 ]; then \
    find \"$DATA_DIR\" ! -user node -exec chown node:node {} +; \
    as_server='setpriv --reuid=node --regid=node --init-groups --'; \
  fi; \
  if ! $as_server test -w \"$DATA_DIR\" || [ -n \"$($as_server find \"$DATA_DIR\" -maxdepth 1 \
      -type f -name 'splash.db*' ! -writable -print -quit)\" ]; then \
    echo \"[entrypoint] $DATA_DIR or its database files are not writable by uid $($as_server id -u)\" \
      \"(read-only mount?). Mount a writable volume at DATA_DIR.\" >&2; \
    exit 1; \
  fi; \
  exec $as_server \"$@\"", "entrypoint"]
CMD ["node", "packages/server/dist/index.js"]
