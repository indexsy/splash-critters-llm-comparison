# Splash Critters

8-bit online water-balloon arena. Up to four critters, cross-shaped splashes, sandcastles, ranked Elo, and casual rooms with bots. Last critter dry wins.

## Develop

```bash
npm install
npm run dev
```

Client: http://localhost:5173 · Server: http://localhost:3000

Artificial latency: http://localhost:5173/?lag=150

## Test

```bash
npm test
npm run soak
```

## Production

```bash
npm run build
npm start
```

One process serves the client, REST, and WebSocket on `PORT` (default 3000).

SQLite lives at `$DATA_DIR/splash.db` (default `./data`). Mount a volume there.

## Docker

```bash
docker build -t splash-critters .
docker run -p 3000:3000 -v splash-data:/data -e DATA_DIR=/data splash-critters
```

Health check: `GET /health`

## Deploy

Railway, Fly, and Render all run the Dockerfile.

- Set `PORT` if the platform assigns one (it is read from the environment).
- Mount a persistent volume at `/data` and set `DATA_DIR=/data` so accounts and Elo survive restarts.
- The server speaks WebSocket on the same port as HTTP. Terminate TLS at the proxy so browsers use `wss://`.
- Fly: `fly launch` then `fly volumes create splash_data` and mount it at `/data`.
- Railway/Render: add a volume mounted at `/data`.

Desktop browsers only. No touch controls in v1.
