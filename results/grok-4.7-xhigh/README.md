# Splash Critters

8-bit online water-balloon arena. Last critter dry wins. Up to 4 players, casual rooms with bots, and ranked Elo for Duel and Free-for-All.

## Scripts

- `npm run dev` — shared watch, server on `:3000`, client on `:5173` (proxies `/api` and `/ws`)
- `npm test` — sim, chain splash, map seed, and Elo fixtures
- `npm run soak` — headless bot-vs-bot match, asserts no desync
- `npm run build && npm start` — one process on `PORT` (default 3000)

Artificial latency: open `http://localhost:5173/?lag=150`.

## Persistence

SQLite lives at `$DATA_DIR/splash.db` (default `data/splash.db`), WAL mode, migrations on boot. Mount `DATA_DIR` so accounts and ratings survive restarts.

Guest accounts are a device token in `localStorage`. Losing the token loses the account. There are no passwords.

## Deploy

The container is a single Node process. WebSocket upgrades must be forwarded (`wss://` behind the proxy).

```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data -e DATA_DIR=/data splash-critters
```

Railway / Render / Fly:

1. Deploy with the Dockerfile (or `npm ci && npm run build`, start `npm start`).
2. Set `PORT` from the platform and `DATA_DIR` to a mounted volume path (`/data`).
3. Expose HTTP and enable WebSocket proxying. Health check: `GET /health`.

Ranked ratings, matches, and unlocks are in that SQLite file. Do not run more than one instance against the same file.
