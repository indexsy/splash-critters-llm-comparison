/// <reference types="vite/client" />

import { defineConfig } from "vite";

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const SERVER = env.SPLASH_SERVER ?? "http://localhost:3000";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/ws": {
        target: SERVER.replace(/^http/, "ws"),
        ws: true,
        changeOrigin: true
      },
      "/api": {
        target: SERVER,
        changeOrigin: true
      }
    }
  },
  build: {
    target: "es2022",
    sourcemap: true,
    outDir: "dist",
    emptyOutDir: true
  },
  resolve: {
    alias: {
      "@splash/shared": "@splash/shared"
    }
  }
});
