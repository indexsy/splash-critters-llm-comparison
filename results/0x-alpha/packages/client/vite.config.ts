import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:3000", ws: true },
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
  build: { target: "es2022" },
});
