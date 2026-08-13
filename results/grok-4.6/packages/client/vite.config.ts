import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://localhost:3000", ws: true },
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
  resolve: {
    alias: {
      "@splash/shared": resolve(root, "../shared/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
