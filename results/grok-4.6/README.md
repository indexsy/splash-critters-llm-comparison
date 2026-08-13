# Splash Critters

8-bit online water-balloon arena. Last critter dry wins.

Up to 4 players, casual rooms with bots, ranked Elo for Duel and FFA, guest accounts, cosmetics.

## Requirements

- Node.js 20+
- npm 10+

## Dev

```bash
npm install
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3000 (`/ws`, `/api`, `/health`)

Artificial latency: open `http://localhost:5173/?lag=150`

## Production (one port)

```bash
npm run build
DATA_DIR=./data PORT=3000 npm start
```

Serves the built client, WebSocket, REST, and SQLite from a single Node process.

## Tests

```bash
npm test          # Vitest: splash chains, map RNG, Elo fixtures
npm run soak      # headless Hard vs Easy bot match
```

## Docker / Railway / Fly / Render

```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data splash-critters
```

Set `PORT` (platform) and `DATA_DIR=/data`. Mount a volume on `/data` so `splash.db` persists. Terminate TLS at the proxy and forward WebSockets (`wss://`).

## Controls

WASD / arrows move · Space or E drop balloon · 1–4 emotes · M mute

Losing the device token in localStorage loses the guest account. There is no password.
