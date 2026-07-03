import { defineConfig } from "vite";

// Vite dev proxy for /ws and /api (spec §1). In production, the Node server
// serves the built client on a single port.
// @splash/shared resolves via the npm-workspace symlink to packages/shared
// (its built dist/ is used in production; for dev the source is fine through
// the symlink too once shared is built).
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://localhost:3000", ws: true },
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
