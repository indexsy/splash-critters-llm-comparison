import { defineConfig } from 'vite';

// Dev: client on :5173 (or CLIENT_PORT), proxying /ws and /api (and /health) to the game server.
const SERVER = process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  server: {
    port: Number(process.env.CLIENT_PORT ?? 5173),
    proxy: {
      '/api': SERVER,
      '/health': SERVER,
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
  },
});
